# Skills & Executors

Date: 2026-04-17
Scope: replace the hardcoded `triage`, `merge`, and `review` handlers with a single skill-driven runner. Operators compose behaviour by editing two file types — **Skills** (Claude-compatible knowledge bundles) and **Executors** (YAML pipelines that say which CLIs to launch, how to fan out, and when to loop). Connectors keep ownership of trigger ingest and result delivery; everything else becomes data.

## Problem

Today, behaviour is split across three TypeScript handlers. Adding a new behaviour (e.g. "deep multi-LLM review with iterative fixes") requires writing a new handler, redeploying the worker, and editing the workflow type enum. The handlers also bake in a single CLI (`max -p`) and a single stage. There is no path for users to attach reusable knowledge bundles, swap CLIs, fan out across providers, or loop until a quality bar is met.

## Concepts

### Skill

A reusable knowledge bundle. **Format is Claude-compatible verbatim**: a folder named after the skill containing `SKILL.md` with YAML frontmatter (`name`, `description`) and a markdown body. Optional sidecar files (e.g. `output.schema.json`) live in the same folder and are referenced by relative path from the body.

Two roles:

- **System skill** — defines what the executor *is*. Exactly one per spawn. "You are a senior code reviewer producing JSON in shape X." "You are the consolidator: read N analyses and produce one verdict." System skills declare the run's contract.
- **Complementary skill** — additive knowledge. Zero or more per spawn, stackable. "Use our design system." "API best practices." "How this codebase is laid out." Complementary skills enrich a system skill without changing its contract.

Adopting Claude's exact format gives us free access to the existing community skill library.

### Executor

A YAML file describing how to launch one or more CLI invocations to satisfy a single workflow run. An executor can be a single CLI, a fan-out across multiple CLIs feeding a consolidator, or a loop wrapped around either of those.

### Scenario

Existing concept, lightly extended. A scenario binds a trigger to an executor + task prompt. "When `github.issue.opened` fires on repo X, run executor `triage-default` with this task prompt." Scenarios pick the executor; executors carry the system + complementary skills.

### Output contract

Every spawn must write a JSON file matching this base shape:

```ts
{
  body: string;                    // required — what the connector posts back
  labels?: string[];               // optional — connector applies if present
  state_change?: 'close' | 'reopen' | 'merge' | 'request_changes' | 'approve';
  pr?: PrSpec;                     // optional — declares a PR to open; see PR mechanics
  done?: boolean;                  // loop control — see Loop semantics
  next_iteration_focus?: string;   // loop control — see Loop semantics
  extras?: Record<string, unknown>; // skill-defined open zone, ignored by connector
}
```

Skills can extend `extras` with their own fields. The connector only acts on the typed fields. `body` is the only field that must be present on the final output that gets delivered.

### Connector delivery

The connector that ingested the trigger also owns delivery. For GitHub:

- `body` → `gh issue comment` or `gh pr comment` (whichever matches the trigger source).
- `labels` → `gh issue edit --add-label` (or PR equivalent).
- `state_change: merge` → `gh pr merge --squash`.
- `state_change: close|reopen` → `gh issue close|reopen`.
- `state_change: request_changes|approve` → `gh pr review`.
- `pr` → branch + commit + push + `gh pr create` (see _PR mechanics_).

Future Slack, Linear, etc. connectors implement the same delivery interface in source-appropriate ways. The skill never knows which source it came from.

### PR mechanics

When a skill needs to open a PR (e.g. an "issue → fix" workflow), it modifies files in its workdir and emits a `pr` block in its output:

```ts
type PrSpec = {
  branch: string;            // branch name to create from the workdir's HEAD
  title: string;
  body: string;              // PR description (markdown)
  base?: string;             // default: repo's default branch
  commit_message?: string;   // default: title
  draft?: boolean;           // default: false
};
```

