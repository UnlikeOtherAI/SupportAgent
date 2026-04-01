# Core Contracts

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). This document defines the canonical shared shapes that other docs may reference. If another doc uses different names for the same concept, this file wins.

## Purpose

Support Agent needs explicit canonical contracts for:

- normalized inbound work items
- workflow run records
- structured findings
- structured final reports
- manifest and instruction references

Without these, different engineers will invent different payloads and state models.

## Canonical Work Item

Inbound connector data should normalize into one core work-item shape before workflow routing.

Required fields:

- `workItemId`
- `connectorInstanceId`
- `platformType`
- `workItemKind`
  - `issue`
  - `review_target`
- `externalItemId`
- `externalUrl`
- `title`
- `body`
- `priority`
- `severity`
- `status`
- `taxonomy`
- `attachments`
- `comments`
- `dependencyRefs`
- `sourcePayloadRef`
- `repositoryMappingId`
- `dedupeKey`

Notes:

- `taxonomy` is the normalized bucket for labels, tags, projects, boards, categories, issue types, and similar platform metadata.
- `attachments` should include screenshots and design assets when available.
- `comments` should include explicit bot-mention metadata when supported.
- `sourcePayloadRef` points to the raw connector payload snapshot rather than duplicating source-specific fields in core tables.
- `dedupeKey` is the canonical idempotency key for webhook, polling, comment, or chat-triggered inbound events.

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

All executable work should be modeled through `workflow_runs`.

Required fields:

- `workflowRunId`
- `workflowType`
  - `triage`
  - `build`
  - `merge`
- `workItemId`
- `repositoryMappingId`
- `executionProfileId`
- `orchestrationProfileId`
- `reviewProfileId`
- `workflowScenarioId`
- `parentWorkflowRunId`
- `status`
- `currentStage`
- `attemptNumber`
- `createdAt`
- `startedAt`
- `completedAt`
- `blockedReason`
- `providerExecutionRef`
- `acceptedDispatchAttempt`

`triage_runs`, `build_runs`, and `merge_runs` should not be separate primary workflow tables. If specialized read models are needed later, they should derive from `workflow_runs`.

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

Specialized stage names may vary by workflow type, but the status set should stay shared.

## Dispatch Authentication

Two credentials have different jobs:

- `runtimeApiKey`
  - authenticates runtime registration, capability updates, and live session establishment
- `workerSharedSecret`
  - short-lived per-dispatch credential for the accepted dispatch attempt

Canonical rule:

- the control plane issues `workerSharedSecret` per dispatch attempt
- it authenticates context fetch, progress submission, artifact upload, and final report submission for that attempt
- when a run is retried or rescheduled, older dispatch secrets become stale
- stale attempts may not finalize or mutate the canonical run outcome

The runtime API key must not double as the per-dispatch execution secret.

## Trigger Idempotency And Scenario Resolution

Every inbound automation event must normalize to one `dedupeKey`.

Rules:

- duplicate deliveries with the same `dedupeKey` must not create duplicate runs
- one inbound event may create more than one run only when explicit fan-out policy says so
- for the same workflow type, only one scenario may win unless fan-out is explicitly enabled

Recommended scenario precedence:

1. repository-mapping scoped binding
2. connector-scope binding
3. tenant default binding

If two enabled scenarios remain tied at the same precedence level for the same workflow type, configuration is invalid and the platform must reject it.

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
- UI surfaces must render a restricted-output state explicitly instead of appearing broken or empty

## Workflow Stage Model

Example stage names:

### `triage`

- `intake`
- `context_fetch`
- `repository_setup`
- `investigation`
- `reproduction`
- `findings`
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
