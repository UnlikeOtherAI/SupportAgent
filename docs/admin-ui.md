# Admin UI Plan

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). This document defines the initial information architecture for the CSR admin app.

## Build Rules

- scaffold each page with `wf` CLI
- build one route slice at a time
- wire real data at the route boundary
- run a Playwright clickthrough after each loop turn
- do not move to the next page until the current path works

Reference implementation skill: [csr-react-admin-panel.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/skills/csr-react-admin-panel.md)

## Priority Order

1. `Workflow Runs`
2. `Run Detail`
3. `Connectors`
4. `Repository Mappings`
5. `Trigger Policies`
6. `Workflow Scenarios`
7. `Communication Channels`
8. `Outbound Destinations`
9. `Runtime Fleet`
10. `Settings and API Keys`

## Primary Navigation

- `Overview`
- `Workflow Runs`
- `Connectors`
- `Repositories`
- `Outbound Destinations`
- `Automation`
- `Communication`
- `Runtimes`
- `Settings`

## Route Map

- `/login`
- `/`
- `/runs`
- `/runs/:workflowRunId`
- `/connectors`
- `/connectors/:connectorId`
- `/repositories`
- `/repositories/:repositoryMappingId`
- `/outbound-destinations`
- `/outbound-destinations/:outboundDestinationId`
- `/automation/triggers`
- `/automation/scenarios`
- `/automation/scenarios/:scenarioId`
- `/automation/review-profiles`
- `/automation/execution-profiles`
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
- filters by tenant, repository, connector, workflow type, status, scenario, runtime, and trigger source

`/runs/:workflowRunId`

- the most important operator page
- shows summary, timeline, logs, findings, artifacts, review loops, and outbound activity
- exposes actions such as retry, cancel, request build, and request merge

`/connectors`

- lists connector instances with direction, intake mode, and capability health

`/connectors/:connectorId`

- shows capability discovery, webhook or polling status, taxonomy state, trigger support, comment handling, and image-processing settings

`/repositories`

- shows source-to-repository mappings, execution defaults, dependency policy, and notification bindings

`/outbound-destinations/*`

- manages delivery targets, outbound capability health, and routing visibility
- exposes per-destination details such as delivery type, auth health, routing usage, and recent delivery attempts

`/automation/*`

- manages trigger policies, workflow scenarios, review profiles, and execution profiles

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
- outbound destinations
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
- Use searchable comboboxes for selectable lists with more than five likely values, such as connectors, repositories, review profiles, workflow scenarios, outbound destinations, platform types, and execution provider types.
- Use multi-select controls for known action sets instead of comma-separated strings.
- Keep fields as text only when they are genuine free-form values or when the backing taxonomy/API is not defined yet.

Current taxonomy gaps that still need explicit product decisions before becoming dropdowns include runtime profile scope, orchestration profile scope, notification subscriptions, connector trigger labels/events/intents, prompt set references, and channel workspace/scope identifiers.
