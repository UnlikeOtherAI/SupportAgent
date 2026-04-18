# Support Agent Tech Stack

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). `Worker` always means the runtime that executes a job. `Gateway` always means a customer-managed runtime that routes work to workers. `Dispatcher` means the Support Agent control-plane component that assigns work to execution providers.

## Architecture Overview

Support Agent should start as a TypeScript monorepo with three runtime surfaces: an API, a CSR admin app, and background workers. The API owns configuration, orchestration, persistence, and external callbacks. The admin app is an operator console. The workers handle repository cloning, `triage`, `build`, `merge`, reproduction attempts, and long-running automation.

This should not start as microservices. One repo, one database, one queue abstraction, one API service, one admin app, and one worker service is the minimum-complexity shape that still fits the product requirements.

The initial worker and triage contract should be ported from `../KiloSupport` and then generalized. That existing implementation already proves the API-only worker model, structured reporting, artifact upload flow, and cloud worker spawning model.

The same package boundaries should support all three product-facing modes:

- standalone SaaS
- standalone enterprise
- integrated mode such as `docgen`

Integrated mode should change identity ingress and embedding, not create a second orchestration stack.

Reference security posture: [trust-model.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/trust-model.md)
Reference deployment and auth modes: [deployment-modes.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/deployment-modes.md)
Reference identity provider facade: [identity-providers.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/identity-providers.md)
Reference machine build spec: [llm/index.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/llm/index.md)
Reference build flow: [pr-workflow.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/pr-workflow.md)
Reference review loop model: [review-loops.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/review-loops.md)
Reference review process: [review-process.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/review-process.md)
Reference core contracts: [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md)
Reference local execution intelligence: [local-orchestrator.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/local-orchestrator.md)
Reference dependency model: [work-item-dependencies.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/work-item-dependencies.md)
Reference feature delivery model: [feature-delivery.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/feature-delivery.md)
Reference workflow scenario model: [workflow-scenarios.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/workflow-scenarios.md)
Reference automation composition model: [automation-composition.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/automation-composition.md)
Reference chat control model: [communication-channels.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/communication-channels.md)
Reference runtime delivery model: [runtime-cli.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/runtime-cli.md)
Reference machine-facing setup docs: [llm/index.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/llm/index.md)

## Logical Architecture

- Admin app: operator UI for connectors, source mappings, workflow runs, findings, logs, and routing.
- API: auth, CRUD, webhook intake, run orchestration, result storage, outbound callbacks, audit history, and configuration management.
- Integration-auth layer: signed assertion exchange and service-to-service verification for embedded products such as `docgen`.
- Worker: executes `triage`, `build`, and `merge` jobs against cloned repositories.
- Local orchestrator: profile-driven runtime layer that directs Claude, Codex, or both inside the customer-owned worker environment by applying Support Agent instruction manifests.
- Dispatcher: control-plane component that claims queued jobs and dispatches them to execution providers.
- Model-access layer: runtime path for calling Claude or Codex through the Support Agent proxy by default, with tenant-provider mode optional by policy.
- Connector layer: platform adapters that can act as inbound connectors, outbound connectors, or both.
- Communication layer: chat and notification adapters for Slack, Teams, WhatsApp, and similar channels.
- Outbound layer: delivery adapters for commenting back, creating issues, and linking findings into external systems when separated from inbound connector logic.
- Build layer: code-change and PR-generation workflows triggered after triage or by feature-delivery scenarios.
- Merge layer: branch-sync, revalidation, conflict-resolution, and merge-execution workflows triggered after build.
- Feature-delivery layer: epic-driven, dependency-aware scenario templates or batch orchestration that may span multiple tickets and several runtime executions, while still creating `build` workflow runs rather than a fourth top-level workflow type.
- Review layer: inbound PR or merge-request review scenarios triggered from repository connectors and compiled into the normalized runtime contract.
- Review-control layer: centrally managed review profiles, prompt sets, and multi-round critique loops fetched by runtimes at execution time and applied inside `triage`, `build`, or `merge`.
- Orchestration-control layer: centrally managed orchestration profiles and prompt manifests consumed by the local orchestrator inside customer runtimes.
- Automation composition layer: verified incoming events, trigger matching, scenario execution, action outputs, approvals, and routing across connectors, channels, schedules, dashboard actions, MCP actions, and system events.
- Workflow-scenario layer: the workflow-run subset of automation scenarios that creates or coordinates `triage`, `build`, and `merge` workflow runs.
- MCP management layer: exposes the same connector and routing configuration model used by the admin UI.
- Persistence layer: stores connectors, repositories, issues, workflow runs, findings, logs, and delivery targets.

