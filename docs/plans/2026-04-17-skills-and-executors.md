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
- **Runtime CLI** (separate package, customer-installed) owns: WebSocket session, fetching the executor YAML + referenced skill bodies for each dispatch, spawning CLI subprocesses in the customer environment, streaming logs, posting the final `SkillRunResult` set back over HTTP.
- **Trust boundary** is preserved exactly as [trust-model.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/trust-model.md) describes: source code never leaves the runtime; only the structured output contract crosses back.

Practical consequences for this plan:

- The runner described in _Runtime composition_ below is the local orchestrator implementation. When the worker is in-process (single-VM hosted SaaS install), the same code runs in-process; when the worker is a remote CLI, the same code runs there. The control plane sees one contract either way.
- CLI subprocess credentials (e.g. `claude` or `codex` provider keys) live entirely on the customer host. The runtime injects them into the spawn environment; the control plane never sees them.
- Output visibility tiers (`full` / `redacted` / `metadata_only`) from [trust-model.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/trust-model.md) apply to the streamed logs and to the `body` field. A skill that wants to include a code excerpt in `body` will have that excerpt redacted on egress when policy demands it; the skill is unaware.

### Output contract

Every spawn writes a JSON file matching the `SkillRunResult` envelope. The envelope cleanly separates **what to deliver** (`delivery[]`), **structured findings** for the API (`findings`), **a human-readable rollup** for the run record (`reportSummary`), and **loop control** (`loop`).

```ts
type SkillRunResult = {
  // Concrete delivery operations the connector enacts on its source.
  // Multiple entries allowed for skills that legitimately produce
  // multiple atomic actions (e.g. summary comment + label change).
  delivery: DeliveryOp[];

  // Structured fields persisted via the findings API. Optional; only
  // skills whose role is to produce findings populate this.
  findings?: StructuredFindings;

  // One-paragraph human summary stored on the workflow run for
  // admin-UI listing pages. Always plain text, no markdown.
  reportSummary?: string;

  // Loop control. Required when this stage is the leaf of a loop.
  loop?: { done: boolean; next_iteration_focus?: string };

  // Skill-defined open zone, never inspected by the connector.
  // Persisted verbatim on the run for debugging / analytics
  // (token counts, retry reasons, model confidence).
  extras?: Record<string, unknown>;
};

type DeliveryOp =
  | { kind: 'comment';  body: string }                                 // post a thread comment
  | { kind: 'labels';   add?: string[]; remove?: string[] }            // mutate labels
  | { kind: 'state';    change: 'close' | 'reopen' | 'merge' | 'request_changes' | 'approve' }
  | { kind: 'pr';       spec: PrSpec };                                // open a PR (see PR mechanics)

// Per-skill schema. The skill's output.schema.json declares the exact shape;
// the API ingestion layer normalises it into the canonical findings record.
type StructuredFindings = {
  summary?: string;
  rootCause?: string;
  reproductionSteps?: string;
  proposedFix?: string;
  affectedAreas?: string[];
  severity?: 'low' | 'medium' | 'high' | 'critical';
  confidence?: 'low' | 'medium' | 'high';
  // Open zone for skill-specific structured data the findings API stores verbatim.
  custom?: Record<string, unknown>;
};
```

Each `DeliveryOp` is independently routable (see _Connector delivery_ below). The connector ignores anything it doesn't recognize. `body` content is plain markdown — no skill-side rendering of source-specific syntax (e.g. GitHub suggestion blocks).

**Comment body source — mutual exclusion rule.** For any single leaf output, exactly one of the following holds:

1. The skill emits one or more `comment` ops with `body` populated → the connector posts those bodies verbatim (after applying its egress redaction tier).
2. The skill emits `findings` and **no** `comment` op → the API injects a synthetic `comment` op whose body is rendered by the **source connector's** findings renderer (a thin per-source markdown templater that reads `findings`). This is the path triage-style skills take so a Slack-routed triage and a GitHub-routed triage produce idiomatic output for each surface without the skill knowing the destination.
3. Both `findings` and a `comment` op present → executor parser rejects the skill's output schema at parse time (`blocked_reason: ambiguous_comment_source`). This keeps the rule statically checkable; skill authors choose one path.

The findings renderer lives next to the connector adapter (`apps/api/src/connectors/{kind}/findings-renderer.ts`), not inside the skill, so adding a new source is one renderer plus the existing connector plumbing.

### Connector delivery

**Delivery is API-owned, not runtime-owned.** The runtime returns the leaf-stage `SkillRunResult` set to the API; the **API persists `action_outputs` and `action_delivery_attempts` rows and invokes the connector adapters** for each `DeliveryOp` (see [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md) delivery-attempt contract and [automation-composition.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/automation-composition.md) action-output model). The runtime never calls `gh` for delivery — its job ends when it posts the leaf outputs. This applies identically to in-process workers (no HTTP hop, but the API service still owns the persistence + adapter call) and remote-runtime workers (the `submitReport` HTTP call carries the `SkillRunResult` set; the API does the rest).

**Source connector ≠ delivery connector.** The connector that ingested the trigger does not necessarily own every output. The API resolves a `deliveryTarget` per `DeliveryOp` based on its `kind`:

| `kind` | Delivery target |
|---|---|
| `comment` | The **source connector** — same thread the trigger came from (issue comment, PR comment, Linear comment, Slack thread). |
| `labels` | The **source connector** when the source supports labels; otherwise dropped with a `delivery_skipped` audit entry. |
| `state` | The **source connector** if the state change applies to the source object; for `merge`, route to the **code-host connector** owning the PR's repository (which may differ when the trigger came from an issue and the PR was opened mid-run). |
| `pr` | Always the **code-host connector** for the workflow run's `targetRepo`, never the source connector. |

For v1 the source and code-host connectors are both GitHub in every shipped scenario, so the routing collapses to one connector — but **multiple GitHub connector instances within one tenant are explicitly supported** (one per GitHub App install or per org). To remove guessing, the dispatch envelope carries `resolvedSourceConnectorInstanceId` and `resolvedCodeHostConnectorInstanceId` resolved from the scenario's repository mapping at run-creation time. If either cannot be resolved (no connector instance maps to `targetRepo`), the run is refused with `blocked_reason: code_host_connector_unresolved` before dispatch. The split is also in place so a Linear-triggered scenario that opens a GitHub PR delivers the comment to Linear and the PR to GitHub. Skills remain source-agnostic — they emit `DeliveryOp[]` and the API resolves targets.

GitHub connector translation:

- `comment` → `gh issue comment` or `gh pr comment` (matched against the source thread).
- `labels` → `gh issue edit --add-label / --remove-label` (or PR equivalent).
- `state.change: merge` → `gh pr merge --squash` against the **code-host** target.
- `state.change: close|reopen` → `gh issue close|reopen` against the source.
- `state.change: request_changes|approve` → `gh pr review` against the source PR.
- `pr` → branch + commit + push + `gh pr create` against the code-host target (see _PR mechanics_).

Future Slack, Linear, etc. connectors implement the same `DeliveryOp` interface. The skill never knows which source it came from.

**Op ordering and produced values.** Within a single leaf output, `delivery[]` is executed in declaration order. The `pr` op produces a `prUrl` value once it completes; later ops in the same `delivery[]` may reference it via the `${prev.prUrl}` placeholder in their `body` field. The API substitutes placeholders before invoking the adapter. This is the only inter-op data flow defined; no other op produces values for the v1 surface. If an op fails, later ops in the same `delivery[]` are skipped and recorded as `delivery_skipped: prior_op_failed`.

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
3. Author = the connector's bot identity (configured per connector). Append a `Co-Authored-By: <login> <email>` trailer **only** when the trigger carries an originating user **and** that user is not the bot identity itself. Otherwise omit the trailer (no self-attribution on schedule triggers, label triggers, or bot-replied threads). For GitHub, `<email>` is the noreply form `{numeric-id}+{login}@users.noreply.github.com` derived from the verified `AutomationEvent.actor` fields — never the user's primary email, never a guess. If the actor lacks a numeric id (non-GitHub source without a stable id surface), omit the trailer.
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

When a fan-out stage has no consolidator, the connector posts **one comment per output** — N parallel reviewers → N distinct comments. See _Final delivery_ below for the multi-leaf rule.

### Pattern 3 — looping fan-out + consolidator

```yaml
key: zero-defect-review
default_timeout_ms: 1800000
preamble: |
  You are running inside SupportAgent. Cite file:line.
loop:
  max_iterations: 10
  until_done: true                 # consolidator's `loop.done: true` stops the loop
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
| `stages[].parallel[]` | per stage | List of spawn descriptors. Each entry is `{command, count}` — `command` is the CLI string (`{{prompt}}` substituted at spawn), `count` is how many copies to spawn concurrently. Multiple entries in one list mix providers (e.g. `max -p` × 5 plus `claude -p` × 1 plus `codex exec` × 1) feeding the same downstream stage. |
| `stages[].after` | per stage | List of upstream stage ids that must finish first. Empty / omitted = stage 0. |
| `stages[].system_skill` | per stage | Required. Defines the JSON output contract for every spawn in the stage. |
| `stages[].complementary` | per stage | Zero or more knowledge skills appended to the prompt. |
| `stages[].inputs_from` | per stage | Which upstream outputs to feed into this stage's `{{prompt}}`. Plain list = current iteration only. Object form (see the looping pattern below) selects per-source iteration scope (`this_iteration` / `previous_iteration`). |

### Constraints

- A stage's `parallel[]` must declare at least one entry.
- Two-tier today: stages form a single chain (`workers → consolidator`). Arbitrary DAG is out of scope; chain anything more complex by linking scenarios.
- Loops require a final stage whose JSON Schema includes `loop.done` as a **required boolean field**. The runner validates this at executor parse time, not at run time. If `until_done: true` and the leaf stage's schema does not declare `loop.done` as required, the executor is rejected during validation.
- When `until_done: true`, `guardrails.loop_safety.min_iteration_change` defaults to `true` (override to `false` only with explicit operator justification in the executor's `description`). This is a cheap defense against an LLM emitting `done: true` while making no actual progress.
- Loop iteration N's prompt for the workers stage receives the previous iteration's `consolidator.loop.next_iteration_focus` (when set), giving the loop a natural narrative carryover.

### `inputs_from` rendering grammar

Every stage that consumes upstream outputs runs the same deterministic algorithm:

1. **Resolve scope per source.** Plain list form (`inputs_from: [workers]`) is shorthand for `{workers: this_iteration}`. Object form (`{workers: this_iteration, consolidator: previous_iteration}`) selects per-source.
2. **`this_iteration`** returns the outputs of the named stage produced in the current loop iteration. In iteration 1 of any loop, `this_iteration` is the only valid scope (there is no prior iteration). `previous_iteration` in iteration 1 returns an empty list — never an error.
3. **`previous_iteration`** returns the **complete** outputs of every stage that ran in iteration N-1 from the named stage forward. So `consolidator: previous_iteration` returns iteration N-1's `consolidator.spawn_outputs`, **not** iteration N-1's worker outputs (those are referenced separately as `workers: previous_iteration` if needed).
4. **Rendering order in `{{prompt}}`:** sources are emitted in the order they appear in the `inputs_from` block. Within one source, spawn outputs are concatenated in spawn-index order (the runtime assigns a stable 0..N-1 index per spawn). The runtime does not re-order or deduplicate.
5. **Carryover from loop control.** If iteration N-1's leaf-stage output included `loop.next_iteration_focus`, the runner appends `# Focus for this iteration\n{focus}` after the rendered `inputs_from` block. This is the only implicit injection — everything else must be explicitly named.

