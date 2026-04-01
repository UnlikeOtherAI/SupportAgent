# Workflow Scenarios

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). A workflow scenario is a named control-plane automation pattern. It is not a new runtime role.

## Purpose

Support Agent should support multiple workflow scenarios per tenant or project.

The platform should not hard-code only one triage flow, one incident flow, or one feature-delivery flow.

Instead, it should let operators define several reusable scenarios and map connectors and triggers into them.

In practice, that should mean Support Agent gives the runtime instructions, not that customers write arbitrary automation code.

## Examples

Examples of workflow scenarios include:

- incident hotfix
- support-ticket triage
- manual developer assist
- inbound PR review
- weekend feature delivery
- merge-on-approval

## Core Rule

A workflow scenario should define what the platform does after a trigger fires.

At minimum, a scenario should describe:

- top-level workflow type
- trigger source
- eligibility conditions
- dependency policy
- execution profile selection
- orchestration profile selection
- review profile selection
- whether PR work is allowed
- whether PR intent is `fix` or `feature`
- whether merge is allowed
- notification behavior
- distribution behavior

The scenario should compile down to instructions or manifests consumed by the local orchestrator.

The runtime should not require customer-authored scripts to interpret a scenario. Support Agent should send enough typed instructions for the runtime to execute the scenario as `triage`, `build`, or `merge`.

## Why This Matters

Different customers and different teams will want different automation shapes.

Examples:

- one project wants incidents to auto-triage and auto-open a draft hotfix PR
- another wants support tickets to triage only and stop for human approval
- another wants Jira epics marked `AI ready` to start a feature-delivery cycle
- another wants approved PRs with the `merge` label to enter a managed merge workflow

These are different workflow scenarios, not minor flags on one giant default flow.

## Composition

Scenarios should compose from smaller policies rather than duplicating everything.

They should also stay declarative.

Operators should configure them through typed settings and instructions, not custom scripts.

A scenario may reference:

- trigger policy
- dependency policy
- execution profile
- orchestration profile
- review profile
- notification policy
- distribution target

If a scenario resolves a review profile and the run itself does not specify an explicit override, the scenario-selected review profile should win over repository mapping and project defaults. Full precedence is defined in [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md).

## Event Matching Rule

The control plane must resolve scenario matches deterministically.

Rules:

- deduplication happens before scenario execution using the canonical `dedupeKey`
- one inbound event may match several scenarios during evaluation
- for a given workflow type, only one scenario may win unless explicit fan-out is enabled

Recommended precedence:

1. repository-mapping scoped scenario binding
2. connector-scope scenario binding
3. tenant default scenario binding

If two enabled scenarios remain tied at the same precedence level for the same workflow type, the configuration is invalid and the platform must reject it.

## Admin And MCP

Workflow scenarios should be configurable in both:

- admin UI
- MCP

Operators should be able to:

- create a scenario
- clone a scenario
- enable or disable a scenario
- assign connectors or repository mappings to a scenario
- choose which trigger policies feed that scenario

## Initial Recommendation

Start with a small set of first-party scenarios:

- `incident-hotfix`
- `support-ticket-triage`
- `inbound-pr-review`
- `feature-delivery`
- `managed-merge`

Then allow tenants to customize and add more.

The customization model should still be instruction-driven, not code-driven.
