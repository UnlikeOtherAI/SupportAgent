# Automation Composition Model

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). Canonical run and work-item contracts: [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md). Workflow-run scenario subset: [workflow-scenarios.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/workflow-scenarios.md).

## Purpose

Support Agent should let operators take any supported incoming signal, decide what it means, run one or more policy-safe actions, transform the result, and deliver outputs to any allowed destination.

The product is not only about code changes. Code work is one action family. The same fabric must also support support-ticket replies, incident escalation, ticket synchronization, knowledge capture, notifications, approvals, conversational control, review loops, and parent-product callbacks.

The core pipeline is:

```text
incoming signal
-> verified automation event
-> trigger matching
-> automation scenario execution
-> action graph
-> optional workflow runs or control-plane actions
-> typed outputs
-> destination routing and delivery
-> audit and feedback loop
```

## Non-Goals

This is not a generic customer-authored workflow engine.

The first implementation should use a small, typed, versioned action graph that supports sequence, conditional branch, approval wait, workflow-result wait, retry, and delivery fan-out. Operators configure first-party actions and instructions. They do not upload scripts, write arbitrary code, or bypass the API, worker, dispatcher, connector, and audit boundaries.

## Operator Mental Model

The admin UI should expose a simple starter path first:

```text
App
-> Source
-> Event Type
-> Conditions
-> Scenario Template
-> Repository Context, if required
-> Channel Context, if required
-> Outputs and Destinations
-> Test
-> Enable
```

Advanced users may open the scenario action graph after choosing a template. A preset such as `triage`, `build`, `merge`, or `request PR` is a saved scenario template, not a separate hard-coded automation type.

Operator-facing terms should be:

- `App`: catalog tile or install surface, such as GitHub, Sentry, Linear, Slack, or WhatsApp.
- `Source`: the installed connector instance, communication channel, schedule, dashboard action, MCP action, or system event that produced the signal. The operator may start by choosing an app such as Linear, but the source value must resolve to a specific installed instance before validation.
- `Event Type`: a platform-defined logical event key, such as `github_issues.issue_comment.created`.
- `Trigger`: an incoming-event matching rule.
- `Scenario`: the reusable automation recipe selected by the trigger.
- `Action`: one configured thing the scenario does.
- `Destination`: where a typed output is delivered.
- `Background Job`: a `triage`, `build`, or `merge` workflow run. Background jobs are not resumable conversations; each job starts once, executes one bounded unit of work, and ends in a terminal outcome.

Internal terms such as `AutomationEvent`, `ScenarioExecution`, `workItemKind`, `intakeMode`, and `workflowType` should appear in API/MCP docs and diagnostics, not in the default admin wizard.

## Core Invariants

All triggers are incoming. A trigger is not the work itself. The default path is self-contained: an incoming event starts a scenario, the scenario does work, and the scenario emits one or more outputs. Background jobs do not continue or resume; follow-on work starts a new scenario or a new job linked to the previous output.

An `eventKey` is the logical event type. `intakeMode` is how it arrived: webhook, polling, chat, schedule, manual, MCP, or system. Do not mix those fields.

Every accepted incoming signal must normalize into an internal `AutomationEvent` before start-trigger matching. If and only if the event carries an explicit `continuationRef` or signed correlation token for a pending non-job gate, the API resolves that pending gate instead of treating the event as a new start trigger. `InboundWorkItem` remains the durable normalized record for issues, tickets, cards, crashes, and review targets. Not every automation event creates a work item.

Repository context is required only for actions whose definitions declare `requiresRepositoryContext=true`.

Channels can trigger actions and receive outputs, but they must use the same permission, approval, rate-limit, and audit model as the dashboard and MCP.

## Concept Model

### App

An app is the product-level install unit shown in the admin Apps page.

Installing an app creates one or more operational records:

- connector instance, for issue trackers, error monitors, code hosts, or ticket systems
- communication channel, for Slack, Teams, WhatsApp, or similar chat surfaces
- both, when a platform can act as an issue source and a chat or notification surface

The app is UI/catalog vocabulary sourced from the platform registry. The first implementation does not need an `apps` table unless install state outgrows connector/channel records. Runtime decisions use the concrete connector instance or communication channel.

### Platform Type

A platform type is the code-level integration kind.

Examples:

- `sentry`
- `crashlytics`
- `linear`
- `github`
- `github_issues`
- `jira`
- `trello`
- `gitlab`
- `bitbucket`
- `slack`
- `teams`
- `whatsapp`

Slack, Teams, and WhatsApp are platform types for channel adapters. A specific Slack conversation is a `CommunicationChannel`, not the platform type itself.

### Connector Instance

A connector instance is a configured installation of a platform type.

Canonical field name: `connectorInstanceId`.

Examples:

