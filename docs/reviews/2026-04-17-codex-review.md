## PART 1 — Code review of recent commits

### Findings

1. `apps/worker/src/handlers/build-handler.ts:178-195`
   If branch creation fails, the handler only logs the error and still continues to `ghCommitAll()`. In that state the clone is still on the default branch, so the worker can commit and push directly to `main` instead of an isolated feature branch. That is a correctness and safety bug, not just an error-path nit. Suggestion: make branch creation a hard gate; if `ghCreateBranch()` fails, fail the run immediately and do not stage, commit, or push anything.

2. `apps/worker/src/lib/triage-discovery-comment.ts:45-75`
   `extractSections()` scans headings with a single global regex and does not ignore fenced code blocks. A `### Sources` or `### Severity` line inside `Logs Excerpt` will be treated as a real section boundary. I verified this locally: a fenced log containing `### Sources` truncates `Logs Excerpt` and rewrites the downstream sections. Suggestion: parse markdown structurally, or at minimum add a fence-aware prepass so headings inside triple-backtick blocks are skipped.

3. `apps/worker/src/lib/triage-discovery-comment.ts:35-38`
   `hasDiscoveryComment()` treats any comment containing a markdown `Summary` heading as a prior triage comment, even if the discovery marker is absent. That means a human-written debugging comment with `## Summary` can permanently suppress future polling-based triage. Suggestion: key discovery detection on the explicit `TRIAGE_DISCOVERY_MARKER`, or on a much stricter signed block format instead of a generic heading regex.

4. `apps/api/src/services/polling-event-service.ts:79-90,132-176`
   The dedupe key for `github.issue.labeled` is `scenario + repo + label + issue number`, with no event identity or timestamp. If a label is removed and later re-added, the second labeling is treated as a permanent duplicate and the scenario never fires again. That breaks legitimate re-triage / re-build flows. Suggestion: include an event instance discriminator such as `updatedAt`, webhook delivery id, or a persisted label-transition timestamp; do not use a forever-stable dedupe key for edge-triggered events.

5. `apps/worker/src/lib/polling-scenarios.ts:115-121,267-304` and `apps/api/src/services/scenario-matcher.ts:181-187`
   The PR comment trigger matches `body.includes(keyword)` and ignores the configured `botName` entirely. The UI and plan documents promise an optional `@botName` restriction, but the runtime currently fires on any comment by any author containing the keyword substring. That is both correctness drift and an abuse surface for accidental or malicious triggers. Suggestion: enforce exact tokenization rules plus optional mention matching in one shared matcher, and pass the same rule set through polling and API-side matching.

6. `apps/worker/src/handlers/triage-handler.ts:95-276`
   Temporary repo cleanup is not protected by `finally`. The happy path and one discovery-comment failure path call `cleanupWorkDir()`, but any unhandled exception after cloning leaks the temp directory. Examples include a future `parseTriageReport()` throw, a thrown `submitReport()`, or a new post-clone step added later. Suggestion: wrap the whole post-clone flow in `try/finally` and do cleanup exactly once from the `finally` block.

7. `apps/worker/src/handlers/triage-handler.ts:247-248`
   The new label emission switched from `complexity-*` to `severity-*`, but the documented local-GitHub polling contract still says triage completion must ensure `triaged` and complexity labels exist before applying them. This is a workflow-contract mismatch on a core invariant, and it also leaves `packages/github-cli` label metadata/tests aligned to `complexity-*` instead of the emitted taxonomy. Suggestion: pick one canonical post-triage label family, update both code and docs/contracts together, and add an integration test that asserts the exact labels emitted.

8. `apps/api/src/services/dispatcher-service.ts:31-53,110,155-181` and `apps/api/src/services/scenario-matcher.ts:79-127`
   Both services flatten the designer graph to “first trigger, first action, all outputs in step order” and ignore `outgoingNodeIds`. That means any non-linear workflow shape shown in the designer is not what the backend executes. For review runs triggered by comments, the dispatched hints also omit the triggering comment metadata (`commentId`, `author`, `body`, `url`), so the worker cannot audit or tailor behavior to the actual command event. Suggestion: either validate and enforce a strictly linear single-action graph at save time, or compile/dispatch from actual graph edges and include immutable trigger context in `providerHints`.

