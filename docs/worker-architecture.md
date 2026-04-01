# Worker Architecture

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). This file uses `worker` for the single-job execution runtime, `gateway` for a customer-managed runtime that routes to workers, and `dispatcher` for the Support Agent control-plane component that selects providers and dispatches jobs.

## Goal

Support Agent needs a universal worker system that can run `triage`, `build`, and `merge` jobs across different execution environments without changing the core runtime contract.

The product should not care whether a job runs on:

- Google Cloud
- AWS
- a local Mac mini
- a local Linux machine
- a GitHub Actions runner

It should submit one normalized job and let an execution provider decide how to run it.

For enterprise customers, the preferred deployment is that the worker runs inside the customer's environment and clones the repository there. The control plane should not require direct repository access.

Enterprise customers should also be able to implement either a direct worker or a customer-managed gateway from the published machine-oriented contract in [llm/index.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/llm/index.md).

The preferred delivery mechanism for that contract should be a customer-installed runtime CLI package described in [runtime-cli.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/runtime-cli.md).

## Core Design

Use a two-layer execution model:

1. **Dispatcher**
2. **Execution Providers**

Inside the worker runtime itself, assume a local orchestrator layer that translates the normalized job into concrete Claude, Codex, or hybrid execution steps.

### Dispatcher

The dispatcher owns:

- claiming queued triage jobs
- claiming queued build jobs
- claiming queued merge jobs
- selecting an execution provider
- building the normalized worker payload
- dispatching work to the provider
- tracking lifecycle state
- receiving provider callbacks or polling provider state
- handling retries and timeouts
- tracking reverse-connected runtime session state on the cloud side
- interpreting heartbeat loss and marking runs `lost`
- applying retry or reschedule policy after disconnects

The dispatcher is part of Support Agent's backend system. It is the orchestrator.

### Execution Provider

An execution provider is an adapter for a runtime environment.

Examples:

- `gcp-vm`
- `aws-batch`
- `aws-ecs`
- `local-host`
- `mac-mini`
- `github-actions`

Each provider takes the same normalized worker job and translates it into the runtime-specific launch mechanism.

## Normalized Worker Job Contract

Every worker runtime should receive the same core contract.

Minimum fields:

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

Optional fields:

- `attachedInputRefs`
- `providerHints`
- `runtimeCapabilities`
- `networkRequirements`

Important rule:

The worker should fetch detailed context from the API on startup, just like the KiloSupport triage container already does. The dispatch payload should stay small and stable.

The worker should also fetch any referenced orchestration or prompt manifest data from the API instead of relying on permanently embedded prompt logic.

The customer runtime should provide the environment and toolchain. Support Agent should provide the workflow instructions and manifests.

## Unified Worker Interface

Every execution provider should implement the same interface.

Suggested shape:

```ts
interface ExecutionProvider {
  key: string;
  supports(input: ProviderSelectionInput): Promise<boolean>;
  dispatch(job: WorkerDispatchJob): Promise<ProviderDispatchResult>;
  getStatus(providerJobId: string): Promise<ProviderJobStatus>;
  cancel(providerJobId: string): Promise<void>;
}
```

Provider dispatch result should include:

- `providerJobId`
- `providerExecutionUrl`
- `providerHost`
- `startedAt`

## Provider Selection

Provider selection should be rule-based, not hard-coded.

Selection inputs should include:

- execution profile
- required operating system
- browser or emulator requirements
- Android requirement
- Mac requirement
- Docker requirement
- network access requirements
- preferred cloud or host pool

Examples:

- web triage with Playwright -> `gcp-vm` or `aws-batch`
- Android reproduction -> `gcp-vm` or `aws-ecs` if image supports emulator
- iOS-specific work -> `mac-mini`
- repository-native CI validation -> `github-actions`

## Execution Profiles

Execution profiles should describe what a job needs, not where it runs.

Examples:

- `analysis-only`
- `web-repro`
- `android-repro`
- `repo-ci`
- `mac-required`

This lets the dispatcher map one profile to different providers in different environments.

Execution profiles should map onto a small number of prebuilt runtime profiles rather than causing per-job image builds.

Reference: [worker-deployment.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/worker-deployment.md)

## Recommended Providers

### 1. GCP VM Provider

Best first production provider.

Use for:

- long-running triage
- browser automation
- Android-capable images
- broad custom tooling

This matches the existing KiloSupport shape most closely.

### 2. Local Host Provider

Best first development provider.

Use for:

- running jobs on the current machine
- local Linux box
- local Docker host

This should launch the same worker image or equivalent local command without cloud provisioning.

### 3. Reverse-Connected Host Provider

Use for any privately hosted machine or server that cannot be reached directly from the cloud.

Examples:

- Mac mini on local infrastructure
- on-prem Linux server
- private VM behind NAT
- home-lab machine

This should be treated as a managed host pool, not a special-case hack. The host needs a small connector app that establishes an outbound connection to Support Agent.

### Reverse Connection Mode

The reverse-connected provider should work through a runtime operating in reverse connection mode on the private machine.

That runtime may be:

- a worker that executes jobs directly
- a gateway that dispatches jobs to one or more workers

In reverse connection mode, the runtime should:

- open an outbound WebSocket connection to Support Agent in the cloud
- authenticate itself as a registered worker or gateway
- declare its capabilities
- receive dispatch commands over the live session
- execute the job directly or forward it to workers
- stream lifecycle events, progress, and heartbeats back over the same session