Examples:

- Sentry: inbound only by default
- Crashlytics: inbound only by default
- Linear: inbound and outbound
- GitHub Issues: inbound and outbound
- Jira: inbound and outbound
- Trello: inbound and outbound

GitHub and GitHub Issues also need a local-runtime polling variant for operator-managed environments:

- admin install flow offers OAuth, PAT, and local `gh` auth modes where applicable
- local `gh` mode stores typed connector config with `auth_mode=local_gh`
- repository selection is populated through the registered local runtime or gateway, which calls the local `gh` CLI through a shared connector helper package and returns repository options to the API
- polling targets are derived from enabled repository mappings plus connector polling interval settings
- the registered local runtime or gateway owns the polling timer and submits observed events; the API stores polling config and performs central trigger matching
- polling receipts are submitted back to the API as `AutomationEvent` payloads with local-runtime audit identity, not as direct database writes

Communication channel examples:

- Slack: communication and notification channel
- Teams: communication and notification channel
- WhatsApp Business: paired communication and notification channel

Each connector must also understand platform taxonomy where applicable, such as labels, tags, projects, categories, teams, boards, and issue types.

Where the source platform supports it, connectors should also understand dependency relationships between work items.

Where the source platform supports it, connectors should also understand:

- comment threads
- explicit bot mentions in comments
- attachments, especially screenshots and design images
- parent-child or epic hierarchy
- issue-link editing when dependency normalization is allowed

Outbound capability examples should also include:

- PR creation
- draft PR creation
- review comment updates
- label or tag changes used to trigger build
- threaded comment replies

Inbound repository connector capability examples should also include:

- PR opened event
- PR updated event
- ready-for-review event
- review-request or label-trigger event

Execution provider examples:

- `local-host`
- `gcp-vm`
- `aws-batch`
- `reverse-connected-host`
- `mac-mini`
- `github-actions`

For privately hosted machines such as local servers or Mac minis, execution should use reverse connection mode rather than requiring direct inbound network reachability.

Enterprise environments may also supply a customer-built worker or a customer-built gateway as long as it conforms to the published runtime contract.

## Physical / Deployment Topology

- `admin`: deployed separately, served at the root domain.
- `api`: deployed separately, served on an API subdomain or behind `/api`.
- `worker`: separate runtime for long-running jobs and repo execution.
- `dispatcher`: dispatches queued jobs to execution providers.
- `runtime-cli`: customer-installed package that registers as a worker or gateway in customer-owned environments.
- `postgres`: primary relational database.
- `queue`: managed queueing in production, Redis-backed queueing locally.
- `gcs`: object storage for large logs, artifacts, and exported outputs.

Recommended Google Cloud baseline:

- Cloud Run for `admin`.
- Cloud Run for `api`.
- Compute Engine instance template for `worker` so the image can carry the heavier toolchain and reproduction dependencies.
- Cloud SQL for PostgreSQL.
- Pub/Sub for production worker dispatch.
- Cloud Logging for centralized logs.

On-prem or customer-hosted control-plane deployments should preserve the same package boundaries and runtime contracts. The hosted-cloud baseline is the default deployment recommendation, not the only supported topology.

For integrated mode:

- the parent product may embed the admin or workflow surface
- the parent product remains the primary login surface
- Support Agent still issues its own local stateless session token after token exchange
- build and execution still run through the same dispatcher, runtime CLI, gateway, and worker contracts

## API Backend

- Runtime: Node.js 20+
- Language: TypeScript
- Framework: Fastify
- Validation: Zod
- ORM: Prisma
- Database: PostgreSQL
- Queue API: queue adapter with local BullMQ and production Pub/Sub

Rules:

