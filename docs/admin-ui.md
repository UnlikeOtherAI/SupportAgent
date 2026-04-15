# Admin UI Plan

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). This document defines the initial information architecture for the CSR admin app.

## Build Rules

- scaffold each page with `wf` CLI
- build one route slice at a time
- wire real data at the route boundary
- run a Playwright clickthrough after each loop turn
- do not move to the next page until the current path works

Reference implementation skill: [csr-react-admin-panel.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/skills/csr-react-admin-panel.md)
Reference automation composition model: [automation-composition.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/automation-composition.md)

## Priority Order

1. `Workflow Runs`
2. `Run Detail`
3. `Apps`
4. `Connectors`
5. `Repository Mappings`
6. `Trigger Policies`
7. `Workflow Scenarios`
8. `Scenario Executions`
9. `Communication Channels`
10. `Routing Targets`
11. `Runtime Fleet`
12. `Settings and API Keys`

## Primary Navigation

- `Overview`
- `Workflow Runs`
- `Apps`
- `Connectors`
- `Repositories`
- `Routing Targets`
- `Automation`
- `Communication`
- `Runtimes`
- `Settings`

## Route Map

- `/login`
- `/`
- `/runs`
- `/runs/:workflowRunId`
- `/apps`
- `/apps/:platformType`
- `/connectors`
- `/connectors/:connectorId`
- `/repositories`
- `/repositories/:repositoryMappingId`
- `/routing-targets`
- `/routing-targets/:routingTargetId`
- `/automation/triggers`
- `/automation/scenarios`
- `/automation/scenarios/:scenarioId`
- `/automation/executions`
- `/automation/executions/:scenarioExecutionId`
- `/automation/review-profiles`
- `/automation/execution-profiles`
- `/automation/orchestration-profiles`
- `/communication`
- `/communication/conversations/:conversationId`
- `/runtimes`
- `/runtimes/:runtimeId`
- `/settings/api-keys`
- `/settings/model-access`
- `/settings/audit-log`

## Page Priorities

`/runs`

- canonical list of all `triage`, `build`, and `merge` runs
- filters by tenant, repository, connector, workflow run type, status, scenario, runtime, and trigger source

`/runs/:workflowRunId`

- the most important operator page
- shows summary, timeline, logs, findings, artifacts, review loops, and outbound activity
- exposes actions such as retry, cancel, request build, and request merge

`/apps`

- shows the app catalog from the platform registry
- lets operators install or configure apps that create connector instances, communication channels, or both
- is an install surface, not a separate runtime entity unless install state later needs its own table

`/connectors`

- lists connector instances with direction, intake mode, and capability health

`/connectors/:connectorId`

- shows capability discovery, webhook or polling status, taxonomy state, trigger support, comment handling, and image-processing settings

`/repositories`

- shows source-to-repository mappings, execution defaults, dependency policy, and notification bindings

`/routing-targets/*`

- manages canonical routing targets, outbound capability health, and routing visibility
- exposes per-destination details such as delivery type, auth health, routing usage, and recent delivery attempts

`/automation/*`

- manages trigger policies, scenario templates, scenario executions, review profiles, and execution profiles
- shows pure control-plane scenario executions even when no `workflow_run` exists

`/communication/*`

- shows channel health, pairing state, linked runs, and action audit trail

`/runtimes/*`

- shows workers and gateways, heartbeats, capabilities, recent runs, and API-key scope

`/settings/*`

- manages runtime API keys, model-access policy, and audit history

## State Boundaries

Use TanStack Query for:

- workflow runs
- run detail
- logs
- findings
- artifacts
- connectors
- routing targets
- capabilities
- taxonomy
- repository mappings
- scenarios
- triggers
- runtimes
- conversations
- audit records

Keep local React state for:

- tabs
- modal state
- form drafts
- local filtering
- split-pane sizes

Use Zustand only for genuinely cross-page UI coordination such as:

- command palette
- selected tenant context
- live inspector drawer
- global notification center

Do not mirror fetched entities into Zustand.

## Form Controls

Admin forms should not ask operators to type identifiers when the API already has a source of truth for the choices.

- Use native selects for small fixed enums.
- Use searchable comboboxes for selectable lists with more than five likely values, such as connectors, repositories, review profiles, workflow scenarios, routing targets, platform types, and execution provider types.
- Use multi-select controls for known action sets instead of comma-separated strings.
- Keep fields as text only when they are genuine free-form values or when the backing taxonomy/API is not defined yet.

Trigger builder controls should use the automation composition registry:

- installed app/source selector from connector and communication-channel records
- source selector labels the concrete installed connector, communication channel, schedule, dashboard action, MCP action, or system event source
- event selector from platform event definitions
- condition fields from platform filter definitions and connector taxonomy cache
- scenario template selector from automation scenario versions
- action family selector from action definitions
- workflow action type conflict-class selector with `triage`, `build`, `merge`, `control_plane`, and `multi_workflow`
- output destination selector from routing targets, channels, repository providers, MCP response, or parent-product integrations

The trigger builder should expose starter mode by default and advanced action-graph editing only after a scenario template is selected.

Starter mode should be a guided wizard. Advanced mode should be a structured graph form with a sticky source/event/scenario header, not a free-form JSON editor. The UI can expose read-only JSON diagnostics after the form model is stable.

Validation states should be `idle`, `validating`, `passed`, `failed`, and `stale`. Dry-run samples should come from recent captured events, platform-provided samples, or typed synthetic samples built from the event schema.

Known selector sources:

- runtime profile scope comes from registered runtime profiles and execution providers
- orchestration profile scope comes from orchestration profiles
- notification subscriptions come from communication channels and routing targets
- prompt set references come from prompt manifests and review profile versions
- channel workspace and scope identifiers come from communication channel pairings and connector taxonomy cache

Trigger lifecycle UI should show draft, validated, enabled, degraded, error, and disabled states. Validation should include capability badges, permission warnings, required approval warnings, loop-risk warnings, and a dry-run preview before enablement.