This avoids any requirement for inbound connectivity to the machine.

### Host Session Model

The cloud side should treat the reverse-connected runtime as an online execution endpoint.

Recommended flow:

1. runtime boots on the private machine
2. runtime authenticates to the cloud
3. runtime registers metadata and capabilities
4. runtime maintains a WebSocket session with heartbeats
5. dispatcher assigns eligible jobs to that runtime when available
6. runtime executes the job directly or dispatches it to workers
7. worker or gateway sends progress, artifacts, and final results back to the API

Ownership rule:

- dispatcher owns cloud-side session registry, heartbeat interpretation, lost-run handling, and rescheduling
- worker owns direct job execution on a single host
- gateway owns downstream worker selection and internal pool coordination when it manages multiple workers

### Host Capabilities

The reverse-connected runtime should advertise things like:

- operating system version
- hardware class
- browser availability
- Docker availability
- Android tooling availability
- Xcode or simulator availability when relevant
- `app-reveal` availability
- max concurrency
- current load
- supported execution profiles

The dispatcher should only send jobs to a reverse-connected endpoint when the required profile matches the registered capabilities.

### Result Return Path

The reverse-connected runtime control channel and the worker result channel should be distinct.

Recommended split:

- WebSocket: registration, heartbeats, dispatch messages, cancellation, lightweight status, and incremental live log chunks from reverse-connected workers or gateways
- HTTP API: worker context fetch, artifact upload, structured report submission, and final result persistence over `POST`

Do not send final reports, artifacts, screenshots, or other bulky payloads over WebSocket.

Live log chunks are acceptable over WebSocket when they are incremental and needed for realtime visibility. The backend must persist them so the dashboard can replay the full log stream later.

This keeps the control plane light while still allowing realtime visibility and reliable delivery of larger outputs.

### Reverse-Connected Runtime Reliability Rules

- the runtime should support automatic reconnect
- the dispatcher should consider the endpoint offline if heartbeats stop
- running jobs should be marked lost or retryable if the session drops unexpectedly
- secrets should not be baked into static command lines
- any local worker should still use the same API-only contract after launch

### 4. Mac Mini Provider

Use when the execution profile specifically requires macOS or iOS tooling.

Architecturally this should just be a specialized case of the reverse-connected host provider.

### 5. AWS Batch or ECS Provider

Good fit for teams already on AWS.

Use for:

- queued container jobs
- scaling across spot/on-demand compute
- containerized long-running triage

AWS Batch is a stronger fit than AWS Lambda for this workload because it is built for queued container jobs with retries, priorities, and resource scheduling.

### 6. GitHub Actions Provider

Possible, but should be treated as a specialized provider, not the default.

Use for:

- repository-native workflows
- cases where code must run in the repo's existing CI environment
- validation steps that benefit from the repository's own Actions setup

Why it is possible:

- GitHub supports self-hosted runners.
- GitHub supports programmatic workflow triggering through `workflow_dispatch`.

Why it should not be the primary worker:

- it requires workflow files in the target repository
- it couples execution to GitHub-specific repository setup
- hosted runners have execution limits
- it is a weaker fit for universal multi-platform orchestration

### 7. DigitalOcean Functions Provider

Not recommended for main triage workloads.

Reason:

- DigitalOcean Functions currently have a maximum timeout of 15 minutes

That makes them a poor fit for clone, build, browser, emulator, and investigation-heavy jobs. If DigitalOcean is needed, Droplets or container-based compute are a better match than Functions.

## Provider Registration

Execution providers should be registered in configuration.

Each provider or host should declare:

- provider type
- enabled status
- supported execution profiles
- operating system
- runtime capabilities
- max concurrency
- network zone
- secret references
- connection mode

Examples:

- `gcp-triage-eu-west-1`
- `aws-batch-main`
- `mac-mini-lab-01`
- `local-dev-machine`
- `github-actions-org-runner`

For local or privately hosted machines, `connection mode` should support reverse-connected workers or gateways over WebSocket.

## Worker Images

The worker image should stay universal and reusable.

It should conform to the same runtime contract regardless of provider:

- receives minimal dispatch metadata
- fetches full context from API
- clones the target repo
- runs investigation
- streams progress
- uploads artifacts
- posts final report

This means the same worker image can run on GCP, AWS, local Docker, or a self-hosted GitHub Actions runner.

For reverse-connected runtimes, the worker may be launched directly by that runtime instead of a container runtime, but it must still honor the same startup and reporting contract.

Use a small family of stable runtime profiles instead of custom images per run.

## Recommended Product Shape

Use this split:

- queue holds workflow runs
- dispatcher claims runs
- dispatcher selects provider
- provider launches worker
- worker uses the universal runtime contract

This is the right balance of flexibility and control. It keeps the product universal without forcing every runtime to expose the same provisioning mechanism.

## Initial Recommendation

Start with:

1. `local-host` provider for development
2. `gcp-vm` provider for first production execution
3. `reverse-connected-host` provider for any private machine or server
4. `mac-mini` as a capability-specific host pool on top of that provider
5. `github-actions` as an optional specialized provider later
6. `aws-batch` as the AWS-native scale-out provider later

Do not start with DigitalOcean Functions for triage.