- Keep controllers thin.
- Put orchestration and triage logic in service modules.
- Keep Prisma inside API code and migration code only.
- Sync registry-backed platform types into Prisma during API startup so connector install surfaces do not rely on a separate seed task in production.
- Validate every external payload at the edge, especially webhook inputs.
- Keep workers API-only with no direct database access.
- Keep worker dispatch separate from worker execution.
- Expose repository-option lookup for local-`gh` connectors from the API rather than calling `gh` directly from the browser.
- Keep polling intake API routes separate from webhook intake routes, but normalize both into `automation_events` before continuation resolution or start-trigger matching. A matched start scenario may then create or update `InboundWorkItem` and `workflow_runs` records when needed.

## Web Application

- Framework: React + Vite
- Rendering model: fully CSR
- Styling: Tailwind CSS
- Routing: React Router
- Server state: TanStack Query
- Local UI state: Zustand only where React state is not enough

Rules:

- Do not use SSR for the admin panel.
- Keep the admin app dependent on the API only.
- No direct database access or shared backend runtime code in the frontend.

The admin app must provide:

- live jobs dashboard
- workflow run detail view
- checkpoint-derived loop convergence timeline on workflow run detail
- two-phase run stop controls (`cancel_requested` then optional force-stop)
- force-stop timing derived from `cancelRequestedAt` so worker progress heartbeats do not delay escalation
- realtime progress updates
- full available log viewer for each run, subject to output-visibility policy
- build workflow controls
- merge workflow controls
- build review status
- channel notification and conversation pairing controls inside Configuration
- repository review run visibility
- skills library pages with builtin/user clone visibility
- executor library pages with YAML editing and role-aware skill binding
- per-connector trigger configuration for triage, build, and merge starts
- workflow scenario management through a visual trigger-action-output designer
- action-node executor and task-prompt binding inside the workflow designer
- scenario trigger allowlist editing for GitHub users, teams, and default allow/deny policy
- connector-specific install flows that can switch between OAuth, PAT, and local `gh` setup without falling back to generic secret fields
- a polling setup panel for local-`gh` GitHub connectors with owner filter, repository dropdown, and interval controls

Implementation rules:

- scaffold admin pages with `wf` CLI
- build one route slice at a time
- run Playwright clickthrough validation after each implementation loop turn
- keep route containers at the page boundary and feature slices underneath

## Worker Runtime

- Runtime: Node.js 20+
- Job execution: queue-driven worker processes
- Repository operations: `git` on local ephemeral workspaces
- Browser automation: Playwright
- Android support: Android SDK, emulator tooling, and `app-reveal` where needed

Rules:

- Workers must run jobs in isolated per-run directories.
- Treat reproduction as capability-based and configurable.
- Keep a hard separation between job orchestration and tool execution adapters.
- Workers fetch context, stream progress, upload artifacts, and submit final reports through API endpoints only.
- The runtime CLI should be the canonical customer-facing implementation of worker or gateway registration.
- The runtime CLI should be the canonical prompt-fetch, manifest-fetch, and connection layer for workers and gateways.
- Remote skill dispatches must fetch executor YAML and `SKILL.md` bodies through authenticated by-hash API endpoints rather than direct database reads.
- The worker HTTP polling path is the authoritative cancel transport until API-to-gateway session routing exists, and it must read both `status` and `cancelForceRequestedAt`.
- The worker-side GitHub helper layer must be shared with the API-facing local-runtime RPC for local-`gh` repo discovery, issue fetches, issue comments, and label management.
- GitHub triage delivery must post the discovery comment before labeling, and it must ensure `triaged` and severity labels exist before applying them so local polling does not requeue already-processed issues.

Reference: [worker-architecture.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/worker-architecture.md)
Reference: [worker-deployment.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/worker-deployment.md)

## Dispatcher

The dispatcher should:

- claim queued `triage` workflow runs
- claim queued build runs
- claim queued merge runs
- choose an execution provider
- dispatch a normalized worker job
- track provider job identifiers
- poll or receive provider status
- handle workflow dispatch cancellation, timeout, and retry policies
- respect blocked-state scheduling decisions from the control plane

The dispatcher should not contain source-specific connector logic.

