# Code Review: Database & Prisma

Branch: `worktree-agent-a1edb29b`
Scope: `apps/api/prisma/schema.prisma`, all migrations under `apps/api/prisma/migrations/`, repositories, services that touch Prisma directly, route handlers that bypass repositories, worker DB access, canonical-contract adherence (`docs/contracts.md`, `docs/automation-composition.md`, `docs/workflow-scenarios.md`).

## 1. Executive summary

The schema is detailed and largely sensible, but the implementation has drifted from the canonical contract documented in `docs/contracts.md`. The two largest classes of risk are:

1. **Race-prone primary-key flows.** Inbound dedupe and idempotency-key uniqueness are enforced in application code via `findFirst` + `create` rather than DB constraints, with at least one Serializable txn that still admits a TOCTOU window because the unique constraint is missing (`schema.prisma:488`, `intake-service.ts`, `polling-event-service.ts`).
2. **Canonical contract is not implemented.** The contract requires `automation_events`, `scenario_executions`, `scenario_action_executions`, `action_outputs`, `action_delivery_attempts` as the system of record. Only `action_outputs` and `action_delivery_attempts` exist. Routes and services still create/read/update legacy `workflow_scenarios*` and `outbound_destinations` as the primary source of truth.

In addition: multi-write paths (run report ingest, delivery loop) run outside transactions; the `AuditEvent` model is declared but never written by any code path; several routes call Prisma directly, violating the documented layering.

Total findings: 4 blocker, 9 high, 8 medium, 6 low.

## 2. Blockers (data loss / corruption / silent contract violation)

### B1. `inbound_work_items.dedupeKey` has no unique constraint; intake is race-prone

- `apps/api/prisma/schema.prisma:488` declares `@@index([dedupeKey])` only. There is no `@@unique([tenantId, dedupeKey])` or `@@unique([connectorInstanceId, dedupeKey])`.
- `apps/api/src/services/intake-service.ts` (dedupe lookup + create inside a Serializable txn) and `apps/api/src/services/polling-event-service.ts` (same pattern) rely on application-level uniqueness. Even at Serializable isolation, without a unique constraint a concurrent insert can pass the `findFirst` check in both txns; Serializable will then retry/abort one, but if the second commit lands first you still get duplicates because there is nothing for the DB to detect a conflict against — Postgres can only detect a serialization anomaly between read/write predicates, and the predicate here is a plain index scan.
- Contract requirement: `docs/contracts.md` §"Inbound dedupe" mandates tenant-scoped uniqueness on `(tenantId, source, externalId)` or equivalent.

Fix: add `@@unique([tenantId, dedupeKey])` (or `@@unique([connectorInstanceId, dedupeKey])` if dedupe is connector-scoped) and let `INSERT ... ON CONFLICT DO NOTHING` (Prisma `createMany skipDuplicates` or `upsert`) drive the dedupe decision. Drop the surrounding `$transaction(..., { isolationLevel: Serializable })` once the constraint exists.

### B2. `worker-api-service.ts:submitReport` performs multi-table writes without a transaction

- `apps/api/src/services/worker-api-service.ts:246-370` updates `workflow_runs.status`, inserts into `workflow_log_events`, inserts N rows into `findings`, then calls `deliveryResolver.resolveDelivery(...)` (which writes `action_outputs` + `action_delivery_attempts` + `outbound_delivery_attempts`). None of these writes are wrapped in `prisma.$transaction(...)`.
- A mid-call failure (deliveryResolver throws, DB connection drops, process killed) leaves a run that is marked `completed` with partial findings and no delivery rows, or a run that has findings but stale status. There is no compensating action.
- Contract requirement: `docs/contracts.md` §"Workflow run completion" requires atomicity between run-state transition and its emitted action outputs.

Fix: wrap status update + log + findings + action-output emission in a single `$transaction`. Move provider/HTTP side-effects out of the txn body (defer them to a queue marker row written inside the txn).

### B3. `connectorRepository.delete` cascades only a subset of child rows

