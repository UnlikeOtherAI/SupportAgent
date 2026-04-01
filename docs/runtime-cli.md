# Runtime CLI

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). The runtime CLI can register as either a `worker` or a `gateway`. It is a delivery mechanism for those roles, not a new runtime role.

## Purpose

Support Agent should provide a customer-installed runtime CLI as the standard way to connect customer-owned execution environments to the active Support Agent control plane.

In customer-hosted control-plane mode, the same CLI should connect to the customer-hosted Support Agent deployment instead of the hosted SaaS.

This should be the main enterprise path instead of shipping customer-specific images from our side.

## Packaging Model

The runtime should be distributed as an installable CLI package.

Initial expectation:

- npm package
- customer installs it into their own environment
- customer prepares the surrounding toolchain and operating-system dependencies
- CLI connects to the active Support Agent control plane using a customer-scoped API key

Support Agent is the orchestrator.
The customer environment is the executor.
The customer should provide runtime, toolchain, and connectivity.
Support Agent should provide workflow instructions and manifests.

## Core Roles

The CLI should support at least two operating modes:

- `worker`
  - executes jobs directly
- `gateway`
  - accepts upstream jobs and routes them to a local or private worker pool

The same binary may support both modes.

Inside either mode, the runtime should include a local orchestrator that controls how Claude, Codex, or both are used during a job.

The runtime CLI should be the canonical layer that:

- fetches prompts, manifests, and scenario instructions from Support Agent
- applies them locally through the local orchestrator
- manages the runtime connection to the active Support Agent control plane

Customers should not need to write a second prompt runner beside the runtime CLI for standard platform workflows.

## Registration and Connectivity

The CLI should:

- authenticate with a customer-scoped API key
- register itself as a worker or gateway
- advertise capabilities and supported execution profiles
- maintain a live reverse connection when needed
- receive dispatches and control messages
- run a local orchestrator for model-driven execution
- fetch centrally managed review manifests when a job requires them
- send progress, logs, and final results back to the active Support Agent control plane

Use:

- WebSocket for session control, heartbeats, dispatch, and incremental log chunks
- HTTP `POST` for final reports, artifact uploads, and other bulky payloads

Authentication rule:

- runtime API key authenticates registration and session establishment
- per-dispatch execution calls should use the short-lived dispatch secret for the accepted dispatch attempt

## Customer Responsibility

The customer should own:

- the runtime environment
- the installed toolchain
- repository credentials
- private network access
- internal certificates and proprietary CLIs

We should not require the customer to consume our prebuilt image set.

## Our Responsibility

We should provide:

- the CLI package
- the registration and dispatch contract
- the orchestrator contract
- the prompt and manifest fetch contract
- the API endpoints
- the execution-profile model
- the action and audit model
- dashboard visibility and orchestration

## Model Access Policy

The default model-access pattern should be:

- the runtime CLI calls Claude, Codex, or both through the Support Agent proxy

This lets Support Agent control:

- prompt delivery
- auditability
- rate limiting
- policy enforcement
- tenant-level routing

For selected customers, the platform may allow bring-your-own-provider-keys.

In that mode:

- the tenant stores its own model-provider credentials outside hosted SaaS by default
- the runtime CLI uses those credentials under the tenant policy
- Support Agent still owns prompts, manifests, orchestration policy, and review policy

Canonical interpretation:

- hosted SaaS + `proxy`
  - runtime uses the Support Agent-hosted proxy
- customer-hosted control plane + `proxy`
  - runtime uses the customer-hosted Support Agent proxy path
- any deployment + `tenant-provider`
  - runtime uses tenant-managed provider credentials

Hosted SaaS should not require storage of raw tenant Claude or Codex keys. If tenant-provider mode is allowed in hosted deployments, the preferred pattern is customer-managed secret injection into the runtime.

If tenant output policy restricts raw logs, artifacts, or code excerpts, the runtime must honor that policy when streaming and uploading results.

## Job Types

The runtime CLI should not be triage-only.

It should be able to execute several platform-managed job types over time, including:

- `triage`
- `build`
- `merge`

The contract should stay normalized even when job types differ.

Internal review loops may run inside any of those job types. For those cases, the runtime should execute a centrally managed review profile fetched from Support Agent rather than relying on hard-coded local prompt text.

For model-driven jobs more broadly, the runtime should execute through the local orchestrator rather than letting individual scripts call Claude or Codex directly without structure.

The runtime should not require customer-authored workflow code for normal platform scenarios. It should receive typed instructions from Support Agent and execute them.

## PR Review Intake

Support Agent should expose inbound endpoints and connector flows for repository events that announce:

- a new pull request
- a pull request update
- a ready-for-review transition
- a label or review-request event that should trigger automated review

Examples:

- GitHub webhook says a PR was opened
- GitLab webhook says a merge request is ready
- Bitbucket or Azure DevOps sends a review-relevant update

Those events should create a repository-review scenario in the control plane. Depending on policy, that scenario may compile into `triage` or `build` behavior with attached review loops rather than a separate top-level runtime type.

## Review Run Expectations

A review run may do more than static code review.

Depending on the execution profile and customer runtime capabilities, it may:

- inspect the code diff
- run tests or linters
- install project dependencies
- build the application
- launch the application
- exercise user flows
- validate implementation against a linked specification
- generate structured review findings

This is a platform capability question, not an AI limitation question.

## Why CLI First

CLI-first is the cleaner product model because:

- customers can keep code and credentials in their own environment
- customers can shape their own runtime image or host setup
- we do not have to store custom images for every client
- the control plane stays consistent across cloud and private-host deployments

## Initial Recommendation

Start with one runtime CLI package that can:

- register as a worker
- register as a gateway
- accept triage jobs
- accept build jobs
- accept merge jobs
- post progress and results back to the active Support Agent control plane

Then grow execution profiles and job types without changing the trust boundary or the orchestration model.
