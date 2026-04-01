# Runtime API Key Management

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). This document concerns API keys used by customer-owned `workers` and `gateways` to register and communicate with Support Agent.

## Purpose

Support Agent needs explicit runtime API key management.

Without that, customer-owned workers and gateways cannot be onboarded cleanly or rotated safely.

## Key Types

Support Agent should distinguish runtime API keys from admin or MCP credentials.

At minimum, define:

- `runtime-api-key`
  - used by a worker or gateway to register, establish sessions, and submit results
- `admin-api-key`
  - used for administrative automation only when needed

Do not reuse admin credentials for runtime registration.

## Runtime API Key Scope

A runtime API key should be scoped as narrowly as possible.

Recommended scope dimensions:

- tenant
- environment
- allowed runtime mode
  - worker, gateway, or both
- allowed execution profiles
- optional allowed repository mappings or routing scopes
- allowed control-plane base URLs when on-prem deployments are in use

## Runtime API Key Permissions

A runtime API key should allow only:

- runtime registration
- capability updates
- live session establishment
- dispatch acknowledgment
- progress submission
- log streaming
- artifact upload
- final result submission

It should not allow:

- connector creation
- secret management
- policy changes
- repository mapping changes
- broad admin actions

## Lifecycle

Support Agent should support:

- create key
- view masked metadata
- disable key
- rotate key
- revoke key
- audit key usage

Key metadata should include:

- key id
- label
- tenant
- environment
- allowed mode
- allowed profiles
- created at
- last used at
- revoked or disabled state

## Storage Rules

Support Agent should store only a hashed or otherwise non-recoverable representation of the raw key where possible.

The raw key should be shown only once at creation time.

Customer runtimes should store the raw key in:

- cloud secret manager
- protected environment injection
- host secret storage
- secure CI/CD secret store

Do not store raw keys in source code, repo config files, or chat transcripts.

## Provider Credential Modes

Runtime API keys are not the same thing as model-provider credentials.

Support Agent should support two model-provider modes:

- `proxy`
  - runtime uses the active Support Agent control-plane proxy path for Claude and Codex
- `tenant-provider`
  - tenant is allowed to provide its own Claude or Codex credentials

If `tenant-provider` is enabled:

- runtime API keys still authenticate the runtime to Support Agent
- provider credentials remain separate secrets
- Support Agent still owns prompt and orchestration policy

Canonical storage rule:

- hosted SaaS should not store raw tenant Claude or Codex keys by default
- in hosted deployments, tenant-provider secrets should live in the customer runtime or a customer-managed secret integration unless a stricter enterprise agreement says otherwise
- in customer-hosted control-plane deployments, tenant-provider secrets may live in the customer-hosted secret store

## Rotation Rules

Rotation should support overlap.

Recommended flow:

1. create a new key
2. update the runtime configuration
3. confirm the runtime reconnects successfully
4. revoke the old key

Do not require downtime for normal rotation.

## Audit Requirements

Every runtime API key action should be auditable.

Audit events should include:

- key created
- key rotated
- key disabled
- key revoked
- registration attempt
- failed authentication
- session established

## Machine-Facing Setup Guidance

When an LLM or automation system deploys a runtime, it should:

1. request or receive a runtime API key from Support Agent
2. store the key in the customer's secret store
3. inject the key into the runtime process at startup
4. avoid writing the raw key to logs
5. validate registration immediately after deployment

## Recommended Product Surface

Support Agent should expose runtime API key management in:

- admin UI
- MCP management surface
- audit views

## Initial Recommendation

Start with tenant-scoped runtime API keys that can be limited by:

- environment
- runtime mode
- execution profiles

That is enough to support safe onboarding without overcomplicating the first implementation.
