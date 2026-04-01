# Support Agent Foundation Build

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stand up the full monorepo, database schema, API skeleton, admin shell, worker skeleton, and core domain services so that end-to-end triage can work.

**Architecture:** TypeScript pnpm monorepo. Fastify API owns persistence and orchestration. CSR React admin app for operators. Worker processes execute triage/build/merge jobs via queue. BullMQ locally, Pub/Sub in production.

**Tech Stack:** TypeScript, pnpm, Fastify, Prisma, PostgreSQL, BullMQ, React, Vite, Tailwind CSS, TanStack Query, React Router, Zod, Vitest

---

## Phase 1: Monorepo Foundation

### Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.prettierrc`
- Create: `.eslintrc.cjs`
- Create: `.nvmrc`
- Update: `.gitignore`
- Create: `turbo.json`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/admin/package.json`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.json`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`

**What:**
- Root `package.json` with `"private": true`, pnpm workspace, turborepo for build orchestration
- `pnpm-workspace.yaml` listing `apps/*` and `packages/*`
- Shared `tsconfig.base.json`: strict mode, ES2022 target, NodeNext module resolution
- Each app/package gets its own `package.json` and `tsconfig.json` extending the base
- `.nvmrc` pinned to Node 20
- `.gitignore` covering node_modules, dist, .env, .turbo, prisma generated client
- Turborepo pipeline: build, lint, test, typecheck

**Verification:**
- `pnpm install` succeeds
- `pnpm -r exec -- echo ok` prints ok for each workspace

### Task 2: Config Package

**Files:**
- Create: `packages/config/src/index.ts`
- Create: `packages/config/src/env.ts`
- Create: `packages/config/src/env.test.ts`

**What:**
- Zod-based env parser
- Typed config for: `DATABASE_URL`, `REDIS_URL`, `PORT`, `NODE_ENV`, `JWT_SECRET`, `API_BASE_URL`, `CORS_ORIGIN`
- Test that missing required vars throw, defaults work

### Task 3: Contracts Package

**Files:**
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/work-item.ts`
- Create: `packages/contracts/src/workflow-run.ts`
- Create: `packages/contracts/src/finding.ts`
- Create: `packages/contracts/src/final-report.ts`
- Create: `packages/contracts/src/worker-job.ts`
- Create: `packages/contracts/src/enums.ts`
- Create: `packages/contracts/src/api-error.ts`
- Create: `packages/contracts/src/schemas.test.ts`

**What:**
- Zod schemas for every canonical contract from `docs/contracts.md`
- `WorkItemSchema`, `WorkflowRunSchema`, `FindingSchema`, `FinalReportSchema`, `WorkerJobSchema`
- Enum types: `WorkflowType`, `WorkflowRunStatus`, `WorkItemKind`, `TriageStage`, `BuildStage`, `MergeStage`, `OutputVisibility`
- `ApiErrorSchema` for standard error envelope
- Inferred TypeScript types exported alongside schemas
- Tests validating happy-path and rejection for each schema

### Task 4: Prisma Schema — Core Tables

**Files:**
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/.env.example`

**What:**
Full Prisma schema covering all tables from `docs/techstack.md`:
- `platform_types`, `connectors`, `connector_endpoints`, `connector_capabilities`, `connector_taxonomy_cache`, `connector_scope_mappings`
- `repository_mappings`, `routing_rules`, `routing_targets`
- `trigger_policies`, `trigger_conditions`, `trigger_actions`
- `workflow_scenarios`, `workflow_scenario_bindings`, `workflow_scenario_steps`
- `inbound_work_items`, `workflow_runs`, `workflow_log_events`, `findings`
- `outbound_destinations`, `outbound_delivery_attempts`
- `execution_profiles`, `runtime_profiles`, `execution_providers`, `execution_provider_hosts`, `execution_host_sessions`
- `runtime_api_keys`, `runtime_api_key_audit_events`
- `worker_dispatches`
- `review_profiles`, `review_profile_versions`, `review_prompt_sets`, `review_round_outputs`, `review_evaluations`, `review_comments`, `workflow_run_reviews`
- `orchestration_profiles`, `orchestration_profile_versions`, `prompt_manifests`
- `work_item_dependencies`, `dependency_snapshots`, `dependency_policies`, `dependency_overrides`
- `feature_delivery_runs`, `feature_delivery_work_items`, `feature_delivery_batches`, `feature_delivery_assets`
- `connector_comment_threads`, `connector_comment_messages`, `connector_mentions`
- `communication_channel_types`, `communication_channels`, `communication_channel_pairings`, `communication_channel_memberships`, `communication_channel_policies`
- `conversation_threads`, `conversation_messages`, `conversation_action_requests`, `conversation_subscriptions`
- `connection_secrets`
- `identity_providers`, `federated_identity_links`, `service_integrations`, `integration_session_links`
- `repository_event_subscriptions`
- `audit_events`

Use UUIDs for primary keys. Use enums for status fields. Add proper indexes and foreign keys.

**Verification:**
- `pnpm prisma validate` passes
- `pnpm prisma generate` succeeds

### Task 5: Database Migration & Seed

**Files:**
- Migration generated by Prisma
- Create: `apps/api/prisma/seed.ts`

**What:**
- Run `prisma migrate dev --name init` to create the initial migration
- Seed script with platform types (sentry, crashlytics, linear, github, jira, trello, gitlab, bitbucket)
- Seed default execution profiles (analysis-only, web-repro, android-repro, repo-ci, mac-required)

**Verification:**
- Migration applies cleanly to `supportagent_dev`
- Seed populates reference data
- `prisma studio` shows tables

### Task 6: Fastify API Skeleton

**Files:**
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/plugins/prisma.ts`
- Create: `apps/api/src/plugins/error-handler.ts`
- Create: `apps/api/src/plugins/auth.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/routes/health.test.ts`

**What:**
- Fastify app factory in `app.ts`
- Prisma plugin that decorates fastify with `prisma` client
- Global error handler using `ApiErrorSchema`
- JWT auth plugin (bearer token validation, decorates `request.user`)
- Health check route at `GET /health`
- Server entry at `src/index.ts`
- Test: health returns 200

**Verification:**
- `pnpm --filter api dev` starts server
- `curl localhost:3001/health` returns `{"status":"ok"}`

### Task 7: Queue Abstraction

**Files:**
- Create: `apps/api/src/lib/queue.ts`
- Create: `apps/api/src/lib/queue.test.ts`

**What:**
- Queue adapter interface: `enqueue(queueName, payload)`, `createWorkerHandler(queueName, handler)`
- BullMQ implementation for local dev
- Uses `REDIS_URL` from config
- Test: enqueue and process a test message

### Task 8: Admin App Skeleton

**Files:**
- Create: `apps/admin/index.html`
- Create: `apps/admin/vite.config.ts`
- Create: `apps/admin/postcss.config.cjs`
- Create: `apps/admin/tailwind.config.ts`
- Create: `apps/admin/src/main.tsx`
- Create: `apps/admin/src/App.tsx`
- Create: `apps/admin/src/routes.tsx`
- Create: `apps/admin/src/layouts/AppLayout.tsx`
- Create: `apps/admin/src/pages/LoginPage.tsx`
- Create: `apps/admin/src/pages/OverviewPage.tsx`
- Create: `apps/admin/src/lib/api-client.ts`
- Create: `apps/admin/src/lib/query-client.ts`

**What:**
- Vite + React 18 + TypeScript
- Tailwind CSS with PostCSS
- React Router v6 with route definitions from `docs/admin-ui.md`
- TanStack Query client setup
- AppLayout with sidebar nav matching the navigation from `docs/admin-ui.md`
- Stub pages for all routes (just title + "coming soon")
- API client with base URL config and auth header injection
- Login page (placeholder form)

**Verification:**
- `pnpm --filter admin dev` serves the app
- Navigation between routes works
- Tailwind classes render

### Task 9: Worker App Skeleton

**Files:**
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/src/worker.ts`
- Create: `apps/worker/src/lib/api-client.ts`

**What:**
- Worker entry that connects to queue and listens for jobs
- API client for worker-to-API communication (context fetch, progress, artifact upload, report submission)
- Skeleton job handler that logs receipt and returns

**Verification:**
- `pnpm --filter worker dev` starts and connects to Redis
- Enqueueing a test job logs receipt

---

## Phase 2: Core API Domain

### Task 10: Connector CRUD API

**Files:**
- Create: `apps/api/src/routes/connectors.ts`
- Create: `apps/api/src/services/connector-service.ts`
- Create: `apps/api/src/repositories/connector-repository.ts`
- Create: `apps/api/src/routes/connectors.test.ts`

**What:**
- Full CRUD for connectors: list, get, create, update, delete
- Connector capability discovery endpoint
- Connector endpoint management (webhook URLs, polling config)
- Service layer with validation
- Repository layer with Prisma
- Tests for all endpoints

### Task 11: Repository Mapping CRUD API

**Files:**
- Create: `apps/api/src/routes/repository-mappings.ts`
- Create: `apps/api/src/services/repository-mapping-service.ts`
- Create: `apps/api/src/repositories/repository-mapping-repository.ts`
- Create: `apps/api/src/routes/repository-mappings.test.ts`

**What:**
- CRUD for repository mappings: list, get, create, update, delete
- Links connector to repository with execution/review/orchestration defaults
- Tests for all endpoints

### Task 12: Workflow Run API

**Files:**
- Create: `apps/api/src/routes/workflow-runs.ts`
- Create: `apps/api/src/services/workflow-run-service.ts`
- Create: `apps/api/src/repositories/workflow-run-repository.ts`
- Create: `apps/api/src/routes/workflow-runs.test.ts`

**What:**
- List workflow runs with filters (status, type, connector, repository, scenario)
- Get workflow run detail
- Create workflow run (internal, from webhook intake)
- Update workflow run status (from worker callbacks)
- Cancel workflow run
- Retry workflow run
- Status state machine enforcement (contracts.md status model)
- Tests for status transitions and all endpoints

### Task 13: Webhook Intake & Work Item Normalization

**Files:**
- Create: `apps/api/src/routes/webhooks.ts`
- Create: `apps/api/src/services/intake-service.ts`
- Create: `apps/api/src/services/normalizers/github-normalizer.ts`
- Create: `apps/api/src/services/normalizers/linear-normalizer.ts`
- Create: `apps/api/src/services/normalizers/sentry-normalizer.ts`
- Create: `apps/api/src/routes/webhooks.test.ts`

**What:**
- Webhook intake endpoints per platform: `POST /webhooks/:platformType/:connectorId`
- Signature verification per platform
- Normalize inbound payload to canonical `WorkItem` shape
- Deduplicate using `dedupeKey`
- Create `inbound_work_items` record
- Resolve repository mapping
- Queue workflow run creation
- Tests with sample webhook payloads

### Task 14: Findings & Outbound Delivery API

**Files:**
- Create: `apps/api/src/routes/findings.ts`
- Create: `apps/api/src/services/finding-service.ts`
- Create: `apps/api/src/services/outbound-delivery-service.ts`
- Create: `apps/api/src/repositories/finding-repository.ts`
- Create: `apps/api/src/routes/findings.test.ts`

**What:**
- Create/get findings for a workflow run
- Outbound delivery: post findings back to source or configured destination
- Delivery attempt tracking
- Tests

### Task 15: Worker API Endpoints

**Files:**
- Create: `apps/api/src/routes/worker-api.ts`
- Create: `apps/api/src/services/worker-api-service.ts`
- Create: `apps/api/src/routes/worker-api.test.ts`

**What:**
- `GET /worker/jobs/:jobId/context` — worker fetches full job context
- `POST /worker/jobs/:jobId/progress` — worker streams stage updates
- `POST /worker/jobs/:jobId/logs` — worker posts log chunks
- `POST /worker/jobs/:jobId/artifacts` — worker uploads artifacts
- `POST /worker/jobs/:jobId/report` — worker submits final report
- Auth via `workerSharedSecret` per dispatch attempt
- Tests

---

## Phase 3: Dispatcher & Worker Execution

### Task 16: Execution Provider Interface & Local Provider

### Task 17: Dispatcher Service

### Task 18: Triage Worker Implementation

### Task 19: End-to-End Triage Test

---

## Phase 4: Admin UI Core Pages

### Task 20: Workflow Runs List Page
### Task 21: Workflow Run Detail Page
### Task 22: Connectors Pages
### Task 23: Repository Mappings Page
### Task 24: Realtime WebSocket for Dashboard

---

## Phase 5: Build & Merge Workflows

### Task 25: Build Workflow
### Task 26: Merge Workflow
### Task 27: Review Loop Implementation

---

## Phase 6: Communication, Runtime CLI, MCP

### Task 28: Communication Channels
### Task 29: Runtime CLI Package
### Task 30: MCP Server
### Task 31: Workflow Scenarios & Trigger Policies

---

Phases 3-6 will be detailed when Phase 1-2 implementation reveals the exact shapes.
