# Build Workflow

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). In this document, a `worker` executes a job, while a `gateway` routes or spawns workers.

Canonical contract reference: [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md)

## Purpose

Support Agent needs a post-triage `build` workflow.

Triage identifies the problem.
The build workflow attempts to fix it and produce a PR candidate.

These should be separate stages.

## Core Flow

Recommended lifecycle:

1. issue is ingested
2. a source workflow run completes or produces the findings needed for build
3. findings are stored
4. operator chooses whether to request a fix
5. a build job is created
6. build worker edits code in the correct repository
7. internal review runs
8. PR is opened through a supported outbound connector when policy allows it

## Manual PR Trigger

After triage completes, an operator should be able to trigger a PR manually.

Supported triggers should include:

- button in the dashboard
- tag or label change on a supported connector
- connector-specific action if the platform supports it
- communication-channel request from Slack, Teams, or WhatsApp when policy allows it
- connector trigger policy configured in the admin panel or MCP

Examples:

- click `Create PR` on a workflow run detail page
- add a label such as `ai-fix` on a GitHub issue
- add a triage follow-up label in Linear or Jira when supported
- ask the Support Agent bot in Slack or Teams to create a PR for a specific run when the conversation is paired and the user has permission
- receive a Slack notification that a reproduced Linear support ticket is ready, then ask the bot to create a PR

## Auto-PR Mode

Projects should be able to enable `auto-pr` mode.

In auto-pr mode:

- once triage completes successfully
- and routing/configuration rules allow build
- a PR job starts automatically without a separate manual trigger

This mode exists for flows such as critical production incidents where the human should wake up to a patch candidate instead of starting the investigation from zero.

Auto-PR mode should be configurable at least by:

- connector instance
- repository mapping
- project
- issue severity or confidence thresholds
- trigger policy

## Connector Responsibility

PR creation should generally be treated as an outbound capability.

Reason:

- the PR is created against the code host or issue/PR host
- not every inbound platform can create PRs
- the same triage source may route to different PR destinations

Examples:

- Sentry inbound -> GitHub outbound for PR creation
- Linear inbound -> GitHub outbound for PR creation
- GitHub Issues inbound -> GitHub outbound for PR creation

If a platform supports issue intake but not PR creation, it should still be able to trigger build by routing to a different outbound connector.

Default ownership should be:

- worker or gateway runtime prepares the branch and validation artifacts
- API plus outbound connector opens or updates the external PR

## PR Destination Support

The system should distinguish:

- outbound issue creation
- outbound comment
- outbound PR creation
- outbound review status updates

Not every connector supports all of these.

Examples:

- GitHub supports issues, PRs, comments, reviews, labels
- GitLab would support similar capabilities when added
- Linear supports issues and comments, but not Git-style PR hosting itself
- Jira supports issues and comments, not repository-native PR hosting

## Internal Code Review

Before opening or finalizing a PR, Support Agent should support internal review.

Recommended review stages:

- patch generation
- automated validation
- internal AI review
- optional human approval requirement
- PR creation

Internal review should focus on:

- correctness
- scope control
- regression risk
- test coverage
- security-sensitive changes

Internal review should also support multi-round loops such as:

- first-pass critique
- revision request
- second-pass validation
- final approval recommendation

Reference: [review-loops.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/review-loops.md)

## PR Job

A build job is a separate execution type from triage.

It should include:

- target repository
- target base branch
- findings reference
- fix strategy or constraints
- PR destination connector
- review policy
- branch naming policy
- review profile identifier

Canonical run identity should be `workflowRunId`, not a triage-only identifier.

## Review Policies

Projects should support review settings such as:

- `manual-approval-required`
- `auto-open-pr-after-review`
- `auto-open-pr-with-draft`
- `review-only-no-pr`

These settings should control whether the system:

- only proposes a patch
- opens a draft PR
- opens a ready-for-review PR
- waits for human confirmation after internal review

## Dashboard Requirements

The dashboard should show:

- whether a workflow run is PR-eligible
- whether auto-PR is enabled
- PR job status
- internal review status
- resulting branch and PR link

The workflow run detail page should expose:

- `Create PR` action when available
- `Auto-PR` state
- review results
- PR history linked to the run

## MCP / Configuration Requirements

The config model should support:

- outbound PR capability discovery
- manual PR trigger policy
- auto-PR enablement
- review policy
- review profile selection
- label or tag mappings that trigger PR creation where supported
- communication-channel action policies for PR requests
- per-connector PR trigger policies with intent such as `fix` or `feature`

## Initial Recommendation

Start with:

- manual PR trigger from the dashboard
- optional label/tag-based trigger for connectors that support it
- GitHub outbound PR creation as the first concrete implementation
- internal AI review before PR creation
- optional auto-PR mode behind explicit per-project settings

Do not merge triage and PR generation into one job type. Keep them separate and linked.

## Merge Relationship

This document covers `build`, not `merge`.

`Build` produces a candidate branch and PR.
`Merge` is the later workflow that rebases, fixes merge fallout, reruns validation and review, and lands the change when policy allows it.
