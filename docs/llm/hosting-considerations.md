# Hosting Considerations

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). The same hosting guidance applies whether the runtime registers as a `worker` or a `gateway`.

## Audience

This document is for coding agents and operators choosing where to run a Support Agent runtime.

It also applies when the Support Agent control plane itself is hosted on-prem or in a customer-owned cloud account.

## Core Rule

Choose hosting based on execution requirements, network access, and operational control.

Do not choose hosting based only on what is easiest to boot once.

## Common Hosting Shapes

### Local Or Private Machine

Use when:

- repository access is only available on local or private infrastructure
- proprietary tools or certificates exist on the machine
- macOS or special hardware is required

Considerations:

- runtime should connect out to Support Agent using reverse connection mode
- machine should run the runtime as a managed service
- logs and artifacts still return to Support Agent through the documented channels
- machine should have enough disk space for per-job workspaces

Good fit:

- Mac mini
- on-prem Linux server
- private VM behind NAT

### Dedicated Server Or VM

Use when:

- customer wants predictable, long-lived capacity
- runtime needs stable network access to private repos or internal services
- workload includes browser or Android tooling

Considerations:

- prefer explicit resource sizing
- isolate runtime user and workspace root
- define cleanup policy for disk-heavy jobs
- install required build toolchains ahead of time

### Container Host

Use when:

- the customer has a stable container platform
- execution profiles can be satisfied inside the chosen runtime image or host environment

Considerations:

- avoid per-job image generation
- mount or inject secrets safely
- confirm browser, Android, or other heavy dependencies really work in the container environment

### Serverless

Avoid for the main runtime when jobs may:

- clone large repositories
- install dependencies
- build projects
- run browsers
- run emulators

Short-lived serverless platforms are usually a poor fit for heavy triage or review jobs.

## Local Hosting Best Practices

For local or office-hosted machines:

- run the runtime under a dedicated OS user
- keep the API key in a local secret manager or protected service config
- monitor available disk space
- restrict which repositories or scopes the runtime may handle
- keep the machine on a stable power and network path

## Server Hosting Best Practices

For server or VM deployments:

- use a dedicated machine image or bootstrap script
- install all expected toolchains before registering the runtime
- keep runtime configuration in managed secrets
- use restart policies and health checks
- centralize host logs in the customer's environment when possible

## Toolchain Planning

Select hosting with the required execution profiles in mind.

Examples:

- `analysis-only` can run on light Linux hosts
- `web-repro` needs browser dependencies
- `android-repro` needs Android SDK and more disk and memory
- `mac-required` needs macOS-capable infrastructure

## Network And Access

The chosen host must be able to:

- reach Support Agent API and live-session endpoints
- reach the customer's repository host
- reach any required package registries
- reach any internal services required for validation or reproduction

Do not register a runtime until those paths are available.

If the control plane is customer-hosted, use the customer-hosted API and live-session endpoints rather than assuming the public SaaS.

## Scaling Guidance

Use:

- a direct worker for simple single-host execution
- a gateway when the customer has multiple hosts or wants internal autoscaling

Do not start with a gateway unless the customer actually needs private pool management.

## Final Recommendation

For each customer environment, choose the simplest host type that satisfies:

- the required execution profile
- the required network access
- the required trust boundary
- the expected concurrency

Prefer operational stability over cleverness.