The runner records the rendered prompt per spawn for audit so an operator can debug "why did stage X see Y?" without rerunning.

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
      spawn_outputs: SkillRunResult[];      // one per parallel spawn
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

Each delivery is a `SkillRunResult` translated by the connector into source-appropriate operations via its `delivery[]` ops. For GitHub: each `comment` op becomes one comment on the originating issue or PR; `labels`/`state` ops mutate the source object; `pr` ops open a PR from the workdir.

**Multi-leaf safety rule.** When a stage has N > 1 leaf outputs (the no-consolidator case), only `kind: comment` ops are honoured — every other op kind is forbidden, including `labels`. `labels` is excluded because labels are also trigger inputs in this system, so two parallel leaves emitting conflicting `add`/`remove` sets can nondeterministically start or suppress downstream automations. All mutating decisions (`state`, `pr`, `labels`) require a single consolidator that emits exactly one outcome. Enforcement is **two-layer**:

1. **Parse-time best-effort lint.** During executor validation the parser inspects the leaf stage's skill `output.schema.json` and rejects the executor (`blocked_reason: multi_leaf_op_kind_forbidden`) when the schema demonstrably permits any non-`comment` op. Permissive constructs (`oneOf`, `$ref`, free-form `enum`) may slip past this static check — the lint is a safety net, not a proof.
2. **Runtime backstop.** When the scheduler finalizes a leaf stage with effective multiplicity > 1, it walks each `SkillRunResult.delivery[]` and **rejects the entire stage output** if any op is not `comment` (`blocked_reason: multi_leaf_op_kind_forbidden_runtime`). This guards against schemas the static lint accepted but a model chose to populate with a forbidden op.

Without this rule, two parallel reviewers could both decide "approve" and "request_changes" for the same PR with non-deterministic ordering, or two leaves could disagree on which labels apply.

### Fan-out failure cascade

When a stage's `fan_out_min_success_rate` is not met:

1. All in-flight spawns in that stage receive SIGTERM.
2. The stage produces no outputs (succeeded spawns are recorded for audit but discarded as inputs).
3. Downstream stages with `after:` on this stage do not run.
4. **In a non-loop executor:** the run terminates with `status=failed` and `blocked_reason=fan_out_below_threshold`.
5. **In a loop:** if at least one prior iteration produced `loop.done: true`, that iteration's leaf-stage outputs are delivered as the final result and the run is marked `succeeded`. Otherwise the most recent iteration whose leaf stage completed cleanly is delivered (advisory `degraded_after: iteration N` recorded). If iteration 1 fails the rate, no delivery happens and the run is `failed`.

`done: true` from any prior iteration sticks for the duration of the run; a later iteration cannot retract it. This matches operator intent: once the consolidator agreed the work was done, subsequent flakiness should not invalidate that judgement.

## Guardrails

All guardrails are configured in the executor YAML alongside the pipeline they protect. None live in code. The runner enforces them; failed guardrails terminate the run and leave a `blocked_reason` in the run record (see [automation-composition.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/automation-composition.md) output types).

```yaml
guardrails:
  no_self_retrigger: true                # default true; see below
  fan_out_min_success_rate: 0.6          # require ≥60% of parallel spawns succeed
  consolidator_max_retries: 2            # retry the consolidator on parse/exec failure
  loop_safety:
    min_iteration_change: true           # when until_done: true, defaults true. Aborts when iteration N output equals iteration N-1.
```

### No self-retrigger

When `true` (default), trigger matching ignores any incoming event whose actor matches the connector's own bot identity. This is the loop-prevention surface called out in [automation-composition.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/automation-composition.md): the connector's outbound markers and the bot's GitHub login are both checked. Skill authors never need to think about it. Operators can set `false` only on executors that intentionally consume their own output (rare; reviewed manually).

