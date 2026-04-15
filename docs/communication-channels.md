# Communication Channels

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). Chat channels can request work, observe work, and receive updates, but `workers` and `gateways` keep their existing execution meanings. Channel events participate in the shared automation model described in [automation-composition.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/automation-composition.md).

## Purpose

Support Agent should support conversational control and notification channels in addition to issue and ticket connectors.

These channels let users:

- ask the control-plane operator assistant what to do next
- request triage, build, or merge actions
- receive progress and result updates
- discuss an existing run without opening the admin dashboard

The control-plane operator assistant in this document is not the same thing as the worker-side Claude or Codex tooling used inside customer runtimes.

Initial examples:

- Slack
- Microsoft Teams
- business WhatsApp

## Core Distinction

Chat channels are not the same thing as execution runtimes and they are not necessarily the same thing as issue-system connectors.

Support Agent needs three separate concepts:

- issue connectors
  - ingest issues and post findings into systems like Sentry, Linear, GitHub Issues, Jira, or Trello
- communication channels
  - let people talk to the control-plane operator assistant through Slack, Teams, or WhatsApp
- execution runtimes
  - `workers` and `gateways` that actually execute triage, build, and merge jobs

Some platforms may fit more than one category, but the responsibilities should stay separate in the product model.

Some issue connectors may also expose threaded comments and bot mentions. That behavior should be treated as connector capability, not confused with standalone Slack, Teams, or WhatsApp communication channels.

Where connector platforms support webhook delivery for comments or mentions, Support Agent should prefer webhook-based intake over polling.

Every accepted channel command, mention, reply, approval response, or scheduled notification interaction should normalize into an internal `AutomationEvent` before continuation resolution or start-trigger matching. The channel is the source, the message or command is the event subject, and the action policy decides whether the request may start new work, continue existing work, or observe existing work.

## Supported Conversation Patterns

The system should support at least:

- command-style requests
  - `triage this issue`
  - `create a PR for run 142`
- follow-up questions
  - `what did the triage find`
  - `why did the run fail`
- subscription or notification flows
  - `notify this channel when triage completes`
- conversational routing
  - `send future Sentry findings for project X into this channel`

## Slack and Teams

Slack and Teams should be first-class communication channels.

They should support:

- posting status notifications into channels
- threaded run updates where the platform supports threads
- slash-command, bot mention, or message-extension style control where supported
- user identity mapping back to Support Agent users or teams
- permission checks before allowing destructive actions such as starting build or merge work, or opening PRs

The bot should be able to:

- summarize a workflow run
- link to the dashboard
- trigger allowed actions
- ask follow-up questions when a request is ambiguous

## Business WhatsApp

Support Agent should also support a business WhatsApp entry point owned by us.

The product should allow customers or operators to register a WhatsApp conversation and pair it with:

- a workspace
- a team
- one or more connector instances
- one or more repositories or routing scopes

The initial goal is not rich ticket-system behavior inside WhatsApp. The first goal is controlled conversational intake and notification.

WhatsApp pairing must verify the business number or conversation before it can trigger actions. The first supported mechanism should be an admin-initiated pairing code sent through the WhatsApp conversation and confirmed in the admin UI. Re-verification is required when the phone number, business account, tenant binding, or allowed-action scope changes.

High-risk or destructive commands from WhatsApp should create an `approval.request` before execution. Channel confirmation is not a separate approval mechanism; it is an `approval.request` delivered to an eligible channel and resumed through the same `approval_requests`, `approval_request` output, `approval_decision` output, and `continuationRef` contracts. Confirmation through the same WhatsApp conversation is allowed only when tenant policy marks that conversation as eligible for the requested risk level; otherwise the decision must come from an admin UI session or another trusted channel.

## Group Conversations

If the underlying platform supports group conversations, the system should support them.

That means Support Agent must be able to:

- map one conversation to a team or workspace
- resolve multiple participants to one tenant or team context
- apply permission checks per participant where identity is known
- keep one conversation thread linked to multiple runs over time when appropriate

If a platform has weak identity guarantees, the system should fall back to a stricter allowed-user or approved-conversation model.

## Pairing Model

Chat channels need pairing and scope configuration.

Examples:

- this Slack channel belongs to the platform team and is allowed to view workflow runs for repositories A and B
- this Teams chat is allowed to request triage for Linear workspace X
- this WhatsApp number is paired to customer Y and only receives notifications for project Z

Pairing should support:

- tenant or workspace binding
- team binding
- connector binding
- repository or project scope binding
- allowed action policies
- notification preferences

## Pairing Flow

Minimum operator flow:

1. create the communication channel record
2. verify the external channel or conversation identifier
3. bind it to the tenant or workspace
4. bind allowed connectors, repositories, or routing scopes
5. choose allowed actions
6. run a test notification
7. confirm identity resolution and audit visibility

## AI Control Surface

The control-plane operator assistant should behave as a constrained control surface, not an unrestricted shell.

It should only be able to trigger actions that the current conversation, user, and tenant policy allow.

Examples:

- allowed:
  - request triage
  - ask for run status
  - request PR creation when the user has permission
- not allowed without stronger approval:
  - change secrets
  - widen repository access
  - register arbitrary external callbacks

The AI should operate through the same backend action model as the dashboard and MCP. Chat is another control surface, not a bypass.

Customer-visible replies, destructive actions, secret changes, repository-access changes, and external callback registrations should require approval unless tenant policy explicitly allows automation for that action and channel scope.

Conversation text is untrusted model context. Channel adapters must preserve the separation between Support Agent instructions, policy, and user-provided messages; model outputs must be validated and sanitized before customer-visible delivery.

Channel loop prevention should not trust message text. Adapters set `botGenerated` only when an inbound message matches a Support Agent outbound marker recorded from `action_delivery_attempts`, such as provider message id, delivery attempt id, or signed correlation token. Messages without a trusted marker are treated as user-provided even if their text looks bot-authored.

## Data Model Implications

Recommended entities:

- communication_channel_types
- communication_channels
- communication_channel_memberships
- communication_channel_pairings
- communication_channel_policies
- conversation_threads
- conversation_messages
- conversation_action_requests
- conversation_subscriptions

Each channel should store:

- platform type
- external channel or chat identifier
- tenant or workspace binding
- allowed connectors or scopes
- notification mode
- last sync or webhook state
- loop-prevention markers for messages sent by Support Agent
- supported event keys and effective intake modes

## Delivery and Notification Model

The system should support:

- one-off replies
- ongoing status subscriptions
- thread-aware updates where supported
- escalation or summary messages

Examples:

- post triage completion into a Slack thread
- post PR-ready summary into Teams
- send a concise result summary to WhatsApp and link back to the dashboard
- send an immediate incident alert to WhatsApp when the first critical crash arrives, then follow with triage and PR-ready updates
- notify a developer Slack channel that a real support issue has been reproduced and is ready for PR request
- notify the relevant channel that a ticket was received but is blocked by a dependency, then notify again when work is automatically released

## Initial Recommendation

Start with:

- Slack communication channel
- Teams communication channel
- outbound notifications first
- controlled action requests second
- WhatsApp as a paired business channel after the internal permission and pairing model is in place

Do not treat chat channels as a shortcut around the main policy model. They should use the same action, permission, and audit pipeline as the admin UI and MCP.