- production Sentry organization
- Linear support team
- GitHub local `gh` polling connector
- Jira enterprise site
- Trello support board

A connector declares platform-supported, account-supported, and currently-enabled capabilities.

### Communication Channel

A communication channel is a configured conversation surface.

Examples:

- Slack workspace/channel
- Teams team/chat
- WhatsApp business conversation

It can produce automation events such as bot mentions, slash commands, message replies, and approval responses. It can also receive typed outputs such as notifications, summaries, questions, and approval requests.

### Repository Mapping

A repository mapping connects source scope to repository execution context.

Examples:

- Sentry project -> GitHub repository and default branch
- Linear team/project -> repository and execution profile
- GitHub Issues repository -> same GitHub repository
- Jira project key -> repository and reproduction policy

The trigger builder should ask for this only when selected actions require code, runtime, reproduction, review, build, merge, or repository-provider output.

### Trigger Policy

A trigger policy matches verified automation events.

It owns:

- source scope
- precedence scope
  - repository mapping
  - connector or source
  - tenant default
- logical event key
- intake mode constraints
- conditions
- dedupe policy
- trigger fan-out policy
  - `disabled`
  - `allow_multiple_workflow_action_types`
  - `allow_multiple_scenarios`
- workflow action type conflict class
  - `triage`
  - `build`
  - `merge`
  - `control_plane`
  - `multi_workflow`
- target scenario template or scenario version
- lifecycle state

Trigger policies are the source of truth for trigger-to-scenario resolution. Each enabled trigger policy stores a direct `automationScenarioVersionId`; matching evaluates trigger conditions and then starts that referenced version. Legacy scenario binding records may exist as migration views, but they must not select scenarios for new automation.

Trigger lifecycle states:

- `draft`
- `validated`
- `enabled`
- `degraded`
- `error`
- `disabled`

Only `enabled` triggers execute. `validated` means the graph, capabilities, permissions, destinations, and sample dry run passed at the time of validation.

### Automation Scenario

An automation scenario is a reusable action recipe.

It may run only control-plane actions, or it may create one or more `workflow_runs`.

Examples:

- support-ticket response with no repository work
- support-ticket triage that creates one `triage` run
- incident hotfix that creates `triage`, then `build`, then a draft PR
- inbound PR review that creates a `triage` run with a review profile
- customer follow-up drafting that requires approval before sending

`WorkflowScenario` is the workflow-run subset of this broader model. Existing triage, build, and merge runtime jobs still use `workflow_runs` as the executable-work source of truth.

### Action Definition

An action definition is a first-party registered action with a typed contract.

Required fields:

- `actionKey`
- `family`
- `label`
- `description`
- `inputSchemaRef`
- `outputSchemaRef`
- `requiredCapabilities`
- `requiresRepositoryContext`
- `requiresChannelContext`
- `requiresApprovalByDefault`
- `customerVisible`
- `destructive`
- `riskLevel`
- `runtimePlacement`
- `retryPolicy`
- `timeoutPolicy`
- `outputTypes`
- `visibilityPolicy`
- `auditBehavior`

`riskLevel` values should start as `low`, `medium`, `high`, and `destructive`.

Internal graph actions are still first-party action definitions. Examples such as `workflow.create_triage_run`, `workflow.create_build_run`, `workflow.wait_for_result`, `delivery.send_output`, and `approval.request` must exist in the action registry and pass the same capability, approval, timeout, retry, and audit validation as connector-facing actions.

Initial destructive or high-risk classification:

- `destructive`: `pr.merge`, secret changes, repository-access changes, external callback registration, issue deletion where supported
- `high`: `workflow.create_build_run` with branch push, `pr.create_draft`, `issue.transition` to terminal states, bulk label/status changes, customer-visible reply delivery
- `medium`: issue comments, notifications, ticket updates, assignment changes
- `low`: classify, summarize, transform, audit, read-only status checks

`runtimePlacement` values should start as:

- `control_plane`
- `worker_required`
- `scenario_wait`
- `delivery_adapter`
- `approval_wait`
- `transform`

## Automation Event Envelope

`AutomationEvent` is an internal normalized envelope. It should be created only after signature verification, credential validation, tenant resolution, schema validation, and loop-prevention checks. Invalid or unverifiable payloads may create quarantine/audit records, but they must not participate in trigger matching.

Canonical `intakeMode` values are `webhook`, `polling`, `chat`, `schedule`, `manual`, `mcp`, and `system`.

Required fields:

- `automationEventId`
- `tenantId`
- `sourceKind`
- `sourceId`
- `platformType`
- `eventKey`
- `eventVersion`
- `intakeMode`
- `occurredAt`
- `receivedAt`
- `actor`
- `subject`
- `payload`
- `taxonomy`
- `links`
- `attachments`
- `dedupeKey`
- `logicalEventKey`
- `capabilitySnapshotRef`
- `sourcePayloadRef`
- `botGenerated`
- `outboundCorrelationRef`