**Division of labour — agentic for the change, deterministic for GitHub.** Skills are free to edit, add, or delete files inside the workdir however they like. Skills do **not** call `git` or `gh` themselves. The connector handles every git and GitHub mutation:

1. Create `pr.branch` from the workdir's current HEAD.
2. Stage all changes in the workdir (`git add -A`), then commit with `pr.commit_message` (or `pr.title` if absent).
3. Author = the connector's bot identity (configured per connector). When the trigger carries an originating user, append a `Co-Authored-By: <user> <email>` trailer.
4. Push the branch to the origin remote.
5. `gh pr create --title --body --base [--draft]`.
6. Record the PR URL on the workflow run; if the trigger came from an issue, also post a comment on that issue linking to the PR (this is just a follow-up `body` delivery).

**Why deterministic.** Three reasons: (a) the bot identity, signing, and push permissions are install-specific concerns the operator owns — not something every skill author should re-implement; (b) the GitHub mutation surface stays auditable and easy to permission; (c) skills become source-portable — the same "fix this issue" skill targeting Linear or GitLab in the future emits the same `pr` block, and a different connector translates it.

**Inline review comments** (line-level on the diff) are out of scope for v1. When needed, extend the contract with `review_comments?: Array<{file, line, side, body}>` and have the connector translate via `gh api` review submission. The markdown `body` field handles the most common case (one summary comment on the PR thread) without that complexity.

## Skill format

Directory layout, identical to Claude:

```
packages/skills/builtin/
  triage-issue/
    SKILL.md
    output.schema.json     # optional sidecar
  deep-reviewer/
    SKILL.md
  consolidator/
    SKILL.md
  design-system/
    SKILL.md
  api-best-practices/
    SKILL.md
```

`SKILL.md` frontmatter:

```yaml
---
name: triage-issue
description: |
  Use when investigating a newly-opened GitHub issue. Reads the issue,
  greps the codebase, and produces a 9-section triage report ready for
  posting back as a comment.
role: system                   # 'system' | 'complementary'
output_schema: ./output.schema.json   # required for `role: system`
---

# Triage Issue

(markdown body — the prompt itself, written like a Claude skill)
```

`role` is the only field we add on top of Claude's format. Everything else (`name`, `description`, body content, sidecar files) is identical, so skills authored for Claude work here unchanged when given a `role`.

## Executor YAML

The executor describes a pipeline. Three patterns, all expressible in the same shape:

### Pattern 1 — single CLI

```yaml
key: max-default
description: Default single-CLI executor for routine analysis tasks.
default_timeout_ms: 300000
preamble: |
  You are running inside SupportAgent. Cite file:line.
stages:
  - id: main
    parallel:
      - { command: 'max -p "{{prompt}}"', count: 1 }
    system_skill: triage-issue
    complementary: [codebase-architecture, design-system]
```

### Pattern 2 — fan-out + consolidator

```yaml
key: cross-llm-review
default_timeout_ms: 600000
preamble: |
  You are running inside SupportAgent. Cite file:line.
stages:
  - id: workers
    parallel:
      - { command: 'max -p "{{prompt}}"',     count: 5 }
      - { command: 'claude -p "{{prompt}}"',  count: 1 }
      - { command: 'codex exec "{{prompt}}"', count: 1 }
    system_skill: deep-reviewer
    complementary: [api-best-practices]
  - id: consolidator
    after: [workers]
    parallel:
      - { command: 'codex exec "{{prompt}}"', count: 1 }
    system_skill: consolidator
    inputs_from: [workers]
```

### Pattern 3 — two executors in parallel, joined by an in-platform LLM call

The join doesn't have to be a CLI spawn. When the merge step is just "read N JSON outputs and emit one consolidated JSON," a direct LLM API call from the platform is cheaper and faster than launching another subprocess. `inline_llm` skips the executor process entirely and calls the provider's HTTP API directly with the assembled prompt.

