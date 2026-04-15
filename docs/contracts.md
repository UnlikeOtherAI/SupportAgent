# Core Contracts

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). This document defines the canonical shared shapes that other docs may reference. If another doc uses different names for the same concept, this file wins.

Automation composition reference: [automation-composition.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/automation-composition.md).

## Purpose

Support Agent needs explicit canonical contracts for:

- automation events
- platform event definitions
- normalized inbound work items
- automation scenario executions
- scenario action executions
- approval requests
- dry-run records
- action outputs and delivery attempts
- workflow run records
- structured findings
- structured final reports
- manifest and instruction references

Without these, different engineers will invent different payloads and state models.

## Canonical Automation Event

Every accepted external, scheduled, chat, dashboard, MCP, or system signal should normalize into an `AutomationEvent` before continuation resolution or start-trigger matching.

Required fields:

- `automationEventId`
- `tenantId`
- `sourceKind`
  - `connector`
  - `communication_channel`
  - `schedule`
  - `dashboard`
  - `mcp`
  - `system`
- `sourceId`
- `platformType`
- `eventKey`
- `eventVersion`
- `intakeMode`
  - `webhook`
  - `polling`
  - `chat`
  - `schedule`
  - `manual`
  - `mcp`
  - `system`
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

- `connectorInstanceId` when `sourceKind=connector`
- `communicationChannelId` when `sourceKind=communication_channel`
- `scheduleId` when `sourceKind=schedule`
- `requestId` when `sourceKind=dashboard` or `sourceKind=mcp`
- `continuationRef` when the event is a response to an existing approval, follow-up request, workflow run, delivery attempt, or scenario action

Rules:

- `eventKey` is the logical platform event. `intakeMode` is the transport or control surface that delivered it.
- `dedupeKey` is the delivery idempotency key for this received event.
- `logicalEventKey` is the cross-transport logical identity used to prevent duplicate scenario starts. It should equal `dedupeKey` only when the source has no stronger shared object/version identity.
- `sourcePayloadRef` is the canonical raw-payload snapshot reference. Do not introduce `rawPayloadRef`.
- Webhook signatures, polling authentication, tenant scope, payload schema, and loop-prevention checks must pass before an event participates in trigger matching.
- `sourcePayloadRef` should point to immutable payload storage after verification.
- `botGenerated` is set by connector or channel adapters from trusted outbound markers; it must not be trusted from user-provided payload fields.
- Not every automation event creates an `InboundWorkItem`.
- A valid `continuationRef` routes the event to an existing pending execution target. It does not create a new `ScenarioExecution` unless an explicit follow-up trigger policy starts a new scenario after the continuation is recorded.
- `continuationRef` must identify exactly one target kind unless multiple ids describe the same already-linked approval/action/scenario chain. Ambiguous or conflicting continuation refs are rejected and audited.
- Continuations for terminal targets are rejected and audited. They must not fall through into start-trigger matching.

## Canonical Platform Event Definition

Platform event definitions are registry records used by the API, admin UI, MCP, and connector adapters.

Required fields:

- `eventKey`
- `eventVersion`
- `platformType`
- `sourceKind`
- `label`
- `description`
- `supportedIntakeModes`
- `subjectKind`
- `payloadSchemaRef`
- `filterableFields`
- `taxonomyFieldMappings`
- `supportedActionFamilies`
- `requiredCapabilities`
- `deliveryLimitations`
- `loopPreventionHints`
- `isEnabled`

The code registry should seed or sync these records into the database. Code remains the source of first-party defaults; the database stores enabled state, tenant-visible metadata, and later platform drift.

## Canonical Inbound Work Item

`InboundWorkItem` is the canonical durable entity for normalized issue, ticket, card, crash, or review-target objects. It is persisted in `inbound_work_items`.

Inbound connector data should normalize into this shape when the source object has issue, ticket, card, crash, or review-target semantics.

Required fields:

- `workItemId`
- `tenantId`
- `connectorInstanceId`
- `platformType`
- `workItemKind`
  - `issue`
  - `ticket`
  - `card`
  - `crash`
  - `review_target`
- `externalItemId`
- `externalUrl`
- `title`
- `status`
- `sourcePayloadRef`
- `dedupeKey`

Optional fields:

- `body`
- `priority`
- `severity`
- `taxonomy`
- `attachments`
- `comments`
- `dependencyRefs`
- `repositoryMappingId`

Notes:

- Tickets, cards, and crashes have explicit kinds. A platform may still present them in issue-like UI if `platformType` and `taxonomy` preserve source-specific semantics.
- `taxonomy` is the normalized bucket for labels, tags, projects, boards, categories, issue types, and similar platform metadata.
- `attachments` should include screenshots and design assets when available.
- `comments` should include explicit bot-mention metadata when supported.
- `sourcePayloadRef` points to the raw connector payload snapshot rather than duplicating source-specific fields in core tables.
- `dedupeKey` is the durable work-item identity key, scoped by tenant, source, work-item kind, and external object. It is not the event-delivery idempotency key. Event delivery idempotency lives on `AutomationEvent.dedupeKey`, and many automation events may link to the same work item.

If `workItemKind=review_target`, the normalized work item must also include:

- `repositoryRef`
- `baseRef`
- `headRef`
- `commitRange`
- `diffRef`
- `reviewTargetType`
  - `pull_request`
  - `merge_request`
- `reviewTargetNumber`

## Canonical Workflow Run

Repository, runtime, and background job execution should be modeled through `workflow_runs`. Control-plane scenario actions are modeled through `scenario_action_executions`; they only create a `workflow_run` when the selected action definition requires repository or runtime execution.

Required means non-null on every row. Optional or conditional fields may be null until the run reaches the state that needs them.

Required fields:

- `workflowRunId`
- `tenantId`
- `workflowType`
  - `triage`
  - `build`
  - `merge`
- `repositoryMappingId`
- `executionProfileId`
- `orchestrationProfileId`
- `status`
- `currentStage`
- `attemptNumber`
- `createdAt`

Optional or conditional workflow-run fields:

- `workItemId`, required when the run derives from a normalized issue, ticket, card, crash, or review target
- `reviewProfileId`, required only when a review policy is selected
- `workflowScenarioId`, for legacy or workflow-run-only scenario projections
- `scenarioExecutionId`, required when the run is created by an automation scenario
- `sourceActionInvocationId`, required when the run is created by an action graph node
- `parentWorkflowRunId`, for workflow-to-workflow chains such as build after triage
- `startedAt`
- `completedAt`
- `blockedReason`
- `providerExecutionRef`
- `acceptedDispatchAttempt`
- `prIntent`
  - `fix`
  - `feature`

`triage_runs`, `build_runs`, and `merge_runs` should not be separate primary workflow tables. If specialized read models are needed later, they should derive from `workflow_runs`.

`scenarioExecutionId` links a workflow run to the parent automation context. `parentWorkflowRunId` is only for workflow-to-workflow chains, such as build after triage or merge after build.

`sourceActionInvocationId` is a stable UUID stored on `workflow_runs`. It references the `scenario_action_executions.actionInvocationId` that created the run, not a per-attempt `actionExecutionId`. A unique constraint on `(tenantId, scenarioExecutionId, sourceActionInvocationId)` should prevent duplicate child runs from action retries.

`prIntent` resolution precedence is action input, then automation scenario version default, then trigger policy default, then repository mapping default. The resolved value should be persisted on the `workflow_run` before dispatch.

Parentage rules:

- `scenarioExecutionId` records scenario ownership.
- `parentWorkflowRunId` records runtime workflow chaining.
- A scenario-created run may have both fields when it is a build-after-triage or merge-after-build child.
- A scenario-created run with no workflow parent has `scenarioExecutionId` and no `parentWorkflowRunId`.
- A manually chained workflow run may have `parentWorkflowRunId` without `scenarioExecutionId` only when it was not created by an automation scenario.
- `workflowScenarioId` is legacy/projection metadata only; new scenario-created runs should use `scenarioExecutionId` plus `sourceActionInvocationId`.

## Canonical Scenario Execution

`ScenarioExecution` is the parent automation context created after a start trigger matches. Continuation events such as approval decisions, follow-up replies, and observe-existing-run commands reference an existing `scenarioExecutionId`, `actionExecutionId`, `approvalRequestId`, or `workflowRunId`; they do not create a second parent execution for the same pending gate.

Required fields:

- `scenarioExecutionId`
- `tenantId`
- `automationEventId`
- `triggerPolicyId`
- `automationScenarioId`
- `automationScenarioVersionId`
- `status`
- `createdAt`
- `policyDecisionRefs`
- `auditEventRefs`

Conditional fields:

- `repositoryMappingId` when any selected action requires repository context
- `communicationChannelId` when the source or destination channel participates in the scenario
- `startedAt` when execution begins
- `completedAt` when execution reaches a terminal state
- `canceledAt` when status is `canceled`
- `cancelReason` when status is `canceled`

Scenario execution statuses:

- `queued`
- `running`
- `awaiting_approval`
- `blocked`
- `succeeded`
- `failed`
- `canceled`

Rules:

- Disabling a scenario prevents new executions but does not cancel existing executions.
- Canceling a scenario execution should cancel queued action executions and request cancellation for cancellable workflow runs.
- Workflow runs remain the canonical records for repository/runtime execution.
- Workflow runs created by a scenario must store `scenarioExecutionId`; the scenario should not be the only place that lists child run ids.

## Canonical Scenario Action Execution

Each action graph node execution should have one durable record per attempt.

Required fields:

- `actionExecutionId`
- `actionInvocationId`
- `tenantId`
- `scenarioExecutionId`
- `nodeId`
- `attemptNumber`
- `status`
  - `queued`
  - `running`
  - `awaiting_approval`
  - `blocked`
  - `retry_scheduled`
  - `succeeded`
  - `failed`
  - `skipped`
  - `canceled`
- `createdAt`

Conditional fields:

- `actionKey` for executable nodes
- `startedAt` when execution starts
- `completedAt` when execution reaches a terminal state
- `retryAt` when status is `retry_scheduled`
- `retryLeaseOwner` and `retryLeaseExpiresAt` while a scheduler instance is claiming a due retry
- `cancelReason` when status is `canceled`
- `errorCode` when status is `failed`, `blocked`, or `retry_scheduled`
- `inputRef` when the node has materialized input
- `outputRefs` when outputs are produced

Required action failures fail the scenario when retry policy is exhausted. Optional action failures may let the scenario succeed with warnings.

`actionExecutionId` identifies one durable attempt row. `actionInvocationId` is a stable UUID generated when the graph node is first scheduled and reused for the same scenario execution and graph node across retries. Retry, child-run creation, approval continuation, and output ownership should use `actionInvocationId` when they need a stable logical action key, and `actionExecutionId` when they need the concrete attempt that produced an artifact, log, or error.

`retry_scheduled` means the API-owned scenario scheduler must wake the action when `retryAt <= now`, claim the due row, create the next attempt record with the same `actionInvocationId`, and enqueue or execute that attempt according to the action definition. The canonical persistence mechanism is the `scenario_action_executions` table plus `retryAt` and a compare-and-set lease on the due row. A durable queue, cron scanner, or database scheduler may wake the scheduler, but none of those wake-up mechanisms is the source of truth. The scheduler must claim due retry rows with `retryLeaseOwner` and `retryLeaseExpiresAt` or an equivalent compare-and-set guard, and retry enqueueing must be idempotent by `actionInvocationId` plus next `attemptNumber` so process restarts do not create duplicate attempts. Placement executors may run or dispatch an already-claimed attempt, but they do not own action retry wake-up or attempt-number allocation.

## Canonical Action Output

Each action execution should emit typed outputs.

Required fields:

- `actionOutputId`
- `tenantId`
- `scenarioExecutionId`
- `actionExecutionId`
- `outputType`
- `visibilityLevel`
  - `full`
  - `redacted`
  - `metadata_only`
- `payloadRef`
- `summary`
- `createdAt`

Conditional fields:

- `redactionReason` when `visibilityLevel=redacted` or `visibilityLevel=metadata_only`

Delivery attempts are separate records.

`action_delivery_attempts` is the canonical delivery-attempt record. Existing `outbound_delivery_attempts` is legacy workflow-output delivery and should be migrated or aliased into `action_delivery_attempts`; new delivery code must not write both as independent sources of truth.

Required delivery-attempt fields:

- `deliveryAttemptId`
- `tenantId`
- `actionOutputId`
- `destinationType`
- `destinationId`
- `status`
- `attemptNumber`
- `createdAt`

Conditional delivery-attempt fields:

- `externalRef` when the external system returns a message id, issue id, callback id, URL, or equivalent reference
- `error` when the delivery attempt fails or is blocked
- `completedAt` when the delivery attempt reaches a terminal state

An action can succeed while one delivery attempt fails. Routing and delivery status must not overwrite the action outcome.

Canonical `destinationType` values:

- `source_connector`
- `routing_target`
- `communication_channel`
- `repository_provider`
- `dashboard_artifact`
- `mcp_response`
- `parent_product_integration`

Approval output rules:

- `approval.request` emits an `action_outputs` row with `outputType=approval_request` before delivery.
- the pending `approval_requests` row references that output through `deliveryOutputId` before external delivery attempts are created.
- An approval continuation records the decision and emits `outputType=approval_decision` with `approvalRequestId`, `decision`, `decidedByActor`, `decidedAt`, and optional decision notes.
- `approval_decision` is not the pending approval request delivery payload.

## Canonical Action Definition

First-party actions should be registry-backed and versioned.

