# Skill: CSR React Admin Panel

## Purpose

Use this when building the Support Agent admin interface. The admin is a fully client-side rendered application. Do not add SSR to the authenticated product surface.

## Core Principles

- client-side rendered React SPA
- feature-first structure
- server state separated from local UI state
- route-level containers define page boundaries
- frontend permissions are UX only; enforcement stays server-side

## Recommended Structure

```text
src/
  app/
  providers/
  router/
  shared/
  api/
  lib/
  ui/
  types/
  features/
  pages/
  tests/
```

## State Rules

- Use TanStack Query for server state.
- Use React state first for local UI state.
- Use Zustand only when state must cross multiple distant components.
- Do not mirror fetched server data into custom stores without a strong reason.

## API Integration Rules

- One central HTTP client.
- Normalize API errors into one shared error shape.
- Keep source-specific or backend-only logic out of React components.
- Validate forms at the boundary with Zod-backed schemas.

## Routing Rules

- Use React Router with explicit route objects.
- Keep page containers at the route boundary.
- Use lazy route loading once the app grows enough to justify it.
- Scaffold each new page with `wf` CLI.
- Build one route slice at a time.
- After each loop turn, run a Playwright clickthrough for the new path before moving on.

## Admin UI Concerns

The first admin views should support:

- connector setup
- source to repository mapping
- workflow runs
- findings
- outbound destinations
- logs and artifacts
- communication channel pairing
- trigger policies
- workflow scenarios
- build and merge controls

Build those as feature slices, not one giant dashboard page.

## Implementation Loop

For this project, the default admin-page loop is:

1. scaffold the page with `wf`
2. wire the real route and API boundary
3. add or update the Playwright clickthrough
4. run the clickthrough
5. fix failures
6. re-run until the path is stable

Do not leave several partially wired pages for a later testing pass.
