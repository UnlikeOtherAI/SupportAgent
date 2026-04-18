# Skills + Executors Implementation — Post-Implementation Review Triage

Date: 2026-04-18
Inputs: independent reviews by Codex, Claude (Explore subagent), and Max against commits `a053b9e`..`f67ad5b` on `main`.
Plan reviewed against: [docs/plans/2026-04-17-skills-and-executors.md](./2026-04-17-skills-and-executors.md).

This document consolidates the findings into a single ranked fix list. Items are de-duplicated; each item credits which reviewers raised it.

## P0 — Runner is fundamentally broken

These mean a customer dispatching a real run today will get incorrect or absent behavior.

### P0.1 Skill handler does not wire scenario task prompt or trigger context
**Source:** Codex Critical #1, #2.
**Files:** `apps/worker/src/handlers/skill-handler.ts:79-177`, `apps/api/src/services/dispatcher-service.ts:321-326`.
**What's wrong:**
- The handler runs every stage in a fresh `mkdtemp` directory, never checks out `targetRepo`.
- It feeds the executor YAML's baked `task_prompt` to the model verbatim — placeholders like `{{trigger.issue.url}}` and `{{trigger.pull_request.url}}` are never substituted.
- The dispatcher persists scenario action config in `providerHints.actionConfig`, but the handler ignores it. The Phase D admin UI for executor + task prompt thus has zero runtime effect.
**Fix:** read `providerHints.actionConfig.taskPrompt` (override) and the trigger/run context, substitute `{{trigger.*}}` and `{{run.*}}` placeholders into the prompt before calling `composePrompt`. Decide whether the runner needs a repo checkout (most likely yes for build/PR-review executors).

### P0.2 Findings-based skills cannot deliver
**Source:** Codex Critical #3.
**Files:** `apps/api/src/services/worker-api-service.ts:188-209`, `packages/skills/builtin/triage-issue/SKILL.md:41-65`.
**What's wrong:** the triage skill explicitly emits `delivery: []` and asks the connector to render the 9-section comment from `findings`. Nothing on the API side renders findings → comment, and nothing persists `findings` into the `Finding` table on this code path.
**Fix:** add a findings → comment renderer (per connector — start with GitHub) that constructs the 9-section comment when `delivery` is empty but `findings` exists. Also persist findings into `Finding` rows so the admin findings UI keeps working.

### P0.3 Internal-visibility comments leak through the progress placeholder
**Source:** Codex Critical #4.
**Files:** `apps/api/src/services/worker-api-service.ts:6-13` (`pickFinalCommentBody`), `apps/api/src/services/delivery-resolver-service.ts:222-224`.
**What's wrong:** `pickFinalCommentBody` selects the first `kind === 'comment'` op without checking `visibility`. The progress comment is finalized with that body before the delivery resolver suppresses internal ops. An internal comment ends up posted publicly via the placeholder.
**Fix:** filter `visibility === 'internal'` ops out of `pickFinalCommentBody` (and any other "promote first comment" path) before selecting the body.

### P0.4 Cross-tenant access via worker-api routes
**Source:** Codex Critical #6.
**File:** `apps/api/src/routes/worker-api.ts:123-144`.
**What's wrong:** routes accept any worker-authenticated dispatch and return any run / its findings without verifying the run belongs to the dispatch's tenant or that this dispatch owns the run.
**Fix:** require `run.id === request.workerDispatch.workflowRunId` (or that the run is in the same tenant as the dispatch) before returning data.

## P1 — Cancel/stop is non-functional end-to-end

### P1.1 Cancel broadcaster is a no-op stub
**Source:** Claude Critical #2, Max #3, Codex Critical #5.
**File:** `apps/api/src/services/dispatch-cancel-broadcaster.ts:35-43`.
**What's wrong:** `broadcastRunCancel` logs a TODO and returns. The API has no working bridge into live worker WebSocket sessions. With `force=1`, only `cancelForceRequestedAt` is written and the worker never reads it (it polls `status`).
**Fix:** either (a) implement the API→gateway bridge so the API can push `cancel_requested` / `cancel_force` over the existing worker WS, or (b) make the worker's HTTP polling read `cancelForceRequestedAt` and SIGTERM the running subprocess. (b) is the smaller change and unblocks both flags.

