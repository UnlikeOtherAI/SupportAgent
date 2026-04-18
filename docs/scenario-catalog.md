# Scenario Catalog

A menu of workflow scenarios that any development team should be able to enable, disable, and parameterize through the Workflow Designer — with no bespoke code per team. Each entry lists the trigger, executor, outputs, config knobs, and current buildability status.

> Architectural model lives in [workflow-scenarios.md](./workflow-scenarios.md). The skill-driven runner that powers the loop / multi-executor scenarios in §11–§14 is specified in [docs/plans/2026-04-17-skills-and-executors.md](./plans/2026-04-17-skills-and-executors.md). This file is the library of concrete, shippable scenarios built on those primitives.

## Primitives Today

**Triggers** (`docs/workflow-designer/` palette):

- `github.issue.opened`
- `github.issue.labeled` — `labelName`
- `github.pull_request.opened`
- `github.pull_request.comment` — `keyword`
- `schedule.interval` — `intervalMinutes` *(declared; executor not yet wired)*

**Actions:**

- `workflow.triage` — runs the `max` agent in a repo clone, emits 9-section report
- `workflow.build` — runs Codex, opens a PR (`issueLinkMode: fixes | mentions`)
- `workflow.review` — runs review agent on an open PR
- `approval.request` — pauses for operator approval
- `agent.respond` — drafts a reply without a workflow run

**Outputs:**

- `github.issue.comment` — `template: findings | pr_link | custom`
- `github.pr.comment` — `template: review | custom`
- `github.issue.label` — `labels: csv`
- `linear.issue.create`
- `slack.notify`

**Gaps called out per scenario:** scheduled execution, dynamic label derivation from action output, semantic duplicate search, CODEOWNERS lookup, CI-signal trigger.

---

## 1. Issue Intake & Classification

### 1.1 Needs-Triage Watchdog
Auto-apply `needs-triage` to any issue that has been sitting with no triage label.

- **Trigger:** `schedule.interval` (e.g. every 60m)
- **Action:** `agent.respond` (lightweight label decision) or no action, just output
- **Outputs:** `github.issue.label` — `labels: needs-triage`
- **Knobs:** `ageMinutes` (default 1440), `skipIfLabels` (csv), `targetLabel`
- **Status:** 🔧 needs scheduled-executor wiring

### 1.2 Auto-Labeler (Component / Kind / Priority)
Derive labels from issue body on open. Runs triage to classify, applies structured labels.

- **Trigger:** `github.issue.opened`
- **Action:** `workflow.triage` with classification prompt profile
- **Outputs:** `github.issue.label` with `labels: "{component},{kind},{priority}"` placeholders
- **Knobs:** allowed components (csv), allowed kinds, priority scale, label prefix
- **Status:** 🔧 needs dynamic label output (handler must read classification from findings, not hardcode `triaged`+`severity-*`)

### 1.3 Duplicate Detector
On issue open, search existing open issues for likely duplicates and post links.

- **Trigger:** `github.issue.opened`
- **Action:** `workflow.triage` with "find similar open issues" prompt
- **Outputs:** `github.issue.comment` (template `duplicates`) + optional `github.issue.label` if confidence ≥ threshold
- **Knobs:** `confidenceThreshold`, `maxCandidates`, `duplicateLabel`
- **Status:** 🔧 triage action needs access to list of prior issues (fetch titles/bodies and inject into prompt)

### 1.4 Needs-Info Reminder
If issue opened without repro steps / version / logs, post a template comment and apply `needs-info`.

- **Trigger:** `github.issue.opened`
- **Action:** `agent.respond`
- **Outputs:** `github.issue.comment` (template `needs_info`) + `github.issue.label` (`needs-info`)
- **Knobs:** required sections (csv), grace period, auto-close after days
- **Status:** 🔧 `agent.respond` handler not yet implemented

### 1.5 Question Redirect
Classify whether the issue is a question, not a bug. If so, comment with link to Discussions tab, apply `question`, optionally close.

- **Trigger:** `github.issue.opened`
- **Action:** `workflow.triage` with classification prompt
- **Outputs:** `github.issue.comment` (template `question_redirect`) + `github.issue.label` (`question`) + optional close action
- **Knobs:** `discussionsUrl`, `closeOnMatch` (bool)
- **Status:** 🔧 needs close-issue output primitive + classification-driven branching

### 1.6 Issue-Template Enforcer
If body doesn't include required headings, comment asking for them and apply `invalid-template`.

- **Trigger:** `github.issue.opened`
- **Action:** (none — regex check in scenario matcher)
- **Outputs:** `github.issue.comment` + `github.issue.label` (`invalid-template`)
- **Knobs:** required headings (csv), template doc url
- **Status:** 🔧 needs conditional matcher based on body content