```yaml
key: dual-cli-with-platform-join
default_timeout_ms: 600000
stages:
  - id: reviewers
    parallel:
      - { executor: 'codex-deep-review', count: 1 }
      - { executor: 'claude-deep-review', count: 1 }
    # No system_skill / complementary here — each invoked executor brings its own.
  - id: merge
    after: [reviewers]
    parallel:
      - { inline_llm: { provider: 'anthropic', model: 'claude-opus-4-7' }, count: 1 }
    system_skill: output-merger
    inputs_from: [reviewers]
```

Skip the merge stage entirely when each parallel output should reach the source on its own:

```yaml
key: dual-cli-no-join
stages:
  - id: reviewers
    parallel:
      - { executor: 'codex-deep-review', count: 1 }
      - { executor: 'claude-deep-review', count: 1 }
```

With no terminal consolidator, the connector posts **one comment per output** — two parallel reviewers → two distinct PR comments. See _Final delivery_ below for the rule.

### Pattern 4 — looping fan-out + consolidator

```yaml
key: zero-defect-review
default_timeout_ms: 1800000
preamble: |
  You are running inside SupportAgent. Cite file:line.
loop:
  max_iterations: 10
  until_done: true                 # consolidator's `done: true` stops the loop
stages:
  - id: workers
    parallel:
      - { command: 'max -p "{{prompt}}"',     count: 5 }
      - { command: 'claude -p "{{prompt}}"',  count: 1 }
      - { command: 'codex exec "{{prompt}}"', count: 1 }
    system_skill: deep-reviewer
    complementary: [api-best-practices, codebase-architecture]
  - id: consolidator
    after: [workers]
    parallel:
      - { command: 'codex exec "{{prompt}}"', count: 1 }
    system_skill: consolidator-and-fixer
    inputs_from:
      workers: this_iteration
      consolidator: previous_iteration
```

### Field reference

| Field | Where | Meaning |
|---|---|---|
| `key` | top-level | Stable id. Scenarios reference executors by key. |
| `description` | top-level | Free-form, shown in admin UI. |
| `default_timeout_ms` | top-level | Wall-clock budget per spawn. |
| `preamble` | top-level | Text injected before every stage's prompt. Operator-owned (org-wide rules, "cite file:line", custom build notes). |
| `loop.max_iterations` | top-level | Required safety cap. Loop terminates when reached even if `done` not set. |
| `loop.until_done` | top-level | When `true`, loop stops as soon as the final stage's output JSON has `done: true`. |
| `stages[].id` | per stage | Referenced by `after:` and `inputs_from:`. |
| `stages[].parallel[]` | per stage | List of spawn descriptors. Each entry is one of three shapes: `{command, count}` (CLI subprocess), `{executor, count}` (recursively invoke another executor by key), or `{inline_llm: {provider, model, system?}, count}` (direct platform-side LLM API call, no subprocess). All three contribute outputs to this stage; mix freely in one list. `count` is how many copies to spawn. |
| `stages[].after` | per stage | List of upstream stage ids that must finish first. Empty / omitted = stage 0. |
| `stages[].system_skill` | per stage | Required. The role-defining skill loaded into every spawn in this stage. |
| `stages[].complementary` | per stage | Zero or more knowledge skills appended to the prompt. |
| `stages[].inputs_from` | per stage | Which upstream outputs to feed into this stage's `{{prompt}}`. Plain list = current iteration only. Object form (see Pattern 3) selects per-source iteration scope. |

### Constraints

- A stage's `parallel[]` must declare at least one entry.
- Two-tier today: stages form a single chain (`workers → consolidator`). Arbitrary DAG is out of scope; chain anything more complex by linking scenarios.
- Loops require a final stage that emits `done: boolean`; if `until_done: true` and `done` is missing, the run fails fast on the first iteration.
- Loop iteration N's prompt for the workers stage receives the previous iteration's `consolidator.next_iteration_focus` (when set), giving the loop a natural narrative carryover.