Conditional fields:

- `connectorInstanceId` for connector events
- `communicationChannelId` for channel events
- `scheduleId` for scheduled events
- `requestId` for dashboard or MCP events
- `continuationRef` for approval decisions, follow-up replies, observe-existing-run commands, and other responses to already-created outputs

`sourceKind` values:

- `connector`
- `communication_channel`
- `schedule`
- `dashboard`
- `mcp`
- `system`

`sourcePayloadRef` points to the stored raw payload snapshot. Do not use `rawPayloadRef` in new contracts.

## Work Item Creation

Trigger matching happens against `AutomationEvent`. Work-item creation happens only when the matched scenario or action needs a durable issue, ticket, card, crash, or review target.

The API should either link an existing `InboundWorkItem` or create one before worker-backed actions that require work-item context. Control-plane-only scenarios may run without an `InboundWorkItem`.

Canonical order:

```text
verified external signal
-> AutomationEvent
-> trigger matching
-> ScenarioExecution
-> optional InboundWorkItem create_or_update
-> optional workflow_runs
```

`InboundWorkItem.dedupeKey` is the durable work-item identity key, not the event receipt key. It should be stable for the same external issue, ticket, card, crash, or review target across webhook, polling, comment, and chat events. `AutomationEvent.dedupeKey` remains the event-delivery idempotency key.

## Optional Continuation Resolution

Most work should remain self-contained: trigger -> scenario -> outputs. Creating a Linear ticket, commenting on GitHub, labeling an issue as triaged, notifying Slack, or opening a PR are outputs of the current scenario, not continuations.

Chaining should usually happen through new events. For example, when triage completes, the scenario may emit an output or system event that a separate build trigger can match. That creates a new scenario execution with links back to the previous work rather than resuming the old scenario.

Continuation is reserved for pending non-job gates where the previous scenario is explicitly waiting for a response. These events still normalize into `AutomationEvent`, but the API only checks continuation routing when `continuationRef` is present or can be derived from a trusted signed correlation token created by a previous output:

- `approvalRequestId` completes the matching `approval.request` gate.
- `actionExecutionId` completes the matching scenario action when a control-plane action is waiting for external input.
- `deliveryAttemptId` records delivery feedback or retry decisions for an existing output.

`workflowRunId` is not a continuation target. A request to inspect, retry, cancel, build after, or merge after a workflow run is a new self-contained control-plane scenario or workflow scenario with the prior `workflowRunId` as input.

A continuation event must pass tenant, actor, source, channel-pairing, permission, and pending-state checks. If the continuation target is missing, terminal, or not allowed for the actor, the event is rejected or audited; it must not silently fall through into a new start-trigger match.

`continuationRef` must identify one target kind. Multiple ids are allowed only when they describe the same already-linked chain, such as an approval request and its action execution. Conflicting refs are rejected and audited.

## Trigger Matching

The matcher should:

- load candidate triggers by tenant, source kind, source id, event key, and state
- validate event schema against the platform event registry
- evaluate condition fields from event payload, taxonomy cache, and linked source objects
- reject cross-tenant references
- check required capabilities and permissions before execution
- deduplicate received events by `dedupeKey`
- enforce scenario-start idempotency by `logicalEventKey`
- reject tied same-precedence matches unless trigger fan-out is explicitly enabled
- create a `ScenarioExecution` for each accepted start match

`dedupeKey` construction must be deterministic per delivery path:

- webhook: `webhook:{platformType}:{connectorInstanceId}:{eventKey}:{externalDeliveryId || externalObjectId}:{eventVersion}`
- polling: `poll:{platformType}:{connectorInstanceId}:{sourceScope}:{externalObjectId}:{eventKey}:{observedVersion}`
- chat: `chat:{platformType}:{communicationChannelId}:{externalMessageId}:{eventKey}`
- schedule: `schedule:{tenantId}:{scheduleId}:{scheduledFor}`
- dashboard: `manual:{tenantId}:{actorId}:{requestId}`
- MCP: `mcp:{tenantId}:{actorId}:{requestId}`
- system: `system:{tenantId}:{producer}:{eventKey}:{producerEventId}`

`logicalEventKey` construction must be deterministic for the source object and version, independent of transport when the source provides enough identity:

- connector object/version: `logical:{platformType}:{connectorInstanceId}:{sourceScope}:{externalObjectId}:{eventKey}:{externalVersion}`
- channel message: `logical:{platformType}:{communicationChannelId}:{externalMessageId}:{eventKey}`
- continuation: `continuation:{tenantId}:{targetKind}:{targetId}:{eventKey}:{decisionOrMessageId}`
- schedule: same value as `dedupeKey`
- manual, MCP, and system: same value as `dedupeKey` unless they target an existing continuation