- `apps/api/src/repositories/connector-repository.ts:34-43` deletes `secrets`, `capabilities`, `eventSubscriptions`, `pollingCheckpoints`, `connector` in that order, then commits.
- Missing children that hold FKs to `connector_instances`: `repository_mappings`, `routing_rules`, `comment_threads`, `inbound_work_items`, `workflow_scenario_bindings`, `outbound_destinations`, `repository_event_subscriptions`. Several of those are `onDelete: NoAction` / `Restrict` in the schema (`schema.prisma`).
- Net effect: either the delete throws `P2003` (foreign key constraint) and partial deletes have already committed since they are not wrapped in `$transaction`, OR the deletes succeed and orphan rows remain in production.

Fix: wrap the full cascade in `prisma.$transaction`. Either change schema FKs to `onDelete: Cascade` for the genuinely owned children (secrets, capabilities, eventSubscriptions, pollingCheckpoints) and explicitly block the delete (`P2003`) if user-data children (repository_mappings, inbound_work_items) still reference the connector — surface a clear 409 instead of a 500.

### B4. `AuditEvent` is declared but never written; audit is structurally absent

- `apps/api/prisma/schema.prisma:1487-1502` defines the `AuditEvent` model with a useful index pair.
- Grep for `auditEvent.`, `AuditEvent.create`, `auditEventRepository` across `apps/` returns zero hits.
- The brief explicitly required "audit completeness in DB writes." There is no audit trail for tenant config changes (`settings.ts`), workflow-scenario CRUD (`workflow-scenarios.ts`), review-profile CRUD (`review-profiles.ts`), or run-state mutations.

Fix: add a small `audit-event-repository.ts`, wire it into the services that mutate tenant-visible state, and write within the same transaction as the underlying mutation so audit cannot drift from reality.

## 3. High

### H1. Legacy `workflow_scenarios*` tables are still the primary write target

- `apps/api/src/routes/workflow-scenarios.ts:243-383` does direct `app.prisma.workflowScenario.{create,update,delete}` and `workflowScenarioStep.*`, `workflowScenarioBinding.*` — both a layering violation and a contract violation.
- `apps/api/src/services/dispatcher-service.ts` and `apps/api/src/services/polling-event-service.ts` read scenario steps as the dispatch source of truth.
- `docs/workflow-scenarios.md:107` and `docs/contracts.md` mark this surface as legacy; canonical replacement is `scenario_executions` + `scenario_action_executions`, which do not exist in the schema at all.

Fix: introduce `scenario_executions` / `scenario_action_executions` per `docs/contracts.md`, route writes through a `scenario-execution-service.ts`, and freeze writes to the legacy tables (read-only) until the migration completes.

### H2. Canonical models missing from schema

Required by `docs/contracts.md` but not in `schema.prisma`:

- `automation_events`
- `scenario_executions`
- `scenario_action_executions`
- `approval_requests`
- `source_action_invocations`

`action_outputs` and `action_delivery_attempts` exist but cannot be linked back to `scenario_action_executions` because that table is missing.

### H3. `WorkflowRun` lacks canonical linkage fields

- `apps/api/prisma/schema.prisma:493-546`: no `scenarioExecutionId`, no `sourceActionInvocationId`, no `automationEventId`. `workflowScenarioId` still points at the legacy table.
- Without these columns the canonical flow cannot be implemented even after the new tables are added.

### H4. `outbound_destinations` / `outbound_delivery_attempts` still primary delivery source of truth

- `apps/api/src/repositories/outbound-destination-repository.ts` and `apps/api/src/repositories/delivery-attempt-repository.ts` are actively used by `apps/api/src/services/outbound-delivery-service.ts` and `apps/api/src/services/delivery-resolver-service.ts`.
- `docs/automation-composition.md:824` flags this as legacy; canonical replacement is `action_outputs` + `action_delivery_attempts`. Today both write paths coexist, so two tables disagree on delivery state.

### H5. `delivery-resolver-service.ts` runs a multi-destination loop without a transaction

- `apps/api/src/services/delivery-resolver-service.ts:313-535` iterates destinations, writing `action_outputs.deliveryStatus = in_flight`, calling provider, then writing `action_delivery_attempts` and flipping `action_outputs.deliveryStatus`. The loop body is not transactional.
- Crash mid-loop leaves `action_outputs` rows stuck `in_flight` forever; there is no reaper. Run retries will see "already in flight" and refuse.