9. `apps/worker/src/lib/polling-scenarios.ts:359-384`
   Polling only loads `ghListOpenIssues()` and `ghListOpenPRs()`. That hard-limits the scenario engine to open items and makes whole classes of GitHub scenarios impossible to observe from polling: merged PRs, closed issues, reopened items, ready-for-review transitions, review-requested transitions, and post-close comments. The catalog already assumes several of those flows. Suggestion: make polling event-specific instead of “scan current open state,” or prefer webhooks where GitHub already exposes the event directly.

### Coverage gaps in tests

- There is no focused test coverage for `apps/worker/src/lib/triage-discovery-comment.ts`, even though the parser now owns the 9-section contract and the discovery-marker skip logic.
- There is no test coverage for `apps/worker/src/lib/polling-scenarios.ts` after the old `polling-triage.test.ts` was deleted, so comment-trigger matching, connector binding, and PR/issue event emission currently ship unverified.
- `apps/api/src/services/dispatcher-service.test.ts` only covers basic dispatch. It does not assert scenario-context extraction, review-specific hints, or action/output propagation.
- There is no test around `build-handler` branch-failure behavior, which is exactly where the highest-risk regression sits.

## PART 2 — Scenario catalog completeness

Checked against GitHub's documented webhook/API surface on April 17, 2026, using the official webhook, Actions event, Projects automation, and GraphQL reference docs.

### Coverage matrix

| GitHub event/object | Covered in catalog | Scenario number(s) | Gap severity |
| --- | --- | --- | --- |
| Issues lifecycle (`issues`) | Yes | 1.2-1.7, 2.1, 3.1, 3.3, 5.4-5.5, 8.1, 10.1-10.3 | None |
| Issue comments (`issue_comment`) | Partial | 3.3, 10.1-10.3 | High |
| Issue dependencies (`issue_dependencies`) | No | — | High |
| Sub-issues / hierarchy (`sub_issues`) | No | — | High |
| Labels (`label`, issue/PR labeling) | Yes | 1.1-1.2, 1.5, 2.1, 5.4-5.5, 8.1 | Low |
| Milestones (`milestone`) | No | — | Medium |
| Pull request lifecycle (`pull_request`) | Yes | 4.1-4.8, 8.2, 9.1-9.2 | Low |
| PR top-level comments (`issue_comment` on PRs) | Partial | 4.2 | High |
| PR reviews (`pull_request_review`) | No | — | High |
| PR review comments (`pull_request_review_comment`) | No | — | High |
| PR review threads (`pull_request_review_thread`) | No | — | High |
| Review requests / required reviewers | No | — | High |
| Ready-for-review / converted-to-draft | Partial | 4.6, 4.3 | Medium |
| Merge queue / merge groups (`merge_group`) | No | — | High |
| Commit status (`status`) | Partial | 5.3 | High |
| Check runs / check suites (`check_run`, `check_suite`) | No | — | High |
| Workflow runs / jobs (`workflow_run`, `workflow_job`) | Partial | 5.3, 7.1, 7.2 | High |
| Workflow dispatch / repository dispatch | No | — | Medium |
| Deployments (`deployment`) | No | — | High |
| Deployment status (`deployment_status`) | No | — | High |
| Deployment reviews / protection rules | No | — | High |
| Releases (`release`) | No | — | Medium |
| Packages / registry packages | No | — | Medium |
| Discussions (`discussion`) | No | — | Medium |
| Discussion comments (`discussion_comment`) | No | — | Medium |
| Repository events (`repository`) | No | — | Medium |
| Push / branch creation / deletion (`push`, `create`, `delete`) | Partial | 6.3 | Medium |
| Forks (`fork`) | No | — | Low |
| Stars / watches (`star`, `watch`) | No | — | Low |
| Wikis (`gollum`) | No | — | Medium |
| Projects v2 project/item/status (`projects_v2`, `projects_v2_item`, `projects_v2_status_update`) | No | — | High |
| Classic projects (`project`, `project_card`, `project_column`) | No | — | Low |
| Teams / membership (`team`, `team_add`, `member`, `membership`) | No | — | Medium |
| Repository rules / rulesets (`branch_protection_rule`, `repository_ruleset`) | No | — | Medium |
| Security advisories (`security_advisory`, `repository_advisory`) | No | — | High |
| Dependabot alerts (`dependabot_alert`) | No | — | High |
| Repository vulnerability alerts (`repository_vulnerability_alert`) | No | — | High |
| Code scanning alerts (`code_scanning_alert`) | No | — | High |
| Secret scanning alerts (`secret_scanning_alert`) | No | — | High |
| Secret scanning locations / scans (`secret_scanning_alert_location`, `secret_scanning_scan`) | No | — | Medium |
| Security and analysis settings (`security_and_analysis`) | No | — | Low |
| Pages / page builds (`page_build`) | No | — | Low |