If the same logical platform event arrives through webhook and polling, the connector must set the same `logicalEventKey`. The matcher must not invent hidden fuzzy fallback behavior for cross-transport duplicates.

Webhook `dedupeKey` may use an external delivery id because it identifies a received delivery. Connector object/version `logicalEventKey` should use the external object id and version, not the delivery id, so webhook and polling observations of the same source object collapse to the same scenario-start identity.

Use three separate fan-out terms:

- `triggerFanOut`: one event intentionally starts more than one scenario.
- `branchFanOut`: one scenario branch intentionally starts several action branches.
- `deliveryFanOut`: one typed output intentionally delivers to several destinations.

`triggerFanOut=disabled` is the safe default: one logical event may start only one scenario after precedence and condition evaluation, even if several matched trigger policies have different `workflowActionType` values. `allow_multiple_workflow_action_types` permits one start per conflict class, such as one triage scenario and one control-plane notification scenario. `allow_multiple_scenarios` is the only mode that permits more than one start inside the same conflict class.

## Platform Event Registry

The admin UI and MCP must not ask operators to type event names when the platform registry knows the vocabulary.

Each platform event definition should include:

- `eventKey`
- label and description
- source kind
- supported intake modes
- subject kind
- payload schema reference
- filterable fields
- taxonomy field mappings
- supported action families
- required capabilities
- delivery limitations
- loop-prevention hints

The registry should be shared by API, admin, MCP, and worker manifest generation. It may start in `packages/contracts` as data and DTOs, but it should remain a platform registry, not a frontend copy of database schema.

Example event keys:

- `sentry.issue.created`
- `sentry.issue.reopened`
- `sentry.comment.created`
- `crashlytics.issue.new_fatal`
- `linear.issue.created`
- `linear.comment.created`
- `github_issues.issue.opened`
- `github_issues.issue_comment.created`
- `github_issues.label.added`
- `github.pull_request.opened`
- `github.pull_request.synchronized`
- `github.pull_request_review.submitted`
- `jira.issue.created`
- `jira.comment.created`
- `trello.card.moved`
- `gitlab.merge_request.opened`
- `bitbucket.pullrequest.created`
- `slack.app_mention`
- `slack.slash_command`
- `teams.bot_message`
- `whatsapp.message.received`

## Scenario Execution

When a start trigger matches, the API creates a `ScenarioExecution`.

It records:

- matched trigger and event
- scenario key, version, and graph version
- resolved repository mapping
- resolved channel pairing
- resolved output destinations
- resolved execution, orchestration, and review profiles
- policy decisions
- created workflow runs
- action outputs
- delivery attempts
- approvals
- cancellation state
- audit trail

The scenario execution owns child action executions and child workflow runs. Disabling a scenario prevents new executions but does not cancel in-flight executions unless the operator explicitly cancels them.

Cancellation should stop queued and cancellable actions, request cancellation for worker-backed workflow runs, and mark non-cancellable external deliveries as already attempted.

Retry policy must live on the action definition plus scenario override. A retry creates a new action attempt, not a second scenario execution, unless the trigger is replayed intentionally.

Scenario status follows child outcomes:

- If a required action fails and has no retry remaining, the scenario fails.
- If an optional action fails, the scenario may succeed with warnings.
- If a child workflow run is canceled by policy, the scenario is canceled unless a branch handles that result.
- If a child workflow run is lost, the scenario remains running or blocked until retry policy resolves the run.
- A scenario can succeed with failed delivery attempts only when delivery is marked non-critical and the failed attempt is visible in audit.

Scenario action execution statuses should be `queued`, `running`, `awaiting_approval`, `blocked`, `retry_scheduled`, `succeeded`, `failed`, `skipped`, and `canceled`. These statuses belong to the scenario control plane, not to worker-backed background jobs.

When an action enters `retry_scheduled`, the API-owned scenario scheduler is responsible for waking it at `retryAt`, claiming the retry row, creating the next attempt, and handing that attempt to the appropriate control-plane, worker, delivery-adapter, approval-wait, scenario-wait, or transform executor. Placement executors execute an already-claimed attempt; they must not independently increment attempt numbers or schedule action retries. The implementation may use cron or a durable queue, but action retry ownership must remain centralized so restarts do not create duplicate attempts.

## Action Graph

The graph should be versioned JSON first, not a fully generic graph engine.

Minimum node controls:

- `sequence`
- `condition`
- `approval`
- `workflow_run`
- `wait_for_workflow_result`
- `transform`
- `delivery`
- `stop`

Minimum graph shape:

```json
{
  "schemaVersion": 1,
  "entryNodeIds": ["triage"],
  "defaultRetryPolicy": { "maxAttempts": 1, "backoff": "none" },
  "defaultTimeoutPolicy": { "runTimeoutSeconds": 3600, "onTimeout": "fail" },
  "nodes": [
    {
      "id": "triage",
      "type": "workflow_run",
      "actionKey": "workflow.create_triage_run",
      "dependsOn": [],
      "input": {
        "workItemId": "$workItem.workItemId",
        "repositoryMappingId": "$repositoryMapping.repositoryMappingId"
      },
      "onFailure": "stop",
      "retryPolicy": { "maxAttempts": 2, "backoff": "exponential", "baseDelaySeconds": 60 }
    }
  ]
}
```

Conditions should use a constrained field/operator/value form rather than arbitrary expressions. Initial operators should be `equals`, `not_equals`, `contains`, `not_contains`, `in`, `not_in`, `exists`, and `missing`.

Initial `onFailure` values are `stop`, `continue`, `skip_dependents`, and `await_human`. Retry behavior belongs in `retryPolicy`, not in `onFailure`.

The first admin editor should be a structured form/tree editor over this JSON, not a free-form JSON textarea and not a complex node-canvas editor. A raw JSON view can be read-only diagnostics until the typed editor is stable.

`workflow_run` nodes cover all three first-party workflow creation actions: `workflow.create_triage_run`, `workflow.create_build_run`, and `workflow.create_merge_run`.

User-facing action families:

- Investigate and triage
- Build or create PR
- Merge
- Review
- Respond to customer
- Classify or summarize
- Transform output
- Sync ticket or issue
- Notify channel
- Request approval
- Deliver output
- Audit or record

`Review` here means "run an internal review step inside triage, build, or merge." It is not a fourth top-level workflow type.

Internal action keys can be more granular:

- `event.normalize`
- `dependency.check`
- `work_item.create_or_update`
- `agent.control.respond`
- `agent.control.summarize`
- `agent.runtime.investigate`
- `agent.runtime.classify`
- `workflow.create_triage_run`
- `workflow.create_build_run`
- `workflow.create_merge_run`
- `workflow.wait_for_result`
- `review.run`
- `review.evaluate`
- `review.iterate`
- `transform.payload`
- `transform.finding_to_comment`
- `transform.finding_to_ticket`
- `approval.request`
- `issue.comment`
- `issue.reply`
- `issue.label`
- `issue.assign`
- `issue.transition`
- `ticket.create`
- `ticket.update`
- `pr.create_draft`
- `pr.request_review`
- `pr.merge`
- `notification.send`
- `channel.ask_followup`
- `delivery.route`
- `audit.record`

An action receives inputs from explicit bindings only:

- event fields
- linked work item fields
- repository mapping
- communication channel pairing
- previous action outputs
- scenario constants
- approved secret references
- policy context

Outputs are referenced by stable paths such as `steps.triage.outputs.finding`. Do not pass raw secrets, raw payloads, or unrestricted logs between actions.

Transform actions are typed mapping/template actions only in the first implementation. They may map fields, render approved templates, redact content, and convert one typed output into another typed output. They must not execute arbitrary user-supplied code.

Approval actions and approval nodes are the same gate expressed at different levels: the graph node pauses scenario execution, and the `approval.request` action creates the durable request and delivery output. `approval.request` uses `runtimePlacement=approval_wait`; the scenario action remains `awaiting_approval` until a correlated decision event records the decision. This does not resume a background job; approved follow-on work starts as a new action or new workflow run. Approval outcomes are `approved`, `denied`, `expired`, and `canceled`.

Approval node input must resolve `reason`, `approverScope`, `expiresAt` or timeout policy, `requestedByActor`, `selfApprovalAllowed`, `approvalPolicyRef`, `eligibleDecisionTargets`, and `deliveryTargets`. `approvalPolicyRef` defines the risk class and allowed decision surfaces. `eligibleDecisionTargets` is the resolved set of admin, MCP, channel, or channel-pairing surfaces allowed to record the decision for this request; delivery to a channel does not make that channel eligible unless the policy says so.

The `approval.request` action creates the pending approval state in one transaction before external delivery is attempted:

1. create the `scenario_action_executions` attempt in `running`
2. create the `action_outputs` row with `outputType=approval_request`
3. create the `approval_requests` row with `status=pending` and `deliveryOutputId` referencing that approval output
4. move the action execution to `awaiting_approval`
5. enqueue delivery attempts for the selected `deliveryTargets`

External delivery failure changes delivery-attempt state, not the existence of the pending approval. A decision continuation is accepted only when it matches the approval request, `approverScope`, `eligibleDecisionTargets`, tenant, source, and pending status.

Inbound PR or merge-request review should use `workflow.create_triage_run` with `workItemKind=review_target` and an attached review profile. It must not introduce a fourth top-level workflow type.