### P1.2 Force-cancel state machine is wrong
**Source:** Max BUG.
**File:** `apps/api/src/services/workflow-run-service.ts:147-166`.
**What's wrong:** `requestForceCancel` only sets `cancelForceRequestedAt`; it does not transition status to `cancel_requested`. The follow-up conditional checks `forced.status !== 'cancel_requested'`, which is always true, so it always falls through to `requestCancel`. Dead code + the run is never actually flagged "force requested without first being requested".
**Fix:** make `requestForceCancel` either also set status to `cancel_requested`, or split the API endpoint so `force=1` requires the run to already be in `cancel_requested`.

### P1.3 Run detail Force-stop gate uses `updatedAt`
**Source:** Codex High.
**File:** `apps/admin/src/pages/RunDetailPage.tsx:386-390`, `apps/api/src/services/worker-api-service.ts:63-76`.
**What's wrong:** Force becomes available 30s after `updatedAt`, but worker progress updates mutate the run, resetting `updatedAt`. The gate can drift indefinitely.
**Fix:** track time since `cancelRequestedAt` (or the equivalent timestamp), not `updatedAt`.

## P2 — Multi-leaf safety enforcement gaps

### P2.1 No runtime backstop for non-comment ops in fan-out
**Source:** Claude Critical #1, Max #2 BUG.
**Files:** `packages/skills-executor-runtime/src/stage-scheduler.ts:169-174,224-227`.
**What's wrong:** the plan explicitly required the scheduler to walk each leaf's `delivery[]` after a multi-leaf stage and reject any non-comment op. Currently only parse-time lint exists, and it's known to be best-effort.
**Fix:** add the runtime check + a test for "3 parallel leaves emit `state` op → stage rejected".

### P2.2 Parse-time lint misses `prefixItems` and `$ref`
**Source:** Codex High, Max RISK.
**Files:** `packages/executors-runtime/src/executor-validator.ts:84-146`, `packages/skills/builtin/merge-reviewer/output.schema.json:6-36`.
**What's wrong:** `extractAllowedKindsFromSchema` walks `oneOf/anyOf/allOf/const/enum/properties/items` but not `prefixItems` or `$ref`. Real builtin schemas (`merge-reviewer`) use `prefixItems` to encode delivery kinds — they slip past the lint. Non-builtin schemas could also use `$ref` to a definition with banned kinds.
**Fix:** extend the extractor to handle `prefixItems` and to inline `$ref` (within the same document) before kind extraction.

### P2.3 SkillRunResult parser allows `findings + comment` simultaneously
**Source:** Codex High.
**Files:** `packages/contracts/src/skill-run-result.ts:62-67`, `packages/contracts/src/skill-run-result.test.ts:37-48`.
**What's wrong:** the plan's mutual-exclusion rule (a leaf either emits comment ops or relies on connector findings rendering, not both) is not enforced. The current schema/test explicitly bless both at once.
**Fix:** add a refinement that rejects the combo, update the test to expect rejection, and audit builtin skills.

## P3 — Loop-wrapper / scheduler correctness

### P3.1 `areLeafOutputsEqual` ignores normalization
**Source:** Max BUG.
**File:** `packages/skills-executor-runtime/src/loop-wrapper.ts:38-40`.
**What's wrong:** convergence comparison is full `JSON.stringify`. Plan requires stripping `reportSummary`, `loop.next_iteration_focus`, and `x-loop-volatile` fields before compare. Without that, runs never converge naturally — they always run to `max_iterations`.
**Fix:** strip the volatile fields (deep clone + remove) before comparison; add a test.