### Fan-out success-rate threshold

For stages with N parallel spawns where N > 1, `fan_out_min_success_rate` (0.0–1.0) is the floor. If fewer than `ceil(N * threshold)` spawns produce a valid output JSON, the stage fails and the consolidator is not invoked. Default omitted = 1.0 (every spawn must succeed). Set lower for "best-of-many" patterns where flaky CLIs are tolerable.

### Consolidator retry

`consolidator_max_retries` applies only to the final consolidator stage. Retries cover two failure modes: subprocess non-zero exit and missing / parse-invalid output JSON. **Schema validation failures** (valid JSON that does not match the system skill's `outputSchema`) are **not** retried — they indicate a skill authoring error, not a flaky run. Default `0`. Worker stages do not retry — fan-out absorbs their flakiness via `fan_out_min_success_rate`.

### Loop safety

Beyond `loop.max_iterations`, `loop_safety.min_iteration_change: true` aborts the loop when iteration N's leaf-stage output is **structurally equal** to iteration N-1's. Cheap insurance against the model emitting `loop.done: false` while making no actual progress — a real failure mode under context exhaustion.

Normalization before comparison strips fields that change every iteration without indicating progress: `reportSummary` (free-text rephrasing), `loop.next_iteration_focus` (carryover hint), and any field a skill marks as volatile in its `output.schema.json` via the `x-loop-volatile: true` annotation. The remainder is canonicalized (sorted keys, normalized whitespace) and SHA-256 hashed; equal hashes between iteration N and N-1 trigger the abort.

Defaults to `true` whenever `until_done: true`; default `false` for fixed-iteration loops.

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

**Actor identity is established once, at the connector edge.** The connector that ingested the trigger is the only authority on "who fired this." It writes a verified `AutomationEvent.actor` field (login + numeric id from the platform's authenticated webhook payload, never from comment body parsing or display name). Allowlist matching reads from that field, never from anywhere else. Spoofing a comment author by editing the body is therefore impossible — the platform-supplied id is what counts.

Resolution order on an inbound event:

1. If `trigger_allowlist` is absent on the scenario → allow (current behaviour preserved).
2. If `AutomationEvent.actor.login` (or the numeric id, for stability across renames) matches any explicit `users` entry → allow.
3. If the actor's resolved team set intersects the scenario's `teams` entry → allow.
4. Otherwise apply `default` (allow or deny).

**Team resolution.** Team handles use the GitHub team slug format (`@org/team-slug`, never display names). When a scenario references a team, the connector calls `gh api orgs/{org}/teams/{team-slug}/members` using the bot identity's authenticated client. Cache policy is **risk-graded**:

- **High-risk scenarios** (any whose executor can produce `state.change: merge|close|approve|request_changes`, a `pr` op, or dispatch a `build` / `merge` workflowType) — resolve membership fresh on every event. No cache. The cost is one API call per gated trigger, well within rate limits even at scale.
- **Comment-only scenarios** — cache membership for 5 minutes keyed by `(org, team-slug)` in the **shared API process cache** (Redis or equivalent — never per-pod), so a horizontally-scaled fleet sees the same answer.

Resolution failures: a 404 (team gone) or 403 (bot lost access) is a hard fail-closed (`blocked_reason: team_resolution_failed`). A transient 5xx or network error serves the cached membership if available and not older than 15 minutes; otherwise fail-closed. The scenario does not silently fall through to `default: deny` on resolution failure.

**v1 scope.** Only the GitHub connector implements `trigger_allowlist`. Other connectors validate the allowlist YAML at scenario save time but reject any non-GitHub `users`/`teams` entries until their connector ships allowlist support. The scenario YAML thereby remains source-typed (no ambiguous mixing of platforms).

This is intentionally **not** a permissions system — there are no roles, no per-action grants, no admin gating. Anyone with admin access already configures everything; the allowlist exists only to keep stranger commenters from triggering automated actions on a public repo. Aligns with the user-stated principle: "whoever has access to the repo should be able to do that — we'd be overcomplicating with permissions at this stage."

## Progress comment lifecycle

When a scenario triggered from a comment ("@sa-bot review again, focus on auth") starts, the connector posts an immediate placeholder before the run begins, and replaces it with the final result on completion.

State machine on the connector side, keyed by the **`actionDeliveryAttemptId`** (one comment per attempt; cancelling and re-running spawns a new attempt with a new placeholder, never reuses a stale one).

| Phase | Action |
|---|---|
| **Started** | Post `> SupportAgent is working on this — started <ts>. I'll update this comment when done.` Save the resulting comment id on the `action_delivery_attempt` row as `placeholderRef`, with `placeholderRefStatus: live`. |
| **Running** | Before each in-place edit (≤ once per 30s), `GET /repos/{owner}/{repo}/issues/comments/{id}` to verify the placeholder still exists. If 404/403/410, mark `placeholderRefStatus: stale`, post a new placeholder with a fresh id, and continue from there (audit event records both ids and the reason). If the verify call itself errors transiently, retry once then post a fresh comment rather than blocking the run. |
| **Done** | Same precheck. If `placeholderRefStatus: live`, edit in place — comment id is preserved so the GitHub thread stays anchored. If `stale`, post a new comment with the final `body` (do not attempt to edit a ghost id). The audit record tracks every comment id the attempt produced. |
| **Edit unsupported** | If the source connector cannot edit (rare; e.g. Linear comment edits restricted by permission), delete the placeholder and post a fresh comment with the final body. Audit records both ids. |

A placeholder going stale is an **audit event, not a delivery failure** — the user gets the final result either way. The run is only marked failed if posting the new placeholder also fails.

**Multi-leaf delivery (N > 1 `comment` ops).** The placeholder is replaced by the first comment via in-place edit; the remaining N-1 comments are posted as fresh comments. The `actionDeliveryAttemptId` records all resulting comment ids. The "Started"/"Running"/"Done" lifecycle still anchors to the first comment; the others have no progress phase and are posted at Done time only.

The same lifecycle applies to GitHub Projects status updates (the connector edits the project item's status field rather than posting a comment).

The skill author is unaware of any of this — the lifecycle lives entirely on the connector. The skill produces one final output; the connector chooses whether that output replaces a placeholder or is posted fresh.

## Cancel & stop

Every active run gets a cancel control in the admin UI (run detail page → "Stop"). Cancel is **two-phase** so the runner gets to make a clean decision instead of being torn down mid-write:

1. **`cancel_requested`** — control plane sets the run to `cancel_requested` and (for remote runtimes) sends a `cancel` message over the WebSocket session. The runner observes this state at two checkpoints: before spawning the next stage, and before starting the next loop iteration. Subprocesses already running are allowed to finish.
2. **`canceled`** — once the runner stops at the next checkpoint (or the user clicks "Force stop"), the run flips to `canceled` and SIGTERM is sent to any subprocess that is still alive. Force-stop is a separate UI action with a clear "may corrupt in-flight delivery" warning.

Output preservation:

- **Completed stages and completed loop iterations are kept.** Their outputs are recorded on the run.
- **The in-flight stage's partial outputs are discarded** even if some spawns succeeded — the consolidator never ran, so there is no consensus to deliver.
- **Loop with prior `loop.done: true`:** if any completed iteration emitted `loop.done: true`, that iteration's leaf output is delivered as the final result (the run is marked `canceled` but with `delivered_iteration: N` recorded). Otherwise no final delivery happens.
- **Already-delivered output** — cancellation cannot un-post a comment that already went out. The connector posts a follow-up `> SupportAgent run canceled by <user>` comment so the thread isn't left ambiguous.

For remote runtimes, the control plane sends `cancel_requested` over the existing WebSocket session; the runtime CLI is responsible for the checkpoint loop and for terminating local subprocesses on force-stop. See `runtime-cli.md` registration/dispatch contract for the existing message envelope — `cancel_requested` and `cancel_force` slot in alongside `dispatch` and `heartbeat`.

**Persistence contract.** The preservation rules above are only meaningful if completed-iteration state is durable across runner restarts. The runner writes a checkpoint to the API (`POST /v1/dispatch-attempts/:id/checkpoints`, see Phase A.8) at two points: after each clean stage completion and after each loop iteration's leaf output is finalized. Each checkpoint carries `{kind: 'iteration' | 'stage', iteration?, stageId?, payload}`. On runner restart (or `lost`-reconciliation), the resume path reads the latest checkpoints for the dispatch attempt, replays only the in-flight stage from scratch, and applies the cancel rules using the persisted state. Delivery is API-owned and does not need a runtime-side cursor; the API drives delivery from the persisted leaf outputs and tracks attempt completion in `action_delivery_attempts`.

**Heartbeat-lost interaction.** A run whose status is `cancel_requested` and whose dispatch heartbeat has expired transitions to `canceled` (not `failed`) via the dispatcher's lost-reconciliation path; `loop.done: true` output preservation rules still apply against the persisted checkpoints.

## Skill versioning & dependencies

### Versioning

Builtin rows (`source: BUILTIN`) follow the file in `packages/skills/builtin/<name>/SKILL.md` — the seed loop overwrites them on every boot when the file hash changes. Operators get the latest builtin behaviour automatically.

User clones (`source: USER`) are never touched by the seed loop. They keep whatever body the operator saved, even if the upstream builtin moves on. The `parentSkillId` link makes it possible to surface "your clone is N edits behind the builtin" in the admin UI as advisory text only — there is no auto-merge.

No semantic version field. Builtins update in place; clones are frozen at the moment of cloning. If an operator needs to track multiple variants, they clone again under a new name.

Revision pinning at dispatch time (below) makes static schema-drift checks unnecessary in v1: a run that started with skill version X executes against skill version X regardless of edits in flight. If a tenant edit produces output that the executor cannot use, the failure is a runtime validation error on that specific run — caught by `runWithJsonOutput`'s schema check — not a class of bug needing parser-level prevention. We can revisit static lint when there are enough tenant-edited skills to make the runtime-only feedback loop painful.

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
  tenantId        String?          // null for builtin rows; set for user clones in multi-tenant installs
  name            String           // unique within (tenantId, source)
  role            SkillRole
  description     String
  body            String           // full SKILL.md body
  outputSchema    Json?            // parsed output.schema.json, if role=system
  contentHash     String           // sha256 of body + outputSchema canonicalized — used as the pinned revision id at dispatch time
  source          SkillSource      // 'builtin' | 'user'
  parentSkillId   String?          // set when a user clones a builtin
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([tenantId, name, source])
}

enum SkillRole   { SYSTEM COMPLEMENTARY }
enum SkillSource { BUILTIN USER }

model Executor {
  id              String   @id @default(uuid())
  tenantId        String?
  key             String           // unique within (tenantId, source)
  description     String
  yaml            String           // full YAML, source of truth for the runner
  parsed          Json             // pre-parsed for admin UI rendering
  contentHash     String           // sha256 of yaml — used as a stable revision id at dispatch time
  source          ExecutorSource
  parentExecutorId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([tenantId, key, source])
}

enum ExecutorSource { BUILTIN USER }
```

On boot, the API upserts every file under `packages/skills/builtin/` and `packages/executors/builtin/` into rows with `source: BUILTIN, tenantId: null`. Hash the file contents to detect changes; only overwrite builtin rows. User rows (clones) are never touched by the seed loop.

**Revision pinning at dispatch time.** When a workflow run is created, the API resolves the executor and all skills the executor references, then **freezes the resolved set** by writing the resolved `(executorId, contentHash)` and the per-skill `(skillId, contentHash)` pairs onto the run record (`workflow_runs.resolvedExecutorRevision`, `workflow_runs.resolvedSkillRevisions: Json`). The runner — local or remote — never reads "the latest" mutable rows; it only loads exactly the rows pinned on the run. An operator editing a skill mid-flight does not affect a run already in flight; the next run picks up the new revision. This makes runs reproducible and removes a class of "but it worked when I clicked Run" bugs.

**Skill name resolution rule.** When the API resolves a skill reference for `(tenantId, name)`, it prefers the tenant's `source: USER` row over the `source: BUILTIN` row. Clones keep the parent's name by default; if the tenant already owns a `USER` row with that name, the duplicate operation fails and the admin UI prompts for rename.

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

The three existing handlers become three built-in scenarios + skills + executors. **`workflowType` keeps its three core values (`triage`, `build`, `merge`)** — only `review` is removed because PR-on-command review is just a triage flow with a different scenario binding, not a top-level type. `triage` / `build` / `merge` continue to drive provider selection, workflow chaining, and admin-UI filtering exactly as today; routing inside the worker switches to `executorKey`.

| Today | After |
|---|---|
| `handleTriageJob` | Scenario "GitHub Issue Triage" → executor `triage-default` (single stage, `max -p`) → system skill `triage-issue` (with `output.schema.json` mirroring today's `TriageOutputSchema`). Dispatch `workflowType=triage`, `workItemKind=issue`. |
| `handleMergeJob` | Scenario "PR Merge Review" → executor `merge-default` → system skill `merge-reviewer`. Dispatch `workflowType=merge`, `workItemKind=review_target` (reuse existing kind — both PR-review and PR-merge target a pull request). |
| `handlePrReviewJob` | Scenario "PR Review On Command" → executor `pr-review-default` → system skill `pr-reviewer`. Dispatch `workflowType=triage`, `workItemKind=review_target`, with the originating review command attached as `triggerContext.reviewProfileId`. |

The only enum-level change is dropping `review` from `WorkflowType`; existing `review` rows migrate to `triage` with `workItemKind=review_target`. The runner routes by `executorKey` only; `workflowType` remains the coarse classifier across the rest of the canonical run model.

The current 9-section triage rendering (`renderTriageReportMarkdown`) splits as follows: the system skill emits **structured fields** (`StructuredFindings` in the output envelope), the connector calls the **findings API** with those fields, and the connector also renders the markdown comment body from the same fields using a thin per-connector renderer (so different connectors can adapt formatting — Slack mrkdwn vs GitHub markdown vs Linear markdown). The skill never knows the destination format.

Once these three scenarios are seeded, the worker's three handlers are deleted and replaced with one `handleSkillJob`.

## Implementation phases

### Phase A — Foundation

- [ ] A.1 Add `Skill` and `Executor` Prisma models (with `tenantId`, `contentHash`) + migration.
- [ ] A.2 Build the file → DB seed loop (boot-time upsert, hash-based change detection).
- [ ] A.3 Define the executor YAML JSON schema; build a parser + validator returning typed AST. The parser loads referenced skill rows via the loader from A.4 so it can record each system + complementary skill's `Skill.contentHash` per stage for dispatch pinning, and perform the parse-time multi-leaf safety lint by inspecting the leaf-stage system skill's `outputSchema`.
- [ ] A.4 Define the skill frontmatter parser; build a loader that turns a `Skill` row into a `LoadedSkill` (frontmatter fields + body + parsed output schema if present).
- [ ] A.5 Extract the `SkillRunResult` envelope schema (with `DeliveryOp[]`, `StructuredFindings`, `loop`, `extras`) into `packages/contracts`.
- [ ] A.6 Update `WorkerJobSchema`: add optional `executorKey: string`, `executorRevisionHash: string`, and a `resolvedSkillManifest: Array<{name, contentHash}>` (refs only — body resolution happens in the worker). Keep `workflowType` as the existing `triage | build | merge` enum (drop only `review` — see migration table). Update `worker.ts` routing: dispatches with `executorKey` go to `handleSkillJob`; dispatches without `executorKey` continue to the legacy `triage` / `build` / `merge` handlers. The fallback path is removed in C.8 once migration completes.
- [ ] A.7 Add `workflow_runs.resolvedExecutorRevision` and `workflow_runs.resolvedSkillRevisions: Json` columns; the API populates them at run creation time.
- [ ] A.8 Add a `dispatch_attempt_checkpoints` table (one row per `(dispatchAttemptId, kind, iteration?, stageId?)`, append-only): durable per-iteration leaf outputs and per-stage completion state. The worker API gains `POST /v1/dispatch-attempts/:id/checkpoints` so the runner can write progress between cancel checkpoints. Cancel-and-resume reads the latest checkpoints; `lost`-reconciliation also reads it before declaring the attempt failed.

### Phase B — Runner (in-process worker first; identical contract for remote runtime later)

- [ ] B.1 Build the prompt composer: `executor.preamble + system_skill.body + complementary[].body + output contract block + inputs_from rendering + task prompt`. Implement the deterministic `inputs_from` rendering algorithm (see _`inputs_from` rendering grammar_).
- [ ] B.2 Build the stage scheduler: spawn parallel groups, await `after:` deps, collect `SkillRunResult` outputs, feed downstream stages. Honour `guardrails.fan_out_min_success_rate` and `guardrails.consolidator_max_retries`. Enforce the multi-leaf safety rule at parse time.
- [ ] B.3 Build the loop wrapper: iterate stage scheduler until `loop.done: true` or `max_iterations`. Honour `guardrails.loop_safety.min_iteration_change` (default true when `until_done: true`). Persist iteration state. Implement the "prior `loop.done: true` sticks" rule for the fan-out failure cascade.
- [ ] B.4 Implement the cancel checkpoint loop: check `run.status === 'cancel_requested'` before each stage spawn and before each loop iteration. On hit, stop cleanly and apply the output preservation rules from _Cancel & stop_.
- [ ] B.5 Replace the three handlers with one `handleSkillJob(job, api)` that resolves the dispatch's pinned executor + skill bodies via direct Prisma read by `(name, contentHash)`, runs the pipeline, and submits the leaf `SkillRunResult` set back to the API. The runtime stops there — delivery is API-owned (see _Connector delivery_). When this same code runs inside the remote runtime CLI later, the resolver swaps from Prisma read to authenticated HTTP fetch (Phase E.1) without changing the runner.
- [x] B.6 Build the API-side delivery resolver that maps each leaf `DeliveryOp` to its target connector (source vs code-host) per the routing table in _Connector delivery_, persists `action_outputs` and `action_delivery_attempts`, and invokes the per-connector translators (GitHub first).
- [x] B.7 Implement the progress-comment lifecycle on the GitHub connector (placeholder → verify-then-edit → final, with stale-placeholder fallback). Throttle edits at 30s.

### Phase C — Built-ins

- [ ] C.1 Author `packages/skills/builtin/triage-issue/` (SKILL.md + output.schema.json mirroring today's `TriageOutputSchema`).
- [ ] C.2 Author `packages/skills/builtin/pr-reviewer/`.
- [ ] C.3 Author `packages/skills/builtin/merge-reviewer/`.
- [ ] C.4 Author `packages/skills/builtin/consolidator/` and `consolidator-and-fixer/` (used by the looping executor).
- [ ] C.5 Author `packages/skills/builtin/deep-reviewer/` (system skill for the cross-LLM worker pattern).
- [ ] C.6 Author one or two complementary skills as proofs (`codebase-architecture`, `api-best-practices`).
- [ ] C.7 Author `packages/executors/builtin/triage-default.yaml`, `merge-default.yaml`, `pr-review-default.yaml`, `cross-llm-review.yaml`, `zero-defect-review.yaml`.
- [ ] C.8 Write a migration script that walks every `WorkflowScenarioStep` whose `stepType` matches a legacy handler, creates the corresponding executor row if needed, and writes `executorKey` + `taskPrompt` into `config`. Steps whose `config` contains hand-tuned fields (custom prompts, non-default CLI args, custom labels) are flagged with `migration_status: requires_manual_review` and surfaced as a banner in the admin UI; the script does not silently overwrite operator customisation. **Cutover runbook for legacy-handler removal:** (1) deploy the worker with both code paths and run the migration script; (2) pause the BullMQ queue in production; (3) wait for `getActiveCount() + getDelayedCount() === 0`; (4) ship a follow-up worker release that deletes the legacy handlers and removes the `executorKey`-absent fallback in A.6. No drain-gate UI, no preflight query — the queue-drain step is sufficient because BullMQ jobs are bounded and short-lived in this system.

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

- [ ] E.1 Wrap the existing dispatch envelope at the WebSocket adapter layer so every remote dispatch carries `fetchUrl` per skill manifest entry alongside the `(name, contentHash)` pair already present from A.6, plus the parsed YAML AST. The runtime fetches each body on first use via authenticated HTTP `GET {fetchUrl}` (the URL embeds the dispatch attempt id and content hash; the API serves only the exact pinned hash). The API refuses to serve a different content hash even if the underlying skill row has been edited. Skills cannot be added "mid-run" because dispatch resolution happens once at run creation; admin edits during a run go to the next run, not this one (see _Revision pinning_). Bodies fetched on first use are cached in-process for the dispatch's lifetime; restarts re-fetch. The in-process worker (B.5) is unaffected — it keeps its Prisma resolver.
- [ ] E.2 Add a `cancel_requested` and `cancel_force` message pair to the existing WebSocket session protocol (see _Cancel & stop_); runtime CLI honours the checkpoint loop on `cancel_requested`, terminates spawns on `cancel_force`.
- [ ] E.3 Apply output visibility tier (`full` / `redacted` / `metadata_only`) on egress — both to the streamed log chunks and to every `comment.body` in the output envelope.
- [ ] E.4 Document the skills+executors model in `docs/llm/` so customer-side coding agents installing the runtime know what to expect. Most likely a new `docs/llm/skills-and-executors.md`.

Phase E does not block Phase A–D shipping. The in-process worker satisfies hosted-SaaS use cases; remote runtime support layers on top once the contract exists.

## Resolved questions

The following were open in the original draft; user direction in the 2026-04-17 review and the 2026-04-18 hardening pass collapsed them.

1. **Bot identity per connector** — per-connector configurable, ship a single default for v1. Bot identity feeds the no-self-retrigger guardrail and the `Co-Authored-By` trailer on PRs. When the trigger has no originating user, **or** the originating user equals the bot identity, the trailer is omitted entirely; commit author is always the bot.
2. **Permissions model** — none. No roles, no per-action grants. The trigger allowlist (per scenario, GitHub nicknames + team slugs) is the only actor gate. Whoever has admin access configures everything.
3. **Concurrency / cost guardrails** — none in the platform. Operator decides what to spawn; the cost lesson is theirs to learn. The platform enforces only the YAML-declared `fan_out_min_success_rate` and `consolidator_max_retries`.
4. **Skill dependency mechanism** — none in the skill format. Composition happens at the executor level via `system_skill` + `complementary[]`. Mirrors Claude's flat skill format.
5. **Skill versioning** — builtins update in place via the seed loop; user clones are frozen at clone time. No version field. Revision pinning at dispatch time provides per-run stability; static schema-drift checks are not needed in v1 (runtime validation in `runWithJsonOutput` catches contract mismatches on the affected run).
6. **In-flight cancel** — admin UI Stop button per run; two-phase (`cancel_requested` → `canceled` with optional force-stop). Completed iterations and `loop.done: true` results are preserved on cancel.
7. **Markdown rendering location** — the system skill emits structured fields (`StructuredFindings`); the connector renders markdown for the `comment` op body using a per-connector renderer. The skill is source-agnostic; different connectors render the same fields differently when warranted.
8. **In-platform LLM joins (`inline_llm`)** — cut from v1. Every stage runs as a CLI subprocess. Revisit if profiling shows consolidator subprocess overhead is a meaningful fraction of run time.

## Open questions (still)

1. **Loop expression overrides** — `until_done: true` reading the consolidator's `loop.done` flag is the only stop signal. Worth supporting a YAML-level expression (`stop_when: extras.severity_remaining_max in ['none','low']`) for cases where operators don't want to trust the LLM's verdict, or push that policy into the consolidator skill itself? Current recommendation: skill-only for v1.
2. **Schema declaration format** — JSON Schema in a sidecar file (proposed) vs Zod in TypeScript code (today). JSON Schema is editable in the admin UI without a redeploy and is a portable artifact; Zod is more idiomatic in this codebase. Recommend JSON Schema sidecar + runtime-converted-to-Zod via `zod-from-json-schema`.
3. **Per-spawn cost / latency telemetry** — worth recording per-stage per-spawn duration and (where the executor exposes it) token usage? Not required for v1 but useful enough that it should be considered now to avoid schema churn.
4. **Progress comment update cadence** — every 30s is a guess. Tighten to 10s for short runs, loosen to 60s for long-running loops, or make it configurable per executor? Current recommendation: hardcode 30s for v1, revisit when telemetry exists.
5. **`workflowType` field removal** — current plan keeps `triage | build | merge` (only `review` is removed). Whether to drop the column entirely (and its admin filters) is deferred — the coarse classifier is still useful for provider selection, workflow chaining, and admin filtering.

## Non-goals

- Arbitrary stage DAGs. Two-tier (workers → consolidator) plus loop covers all sketched workflows; chain scenarios for anything more complex.
- Cross-host orchestration. macOS-only stages (e.g. iOS builds) remain a future capability — not blocked by this design but not delivered here.
- Replacing the connector layer. Connectors keep ingest + delivery; this design only changes what happens between.
- A general-purpose expression language for stop conditions. Booleans + `max_iterations` only in v1.
