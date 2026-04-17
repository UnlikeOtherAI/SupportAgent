# Designer-Driven GitHub Workflows

Date: 2026-04-17
Scope: make the Workflow Designer and Apps UI the source of truth for three GitHub end-to-end scenarios against `rafiki270/max-test`, removing the hardcoded triage polling path.

## Target scenarios

All configured by the operator inside the Workflow Designer and Apps UI. No hardcoded scenario logic.

1. **GitHub Issue Triage**
   - Trigger options (operator picks one):
     - `GitHub issue opened`
     - `GitHub issue labeled` with configurable label (e.g. `needs-triage`)
   - Action: `Run triage`
   - Output: `GitHub issue comment` with findings (problem, reproduction steps, suggested fix) + `Apply label` (`triaged`, severity).
2. **Issue To Pull Request**
   - Trigger: `GitHub issue labeled` with configurable label (e.g. `needs-pr`).
   - Action: `Build PR candidate`.
   - Output: PR opened with body `Fixes #N` + `GitHub issue comment` with PR link.
3. **PR Review On Command**
   - Trigger: `GitHub PR comment matches keyword` with configurable keyword (e.g. `/sa review`) and configurable bot name.
   - Action: `Review PR` (new worker handler).
   - Output: `GitHub PR comment` with review findings.

## Build order

### Phase A — Foundation

- [x] A.1 Stack running (API 4441, admin 4440) + `gh` auth verified
- [x] A.2 DB wiped of prior connectors, scenarios, mappings, runs
- [ ] A.3 Designer inspector: add config fields per palette node
  - `github.issue.labeled` trigger: `labelName` text field
  - `github.pull_request.comment` trigger (new): `keyword` + `botName` text fields
  - `workflow.build` action: `issueLinkMode = fixes|mentions`
  - `github.issue.comment` output: `template` options (findings|pr_link|review)
- [ ] A.4 Persist designer config into `workflow_scenario_steps.config` (already JSON) and expose via `GET /v1/scenarios`
- [ ] A.5 New API endpoint: `GET /v1/scenarios/matchable` returning compiled `{scenarioId, triggerKind, triggerConfig, actionKind, outputs[]}` tuples for the matcher
- [ ] A.6 Scenario matcher service (api/src/services/scenario-matcher.ts): given an inbound event, find enabled scenarios with matching trigger+config
- [ ] A.7 Runtime polling rewrite: cron polls emit events (not direct triage enqueue). Event kinds: `issue.opened`, `issue.labeled`, `pr.opened`, `pr.comment_posted`. Matcher decides what runs get queued.

### Phase B — GitHub Issue Triage scenario working end-to-end via designer

- [ ] B.1 Apps UI: install GitHub connector for `rafiki270/max-test` via local `gh` auth
- [ ] B.2 Workflow Designer: create "GitHub Issue Triage" scenario with trigger=issue_opened → action=triage → output=issue_comment
- [ ] B.3 Verify: create new issue in max-test → run created → finding comment posted
- [ ] B.4 Playwright clickthrough: Apps → Workflows → Runs → finding

### Phase C — Issue To Pull Request scenario

- [ ] C.1 Add label-polling to cron (watch for `needs-pr` on open issues)
- [ ] C.2 Build handler PR body: `Fixes #N` when issueNumber is present in providerHints
- [ ] C.3 Output adapter: post issue comment with PR link after PR opens
- [ ] C.4 Workflow Designer: create "Issue To Pull Request" scenario with trigger=issue_labeled(needs-pr) → action=build → outputs
- [ ] C.5 Verify end-to-end: label the test issue, watch run, confirm PR + comment
- [ ] C.6 Playwright clickthrough

### Phase D — PR Review On Command scenario

- [ ] D.1 Extend polling to list open PRs and their recent comments, emit `pr.comment_posted` events with dedupe
- [ ] D.2 New worker handler: `pr-review-handler.ts` — clone repo, `git fetch pr/N`, checkout PR branch, read diff, run review prompt, submit report
- [ ] D.3 Output: `github.pr.comment` adapter
- [ ] D.4 Workflow Designer: create "PR Review On Command" scenario with trigger=pr_comment_keyword(/sa review, supportagent) → action=review → output=pr_comment
- [ ] D.5 Verify end-to-end: open a PR in max-test, comment `/sa review`, observe review posted
- [ ] D.6 Playwright clickthrough

### Phase E — Cleanup

- [ ] E.1 Remove hardcoded `seed-max-loop.ts` DB setup from workflow (keep only the GitHub repo bootstrap bits; UI does the DB side)
- [ ] E.2 Update `docs/brief.md` and `docs/techstack.md` to note designer-driven execution
- [ ] E.3 Remove the legacy polling-triage hardcoded trigger path

## Naming choices

- Scenarios (displayed in UI):
  - `GitHub Issue Triage`
  - `Issue To Pull Request`
  - `PR Review On Command`
- Default label names (user-overridable in designer):
  - Triage-on-label: `needs-triage`
  - Build-on-label: `needs-pr`
- Default PR review command keyword: `/sa review` (user-overridable)
- Default bot name: `SupportAgent`

## Target triage output format

The findings comment posted by scenario 1 must match the structure in [triage-output-example.md](./triage-output-example.md): Summary, Root Cause, Replication Steps, Suggested Fix, Severity, Confidence, Affected Files, Logs Excerpt, Sources. The build-time prompt for the triage worker should be updated to require those sections.

## Non-goals

- Webhook intake (polling via local `gh` is enough for this test).
- Non-GitHub connectors.
- Automatic merge.