Scenario action retry scheduling belongs to the API-owned scenario scheduler over `scenario_action_executions.retry_scheduled`. The dispatcher retries dispatch attempts for existing `workflow_runs`; it does not decide whether a scenario action should be attempted again.

The platform should also support review-oriented repository scenarios using the same gateway and execution-provider model. Inbound PR or merge-request review starts as a normalized `triage` workflow run with `workItemKind=review_target` and an attached review profile. If validation requires code changes or merge readiness checks, the scenario can create child `build` or `merge` runs from that triage result; it must not create a fourth top-level runtime type.

For reverse-connected runtimes, the gateway should also:

- maintain its own upstream session to the control plane
- normalize downstream worker activity when it manages a private pool
- preserve upstream job identity when forwarding work internally
- accept incremental log chunks over the session and persist them upstream
- keep full reports and bulky uploads on the API path

The dispatcher owns cloud-side reverse-session state:

- track registered online runtimes
- evaluate heartbeat loss
- mark runs `lost` when the session breaks mid-run
- apply retry or reschedule policy
- assign work only to online compatible runtimes

## Model Provider Access

Default mode:

- runtime calls Claude or Codex through the Support Agent proxy

Optional mode:

- selected tenants may use their own Claude or Codex provider credentials

In either mode, prompt delivery, orchestration policy, and review policy should still be controlled by Support Agent.

Canonical rule:

- in hosted SaaS mode, `proxy` means the Support Agent-hosted proxy
- in customer-hosted control-plane mode, `proxy` means the customer-hosted Support Agent proxy path
- `tenant-provider` means raw provider credentials stay outside hosted SaaS by default

Hosted SaaS should not store raw tenant Claude or Codex keys by default. If tenant-provider mode is enabled for hosted deployments, the raw provider secret should live in the customer runtime or a customer-managed secret integration, while Support Agent stores only scoped metadata and policy.

## Queueing Strategy

Use a queue abstraction from the start.

- local development: Redis + BullMQ
- production long-running triage jobs: Google Cloud Pub/Sub dispatch queues consumed by the dispatcher before provider assignment
- optional short HTTP background tasks later: Cloud Tasks

Why:

- BullMQ is fine locally because Redis already exists on the dev machine.
- Pub/Sub supports parallel dispatch consumers and is documented by Google Cloud as suitable for task distribution.
- Cloud Tasks is better for explicit HTTP invocation, but it has target processing-duration limits and is a worse fit for heavy clone, build, emulator, or reproduction runs.

This recommendation is based on the current plan to run heavier workers on prebuilt Google Cloud instances rather than keeping all execution inside short-lived HTTP services.

## Database and Data Access

- Primary database: PostgreSQL
- Access library: Prisma
- Migration tool: Prisma Migrate

Core tables should cover:

- platform_types
- connectors
- connector_endpoints
- connector_capabilities
- connector_taxonomy_cache
- connector_scope_mappings
- work_item_dependencies
- dependency_snapshots
- dependency_policies
- dependency_overrides
- connector_comment_threads
- connector_comment_messages
- connector_mentions
- communication_channel_types
- communication_channels
- communication_channel_pairings
- communication_channel_memberships
- communication_channel_policies
- conversation_threads
- conversation_messages
- conversation_action_requests
- conversation_subscriptions
- connection_secrets
- repository_mappings
- routing_rules
- routing_targets
- trigger_policies
- trigger_conditions
- automation_events
- automation_event_quarantine_records
- platform_event_definitions
- action_definitions
- output_type_definitions
- automation_scenarios
- automation_scenario_versions
- scenario_executions
- scenario_action_executions
- action_outputs
- action_delivery_attempts
- approval_requests
- dry_run_sessions
- dry_run_results
- loop_prevention_refs
- rate_limit_policies
- rate_limit_events
- execution_profiles
- runtime_profiles
- execution_providers
- execution_provider_hosts
- execution_host_sessions
- runtime_api_keys
- runtime_api_key_audit_events
- orchestration_profiles
- orchestration_profile_versions
- prompt_manifests
- worker_dispatches
- workflow_log_events
- workflow_runs
- workflow_run_reviews
- review_profiles
- review_profile_versions
- review_prompt_sets
- review_round_outputs
- review_evaluations
- review_comments
- identity_providers
- federated_identity_links
- service_integrations
- integration_session_links
- repository_event_subscriptions
- inbound_work_items
- findings
- audit_events

