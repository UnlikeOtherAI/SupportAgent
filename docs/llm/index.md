# LLM Build Specification

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). In this spec, a `worker` is the runtime that executes a job. A `gateway` is a customer-managed dispatcher that accepts upstream jobs and forwards them to one or more workers.

## Purpose

This page is designed for machines and automation agents.

Enterprise customers should be able to hand this specification to Claude, Codex, or another coding agent and have it build a compatible execution environment in their own infrastructure without needing a custom image from us.

The preferred implementation path is that the coding agent installs and wires up our runtime CLI package rather than re-implementing the wire protocol from scratch.

The goal is:

- we define the contract
- we provide a standard runtime CLI package
- the customer builds the runtime in their own environment
- the resulting worker or gateway auto-registers with the active Support Agent control plane

The customer runtime should not have to encode our workflow logic. Support Agent should provide the instructions, manifests, and policy references that tell the runtime what to do.

Reference delivery model: [runtime-cli.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/runtime-cli.md)

Use these companion machine-facing documents:

- [worker-gateway-setup.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/llm/worker-gateway-setup.md)
- [hosting-considerations.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/llm/hosting-considerations.md)
- [api-key-management.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/llm/api-key-management.md)
- [review-loops.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/review-loops.md)
- [local-orchestrator.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/local-orchestrator.md)

## Supported Enterprise Modes

There are two compatible deployment shapes.

### 1. Single Worker

A single execution runtime that can accept one or more jobs directly.

Use when:

- customer wants a simple dedicated worker
- a private machine or VM will run jobs directly

### 2. Gateway

A customer-managed gateway that accepts work from the active Support Agent control plane and then distributes it to a private worker pool.

Use when:

- customer wants a pool of workers
- customer wants their own routing or capacity management
- customer wants multiple machines behind one registration point

## Contract Summary

Any compatible enterprise runtime must:

- authenticate to the active Support Agent control plane using an API key
- register itself as either a worker or a gateway
- declare its capabilities
- accept the normalized worker dispatch contract
- fetch full context from the API
- run the job inside the customer environment
- stream lightweight status and incremental logs
- return final findings, artifacts, and results through API calls

The standard way to satisfy this should be:

- install the runtime CLI package
- configure it in `worker` or `gateway` mode
- supply the customer-scoped API key
- add the customer-specific toolchain around it
- implement or enable the local orchestrator layer that drives Claude, Codex, or both

The runtime CLI is expected to handle both:

- the prompt and manifest fetch path
- the connection to the active Support Agent control plane

The runtime should expect Support Agent to provide instructions and manifests for supported workflows rather than expecting the customer to write custom automation logic.

## Model Provider Access

The default model-access mode should be Support Agent proxy mode.

In that mode:

- the runtime calls Claude, Codex, or both through the active Support Agent control-plane proxy path
- Support Agent keeps control of orchestration, prompts, policy, and audit

Canonical interpretation:

- hosted deployment: use the hosted Support Agent proxy
- customer-hosted deployment: use the customer-hosted Support Agent proxy

Optional alternative:

- selected tenants may be allowed to use their own Claude or Codex provider credentials

If tenant-owned provider credentials are allowed, the runtime should still:

- fetch prompts and manifests from Support Agent
- follow Support Agent orchestration policy
- report usage and results through the same runtime contract

## Authentication

The runtime must use a customer-scoped API key issued by Support Agent.

The API key should allow:

- host or gateway registration
- capability updates
- session establishment
- job result submission

The key should not imply broad admin access.

Per-dispatch execution calls should additionally use the short-lived dispatch secret for the accepted dispatch attempt.

Reference: [api-key-management.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/llm/api-key-management.md)

## Registration Modes

### Worker Registration

A worker should register:

- `registrationType=worker`
- worker name
- environment label
- supported execution profiles
- runtime capabilities
- max concurrency
- connection mode

### Gateway Registration

A gateway should register:

- `registrationType=gateway`
- gateway name
- environment label
- supported execution profiles
- routing capabilities
- max downstream concurrency
- connection mode

The gateway may then register and manage its own downstream worker pool internally.

## Normalized Dispatch Contract

