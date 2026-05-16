# Code review: API & workers

Scope: functionality and code-quality review of `apps/api`, `apps/worker`, `apps/gateway`, and supporting `packages/queue`, `packages/contracts`. Excludes security/containerization (covered separately).

Branch: `worktree-agent-afa20741`

## 1. Executive summary

The orchestration core is mostly in place — Fastify routes are typed, a Zod-validated `WorkerJob` contract is shared end-to-end, two-phase cancel is wired into the worker, and the dispatcher uses `FOR UPDATE SKIP LOCKED` for safe claims. However, several invariants documented in `docs/contracts.md` and `docs/worker-architecture.md` are not enforced in code:

- The API→gateway cancel relay is an explicit TODO; cancel requests do not reach a running worker.
- The local execution provider's `cancel()` is a no-op.
- There is no lost-run reaper / heartbeat watchdog despite `lost` being a first-class state and `awaiting_review`/`awaiting_human` being treated as live.
- Inbound traffic skips the canonical `AutomationEvent` normalization step that the docs require; webhook and polling intake paths each produce their own dedupe keys with non-matching shapes.
- Routes routinely reach into Prisma directly, bypassing the documented routes → services → repositories layering.
- `workflow_runs` is documented as non-resumable, but the in-memory state machine allows `failed → queued` and `lost → queued`.
- BullMQ/Pub/Sub queue adapters silently diverge on `priority`/`delay`/retry/DLQ; neither has retry config.

Worker handlers and the dispatcher service are at or over the 500 LOC budget set by `AGENTS.md`, with mixed concerns (e.g. gh/linear/jira/respondio all imported into one triage handler).

## 2. Blockers

### B1. Cancel relay from API to gateway is a TODO

`apps/api/src/services/dispatch-cancel-broadcaster.ts:35-43` looks up active dispatches and then logs a warning instead of sending anything:

```
logger.warn({ ... }, 'TODO: broadcast cancel over the gateway WebSocket bridge once API→gateway session routing exists');
```

The gateway side already implements `sendCancelRequested` / `sendCancelForce` (`apps/gateway/src/ws/connection-manager.ts:135-149`) and the worker honors both messages (`apps/worker/src/transport/ws-transport.ts`), but no production caller invokes them — grep finds only test usages. Result: user-initiated cancel never reaches a running worker; `workflow-run-service` flips DB state while the worker keeps executing.

### B2. Local execution provider cancel is a no-op

`apps/api/src/services/execution-provider.ts:108-110`:

```
async cancel(_providerJobId) {
  // TODO: BullMQ job cancellation
},
```

In local-orchestrator mode (the documented default in `docs/local-orchestrator.md`) there is no way to revoke a queued BullMQ job; combined with B1, the entire cancel feature is non-functional in local mode.

### B3. No lost-run / heartbeat reaper

`docs/worker-architecture.md` and the `lost` status assume a dispatcher-side watchdog that fails runs whose worker stops heartbeating. Grep finds no `markLost`, `reaper`, heartbeat watchdog, or scheduled job in `apps/api/src` (only test fixtures). Without it: a worker crash leaves `running` rows forever; gateway's per-connection heartbeat (`apps/gateway/src/ws/connection-manager.ts:84-90`) is one-way (`ping`) with no pong timeout and no API-side notification on disconnect.

### B4. AutomationEvent normalization is bypassed

`docs/automation-composition.md` mandates that intake normalize to a canonical `AutomationEvent` before trigger matching. `apps/api/src/services/intake-service.ts:80-126` creates `InboundWorkItem` rows and `WorkflowRun` rows directly from connector payloads. No `AutomationEvent` table or service exists. Polling and webhook paths each invent their own dedupe keys:

- `apps/api/src/services/polling-event-service.ts:93-129` uses `scn:<scenarioId>:<repo>:<kind>:<id>`
- The intake path uses `normalized.dedupeKey` straight from the connector

This violates the dedupeKey families specified in `docs/contracts.md` (`webhook:` vs `poll:`) and means a webhook delivery and a poll observation of the same event will not collapse.

### B5. `workflow_runs` state machine allows resumption from terminal states

`apps/api/src/services/workflow-run-service.ts:13-14`:

```
failed: ['queued'],
lost: ['queued'],
```

`docs/contracts.md` explicitly states workflow runs are non-resumable — retries require a new run. The transition table contradicts the contract and also introduces `awaiting_review`, `awaiting_human`, and `cancel_requested` states that are absent from the canonical status enum in `packages/contracts/src/enums.ts:11-15` vs. `docs/contracts.md`.

## 3. High

### H1. Routes call Prisma directly, bypassing services/repositories

`AGENTS.md` Clear Layers: "Repositories own database access." Violations:

- `apps/api/src/routes/worker-api.ts:22-29, 134-142, 158-162, 179-191, 203-207` — direct `app.prisma.workerDispatch.findUnique` / `update`.
- `apps/api/src/routes/workflow-scenarios.ts:243-383` — entire CRUD inline via `app.prisma.$transaction(...)`.
- `apps/api/src/routes/worker-fetches.ts:7-15` — direct tenant resolution from Prisma in a route.
- `apps/api/src/routes/polling.ts` reaches into prisma alongside service calls.