Internal actions such as `work_item.create_or_update`, `agent.control.respond`, `workflow.create_triage_run`, `workflow.create_build_run`, `workflow.create_merge_run`, `workflow.wait_for_result`, `notification.send`, `delivery.send_output`, and `approval.request` are still first-party action definitions. They are not exceptions to registry validation.

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

`runtimePlacement` values:

- `control_plane`
- `worker_required`
- `scenario_wait`
- `delivery_adapter`
- `approval_wait`
- `transform`

`runtimePlacement=worker_required` actions create or execute `workflow_runs`. `runtimePlacement=scenario_wait` actions pause scenario execution until an existing workflow run or external state changes; they do not run on a worker. `runtimePlacement=approval_wait` actions create a durable approval request, publish the approval output through routing, and keep the action execution in `awaiting_approval` until a correlated continuation event records the decision. Control-plane actions must be short, bounded, and safe to retry.

Any control-plane, delivery-adapter, approval-wait, scenario-wait, or transform action with side effects must use `actionInvocationId` as its external or internal idempotency key, optionally namespaced by action key and side-effect name. Pure read or transform actions may retry without a side-effect key. Retried attempts must check existing outputs and side-effect records for the same `actionInvocationId` before writing again.

Approval waits gate scenario graph progression, not an already-running worker process. Place approval nodes before `workflow.create_*_run` when approval is required before dispatch, or after `workflow.wait_for_result` when approval is required after a run completes.

Initial internal action placements:

- `workflow.create_triage_run`, `workflow.create_build_run`, and `workflow.create_merge_run`: `worker_required`
- `workflow.wait_for_result`: `scenario_wait`
- `approval.request`: `approval_wait`
- `delivery.send_output`: `delivery_adapter`
- `notification.send`: `delivery_adapter`
- `agent.control.respond`: `control_plane`
- `work_item.create_or_update`: `control_plane`
- `transform.payload`, `transform.finding_to_comment`, and `transform.finding_to_ticket`: `transform`

`retryPolicy` fields:

- `maxAttempts`
- `backoff`
  - `none`
  - `fixed`
  - `exponential`
- `baseDelaySeconds`
- `maxDelaySeconds`
- `retryOn`
- `giveUpStatus`

`timeoutPolicy` fields:

- `startTimeoutSeconds`
- `heartbeatTimeoutSeconds`
- `runTimeoutSeconds`
- `onTimeout`
  - `retry`
  - `fail`
  - `cancel`
  - `await_human`

## Canonical Action Graph

Automation scenario versions should store a typed graph JSON document.

Required top-level fields:

- `schemaVersion`
- `nodes`
- `entryNodeIds`
- `defaultRetryPolicy`
- `defaultTimeoutPolicy`

Required node fields:

- `id`
- `type`
  - `sequence`
  - `condition`
  - `approval`
  - `workflow_run`
  - `wait_for_workflow_result`
  - `transform`
  - `delivery`
  - `stop`
- `dependsOn`

Conditional node fields:

- `actionKey`, required for executable nodes such as `approval`, `workflow_run`, `wait_for_workflow_result`, `transform`, and `delivery`

Optional or defaultable node fields:

- `input`
- `onFailure`
- `retryPolicy`
- `timeoutPolicy`

Pure control nodes such as `sequence`, `condition`, and `stop` do not require an `actionKey` unless they are explicitly modeled as executable first-party actions.

`wait_for_workflow_result` nodes should use `actionKey=workflow.wait_for_result`.

`approval` nodes should use `actionKey=approval.request` unless a later registry version defines a more specific approval action key. The node type means "pause this branch"; the action key means "create and route the durable approval request."

Approval node input must include or resolve:

- `reason`
- `approverScope`
- `expiresAt` or `timeoutPolicy`
- `requestedByActor`
- `selfApprovalAllowed`
- `approvalPolicyRef`
- `eligibleDecisionTargets`
- `deliveryTargets`

Initial `onFailure` values are:

- `stop`, fail the scenario or branch after retries are exhausted
- `continue`, mark the action failed with warning and continue dependent optional branches
- `skip_dependents`, skip dependent nodes that require this output
- `await_human`, block the scenario until an operator decides how to proceed

`retry` is controlled by `retryPolicy`, not by `onFailure`.

Condition nodes should use constrained field/operator/value clauses. Initial operators are `equals`, `not_equals`, `contains`, `not_contains`, `in`, `not_in`, `exists`, and `missing`.

Graph validation must reject unknown executable action keys, unknown output references, cycles unless a future bounded-loop node is explicitly introduced, missing required repository or channel context, and incompatible destination/output pairs.

