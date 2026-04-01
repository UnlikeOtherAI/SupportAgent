# Review Process

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). This document defines how Support Agent should run documentation and code review loops.

## Purpose

Support Agent should use an explicit review loop rather than one-pass review.

The useful rule is:

- collect all issues except noise
- fix every accepted issue
- re-run
- repeat until no accepted issues remain

This rule is the default for documentation and code review loops.
Runtime workflow review loops use the same severity handling but must also obey explicit stop and escalation limits.

## Canonical Severity Policy

- `critical`
  - implementation would likely build the wrong system
- `high`
  - major ambiguity, missing ownership, or conflicting contract likely to fork implementation
- `medium`
  - meaningful gap or inconsistency worth fixing before relying on the docs or code
- `low`
  - cleanup, wording, polish, or low-risk completeness gaps

## Review Loop

The default review loop should be:

1. run aggressive review and ask for `critical`, `high`, `medium`, and `low`
2. ignore obvious hallucinations or duplicate findings
3. fix all accepted findings that hold up
4. re-run the review
5. repeat until reviewers return no accepted findings

Do not ask reviewers for only `critical` and `high` at the start. That causes over-pruning and hides useful `medium` and `low` issues.

## Runtime Workflow Stop Rule

For live `triage`, `build`, and `merge` workflows, the platform must not loop forever.

Review profiles should define at least:

- `maxRounds`
- `maxRuntimeMinutes`
- `stopSeverityThreshold`
- `escalateToHumanWhenExhausted`

Canonical runtime rule:

1. run review rounds until findings are below the configured threshold
2. stop immediately when the workflow satisfies the threshold
3. if `maxRounds` or `maxRuntimeMinutes` is reached first, transition the run to `awaiting_human`
4. record the last accepted and rejected findings in the final report

The docs-review rule is "keep going until no accepted findings remain".
The runtime-workflow rule is "keep going until the review profile threshold is met or the profile forces escalation".

## Reviewer Set

For now, the preferred reviewer set is:

- Codex
- Claude

Gemini may be used experimentally, but if it hallucinates aggressively it should not block the review loop.

## Evaluation Rule

Every review round should separate:

- raw reviewer output
- accepted findings
- rejected findings

Reasons to reject a finding:

- hallucinated file content
- stale or already-fixed complaint
- duplicate of a stronger accepted finding
- valid observation but genuinely not worth accepting

## Re-Run Rule

Any time accepted findings cause doc or code changes, re-run the reviewers.

The loop is not complete until:

- accepted findings are exhausted
- a fresh review pass confirms no accepted findings remain

## Product Rule

This review loop should also be the default internal review policy for Support Agent workflows where repeated critique is useful.

That means the system should be able to:

- collect review findings in rounds
- separate accepted from rejected findings
- re-run after changes
- stop only when the configured severity threshold is satisfied

For docs and code review work, the practical stopping rule should be:

- keep looping until no accepted findings remain

For runtime workflows, bounded stop rules still come from the review profile and may legitimately end with low-severity residual findings if policy allows that.
