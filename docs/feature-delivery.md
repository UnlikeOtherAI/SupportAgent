# Feature Delivery

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). This workflow operates above individual `workers`. The control plane sequences the work, and workers execute the runnable parts.

## Purpose

Support Agent should support longer-running feature delivery cycles driven by project-management systems such as Jira.

This is not just bug triage.

It is epic-level implementation orchestration.

## Core Scenario

A project manager prepares:

- a Jira epic
- child tickets with strong descriptions
- acceptance criteria
- design images or other product assets
- dependency relationships
- an `AI ready` marker on the epic

Support Agent then:

1. ingests the epic and its tickets
2. validates the dependency graph
3. adjusts dependency links if policy allows and the connector supports edits
4. chooses the runnable tickets
5. executes work in sequence or in parallel depending on dependency state and repo boundaries
6. builds and validates the resulting feature
7. produces a branch and detailed PR
8. publishes a preview or app-distribution build such as TestFlight when configured

## Core Rule

Feature delivery is a control-plane workflow driven by a work graph, not a flat queue of unrelated tickets.

The platform should understand:

- epics or parent items
- child tickets
- dependencies
- readiness markers such as tags or labels
- design and specification attachments

## Dependency Graph Validation

Before starting execution, Support Agent should validate whether the declared dependency graph makes sense.

That may include:

- detecting impossible ordering
- detecting obviously missing prerequisite edges
- detecting tickets that can run independently
- detecting tickets that should likely be grouped by repo or package

If the connector supports issue-link editing and the project policy allows it, the system may normalize dependency links or propose corrections before work starts.

If connector edits are not supported, the system should preserve the suggested graph internally and notify the operator.

## Parallelism

The platform should be able to run independent tickets in parallel.

Examples:

- API work and admin-panel work in a monorepo
- backend service ticket and mobile UI ticket when no dependency exists

Parallelism should be controlled by:

- dependency graph
- execution profile compatibility
- repository boundaries
- runtime capacity
- review policy

## Inputs The Platform Must Understand

For this workflow, connectors should ideally expose:

- epic or parent-child hierarchy
- ticket dependencies
- acceptance criteria text
- labels or tags such as `AI ready`
- attachments, especially design images
- comments and status updates

## Output Expectations

At the end of the cycle, the platform should be able to produce:

- one or more branches
- a detailed PR or set of PRs
- linked ticket updates
- build artifacts
- preview delivery or app distribution outputs

Examples:

- TestFlight build available for PM review
- preview deployment for web feature validation
- monorepo feature branch with linked PR summary

## Human Experience

The intended experience is:

- PM marks the epic as ready before the weekend
- Support Agent spends the weekend executing the plan
- on Monday morning the PM sees a working build and a detailed engineering trail instead of a blank sprint board

## Guardrails

This workflow should still respect:

- dependency policies
- review loops
- runtime capability limits
- human approval gates when configured
- connector capability limits for edits, uploads, and distribution callbacks

## Initial Recommendation

Start with:

- Jira epic intake
- dependency-aware ticket selection
- acceptance-criteria-driven implementation
- design-asset ingestion
- branch plus PR output
- optional TestFlight or preview delivery target

Treat this as a first-class workflow, not a pile of individual ticket automations.