### P3.2 `loop_safety.no_self_retrigger` not implemented
**Source:** Max BUG.
**File:** `packages/executors-runtime/src/executor-yaml-schema.ts:102-120`.
**What's wrong:** plan section "guardrails defaults" specifies `no_self_retrigger: true` as the default. Schema has no such key; nothing in the runtime checks it.
**Fix:** add to schema, default to true, enforce in the dispatcher (skip starting a new run if the trigger originated from a comment we just posted).

### P3.3 `persistIteration` doesn't actually persist iteration state
**Source:** Max RISK.
**File:** `apps/worker/src/handlers/skill-handler.ts:167-173`.
**What's wrong:** only writes a progress log line. Plan requires persisting `{ iteration, stages: { [stageId]: { spawn_outputs } } }` on the run for resume + audit.
**Fix:** add a route + DB column (likely on `WorkflowRun` or a sibling table) and write per iteration.

### P3.4 Iteration 1 cancel asymmetry / cancel errors silent on partial schema fail
**Source:** Claude High #5, Critical #4.
**File:** `apps/worker/src/handlers/skill-handler.ts:194-247`, `packages/skills-executor-runtime/src/loop-wrapper.ts:78`.
**What's wrong:** on a `CanceledError`, schema-validation errors that fired mid-stage become silent (output becomes `[]`). Operator debugging the canceled run sees no hint of the schema mismatch. Iteration-1 cancel asymmetry is correct but hard to read.
**Fix:** include schema errors in the partial-cancel report's `extras.schemaErrors`.

## P4 — Delivery resolver / connector layering

### P4.1 Delivery sequencing keeps going after a failure
**Source:** Codex High.
**File:** `apps/api/src/services/delivery-resolver-service.ts:272-305`.
**What's wrong:** plan says later ops in a single `delivery[]` should be skipped after a failure (e.g., if "comment" fails, don't then run "labels"). Current code keeps processing.
**Fix:** break the inner loop on first failure; mark remaining ops as `skipped_after_failure` in `action_outputs`.

### P4.2 Not transactional + non-idempotent on retry
**Source:** Claude High #7.
**File:** `apps/api/src/services/delivery-resolver-service.ts:205-307`.
**What's wrong:** dispatch happens between two DB writes. If the second write fails after dispatch succeeds, the row stays `pending` and a retry double-fires the GitHub call. Comments are ~idempotent; `pr` ops are not.
**Fix:** mark `succeeded` before dispatch with a tentative status, or use an idempotency key per (workflow_run_id, leaf_index, op_index).

### P4.3 GitHub-hardcoded in services
**Source:** Codex Medium.
**Files:** `apps/api/src/services/delivery-resolver-service.ts:3-14`, `apps/api/src/services/progress-comment-service.ts:2-8`.
**What's wrong:** services import `gh-cli` directly instead of going through a connector adapter. Breaks the AGENTS.md layering rule and locks us to GitHub.
**Fix:** introduce a `connectorAdapter.deliver(op)` interface and route via it. Defer if multi-connector isn't an immediate need.

### P4.4 Routing model uses `connectorInstanceId` for non-PR ops
**Source:** Codex Medium.
**File:** `apps/api/src/services/delivery-resolver-service.ts:79-105`.
**What's wrong:** plan said comment/labels/state route to "source connector" and pr routes to "code-host connector"; current code uses `workItem.connectorInstanceId` for non-PR but still derives repo/owner/platform from `repositoryMapping`. Mixed-source scenarios will misroute.

### P4.5 Hash mismatch / cross-tenant tests missing on fetch endpoints
**Source:** Claude Medium #13.
**File:** `apps/api/src/routes/worker-fetches.test.ts`.
**What's wrong:** only happy paths covered. Need: 404 on hash mismatch, 401 on bad auth, cross-tenant attack (forged workflowRunId), hash-mismatch returned-content check.

## P5 — Persistence / migration / smaller cleanups

