# MCP Configuration Model

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). MCP configuration may target either `workers` directly or `gateways` that manage pools of workers.

Canonical naming reference: [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md) and [techstack.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/techstack.md).

## Purpose

Support Agent needs to be configurable through MCP, not only through the admin UI.

That means the system must expose its setup model in a way that an MCP client can:

- create and update connectors
- enable inbound and outbound roles
- define repository mappings
- define routing rules
- define trigger rules for triage, build, and merge work
- define workflow scenarios
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
- github-issues
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

## Routing Rules

Routing decides where findings go after triage.

Routing must support:

- same-platform return
- cross-platform delivery
- fan-out to multiple outbound destinations
- per-connector or per-scope overrides
- platform taxonomy on the outbound side
- post-triage build behavior
- post-build merge behavior
- event deduplication
- deterministic scenario precedence

Examples:

- inbound `linear-support-team` -> comment back to same Linear issue
- inbound `sentry-main-production` -> create issue in `linear-support-team`
- inbound `sentry-main-production` -> create issue in `github-bugs` and comment back to Sentry
- inbound `jira-enterprise-board` -> comment back to Jira and also send webhook callback to another system
- inbound `sentry-main-production` -> create issue in a specific Jira project with configured issue type and labels
- inbound `linear-support-team` -> after triage, start build when `ai-fix` label is applied

## Recommended Data Model

The config model should include at least:

- `platform_types`
- `connectors`
- `connector_capabilities`
- `connector_capability_checks`
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
- `attachment_policies`
- `comment_policies`
- `repository_mappings`
- `routing_rules`
- `routing_targets`
- `trigger_policies`
- `trigger_conditions`
- `trigger_actions`
- `workflow_scenarios`
- `workflow_scenario_bindings`
- `inbound_event_receipts`
- `inbound_event_matches`
- `execution_profiles`
- `build_policies`
- `merge_policies`

Prefer these canonical names over synonyms such as `connection_instances` or `connection_taxonomy_entries`.

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
- `list_repository_mappings`
- `create_repository_mapping`
- `update_repository_mapping`
- `list_trigger_policies`
- `create_trigger_policy`
- `update_trigger_policy`
- `list_workflow_scenarios`
- `create_workflow_scenario`
- `update_workflow_scenario`
- `bind_workflow_scenario`
- `create_attachment_policy`
- `update_attachment_policy`
- `create_comment_policy`
- `update_comment_policy`
- `list_dependency_policies`
- `create_dependency_policy`
- `update_dependency_policy`
- `create_dependency_override`
- `list_routing_rules`
- `create_routing_rule`
- `update_routing_rule`
- `list_build_policies`
- `create_build_policy`
- `update_build_policy`
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
- `enable_connection`
- `disable_connection`

The names can differ, but the capability set should exist.

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
7. build policy is configurable separately from intake and routing

This gives a usable operator UI and a programmable setup path from day one.