### Missing scenarios

#### 4.9 Review On Requested Reviewer
Run review when a PR requests a human or team reviewer.

- **Trigger:** `pull_request` (`review_requested`) or `pull_request_review_thread` / reviewer-field change
- **Action:** `workflow.review`
- **Outputs:** `github.pr.comment` + optional `slack.notify`
- **Knobs:** `reviewerScope` (user/team), `skipBots`, `profile`
- **Status:** 🔧 needs reviewer-aware trigger and reviewer-field lookup

#### 4.10 Review On Ready For Review
Draft PR becomes ready for review and should receive the same review path as a fresh PR.

- **Trigger:** `pull_request` (`ready_for_review`)
- **Action:** `workflow.review`
- **Outputs:** `github.pr.comment`
- **Knobs:** `skipLabels`, `profile`
- **Status:** 🔧 needs explicit `ready_for_review` trigger support

#### 5.6 CI Failure Re-Triage
A workflow run or required check fails on a PR opened by Support Agent, so the system comments with the failing signal and optionally opens a follow-up build.

- **Trigger:** `workflow_run` (`completed`) or `check_run` (`completed`) with failure conclusion
- **Action:** `workflow.triage` or `workflow.build`
- **Outputs:** `github.pr.comment` + optional `slack.notify`
- **Knobs:** `requiredChecks`, `retryOn`, `maxAutoRetries`
- **Status:** 🔧 needs Actions/check triggers and conclusion filters

#### 5.7 Deployment Failure Escalation
A deployment or deployment status changes to failure for a repo linked to an active issue/PR.

- **Trigger:** `deployment_status` (`failure`) or `deployment_review` rejected
- **Action:** `workflow.triage`
- **Outputs:** `github.issue.comment` or `github.pr.comment` + `slack.notify`
- **Knobs:** `environment`, `severityMap`, `linkBackMode`
- **Status:** 🔧 needs deployment primitives and environment mapping

#### 6.4 Project Item Entered Triage Column
An item moves into a Projects v2 status column such as `Todo` or `Needs Triage`.

- **Trigger:** `projects_v2_item` / `projects_v2_status_update`
- **Action:** `workflow.triage`
- **Outputs:** `github.issue.comment` + `github.project_item.set_status`
- **Knobs:** `projectRef`, `fromStatus`, `toStatus`
- **Status:** 🔧 needs Projects v2 connector primitives

#### 7.3 Dependabot Alert Intake
A new Dependabot alert should open or update a tracked issue and optionally start a remediation build.

- **Trigger:** `dependabot_alert`
- **Action:** `agent.respond` or `workflow.build`
- **Outputs:** issue create/update + `github.issue.label` + optional `slack.notify`
- **Knobs:** `severityThreshold`, `ecosystemAllowlist`, `autoPatch`
- **Status:** 🔧 needs Dependabot alert intake and issue-create output

#### 7.4 Code Scanning Alert Triage
Critical code scanning findings should create actionable work items and escalate.

- **Trigger:** `code_scanning_alert`
- **Action:** `workflow.triage`
- **Outputs:** issue create/update + `slack.notify`
- **Knobs:** `tool`, `severityThreshold`, `dedupeByFingerprint`
- **Status:** 🔧 needs code-scanning intake and fingerprint dedupe

#### 8.3 Secret Scanning Response
A secret scanning alert should notify responders and create a follow-up remediation issue.

- **Trigger:** `secret_scanning_alert`
- **Action:** `agent.respond`
- **Outputs:** `slack.notify` + issue create/update
- **Knobs:** `notifyChannel`, `providerType`, `autoCloseWhenRevoked`
- **Status:** 🔧 needs secret-scanning intake and issue-create output

