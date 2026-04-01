# Worker Deployment Strategy

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). Deployment strategy here concerns `workers` as execution runtimes; a `gateway` chooses and dispatches those runtimes but is not itself the runtime profile.

## Problem

Workflow runs may need very different environments:

- plain repository analysis
- web reproduction with Playwright
- Android build and emulator tooling
- macOS or iOS-specific work
- repository-native CI validation
- customer-specific internal tooling

If every job requires a custom container build, deployment becomes slow, brittle, and operationally expensive.

## Core Rule

Do not build a brand-new worker image per workflow run.

Instead:

- define a small number of stable worker runtime profiles
- prebuild images for those profiles
- let the dispatcher select the right profile for each run

For enterprise customer-managed execution, do not assume we ship the final runtime image ourselves. We should publish the runtime contract and allow the customer to build a compatible environment in their own infrastructure.

The preferred customer-facing packaging for that model should be a runtime CLI package that the customer installs into their own environment and wires to the required toolchain.

## Recommended Model

Use three levels:

1. **Execution Profile**
2. **Runtime Profile**
3. **Execution Provider**

### 1. Execution Profile

This describes what the job needs.

Examples:

- `analysis-only`
- `web-repro`
- `android-repro`
- `mac-repro`
- `repo-ci`

### 2. Runtime Profile

This describes a prebuilt environment that can satisfy one or more execution profiles.

Examples:

- `worker-core`
- `worker-web`
- `worker-android`
- `worker-mac`
- `worker-ci`

### 3. Execution Provider

This describes where the runtime runs.

Examples:

- `gcp-vm`
- `aws-batch`
- `reverse-connected-host`
- `github-actions`

This separation matters because the same runtime profile may run on several providers.

## Practical Image Strategy

Start with a small image family.

### `worker-core`

Use for:

- code analysis
- issue understanding
- git operations
- prompt building
- report generation

Include:

- Node.js
- git
- jq
- curl
- Python
- Codex CLI
- Claude Code CLI if needed

### `worker-web`

Use for:

- browser-based reproduction
- screenshot capture
- Playwright flows

Include `worker-core` plus:

- Playwright
- Chromium
- browser system dependencies

### `worker-android`

Use for:

- Android builds
- emulator flows
- `app-reveal` Android work

Include `worker-web` plus:

- Android SDK
- Java toolchain
- emulator tooling
- Android build dependencies

### `worker-mac`

This is not a normal container image.

It is a capability profile implemented by a reverse-connected runtime on macOS machines. That runtime must advertise that it can satisfy `mac-repro` style jobs.

### `worker-ci`

Use for:

- repository-native validation
- CI-like tasks

This may reuse `worker-core` or `worker-web` depending on the repo needs.

## How To Handle Customer Variance

Customer environments will differ. Do not solve that by exploding the number of official images.

Preferred order:

1. pick the closest standard runtime profile
2. pass repo-specific commands and environment through the job context
3. use execution-provider-specific host capabilities for special cases
4. only introduce a new official runtime profile when several customers need it

## Customer-Specific Requirements

Some customers will need:

- custom build tools
- private package registries
- internal VPN or network access
- proprietary CLIs

That should usually be handled by the execution provider environment, not by the global worker image family.

Examples:

- AWS worker account with private network access
- reverse-connected private host with customer CLIs installed
- customer-managed Mac mini with Xcode and internal certificates

Enterprise customers may satisfy these requirements by using Claude or Codex to build their own compatible worker or gateway runtime from the `docs/llm/` contract instead of consuming our prebuilt images directly.

## Deployment Workflow

Use a predictable build and release flow for worker runtimes.

For each runtime profile:

1. build image once
2. tag with version
3. publish to registry
4. mark compatible execution profiles
5. let execution providers pull that tagged image

The dispatcher should dispatch by `(execution profile -> runtime profile -> provider)`.

## Why This Is Better

This gives:

- fast job startup
- stable debugging
- fewer moving parts
- repeatable support
- clearer compatibility rules

It avoids:

- building custom images for each run
- hidden drift between customers
- fragile last-minute dependency installs

## Where To Allow Customization

Customization should live in:

- execution profile config
- provider config
- customer secret/config injection
- host capabilities

Customization should not usually live in:

- ad hoc Dockerfile generation
- per-run image builds
- per-customer forks of the worker

## Initial Recommendation

Start with:

- `worker-core`
- `worker-web`
- `worker-android`
- reverse-connected `worker-mac` capability via a macOS runtime operating in reverse connection mode

That is enough for the current product direction.

If later a repeated need appears, add a new runtime profile deliberately. Do not let the image family grow without a clear reuse threshold.

For enterprise onboarding, pair this with [llm/index.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/llm/index.md) so customers can self-build compatible runtimes instead of requiring us to store a custom image per customer.
