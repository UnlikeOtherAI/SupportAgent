# Skills And Executors

Reference architecture: [2026-04-17-skills-and-executors.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/plans/2026-04-17-skills-and-executors.md)

This page is for Claude, Codex, and similar coding agents that help operators author or clone skills and executors.

## Two Files

Support Agent runtime behavior comes from two files:

1. `SKILL.md`
2. `executor.yaml`

`SKILL.md` is Claude-compatible markdown with YAML frontmatter.

```md
---
name: triage-issue
description: Investigate a newly opened issue and return structured findings.
role: system
output_schema: ./output.schema.json
---

# Triage Issue

Read the issue, inspect the repo, and return JSON that matches the schema.
```

`executor.yaml` defines how many stages run, which CLI each stage uses, which skill is the stage system skill, and which complementary skills are appended.

```yaml
version: 1
key: triage-default
display_name: Default triage
preamble: |
  You are running inside Support Agent. Cite file:line.
stages:
  - id: investigate
    parallel: 1
    system_skill: triage-issue
    complementary: [codebase-architecture]
    executor: max
    after: []
    inputs_from: []
    task_prompt: Investigate the reported issue.
loop:
  enabled: false
  max_iterations: 1
  until_done: false
```

## Skill Roles

Every skill is either `SYSTEM` or `COMPLEMENTARY`.

`SYSTEM` means:

- exactly one system skill per stage
- defines the output contract
- leaf system skills must be schema-bound
- system skills are where you describe the main job

`COMPLEMENTARY` means:

- zero or more per stage
- additive context only
- does not change the output contract
- use for codebase notes, style guides, review heuristics, or domain constraints

Use `SYSTEM` for:

- triage findings
- PR review verdicts
- consolidators
- fixers that must emit `SkillRunResult`

Use `COMPLEMENTARY` for:

- architecture notes
- repo conventions
- API best practices
- testing checklists

## `SkillRunResult`

Leaf stages must write a JSON file that matches the `SkillRunResult` envelope.

```ts
type SkillRunResult = {
  delivery: DeliveryOp[];
  findings?: StructuredFindings;
  reportSummary?: string;
  loop?: { done: boolean; next_iteration_focus?: string };
  extras?: Record<string, unknown>;
};
```

What each field means:

- `delivery`: concrete operations the API may deliver through a connector
- `findings`: structured investigation data for Support Agent storage and rendering
- `reportSummary`: short plain-text rollup for run listings
- `loop`: loop control for looping executors
- `extras`: debug or analytics data the connector never inspects

Typical triage output:

```json
{
  "delivery": [],
  "findings": {
    "summary": "Null metadata is not guarded in src/routes/webhook.ts:48",
    "rootCause": "The handler assumes issue.metadata always exists.",
    "severity": "high",
    "confidence": "high"
  },
  "reportSummary": "Missing null guard in webhook handler"
}
```

Typical review output:

```json
{
  "delivery": [
    {
      "kind": "comment",
      "body": "Blocking issue: `handleCancel()` never clears the retry timer.",
      "visibility": "public"
    }
  ],
  "reportSummary": "One blocking review finding"
}
```

## Delivery Ops

`delivery` is a list of connector-facing operations.

```ts
type DeliveryOp =
  | { kind: 'comment'; body: string; visibility?: 'public' | 'internal' }
  | { kind: 'labels'; add?: string[]; remove?: string[]; visibility?: 'public' | 'internal' }
  | { kind: 'state'; change: 'close' | 'reopen' | 'merge' | 'request_changes' | 'approve'; visibility?: 'public' | 'internal' }
  | { kind: 'pr'; spec: PrSpec; visibility?: 'public' | 'internal' };
```

Use `visibility: 'internal'` when:

- the op is useful for audit only
- operators should see it in `action_outputs`
- the source connector must not post it outward

Example:

```json
{
  "delivery": [
    {
      "kind": "comment",
      "body": "internal_diagnostic: reviewer 3 found conflicting evidence in src/foo.ts",
      "visibility": "internal"
    }
  ]
}
```