The runtime must accept a dispatch payload that includes at least:

- `jobId`
- `workflowRunId`
- `workflowType`
- `apiBaseUrl`
- `workerSharedSecret`
- `sourceConnectorKey`
- `sourcePayloadRef`
- `targetRepo`
- `targetCommit`
- `targetBranch`
- `executionProfile`
- `reviewProfileId`
- `orchestrationProfileId`
- `preferredModelRouting`
- `promptManifestRef`
- `scenarioInstructionRef`
- `reproductionPolicy`
- `authRefs`
- `artifactUploadMode`
- `timeoutSeconds`

The runtime should treat this as a stable contract and fetch detailed context from the API rather than expecting a huge inline payload.

## Required Runtime Behavior

### Before Execution

- validate registration
- advertise capabilities
- establish live session if reverse-connected
- accept dispatch
- fetch detailed context from the API
- fetch review manifest when a review-driven job requests one
- fetch orchestration manifest or prompt manifest when the job requests one

### During Execution

- clone repository locally
- use customer-managed credentials and secrets
- run the investigation
- emit lightweight progress and log chunks
- upload artifacts if configured

### After Execution

- submit structured final report
- submit final status
- upload any remaining artifacts
- release local workspace according to retention policy

## Result Return Rules

Use:

- live session for registration, heartbeats, dispatch, cancelation, and incremental log chunks
- HTTP `POST` API calls for final reports, bulky outputs, and artifacts

Do not send full artifacts or final report bodies over the live session.

## Capability Declaration

The runtime should declare things like:

- operating system
- architecture
- browser support
- Docker support
- Android tooling support
- Xcode support
- `app-reveal` support
- max concurrency
- supported execution profiles
- network constraints

## Runtime Profiles

Support Agent expects a small number of broad runtime profiles, not per-customer custom images.

Recommended profiles:

- `worker-core`
- `worker-web`
- `worker-android`
- `worker-mac`

Customer-built environments may implement one or more of these profiles in their own way as long as the runtime contract is preserved.

## Build Guidance For Coding Agents

When an LLM builds a compatible runtime, it should:

1. choose the closest runtime profile
2. install the required toolchain locally in customer infrastructure
3. implement the registration and execution contract exactly
4. keep repository credentials in the customer environment
5. avoid inventing alternate callback contracts

The coding agent should optimize for contract compatibility, not for mirroring our internal image layout.

For review-driven jobs, the coding agent should assume review prompts and loop policy come from Support Agent at execution time rather than embedding them permanently into the runtime image or config.

For all model-driven jobs, the coding agent should also assume that the runtime needs a local orchestrator layer which applies Support Agent-managed orchestration profiles to local Claude and or Codex tool invocations.

It should not assume the customer needs to write scripts for normal workflow customization. The preferred model is that Support Agent sends instruction manifests for `triage`, `build`, and `merge`, and the runtime executes them.

It should also follow the deployment and hosting guidance in:

- [worker-gateway-setup.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/llm/worker-gateway-setup.md)
- [hosting-considerations.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/llm/hosting-considerations.md)

## Gateway-Specific Guidance

If building a gateway instead of a direct worker, the runtime should:

- maintain one upstream registration with Support Agent
- accept dispatches from Support Agent
- schedule work onto a private internal pool
- preserve the upstream `jobId` and reporting contract
- return normalized progress and final results back to the active Support Agent control plane

Support Agent should not need to know about every internal worker in the customer pool unless the customer wants that visibility.

## Trust Boundary

Customer-built runtimes are the preferred enterprise path because:

- code stays in customer infrastructure
- credentials stay in customer infrastructure
- the active Support Agent control plane only sees allowed outputs

## Stability Rules

This document should be kept stable and machine-readable.

Changes to the required contract must be:

- explicit
- versioned
- backward-compatible where possible

## Initial Enterprise Recommendation

For enterprise customers:

1. give them this specification
2. let them use Claude or Codex to build the runtime in their environment
3. let the runtime register to the active Support Agent control plane using a customer-scoped API key
4. support both single-worker and gateway modes

This avoids storing custom images for every customer while still keeping the product universal.