#### 8.4 Advisory To Dependency Campaign
A published security advisory should create linked remediation work across affected repositories.

- **Trigger:** `security_advisory` or `repository_advisory`
- **Action:** `agent.respond`
- **Outputs:** issue create/update across repo scope + `slack.notify`
- **Knobs:** `affectedRepos`, `severityThreshold`, `campaignLabel`
- **Status:** 🔧 needs advisory ingestion and multi-repo routing

#### 9.3 Discussion Triage
A new GitHub Discussion in a support category should receive an AI answer draft or be escalated to an issue.

- **Trigger:** `discussion` or `discussion_comment`
- **Action:** `agent.respond`
- **Outputs:** discussion reply or issue create
- **Knobs:** `category`, `escalateOnKeywords`, `replyTemplate`
- **Status:** 🔧 needs discussion connector support

#### 9.4 Milestone Due-Risk Reporter
Warn when open issues in a milestone are unlikely to complete by due date.

- **Trigger:** `schedule.interval` + milestone query
- **Action:** `agent.respond`
- **Outputs:** `github.issue.comment` or `slack.notify`
- **Knobs:** `milestone`, `warnDaysBefore`, `ageThreshold`
- **Status:** 🔧 needs milestone query support

#### 10.4 Wiki Change Review
When wiki pages change, request review or summarize potentially impactful docs changes.

- **Trigger:** `gollum`
- **Action:** `workflow.review` or `agent.respond`
- **Outputs:** `slack.notify` or issue create
- **Knobs:** `pathAllowlist`, `summaryMode`
- **Status:** 🔧 needs wiki event ingestion

### Catalog entries that duplicate or overlap

- `1.1 Needs-Triage Watchdog` and `2.1 Label-Driven Triage` are one pipeline split across two entries. They should cross-link explicitly as “watchdog applies label, label trigger runs triage.”
- `4.2 PR Review On Command` and `4.3 Auto-Review On PR Open` are the same executor with different triggers. They would read better as one “PR review” family with trigger variants.
- `10.1`, `10.2`, and `10.3` all depend on the same missing `github.issue.comment` primitive. They should be grouped as one slash-command family instead of three isolated entries.
- `3.1 Stale Issue Closer`, `3.2 Stale PR Nudger`, and `4.6 Draft-Too-Long Nudge` overlap as “stale item policy” scenarios with different targets and consequences.
- `5.4 P0 Escalation To Slack` and `8.1 Security Label Private Handling` overlap around severity/security escalation policy and should clarify precedence when both match.

### Dubious or unimplementable entries

- `6.3 Orphaned Branch Cleaner` is underspecified. It needs branch enumeration, protection awareness, branch ownership heuristics, and safe-delete policy; the current gap summary only mentions a branch-delete output, which is not enough.
- `7.2 Performance Regression Alert` needs more than “artifact/metric read.” It needs benchmark source normalization, baseline selection, threshold semantics, and storage for historical comparisons.
- `8.1 Security Label Private Handling` is risky as written. By the time a public issue gets a `security` label, the sensitive report may already be public. A real solution likely needs private vulnerability reporting / advisory primitives, not only “skip public comment.”
- `1.3 Duplicate Detector` is plausible, but the suggested implementation route (“triage prompt over prior issues”) is too fuzzy for deterministic automation unless the catalog explicitly adds a duplicate-search primitive and confidence thresholding rules.

## PART 3 — GitHub Projects integration review

Checked against GitHub's current official docs on April 17, 2026: Projects v2 webhooks, GraphQL mutations/objects, and built-in project automation docs.

### Projects v2 features the doc does not address