The schema should prefer generic connector and delivery records over source-specific core enums. Source-specific metadata should live in normalized payload snapshots or connector-specific fields. A connector record should be able to declare whether it supports inbound intake, outbound delivery, or both.

Canonical record and field names should follow [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md). `automation_events` is the canonical incoming signal record. `scenario_executions` is the canonical parent automation context. `workflow_runs` is the canonical table for executable repository/runtime work. Do not introduce separate primary tables for triage, build, or merge runs.

Naming split:

- `routing_rules` and `routing_targets` are configuration records
- reusable outbound destinations are represented by `routing_targets`
- `action_outputs` and `action_delivery_attempts` are execution-time output and delivery records for arbitrary scenario actions
- `action_outputs.deliveryStatus` captures audit-only suppression states such as `suppressed_internal` even when no outbound delivery attempt row is created
- existing `outbound_delivery_attempts` should be treated as legacy workflow-output delivery until migrated or aliased into `action_delivery_attempts`
- existing `workflow_scenarios`, `workflow_scenario_bindings`, `workflow_scenario_steps`, and `outbound_destinations` should be treated as legacy tables, aliases, or read-only projections during migration. New writes should target `automation_scenarios`, `automation_scenario_versions`, `trigger_policies`, `routing_rules`, and `routing_targets`.

Legacy migration rule:

- active writes to legacy scenario or outbound destination tables must be blocked or translated at the API boundary
- `workflow_scenarios` project to `automation_scenarios` and workflow-backed `automation_scenario_versions`
- `workflow_scenario_bindings` project to scoped `trigger_policies`
- `workflow_scenario_steps` project to action graph nodes
- `outbound_destinations` project to `routing_targets`
- no runtime matcher, dispatcher, or delivery adapter should read legacy tables as source of truth after the projection exists

Connector configuration should also track:

- discovered capabilities for the connected account
- preferred intake mode
- effective intake mode after capability detection
- taxonomy selections such as labels, tags, project IDs, team IDs, board IDs, or issue types
- dependency capability support and dependency polling or webhook mode where available
- hierarchy-read, attachment-read, image-read, comment-thread-read, and mention-detect capability where available
- image-description policy where attachments can influence work
- issue-link edit capability where dependency normalization is allowed
- trigger policies for triage start
- trigger policies for build start
- build trigger intent such as `fix` or `feature`
- assigned workflow scenarios
- build trigger labels or tags where supported
- auto-PR settings where supported

Automation composition configuration should also track:

- app catalog install records as registry-backed UI state that creates connector instances or communication channels under Configuration
- workflow designer graphs persisted on workflow scenario steps
- platform event definitions and filterable fields
- action definitions and risk levels
- output type definitions and visibility policy
- trigger lifecycle state
- automation scenario graph versions
- dry-run validation results
- approval requirements for customer-visible, high-risk, or destructive actions
- loop-prevention refs for bot-authored connector and channel events
- rate-limit policies and rate-limit events

Review configuration should also track:

- default review profile
- allowed review profiles
- max review rounds
- mandatory human approval settings
- whether build may continue automatically after passing review
- precedence resolution across workflow run, scenario, repository mapping, and project defaults

Execution orchestration should also track:

- default orchestration profile
- allowed model routing mode
- Claude and Codex availability requirements
- prompt manifest version
- fallback routing behavior

Feature-delivery scenario configuration should also track:

- epic readiness markers such as `AI ready`
- whether dependency normalization is allowed
- branch strategy for multi-ticket delivery
- whether independent tickets may run in parallel
- optional distribution target such as TestFlight or preview deployment
- whether connector comments may trigger follow-up work when the bot is mentioned

Workflow-scenario configuration should also track:

- scenario key and display name
- enabled status
- allowed connectors and mappings
- trigger-policy scopes and selected automation scenario versions
- default execution, orchestration, and review profiles
- notification and distribution policies

