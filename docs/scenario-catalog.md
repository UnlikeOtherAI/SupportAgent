# Scenario Catalog

A menu of workflow scenarios that any development team should be able to enable, disable, and parameterize through the Workflow Designer — with no bespoke code per team. Each entry lists the trigger, executor, outputs, config knobs, and current buildability status.

> Architectural model lives in [workflow-scenarios.md](./workflow-scenarios.md). This file is the library of concrete, shippable scenarios built on those primitives.

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

Shipping #1 and #2 alone unlocks at least 10 scenarios in this catalog.

---

## How To Add A New Scenario

1. Open the Workflow Designer in the admin UI.
2. Drag the trigger, executor, and output tiles from the palette.
3. Configure each node's knobs in the inspector (label names, thresholds, channels).
4. Save. The matcher will compile the scenario; next poll tick dispatches the first run.
5. If a scenario needs a primitive listed in the gap table above, file an issue referencing the table row before wiring it.

Keep scenarios small. Prefer many single-purpose scenarios to one omnibus scenario. Chaining is done with internal `workflow_run.completed` triggers, not by stuffing logic into a single scenario.