### H6. `action_outputs.idempotencyKey` is globally unique instead of tenant-scoped

- `apps/api/prisma/schema.prisma:654`: `idempotencyKey String? @unique`.
- A malicious or buggy tenant can collide a key into another tenant's space, denying their delivery. Should be `@@unique([tenantId, idempotencyKey])`.

### H7. Routes call Prisma directly, bypassing the repository layer

Layer violations (each handler does `app.prisma.X.{find|create|update|delete}` directly):

- `apps/api/src/routes/workflow-scenarios.ts` (entire file)
- `apps/api/src/routes/review-profiles.ts`
- `apps/api/src/routes/settings.ts`
- `apps/api/src/routes/workflow-chain.ts`
- `apps/api/src/routes/worker-fetches.ts`
- `apps/api/src/routes/auth.ts`
- `apps/api/src/routes/platform-types.ts`

`AGENTS.md` §"Clear Layers" explicitly forbids this.

### H8. Tenant settings are stored in `identity_providers.config` JSON

- `apps/api/src/routes/settings.ts:22-75` packs general tenant settings into an `identity_providers` row's `config` JSONB column. There is no `Tenant` or `TenantSettings` model.
- This couples settings lifetime to a particular IdP row, prevents migrations on settings shape, and makes tenant-scoped queries fragile.

### H9. `upsertSecret` / `upsertCapability` in connector repo are non-atomic

- `apps/api/src/repositories/connector-repository.ts`: both helpers do `findFirst` then `create` or `update`. Two concurrent upserts can both miss and then both `create`, producing duplicates unless a DB unique exists.
- Verify and add `@@unique` on `(connectorInstanceId, key)` for both child tables, then switch to `prisma.X.upsert` so the DB does the conflict resolution.

## 4. Medium

### M1. `Skill` and `Executor` are missing `@@map`

- `apps/api/prisma/schema.prisma:896-927`. All other models map to snake_case (`workflow_runs`, `action_outputs`, …); these two will land as `Skill` and `Executor` mixed-case tables, breaking the naming convention and making manual SQL/migrations awkward.

### M2. `WorkflowLogEvent` is missing a composite index on `(workflowRunId, timestamp)`

- `apps/api/prisma/schema.prisma:549-572`. The progress UI orders by timestamp per run; current indexes force a per-run filter + sort.

### M3. `ActionDeliveryAttempt` lacks `@@unique([actionOutputId, attemptNumber])`

- `apps/api/prisma/schema.prisma:673` onward. Retries should be idempotent on attempt number; today a worker that re-sends a retry can write two rows for attempt 3.
- `destinationId` is also a free String, not an FK — no referential integrity to `outbound_destinations` (or its successor).

### M4. `migrate deploy` at startup has no advisory lock

- `Dockerfile:74`: `pnpm --filter @support-agent/api exec prisma migrate deploy && node ...`.
- Fine for a single replica, races at N>1. Wrap in `pg_advisory_lock` (or move to a dedicated init container / job).

### M5. Dead `apps/worker/src/lib/prisma.ts`

- Declares a `PrismaClient` for the worker. Grep shows no consumers (`apps/worker/src/handlers/skill-handler.ts` only `import type`). Violates the documented "workers are API-only" rule and is a footgun — any future change here would silently give workers DB access.

### M6. Migration `20260418170000_add_workflow_run_iterations` lacks `IF NOT EXISTS` guards

- Replay against a partially-applied DB fails. Compare with `20260418183000_wave_c_cancel_delivery_idempotency` which uses guards consistently. Forward-only is fine; replay-fragility is not.

### M7. No `@@index` for hot-path `(tenantId, status)` queries

- `WorkflowRun`, `ActionOutput`, `ActionDeliveryAttempt`, and `InboundWorkItem` all have single-column `tenantId` and `status` indexes, but no composite. Admin list views filter by both and will sequential-scan tenant rows once tables grow.

### M8. `Finding.confidence` is `Float` not an enum

- `apps/api/prisma/schema.prisma` (Finding model). The contract treats confidence as a small categorical set (low/medium/high). Use an enum or constrain to [0,1] via CHECK; today a worker can write 42.

## 5. Low / hygiene

