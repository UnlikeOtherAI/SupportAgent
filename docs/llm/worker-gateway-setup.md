# Worker And Gateway Setup

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). A `worker` executes a job. A `gateway` accepts upstream jobs and routes them to workers or spawns workers on demand.

## Audience

This document is written for coding agents and automation systems that are building and deploying a customer-owned Support Agent runtime.

## Goal

Produce a runtime that:

- installs the Support Agent runtime CLI
- registers to the active Support Agent control plane with a customer-scoped API key
- runs in either `worker` or `gateway` mode
- advertises correct capabilities
- accepts dispatches and returns results using the published contract
- uses the runtime CLI for both prompt handling and connection to the active Support Agent control plane

## Mode Selection

Choose one mode.

### Use `worker` mode when:

- one machine will execute jobs directly
- simple deployment matters more than internal scheduling
- concurrency needs are low or moderate

### Use `gateway` mode when:

- there is a private worker pool
- jobs need internal scheduling
- the customer wants autoscaling or worker spawning on demand
- multiple machines or queues exist behind one registration point

## Required Inputs

Before deployment, gather:

- Support Agent API base URL
- Support Agent session base URL or explicit WebSocket endpoint
- customer-scoped runtime API key
- runtime mode: `worker` or `gateway`
- runtime name
- environment label
- supported execution profiles
- max concurrency
- result upload policy
- repo credential strategy
- artifact retention policy
- control-plane hosting mode
- model-access mode

## Installation Flow

1. Install the runtime CLI package.
2. Create a dedicated runtime user on the host when appropriate.
3. Install the required toolchain for the desired execution profiles.
4. Configure the runtime with environment variables or config file entries.
5. Store the runtime API key in the customer's secret store or host secret mechanism.
6. Start the runtime as a managed service.
7. Validate registration and capability reporting in Support Agent.

## Required Runtime Configuration

At minimum, the runtime configuration should define:

- `SUPPORT_AGENT_API_BASE_URL`
- `SUPPORT_AGENT_SESSION_BASE_URL`
- `SUPPORT_AGENT_RUNTIME_API_KEY`
- `SUPPORT_AGENT_RUNTIME_MODE`
- `SUPPORT_AGENT_RUNTIME_NAME`
- `SUPPORT_AGENT_ENVIRONMENT`
- `SUPPORT_AGENT_EXECUTION_PROFILES`
- `SUPPORT_AGENT_MAX_CONCURRENCY`

Optional but recommended:

- `SUPPORT_AGENT_ARTIFACT_UPLOAD_MODE`
- `SUPPORT_AGENT_LOG_LEVEL`
- `SUPPORT_AGENT_HEARTBEAT_INTERVAL_SECONDS`
- `SUPPORT_AGENT_WORKSPACE_ROOT`
- `SUPPORT_AGENT_ALLOWED_NETWORK_SCOPES`
- `SUPPORT_AGENT_MODEL_ACCESS_MODE`

Model access modes:

- `proxy`
  - use the active Support Agent control-plane proxy path for Claude and Codex
- `tenant-provider`
  - tenant-supplied Claude or Codex credentials allowed by policy

Control-plane rule:

- when Support Agent is hosted as SaaS, point these URLs to the hosted deployment
- when Support Agent is customer-hosted, point these URLs to the customer-hosted deployment

Session URL rule:

- if `SUPPORT_AGENT_SESSION_BASE_URL` is omitted, the runtime may derive it from `SUPPORT_AGENT_API_BASE_URL` only when the deployment explicitly documents that derivation
- if the deployment uses split domains or a separate realtime endpoint, set `SUPPORT_AGENT_SESSION_BASE_URL` explicitly

## Capability Declaration Rules

Only advertise capabilities that are actually installed and usable.

Examples:

- advertise Playwright support only if browsers and required system libraries are installed
- advertise Android support only if SDK, Java, and emulator tooling are installed and verified
- advertise macOS-specific capability only on an actual compatible host

Do not over-declare capabilities and hope jobs will work.

## Registration Validation

After startup, verify that Support Agent shows:

- runtime registered
- correct mode
- correct environment label
- correct execution profiles
- correct max concurrency
- live session healthy when reverse-connected

If any of those are wrong, fix the runtime config instead of patching state in the control plane.

## Workspace Rules

The runtime should:

- create one isolated working directory per job
- avoid reusing dirty workspaces across jobs
- clean up according to retention policy
- keep secrets out of logs and artifacts

## Result Submission Rules

Use:

- WebSocket for session control, heartbeats, dispatch, and incremental live log chunks
- HTTP `POST` for structured results, artifacts, screenshots, and other bulky outputs

Do not return final reports or large artifacts over WebSocket.

## Gateway-Specific Requirements

If deploying a gateway:

- keep a stable upstream registration to Support Agent
- preserve upstream `jobId` values
- maintain internal mapping between upstream jobs and downstream workers
- normalize downstream logs and results before sending them upstream
- avoid leaking internal worker topology unless the customer explicitly wants it visible

## Verification Checklist

Before considering the runtime ready, verify:

- registration succeeds
- heartbeat stays healthy
- one test job can be dispatched
- logs stream correctly
- artifacts upload correctly
- final report appears in Support Agent
- runtime cleanup works

## Preferred Deployment Style

Treat the runtime as a long-lived managed service.

Good options:

- `systemd` service on Linux
- process manager on macOS
- container with explicit restart policy
- VM startup service

Do not rely on ad hoc terminal sessions for a production runtime.
