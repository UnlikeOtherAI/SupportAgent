# Work Item Dependencies

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). Dependency handling is a control-plane concern. `Workers` should not start blocked work just because a runtime is available.

## Purpose

Support Agent should honor issue and ticket dependencies when the source platform exposes them.

Examples:

- Jira issue blocked by another Jira issue
- Linear issue waiting on another issue or project milestone
- GitHub issue linked to a prerequisite item

If a ticket is blocked, Support Agent should avoid starting triage, build, or merge work until the dependency policy allows it.

## Core Rule

The system should only act on dependency information when:

- the connector can discover it reliably
- the customer has enabled dependency-aware behavior for that project or connector

Do not invent dependency graphs when the source platform does not provide trustworthy information.

## Connector Capability

Dependency awareness should be treated as a connector capability.

Examples:

- `dependency-read`
- `dependency-status-read`
- `dependency-webhook`

The connector discovery step should determine whether the connected account and plan can read dependency information in a usable way.

## Intake Behavior

When a new item is ingested and dependency support exists, Support Agent should:

1. fetch dependency metadata
2. determine whether the item is blocked
3. persist the dependency state
4. decide whether to queue work immediately or hold it in a blocked state

Possible states:

- ready
- blocked
- waiting-for-external
- dependency-unknown

Canonical scheduling rule:

- Support Agent may persist the inbound work item before any `workflow_run` exists
- if dependency policy blocks execution, no run is created yet unless the product explicitly wants visible blocked runs
- if the product creates a visible blocked run, it must use `workflow_runs.status=blocked`
- when dependencies clear, the control plane either creates the first runnable run or releases the blocked run into `queued`

## Scheduling Rules

Recommended default behavior:

- do not start triage when the item is explicitly blocked by unresolved prerequisites
- allow operators to override this when needed
- re-check dependencies when upstream change events arrive or on a polling interval

This should apply to:

- `triage` workflow runs
- build runs
- merge runs

Do not let one tenant path create blocked inbound items while another creates blocked runs without an explicit policy. The scheduler and UI need one canonical behavior per deployment.

## Resumption

When dependency state changes, the control plane should be able to:

- release the blocked item automatically
- enqueue the appropriate next workflow
- notify the relevant operator or channel

Examples:

- Jira dependency resolved -> blocked workflow run becomes runnable
- prerequisite PR merged -> build run becomes allowed

## UI And Notification Behavior

Operators should be able to see:

- that a ticket is blocked
- which external items block it
- whether the dependency data came from a trusted connector capability
- whether a human override was applied

Communication channels may also notify:

- item received but blocked by dependency
- dependency cleared and triage started

## Data Model Implications

Recommended entities:

- work_item_dependencies
- dependency_snapshots
- dependency_policies
- dependency_overrides

Each tracked item should preserve:

- source dependency identifiers
- dependency direction
- dependency status
- last checked time
- trusted or untrusted source flag

If a blocked item later becomes runnable, the release action should record:

- release source
  - webhook
  - polling refresh
  - manual override
- released at
- resulting `workflowRunId` if a new run was created

## Initial Recommendation

Start with:

- dependency-aware intake for platforms that clearly expose it
- blocked-state persistence in the control plane
- operator override support
- automatic release when dependency state becomes satisfied

Do not let workers decide this on their own. The scheduler should enforce it.
