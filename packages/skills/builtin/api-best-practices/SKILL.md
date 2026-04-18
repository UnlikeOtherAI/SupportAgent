---
name: api-best-practices
description: |
  Use when a system skill needs general API design, validation, and code
  quality guidance. Adds reusable review heuristics for backend and contract
  changes without changing the skill's output contract.
role: complementary
---

# API Best Practices

Use these API review heuristics when they are relevant to the task.

## Contract discipline

- Validate external input at the edge.
- Keep request and response shapes explicit and typed.
- Avoid ambiguous optional fields when the domain can model a clearer state.
- Prefer one canonical contract instead of duplicated ad hoc shapes.
- Backward compatibility matters for persisted or external payloads.

## Layering

- Keep controllers thin.
- Keep orchestration in services.
- Keep database access in repositories.
- Keep external API calls in dedicated clients or adapters.
- Do not leak transport concerns into business logic.

## Reliability

- Prefer deterministic behavior over fuzzy fallbacks.
- Fail clearly on broken invariants.
- Surface actionable errors.
- Preserve auditability for state changes and external side effects.
- Watch for retry behavior, idempotency, and double-delivery risks.

## Security and correctness

- Check authentication and authorization boundaries.
- Validate user-controlled identifiers and references.
- Avoid trusting provider metadata without validation.
- Be careful with secret handling, logging, and outbound payload content.
- Look for race conditions around state transitions and queued work.

## Data and schema changes

- Prisma should remain the source of truth for persisted schema.
- Shared contracts should stay aligned across API, worker, and admin consumers.
- When a change affects connector routing, findings, or delivery behavior, verify the whole path end to end.

Use these heuristics to sharpen the system skill's analysis, not to expand scope into generic style advice.
