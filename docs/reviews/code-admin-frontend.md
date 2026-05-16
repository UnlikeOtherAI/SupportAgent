# Admin Frontend — Functionality & Code-Quality Review

Branch: `worktree-agent-a59a5174`
Scope: `apps/admin` (CSR React 19, Vite 8, Tailwind v4, React Router 7, TanStack Query 5, Zustand 5)
Reference docs: `docs/admin-ui.md`, `docs/dashboard.md`, `docs/skills/csr-react-admin-panel.md`

## 1. Executive Summary

The admin app honours the high-level architectural rules: it is genuinely CSR (no SSR creep), routes are sliced, server state lives in TanStack Query, and Zustand is restricted to one auth store. Tailwind v4 `@theme` tokens are well configured in `apps/admin/src/index.css`. However, the operator-critical surfaces — live runs dashboard, run detail, and the workflow designer — do not yet meet the requirements in `docs/dashboard.md` or `docs/admin-ui.md`:

- There is no realtime transport anywhere. Every "live" view is a 5s `refetchInterval` poll. `docs/dashboard.md` mandates a backend→admin WebSocket and a streaming log viewer; neither exists.
- The full log stream API (`runsApi.getLogs`) is defined but never wired into a viewer. Logs are not shown.
- The force-stop button is gated by a render-time `isForceStopEnabled(data)` check with no ticker — it only becomes enabled when the next poll happens to land after the 30s threshold.
- `zod` and `@hookform/resolvers` are installed dependencies but `apps/admin/src` contains zero `z.object` / `useForm` calls. All forms are hand-rolled `useState` validation, contrary to the rule "Validate forms at the boundary with Zod-backed schemas".
- The dashboard ships hardcoded fake stats.
- The workflow designer drifts from the design-token system (literal hex colours), and its connector binding is single-select even though the underlying scenario allowlist is an array.

None of these are recoverable by edits to one file. Each section below lists the concrete fixes.

## 2. Blockers

### B1. No realtime transport — polling-only "live" UI

Files: `apps/admin/src/pages/RunsPage.tsx`, `apps/admin/src/pages/RunDetailPage.tsx:98-101`, `apps/admin/src/api/runs.ts`
Grep across `apps/admin/src` for `WebSocket | EventSource | new WebSocket | SSE | onmessage` returns zero matches.

`docs/dashboard.md` ("Realtime UI", "Live Log Requirements") mandates a backend→admin WebSocket that streams normalized status and log events. The current implementation does `refetchInterval: 5000` on the `run` query for as long as the run is in `pollingStatuses`. Effects:

- Operators cannot watch progress in real time.
- Stage / checkpoint transitions are perceived 0-5s late.
- The "stream type / timestamp / stage" event model required for the log viewer cannot be expressed via fixed-cadence polling without burning bandwidth.

Fix: introduce a single WebSocket session opened by the run detail page (and the runs list, for status fan-out), backed by a server-side persisted log store as described in `docs/dashboard.md` § "Log Persistence".

### B2. Live log viewer absent

Files: `apps/admin/src/api/runs.ts` (`getLogs(id, after?)` defined), `apps/admin/src/pages/RunDetailPage.tsx` (no `getLogs` call site)

`getLogs` exists in the API client but is never imported in any page or component. `RunDetailPage` renders findings + checkpoints, no log panel. `docs/dashboard.md` § "Live Log Requirements" requires stdout, stderr, stage updates, and gateway events with explicit redaction states. Without this the run detail page cannot fulfil its stated purpose ("inspect the full available worker log stream").

Fix: wire `runsApi.getLogs` (paginated, after-cursor) into a `<LogViewer>` slice, with the realtime hook from B1 appending new chunks; render restriction states explicitly.

### B3. Force-stop timer never ticks between polls

File: `apps/admin/src/pages/RunDetailPage.tsx` (uses `isForceStopEnabled(data)` only inside the render body), `apps/admin/src/pages/run-force-stop.ts` (pure function: `now - cancelRequestedAt >= 30_000`)

`isForceStopEnabled` is a pure time comparison evaluated at render time. There is no `setInterval` / `useEffect` ticker, and the surrounding query only re-renders on the 5s `refetchInterval`. Sequence at runtime:

1. operator clicks Stop → `cancelRequestedAt` set on server.
2. The 30s timer elapses while the run is still `cancel_requested`.
3. Force-stop button stays disabled until the next 5s poll happens to coincide with re-evaluation.

In the worst case the button is enabled almost 5s late; if `cancel_requested` is no longer in `pollingStatuses` for any future revision, it stays disabled indefinitely. Also: the button is disabled during the cancel window without any visible countdown, so the operator has no feedback.

Fix: add a `useEffect` that sets a `setTimeout` for the remaining ms until `cancelRequestedAt + 30s`, then forces a state bump. Render the countdown.

### B4. Forms bypass the shared validation contract

Files: any of `apps/admin/src/pages/ScenarioNewPage.tsx`, `ScenarioEditPage.tsx`, `AppEnablePage.tsx`, `AppConfigurePage.tsx`, `ConnectorTriggersPage.tsx`, `WorkflowDesignerPage.tsx`
Grep for `from 'zod'` / `useForm(` in `apps/admin/src`: zero hits.

`docs/skills/csr-react-admin-panel.md` § "API Integration Rules" requires "Validate forms at the boundary with Zod-backed schemas." `package.json` lists `zod`, `@hookform/resolvers`, `react-hook-form` — all installed, none used. Every form is `useState` + ad-hoc string checks, including the create/edit flows for scenarios, connector configuration, and the designer inspector. Two concrete consequences:

- The contracts package (`@support-agent/contracts`) ships Zod schemas for the same payloads, so the admin is currently re-implementing the request shape, with drift.
- Field-level error reporting is inconsistent across pages (sometimes alert, sometimes inline, sometimes silent submission failure).

Fix: import the request schemas from `@support-agent/contracts` and drive each form through `useForm({ resolver: zodResolver(schema) })`.

### B5. Workflow designer connector binding is single-select but the scenario allowlist is an array

Files: `apps/admin/src/pages/WorkflowDesignerPage.tsx` (palette), `apps/admin/src/features/workflow-designer/WorkflowDesignerInspector.tsx`, `apps/admin/src/features/workflow-designer/workflow-designer-types.ts` (`allowedConnectors: string[]`)

The data model carries `allowedConnectors: string[]`, matching `docs/admin-ui.md` § "Form Controls" ("Use multi-select controls for known action sets instead of comma-separated strings"). The palette/inspector UI exposes a single connector picker. Effects:

- An operator cannot build a trigger that fans out across two connectors (e.g. GitHub + Linear) even though the model allows it.
- The graph round-trip through the inspector silently truncates multi-entry allowlists to the first selected value.

Fix: replace the single-select with `SearchableMultiSelect` (already in `components/ui/SearchableMultiSelect.tsx`).

## 3. High

### H1. Dashboard ships hardcoded fake stats

File: `apps/admin/src/pages/DashboardPage.tsx` lines ~128-149

`Connectors`, `Findings`, deltas `+3` / `-5` and similar values are literals. There are no queries hydrating these tiles. Operators will read these as truth. Either wire to the real `metrics` endpoint or delete the tiles until the data exists. `AGENTS.md` § "No Unnecessary Abstractions" and "Root-Cause First" make placeholder UIs a smell.

### H2. Pagination math drifts from API limits

Files: `apps/admin/src/pages/RunsPage.tsx` (`totalPages = Math.ceil(total / 20)`), `apps/admin/src/api/scenarios.ts` (`list` hardcodes 20 and ignores caller `limit`)
Default `limit` on the runs endpoint is 50, so the rendered page count is ≈2.5× too high and clicking later pages returns empty results. `scenarios.list` accepts no `limit` argument at all.

Fix: derive `totalPages` from the same `limit` value sent in the request; thread `limit` through `scenarios.list`.

### H3. `connectors.ts` maps `capabilities` into `config`

File: `apps/admin/src/api/connectors.ts` line ~139 (`config: raw.capabilities ?? {}`)

`capabilities` and `config` are distinct concepts in the contracts. Reading capabilities into `config` causes:

- The connector detail view shows feature-discovery flags as if they were operator-edited config.
- When the operator saves the detail page, capabilities get persisted back into the config field on the server.

This is a single-source-of-truth violation per `AGENTS.md`. Fix: map `config: raw.config ?? {}` and load `capabilities` into its own field.

### H4. `SettingsUsersPage` fetches all users client-side

File: `apps/admin/src/pages/SettingsUsersPage.tsx`

The page paginates a server list locally after fetching everything. At even modest tenancy this becomes the slowest page in the admin and breaks the navigation contract (sort/filter parameters need to be server-driven for parity with other lists).

Fix: server-side pagination using the same `Pagination` component everything else uses.

### H5. 401 handling triggers full-page nav, killing in-flight work

File: `apps/admin/src/lib/api-client.ts` (sets `window.location.href = '/login'`)

A hard nav drops every other query and the realtime channel once it lands. With multiple background queries (runs list, run detail, designer autosave), one expired token makes the operator lose all unsaved canvas edits.

Fix: dispatch through React Router (`navigate('/login', { replace: true })`) and let the query client clear caches; show a "session expired, sign in to continue" toast.

### H6. RawConfigEditor saves on every keystroke that produces valid JSON

File: `apps/admin/src/features/workflow-designer/WorkflowDesignerInspector.tsx` (`RawConfigEditor`)

Every parseable intermediate state is pushed into the node graph. If the operator deletes a key temporarily to retype it, the cleared shape is committed and may invalidate downstream nodes. There is no debounce and no explicit "apply" button.

Fix: debounce (300ms) or require explicit apply.

### H7. `WorkflowDesignerCanvas` re-attaches pointer listeners on every node/connection change

File: `apps/admin/src/features/workflow-designer/WorkflowDesignerCanvas.tsx` (~484 LOC, near cap; useEffect deps include `nodes`, `connections`)

For large graphs this is the wrong dependency list; pointer-move handlers churn unnecessarily. Also: at 484 LOC the file is one feature away from the 500-line cap. Split palette-drag vs canvas-drag vs connection-draw into cohesive child hooks.

### H8. Sidebar nav diverges from `docs/admin-ui.md`

File: `apps/admin/src/components/layout/Sidebar.tsx`

`docs/admin-ui.md` § "Primary Navigation" enumerates Overview / Workflow Runs / Apps / Configuration / Automation / Runtimes / Settings. The actual sidebar labels are Jobs / Configuration / Infrastructure / System (and similar). This is a documented invariant; align labels and route groupings or update the doc — but pick one source of truth.

## 4. Medium

### M1. Tailwind token drift in workflow designer

Files: `apps/admin/src/features/workflow-designer/workflow-designer-options.ts`, `WorkflowDesignerCanvas.tsx`, `WorkflowDesignerInspector.tsx`, `WorkflowDesignerPalette.tsx`

Hardcoded hex `#7445c7`, `#2b2430`, `#fbf8ff`, etc. The rest of the app uses CSS variables defined in `src/index.css` `@theme`. Convert to `var(--color-…)` or Tailwind utility classes.

### M2. CSV string inputs where `admin-ui.md` mandates multi-select

Files: `apps/admin/src/pages/ConnectorTriggersPage.tsx` (events/labels), `apps/admin/src/pages/ScenarioDetailPage.tsx` (users/teams allowlist), `apps/admin/src/pages/ScenarioEditPage.tsx` / `ScenarioNewPage.tsx` (executionProfileId / orchestrationProfileId as freeform text)

`docs/admin-ui.md` § "Form Controls" calls for searchable comboboxes and multi-selects for known taxonomies. `SearchableMultiSelect` exists.

### M3. Paginated response carries `items` and `data` for the same array

File: `apps/admin/src/api/paginated-response.ts`

Both fields are normalised from the backend response. Drift risk: callers read `items`, others `data`. Pick one (prefer `items`) and migrate.

### M4. `getLogs` after-cursor present in API; no UI uses it

File: `apps/admin/src/api/runs.ts`

Tied to B2 but worth flagging separately: the contract is right, the UI is missing.

### M5. YAML editor / SkillPicker re-parses on every render