Also: services frequently bypass repositories — `apps/api/src/services/worker-api-service.ts`, `apps/api/src/services/skill-service.ts`, `apps/api/src/services/intake-service.ts`, and `apps/api/src/services/polling-event-service.ts` all call `prisma.*` directly even though `apps/api/src/repositories/workflow-run-repository.ts` exists as a template.

### H2. ApiErrorSchema not enforced

`packages/contracts/src/api-error.ts` defines the shared `{ error: { code, message, details } }` envelope (matched by `apps/api/src/plugins/error-handler.ts`), but routes return ad-hoc shapes:

- `apps/api/src/routes/worker-fetches.ts:38, 63` — `{ error: 'string' }` (not the envelope).
- Other routes mix `reply.code(404).send({ error: ... })` and bare strings.

Grep confirms `ApiErrorSchema` is imported nowhere in route or service code. Single-source-of-truth invariant from `AGENTS.md` is violated.

### H3. Duplicate intake paths

`apps/api/src/routes/polling.ts:128-141` exposes both `/triage-enqueue` and `/event`; both create workflow runs. Webhook intake in `apps/api/src/routes/webhooks.ts` is a third path. Three sibling endpoints answer the same invariant question — "given an external event, create a run." This is the canonical single-source-of-truth violation called out in `AGENTS.md`.

### H4. Webhook signature handling lives in the route

`apps/api/src/routes/webhooks.ts` parses raw body, picks up `x-github-event` / `x-hub-signature`, and dispatches connector code. Connector-specific normalization (including signature verification) belongs in the connector layer per `AGENTS.md` ("connector clients wrap external systems only"). Today the route inspects headers, which makes it the de-facto normalizer.

### H5. BullMQ/Pub/Sub queue adapters are not at parity

`packages/queue/src/types.ts:1-12` declares `priority` and `delay` options on `enqueue`.

- `packages/queue/src/pubsub.ts:36-48` silently ignores both (Pub/Sub does not support either directly; the adapter does not throw or emulate).
- Neither `packages/queue/src/bullmq.ts` nor `pubsub.ts` configures retry/backoff/attempts.
- No dead-letter topic/queue is configured in either adapter. A poison message in Pub/Sub will nack forever (`pubsub.ts:82`).

Because `apps/api/src/services/dispatcher-service.ts` uses these options for ordering, runs may execute out of priority order in production.

### H6. Worker transport duplicates BullMQ wiring

`apps/worker/src/transport/bullmq-transport.ts` instantiates `new Worker(...)` directly instead of calling `createProcessor` on the shared `QueueAdapter` from `packages/queue`. Two BullMQ clients with two different connection lifecycles diverge over time. The shared queue package is the documented adapter boundary.

### H7. Gateway has no persistent registry / no API session routing

`apps/gateway/src/ws/connection-manager.ts:21-49` keeps the `Map<workerId, ConnectedWorker>` only in memory. There is no API ↔ gateway control channel; the gateway pulls jobs from the queue (`apps/gateway/src/index.ts`) but the API has no way to reach a specific connected worker. After a gateway restart, in-flight dispatches lose their cancel route entirely — directly enabling B1.

### H8. Worker `register` and inbound messages skip Zod validation

`apps/gateway/src/ws/connection-manager.ts:28-38` parses JSON and casts `msg.workerId as string`, `msg.capabilities as string[]`. `packages/contracts/src/gateway-protocol.ts` defines proper discriminated unions but the gateway does not use them. Any client can register with arbitrary fields.

## 4. Medium

### M1. `dispatcher-service.ts` is 534 LOC and mixes claim / dispatch / fetch-config

`apps/api/src/services/dispatcher-service.ts` exceeds `AGENTS.md` 500 LOC limit and combines workflow-run claim, executor/skill resolution, provider invocation, retry counter management, and Prisma transaction orchestration. Split along: claim (repo), config resolution (skills/executors service), provider invocation.

### M2. Worker handlers over the 500 LOC limit

- `apps/worker/src/handlers/skill-handler.ts` — 594 LOC.
- `apps/worker/src/handlers/build-handler.ts` — 509 LOC.
- `apps/worker/src/handlers/triage-handler.ts` — 500 LOC; imports `gh`, `linear`, `jira`, `respondio` CLI together, mixing connector concerns the docs say belong "at the edge."

### M3. Two `workflow_runs.jobId` semantics

`apps/api/src/services/dispatcher-service.ts:432` sets `job.jobId = dispatch.id`. The gateway then matches cancel by `worker.currentJobId === dispatchAttemptId` (`apps/gateway/src/ws/connection-manager.ts:171`). The name `jobId` actually means "dispatch attempt id." This is fine functionally but confusing — rename in `WorkerJobSchema` or document explicitly in `packages/contracts/src/worker-job.ts`.