Support Agent persists that output for audit, marks it as internally suppressed, and does not create a connector delivery attempt.

## Pattern 3 Loop

Pattern 3 is the looping fan-out plus consolidator pattern.

Use it when:

- several reviewers or models should inspect the same problem
- one final stage should merge those outputs
- the final stage can decide whether another iteration is useful

Do not use it when:

- one pass is enough
- the task is already deterministic
- the cost of extra iterations outweighs the benefit
- the leaf stage needs to perform non-comment side effects

Pattern 3 shape:

```yaml
loop:
  enabled: true
  max_iterations: 5
  until_done: true
stages:
  - id: workers
    parallel: 3
    system_skill: deep-reviewer
    complementary: [codebase-architecture]
    executor: max
    after: []
    inputs_from: []
    task_prompt: Review the target and list concrete defects.
  - id: consolidator
    parallel: 1
    system_skill: consolidator-and-fixer
    complementary: []
    executor: codex
    after: [workers]
    inputs_from:
      - stageId: workers
        scope: this_iteration
    task_prompt: Merge findings and decide whether another pass is needed.
```

The loop leaf must require:

```json
{
  "type": "object",
  "properties": {
    "loop": {
      "type": "object",
      "properties": {
        "done": { "type": "boolean" }
      },
      "required": ["done"]
    }
  },
  "required": ["loop"]
}
```

## Multi-Leaf Safety Rule

If an executor has more than one stage, the leaf stage may emit comment delivery only.

That means multi-stage executors must not emit:

- `labels`
- `state`
- `pr`

Why:

- multi-stage flows are usually analytical or review-oriented
- non-comment side effects are too risky when several upstream model outputs feed the leaf
- the validator blocks those combinations before runtime

If you need labels, state changes, or PR creation, use a single-stage executor or split the workflow into separate scenario actions.

## Trigger Allowlist

Scenario trigger policy can restrict which GitHub actors may trigger a run.

The scenario stores that policy under `config.triggerAllowlist`.

Typical shape:

```json
{
  "triggerAllowlist": {
    "mode": "deny_unless_listed",
    "users": ["octocat", "rafiki270"],
    "teams": ["platform", "support-bot-admins"]
  }
}
```

Guidance:

- use allow-all only when the source is trusted
- use deny-unless-listed for comment-driven build or merge actions
- keep team entries explicit when operators want org-level delegation

## Clone A Builtin In Admin

To create a tenant-owned variant:

1. Open the admin Skills or Executors library.
2. Pick a builtin record.
3. Use the clone action.
4. Save the new key or name as a `USER` source record.
5. Edit the cloned copy, not the builtin.

Builtin records stay immutable reference points.

Use a user clone when:

- the tenant needs a prompt tweak
- the tenant wants different complementary context
- the tenant wants a new executor key bound in a scenario

## Remote Fetch Model

Workers do not read Prisma directly.

For a dispatched skill run, the control plane pins:

- executor key plus content hash
- each referenced skill name plus content hash
- authenticated fetch URLs for those exact hashes

The worker fetches:

- `GET /v1/executors/:key/by-hash/:contentHash`
- `GET /v1/skills/:name/by-hash/:contentHash`

If the hash does not match, the API returns `404`.

This guarantees that:

- a run sees the exact revision it was dispatched with
- admin edits during a run do not mutate the active execution
- retries can reason about the exact executor and skill revisions used

## Authoring Rules

- Keep `SKILL.md` prompts explicit and leaf-focused.
- Put reusable repo or domain knowledge in complementary skills.
- Keep executor YAML small and deterministic.
- Prefer one clear system skill over prompt soup.
- Use internal visibility for diagnostics, not for user-facing results.
- Do not make multi-stage executors perform label, state, or PR side effects.
- Clone builtins before tenant-specific customization.

When in doubt, start with one system skill, one executor stage, and no loop.