## Runtime Placement

An action may run in the control plane only when it is short, bounded, idempotent or safely retryable, does not need a cloned repository, does not need local shell access, and uses API-owned connector or channel clients.

An action requires a worker or gateway when it needs:

- repository clone or source checkout
- shell commands
- browser, mobile, emulator, or app reproduction
- Claude or Codex execution inside a customer-owned runtime
- build, validation, branch, PR preparation, or merge work
- large artifact generation
- long-running multi-step investigation

`agent.*` is not one runtime kind. Use action definitions to split `agent.control.*` from `agent.runtime.*`.

Worker-backed actions create `workflow_runs`. The dispatcher remains responsible for assigning those runs to execution providers and reconciling lost, canceled, retried, or completed dispatch attempts.

Scenario-wait actions such as `workflow.wait_for_result` pause the scenario until a referenced workflow run reaches the required state. They run in the API scenario executor, not inside the worker whose result is being awaited.

Retry policy shape:

- `maxAttempts`
- `backoff`: `none`, `fixed`, or `exponential`
- `baseDelaySeconds`
- `maxDelaySeconds`
- `retryOn`: action-specific error codes or `transient`
- `giveUpStatus`: `failed`, `blocked`, or `awaiting_human`

Timeout policy shape:

- `startTimeoutSeconds` for queued or dispatched work that never starts
- `heartbeatTimeoutSeconds` for running worker-backed work
- `runTimeoutSeconds` for total execution budget
- `onTimeout`: `retry`, `fail`, `cancel`, or `await_human`

Worker heartbeats should include workflow run id, dispatch attempt id, current stage, progress summary, timestamp, and optional log cursor. The dispatcher should treat missed heartbeat threshold as `lost` and apply retry policy.

## Output Model

Every action produces typed outputs.

Initial output types:

- `investigation_finding`
- `customer_reply_draft`
- `posted_comment_ref`
- `notification_ref`
- `created_ticket_ref`
- `updated_ticket_ref`
- `branch_ref`
- `pull_request_ref`
- `merge_result_ref`
- `artifact_ref`
- `approval_request`
- `approval_decision`
- `transformed_payload`
- `blocked_reason`
- `review_outcome`
- `dependency_status`

Outputs have visibility levels:

- `full`
- `redacted`
- `metadata_only`

Routing consumes typed action outputs. It does not only route triage findings.

Destination types:

- `source_connector`
- `routing_target`
- `communication_channel`
- `repository_provider`
- `dashboard_artifact`
- `mcp_response`
- `parent_product_integration`

Routing targets are reusable destination records that describe where an output can be sent. A routing rule decides when a routing target should be used; a routing target describes the destination itself. Minimum routing target fields are `routingTargetId`, `tenantId`, `destinationType`, `displayName`, `connectorId` or `communicationChannelId` when applicable, `externalScopeRef` when the destination has an external project, channel, board, repository, or webhook, `visibilityPolicy`, `approvalPolicyRef`, `capabilityHealth`, and audit timestamps.

Delivery attempts are execution records, not configuration. An action can succeed while one destination fails.

PR and comment creation are action outputs delivered by connector or repository-provider adapters. `pr.create_draft` produces a `pull_request_ref` output, records an `action_delivery_attempt`, and should execute through the API-owned connector adapter unless the connector contract explicitly requires a local runtime operation. Local `gh` delivery must report the same output and delivery-attempt records back to the API.

Artifacts should store metadata in the database and large bodies in object storage. Artifact retention follows tenant policy, output visibility policy, and legal hold settings.

Partially uploaded artifacts from canceled or lost attempts remain quarantined until cleanup policy deletes or promotes them. Artifact metadata must include owner, visibility level, size, content type, retention policy, and producing action or workflow run.

## Security And Policy

Required enforcement:

- Verify webhook signatures before accepting webhook events using the platform-specific verifier from the connector adapter. HMAC-SHA256 or stronger should be the default where a platform supports shared-secret signatures.
- Authenticate polling through the connector secret reference or local runtime credential before creating polling events.
- Store raw payload snapshots immutably after verification.
- Store secrets as encrypted values or external secret references. Reads return masked metadata only.
- Scope every connector, channel, repository mapping, trigger, scenario, output, approval, and delivery attempt to one tenant.
- Reject cross-tenant references at validation and execution time.
- Validate incoming payloads against platform schemas before matching triggers.
- Sanitize user-controlled text before model prompts, customer-visible replies, and markdown/HTML delivery.
- Sanitize model-generated customer-visible output before delivery.
- Apply prompt-injection defenses when external text influences agent instructions: separate system instructions from external context, label untrusted content, restrict tool permissions by action definition, validate structured outputs, and require approval for risky model-produced outputs.
- Default customer-visible and destructive actions to approval-required unless tenant policy explicitly allows automation.
- Classify every action by risk and destructive behavior.
- Enforce branch protection and merge policy before `pr.merge`.
- Prevent loops using bot identity, outbound markers, outbound correlation refs, recent delivery refs, and event-key suppressions.
- Rate-limit by tenant, connector, channel, action key, external API, and model usage.
- Audit every trigger match, action start, action result, approval, denial, expiration, cancellation, retry, output routing decision, delivery attempt, quarantine, loop-prevention rejection, dry run, capability drift, scenario graph change, and secret-reference access.
- Apply the same policy gates to MCP and channel-initiated actions as the admin UI.