### M4. Dev token used by cron loop

`apps/worker/src/cron-loop.ts:42` authenticates to the API via `/v1/auth/dev-login`. This works in dev but ties the cron loop to a development-only endpoint. The cron loop should use the worker registration credential the rest of the worker uses.

### M5. Dispatch timeout has no retry policy

`apps/gateway/src/ws/connection-manager.ts:19` sets `DISPATCH_TIMEOUT_MS = 60_000` and on timeout rejects the pending job. There is no API-side handler that catches that rejection and either re-queues or fails the run — gateway logs the error and the run stays `dispatched` forever (compounds B3).

### M6. PubSub adapter creates topics/subscriptions on first send

`packages/queue/src/pubsub.ts:8-34` creates topics and subscriptions at runtime. In a multi-instance deployment this races and adds startup latency. Topics and subscriptions should be IaC-managed and the adapter should fail closed when they are absent.

### M7. Polling event service uses non-canonical dedupe prefix

`apps/api/src/services/polling-event-service.ts:93-129` — the `scn:` family does not appear in `docs/contracts.md`, which only defines `webhook:` and `poll:` families. Also see B4.

### M8. Worker `bullmq-transport.ts` does not use the queue contracts package

The worker's `WorkerJob` deserialization in the BullMQ transport does not Zod-parse the job. A malformed payload from a different code version will crash the handler with a raw `TypeError` instead of a clean validation failure.

## 5. Low / hygiene

### L1. `console.log` in production code

`apps/gateway/src/ws/connection-manager.ts:46-48, 75-76, 81`, `packages/queue/src/pubsub.ts:78-91` — replace with the Fastify logger or a shared logger module.

### L2. Magic numbers

`apps/gateway/src/ws/connection-manager.ts:18-19` (heartbeat 30s, dispatch timeout 60s), `packages/queue/src/pubsub.ts:28-29` (ackDeadline 600s, retention 86400s) — promote to configuration with documented defaults.

### L3. `any` casts in services

`apps/api/src/services/dispatcher-service.ts:426, 435` — `jobPayload: job as any`. Replace with `Prisma.InputJsonValue` cast or a typed wrapper.

### L4. Inconsistent error throws

`apps/api/src/services/polling-event-service.ts:137` throws `Object.assign(new Error('...'), { statusCode: 404 })` — fine, but other services throw via the `ApiError` class. Standardize.

### L5. Test files near or over LOC limit

Several `*.test.ts` are 400+ LOC and exercise multiple concerns per file. Split per behavior to keep failure signal localized.

### L6. Empty WS message handlers

`apps/gateway/src/ws/connection-manager.ts:52-56` — `pong` and `job-accepted` are silent. At minimum log at debug level so reconnection problems are diagnosable from gateway logs (per `AGENTS.md` Debugging Protocol).

## 6. Architecture deviations from AGENTS.md / techstack.md

### A1. Layering — `AGENTS.md` Clear Layers

Routes and services bypass repositories (H1). Routes embed connector concerns (H4). Worker handlers embed multiple connector CLIs (M2).

### A2. Single source of truth — `AGENTS.md` Single Source of Truth

Three intake paths (H3). Two BullMQ wirings (H6). Two dedupe-key families that do not coincide (B4, M7). Error shapes diverge (H2). The contract enum and the runtime state machine disagree (B5).

### A3. Determinism — `AGENTS.md` Determinism First

`docs/contracts.md` requires intake to normalize through `AutomationEvent`; intake skips this layer (B4). Polling event handling regex-derives identity rather than reusing the connector's structured event id.

### A4. No unnecessary abstractions — `AGENTS.md`

`apps/api/src/services/skill-service.ts` and other services build helper layers on top of Prisma without a repository, defeating the layered design. The fix is to add the repository, not to introduce a new abstraction.

### A5. File size budget — `AGENTS.md` Code Organization

Files at or over 500 LOC: `dispatcher-service.ts` (534), `skill-handler.ts` (594), `build-handler.ts` (509), `triage-handler.ts` (500). Several test files are similarly long.

### A6. Worker architecture — `docs/worker-architecture.md`

Lost-run detection / heartbeat reaper / cancel relay are documented in `docs/worker-architecture.md` and not implemented (B1, B3, H7). The dispatcher-side responsibilities listed in that doc are partly delegated to gateway in-memory state.

### A7. Local-first cancel — `docs/local-orchestrator.md`

Local-orchestrator mode is the default but cancel is non-functional in that mode (B2).

### A8. Queue contract — `packages/queue/src/types.ts`

The interface declares options the adapters silently ignore (H5). The shared adapter is bypassed by the worker (H6).

---

Next steps recommended (in priority order): close B1+B2 cancel relay end-to-end; add the lost-run reaper (B3); introduce `AutomationEvent` normalization with shared dedupeKey families (B4); tighten the workflow-run state machine to match `docs/contracts.md` (B5); then push routes onto services and services onto repositories (H1).