- **L1.** `schema.prisma` has duplicated `// 25. ActionDeliveryAttempt` style comments after model renumbering; reorder or drop the numbering — it adds maintenance burden with no value.
- **L2.** `WorkflowRun.resolvedSkillRevisions Json?` should be typed via a Prisma JSON type alias (`@json` once Prisma supports it, or a Zod schema enforced by the repository) — currently the worker and API disagree on shape.
- **L3.** `WorkflowRun.config Json?` — same as above; this is overloaded across cancellation, retry, and progress fields.
- **L4.** `OutboundDeliveryAttempt.findingId` is nullable with index but no compound `(workflowRunId, findingId)` index, while the dashboard queries both together.
- **L5.** No naming convention on enums (e.g. `WorkflowRunStatus` uses lowercase string values, `AuditAction` uses lowercase string values — fine, but `OutputVisibility` mixes case in places). Pin one convention.
- **L6.** No `prisma format` / `prisma validate` step in CI hooks; the duplicate-comment regressions in (L1) and missing `@@map` in (M1) would have been caught.

## 6. Suggested migrations (sketch)

The following are minimum-viable migration outlines. Each should be its own forward-only migration with an `IF NOT EXISTS` guard.

### Mig A — add canonical workflow tables

```sql
CREATE TABLE IF NOT EXISTS automation_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  connector_id    text NOT NULL,
  source_event_id text NOT NULL,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, connector_id, source_event_id)
);
CREATE INDEX IF NOT EXISTS automation_events_tenant_received_idx
  ON automation_events (tenant_id, received_at DESC);

CREATE TABLE IF NOT EXISTS scenario_executions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            text NOT NULL,
  automation_event_id  uuid NOT NULL REFERENCES automation_events(id),
  scenario_id          text NOT NULL,
  status               text NOT NULL,
  started_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz
);
CREATE INDEX IF NOT EXISTS scenario_executions_tenant_status_idx
  ON scenario_executions (tenant_id, status);

CREATE TABLE IF NOT EXISTS scenario_action_executions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              text NOT NULL,
  scenario_execution_id  uuid NOT NULL REFERENCES scenario_executions(id) ON DELETE CASCADE,
  action_key             text NOT NULL,
  status                 text NOT NULL,
  attempt_number         integer NOT NULL DEFAULT 1,
  started_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,
  UNIQUE (scenario_execution_id, action_key, attempt_number)
);
```

### Mig B — tenant-scope and protect idempotency / dedupe

```sql
ALTER TABLE action_outputs DROP CONSTRAINT IF EXISTS action_outputs_idempotencyKey_key;
CREATE UNIQUE INDEX IF NOT EXISTS action_outputs_tenant_idem_uq
  ON action_outputs (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inbound_work_items_tenant_dedupe_uq
  ON inbound_work_items (tenant_id, dedupe_key);
```

### Mig C — link `WorkflowRun` to canonical scenario execution

```sql
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS scenario_execution_id uuid
  REFERENCES scenario_executions(id);
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS source_action_invocation_id uuid;
CREATE INDEX IF NOT EXISTS workflow_runs_scenario_exec_idx
  ON workflow_runs (scenario_execution_id);
```

### Mig D — Skill / Executor table rename

```sql
ALTER TABLE "Skill" RENAME TO skills;
ALTER TABLE "Executor" RENAME TO executors;
```
(Then add `@@map("skills")` / `@@map("executors")` in schema.prisma.)

### Mig E — composite hot-path indexes

```sql
CREATE INDEX IF NOT EXISTS workflow_runs_tenant_status_idx
  ON workflow_runs (tenant_id, status);
CREATE INDEX IF NOT EXISTS action_outputs_tenant_delivery_status_idx
  ON action_outputs (tenant_id, delivery_status);
CREATE INDEX IF NOT EXISTS workflow_log_events_run_ts_idx
  ON workflow_log_events (workflow_run_id, timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS action_delivery_attempts_output_attempt_uq
  ON action_delivery_attempts (action_output_id, attempt_number);
```

### Mig F — startup migration concurrency

Replace `migrate deploy` in the API CMD with a sidecar / init-container, or wrap with `SELECT pg_advisory_lock(hashtext('support-agent-migrate'));` + `pg_advisory_unlock(...)`.
