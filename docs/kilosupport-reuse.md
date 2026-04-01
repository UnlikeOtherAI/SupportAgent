# KiloSupport Reuse Notes

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). When reusing KiloSupport patterns, keep the distinction clear: the `worker` executes the runtime job, while any future `gateway` is a dispatch layer above workers.

## Purpose

`../KiloSupport` already contains a working runtime for the current triage flow. This project should reuse that shape instead of redesigning the whole flow from scratch.

What should be reused is the architecture and the container contract, not the KiloSupport-specific assumption that the world is only Sentry in and Linear out.

## What Already Exists in KiloSupport

Relevant implementation areas:

- triage container image and entrypoint
- API-only worker communication model
- workflow-run lifecycle and status source material
- Sentry webhook intake
- Linear webhook intake
- post-triage comment and ticket creation flows
- artifact upload and signed artifact serving
- GCE worker spawning

Primary reference files:

- `../KiloSupport/triage/Dockerfile`
- `../KiloSupport/triage/entrypoint.sh`
- `../KiloSupport/server/src/routes/triage.ts`
- `../KiloSupport/server/src/routes/triageWebhooks.ts`
- `../KiloSupport/server/src/services/triageService.ts`
- `../KiloSupport/server/src/services/triageSentryIssueService.ts`
- `../KiloSupport/server/src/services/triagePostActions.ts`
- `../KiloSupport/server/src/lib/sentryClient.ts`
- `../KiloSupport/server/src/lib/linearClient.ts`
- `../KiloSupport/server/src/lib/gceClient.ts`

## Reusable Core Pattern

The existing pattern is sound and should become the universal baseline for Support Agent:

1. source connector receives data by webhook or polling
2. source payload is validated and normalized
3. source is mapped to a repository and execution profile
4. a workflow run record is created
5. a worker job is queued or spawned
6. the worker fetches its full context over HTTP from the API
7. the worker clones the target repository and investigates
8. the worker uploads artifacts and posts a structured report back to the API
9. the API persists findings and sends updates to configured outbound destinations

That flow should stay API-first between the app and the worker.

For reverse-connected runtimes, control-plane messages and incremental log chunks may also use WebSocket, but final reports and bulky outputs should still return through API calls.

## What Should Be Brought Over With Minimal Change

These pieces are close to reusable as-is:

- triage worker container structure
- worker startup flow
- worker context fetch endpoint pattern
- worker progress reporting
- worker artifact upload pattern
- structured final report contract
- existing triage status lifecycle as implementation source material, but adapted to the canonical `workflow_runs` status model defined in [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md)
- isolated per-run workspace model

## What Must Be Generalized

KiloSupport hard-codes two sources and one outbound target shape:

- inbound sources: `sentry`, `linear`
- outbound actions:
  - Sentry issue -> create Linear issue
  - Linear issue -> comment on Linear issue

Support Agent must replace that with generic connector and destination abstractions where a single platform can be inbound, outbound, or both.

## Universal Model for Support Agent

### Inbound Connector

Each inbound connector should define:

- connector type
- auth and signature validation rules
- intake mode: webhook or polling
- source payload parser
- dedup identity
- repository mapping lookup inputs
- optional reproduction policy defaults

Examples:

- Sentry connector
- Linear connector
- GitHub Issues connector
- Jira connector
- Trello connector
- support platform connector

### Outbound Destination

Each outbound destination should define:

- destination type
- auth method
- supported actions
- formatting rules

Supported actions should include:

- create issue
- add comment
- update issue state
- attach external reference

Examples:

- Linear destination
- GitHub Issues destination
- Jira destination
- Trello destination
- webhook callback destination

### Workflow Run

The workflow run model should stop assuming source-specific columns as the primary abstraction.

Instead it should center on:

- normalized source reference
- repository mapping
- execution profile
- inbound raw payload storage
- structured investigation result
- outbound delivery attempts

Source-specific metadata can still be stored, but behind connector-specific payload fields rather than driving the core schema.

## Concrete Mapping From KiloSupport To Support Agent

### Keep

- API-only worker contract
- dedicated worker image
- progress events
- artifact handling
- structured report payload
- cloud worker spawning model

### Rename / Generalize

- `handleSentryWebhook` -> `handleInboundEvent` in connector service
- `handleLinearWebhook` -> `handleInboundEvent` in connector service
- `postTriageActions` -> `dispatchOutboundFindings`
- `linearClient` and `sentryClient` -> outbound and inbound connector clients
- `TriageSource` enum -> connector key or source type registry

### Split Further

KiloSupport currently mixes orchestration with source-specific logic inside the triage services. Support Agent should split this into:

- connector intake services
- triage orchestration service
- worker dispatch service
- outbound delivery service

## Worker Runtime Notes

The worker contract in KiloSupport is already the right direction:

- worker receives a job identifier and auth secret
- worker fetches the full context from the API
- worker never touches the database directly
- worker reports artifacts and final results over HTTP
- reverse-connected runtimes may also stream control messages and incremental log chunks over WebSocket
- worker returns a structured report

That should remain the core rule here.

The worker image should also stay broad enough to support:

- git
- Playwright
- Docker CLI when needed
- Android tooling where required
- Codex and Claude Code CLIs

## Sentry and Linear Behavior To Replicate

From KiloSupport, the reusable source-specific behaviors are:

- Sentry:
  - validate webhook signature
  - normalize issue payload
  - store payload
  - create workflow run
  - after triage, optionally comment back to Sentry and create or link a downstream issue in the configured outbound platform
- Linear:
  - validate webhook signature
  - trigger only when the configured workflow-start label is added
  - fetch the full issue via API
  - store payload and attachments
  - create workflow run
  - after triage, comment back on the existing issue or create a new downstream issue when configured

Support Agent should keep those behaviors, but make them configuration-driven instead of product-driven.

The important architectural rule is:

- Sentry and Crashlytics are good examples of inbound-only connectors.
- Linear, GitHub Issues, Jira, and Trello are good examples of connectors that can be both inbound and outbound.
- The routing decision after triage must come from configuration, not from the source platform type alone.

## Immediate Build Direction

When implementation starts, the fastest path is:

1. port the triage worker container and API-only contract from KiloSupport
2. create generic inbound connector interfaces
3. create generic outbound destination interfaces
4. implement Sentry as inbound connector #1
5. implement Linear as both inbound and outbound connector #1
6. keep the rest of the system source-agnostic from day one

This gives Support Agent a real working baseline without locking it to KiloSupport's domain model.
