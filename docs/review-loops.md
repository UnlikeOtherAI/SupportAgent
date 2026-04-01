# Review Loops

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). Review loops are part of the control-plane workflow. `Workers` and `gateways` execute the rounds, but the review policy and prompts should remain centrally managed by Support Agent.

Review process reference: [review-process.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/review-process.md)
Canonical contract reference: [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md)

## Purpose

Support Agent should support multi-round review loops inside any top-level workflow type:

- `triage`
- `build`
- `merge`

The point is straightforward:

- one review pass is often not enough
- useful LLM output usually comes from critique and revision loops
- this should be a product capability, not a customer-side hack

## Core Rule

Review loops should be controlled by the Support Agent control plane, not baked permanently into customer infrastructure.

Review is a cross-cutting stage, not a fourth top-level workflow type.

That means:

- the runtime executes review rounds against local code in the customer environment
- the control plane decides which review profile, prompt set, and loop policy to apply
- prompt and policy changes should not require a customer redeploy

## Managed Review Profiles

Support Agent should define versioned review profiles.

A review profile should describe:

- review goal
  - patch quality review
  - regression review
  - security review
  - spec-conformance review
  - release-readiness review
- number of rounds allowed
- pass or fail thresholds
- whether a second model or second prompt family should critique the first result
- required artifacts
- output schema

Examples:

- `default-pr-review-v1`
- `hotfix-review-v1`
- `spec-conformance-v2`
- `security-focused-review-v1`

## Prompt Control Model

Prompts should be owned by Support Agent and referenced by stable identifiers, not copied into customer images.

Recommended model:

- the job payload includes a `reviewProfileId`
- the runtime fetches the current signed review manifest from Support Agent
- the manifest references the prompt templates, round order, and output contract
- the runtime executes that manifest locally against customer code

This lets us improve review quality centrally without asking the customer to rebuild or redeploy their worker or gateway.

## Review Loop Policy

The default review loop should follow [review-process.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/review-process.md):

- collect findings across all severities
- fix every accepted finding
- re-run the review
- keep looping until no accepted findings remain

This should be the standard Support Agent behavior unless a workflow profile explicitly sets a different stopping threshold.

## Review Loop Shape

A review loop should support stages such as:

1. initial patch or PR review
2. structured critique
3. revision pass
4. validation pass
5. final approval recommendation

Not every profile needs every stage, but the structure should exist.

Examples:

- `triage` may run review to challenge a root-cause hypothesis or reproduction result
- `build` may run review to critique and revise a proposed patch before opening a PR
- `merge` may run review after rebase or conflict resolution before the final merge action

## Separation Of Concerns

Keep these responsibilities separate:

- customer runtime
  - executes commands, builds code, runs tests, and applies the review manifest locally
- Support Agent control plane
  - chooses the review profile, stores prompt sets, versions policies, and evaluates outputs against workflow rules

The customer runtime should not become the long-term owner of review logic.

## Why This Matters

This is the product moat.

If review quality is locked into customer-side infrastructure, then:

- every improvement requires customer rollout work
- prompt iteration becomes slow
- comparison across customers becomes weak
- the product becomes harder to improve from the control plane

If review quality is managed centrally, then:

- we can improve prompts and loop structure across all customers
- we can ship better review behavior without changing their runtime package
- we retain control over the review methodology while respecting the code trust boundary

## Runtime Contract Implications

The runtime should be able to:

- receive a `reviewProfileId`
- fetch the review manifest from Support Agent
- execute multiple rounds locally
- return round-by-round outputs and final structured findings

The runtime should not require embedded prompt text to perform standard review jobs.

## Data Model Implications

Recommended entities:

- review_profiles
- review_profile_versions
- review_prompt_sets
- review_round_outputs
- review_policies
- review_evaluations
- workflow_run_reviews

The control plane should preserve:

- which review profile was used
- which version was used
- round-by-round outputs
- final decision state
- operator overrides

## Operator Controls

Operators should be able to configure:

- which review profile a project uses
- whether review loops are mandatory
- max review rounds
- whether build may continue automatically after passing review
- whether human approval is required after the loop

Review profile precedence should follow [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md):

1. workflow-run explicit override
2. workflow-scenario default
3. repository mapping default
4. project or tenant default

## Initial Recommendation

Start with:

- one default multi-round PR review profile
- one hotfix-oriented profile for incident work
- one spec-conformance profile for customer-reported issues

Keep prompt ownership and loop policy in the control plane from day one.
