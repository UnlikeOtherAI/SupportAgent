# MCP Configuration Model

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). MCP configuration may target either `workers` directly or `gateways` that manage pools of workers.

Canonical naming reference: [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md) and [techstack.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/techstack.md).
Automation composition reference: [automation-composition.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/automation-composition.md).

## Purpose

Support Agent needs to be configurable through MCP, not only through the admin UI.

That means the system must expose its setup model in a way that an MCP client can:

- create and update connectors
- enable inbound and outbound roles
- define repository mappings
- define output routing rules
- define trigger rules for any supported incoming event
- define automation scenarios and workflow-backed scenario templates
- test credentials and connectivity
- discover actual account capabilities
- configure labels, tags, projects, categories, boards, and similar platform taxonomy
- configure dependency-aware behavior when the connector supports it
- configure image and attachment handling where the connector supports it
- configure comment and mention behavior where the connector supports it
- enable multiple inbound and outbound paths at the same time
- configure communication and notification channels
- pair conversations to the correct workspace, team, connector, or repository scope
- create and manage runtime API keys
- register customer-owned runtimes cleanly

## Core Rule

Configuration must have one source of truth in the application database.

The admin panel and MCP tools must both operate on the same persisted model. MCP is not a separate config system. It is another control surface over the same data.

## What MCP Should Configure

### Platform Definition

A platform type describes what kind of integration exists.

Examples:

- sentry
- crashlytics
- linear
- github_issues
- jira
- trello
- generic-webhook

This is the reusable code-level connector type, not a customer-specific connection.

### Connector

A connector is a configured installation of a platform.

Examples:

- `sentry-main-production`
- `linear-support-team`
- `github-public-issues`
- `jira-enterprise-board`

Each connector should store:

- connector type
- display name
- auth and secret references
- endpoint or base URL if needed
- project, workspace, team, or board identifiers
- enabled status
- preferred intake mode
- effective intake mode
- last capability check result

## Platform Taxonomy

Most platforms expose scope and routing concepts such as:

- labels
- tags
- projects
- categories
- teams
- boards
- issue types
- statuses

Support Agent must treat these as first-class configuration inputs.

Examples:

- create outbound issue in a specific Linear team and project
- add GitHub labels on created issues
- comment only on issues inside a configured Jira project
- route Trello output into a configured board and list

These mappings must be editable from MCP and the admin UI.

## Connector Capabilities

Each connector must declare its supported and enabled capabilities separately.

Supported capabilities come from the platform type.
Enabled capabilities come from project configuration.

Capability examples:

- inbound webhook
- inbound polling
- dependency-read
- dependency-status-read
- attachment-read
- image-read
- comment-thread-read
- mention-detect
- comment-webhook
- outbound comment
- outbound issue creation
- outbound issue update
- outbound external link creation

This supports cases like:

- Linear connection enabled for both inbound and outbound
- Sentry connection enabled for inbound only
- GitHub Issues enabled as outbound only for one workspace and inbound for another

The system must distinguish between:

- platform-supported capabilities
- account-supported capabilities
- currently enabled capabilities

For example, a platform may support webhooks in general, but the connected account may not have webhook access on the current tariff. In that case the effective inbound mode should become polling if polling is supported.

## Capability Discovery

Each connector should support a capability discovery step.

Discovery should answer questions such as:

- can this account create or manage webhooks?
- can this account poll the necessary endpoints?
- can this account create issues?
- can this account add comments?
- can this account set labels, tags, or categories?
- can this account read project, team, board, or category metadata?
- can this account read issue or ticket dependency information?
- can this account read attachments or images?
- can this account read comment threads?
- can this account detect or receive bot mentions?
- can this account receive comment or mention events by webhook?

The result should be stored as capability metadata and surfaced in both MCP and the admin UI.

Capability discovery metadata should also include:

- `checkedAt`
- `expiresAt`
- `confidence`
- `fallbackMode`

Canonical freshness rule:

- capability and webhook checks are not permanent
- onboarding must record the last successful discovery time
- the platform should re-run discovery after auth changes and on a recurring schedule
- when webhook support drifts or delivery fails persistently, the effective intake mode may fall back to polling only when policy allows it

## Repository Mapping

Inbound events must be mapped to a repository or project target before triage starts.

Mappings should support:

- platform connection instance
- source scope identifier
  - sentry project
  - linear team or project
  - github repository
  - jira project key
- target repository
- target branch or revision strategy
- execution profile
- reproduction policy
- dependency policy
- attachment handling policy
- comment or mention handling policy
- preferred comment intake mode
- source taxonomy filters such as labels, tags, categories, or projects

This must be configurable over MCP.

## Output Routing Rules

Routing decides where typed action outputs go after a scenario action produces them. Findings after triage are one output type, not the whole routing model.

Routing must support:

- same-platform return
- cross-platform delivery
- fan-out to multiple outbound destinations
- per-connector or per-scope overrides
- platform taxonomy on the outbound side
- customer-visible approval policy
- output visibility policy

Routing must not own:

- post-triage build behavior, which belongs in automation scenario graphs
- post-build merge behavior, which belongs in automation scenario graphs
- event deduplication, which belongs to `automation_events` and trigger matching
- deterministic scenario precedence, which belongs to scoped `trigger_policies`

Examples:

- inbound `linear-support-team` -> comment back to same Linear issue
- inbound `sentry-main-production` -> create issue in `linear-support-team`
- inbound `sentry-main-production` -> create issue in `github-bugs` and comment back to Sentry
- inbound `jira-enterprise-board` -> comment back to Jira and also send webhook callback to another system
- inbound `sentry-main-production` -> create issue in a specific Jira project with configured issue type and labels
- inbound `linear-support-team` -> deliver triage result to a configured Slack support channel
- inbound `slack-support-channel` -> deliver approval request to an operator and send the approved reply back to the source issue

## Recommended Data Model

The config model should include at least:

- `platform_types`
- `connectors`
- `connector_capabilities`
- `communication_channels`
- `communication_channel_pairings`
- `communication_channel_policies`
- `conversation_subscriptions`
- `runtime_api_keys`
- `runtime_api_key_audit_events`
- `connection_secrets`
- `connector_taxonomy_cache`
- `dependency_policies`
- `dependency_overrides`
- `repository_mappings`
- `routing_rules`
- `routing_targets`
- `trigger_policies`
- `trigger_conditions`
- `automation_events`
- `platform_event_definitions`
- `action_definitions`
- `output_type_definitions`
- `automation_scenarios`
- `automation_scenario_versions`
- `scenario_executions`
- `scenario_action_executions`
- `action_outputs`
- `action_delivery_attempts`
- `approval_requests`
- `dry_run_sessions`
- `dry_run_results`
- `loop_prevention_refs`
- `rate_limit_policies`
- `rate_limit_events`
- `execution_profiles`

Prefer these canonical names over synonyms such as `connection_instances` or `connection_taxonomy_entries`.

Trigger policies select automation scenario versions and own trigger-to-scenario precedence through their repository-mapping, connector/source, or tenant-default scope. Do not store direct trigger-owned action lists in new implementations; action ownership belongs to `automation_scenario_versions`.

## MCP Surface

Support Agent should expose an MCP management surface for configuration.

Recommended MCP operations:

- `list_platform_types`
- `list_connectors`
- `create_connector`
- `update_connector`
- `set_connector_capabilities`
- `test_connection`
- `discover_connector_capabilities`
- `list_connector_taxonomy`
- `refresh_connector_taxonomy`
- `discover_dependency_capabilities`
- `discover_attachment_capabilities`
- `discover_comment_capabilities`
- `list_platform_event_definitions`
- `list_action_definitions`
- `list_output_type_definitions`
- `list_repository_mappings`
- `create_repository_mapping`
- `update_repository_mapping`
- `list_trigger_policies`
- `create_trigger_policy`
- `update_trigger_policy`
- `validate_trigger_policy`
- `list_automation_scenarios`
- `create_automation_scenario`
- `update_automation_scenario`
- `validate_scenario_graph`
- `dry_run_trigger_match`
- `list_dependency_policies`
- `create_dependency_policy`
- `update_dependency_policy`
- `create_dependency_override`
- `list_routing_rules`
- `create_routing_rule`
- `update_routing_rule`
- `test_delivery_destination`
- `list_communication_channels`
- `create_communication_channel`
- `update_communication_channel`
- `pair_communication_channel`
- `update_communication_channel_policy`
- `list_conversation_subscriptions`
- `create_conversation_subscription`
- `update_conversation_subscription`
- `list_runtime_api_keys`
- `create_runtime_api_key`
- `disable_runtime_api_key`
- `rotate_runtime_api_key`
- `revoke_runtime_api_key`
- `list_execution_providers`
- `create_execution_provider`
- `update_execution_provider`
- `list_execution_provider_hosts`
- `register_execution_provider_host`
- `update_execution_provider_host`
- `list_runtime_capabilities`
- `refresh_runtime_capabilities`
- `enable_connector`
- `disable_connector`

The names can differ, but the capability set should exist. `routing_rules` and `routing_targets` are the canonical persisted output-routing configuration records; do not create a second `output_routing_rules` table.

`action_delivery_attempts` is the canonical delivery-attempt execution record. Existing `outbound_delivery_attempts` should be treated as a legacy workflow-output delivery table or alias during migration, not as a second MCP-writeable source of truth.

MCP authentication should use tenant-scoped API keys or exchanged user sessions. Each operation must map to an explicit permission scope from [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md). MCP calls should write audit events distinct from admin UI calls.

The execution-provider and runtime-host operations cover the same model as the Runtime Fleet admin pages. They let MCP clients register customer-owned gateways or workers, refresh their capabilities, and bind runtime API keys without introducing a second runtime configuration surface.

`automation_scenarios` are the canonical scenario records. Legacy `workflow_scenario` operations, if exposed during migration, should be aliases or filtered views over automation scenarios that contain `triage`, `build`, or `merge` workflow-run actions. They should not write separate source-of-truth records.

## Secrets Handling

MCP should not require plain-text secret round-tripping after initial setup.

Preferred model:

- initial secret set via MCP or admin UI
- persisted through a secret reference or encrypted storage
- later reads return masked metadata only
- tests can use the stored secret without exposing it back out

## Multiple Inbound and Outbound Paths

This system must support more than one inbound or outbound path at the same time.

That means:

- one inbound connector can route to multiple outbound destinations
- multiple inbound connectors can route to the same outbound destination
- a single platform type can appear multiple times as distinct connection instances
- a single platform can be both inbound and outbound in one setup
- different connection instances can use different taxonomy mappings and capability states even when they share the same platform type

The same flexibility should apply to build:

- some connectors can request PR creation through tags or labels
- some projects can require manual build trigger only
- some projects can enable auto-PR after triage

The same flexibility should apply to communication:

- one channel can subscribe to multiple repositories or connector scopes
- one run can notify multiple channels
- one tenant can use Slack and Teams at the same time
- one WhatsApp conversation can be paired to a specific support scope with restricted actions

## Admin UI Relationship

The admin UI should be a human-friendly editor for the same model.

The MCP surface should be an automation-friendly editor for the same model.

Neither should have exclusive features or hidden configuration fields.

## Initial Recommendation

Build the first version so that:

1. configuration lives in PostgreSQL
2. the API owns validation and persistence
3. the admin app edits that configuration
4. an MCP server for Support Agent exposes that same configuration model
5. capability discovery determines whether webhook or polling should be used for each connection
6. Sentry inbound plus Linear inbound/outbound are the first concrete implementations
7. build behavior is configurable inside automation scenarios separately from intake and routing

This gives a usable operator UI and a programmable setup path from day one.
