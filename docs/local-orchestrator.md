# Local Orchestrator

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). The local orchestrator runs inside a customer-owned `worker` or behind a customer-owned `gateway`. It is not a separate cloud role in Support Agent.

## Purpose

Support Agent should assume that customer runtimes will use Claude, Codex, or both as the execution brains for triage, build, merge, and internal review work.

The local orchestrator is the layer inside the runtime that tells those tools what to do.

This is where the practical know-how lives.

## Core Rule

The customer runtime should not call Claude or Codex in an ad hoc way.

The customer should also not need to author custom automation code for standard platform workflows.

It should run a local orchestrator that:

- receives the normalized job from Support Agent
- fetches the relevant prompt or review manifest from Support Agent
- fetches scenario instructions from Support Agent when required
- decides which local model tool should do which step
- runs the local command sequence
- captures structured outputs, logs, and artifacts
- returns results to Support Agent

## Why This Matters

The runtime package alone is not the product moat.

The moat is:

- how work is decomposed
- how prompts are staged
- how Claude and Codex are routed
- how critique and revision loops are run
- how outputs are normalized back into the control plane

That orchestration logic should be a first-class part of the runtime contract.

## Responsibilities

The local orchestrator should own:

- step sequencing
- tool selection
- prompt or manifest application
- retry logic inside a job where appropriate
- local workspace management
- artifact and log capture
- structured result assembly

It should not own:

- tenant policy decisions
- connector routing decisions
- review profile authoring
- long-term prompt ownership

Those belong to the Support Agent control plane.

## Model Routing

The orchestrator should support at least these modes:

- `claude-only`
- `codex-only`
- `hybrid`

Examples:

- triage investigation by Codex, review pass by Claude
- patch generation by Claude, validation pass by Codex
- hotfix flow routed to the faster toolchain for first pass, then stricter review by another model or prompt family

The exact routing policy should be driven by job type and profile, not hard-coded per customer deployment.

## Control-Plane-Controlled Intelligence

The control plane should be able to tell the local orchestrator:

- which top-level workflow type is being executed
- which execution profile to use
- which review profile to use
- which prompt manifest to fetch
- which scenario instructions to fetch
- whether the job should use Claude, Codex, or both
- how many rounds are allowed
- what output schema is required

This lets Support Agent improve orchestration quality centrally without taking source code out of the customer environment.

## Runtime Contract Implications

The normalized dispatch contract should support fields such as:

- `workflowType`
- `executionProfile`
- `reviewProfileId`
- `orchestrationProfileId`
- `preferredModelRouting`
- `promptManifestRef`
- `scenarioInstructionRef`

The local orchestrator should fetch detailed instructions from Support Agent rather than relying on long embedded static prompts.

The runtime should treat Support Agent as the source of workflow intelligence. The customer environment should supply execution capacity, credentials, and local tools, but not our workflow logic.

Manifest and instruction terminology should follow [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md):

- `promptManifest`
- `reviewManifest`
- `scenarioInstruction`

## Machine-Facing Requirement

When a coding agent builds a compatible runtime, it should implement:

- the runtime CLI surface
- the local orchestrator layer
- the adapters that call Claude and or Codex locally
- the structured result reporting path

If the customer only installs toolchains without an orchestrator layer, the runtime is incomplete.

## Initial Recommendation

Start with one local orchestrator implementation in the runtime CLI package.

That orchestrator should:

- support Claude and Codex adapters
- support profile-driven routing
- support centrally managed prompt manifests
- support multi-round review loops
- expose one normalized result contract back to the active Support Agent control plane