## Canonical Approval Request

Approval requests are durable gates for customer-visible, high-risk, or destructive actions.

Required fields:

- `approvalRequestId`
- `tenantId`
- `scenarioExecutionId`
- `actionExecutionId`
- `approvalPolicyRef`
- `selfApprovalAllowed`
- `eligibleDecisionTargets`
- `requestedByActor`
- `approverScope`
- `status`
  - `pending`
  - `approved`
  - `denied`
  - `expired`
  - `canceled`
- `reason`
- `expiresAt`
- `auditEventRefs`

Conditional fields:

- `decidedAt` when status is `approved`, `denied`, or `expired`
- `decidedByActor` when a human or service actor decides the request
- `deliveryOutputId` when the approval request was delivered through a channel or destination; this references the `action_outputs` row with `outputType=approval_request`

For `approval.request`, `deliveryOutputId` is populated in the same transaction that creates the pending approval request. Delivery attempts then deliver that output to one or more targets. If every delivery attempt fails, the approval can remain pending, expire, or be escalated by policy, but its durable request and output row still exist.

Denied and expired approvals should unblock the graph through explicit failure or branch handling. They must not silently continue to delivery.

`approverScope` should use one of:

- `role:{roleKey}`
- `user:{userId}`
- `team:{teamId}`
- `channel_admin:{communicationChannelId}`
- `tenant_admin`

Approval policy must state whether the requester may approve their own request. Default is no for high-risk, destructive, secret, repository-access, and customer-visible delivery actions. Future quorum approvals should use `requiredApprovalCount` and `eligibleApproverScope`; until then, one eligible approver is enough.

Approval policy must also state which decision surfaces are eligible for each risk class. `eligibleDecisionTargets` may include admin UI, MCP session, communication channel, or communication channel pairing scopes. A WhatsApp, Slack, Teams, or other channel delivery is not an eligible approval surface unless this resolved set includes that channel or pairing for the action risk level. Approval continuations must match both `approverScope` and `eligibleDecisionTargets`.

Approval enforcement rules:

- `destructive=true` actions must default `requiresApprovalByDefault=true`.
- `riskLevel=high` actions must default `requiresApprovalByDefault=true` unless a tenant policy explicitly allows automation for that action key and scope.
- `customerVisible=true`, secret-changing, repository-access-changing, and external-callback-changing actions must default `requiresApprovalByDefault=true`.
- Registry validation should reject first-party action definitions that violate these defaults without an explicit policy exception.
- If an action requires approval and the graph omits an explicit `approval` node, the scenario compiler must inject an `approval.request` gate before the action or reject the scenario as invalid. It must not execute the action ungated.

## Canonical Dry Run

Dry runs validate a trigger and scenario without external side effects.

Required `DryRunSession` fields:

- `dryRunSessionId`
- `tenantId`
- `triggerPolicyId`
- `automationScenarioVersionId`
- `sampleEventSource`
  - `captured_event`
  - `platform_sample`
  - `synthetic`
- `sampleAutomationEventRef`
- `status`
  - `queued`
  - `running`
  - `passed`
  - `failed`
- `createdByActor`
- `createdAt`

Conditional `DryRunSession` fields:

- `completedAt` when the dry run reaches a terminal state

Required `DryRunResult` fields:

- `dryRunResultId`
- `dryRunSessionId`
- `matchedTrigger`
- `resolvedScenario`
- `actionPlan`
- `approvalPlan`
- `repositoryContext`
- `channelContext`
- `destinationPlan`
- `predictedSideEffects`
- `blockedReasons`
- `warnings`

Dry runs must audit who ran them and must not call external delivery or merge APIs.

## Workflow Run Status Model

Canonical run statuses:

- `queued`
- `blocked`
- `dispatched`
- `running`
- `awaiting_review`
- `awaiting_human`
- `succeeded`
- `failed`
- `canceled`
- `lost`

Rules:

- `blocked` means the control plane is intentionally holding the run due to dependency or policy state.
- `dispatched` means the dispatcher assigned the run to a provider or reverse-connected runtime.
- `lost` means the runtime or host disconnected unexpectedly and retry policy has not yet resolved the outcome.
- `awaiting_review` is used when an internal review loop is in progress or required next.
- `awaiting_human` is used when policy requires a manual operator step.
- `acceptedDispatchAttempt` is the only dispatch attempt allowed to finalize the run. Older attempts may upload stale telemetry, but they must not overwrite final state.
- `timeoutPolicy.onTimeout` uses `retry`, `fail`, `cancel`, or `await_human`; workflow-run timeout handling should map those values onto the canonical run statuses above.
- dispatch-attempt states such as `assigned`, `acknowledged`, and `launching` are shown in dispatch timelines while `workflow_runs.status` remains `dispatched`.