Files: `apps/admin/src/features/executors/YamlEditor.tsx`, `apps/admin/src/features/executors/SkillPicker.tsx`

`parseExecutorYaml` is called inside the render body. For large skills this is wasteful and may reformat the user's whitespace mid-typing through the `stringify({ lineWidth: 0 })` round-trip in `SkillPicker`. Memoise on `value`, and only re-serialise on explicit changes.

### M6. No optimistic update on skills/executors mutations

File: `apps/admin/src/features/skills/use-skills.ts`

Cache invalidation + `setQueryData` is present, but mutations such as enable/disable feel slow because the UI waits for refetch. Add optimistic update with rollback in `onError`.

### M7. `Suspense` fallback is the same spinner for every lazy route

File: `apps/admin/src/router/index.tsx`, plus feature `routes.ts` files duplicating the same `load()` helper

Pull `load()` into one shared helper; provide route-aware skeletons (or at least a layout-stable placeholder) so the page does not flash empty during chunk load.

### M8. Hard-nav on 401 also fires from background polls

Tied to H5; the runs list polls every 5s. A token that expires mid-session hard-redirects from a background interval, not from a user action. Use the React Router navigation instead so cleanup is orderly.

## 5. Low / Hygiene

- `apps/admin/src/components/ui/DataTable.tsx` applies `whitespace-nowrap` globally; flag in docs that the description column needs `whitespace-normal`. Already handled in `RunDetailPage` finding columns.
- Emoji checkmarks in `WorkflowDesignerCanvas` violate the no-emoji rule. Use icons.
- `inputClassName` literal is duplicated across designer files. Extract to a shared constant or a styled `<Input>`.
- `apps/admin/src/pages/RunDetailPage.tsx` is 481 LOC; split log viewer (B2) and the timeline view into siblings before adding the live transport (B1).
- `apps/admin/src/pages/AppConfigurePage.tsx` is 493 LOC and mixes connector-form and repository-mapping mutations. Split per concern.
- `apps/admin/src/features/workflow-designer/workflow-designer-config-schemas.ts` (219 LOC) is hand-built. Derive from `@support-agent/contracts` schemas if available.
- Auth Zustand store uses `persist` to `'abb-auth'` localStorage. Document this once in `docs/admin-ui.md` so reviewers do not assume cookie-based auth.

## 6. UX Gaps vs Brief

| Brief requirement (source) | Current state |
|---|---|
| "see all workflow runs … with execution provider and host" (`dashboard.md` § Main Jobs View) | Runs list shows provider but not host; columns drift from the mandated set. |
| "open a workflow run and watch progress in real time" (`dashboard.md`) | 5s polling, no realtime transport. (B1) |
| "inspect the full available worker log stream" (`dashboard.md`) | API exists, no UI. (B2) |
| "inspect what channels were notified and what conversations are linked" (`dashboard.md` § Communication Activity) | Run detail has no communication-activity panel. |
| "live log viewer must render restricted-output cases explicitly" (`dashboard.md`) | No log viewer at all; restriction model not rendered anywhere. |
| Trigger builder controls from automation composition registry (`admin-ui.md` § Form Controls) | Designer uses single connector binding and JSON-ish raw editor in the inspector. (B5, H6) |
| Trigger lifecycle states draft/validated/enabled/degraded/error/disabled (`admin-ui.md`) | Designer surface does not render lifecycle states. |
| Use Zod-backed schemas (`csr-react-admin-panel.md`) | Zero Zod usage. (B4) |
| Multi-select for action sets (`admin-ui.md`) | CSV inputs. (M2) |
| Run detail surfaces retry / cancel / request build / request merge (`admin-ui.md` § `/runs/:workflowRunId`) | Only Stop and Force-stop are wired. |

## Top Three Fix Order

1. **B1 + B2** together — introduce the backend→admin WebSocket and the persisted log store, then wire `runsApi.getLogs` + the realtime channel into a single `<LogViewer>` on `RunDetailPage`.
2. **B3** — add a `setTimeout` ticker for the force-stop window and render a countdown.
3. **B4** — adopt Zod schemas from `@support-agent/contracts` with `react-hook-form` across the scenario, connector configure, and designer-inspector forms; delete the hand-rolled validators.