New implementation should treat `automation_scenarios` and `automation_scenario_versions` as canonical. Existing `workflow_scenarios`, `workflow_scenario_bindings`, and `workflow_scenario_steps` are the workflow-backed legacy/projection layer until they are migrated or exposed as filtered views over automation scenarios and trigger policies. They must not decide new trigger-to-scenario precedence. Pure control-plane scenarios may have no `workflowType` until they create a workflow-run action.

Trigger policies select automation scenario versions. Do not introduce direct trigger-owned action tables in new implementation; action graphs live on `automation_scenario_versions`.

Communication channel configuration should also track:

- linked tenant or workspace
- linked team or conversation scope
- allowed actions
- notification preferences
- channel identity and membership resolution state

Runtime API key management should also track:

- key label
- tenant and environment scope
- allowed runtime mode
- allowed execution profiles
- last used timestamp
- disabled or revoked state

The same persisted model must be editable through both the admin UI and an MCP management interface.

## Shared Packages

Recommended monorepo structure:

```text
apps/
  admin/
  api/
  worker/
packages/
  config/
  contracts/
  connector-sdk/
  delivery-sdk/
  execution-sdk/
  runtime-cli/
  reverse-connection/
  mcp-server/
  ui/
```

Package rules:

- `config`: environment parsing and shared constants.
- `contracts`: Zod schemas and DTOs shared between admin and API.
- `connector-sdk`: normalized connector interfaces and helper utilities.
- `delivery-sdk`: outbound destination interfaces and helper utilities.
- `execution-sdk`: dispatcher types and execution provider interfaces.
- `runtime-cli`: installable customer runtime that implements worker or gateway registration and execution.
- `reverse-connection`: protocol, registration logic, and control-channel handling for privately hosted workers or gateways.
- `mcp-server`: Support Agent MCP server exposing configuration and operational tools.
- `ui`: shared admin UI primitives only.

The runtime contract must be documented in a machine-consumable way so external coding agents can implement compatible workers and gateways.

For `docgen` integration, the first implementation should consume Support Agent execution through the integration API and the existing runtime CLI, dispatcher, gateway, and worker contracts. Do not fork a second build-orchestration stack inside `docgen`.

Do not put Prisma models, database code, or worker-only execution code into shared packages.

## Auth, Validation, and Error Handling

- Auth for standalone SaaS: Support Agent-managed OIDC login, followed by signed bearer-token issuance
- Auth for standalone enterprise: tenant-scoped enterprise SSO, preferably OIDC and SAML where required
- Auth for integrated mode: short-lived signed assertion exchange from the parent product into a Support Agent bearer token
- Input validation: Zod everywhere at API boundaries
- Error shape: one standard API error envelope
- Auditability: every operator action and delivery attempt should be recorded
- Dispatch authentication: workers and gateways authenticate long-lived registration with `runtimeApiKey`; each accepted dispatch attempt receives a short-lived `workerSharedSecret` bound to tenant, workflow run, and dispatch attempt as defined in [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md)

Use the canonical contracts in [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md) for automation events, platform event definitions, scenario executions, action outputs, normalized work items, workflow runs, findings, final reports, and manifest references.

Rules:

- Keep human identity separate from machine identity.
- Do not treat runtime API keys, upstream integration assertions, and user sessions as interchangeable credentials.
- For integrated mode, prefer asymmetric signed assertions plus token exchange over tenant-global shared secrets.
- Carry upstream session ids only as correlated metadata. Support Agent should still create its own local stateless token context and any issuance identifiers it needs for audit.
- API authentication should depend only on incoming bearer-token validation, so it remains compatible with multiple load balancers and non-frontend clients.

## MCP Configuration

Support Agent should expose its configuration model through MCP.

Rules:

- MCP must operate on the same database-backed config model as the admin UI.
- MCP must support creating connector instances, enabling inbound and outbound capabilities, mapping repositories, defining triggers, validating scenario graphs, dry-running trigger matches, and defining output routing rules.
- MCP must support multiple inbound and outbound paths at the same time.
- Secrets should be write-only from MCP after creation and only exposed back as masked metadata.
- MCP must support capability discovery so the app can determine whether webhook intake is actually available on the connected account.
- MCP must support taxonomy-aware configuration such as labels, tags, categories, projects, teams, boards, and issue types.
- MCP should also support execution provider configuration and host registration.
- MCP should support registration and capability inspection for reverse-connected workers or gateways running on private machines or servers.
- MCP should support build workflow settings including manual trigger policy, auto-PR mode, and build trigger labels or tags.