Specialized stage names may vary by workflow type, but the stage values listed below are the initial canonical enum. New stages require a contracts update before workers emit them.

Dispatch status should be tracked separately from workflow run status:

- `queued`
- `assigned`
- `acknowledged`
- `launching`
- `running`
- `completed`
- `failed`
- `canceled`
- `lost`

These are dispatch-attempt statuses on `worker_dispatches`, not workflow-run statuses. `workflow_runs.status=dispatched` covers the period after an accepted dispatch attempt is assigned and before the worker has reported run-level `running`.

If a dispatch remains `assigned`, `acknowledged`, or `launching` past `startTimeoutSeconds`, the dispatcher should mark that dispatch attempt failed or lost and apply retry policy. If a worker completes locally but final report upload fails, the accepted dispatch attempt remains `running`, the workflow run remains `running`, and `currentStage` should move to `final_report_upload` until the accepted attempt successfully submits the final report or retry policy resolves the upload failure.

## Canonical Dispatch Attempt

`DispatchAttempt` is the canonical record for dispatcher-to-provider or dispatcher-to-runtime assignment. It is persisted in `worker_dispatches` unless a future migration renames the table.

Required fields:

- `dispatchAttemptId`
- `tenantId`
- `workflowRunId`
- `attemptNumber`
- `status`
- `createdAt`

Conditional fields:

- `assignedProviderId` when the dispatcher selects a provider
- `assignedHostId` when the dispatcher selects a concrete host or reverse-connected runtime
- `providerExecutionRef` when the provider or runtime returns an external execution id
- `workerSharedSecretRef` when the attempt is assigned or acknowledged and a per-dispatch secret has been minted
- `assignedAt` when the dispatcher assigns the attempt
- `acknowledgedAt` when the provider or reverse-connected runtime accepts it
- `startedAt` when the worker begins execution
- `completedAt` when the attempt reaches a terminal dispatch state
- `lostAt` when heartbeat or connection loss marks the attempt lost
- `errorCode` when status is `failed` or `lost`

Ownership rules:

- The dispatcher owns dispatch-attempt status transitions, provider selection, start timeouts, heartbeat loss, and dispatch retry policy for an existing `workflow_run`.
- The API-owned scenario scheduler owns `scenario_action_executions.retry_scheduled` rows.
- Placement executors and delivery adapters may execute an already-claimed scenario action attempt, but they must not independently wake `retry_scheduled` actions or allocate the next scenario action attempt number.
- If a `workflow.create_*_run` action already created a `workflowRunId`, retrying that action must be idempotent by `sourceActionInvocationId`; it must reuse or requeue the existing run rather than create a duplicate run.
- `workflow.wait_for_result` observes the child workflow run from the scenario executor and resolves the scenario action when the accepted dispatch attempt finalizes the run.

## Dispatch Authentication

Two credentials have different jobs:

- `runtimeApiKey`
  - authenticates runtime registration, capability updates, and live session establishment
- `workerSharedSecret`
  - short-lived per-dispatch credential for the accepted dispatch attempt

Canonical rule:

- the control plane issues `workerSharedSecret` per dispatch attempt
- the secret must have a TTL and be bound to `workflowRunId`, `dispatchAttemptId`, and tenant
- it authenticates context fetch, progress submission, artifact upload, and final report submission for that attempt
- workers present it as an authorization header or signed bearer token, never inside user-visible logs or scenario context
- when a run is retried or rescheduled, older dispatch secrets become stale
- stale secrets must be rejected even if the worker process continues running
- stale attempts may not finalize or mutate the canonical run outcome

The runtime API key must not double as the per-dispatch execution secret.

Connector secrets used by workers must be explicit, scoped, and audited. Prefer API-owned delivery adapters for external writes. When a worker requires a local credential such as local `gh`, the action definition and execution profile must declare that requirement, and the worker should use the local runtime credential rather than receiving a stored control-plane secret.

Dispatch auth and local tool auth are separate. A local-`gh` run uses `workerSharedSecret` only for Support Agent API calls, and uses the runtime host's authenticated `gh` session for GitHub repository, issue, comment, and label operations. The dispatch attempt should record the required local credential class, such as `local_gh`, so scheduling only targets compatible hosts.

## Trigger Idempotency And Scenario Resolution

Every inbound automation event must normalize to one delivery `dedupeKey` and one scenario-start `logicalEventKey`.

Rules:

- duplicate deliveries with the same `dedupeKey` must not create duplicate `AutomationEvent` records
- duplicate start matches with the same `logicalEventKey` must not create duplicate scenario executions for the same trigger policy
- delivery dedupe enforcement should be scoped by tenant and source id
- logical event enforcement should be scoped by tenant, source id, event key, and trigger policy
- one inbound event may start more than one scenario only when explicit trigger fan-out policy says so
- with fan-out disabled, one logical event has exactly one winning trigger policy after precedence and condition evaluation, regardless of workflow action type

Canonical delivery key families:

- `webhook:{platformType}:{connectorInstanceId}:{eventKey}:{externalDeliveryId || externalObjectId}:{eventVersion}`
- `poll:{platformType}:{connectorInstanceId}:{sourceScope}:{externalObjectId}:{eventKey}:{observedVersion}`
- `chat:{platformType}:{communicationChannelId}:{externalMessageId}:{eventKey}`
- `schedule:{tenantId}:{scheduleId}:{scheduledFor}`
- `manual:{tenantId}:{actorId}:{requestId}`
- `mcp:{tenantId}:{actorId}:{requestId}`
- `system:{tenantId}:{producer}:{eventKey}:{producerEventId}`

Canonical logical key families:

- connector object/version: `logical:{platformType}:{connectorInstanceId}:{sourceScope}:{externalObjectId}:{eventKey}:{externalVersion}`
- channel message: `logical:{platformType}:{communicationChannelId}:{externalMessageId}:{eventKey}`
- continuation: `continuation:{tenantId}:{targetKind}:{targetId}:{eventKey}:{decisionOrMessageId}`
- schedule, manual, MCP, and system: same value as the delivery `dedupeKey` unless the event has a `continuationRef`

Webhook and polling deliveries for the same connector object/version must use the same connector object/version `logicalEventKey`. They keep different delivery `dedupeKey` values but share scenario-start idempotency.

Continuation events must use the continuation logical key family. `targetKind` is one of `approval_request`, `action_execution`, `workflow_run`, `scenario_execution`, or `delivery_attempt`. `decisionOrMessageId` should be the external decision id, external message id, request id, or delivery `dedupeKey` when the source has no more specific id.

Scheduled event recovery should retry or resume the existing scenario execution, not replay the same scheduled `AutomationEvent` as a new start. Manual schedule replay uses a new manual or system event with its own `requestId` or `producerEventId`.

Recommended trigger-policy precedence:

1. repository-mapping scoped trigger policy
2. connector/source scoped trigger policy
3. tenant default trigger policy

`trigger_policies` select `automation_scenario_versions`. Scenario binding tables are legacy migration/projection records only and must not decide new trigger-to-scenario precedence.

Each enabled trigger policy stores a direct `automationScenarioVersionId`. Runtime matching does not compute scenario selection from legacy binding tables.

During migration, legacy scenario binding writes must be translated into trigger policies or rejected. Runtime matching reads only `trigger_policies`.

If two enabled trigger policies remain tied at the same precedence level, configuration is invalid unless explicit trigger fan-out is enabled.

Trigger policy records should store:

- `scopeKind`
  - `repository_mapping`
  - `source`
  - `tenant_default`
- `scopeId`
- `eventKey`
- `automationScenarioVersionId`
- `workflowActionType`
  - `triage`
  - `build`
  - `merge`
  - `control_plane`
  - `multi_workflow`
- `triggerFanOut`
  - `disabled`
  - `allow_multiple_workflow_action_types`
  - `allow_multiple_scenarios`

`triggerFanOut=disabled` means one winning trigger policy per `(tenantId, sourceId, eventKey, logicalEventKey)`, regardless of `workflowActionType`. `triggerFanOut=allow_multiple_workflow_action_types` means at most one winning trigger policy per `(tenantId, sourceId, eventKey, logicalEventKey, workflowActionType)`. `triggerFanOut=allow_multiple_scenarios` permits multiple winning policies for the same logical event and same `workflowActionType`; each accepted policy still uses the per-policy logical idempotency rule above. Broader fan-out modes must be explicit and audited.

`workflowActionType` is the trigger conflict class, not a guarantee that the scenario creates only one workflow-run type. A scenario graph may create several child workflow runs internally. If a scenario can create more than one top-level workflow type, set `workflowActionType=multi_workflow` unless the product intentionally wants it to conflict under a stricter primary class such as `triage`.

Pure control-plane scenarios use `workflowActionType=control_plane` for trigger matching and tie-breaking even when they do not create a `workflow_run`.

## Loop Prevention

Loop prevention records should store bot-authored outbound markers and recent inbound events that should be suppressed.

