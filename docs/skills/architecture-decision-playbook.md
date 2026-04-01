# Skill: Architecture Decision Playbook

## Purpose

Use this when choosing architecture, deployment, or boundary decisions for Support Agent. Prefer boring, standard integration and operations. Do not introduce distributed-system complexity early.

## Default Position

- start as a modular monolith at the repository level
- keep hard boundaries between admin, API, and worker runtimes
- use one relational database as the system of record
- use async workers and queues for slow or heavy flows
- make observability and security part of the architecture, not follow-up work

## Decision Axes

Evaluate changes against:

- deploy target
- latency sensitivity
- statefulness
- workload shape
- consistency requirements
- operational maturity
- cost sensitivity

## Rules

- Prefer one deployable API unit over multiple microservices until bounded contexts are proven.
- Use background workers for clone, build, emulator, browser, and reproduction work.
- Keep external systems at the edge through ports and adapters.
- Do not introduce Kubernetes or microservices before the worker model is stable.
- Make consistency tradeoffs explicit.

## Support Agent Defaults

- Admin app: CSR React application
- API: TypeScript backend with explicit HTTP boundaries
- Worker: separate runtime for triage, build, merge, and reproduction work
- Database: PostgreSQL
- Queueing: local Redis for development, managed Google Cloud queueing in production
- Artifacts and large logs: object storage

## Extraction Triggers

Only extract a separate service when all are true:

- there is a clear bounded context
- there is a real scaling or isolation need
- the deploy cadence needs to differ
- the operational cost is justified

Otherwise keep the boundary inside the monorepo.