MCP authorization should use tenant-scoped API keys or exchanged user sessions with scoped roles. Each operation must declare required permissions such as `connector:write`, `trigger:write`, `scenario:write`, `delivery:test`, `runtime:write`, or `secret:write`.

Channel authorization should combine channel policy, resolved user identity, tenant scope, and action risk. Weak-identity channels such as WhatsApp require verified pairing plus stronger confirmation for high-risk or destructive actions.

## Admin Composition Flow

Starter mode should be progressive:

1. Choose an app/source from installed connectors and channels.
2. Choose a searchable event type from the platform event registry.
3. Add conditions with structured field/operator/value rows from taxonomy and filterable fields.
4. Choose a scenario template.
5. Review capability and permission badges.
6. Resolve required repository context.
7. Resolve required channel context.
8. Resolve destinations and output routing.
9. Choose approval behavior for customer-visible, high-risk, or destructive actions.
10. Run a dry run with a sample event.
11. Enable the trigger.

Advanced mode should let operators edit the typed action graph for the selected scenario template.

The starter editor should be a guided wizard. Advanced mode should be a single-page structured graph editor with a sticky source, event, scenario, and validation header. Switching from starter to advanced should clone the selected template into a scenario draft. Switching back to starter is allowed only while the graph still matches a known template shape; otherwise the UI should keep the scenario in advanced mode.

Dropdown rules:

- small enums use native selects
- lists with more than five likely values use searchable comboboxes
- events, taxonomy, repository mappings, channels, destinations, scenarios, action families, and output types must not be free-text when the API knows the options
- text fields are reserved for free-form instructions, templates, or genuinely custom values

Free-text examples include agent instructions, customer reply templates, Slack message templates, and custom notification copy.

The UI should show:

- draft, validated, enabled, degraded, error, or disabled state
- missing capability warnings
- incompatible action warnings
- required approval warnings
- loop-risk warnings
- action placement badges: `instant` for control-plane-safe, `background job` for worker-backed
- scenario execution monitor for long-running and asynchronous validation

Validation UI states should be `idle`, `validating`, `passed`, `failed`, and `stale`. A previously validated trigger becomes `stale` when connector capabilities, permissions, repository mappings, channel policies, action definitions, scenario graph version, or destination configuration changes.

Dry-run sample events should come from a recent captured automation event, a platform-provided sample, or a typed synthetic sample built from the platform event schema. Results should render as an expandable tree: matched trigger, scenario graph, action inputs, approvals, repository/channel context, output routing, predicted side effects, and blockers.

Scenario execution monitors should show action-by-action status, child workflow run links, approvals, outputs, delivery attempts, logs subject to visibility policy, retry/cancel affordances, and audit events.

## MCP Composition Flow

MCP must expose the same model as the admin UI. The canonical full MCP management surface lives in [mcp-configuration.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/mcp-configuration.md); this section lists the composition-specific operations that must exist in that surface.

Required MCP operations:

- `list_platform_event_definitions`
- `discover_connector_capabilities`
- `list_connector_taxonomy`
- `list_action_definitions`
- `list_output_type_definitions`
- `create_trigger_policy`
- `update_trigger_policy`
- `validate_trigger_policy`
- `create_automation_scenario`
- `update_automation_scenario`
- `validate_scenario_graph`
- `dry_run_trigger_match`
- `create_routing_rule`
- `update_routing_rule`
- `create_communication_channel_policy`
- `test_delivery_destination`
- `enable_trigger_policy`
- `disable_trigger_policy`

MCP writes the same database records as the admin UI and must enforce the same auth, tenant scope, approval, rate-limit, and audit requirements.

## Data Model Delta

The composition layer uses these durable records alongside existing work-item, workflow-run, connector, channel, and routing records:

- `routing_rules`
- `routing_targets`
- `execution_profiles`
- `orchestration_profiles`
- `review_profiles`
- `automation_events`
- `automation_event_quarantine_records`
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

Execution, orchestration, and review profiles are reusable scenario inputs. Automation scenarios may reference them directly or inherit them from repository mappings and tenant defaults, but the resolved profile ids are copied onto scenario executions and workflow runs for auditability.