Required fields:

- `loopPreventionRefId`
- `tenantId`
- `sourceKind`
- `sourceId`
- `eventKey`
- `outboundCorrelationRef`
- `deliveryAttemptId`
- `externalObjectId`
- `expiresAt`
- `createdAt`

Loop-prevention rejections must produce audit events. The suppression window should be explicit per connector or channel so legitimate follow-up comments are not hidden indefinitely.

## Rate Limiting

Rate limits should be configurable by tenant and optionally narrowed by connector, channel, action key, external API, model provider, or actor.

Required policy fields:

- `rateLimitPolicyId`
- `tenantId`
- `scopeKind`
- `scopeId`
- `limit`
- `windowSeconds`
- `onLimit`
  - `reject`
  - `queue`
  - `degrade`
  - `await_human`

Rate-limit hits must produce `rate_limit_events` and audit visibility. External API quota limits should use backoff/circuit-breaker behavior rather than blind retries.

## Permission Scopes

Admin UI, MCP, and channel actions should use the same permission scope registry.

Initial scopes:

- `connector:read`
- `connector:write`
- `secret:write`
- `trigger:read`
- `trigger:write`
- `scenario:read`
- `scenario:write`
- `scenario:execute`
- `delivery:test`
- `runtime:read`
- `runtime:write`
- `approval:decide`
- `audit:read`

MCP API keys and exchanged user sessions must resolve to actor id, tenant id, and allowed scopes before any configuration mutation.

## Restricted Output Mode

Tenants may restrict what leaves the execution environment.

Canonical visibility levels:

- `full`
- `redacted`
- `metadata_only`

Rules:

- dashboard and API consumers must not assume full logs or full artifacts always exist
- `redacted` means the control plane stores and shows only the redacted form
- `metadata_only` means only stage metadata, status, and allowed summaries are persisted
- restricted outputs should include `redactionReason` and `requestedVisibilityLevel`
- UI surfaces must render a restricted-output state explicitly instead of appearing broken or empty

## Workflow Stage Model

Initial canonical stage names:

All workflow types may use `final_report_upload` after worker-local completion and before the API accepts the structured final report.

### `triage`

- `intake`
- `context_fetch`
- `repository_setup`
- `investigation`
- `reproduction`
- `findings`
- `internal_review`
- `delivery`

### `build`

- `context_fetch`
- `repository_setup`
- `implementation`
- `validation`
- `internal_review`
- `branch_push`
- `pr_open`

### `merge`

- `context_fetch`
- `repository_setup`
- `base_sync`
- `conflict_resolution`
- `validation`
- `internal_review`
- `merge_execute`

These are stage values, not separate state machines.

## Structured Findings

Triage should output a structured findings record.

Required fields:

- `findingId`
- `workflowRunId`
- `summary`
- `rootCauseHypothesis`
- `confidence`
- `reproductionStatus`
- `affectedAreas`
- `evidenceRefs`
- `recommendedNextAction`
- `outboundSummary`

Optional fields:

- `suspectCommits`
- `suspectFiles`
- `userVisibleImpact`
- `designNotes`

## Structured Final Report

Every workflow run should end with one final report payload.

Required fields:

- `workflowRunId`
- `workflowType`
- `status`
- `summary`
- `stageResults`
- `artifactRefs`
- `logRef`
- `findingsRef`
- `reviewOutcome`
- `outboundActions`

Optional fields:

- `branchName`
- `pullRequestRef`
- `mergeRef`
- `distributionRefs`

## Manifest And Instruction Terms

These terms should stay distinct:

- `promptManifest`
  - reusable prompt bundle or prompt-template set
- `reviewManifest`
  - executable review-round definition for internal review loops
- `scenarioInstruction`
  - workflow-specific action instructions compiled from scenario, policy, and routing context

Dispatch should carry references, not large embedded bodies:

- `promptManifestRef`
- `reviewProfileId`
- `scenarioInstructionRef`

The runtime fetches the concrete bodies from the API.

`reviewProfileId` selects policy, limits, and prompt-set version. `reviewManifest` is the compiled runtime document produced from that profile for a specific run.

## PR Ownership Rule

For `build`:

- the worker or gateway runtime prepares the branch, validation artifacts, and structured outputs
- the API plus outbound connector owns external PR creation unless a connector contract explicitly requires a different pattern

This keeps external system writes centralized in the control plane.

## Review Profile Precedence

If more than one review profile is available, precedence should be:

1. workflow-run explicit override
2. workflow-scenario default
3. repository mapping default
4. project or tenant default

The resolved profile should be persisted onto the `workflow_run` record before dispatch.
