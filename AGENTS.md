# Support Agent Rules

> Read `AGENTS.md`, `CLAUDE.md`, [brief.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/brief.md), and [techstack.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/techstack.md) before starting work. Update them when project policy or architecture changes.

Also read [docs/skills/README.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/skills/README.md) and use the local skill notes during implementation, especially for architecture choices, CSR admin panel work, and Tailwind UI work.

## Admin UI Build Loop

When building the admin app:

- scaffold each new page with `wf` CLI
- build one page or route slice at a time
- wire the real route, query, and mutation boundary before moving on
- run a Playwright clickthrough after each loop turn (headless unless explicitly requested otherwise)
- fix failures and re-run before starting the next page

Do not batch several unfinished pages and promise to test them later.

## Code Organization

One exported component, service, repository, worker, or helper per file.

- React components: `PascalCase.tsx`
- Utilities, hooks, services, repositories, workers: `kebab-case.ts`
- Types and schemas: `kebab-case.ts`
- Tests: colocated with source, `.test.ts` suffix

Maximum 500 lines per source, test, or config file. If a file grows too large, split it by cohesive responsibility, not by random extraction.

## Architecture Compliance

Follow the documented project shape unless the user approves a change:

- admin app: CSR only
- API: single source of truth for orchestration and persistence
- workers: long-running triage, build, merge, and reproduction execution
- connectors: source-specific normalization at the edge

Do not invent alternate architectural patterns once a package or layer convention exists.

## Single Source of Truth

Related behavior must be centralized:

- configuration comes from typed config modules
- database schema comes from Prisma
- queue contracts come from shared schemas
- external sources are normalized through connector adapters
- error shapes come from a shared API error contract
- issue and run states come from one shared state model

If two places answer the same invariant question, refactor to one source of truth.

## Clear Layers

- Routes handle HTTP, auth context, and request parsing.
- Controllers coordinate requests and responses.
- Services own business logic and orchestration.
- Repositories own database access.
- Connector clients wrap external systems only.
- Workers execute triage, build, merge, reproduction, and artifact collection.

Do not mix those responsibilities.

## No Unnecessary Abstractions

- Write the simplest thing that fits the current requirement.
- Do not introduce generic plugin systems before two real implementations exist.
- Do not add flags to paper over unclear design.
- Prefer explicit code over speculative flexibility.

## Root-Cause First

Do not patch around failures before understanding them.

- check logs first
- identify the broken invariant
- fix the underlying defect
- add targeted tests when validation is in scope

Do not manually mutate queue state, run state, or delivery state to hide a bug.

## Determinism First

Keep triage and automation deterministic where possible.

- normalize external input before it enters core workflows
- prefer structured outputs over regex scraping
- do not stack fuzzy fallbacks without explicit justification

## Core Workflow Invariants

Changes that affect any of these areas require extra care and explicit verification:

- connector normalization
- source-to-repository mapping
- workflow run creation and state transitions
- reproduction decision logic
- findings generation
- outbound delivery and comment-back behavior

Whenever one of these changes, verify that the input contract, stored state, worker behavior, and outbound update behavior still agree.

## Documentation Alignment

Feature work is incomplete until relevant docs are updated.

At minimum, keep these current when behavior changes:

- `docs/brief.md`
- `docs/techstack.md`
- `docs/skills/*` when those rules change
- `README.md` when it exists
- environment or schema docs when added

## Debugging Protocol

Always check logs before guessing.

- application logs
- worker logs
- browser console errors
- job artifacts

Use browser automation or deeper code analysis after log evidence, not before.

## Command Discipline

- Prefer non-interactive commands in automation.
- Prefer `pnpm`.
- Use `steroids-cli` where this project adopts it.
- After each turn that involves code, docs, config, or any tracked-file changes, commit and push before responding. This is automatic — do not ask for confirmation. Skip only if `git status` shows a clean tree.

## What Belongs in the Repo

Commit permanent, hand-authored files only.

Do not commit:

- build output
- generated caches
- backup files
- one-off scratch notes
- duplicate copies of docs or code

Commit:

- source
- tests
- config
- migrations
- permanent scripts
- AI instruction files
- permanent docs
