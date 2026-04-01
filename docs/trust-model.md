# Trust Model

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). The trust boundary applies to both direct `workers` and customer-managed `gateways`, but only workers actually touch the codebase.

## Core Principle

Enterprise customers should not have to give Support Agent direct access to their codebase.

The default enterprise posture should be:

- code stays in the customer's environment
- worker execution happens in the customer's cloud account or private host
- repository credentials are customer-managed
- the hosted Support Agent control plane orchestrates jobs, not source checkout

## Recommended Security Posture

Use a control-plane / execution-plane split:

- the hosted Support Agent control plane is the default control plane
- customer-owned cloud or private hosts are the execution plane

Support Agent should also support an on-prem deployment mode where the customer hosts the control plane as well.

In hosted-control-plane mode:

- the hosted Support Agent control plane stores configuration, job state, routing, and findings
- the worker clones and inspects code only inside the customer's environment
- repository tokens stay in the customer's secret store or reverse-connected runtime config
- the hosted Support Agent control plane never needs raw source checkout access

In on-prem control-plane mode:

- the customer hosts the Support Agent API, admin app, persistence, and orchestration components
- customer-owned workers and gateways still connect to that control plane using the same contracts
- the same runtime CLI and workflow contracts should work without assuming the hosted Support Agent control plane

## What Leaves The Customer Environment

Only these things should come back to the control plane by default:

- job status
- progress events
- streamed logs
- artifacts the customer allows
- final structured findings

Tenants may set output visibility to:

- `full`
- `redacted`
- `metadata_only`

## What Should Not Leave By Default

- full repository contents
- customer-managed repository credentials
- large source snapshots
- arbitrary workspace archives

## Output Controls

Enterprise customers should be able to configure what can be returned:

- logs allowed or redacted
- artifacts allowed or blocked
- code snippets allowed, truncated, or blocked
- source file paths allowed or normalized
- report retention rules

UI, API, and runtime behavior must degrade cleanly when these controls remove raw logs, code snippets, or full artifacts.

## Access Modes

Support Agent should support at least two clear modes:

### 1. Customer-Executed Mode

Recommended for enterprise.

- worker runs in customer cloud or private host
- repo access is local to that environment
- the hosted Support Agent control plane only receives permitted outputs

### 2. SaaS-Managed Execution Mode

Optional for smaller customers.

- worker may run in our managed environment
- customer explicitly grants repository access
- faster onboarding, weaker isolation

This mode should be opt-in, not the default assumption.

### 3. Customer-Hosted Control Plane Mode

Optional for enterprises with strict hosting requirements.

- customer hosts the Support Agent control plane on their own infrastructure
- workers and gateways connect to that customer-hosted control plane
- repository and model-access policy can stay entirely inside the customer's environment
- if `proxy` model-access mode is used here, the proxy path is part of the customer-hosted control plane, not a dependency on the hosted Support Agent control plane

## Model Credential Boundary

Runtime API keys and model-provider credentials must stay separate.

Canonical rules:

- hosted SaaS default
  - Support Agent-hosted proxy uses Support Agent-managed provider access
- hosted SaaS optional tenant-provider mode
  - raw tenant provider keys should stay in the customer runtime or customer-managed secret integration by default
  - hosted SaaS stores policy and metadata, not raw third-party model secrets
- customer-hosted control plane
  - customer may keep raw provider credentials in the customer-hosted secret store and expose them through the customer-hosted proxy path or runtime injection

## Practical Consequence

If an enterprise customer says "we do not want to give you codebase access", that should not block the product.

The answer should be:

- run workers in your account or on your private hosts
- keep credentials in your environment
- let the active Support Agent control plane orchestrate and receive only the allowed outputs

## Machine-Built Enterprise Runtime

The preferred enterprise onboarding path should be:

- publish a machine-readable runtime specification in `docs/llm/`
- provide a runtime CLI package the customer's coding agent can install and wire up
- let the customer's coding agent build the worker or gateway environment in their own infrastructure
- let that runtime register to the active Support Agent control plane with a customer-scoped API key

This is preferable to maintaining customer-specific images in our own registry.