### P5.1 Revision pinning columns never written
**Source:** Codex High.
**Files:** `apps/api/prisma/schema.prisma:510-511`.
**What's wrong:** `resolvedExecutorRevision` / `resolvedSkillRevisions` exist on `WorkflowRun` but nothing writes them. Worker-side hash pinning works; the run record audit trail does not.
**Fix:** write both columns at dispatch time in `dispatcher-service.ts`.

### P5.2 `build-default` mapped but no YAML exists
**Source:** Codex High.
**File:** `apps/api/scripts/migrate-scenarios-to-executors.ts:34-39,48-56,146-150`.
**What's wrong:** mapping references `build-default` but no builtin YAML ships. Manual-review flag protects most, but a scenario routed to it will fail dispatch.
**Fix:** either author `build-default.yaml` or change the script to refuse the mapping and force manual review.

### P5.3 Builtin executor seeding skips `validateExecutor`
**Source:** Codex Medium.
**Files:** `apps/api/scripts/seed-builtin-executors.ts:26-49`, `packages/executors/builtin/builtin-executors.test.ts:25-53`.
**What's wrong:** seeding/test only parses YAML, doesn't validate against actual skill metadata. Could ship a broken builtin without noticing.
**Fix:** load skill metadata first, then call `validateExecutor` during the seed.

### P5.4 Progress-comment throttle is racy
**Source:** Claude High #6.
**File:** `apps/api/src/services/progress-comment-service.ts:113-181`.
**What's wrong:** read-then-write of `lastProgressEditAt` not atomic. Two concurrent updates can both pass throttle.
**Fix:** use Prisma `updateMany` with a `lastProgressEditAt < now() - 30s` predicate to atomically claim the throttle slot.

### P5.5 Checkpoint POST errors are swallowed
**Source:** Claude Medium #15.
**File:** `apps/worker/src/handlers/skill-handler.ts:120`.
**What's wrong:** if `api.postCheckpoint` fails, the run continues without recording. Resume from crash loses the iteration boundary.
**Fix:** at minimum, log + retry-once. Ideally bubble fatal failures.

### P5.6 Cancel poll interval is 2s and HTTP-based
**Source:** Claude Medium #10.
**File:** `apps/worker/src/handlers/skill-handler.ts:55`.
Acceptable for v1; supersede when P1.1 is properly implemented over WS.

## What's solid (no action)

- **By-hash fetch endpoint shape and tests** — clean implementation, well-covered for happy path (Codex, Claude).
- **Tenant isolation in `ExecutorService` / `SkillService`** — correct `OR [tenantId=null, tenantId=requestingTenant]` filter (Claude).
- **Loop iteration output preservation (`stickyDone`)** — correctly returns the first `done: true` iteration if later iterations regress (Claude).
- **Fan-out success-rate threshold enforcement** in `stage-scheduler` (Claude).
- **Phase D admin UI surfaces** — executor binding in workflow designer, loop timeline + Stop control on run detail, trigger allowlist editor on scenario detail all exist (Codex).
- **Progress-comment stale-comment recovery** detects 404/403/410 and reposts (Claude).
- **Parser/scheduler/loop unit coverage** is strong for graph validation, retries, loop behavior, checkpoint writing (Codex).

## Suggested next-wave grouping (parallelizable)

- **Wave R-1** — P0.1 + P0.2 + P5.1 (skill handler runner correctness; touches dispatcher + worker-api-service)
- **Wave R-2** — P0.3 + P0.4 + P4.5 (visibility leak + tenant isolation on worker-api routes)
- **Wave R-3** — P1.1 + P1.2 + P1.3 (cancel/stop end-to-end; pick HTTP fallback or WS bridge)
- **Wave R-4** — P2.1 + P2.2 + P2.3 (multi-leaf safety + parser refinement)
- **Wave R-5** — P3.1 + P3.2 + P3.3 + P4.1 + P4.2 + P5.4 + P5.5 (loop convergence, idempotency, persistence)

P4.3 / P4.4 (connector layering) deferred — they need a small design step before implementation.
