# Use Cases

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). These examples describe product flows, not new runtime roles.

## Friday Night POS Incident

This is the core high-urgency example the product should optimize for.

Scenario:

- a large venue operator runs a React-based POS system
- the app starts crashing every 30 minutes during live trading
- crash reports arrive from Firebase Crashlytics, Sentry, or a similar source
- the operator or support owner receives an alert on business WhatsApp

Desired flow:

1. the first crash report arrives through an inbound connector
2. Support Agent creates a workflow run immediately
3. a notification is sent to the configured WhatsApp conversation
4. triage starts on a customer-owned runtime without waiting for a human to log in
5. the system identifies the likely root cause and writes structured findings
6. if the project policy allows it, a build run starts automatically
7. a PR is created before the operator opens the laptop
8. the operator wakes up, opens the dashboard or linked PR, validates the fix, and merges it
9. the normal customer deployment path runs
10. the client refreshes the app and service is restored

## Product Requirements Implied By This Scenario

This scenario means the platform must support:

- high-priority incident routing
- immediate chat notification for critical inbound issues
- automatic triage start on incident-class events
- optional `auto-pr` mode for selected projects
- clear PR destination routing
- fast visibility into logs, findings, and generated patch
- minimal manual work before validation and merge

## Operator Experience

The operator experience should be:

- phone alert first
- investigation already in progress by the time they reach a laptop
- findings ready or nearly ready when they open the dashboard
- PR already open when policy allows it
- human task reduced to validation, merge, and deploy

## Guardrails

This use case does not mean all incidents should auto-open PRs.

The platform still needs:

- project-level `auto-pr` settings
- review policy controls
- runtime capability checks
- outbound connector support for PR creation
- auditability for all automated actions

## Reference

This scenario should shape:

- [brief.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/brief.md)
- [communication-channels.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/communication-channels.md)
- [pr-workflow.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/pr-workflow.md)
- [dashboard.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/dashboard.md)

## Support Ticket Reproduction Flow

This is the core non-crash support scenario the product should also optimize for.

Scenario:

- a client calls about an accounting system that the team built
- support tries to resolve the issue live with the client
- support can no longer solve it confidently
- support writes a ticket in Linear
- the Linear ticket is ingested automatically

Desired flow:

1. the Linear issue arrives through an inbound connector
2. Support Agent creates a workflow run automatically
3. the mapped runtime spins the environment needed for that repository
4. the worker uses Playwright and any project-specific tooling to reproduce the issue
5. Support Agent stores the findings and reproduction evidence
6. a Slack notification is sent to the responsible developer or team channel
7. the developer reviews the findings and asks the bot or dashboard to create a PR
8. a build run starts and produces a PR for review

## Product Requirements Implied By This Scenario

This scenario means the platform must support:

- issue-tracker-first intake, not just crash-system intake
- automatic triage on inbound support tickets
- reproduction-oriented execution profiles
- environment bootstrapping for application-level testing
- Slack notifications aimed at developers rather than only support owners
- manual PR request after triage, using either the dashboard or chat control surface

## Operator Experience

The expected experience here is:

- support does not need to become the reproducer of last resort
- triage already contains environment-aware investigation when the developer sees it
- developer decision starts at `is this finding actionable enough to fix` rather than `how do I reproduce this`
- the PR request can be made directly from Slack or the dashboard

## Guardrails

This use case should usually default to manual PR request rather than immediate `auto-pr`.

Reason:

- support tickets are often less deterministic than crash reports
- reproduction may be partial
- developer confirmation is often the right gate before build begins

## Weekend Feature Delivery Cycle

This is the long-running product-delivery scenario the platform should also support.

Scenario:

- a project manager needs a feature in an existing app
- they prepare strong Jira tickets with acceptance criteria
- they attach design images
- they define dependencies between tickets
- they tag the epic and tickets as `AI ready`

Desired flow:

1. the `AI ready` epic is ingested from Jira
2. Support Agent reads the epic, child tickets, dependencies, and design assets
3. the control plane validates the dependency graph and adjusts it when policy allows
4. the system starts a multi-day feature build cycle
5. runnable tickets are picked one by one or in parallel when dependencies allow it
6. workers implement and review the work across the relevant repo areas
7. the resulting feature is assembled on a branch with a detailed PR
8. a configured distribution target such as TestFlight or a preview environment is produced for review
9. on Monday morning the PM sees a working feature build and the full engineering trail

## Product Requirements Implied By This Scenario

This scenario means the platform must support:

- epic or parent-child work-item intake
- dependency-graph validation
- optional dependency correction when the connector supports edits
- parallel execution of independent tickets
- design-asset ingestion
- long-running feature orchestration across several tickets
- detailed PR generation for the complete feature
- preview or app-distribution delivery targets

## Operator Experience

The expected experience here is:

- PM prepares the work clearly rather than micromanaging execution
- the platform decides what can run now versus later
- the system can use the full weekend, not one short incident window
- by Monday the work is reviewable as a feature, not just as disconnected ticket notes

## Guardrails

This use case should be explicitly opt-in and heavily policy-driven.

Reason:

- feature work is broader and riskier than a single bug fix
- dependency edits should only happen when connector capability and customer policy allow it
- preview delivery should only happen when the required distribution connector is configured
