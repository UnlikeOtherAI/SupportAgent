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

### Remote execution boundary

Skills and executors slot into the **local orchestrator** layer that already lives inside the runtime CLI — see [local-orchestrator.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/local-orchestrator.md), [runtime-cli.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/runtime-cli.md), and [llm/index.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/llm/index.md). Nothing here changes that boundary; this plan is what the local orchestrator actually executes once a job arrives.

Concretely:

- **Control plane** (this repo) owns: skill + executor records, scenario binding, trigger ingest via connectors, dispatch, output normalization, delivery.
- **Runtime CLI** (separate package, customer-installed) owns: WebSocket session, fetching the executor YAML + referenced skill bodies for each dispatch, spawning subprocesses or `inline_llm` calls in the customer environment, streaming logs, posting the final `{body, labels?, state_change?, pr?}` payload back over HTTP.
- **Trust boundary** is preserved exactly as [trust-model.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/trust-model.md) describes: source code never leaves the runtime; only the structured output contract crosses back.

Practical consequences for this plan:

- The runner described in _Runtime composition_ below is the local orchestrator implementation. When the worker is in-process (single-VM hosted SaaS install), the same code runs in-process; when the worker is a remote CLI, the same code runs there. The control plane sees one contract either way.
- `inline_llm` stages (Pattern 3) execute against whichever model-access mode the runtime is configured for: `proxy` calls back through the control plane's proxy path; `tenant-provider` uses customer-managed credentials kept on the runtime host. The skill author writes neither; the runtime resolves it. See [llm/api-key-management.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/llm/api-key-management.md).
- CLI subprocess credentials (e.g. `claude` or `codex` provider keys) live entirely on the customer host. The runtime injects them into the spawn environment; the control plane never sees them.
- Output visibility tiers (`full` / `redacted` / `metadata_only`) from [trust-model.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/trust-model.md) apply to the streamed logs and to the `body` field. A skill that wants to include a code excerpt in `body` will have that excerpt redacted on egress when policy demands it; the skill is unaware.

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

## Guardrails

All guardrails are configured in the executor YAML alongside the pipeline they protect. None live in code. The runner enforces them; failed guardrails terminate the run and leave a `blocked_reason` in the run record (see [automation-composition.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/automation-composition.md) output types).

```yaml
guardrails:
  no_self_retrigger: true                # default true; see below
  fan_out_min_success_rate: 0.6          # require ≥60% of parallel spawns succeed
  consolidator_max_retries: 2            # retry the consolidator on parse/exec failure
  loop_safety:
    min_iteration_change: false          # if true, abort when an iteration produces output identical to the previous one
```

### No self-retrigger

When `true` (default), trigger matching ignores any incoming event whose actor matches the connector's own bot identity. This is the loop-prevention surface called out in [automation-composition.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/automation-composition.md): the connector's outbound markers and the bot's GitHub login are both checked. Skill authors never need to think about it. Operators can set `false` only on executors that intentionally consume their own output (rare; reviewed manually).

### Fan-out success-rate threshold

For stages with N parallel spawns where N > 1, `fan_out_min_success_rate` (0.0–1.0) is the floor. If fewer than `ceil(N * threshold)` spawns produce a valid output JSON, the stage fails and the consolidator is not invoked. Default omitted = 1.0 (every spawn must succeed). Set lower for "best-of-many" patterns where flaky CLIs are tolerable.

### Consolidator retry

`consolidator_max_retries` applies only to the final consolidator stage. Retries cover three failure modes: subprocess non-zero exit, missing/invalid output JSON, and explicit `inline_llm` API errors (timeout / rate limit). Default `0`. Worker stages do not retry — fan-out absorbs their flakiness via `fan_out_min_success_rate`.

### Loop safety

Beyond `loop.max_iterations`, `loop_safety.min_iteration_change: true` aborts the loop when iteration N's leaf-stage output is byte-identical to iteration N-1's. Cheap insurance against the model emitting `done: false` while making no actual progress — a real failure mode under context exhaustion. Default `false`.

## Trigger allowlist

Each scenario can constrain who is allowed to fire it. Stored on the scenario (not the executor — same executor may be invoked by multiple scenarios with different audiences):

```yaml
# scenario yaml fragment
trigger_allowlist:
  github:
    users: ["rafiki270", "ondrej-rafaj"]   # logins
    teams: ["@ourorg/maintainers"]          # team handles, optional
  default: deny                             # deny | allow (default: allow)
```

Resolution order on an inbound event:

1. If `trigger_allowlist` is absent on the scenario → allow (current behaviour preserved).
2. If the actor matches any explicit `users` or `teams` entry → allow.
3. Otherwise apply `default` (allow or deny).

This is intentionally **not** a permissions system — there are no roles, no per-action grants, no admin gating. Anyone with admin access already configures everything; the allowlist exists only to keep stranger commenters from triggering automated actions on a public repo. Aligns with the user-stated principle: "whoever has access to the repo should be able to do that — we'd be overcomplicating with permissions at this stage."