Reference: [mcp-configuration.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/mcp-configuration.md)

## Data Flow

```text
External source -> API intake/webhook or polling -> AutomationEvent
-> trigger matching -> ScenarioExecution
-> optional InboundWorkItem and repo mapping lookup
-> optional workflow run queued -> dispatcher assigns execution provider
-> provider worker/host investigates and sends progress and incremental log chunks to backend
-> action outputs stored in Postgres / large artifacts stored in GCS
-> optional build job triggered manually or automatically
-> API exposes results to admin
-> API sends comments, issue creation requests, or callbacks to the configured outbound connector
```

Reverse-connected workers should use WebSocket for control messages, heartbeats, and wake-up notifications. Incremental log chunks and final reports should be persisted through HTTP API endpoints so reconnects do not lose log history.
Reverse-connected stop control is two-phase: `cancel_requested` sets a checkpoint-visible cancel flag, while `cancel_force` terminates the tracked executor subprocess with `SIGTERM` and escalates to `SIGKILL` after a short timeout if it does not exit.

## Architectural Rules

- API and admin are separate deployable units.
- Worker execution is separate from the API runtime.
- PostgreSQL is the system of record.
- Local Redis is for development queueing only and never the system of record.
- Prisma stays out of the frontend.
- Reproduction is opt-in and capability-aware.
- Connectors must normalize source data before it enters core workflows.
- The system must be able to send findings back to the originating system or a configured target.
- The worker runtime must remain API-only with no direct database coupling.
- A single platform integration may operate in both inbound and outbound roles.
- Effective intake mode must be based on discovered account capabilities, not just platform-level assumptions.
- Worker execution must go through a provider abstraction rather than directly depending on one cloud runtime.
- Privately hosted execution machines should connect outward to the platform through a persistent session rather than relying on inbound access.
- Control messages for reverse-connected hosts should use the live session, while artifacts and final reports should be sent back through HTTP `POST` API calls rather than over WebSocket.
- Live log chunks from reverse-connected hosts may use the WebSocket session, but they must be persisted server-side and exposed to the dashboard through the backend.
- Current gap: the API does not yet own a direct bridge into gateway worker sessions, so control-plane cancel broadcast may remain a logged no-op until API-to-gateway session routing exists. Worker-side HTTP polling remains the required fallback.
- Enterprise mode should assume customer-executed workers so repository access can stay entirely inside the customer's environment.
- PR generation must be a separate workflow from triage, even when auto-PR is enabled.

## Anti-Patterns

- Putting all triage logic into webhook handlers.
- Running long-lived repo or emulator work inside the API process.
- Letting frontend code import backend internals.
- Designing source-specific workflows directly into core domain models.
- Starting with Kubernetes before the worker model is stable.

## Initial Recommendation

Start with:

- TypeScript monorepo
- Fastify API
- React + Vite admin app
- Tailwind CSS
- PostgreSQL
- Prisma
- BullMQ locally
- Pub/Sub in Google Cloud production
- Compute Engine workers
- Cloud Run for API and admin

This is the smallest stack that still supports webhook intake, admin operations, long-running triage jobs, and future PR automation.

## Skill Coverage

The current skill set is enough to proceed with the initial build. The project already includes local admin-panel guidance in [csr-react-admin-panel.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/skills/csr-react-admin-panel.md), and the existing architecture, frontend, documentation, and testing skills are sufficient for this project.

## Local Development Infrastructure

Use the existing local services on this machine.

- PostgreSQL: reuse the running local server
- Redis: reuse the running local Docker-backed instance

Initial local PostgreSQL setup commands:

```bash
createuser supportagent --pwprompt
createdb supportagent_dev -O supportagent
```

Typical local connection values:

```text
DATABASE_URL=postgresql://supportagent:<password>@localhost:5432/supportagent_dev
REDIS_URL=redis://localhost:6379
```
