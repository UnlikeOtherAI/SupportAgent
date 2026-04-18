---
name: codebase-architecture
description: |
  Use when a system skill needs project-specific knowledge about how the
  SupportAgent codebase is organized, which layers own which responsibilities,
  and which architectural invariants must not be broken.
role: complementary
---

# Codebase Architecture

This repository is a TypeScript monorepo for Support Agent.

Use this knowledge when reviewing or authoring changes:

- Keep the product shape simple: one repo, one database, one queue abstraction, one API, one admin app, one worker service.
- The admin app is CSR React only. No SSR patterns.
- The API is the single source of truth for orchestration, persistence, connector configuration, run state, and delivery attempts.
- Workers execute long-running triage, build, merge, and reproduction work in isolated per-run directories.
- Connectors normalize external systems at the edge and own source-specific delivery translation.
- The local orchestrator is the runtime layer that applies prompts, skills, and executors inside customer-owned environments.

## Layer ownership

- Routes: HTTP parsing, auth context, request validation.
- Controllers: request-response coordination only.
- Services: business logic and orchestration.
- Repositories: database access only.
- Connector clients: external platform wrappers only.
- Workers: repo operations, tooling, reproduction, and long-running execution.

Do not mix these responsibilities.

## Architectural invariants

- `workflowType` remains the coarse classifier for `triage`, `build`, and `merge`.
- Related invariants must have one source of truth.
- Queue contracts belong in shared schemas.
- Database schema comes from Prisma.
- Error shapes come from shared API contracts.
- Connector normalization, source-to-repo mapping, workflow state transitions, findings generation, and outbound delivery are high-risk areas. Review them carefully.

## Implementation preferences

- Prefer explicit code over speculative abstraction.
- Prefer minimum-complexity solutions.
- Fix root causes instead of layering fallbacks.
- Use evidence from logs, artifacts, and source before guessing.
- Keep files small and cohesive.
- One exported component, service, repository, worker, or helper per file.

## Stack snapshot

- API: Node.js, TypeScript, Fastify, Zod, Prisma, PostgreSQL
- Admin: React, Vite, Tailwind, React Router, TanStack Query
- Worker: Node.js, queue-driven jobs, `git`, Playwright, API-only reporting

Apply this architecture knowledge when evaluating whether a change fits the repo.