### 1.7 First-Time Contributor Welcomer
Friendly comment when an issue is opened by an author with no prior activity in the repo.

- **Trigger:** `github.issue.opened` with author-history condition
- **Action:** `agent.respond`
- **Outputs:** `github.issue.comment` (template `welcome`) + optional `good-first-look` label
- **Knobs:** welcome text, add-label (bool)
- **Status:** 🔧 needs author-history lookup in matcher

---

## 2. Issue Triage (Existing Scenario 1)

### 2.1 Label-Driven Triage ✅
*Already shipped.* Label `needs-triage` → triage run → 9-section comment + `triaged` + `severity-*` labels.

- **Trigger:** `github.issue.labeled` (`needs-triage`)
- **Action:** `workflow.triage`
- **Outputs:** `github.issue.comment` (findings) + `github.issue.label`
- **Knobs:** trigger label name, severity label prefix
- **Status:** ✅ ready — tested on `rafiki270/max-test#51`

### 2.2 Project-Field-Driven Triage
Same behavior as 2.1 but triggered by a GitHub Projects v2 item's custom-field value (e.g. `Status: Needs Triage`) instead of an issue label. Item may be an `ISSUE`, `PULL_REQUEST`, or `DRAFT_ISSUE`. Supports the pattern where a team's source of truth is a Project board, not the issue list.

- **Trigger:** `github.project_v2_item.field_changed` — `fieldName: Status`, `fieldValue: Needs Triage` (configurable)
- **Action:** `workflow.triage`
  - Draft items: run triage against the draft body + title only (no repo clone, no code context).
  - Issue/PR items: resolve to the underlying issue/PR and run the normal triage flow.
- **Outputs:**
  - `github.issue.comment` (findings) — only when the item resolves to a real issue/PR
  - `github_projects.item.update` — set `Status: Triaged`, populate `Severity` single-select from findings
  - Optional `github.issue.label` when the item resolves to an issue
- **Knobs:** project owner+number, trigger field name, trigger value, output-status value, severity-field name
- **Status:** 🔧 needs `github_projects` connector (GraphQL + `projects_v2_item` webhook), draft-item triage path