`trigger_policies` should point to an automation scenario version and carry the repository-mapping, connector/source, or tenant-default precedence scope used during matching. If a trigger starts repository/runtime work, the scenario creates `workflow_runs` with `workflowType` of `triage`, `build`, or `merge`.

`scenario_action_executions` store one row per attempt and carry stable `actionInvocationId` values across retries. The retry scheduler claims due retry rows through the database record and lease fields; cron or queue wake-ups are implementation details, not the source of truth. `workflow_runs` created by an action graph node store `sourceActionInvocationId` so retried `workflow.create_*_run` actions reuse or requeue the same child run instead of creating duplicates. Control-plane side effects also use `actionInvocationId` as their idempotency key.

Pure control-plane scenarios should still set `workflowActionType=control_plane` on trigger policies so tie-breaking and fan-out validation do not depend on a missing workflow run.

`workflowActionType` is the trigger conflict class. A scenario such as `incident-hotfix` may create both triage and build workflow runs inside one graph; in that case the trigger policy should use `workflowActionType=multi_workflow` unless it intentionally conflicts as a triage-start policy. `triggerFanOut` controls multiple winning trigger policies, while branch fan-out inside one scenario is controlled by the action graph.

`routing_rules` and `routing_targets` are the canonical configuration tables for output routing. MCP tools may use names such as `create_routing_rule`, but they must write the same records. `action_delivery_attempts` is the canonical delivery-attempt execution table. Existing `outbound_delivery_attempts` should be treated as legacy workflow-output delivery until migrated or aliased into `action_delivery_attempts`.

## Example Flows

### GitHub Local Polling Triage

Local-`gh` polling is a connector polling mode, not an API-owned schedule. The connector config persists `pollIntervalSeconds`, repository scope, and required local credential class. The registered local runtime or gateway owns the cron loop, uses its authenticated `gh` session, and submits each observed issue event to the API as `sourceKind=connector` and `intakeMode=polling`.

```text
scheduled poll via local gh
-> github_issues.issue.opened where missing discovery marker and triaged label
-> work_item.create_or_update
-> support-ticket-triage scenario
-> workflow.create_triage_run with workItemId
-> issue.comment discovery report
-> issue.label triaged and complexity labels
-> optional approval.request for PR
```

### Support Ticket Response Without Code

```text
linear.comment.created with bot mention
-> work_item.create_or_update
-> customer-followup scenario
-> agent.control.respond using ticket, comments, policy, and allowed knowledge context
-> approval.request because response is customer-visible
-> issue.reply in Linear
-> notification.send Slack support channel
```

### Sentry Incident To Hotfix

```text
sentry.issue.reopened severity=fatal
-> incident-hotfix scenario
-> parallel action branches represented as independent graph nodes whose `dependsOn` points at the same prior node:
   - work_item.create_or_update then workflow.create_triage_run with workItemId and reproduction policy
   - notification.send Slack incident channel immediately
-> if confidence high and policy allows, workflow.create_build_run
-> pr.create_draft in GitHub
-> issue.comment back to Sentry or linked ticket
```

### Slack Operator Command

```text
slack.slash_command /support-agent triage JIRA-123
-> operator-command scenario
-> permission check against channel policy
-> resolve Jira connector and repository mapping
-> work_item.create_or_update
-> workflow.create_triage_run with workItemId
-> channel reply with run link
```

## Implementation Sequencing

The model is defined enough to implement, but the current codebase still needs these implementation steps:

- the trigger UI is still workflow-type based instead of event/scenario based
- trigger events, labels, and intents are still too manual
- action definitions must be implemented as the shared registry described in [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md)
- intake still queues some triage paths directly instead of always passing through trigger matching
- scenario execution, action outputs, approval requests, dry runs, and loop-prevention refs are designed but not yet implemented
- routing implementation is still too findings-focused and needs typed action outputs
- communication channel policies have too few actions and do not yet use the same graph model
- retry, timeout, heartbeat, approval, dry-run, rate-limit, and graph schemas must be implemented from the canonical contracts

## Acceptance Criteria

The model is ready for implementation when:

- installed apps create connector and/or communication-channel records with clear capability badges
- supported platforms expose event options as dropdowns
- triggers can be created per connector, channel, schedule, dashboard action, MCP action, or system event
- triggers point to scenario templates or advanced scenario versions
- scenarios combine agent, workflow, transform, review, approval, routing, and delivery actions
- action definitions decide whether repository context or worker execution is required
- channels can trigger actions and receive outputs under policy
- routing can deliver any typed output, not only triage findings
- dry-run shows the exact event, trigger, scenario, action, repository, channel, destination, approval, and output plan
- audit logs explain why automation ran and what it changed
- `triage`, `build`, and `merge` runtime jobs continue to run through `workflow_runs`