- `docs/github-projects-integration.md:84-99` assumes polling-only ingest, but GitHub already documents `projects_v2`, `projects_v2_item`, and `projects_v2_status_update` webhooks. The doc should explain whether Support Agent intentionally prefers polling anyway, or add webhook mode as the default for hosted installs.
- `docs/github-projects-integration.md:117-135` misses item archiving and unarchiving. Current GraphQL mutations include `archiveProjectV2Item` and `unarchiveProjectV2Item`, which are different from deleting/removing an item.
- The writeback set omits item ordering. Current GraphQL exposes `updateProjectV2ItemPosition`, so priority/order-aware automations are possible.
- The doc does not address project status updates at all. Current GraphQL exposes `ProjectV2StatusUpdate` plus `updateProjectV2StatusUpdate` / delete support, and GitHub's product docs expose project-level status updates with start/target dates.
- Built-in GitHub automations are missing from the model. GitHub now supports built-in auto-add and auto-archive workflows, plus default status workflows. Support Agent needs a coexistence story so it does not fight those automations.
- The doc does not mention linked branches. Current GraphQL exposes `Issue.linkedBranches` plus `createLinkedBranch` / `deleteLinkedBranch`, which matters if project items drive issue implementation.
- Sub-issues / tracked work are absent. Current GraphQL exposes issue hierarchy and rollups (`subIssuesSummary`, `trackedInIssues`, plus sub-issue events/webhooks), and project planning often depends on that hierarchy.
- Required reviewers / reviewer fields are not addressed. Current GraphQL includes reviewer-related project item field values, and PR workflows increasingly depend on review-request state.
- The “roadmap field” needs correction: GitHub's roadmap is a view/layout concern, not one of the field types listed in the doc. If roadmap support matters, it belongs in a “views/layouts” section, not `fieldMap`.
- There is no distinct “text+emoji” field type in the current schema; text is still `TEXT`. If the intent is “text fields can contain emoji,” the doc should say that explicitly instead of implying a separate type.

### Field types and mappings we still do not cover cleanly

- `ITERATION` is mentioned, but the doc treats it as just another stringly `fieldMap` entry. It should call out that iteration writes require the iteration id, not the displayed label, and that active/completed iteration semantics matter.
- The doc only maps `status`, `priority`, `iteration`, and `estimate`. Current GraphQL object types also expose field values for `Reviewer`, `User`, `Label`, `Repository`, `PullRequest`, and `Milestone`, and those matter for real boards.
- The doc should distinguish read coverage from write coverage. GitHub's own Projects API docs say `updateProjectV2ItemFieldValue` only supports single-select, text, number, date, and iteration. Labels, assignees, milestone, and repository are updated through the underlying issue/PR mutations instead.
- `TRACKED_BY` / `TRACKS` and the newer sub-issue rollups are not modeled at all. Even if these are not project field types, they are planning data that should be available in scenario conditions and writeback decisions.

### Inconsistencies with the current schema/docs

- `docs/github-projects-integration.md:16-20` says Projects v2 is “API-only via GraphQL,” which is incomplete. Data mutation/query is GraphQL, but GitHub also documents Projects v2 webhook events and built-in project workflows.
- `docs/github-projects-integration.md:19` limits custom fields to `SINGLE_SELECT`, `NUMBER`, `DATE`, `TEXT`, and `ITERATION`. That is not a complete read model for current GraphQL objects.
- `docs/github-projects-integration.md:86-99` frames project ingest as “poll the project for items updated since the last poll,” but the same doc later proposes event kinds that line up much more naturally with webhooks than with synthetic polling deltas.
- `docs/github-projects-integration.md:123-124` uses `add` / `remove`, but the official API surface distinguishes adding, deleting, archiving, and unarchiving. Those should not be collapsed.

### UX take: “Projects inside the GitHub connector as a second tab”

Yes, that decision is defensible from a platform-UX perspective. Projects and repositories usually share auth, and making operators install a second “GitHub Projects” connector would add friction without adding much clarity. The catch is that the implementation must not stay repo-centric under the hood: Projects are org/user-owned, cross-repo, and increasingly automation-rich in their own right. So “second tab” is a good setup surface, but only if the backing model treats projects as first-class objects rather than a repo-side add-on.

### Are `set_status`, `set_field`, `add`, `remove` the right writebacks?

They are a useful base, but they are not enough.

Missing writebacks that should be first-class:

- `archive_item`
- `unarchive_item`
- `delete_item` if `remove` is meant to be non-destructive
- `set_item_position`
- `convert_draft_to_issue`
- `create_status_update`
- `update_status_update`
- `delete_status_update`
- `link_branch`
- `unlink_branch`

Also worth adding as condition/input support, even if not direct writebacks:

- reviewer-field / required-reviewer awareness
- sub-issue / tracked-by hierarchy access
- built-in automation coexistence flags so Support Agent can avoid redundant or conflicting writebacks