### 2.3 Project-Field-Driven Build
A Project item transitions to `Status: Needs PR` (configurable). System runs a build against the linked issue and opens a PR that says `Fixes #N`. On PR open, the Project item auto-moves to `Status: In Review` (GitHub's native Projects PR automation) or the connector sets it explicitly.

- **Trigger:** `github.project_v2_item.field_changed` — `fieldName: Status`, `fieldValue: Needs PR`
- **Action:** `workflow.build` (`issueLinkMode: fixes`)
- **Outputs:**
  - PR opened via normal build flow
  - `github_projects.item.update` — set `Status: In Review`, set `PR` field to the new PR url (if `URL` custom field configured)
  - `github.issue.comment` on the linked issue with PR link
- **Knobs:** project owner+number, trigger field/value, in-review status value, PR-link field name
- **Status:** 🔧 needs `github_projects` connector + draft-item-to-issue resolution + skip-if-no-linked-issue guard

---

## 3. Issue Lifecycle Hygiene

### 3.1 Stale Issue Closer
Warn, then close, issues with no activity for N days.

- **Trigger:** `schedule.interval` (e.g. daily)
- **Action:** (none)
- **Outputs:** two-stage — `github.issue.comment` (template `stale_warning`) + `github.issue.label` (`stale`) at day N; close at day N+grace
- **Knobs:** `warnAfterDays` (30), `closeAfterDays` (37), `exemptLabels` (csv: `pinned,security,p0`)
- **Status:** 🔧 needs scheduled executor + close output + multi-phase step

### 3.2 Stale PR Nudger
Same shape as 3.1 but pings the PR author instead of closing.

- **Trigger:** `schedule.interval`
- **Outputs:** `github.pr.comment` (template `stale_nudge`)
- **Knobs:** `nudgeAfterDays`, `repeatEvery`, `exemptLabels`
- **Status:** 🔧 needs scheduled executor

### 3.3 Reopen On Regression
Closed issue receives a comment with new evidence → auto-reopen + `regression` label.

- **Trigger:** `github.issue.closed_comment` *(new trigger)*
- **Action:** `agent.respond` (classifies whether comment indicates regression)
- **Outputs:** reopen + `github.issue.label` (`regression`)
- **Status:** 🔧 needs new trigger + reopen output

---

## 4. PR Intake & Review (Scenarios 2 & 3 + more)

### 4.1 Label-Driven PR Build ✅
*Already shipped.* Label `needs-pr` on issue → build run → PR with `Fixes #N`.

- **Status:** ✅ ready — tested on `rafiki270/max-test#53` → PR #54

### 4.2 PR Review On Command ✅
*Already shipped.* Comment `/sa review` on PR → review run → PR comment.

- **Status:** ✅ ready — tested on `rafiki270/max-test#55`

### 4.3 Auto-Review On PR Open
Run review automatically for every new PR (no command).

- **Trigger:** `github.pull_request.opened`
- **Action:** `workflow.review`
- **Outputs:** `github.pr.comment`
- **Knobs:** `skipForAuthors` (csv, e.g. bots), `skipForLabels`
- **Status:** ✅ pure config — reuses review handler

### 4.4 PR Size Guard
Comment a warning on PRs over N lines / M files.

- **Trigger:** `github.pull_request.opened`
- **Outputs:** `github.pr.comment` (template `size_warning`) + `github.issue.label` (`large-pr`)
- **Knobs:** `maxLines` (500), `maxFiles` (20), `warnTemplate`
- **Status:** 🔧 needs diff-stat fetch in matcher

### 4.5 Missing Tests Guard
PR touches `src/` without touching a test directory → comment reminder + `needs-tests` label.

- **Trigger:** `github.pull_request.opened`
- **Outputs:** `github.pr.comment` + `github.issue.label`
- **Knobs:** `sourceGlobs` (csv), `testGlobs` (csv), `reminderTemplate`
- **Status:** 🔧 needs changed-files lookup in matcher

### 4.6 Draft-Too-Long Nudge
Draft PRs open for more than N days → nudge author.

- **Trigger:** `schedule.interval`
- **Outputs:** `github.pr.comment`
- **Knobs:** `maxDraftDays`, `pingEvery`
- **Status:** 🔧 needs scheduled executor + draft-state filter

### 4.7 CODEOWNERS Pinger
On PR open, read `CODEOWNERS` and `@mention` the right team/owners.

- **Trigger:** `github.pull_request.opened`
- **Outputs:** `github.pr.comment` with dynamic mentions
- **Knobs:** `codeownersPath`, `greetingTemplate`
- **Status:** 🔧 needs CODEOWNERS parser in matcher

### 4.8 Merge Conflict Notifier
Detect new merge conflicts on open PRs → comment once.

- **Trigger:** `schedule.interval` (scans open PRs)
- **Outputs:** `github.pr.comment` (idempotent per conflict-appearance)
- **Knobs:** `pollInterval`, `suppressRepeat`
- **Status:** 🔧 needs scheduled executor + `mergeable` field read

---

## 5. Chaining & Escalation

### 5.1 Triage → Auto-Build For High Severity
If triage returns severity `High`/`Critical` and confidence `High`, automatically dispatch a build run.

- **Trigger:** internal — `workflow_run.completed` with `workflowType: triage`
- **Action:** `workflow.build`
- **Outputs:** `github.issue.comment` with PR link
- **Knobs:** `minSeverity`, `minConfidence`, `dryRun` flag
- **Status:** 🔧 needs workflow-chain trigger (run-finished event)

### 5.2 Triage → Request Approval For Low Confidence
Triage returns `Low` confidence → post findings + request operator approval before any build.

- **Trigger:** internal — triage completed
- **Action:** `approval.request`
- **Knobs:** approver email / Slack channel
- **Status:** 🔧 approval action handler not yet wired

### 5.3 Build → Auto-Merge On Green CI
Build opens PR → wait for CI green → merge automatically.

- **Trigger:** internal — `pr.ci.green` plus `workflowType: build`
- **Action:** `workflow.merge`
- **Status:** Partially wired — merge runs already auto-chain in current code; should be gated behind this explicit scenario instead of implicit logic.

### 5.4 P0 Escalation To Slack
Issue triaged with `severity-critical` → post to Slack incidents channel + @channel.

- **Trigger:** `github.issue.labeled` (`severity-critical`)
- **Outputs:** `slack.notify`
- **Knobs:** channel, mention policy, message template
- **Status:** ✅ pure config — `slack.notify` output exists

### 5.5 Incident → Create Linear Ticket
Security/incident labels mirror to Linear.

- **Trigger:** `github.issue.labeled` (`incident` or `security`)
- **Outputs:** `linear.issue.create`
- **Knobs:** Linear team, project, priority mapping
- **Status:** ✅ pure config — `linear.issue.create` output exists

---

## 6. Scheduled Housekeeping

### 6.1 Weekly Digest
Weekly comment on a tracked "sprint" issue summarizing triaged / closed / open counts.

- **Trigger:** `schedule.interval` (weekly)
- **Action:** `agent.respond` (generates summary)
- **Outputs:** `github.issue.comment` to a configured tracker issue
- **Knobs:** `trackerIssueRef`, `timeWindow`, `includeMetrics`
- **Status:** 🔧 scheduled executor + issue-metrics lookup

### 6.2 Label Hygiene Normalizer
Rename deprecated labels to canonical names on any issue that carries them.

- **Trigger:** `schedule.interval`
- **Outputs:** `github.issue.label` (remove + add)
- **Knobs:** rename map `{from: to}`, dry-run
- **Status:** 🔧 needs label-remove output + scheduled executor

### 6.3 Orphaned Branch Cleaner
Branches with no PR and no commits in N days → warn, then delete.

- **Trigger:** `schedule.interval`
- **Outputs:** Slack notify + branch delete
- **Knobs:** `warnAfterDays`, `deleteAfterDays`, `protectedPrefixes`
- **Status:** 🔧 needs branch-delete output

---

## 7. Regression & Quality

### 7.1 Flaky Test Watcher
CI run reports intermittent failures for the same test across N retries → file an issue with `flaky-test` label.

- **Trigger:** `ci.workflow_run.completed` *(new trigger)*
- **Action:** `agent.respond` (groups occurrences)
- **Outputs:** GitHub issue create (new output) + `github.issue.label`
- **Status:** 🔧 new trigger + issue-create output

### 7.2 Performance Regression Alert
Benchmark artifact breaches threshold → open issue + Slack ping.

- **Trigger:** `ci.workflow_run.completed` + artifact check
- **Outputs:** issue create + slack notify
- **Status:** 🔧 requires artifact/metric read

---

## 8. Security & Compliance

### 8.1 Security Label Private Handling
Issues with `security` label → never post a public finding comment; instead notify a private Slack channel.

- **Trigger:** `github.issue.labeled` (`security`)
- **Action:** `workflow.triage` with `privateMode: true`
- **Outputs:** `slack.notify` only (no public issue comment)
- **Knobs:** Slack channel, severity escalation
- **Status:** 🔧 triage handler must conditionally skip public comment

### 8.2 Dependabot Fast-Path
Dependabot PRs → auto-review with security-focused prompt + if low risk, auto-merge.

- **Trigger:** `github.pull_request.opened` with `author: dependabot[bot]` filter
- **Action:** `workflow.review` (security profile) → optional `workflow.merge`
- **Knobs:** severity threshold for auto-merge, exempt packages
- **Status:** 🔧 needs author filter + review profile selection

---

## 9. Community & Contributor Experience

### 9.1 Thanks On First Merge
New contributor's first PR merged → post a thanks comment.

- **Trigger:** `github.pull_request.merged` *(new trigger)*
- **Outputs:** `github.pr.comment`
- **Status:** 🔧 needs merged-event trigger + author-history

### 9.2 CLA Lite
If PR author hasn't signed the CLA (tracked in a file/issue), comment asking them to.

- **Trigger:** `github.pull_request.opened`
- **Outputs:** `github.pr.comment` + `github.issue.label` (`cla-required`)
- **Knobs:** CLA ledger location
- **Status:** 🔧 needs CLA ledger lookup

---

## 10. Developer Assist (Manual)

### 10.1 Slash-Command Triage
Any developer can comment `/sa triage` on an issue → run triage ad hoc.

- **Trigger:** `github.issue.comment` with `keyword: /sa triage` *(new trigger kind)*
- **Action:** `workflow.triage`
- **Outputs:** findings comment
- **Status:** 🔧 add `github.issue.comment` trigger kind (symmetric to PR comment)

### 10.2 Slash-Command Re-Build
Comment `/sa rebuild` on an issue whose build failed → re-dispatch build with latest hints.

- **Trigger:** `github.issue.comment` with `keyword: /sa rebuild`
- **Action:** `workflow.build`
- **Status:** 🔧 needs issue-comment trigger + rebuild semantics

### 10.3 Slash-Command Summarize
Comment `/sa summarize` on a long issue → post a TL;DR.

- **Trigger:** `github.issue.comment` with keyword
- **Action:** `agent.respond`
- **Outputs:** `github.issue.comment`
- **Status:** 🔧 needs issue-comment trigger + agent.respond

---

## 11. Architecture & Scope Guards

These scenarios use the looping executor pattern from [docs/plans/2026-04-17-skills-and-executors.md](./plans/2026-04-17-skills-and-executors.md). The system skill defines the contract; one or more complementary skills carry the architecture rules. The loop runs until the consolidator declares `done: true` or `max_iterations` is hit.

### 11.1 Architecture Compliance Reviewer (looping)
On every PR, verify the change does not violate the documented architecture and does not introduce out-of-scope behaviour. Loop until either no above-threshold issues remain or the cap trips.

- **Trigger:** `github.pull_request.opened` or `github.pull_request.synchronize`
- **Executor:** `architecture-guard` (looping fan-out + consolidator)
  - Workers: `max -p` ×3, `claude -p` ×1, `codex exec` ×1
  - System skill: `architecture-reviewer` (defines the issue-list output schema with severities)
  - Complementary skills: `<project>-architecture`, `clean-api-design`, `<project>-conventions`
  - Consolidator system skill: `architecture-consolidator-and-fixer`
  - `loop.max_iterations: 2` (per the hallucination guidance — bigger numbers churn)
  - `loop.until_done: true`
- **Outputs (per the connector):**
  - `body` → one `github.pr.comment` summarising remaining issues, grouped by severity, with file:line citations.
  - `labels` → `architecture-clean` if `done: true` reached organically, `architecture-needs-attention` if `max_iterations` tripped.
  - `state_change: request_changes` when above-threshold issues remain at exit; `state_change: approve` only when `done: true` reached.
- **Knobs:** which complementary skills to attach; severity threshold the consolidator treats as "must fix" vs "noted"; maximum loop iterations.
- **Status:** 🔧 needs skills + executors runtime, looping, consolidator-and-fixer skill pattern.

### 11.2 Scope Creep Guard
PR introduces files or behaviour not implied by the linked issue. Comment with what looks out-of-scope and ask the author to split the PR or update the issue.

- **Trigger:** `github.pull_request.opened`
- **Executor:** `scope-guard` (single stage, single CLI)
  - System skill: `scope-reviewer` (output: list of suspect changes with file paths + the linked issue's stated scope)
  - Complementary skills: `<project>-architecture`
  - Inputs to the prompt: PR diff + linked issue body + the issue's prior comments
- **Outputs:** `github.pr.comment` (template `scope_creep` with bullet list of out-of-scope items) + `github.issue.label: scope-review`.
- **Knobs:** issue link source (`Fixes #N` parsing vs explicit `linked_issue` field), file globs to ignore (e.g. lockfiles, generated code).
- **Status:** 🔧 needs skills + executors runtime + comment-thread fetch.

### 11.3 Documentation Drift Watcher
PR changes code in `apps/api/src/` (or other documented areas) without touching the corresponding docs. Comment listing each undocumented change.

- **Trigger:** `github.pull_request.opened`
- **Executor:** `docs-drift` (single stage)
  - System skill: `docs-drift-reviewer`
  - Complementary skills: `<project>-architecture`, `<project>-doc-conventions`
- **Outputs:** `github.pr.comment` + `github.issue.label: docs-needed`.
- **Knobs:** code-glob ↔ doc-glob mapping (`src/services/* → docs/services/*`).
- **Status:** 🔧 needs skills + executors runtime + changed-files lookup.

### 11.4 Wiki Knowledge-Base Auto-Updater
PR merges new functionality. Scan wiki pages linked from the GitHub Project that owns the PR's tracking item, decide which pages are affected, and rewrite them as user-facing docs support teams can use as a knowledge base.

Concrete example: the repo has a wiki page _"How to run a click-through test"_. A PR lands that changes how click-through tests are invoked. Workflow launches, identifies the behavior delta from the diff + PR body, finds the wiki page via the GitHub Project item the PR is linked to, and commits an updated version of the page written for end-users (admins / support / operators) rather than developers.

- **Trigger:** `github.pull_request.merged` (also usable on `github.pull_request.opened` as a preview)
- **Executor:** `wiki-kb-writer` (single stage; loop variant when multiple pages need coordinated edits)
  - System skill: `wiki-kb-writer`
  - Complementary skills: `<project>-architecture`, `<project>-doc-conventions`, `<project>-audience-voice` (one per audience: admin / support / end-user)
- **Inputs:**
  - PR diff + body + linked issue(s) — via `github` connector
  - Project item the PR is linked to, plus any `docs`/`wiki`/`kb` custom-field values on that item — via `github_projects` connector
  - Wiki pages referenced from the Project item or from the linked issue — via `github_wiki` connector (git-backed `<repo>.wiki.git`)
- **Outputs:**
  - `github.wiki.update` — rewrite affected wiki pages as user-facing docs (new primitive, see gaps)
  - `github.pr.comment` — summary listing pages updated + one-line diff per page
  - `github_projects.item.update` — set a `Docs Updated` custom field on the linked Project item
- **Knobs:**
  - `audience`: `admin | support | end_user | developer` (picks complementary skill)
  - `pageSelection`: `project_linked | issue_linked | both` (how to discover candidate pages)
  - `draftMode`: `commit_directly | commit_to_branch_pr_wiki_repo` — wiki git repo has no PR mechanism, so review path is a separate normal repo PR containing the proposed wiki markdown
  - `commitTemplate`: message used when pushing to the wiki git repo
- **Status:** 🔧 needs `github_wiki` connector (git-backed CRUD), `github_projects` connector (custom-field read/write), `wiki-kb-writer` skill, new output primitive `github.wiki.update`.

---

## 12. Conversational Iteration (back-channel via comments)

A first-class category enabled by the skills+executors design: **PR/issue comments are how humans talk back to the system.** When a developer disagrees with a suggested change, they reply in the existing thread; the system reads the latest reply, re-runs the executor with the new direction baked into its prompt, and posts/pushes the revised result. No new UI; the comment thread is the conversation.

### 12.1 PR Re-Roll On Reviewer Disagreement
Reviewer comments on a PR opened by the system, e.g. _"@sa-bot no — don't pull this into a hook, do it inline."_ System reads the thread, re-runs the build executor with the original context **plus** the new direction, force-pushes to the same branch, and posts a follow-up comment summarising what changed.

- **Trigger:** `github.pull_request.comment` with `keyword: @sa-bot` or `mentions: <bot-name>` and the PR was opened by the bot.
- **Executor:** `pr-re-roll` (single stage)
  - System skill: `iterative-builder` (output schema includes `pr.commit_message`, `pr.body` for an updated PR description, and `body` for the follow-up comment)
  - Complementary skills: same as the original build (carried forward from the PR's first run)
  - Inputs to the prompt:
    - The original task prompt (the issue that produced the PR)
    - The full PR comment thread up to and including the triggering comment
    - The current PR diff
- **Outputs:**
  - `pr.branch` = same branch (force-push), `pr.commit_message` describing the revision
  - `body` posted as a follow-up PR comment: "Updated per @reviewer's note — moved logic inline, see commit `<sha>`."
- **Knobs:** required keyword/bot-mention pattern; whether to force-push or open a new commit; max number of re-rolls per PR before requiring human intervention (`max_re_rolls`, default 5).
- **Status:** 🔧 needs comment-thread fetch + same-branch push semantics + per-PR re-roll counter.

### 12.2 Triage Re-Run On New Information
Reporter or maintainer adds a comment to a triaged issue: _"@sa-bot also it only happens on Safari."_ System ingests the new comment, re-runs triage with the original report + every subsequent comment, and **edits its prior triage comment in place** rather than posting a new one (so the issue stays readable).

- **Trigger:** `github.issue.comment` with `keyword: @sa-bot` on an issue that already carries the `triaged` label.
- **Executor:** `triage-refresh` (single stage)
  - System skill: `triage-issue` (same skill the original triage used)
  - Inputs to the prompt: full issue body + every comment + the existing triage comment (so the model knows what it previously said)
- **Outputs:** `body` posted as an **edit** to the prior triage comment (connector identifies the comment by the `<!-- support-agent:triage-discovery -->` marker we already use).
- **Knobs:** strategy on edit vs new comment (`edit`, `new`, `edit-and-summarise-delta`).
- **Status:** 🔧 needs `github.issue.comment` trigger + comment-edit output + previous-comment lookup by marker.

### 12.3 Architecture Defence
Reviewer challenges an architecture decision: _"@sa-bot why did you choose factory pattern here over inheritance?"_ System re-reads the relevant code + complementary architecture skill, posts a citation-backed defence — or, if it agrees with the reviewer, opens a follow-up PR with the alternative.

- **Trigger:** `github.pull_request.comment` with bot mention + a question pattern (`why|why not|should we|prefer`)
- **Executor:** `architecture-defender`
  - System skill: `architecture-reviewer` (re-used from 11.1, so the model knows the same rules the original reviewer used)
  - Complementary skills: `<project>-architecture`, `<project>-conventions`
- **Outputs:**
  - If defending: `body` posted as a comment with file:line citations.
  - If conceding: `body` saying "you're right, opening a follow-up" + `pr` block with the revised approach.
- **Knobs:** `concede_threshold` (consolidator confidence below which it opens a follow-up PR instead of defending).
- **Status:** 🔧 needs skills + executors runtime + the `pr` output block.

---

## 13. Context-Aware Triggers (ingest the full thread)

Several scenarios above need the system to read more than just the triggering payload. This pattern needs first-class support in the trigger → prompt pipeline: when the trigger hint says `include_context: full_thread`, the connector fetches the issue body + every comment + linked PR/issue bodies before assembling the executor's `{{prompt}}`.

### 13.1 Build From Issue Discussion
`needs-pr` label is applied to an issue that has 30 comments of clarifying discussion. The build run must read **all of them**, not just the original issue body, before writing code.

- **Trigger:** `github.issue.labeled` with `labelName: needs-pr`
- **Executor:** `iterative-builder` (single stage; or 11.1's `architecture-guard` for stricter projects)
  - Inputs to the prompt: issue body + **every comment in the issue** + bodies of issues linked via `#NN` references in the discussion
- **Outputs:** standard `pr` block.
- **Knobs:** `include_context` = `body` | `body+comments` | `full_thread_with_links`; max comments to ingest (default 50).
- **Status:** 🔧 needs `include_context` knob on the build action + thread fetch in the connector.

### 13.2 PR Build From Review Synthesis
Reviewer summarises everything they want in a long PR comment thread. Triggering a re-build on that PR should ingest the entire thread, not just the latest comment.

- **Trigger:** `github.pull_request.comment` with bot mention
- **Executor:** `pr-re-roll` (12.1) but with `include_context: full_thread`
- **Status:** 🔧 same as 13.1.

### 13.3 Linked-Issue Awareness
PR mentions `Fixes #123, refs #124, refs #125`. Architecture review and scope guard should see all three issue bodies as context.

- **Trigger:** any PR-opened scenario that opts into linked-issue context
- **Knobs:** `follow_links` (bool), `max_linked_items` (default 5)
- **Status:** 🔧 needs `Fixes/refs/closes` parser in the connector + multi-issue fetch.

---

## 14. Multi-Executor & Loop Patterns (showcase scenarios)

Concrete recipes that exercise the executor YAML patterns from the skills+executors plan. Each one is something a real team would deploy.

### 14.1 Cross-LLM Independent Review (no joiner)
Codex and Claude each post their own PR review comment. Two opinions, no merge step — the human reviewer can compare.

- **Trigger:** `github.pull_request.opened`
- **Executor:** single stage with two parallel spawns; `system_skill: deep-reviewer`; no consolidator. Each spawn's output is delivered as its own PR comment per the multi-output delivery rule.
- **Knobs:** which two CLIs to use; whether each comment is prefixed with the model name.
- **Status:** 🔧 needs skills + executors runtime.

### 14.2 Cross-LLM Reviewed, Consolidated, Posted Once
Same setup as 14.1 but with a consolidator stage that produces a single agreed-on comment.

- **Trigger:** `github.pull_request.opened`
- **Executor:** Pattern 2 from the plan — workers (`max ×3`, `claude ×1`, `codex ×1`) → consolidator (`codex ×1`).
- **Outputs:** one PR comment (the consolidator's `body`).
- **Knobs:** which workers; which consolidator; consolidation prompt focus (`agree`, `most-critical-only`, `union`).
- **Status:** 🔧 needs skills + executors runtime.

### 14.3 Loop-Until-Architecturally-Clean
The flagship looping scenario. Workers find architecture violations, consolidator applies fixes, re-runs workers, loops until none above threshold. PR opened only when clean.

- **Trigger:** `github.issue.labeled` with `labelName: needs-pr` (so this runs on issue → PR builds)
- **Executor:** Pattern 4 (looping fan-out + consolidator) from the plan.
  - Workers: `max ×3`, `claude ×1`, `codex ×1`; system skill `architecture-reviewer`; complementary `<project>-architecture`.
  - Consolidator: `codex ×1`; system skill `consolidator-and-fixer` (this skill writes file changes between iterations).
  - `loop.max_iterations: 2` — `loop.until_done: true`.
- **Outputs:** `pr` block on the final consolidator output. Iteration history persisted on the workflow run for the convergence-timeline UI.
- **Knobs:** worker mix; severity threshold for `done: true`; iteration cap.
- **Status:** 🔧 needs skills + executors runtime + iteration persistence.

### 14.4 Two Executors Joined By An In-Platform LLM Call
A heavyweight reviewer (Codex) and a fast reviewer (Claude) run in parallel; an `inline_llm` Anthropic call merges their outputs into one comment. Cheaper than spawning a third CLI.

- **Trigger:** `github.pull_request.opened`
- **Executor:** Pattern 3 — `reviewers` stage with two `executor:` spawns, `merge` stage with one `inline_llm` spawn.
- **Outputs:** one PR comment.
- **Knobs:** Anthropic model to use for the merge.
- **Status:** 🔧 needs `executor:` and `inline_llm:` spawn types.

### 14.5 Architecture Drift Patrol (scheduled loop)
Once a week, run the architecture reviewer over the whole codebase (not a PR). For each above-threshold finding, file an issue with `architecture-debt` and the reviewer's suggested fix. No looping (each scan is a single pass), but uses the same skills as 11.1.

- **Trigger:** `schedule.interval` (e.g. `7d`)
- **Executor:** `architecture-patrol` (single-stage cross-LLM review of the full repo, no consolidator — outputs grouped by file)
- **Outputs:** one issue created per finding (new output: `github.issue.create`) + `github.issue.label: architecture-debt`.
- **Knobs:** scan scope globs; severity threshold for filing; dedupe against existing open issues with the same title.
- **Status:** 🔧 needs scheduled executor + `github.issue.create` output + dedupe matcher.

---

## Primitive Gap Summary

What we'd need to ship the full catalog. Ordered by leverage (most scenarios unblocked first):

| # | Primitive | Unblocks |
|---|-----------|----------|
| 1 | **Scheduled executor** (runs scenarios whose trigger is `schedule.interval` against a tick loop) | 1.1, 3.1, 3.2, 4.6, 4.8, 6.1, 6.2, 6.3 |
| 2 | **Dynamic labels from action output** (triage/classification feeds `github.issue.label` instead of hardcoded labels) | 1.2, 1.3, 1.5 |
| 3 | **New trigger: `github.issue.comment` with keyword** (symmetric to PR comment) | 10.1, 10.2, 10.3, 3.3 |
| 4 | **New output: close/reopen/lock issue** | 1.5, 3.1, 3.3 |
| 5 | **New output: create issue / create PR comment with mentions** | 7.1, 7.2, 4.7 |
| 6 | **Matcher conditions** (body regex, author filter, changed-files glob, mergeable state) | 1.6, 1.7, 4.4, 4.5, 8.2 |
| 7 | **CODEOWNERS lookup helper** | 4.7 |
| 8 | **Workflow chain trigger** (fire scenario on `workflow_run.completed`) | 5.1, 5.2 |
| 9 | **CI-signal trigger** (`ci.workflow_run.completed` + artifact access) | 7.1, 7.2, 5.3 |
| 10 | **PR-merged trigger** + author history | 9.1 |
| 11 | **`agent.respond` action handler** (lightweight, no repo clone) | 1.4, 6.1, 10.3, 9.1 |
| 12 | **`approval.request` action handler** | 5.2 |
| 13 | **Skills + executors runtime** (one `handleSkillJob`, executor YAML loader, prompt composer, stage scheduler) per [plans/2026-04-17-skills-and-executors.md](./plans/2026-04-17-skills-and-executors.md) | 11.1, 11.2, 11.3, 12.1, 12.2, 12.3, 14.1, 14.2 |
| 14 | **Loop wrapper** (iterate stages until consolidator's `done: true` or `max_iterations`; persist iteration state) | 11.1, 14.3 |
| 15 | **`executor:` and `inline_llm:` spawn types** (recursive executor invocation; direct platform-side LLM API call without subprocess) | 14.4 |
| 16 | **`pr` output block + deterministic connector PR mechanics** (skill modifies workdir, connector branches/commits/pushes/opens PR with bot identity + Co-Authored-By trailer) | 11.x re-rolls, 12.1, 12.3 |
| 17 | **Multi-output delivery** (every leaf-stage output → one comment when no consolidator absorbs it) | 14.1 |
| 18 | **`include_context` knob** on actions (fetches issue body + every comment + bodies of `Fixes/refs` linked items into the executor prompt) | 12.1, 12.2, 13.1, 13.2, 13.3 |
| 19 | **Comment-edit output** (edit a prior comment in place, identified by hidden HTML marker) | 12.2 |
| 20 | **Same-branch force-push semantics** in the connector + per-PR re-roll counter | 12.1 |
| 21 | **Bot-mention trigger pattern** (`mentions: <bot-name>` predicate on comment triggers; complements the existing `keyword:` pattern) | 12.1, 12.2, 12.3 |

Shipping #1 and #2 alone unlocks at least 10 scenarios in this catalog. Shipping #13–#16 unlocks the entire skill-driven half (§11–§14).

---

## How To Add A New Scenario

1. Open the Workflow Designer in the admin UI.
2. Drag the trigger, executor, and output tiles from the palette.
3. Configure each node's knobs in the inspector (label names, thresholds, channels).
4. Save. The matcher will compile the scenario; next poll tick dispatches the first run.
5. If a scenario needs a primitive listed in the gap table above, file an issue referencing the table row before wiring it.

Keep scenarios small. Prefer many single-purpose scenarios to one omnibus scenario. Chaining is done with internal `workflow_run.completed` triggers, not by stuffing logic into a single scenario.
