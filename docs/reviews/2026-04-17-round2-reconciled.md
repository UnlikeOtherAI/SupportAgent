---
title: Round-2 review reconciliation (Codex + Opus)
date: 2026-04-17
inputs:
  - /tmp/codex-review-round2.md
  - /tmp/opus-review-round2.md
---

# Round-2 reconciliation

Two parallel reviewers (Codex and Opus, both round-2) read the same scope:
the five fix commits `48dfff3..5afb97a` plus `docs/scenario-catalog.md` and
`docs/github-projects-integration.md`. This file collapses agreement and
records the verdict on disagreements after I verified each.

## Agreed: high-priority bugs (must fix)

1. **`Date.now()` fallback in labeled-event dedupe defeats dedupe entirely
   when `updatedAt` is missing.** `apps/api/src/services/polling-event-service.ts:88`
   plus `apps/api/src/routes/polling.ts:25,45` (zod marks `updatedAt` optional).
   Either require `updatedAt` at the schema or use a stable identity instead
   of clock-time.

2. **PR-comment matcher semantics drift from admin UI.**
   `packages/contracts/src/trigger-matchers.ts:29,35` does substring keyword
   match + case-insensitive *author* equality. The admin description at
   `apps/admin/src/features/workflow-designer/workflow-designer-config-schemas.ts:38-48`
   says the keyword is an "exact token" and `botName` "restricts to comments
   mentioning @botName". Runtime must match UI: token-boundary keyword + true
   mention detection (search for `@botName` in the body).

3. **`triggerContext` is dead data — no consumer.** Opus verified by grep:
   zero references to `triggerContext`/`TriggerContext`/`TriggerComment` in
   `apps/worker/`. `apps/worker/src/handlers/pr-review-handler.ts` only reads
   `prNumber`/`prRef`. The dispatcher writes the field; the worker ignores it.
   Fix: have the review handler quote the requesting comment and surface its
   author/body to the prompt.

## Agreed: lower-priority bugs

4. **Graph still flattened by step-order, not edges.**
   `apps/api/src/services/dispatcher-service.ts:51-59` and
   `apps/api/src/services/scenario-matcher.ts:88-129` ignore `outgoingNodeIds`.
   Non-linear designer graphs silently linearise. (Architectural — defer.)

5. **Auto-merge chain is unconditional in `workflow-chain-service.ts:123-135`
   despite catalog promising explicit per-scenario opt-in (`5.3`).** Behaviour
   gap, not a regression — defer to a focused PR.

## Disputed — verdicts after verification

6. **Indented fences in the triage parser.** Codex says partially fixed
   (CommonMark allows up to 3 leading spaces; opener regex is anchored at
   column 0). Opus says fully fixed.
   **Verdict: Codex correct.** Fix the opener and closer regexes to allow
   `^ {0,3}` and add a regression test.

7. **Severity-label drift.** Codex says fully fixed. Opus flags three
   leftover `complexity` references.
   **Verdict: Opus correct, verified by grep:**
   - `apps/admin/src/features/workflow-designer/workflow-designer-config-schemas.ts:105`
   - `apps/admin/src/features/workflow-designer/workflow-designer-options.ts:128`
   - `docs/automation-composition.md:839`

## Agreed: catalog + Projects doc gaps (defer)

Both reviewers list the same large-but-discrete documentation gaps. Filed as a
single follow-up rather than this round:

- Missing GitHub event coverage in `scenario-catalog.md`: `pull_request_review`,
  `pull_request_review_comment`, `pull_request_review_thread`, `workflow_run`,
  `check_run`, `merge_group`, `deployment*`, `discussion*`, `dependabot_alert`,
  `code_scanning_alert`, `secret_scanning_alert`, `projects_v2*`, `milestone`,
  `release`, `gollum`, `issue_comment`, `branch_protection_rule`,
  `repository_ruleset`. Plus the closed-issue-comment primitive needed by `3.3`.
- `docs/github-projects-integration.md` should: (a) name real GraphQL mutations
  (`updateProjectV2ItemFieldValue`, `addProjectV2ItemById`,
  `addProjectV2DraftIssue`, `archiveProjectV2Item`, `deleteProjectV2Item`,
  `convertProjectV2DraftIssueItemToIssue`, `unarchiveProjectV2Item`); (b) add a
  webhook ingest mode (events `projects_v2`, `projects_v2_item`,
  `projects_v2_status_update` are live); (c) store stable field/option/iteration
  IDs, not display names; (d) model item membership as a join (one issue can
  belong to many projects); (e) split `add`/`remove` into `add_existing_item`,
  `create_draft`, `archive`, `unarchive`, `delete`; (f) per-auth-mode scope
  guidance for local-`gh` vs GitHub App vs user token; (g) coexistence story
  for built-in project automations.

## This round's fix plan

Four parallel Sonnet sub-agents, non-overlapping file ownership:

- **Agent A — dedupe + indented fences**
  - `apps/api/src/services/polling-event-service.ts`
  - `apps/api/src/routes/polling.ts`
  - `apps/api/src/services/polling-event-service.test.ts`
  - `apps/worker/src/lib/triage-discovery-comment.ts`
  - `apps/worker/src/lib/triage-discovery-comment.test.ts`

- **Agent B — matcher semantics**
  - `packages/contracts/src/trigger-matchers.ts`
  - `apps/worker/src/lib/trigger-matchers.test.ts`
  - new `packages/contracts/src/trigger-matchers.test.ts`

- **Agent C — triggerContext consumer**
  - `apps/worker/src/handlers/pr-review-handler.ts`
  - `apps/api/src/services/dispatcher-service.ts` (just the silent-fail log)

- **Agent D — build-handler cleanup + admin/doc complexity drift**
  - `apps/worker/src/handlers/build-handler.ts`
  - `apps/admin/src/features/workflow-designer/workflow-designer-config-schemas.ts`
  - `apps/admin/src/features/workflow-designer/workflow-designer-options.ts`
  - `docs/automation-composition.md`

Deferred (separate PRs):
- Graph edge traversal in scenario compiler + dispatcher
- `workflow-chain-service.ts` auto-merge gating per scenario
- Catalog event coverage expansion
- Projects doc rewrite to GraphQL-mutation precision