## Progress comment lifecycle

When a scenario triggered from a comment ("@sa-bot review again, focus on auth") starts, the connector posts an immediate placeholder before the run begins, and replaces it with the final result on completion.

State machine on the connector side, keyed by `(scenarioExecutionId, deliveryTarget)`:

| Phase | Action |
|---|---|
| **Started** | Post `> SupportAgent is working on this — started <ts>. I'll update this comment when done.` Save the resulting comment id on the `action_delivery_attempt` row as `placeholderRef`. |
| **Running** | Edit the placeholder comment in place at most once every 30s with the latest progress line (`> …running stage 'workers' (3/5 spawns done)`). |
| **Done** | Edit the placeholder one last time, replacing its full body with the final `{body}` payload. The comment id is preserved so the GitHub thread stays anchored. |
| **Edit unsupported** | If the source connector cannot edit (rare; e.g. Linear comment edits restricted by permission), delete the placeholder and post a fresh comment with the final body. Audit records both ids. |

The same lifecycle applies to GitHub Projects status updates (the connector edits the project item's status field rather than posting a comment).

The skill author is unaware of any of this — the lifecycle lives entirely on the connector. The skill produces one final output; the connector chooses whether that output replaces a placeholder or is posted fresh.

## Cancel & stop

Every active run gets a cancel control in the admin UI (run detail page → "Stop"). Cancel semantics:

- **In-flight stage** — runner sends SIGTERM to all subprocess spawns in the active stage; aborts pending `inline_llm` calls; marks the workflow run `canceled`.
- **Looping run** — cancel between iterations is also supported and the canceled iteration's partial outputs are recorded but not delivered.
- **Already-delivered output** — cancellation cannot un-post a comment that already went out. The connector posts a follow-up `> SupportAgent run canceled by <user>` comment so the thread isn't left ambiguous.

Cancel is a control-plane operation. For remote runtimes, the control plane sends a `cancel` message over the existing WebSocket session; the runtime CLI is responsible for terminating local subprocesses. See `runtime-cli.md` registration/dispatch contract for the existing message envelope — `cancel` slots in alongside `dispatch` and `heartbeat`.

## Skill versioning & dependencies

### Versioning

Builtin rows (`source: BUILTIN`) follow the file in `packages/skills/builtin/<name>/SKILL.md` — the seed loop overwrites them on every boot when the file hash changes. Operators get the latest builtin behaviour automatically.

User clones (`source: USER`) are never touched by the seed loop. They keep whatever body the operator saved, even if the upstream builtin moves on. The `parentSkillId` link makes it possible to surface "your clone is N edits behind the builtin" in the admin UI as advisory text only — there is no auto-merge.

No semantic version field. Builtins update in place; clones are frozen at the moment of cloning. If an operator needs to track multiple variants, they clone again under a new name.

### Dependencies (between skills)

Claude's skill format does not have a native dependency mechanism; skills are flat files. We mirror that — a skill is one self-contained body with optional sidecar files, no `depends_on:` field.

The "attach multiple skills to one executor" requirement is satisfied entirely at the executor level via `system_skill` (exactly one) and `complementary` (zero or more). The admin UI for editing an executor's skill bindings is a tickbox list filtered by role: one radio for the system skill, multi-select tickboxes for complementary skills.

If a future skill format adds first-class dependencies, the loader can honour them transparently without changing the executor schema.

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

### Phase B — Runner (in-process worker first; identical contract for remote runtime later)

- [ ] B.1 Build the prompt composer: `executor.preamble + system_skill.body + complementary[].body + output contract block + inputs_from rendering + task prompt`.
- [ ] B.2 Build the stage scheduler: spawn parallel groups, await `after:` deps, collect outputs, feed downstream stages. Honour `guardrails.fan_out_min_success_rate` and `guardrails.consolidator_max_retries`.
- [ ] B.3 Build the loop wrapper: iterate stage scheduler until `done: true` or `max_iterations`. Honour `guardrails.loop_safety.min_iteration_change`. Persist iteration state.
- [ ] B.4 Replace the three handlers with one `handleSkillJob(job, api)` that loads the executor by key, runs the pipeline, and returns the final output to the connector for delivery. Code path stays identical when this runs inside the remote runtime CLI later.
- [ ] B.5 Connector delivery: implement the GitHub delivery surface (`body`, `labels`, `state_change`) reading the run's final output.
- [ ] B.6 Implement the progress-comment lifecycle on the GitHub connector (placeholder → in-place edit → final). Throttle edits at 30s.

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
- [ ] D.5 Add a "Stop" control to the run detail page (control-plane cancel; SIGTERM to local subprocess, WebSocket `cancel` for remote runtimes).
- [ ] D.6 Show "your clone is N edits behind builtin" advisory on cloned skill/executor detail pages (advisory only — no merge UI).
- [ ] D.7 Skill picker on the executor edit page: one radio for `system_skill` (filtered to `role=SYSTEM`), checkboxes for `complementary[]` (filtered to `role=COMPLEMENTARY`).
- [ ] D.8 Trigger allowlist editor on the scenario detail page (GitHub user/team list + default allow/deny).
- [ ] D.9 Playwright clickthrough per page (headless), per the admin build loop.

### Phase E — Remote runtime integration

The runtime CLI already exists as a contract (see [runtime-cli.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/runtime-cli.md), [llm/index.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/llm/index.md)). The skills+executors runner is what it executes once a job arrives. This phase wires the two together.

- [ ] E.1 Extend the dispatch contract (`workflowType`, `executionProfile`, etc. — already present per `llm/index.md`) so it carries the resolved `executorKey` and the inlined skill bodies for that run. The runtime should not need to re-fetch every skill from the API per stage.
- [ ] E.2 Implement skill-body fetch fallback: if the dispatch payload omits a referenced skill (e.g. complementary skill added mid-run), the runtime fetches it via `GET /v1/skills/:name` over HTTPS using the runtime API key.
- [ ] E.3 Add a `cancel` message to the existing WebSocket session protocol; runtime CLI terminates active spawns on receipt.
- [ ] E.4 Honour the model-access mode for `inline_llm` stages: `proxy` routes through the control-plane proxy, `tenant-provider` uses runtime-resident credentials. Same field already exists in worker config (`SUPPORT_AGENT_MODEL_ACCESS_MODE`).
- [ ] E.5 Apply output visibility tier (`full` / `redacted` / `metadata_only`) on egress — both to the streamed log chunks and to the final `body` in the output contract.
- [ ] E.6 Document the skills+executors model in `docs/llm/` so customer-side coding agents installing the runtime know what to expect. Most likely a new `docs/llm/skills-and-executors.md`.

Phase E does not block Phase A–D shipping. The in-process worker satisfies hosted-SaaS use cases; remote runtime support layers on top once the contract exists.

## Resolved questions

The following were open in the original draft; user direction in the 2026-04-17 review collapsed them.

1. **Bot identity per connector** — per-connector configurable, ship a single default for v1. Bot identity feeds the no-self-retrigger guardrail and the `Co-Authored-By` trailer on PRs.
2. **Permissions model** — none. No roles, no per-action grants. The trigger allowlist (per scenario, GitHub nicknames) is the only actor gate. Whoever has admin access configures everything.
3. **Concurrency / cost guardrails** — none in the platform. Operator decides what to spawn; the cost lesson is theirs to learn. The platform enforces only the YAML-declared `fan_out_min_success_rate` and `consolidator_max_retries`.
4. **Skill dependency mechanism** — none in the skill format. Composition happens at the executor level via `system_skill` + `complementary[]`. Mirrors Claude's flat skill format.
5. **Skill versioning** — builtins update in place via the seed loop; user clones are frozen at clone time. No version field.
6. **In-flight cancel** — admin UI Stop button per run; SIGTERM to active spawns, abort pending `inline_llm` calls, leave a follow-up "canceled" comment on the source thread.

## Open questions (still)

1. **Markdown rendering location** — the system skill emits structured fields and the connector renders the markdown `body`, or the system skill renders the markdown directly into `body`? Recommend the latter for source-portable rendering, but flag for review.
2. **Loop expression overrides** — `until_done: true` reading the consolidator's `done` flag is the only stop signal. Worth supporting a YAML-level expression (`stop_when: extras.severity_remaining_max in ['none','low']`) for cases where operators don't want to trust the LLM's verdict, or push that policy into the consolidator skill itself? Current recommendation: skill-only for v1.
3. **Schema declaration format** — JSON Schema in a sidecar file (proposed) vs Zod in TypeScript code (today). JSON Schema is editable in the admin UI without a redeploy and is a portable artifact; Zod is more idiomatic in this codebase. Recommend JSON Schema sidecar + runtime-converted-to-Zod via `zod-from-json-schema`.
4. **Per-spawn cost / latency telemetry** — worth recording per-stage per-spawn duration and (where the executor exposes it) token usage? Not required for v1 but useful enough that it should be considered now to avoid schema churn.
5. **`inline_llm` provider list for v1** — start with Anthropic only (we already use it elsewhere), or add OpenAI in the same pass? Recommend Anthropic-only for v1 to keep the platform-side LLM call surface small; add others as concrete need arises.
6. **Progress comment update cadence** — every 30s is a guess. Tighten to 10s for short runs, loosen to 60s for long-running loops, or make it configurable per executor? Current recommendation: hardcode 30s for v1, revisit when telemetry exists.

## Non-goals

- Arbitrary stage DAGs. Two-tier (workers → consolidator) plus loop covers all sketched workflows; chain scenarios for anything more complex.
- Cross-host orchestration. macOS-only stages (e.g. iOS builds) remain a future capability — not blocked by this design but not delivered here.
- Replacing the connector layer. Connectors keep ingest + delivery; this design only changes what happens between.
- A general-purpose expression language for stop conditions. Booleans + `max_iterations` only in v1.