### Picking `loop.max_iterations`

`max_iterations` is **not** a safety net we expect to rarely trip — it is a primary control. Even strong models hallucinate and over-correct under iteration: a clean codebase reviewed three times in a row will often grow imaginary issues by the third pass as the model invents work to justify another loop. The cap stops that drift.

Guidance:

| Use case | Recommended `max_iterations` |
|---|---|
| Triage / single-shot analysis (no loop) | n/a — omit `loop:` entirely |
| PR review (find issues, post once) | `1` (single pass; the loop wrapper is overkill — prefer no `loop:`) |
| Iterative fix-and-recheck on small changes | `2` |
| Iterative fix-and-recheck on large changes | `3` |
| Anything higher | requires explicit operator justification in the executor's `description` field |

The admin UI surfaces the cap on the executor detail page and warns when `max_iterations > 3`. The runner records per-iteration outputs so a human can audit whether later iterations actually added value or just churned.

## Runtime composition

For each spawn, the runner builds the full prompt as:

```
{executor.preamble}

{system_skill.body}

{complementary_skill_1.body}
{complementary_skill_2.body}
...

# Output contract
Write valid JSON to: {output_path}
Pre-filled template:
{template (derived from system_skill.output_schema)}
- All required keys must be present.
- Do not write anything else to the file.
- Do not wrap in markdown fences.

# Inputs from prior stages
{inputs_from rendering, if any}

# Task
{scenario.task_prompt or {{prompt}} from upstream stage carryover}
```

It then substitutes the assembled prompt into `command`'s `{{prompt}}` placeholder, spawns, waits for the file, parses + validates against the system skill's schema. The existing `runWithJsonOutput` helper covers the validate-and-parse half; the runner gains a stage scheduler around it.

### Loop iteration shape

Each loop iteration produces:

```ts
{
  iteration: number;
  stages: {
    [stageId: string]: {
      spawn_outputs: ParsedSkillOutput[];   // one per parallel spawn
    };
  };
}
```

Stored on the workflow run so the admin UI can render a convergence timeline (iteration 1: 12 issues → iteration 2: 4 → iteration 3: done).

### Final delivery

The connector delivers **every output produced by a leaf stage** — a leaf stage being one that no downstream stage consumes via `inputs_from`. Concretely:

- **Single-stage executor with one spawn** → one delivery.
- **Single-stage executor with N parallel spawns and no consolidator** → N deliveries (e.g. two reviewer outputs become two separate PR comments).
- **Fan-out + consolidator** → one delivery (the consolidator's output; upstream worker outputs are absorbed and never posted).
- **Looping** → the final iteration's leaf-stage output(s) are delivered; intermediate iterations are recorded but not posted.

Each delivery is a `{body, labels?, state_change?, pr?}` payload (see _Output contract_) translated by the connector into source-appropriate operations. For GitHub: each delivery becomes one comment on the originating issue or PR, plus optional label/state changes, plus an optional PR opened from the workdir.

## Storage model

Skills and executors ship as files in the repo and are mirrored into the database for editing.

```
packages/skills/builtin/<name>/SKILL.md   # built-in skill source of truth
packages/executors/builtin/<key>.yaml      # built-in executor source of truth
```

Prisma:

```prisma
model Skill {
  id              String   @id @default(uuid())
  name            String   @unique
  role            SkillRole
  description     String
  body            String           // full SKILL.md body
  outputSchema    Json?            // parsed output.schema.json, if role=system
  source          SkillSource      // 'builtin' | 'user'
  parentSkillId   String?          // set when a user clones a builtin
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

enum SkillRole   { SYSTEM COMPLEMENTARY }
enum SkillSource { BUILTIN USER }

model Executor {
  id              String   @id @default(uuid())
  key             String   @unique
  description     String
  yaml            String           // full YAML, source of truth for the runner
  parsed          Json             // pre-parsed for admin UI rendering
  source          ExecutorSource
  parentExecutorId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

enum ExecutorSource { BUILTIN USER }
```

On boot, the API upserts every file under `packages/skills/builtin/` and `packages/executors/builtin/` into rows with `source: BUILTIN`. Hash the file contents to detect changes; only overwrite builtin rows. User rows (clones) are never touched by the seed loop.

The admin UI:

- Edits and deletes are allowed only on `source: USER` rows.
- Built-in rows expose a "Duplicate" action that writes a new row with `source: USER` and `parentSkillId`/`parentExecutorId` pointing back.
- The runtime always reads from the database, so admin edits take effect immediately without a redeploy.

## Admin UI

Two new top-level admin pages, each scoped to a single concern (one route slice per page per the build loop).

### `/admin/skills`

- List view: name, role badge (System/Complementary), source badge (Builtin/User), parent (if cloned), last edited.
- Filters: role, source, free-text search over name + description.
- Detail view: monospace editor for the SKILL.md body, frontmatter form, sidecar file editor for `output.schema.json` (system skills only).
- Actions: Duplicate (any), Edit (user only), Delete (user only).

### `/admin/executors`

- List view: key, description, source, last edited.
- Detail view: YAML editor with schema-aware validation against the executor schema, parsed-stage visualisation (boxes for stages, arrows for `after:`, loop indicator if `loop:` present).
- Actions: Duplicate, Edit, Delete (same rules as skills).

Both pages follow the existing CSR React + Tailwind admin shell. Validation errors surface inline; saving runs a roundtrip through the API which re-parses and rejects invalid skills/executors before persisting.

## Scenario binding

Existing `WorkflowScenario` rows gain two fields on the action step:

- `executorKey: string` — picks which executor runs.
- `taskPrompt: string` — the per-trigger instruction. Stored on the action step's `config` JSON.

The Workflow Designer's action node inspector adds an executor dropdown (sourced from the Executors table) and a task-prompt textarea.

## Migration plan

The three existing handlers become three built-in scenarios + skills + executors.

| Today | After |
|---|---|
| `handleTriageJob` | Scenario "GitHub Issue Triage" → executor `triage-default` (single stage, `max -p`) → system skill `triage-issue` (with `output.schema.json` matching today's `TriageOutputSchema`). |
| `handleMergeJob` | Scenario "PR Merge Review" → executor `merge-default` → system skill `merge-reviewer`. |
| `handlePrReviewJob` | Scenario "PR Review On Command" → executor `pr-review-default` → system skill `pr-reviewer`. |

The current 9-section triage rendering (`renderTriageReportMarkdown`) becomes the body of the `triage-issue` system skill — the LLM emits the structured fields, the connector renders markdown for the `body` field. (Open: render in skill or in connector? Recommend skill, so different connectors get the same canonical rendering.)

Once these three scenarios are seeded, the worker's three handlers are deleted and replaced with one `handleSkillJob`.

## Implementation phases

### Phase A — Foundation

- [ ] A.1 Add `Skill` and `Executor` Prisma models + migration.
- [ ] A.2 Build the file → DB seed loop (boot-time upsert, hash-based change detection).
- [ ] A.3 Define the executor YAML JSON schema; build a parser + validator returning typed AST.
- [ ] A.4 Define the skill frontmatter parser; build a loader that turns a `Skill` row into a `LoadedSkill` (frontmatter fields + body + parsed output schema if present).
- [ ] A.5 Extract the base output schema (`OutputContractSchema`) into `packages/contracts`.

### Phase B — Runner

- [ ] B.1 Build the prompt composer: `executor.preamble + system_skill.body + complementary[].body + output contract block + inputs_from rendering + task prompt`.
- [ ] B.2 Build the stage scheduler: spawn parallel groups, await `after:` deps, collect outputs, feed downstream stages.
- [ ] B.3 Build the loop wrapper: iterate stage scheduler until `done: true` or `max_iterations`. Persist iteration state.
- [ ] B.4 Replace the three handlers with one `handleSkillJob(job, api)` that loads the executor by key, runs the pipeline, and returns the final output to the connector for delivery.
- [ ] B.5 Connector delivery: implement the GitHub delivery surface (`body`, `labels`, `state_change`) reading the run's final output.

### Phase C — Built-ins

- [ ] C.1 Author `packages/skills/builtin/triage-issue/` (SKILL.md + output.schema.json mirroring today's `TriageOutputSchema`).
- [ ] C.2 Author `packages/skills/builtin/pr-reviewer/`.
- [ ] C.3 Author `packages/skills/builtin/merge-reviewer/`.
- [ ] C.4 Author `packages/skills/builtin/consolidator/` and `consolidator-and-fixer/` (used by the looping executor).
- [ ] C.5 Author `packages/skills/builtin/deep-reviewer/` (system skill for the cross-LLM worker pattern).
- [ ] C.6 Author one or two complementary skills as proofs (`codebase-architecture`, `api-best-practices`).
- [ ] C.7 Author `packages/executors/builtin/triage-default.yaml`, `merge-default.yaml`, `pr-review-default.yaml`, `cross-llm-review.yaml`, `zero-defect-review.yaml`.
- [ ] C.8 Migrate existing scenarios to point at the new executor keys; delete the three legacy handlers.

### Phase D — Admin UI

- [ ] D.1 Scaffold `/admin/skills` list + detail (CSR React, Tailwind).
- [ ] D.2 Scaffold `/admin/executors` list + detail with YAML editor.
- [ ] D.3 Add executor + task-prompt fields to the Workflow Designer's action node inspector.
- [ ] D.4 Render loop convergence timeline on the workflow run detail page.
- [ ] D.5 Playwright clickthrough per page (headless), per the admin build loop.

## Open questions

1. **Markdown rendering location** — the system skill emits structured fields and the connector renders the markdown `body`, or the system skill renders the markdown directly into `body`? Recommend the latter for source-portable rendering, but flag for review.
2. **Loop expression overrides** — `until_done: true` reading the consolidator's `done` flag is the only stop signal. Worth supporting a YAML-level expression (`stop_when: extras.severity_remaining_max in ['none','low']`) for cases where operators don't want to trust the LLM's verdict, or push that policy into the consolidator skill itself? Current recommendation: skill-only for v1.
3. **Schema declaration format** — JSON Schema in a sidecar file (proposed) vs Zod in TypeScript code (today). JSON Schema is editable in the admin UI without a redeploy and is a portable artifact; Zod is more idiomatic in this codebase. Recommend JSON Schema sidecar + runtime-converted-to-Zod via `zod-from-json-schema`.
4. **Per-spawn cost / latency telemetry** — worth recording per-stage per-spawn duration and (where the executor exposes it) token usage? Not required for v1 but useful enough that it should be considered now to avoid schema churn.
5. **`inline_llm` provider list for v1** — start with Anthropic only (we already use it elsewhere), or add OpenAI in the same pass? Recommend Anthropic-only for v1 to keep the platform-side LLM call surface small; add others as concrete need arises.
6. **Bot identity per connector** — single org-wide bot account, or per-connector configurable? Recommend per-connector for multi-tenant installs but ship a single default account for v1.

## Non-goals

- Arbitrary stage DAGs. Two-tier (workers → consolidator) plus loop covers all sketched workflows; chain scenarios for anything more complex.
- Cross-host orchestration. macOS-only stages (e.g. iOS builds) remain a future capability — not blocked by this design but not delivered here.
- Replacing the connector layer. Connectors keep ingest + delivery; this design only changes what happens between.
- A general-purpose expression language for stop conditions. Booleans + `max_iterations` only in v1.
