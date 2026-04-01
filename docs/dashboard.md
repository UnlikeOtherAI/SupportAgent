# Operations Dashboard

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). The dashboard should distinguish clearly between the `worker` that executes a run and any `gateway` that dispatched or hosted it. Reverse-connected operation is a connection mode, not a separate runtime role.

## Purpose

Support Agent needs a live operations dashboard for workflow runs.

The operator should be able to:

- see all workflow runs across the canonical status model
- see which execution provider and host is handling a job
- open a workflow run and watch progress in real time
- inspect the full available worker log stream
- inspect structured findings, artifacts, and final reports
- inspect what channels were notified and what conversations are linked to the run

## Main Jobs View

The main dashboard should show all jobs with at least:

- run number
- source platform
- source identifier
- title
- status
- priority
- execution profile
- execution provider
- execution host
- current stage
- created time
- started time
- duration

Recommended filters:

- status
- source platform
- provider
- host
- repository
- execution profile
- date range

## Workflow Run Detail View

When the user clicks a workflow run, they should see:

- summary header
- current status and stage
- source and routing information
- execution provider and host
- structured progress timeline
- live log viewer
- artifact list
- final report
- outbound delivery attempts
- related chat or notification activity

## Communication Activity

The run detail view should show communication activity linked to the run.

This should include:

- Slack or Teams threads notified about the run
- WhatsApp conversations paired to the scope
- action requests that came from chat
- delivery status for messages and summaries

Operators should be able to tell whether a run was started or acted on from the dashboard, MCP, or a communication channel.

If tenant output policy restricts logs, artifacts, or code snippets, the dashboard must show that restriction state clearly instead of assuming full visibility.

## Live Log Requirements

The log viewer should show all logs streamed from the worker while the job is running.

This includes:

- stdout
- stderr
- stage updates
- lightweight gateway or reverse-connected runtime events

For reverse-connected local runtimes, log chunks should be sent from the reverse-connected runtime to the cloud over the WebSocket session, because that is the available reverse channel.

For cloud-native workers, logs may arrive through direct API progress endpoints or provider adapters.

Restricted-output rule:

- some tenants may allow only redacted logs
- some tenants may allow metadata-only progress with no raw log body
- the log viewer must render those cases explicitly

## Log Transport Model

Use a split model:

- WebSocket:
  - dispatch control
  - heartbeats
  - lightweight status
  - incremental log chunks from reverse-connected hosts
- HTTP API:
  - full report submission
  - artifact upload
  - final structured result
  - historical log fetch

Important rule:

Live log chunks can go over WebSocket for reverse-connected hosts, but the backend must persist them so the UI can reload and view the full history later without depending on the original live session.

## Log Persistence

The backend should persist:

- ordered log events
- stream type
- timestamp
- stage
- host and provider metadata

If logs become large, older chunks can be compacted into object storage, but the detail page must still present one continuous log view.

## Realtime UI

The dashboard should receive realtime updates from the backend, not directly from worker hosts.

Canonical admin realtime transport:

- backend-to-admin WebSocket

Do not introduce a second realtime transport unless there is a concrete scaling or browser-compatibility reason.

Recommended model:

1. worker or gateway sends status and log chunks to the backend
2. backend persists them
3. backend fans out normalized realtime events to the admin UI

This keeps the browser isolated from provider-specific protocols.

## Initial Recommendation

Build two dashboard surfaces first:

1. jobs list with live status updates
2. workflow run detail page with live log stream and final report

This is enough to make the system operable while the rest of the product grows.
