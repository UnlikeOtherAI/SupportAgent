# GitHub Projects Integration

How Support Agent pulls work from, and pushes status back to, GitHub Projects (v2). Companion to [scenario-catalog.md](./scenario-catalog.md).

## Why

Many teams don't live in the issue list — they live on a Project board. To be useful to those teams, Support Agent must:

1. Treat Project items (not just loose issues) as work items.
2. Honor Project custom fields (Status, Priority, Iteration, Estimate) when selecting and routing work.
3. Write status back onto Project items as workflows progress (Todo → In Progress → In Review → Done).
4. Create and update draft items in a Project directly when non-GitHub sources produce work.

## Key Facts About Projects v2

- GitHub Projects v2 is API-only via **GraphQL** (no REST endpoints). The `gh` CLI exposes most of it through `gh project ...` and `gh api graphql`.
- A Project is owned by an **org or user** (not a repo). One Project can contain items from many repos.
- Items are one of: `ISSUE`, `PULL_REQUEST`, or `DRAFT_ISSUE`.
- Custom fields come in fixed types: `SINGLE_SELECT`, `NUMBER`, `DATE`, `TEXT`, `ITERATION`.
- Each item has a stable `projectItemId` distinct from the underlying issue/PR `nodeId`.

## Terminology Mapping

| Support Agent concept | GitHub Projects concept |
| --- | --- |
| Source connector | `ProjectsV2` connection (org/user + project number) |
| Work item | `ProjectV2Item` (issue, PR, or draft) |
| External id | `projectItemId` (stable per project membership) |
| Priority / severity | A configured `SINGLE_SELECT` field |
| Sprint window | A configured `ITERATION` field |
| Status column | A configured `SINGLE_SELECT` field (typically "Status") |

## Connector Model

### Where It Lives In The UI

GitHub Projects is **not a separate connector**. It lives inside the existing GitHub connector as a second tab in the Apps UI:

- **Repositories** tab — current behavior (issues, PRs, polling intervals).
- **Projects** tab — new. Lists Projects under the same GitHub auth, lets you add/configure each one and pick which repos feed into it.

Rationale: a Project item is almost always an issue or PR that lives in a repo. Forcing two auth flows (one for repos, one for Projects) doubles setup friction for zero gain, and risks token-scope mismatches between the two. One GitHub auth → both tabs unlock.

The single org-Projects-but-no-repos case is handled by simply leaving the Repositories tab empty — no extra abstraction required.

### Config Shape

Extend the existing GitHub connector with a `projects` block. Stored on the connector config, edited via the Apps → GitHub → Projects tab.

```json
{
  "connectorType": "github",
  "authMode": "local_gh",
  "pollingIntervalSeconds": 60,
  "projects": [
    {
      "id": "triage-board",
      "owner": "rafiki270",
      "ownerType": "user",
      "projectNumber": 4,
      "fieldMap": {
        "status": "Status",
        "priority": "Priority",
        "iteration": "Sprint",
        "estimate": "Estimate"
      },
      "statusValues": {
        "todo": "Todo",
        "inProgress": "In Progress",
        "inReview": "In Review",
        "done": "Done",
        "blocked": "Blocked"
      },
      "repoScope": ["rafiki270/max-test", "rafiki270/max-test-ui"]
    }
  ]
}
```

- `fieldMap` translates the operator-friendly canonical name to the exact field name in the Project. Different teams pick different labels ("Priority" vs "P").
- `statusValues` translates the platform state vocabulary to whatever values the Project's status select uses. Required for status-writeback.
- `repoScope` limits which of the Project's items we bring in. Omit to include all.

## Work Item Ingestion

The poller learns a new mode: **Projects mode**. When a connector has a `projects[]` entry:

1. Query the Project for items updated since the last poll (GraphQL, paged).
2. For each item:
   - If `ISSUE` or `PULL_REQUEST`, resolve to the existing work-item record via `externalItemId` on the underlying issue/PR. Add a `projectItemId` alias so status writeback knows which field to patch.
   - If `DRAFT_ISSUE`, create a new work item with `workItemKind: draft`. Convert to a real issue only if a scenario requires it.
3. Emit `github.project_item.added` / `github.project_item.updated` events with the resolved custom-field values attached.

### New Events (source-side)

- `github.project_item.added`
- `github.project_item.updated` (includes delta of changed fields)
- `github.project_item.status_changed`
- `github.project_item.field_changed` (generic — carries `fieldName`, `oldValue`, `newValue`)

These flow through the same scenario matcher as issue/PR events.

## Scenario Triggers

Add new trigger palette entries:

- `github.project_item.added` — knobs: `projectRef`, `statusEquals?`, `iterationEquals?`
- `github.project_item.status_changed` — knobs: `projectRef`, `fromStatus?`, `toStatus`
- `github.project_item.field_changed` — knobs: `projectRef`, `fieldName`, `toValue?`

Scenarios can then be written like:

- *"When an item enters `In Review` in the Triage Board → run `workflow.review`."*
- *"When an item gets `Priority = P0` → dispatch `workflow.triage` with high-priority profile + Slack ping."*
- *"When a new item enters the current sprint iteration → auto-label `needs-triage`."*

## Outputs (Writeback)

Add new output palette entries:

- `github.project_item.set_status` — knob: `toStatus` (canonical: `todo | inProgress | inReview | done | blocked`)
- `github.project_item.set_field` — knobs: `fieldName`, `value`
- `github.project_item.add` — knobs: `projectRef`, fields to set on creation
- `github.project_item.remove` — knobs: `projectRef`

A workflow run will by default emit `set_status` calls matching its lifecycle:

| Run phase | Status written |
| --- | --- |
| Dispatched | `inProgress` |
| PR opened (build) | `inReview` |
| PR merged (merge) | `done` |
| Run failed / needs approval | `blocked` |

Operators can override or disable this per scenario.

## End-to-End Examples

### Example A: Project-Driven Triage
1. Operator drags a new issue card into the Triage board. It lands in status `Todo`.
2. Connector poll emits `github.project_item.added`.
3. Scenario *"Triage Board new item"* matches:
   - Trigger: `github.project_item.added` with `projectRef: triage-board`
   - Action: `workflow.triage`
   - Outputs: `github.issue.comment` (findings) + `github.project_item.set_status` (`inReview`)
4. Workflow runs, comment lands on issue, card moves to `In Review`.

### Example B: Priority Escalation
1. Operator bumps `Priority` field to `P0` on an existing card.
2. Connector emits `github.project_item.field_changed` with `fieldName: Priority, newValue: P0`.
3. Scenario *"P0 escalation"* matches:
   - Trigger: `github.project_item.field_changed` with `fieldName: Priority, toValue: P0`
   - Action: `workflow.triage`
   - Outputs: `slack.notify` (#incidents, @channel) + `github.issue.label` (`severity-critical`)

### Example C: Sprint-Scoped Triage
1. Scenario uses `github.issue.labeled` (`needs-triage`) as trigger, plus a **condition** `project.iteration == current`.
2. The matcher only runs the scenario for items that are currently in the active sprint on `triage-board`.
3. Issues outside the sprint are ignored, preserving capacity planning.

### Example D: Draft From Slack
1. A Slack `/support new "X is broken"` command posts to the API.
2. The API creates a `DRAFT_ISSUE` in the configured Project via `github.project_item.add`.
3. Support Agent shows the draft in its own UI. When a human converts it to an issue, the existing issue flows take over.

## Admin UI

New tabs in the Apps page for the GitHub connector:

- **Projects** — list, add, and configure projects. Field-mapping UI previews field values by reading the Project schema.
- **Writeback** — global toggle + per-scenario override to allow status writeback.

Workflow Designer palette gains a **Projects** category under Triggers and Outputs.

## Security & Scope

- The `gh` CLI token must have `project` scope (read for ingest; read+write for writeback).
- Projects-mode ingest is **opt-in per connector** — existing deployments without projects see no behavior change.
- Writeback is **opt-in per scenario** to avoid surprise column moves.
- A dry-run mode on each writeback output emits a log-only simulation instead of mutating the board.

## Implementation Gaps

This integration is additive. The work breaks down as:

1. **Connector schema** — extend GitHub connector config with `projects[]` (DB migration not required if stored in the existing `config jsonb` column).
2. **GraphQL client** — thin wrapper in `packages/github-cli` around `gh api graphql`.
3. **Poller** — new `pollProjectsForConnector` path, feeding the same event bus.
4. **Matcher** — accept the new trigger kinds (`github.project_item.*`) and condition shape (`project.field == value`, `project.iteration == current`).
5. **Handlers** — teach triage/build/review handlers to emit status writeback at phase transitions; read writeback outputs from `providerHints`.
6. **Palette** — add trigger + output tiles and their inspector schemas.
7. **Admin UI** — Apps page: Projects tab. Designer: Projects-flavored tiles.
8. **Docs** — update [scenario-catalog.md](./scenario-catalog.md) to add project-aware variants for each relevant entry.

## Related Docs

- [workflow-scenarios.md](./workflow-scenarios.md) — scenario model
- [scenario-catalog.md](./scenario-catalog.md) — library of scenarios (to be extended with project variants)
- [contracts.md](./contracts.md) — event and job contracts that must accept the new trigger kinds
