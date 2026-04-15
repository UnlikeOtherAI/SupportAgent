# Workflow Scenarios

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). A workflow scenario is a named control-plane automation pattern. It is not a new runtime role. Broader automation composition is defined in [automation-composition.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/automation-composition.md).

## Purpose

Support Agent should support multiple workflow scenarios per tenant or project.

The platform should not hard-code only one triage flow, one incident flow, or one feature-delivery flow.

Instead, it should let operators define several reusable scenarios and map connectors and triggers into them.

In practice, that should mean Support Agent gives the runtime instructions, not that customers write arbitrary automation code.

This document covers the workflow-run subset of the broader `AutomationScenario` model. A broader automation scenario may run only control-plane actions and create no `workflow_runs`. A workflow scenario is the subset that creates or coordinates `triage`, `build`, or `merge` workflow runs. In the UI, operators should normally create scenario templates once; templates that include workflow-run actions are workflow-backed scenarios.

## Examples

Examples of workflow scenarios include:

- incident hotfix
- support-ticket triage
- manual developer assist
- inbound PR review
- weekend feature delivery
- merge-on-approval

## Core Rule

A workflow scenario should define what the platform does after a trigger fires when repository/runtime work is involved.

At minimum, a scenario should describe:

- workflow action or top-level workflow type when it creates a `workflow_run`
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

The workflow-backed portion of the scenario should compile down to instructions or manifests consumed by the local orchestrator.

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

- delivery deduplication happens before scenario execution using the canonical `dedupeKey`
- scenario-start idempotency uses `logicalEventKey`
- one inbound event may match several scenarios during evaluation
- with trigger fan-out disabled, only one scenario may win after precedence and condition evaluation
- `allow_multiple_workflow_action_types` permits one winner per workflow action type or conflict class
- `allow_multiple_scenarios` permits more than one winner in the same conflict class

Recommended precedence:

1. repository-mapping scoped trigger policy
2. connector/source scoped trigger policy
3. tenant default trigger policy

If two enabled trigger policies remain tied at the same precedence level, the configuration is invalid unless explicit trigger fan-out is enabled. Multi-run scenarios should use the `multi_workflow` conflict class unless the product intentionally wants them to conflict as `triage`, `build`, or `merge`.

This precedence describes trigger-policy-to-scenario resolution. `trigger_policies` select `automation_scenario_versions`; legacy scenario binding tables are migration/projection records only. Branch fan-out and delivery fan-out inside a matched scenario are configured separately in the action graph.

Legacy `workflow_scenarios`, `workflow_scenario_bindings`, and `workflow_scenario_steps` may exist only as migration inputs or read-only projections. The API should translate their writes into `automation_scenarios`, `automation_scenario_versions`, and `trigger_policies`, or reject the write once the canonical model is enabled.

## Admin And MCP

Workflow scenarios should be configurable in both:

- admin UI
- MCP

Operators should be able to:

- create a scenario
- clone a scenario
- enable or disable a scenario
- create scoped trigger policies that target a scenario version
- preview which trigger policies currently target that scenario

The admin UI should show workflow scenarios as scenario templates first. Operators should only see the underlying workflow-run terms when an action creates a background job.

## Initial Recommendation

Start with a small set of first-party scenarios:

- `incident-hotfix`
- `support-ticket-triage`
- `inbound-pr-review`
- `feature-delivery`
- `managed-merge`

Then allow tenants to customize and add more.

The customization model should still be instruction-driven, not code-driven.

`feature-delivery` should be treated as a scenario template or batch orchestration that creates one or more `build` workflow runs. It should not introduce a fourth top-level workflow type.

`inbound-pr-review` should create a `triage` workflow run with `workItemKind=review_target` and an attached review profile. It should not introduce a separate review workflow type.
