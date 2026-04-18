# Linear Connector Design

## 1. Overview

- **Category**: Issue-tracker / project-management
- **Cloud only**: Linear is cloud-only; no self-hosted variant exists
- **API type**: GraphQL-only (no REST)
- **Official docs**: https://developers.linear.app/docs
- **Official SDK**: `@linear/sdk` (v82.0.0, `npm install @linear/sdk`)
- **GraphQL endpoint**: `https://api.linear.app/graphql/v1` (production default)
- **SDK source**: https://github.com/linear/linear (monorepo, `packages/sdk/`)

## 2. Authentication

### Mechanism 1: Personal API Key (PAT)

- Obtained from **Settings → Account → Security → API Keys**
- Carried as **`Authorization: Bearer <token>`** header
- Scope is workspace-level; token inherits all permissions of the creating user
- No scopes granularity — a PAT gets read/write on everything the user can access
- Token lifetime: **indefinite until manually revoked**
- **Recommended for SupportAgent MVP** — simplest to implement, no OAuth redirect flow

### Mechanism 2: OAuth 2.0

- Requires an OAuth app registered at **Settings → Developers → OAuth Applications**
- Standard authorization code flow; callback URL must be registered
- Returns an `accessToken` (short-lived, hours) + optional `refreshToken`
- Scope options: `read`, `write`, `comments`, `issues`, `projects`, `teams`, `users`
- App user token tied to a bot/app identity, not a human user
- **Use for multi-tenant / user-delegated flows** where each tenant authorizes their own Linear workspace

### SDK usage

```typescript
import { Linear } from "@linear/sdk";

// PAT
const linear = new Linear({ apiKey: process.env.LINEAR_API_KEY });

// OAuth
const linear = new Linear({ accessToken: oauthResponse.accessToken });
```

### Required scopes for MVP operations

| Operation | Scope needed |
|---|---|
| Read issues, comments, labels | `read` |
| Create/update issues, post comments | `write` |
| Register webhooks | `write` |

## 3. Inbound — Events and Intake

### Webhook Support: YES

Webhooks are registered via the GraphQL mutations `webhookCreate` / `webhookCreateFromEndpoint`. No UI-based webhook registration.

### Webhook Event Names (registered via `type` field on subscription)

| Event | Action values emitted |
|---|---|
| `Issue` | `create`, `update`, `delete`, `archive`, `unarchive` |
| `Comment` | `create`, `update`, `delete`, `archive`, `unarchive` |
| `Cycle` | `create`, `update`, `delete`, `archive`, `unarchive` |
| `Project` | `create`, `update`, `delete`, `archive`, `unarchive` |
| `IssueLabel` | `create`, `update`, `delete` |
| `Attachment` | `create`, `update`, `delete` |
| `User` | `create`, `update` |
| `AuditEntry` | `create` |

Each webhook payload includes a top-level `action` field (string) — the action value is one of `create`, `update`, `delete`, `archive`, `unarchive`.

### Signature Verification

- **Header**: `linear-signature` — HMAC-SHA256 hex digest of raw request body
- **Timestamp header**: `linear-timestamp` — Unix milliseconds; used for replay-attack prevention
- **SDK export**: `LINEAR_WEBHOOK_SIGNATURE_HEADER = "linear-signature"`, `LINEAR_WEBHOOK_TS_HEADER = "linear-timestamp"`
- **Verification**: `LinearWebhookClient` from `@linear/sdk/webhooks` handles HMAC verification + 60s timestamp window

```typescript
import { LinearWebhookClient } from "@linear/sdk/webhooks";

const client = new LinearWebhookClient(secret);
const handler = client.createHandler();
handler.on("Issue", async (payload) => { /* payload.type === "Issue", payload.action === "create" */ });
```

- **Timestamp tolerance**: 60 seconds — any request older than this is rejected
- **Webhook secret**: set when registering the webhook; Linear generates it, or you provide one

### Retry / Delivery Semantics

- Linear retries failed deliveries with **exponential backoff** (up to ~24h)
- Delivery is considered successful on 2xx HTTP response
- No delivery queue UI or dead-letter queue — failed webhooks accumulate until the endpoint recovers
- **No replay protection beyond timestamp** — same event can be delivered twice

### Polling Fallback

Linear exposes **no `updated_since` filter** on most types. Polling is done via `updatedAt` filter:

```graphql
query {
  issues(
    first: 50
    after: "<cursor>"
    filter: { updatedAt: { gte: "<ISO timestamp>" } }
  ) {
    nodes { id identifier title updatedAt }
    pageInfo { hasNextPage endCursor }
  }
}
```

No cursor from the API itself — use `updatedAt` timestamps as pseudo-cursors. Sync by tracking `lastSyncId` from the `Subscription` response as well.

### Payload Fields to Persist

**Issue**:
- `id`, `identifier` (e.g. `PROJ-123`), `title`, `description` (markdown), `body` (HTML/Rich text), `createdAt`, `updatedAt`
- `creator`: `{ id, name, email }`
- `assignee`: `{ id, name }` (nullable)
- `state`: `{ id, name, type: "completed"|"canceled"|"unstarted"|"started" }`
- `priority` (0=no priority, 1=urgent, 2=high, 3=medium, 4=low)
- `labelIds`: `string[]`
- `team`: `{ id, name, key }`
- `project`: `{ id, name }` (nullable)
- `cycle`: `{ id, name }` (nullable)
- `url`: Linear web URL to the issue
- `action`: which webhook action triggered (create/update/delete/archive/unarchive)
- `archivedAt`, `completedAt`, `canceledAt`, `dueDate`

**Comment**:
- `id`, `body` (markdown), `createdAt`, `updatedAt`, `editedAt`
- `issueId`, `parentId` (for threaded replies)
- `creator`: `{ id, name, email }`
- `url`
- `botActor`: bot identity if posted by an integration

**IssueLabel**:
- `id`, `name`, `color` (hex), `team` scope

### What We Need for no_self_retrigger

- Webhook payload includes `creator` object with `id`, `name`, `email`
- For bot-app users: `botActor.id` is set on comments posted by app users
- Our connector should identify itself as an app user and check `botActor.id` on incoming comments to detect its own replies
- **Critical**: `creator.id` is the stable identifier to compare against our own app user's ID

## 4. Outbound — Writing Back

All via GraphQL mutations. No REST equivalent.

### Create Issue

```graphql
mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier title url }
  }
}
```

```json
{
  "input": {
    "teamId": "team-uuid",
    "title": "Issue title",
    "description": "Markdown body",
    "priority": 2,
    "labelIds": ["label-uuid"],
    "projectId": "project-uuid",
    "cycleId": "cycle-uuid"
  }
}
```

Returns `IssuePayload` with `id`, `identifier` (e.g. `PROJ-123`), `url`.

### Post Comment

```graphql
mutation CreateComment($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
    comment { id body createdAt url }
  }
}
```

```json
{
  "input": {
    "issueId": "issue-uuid",
    "body": "Comment text (markdown)",
    "parentId": "parent-comment-uuid"
  }
}
```

**No separate "reply" mutation** — use `parentId` on `CommentCreateInput`.

### Edit Comment

```graphql
mutation UpdateComment($id: String!, $input: CommentUpdateInput!) {
  commentUpdate(id: $id, input: $input) {
    success
    comment { id body editedAt updatedAt }
  }
}
```

```json
{ "input": { "body": "Updated markdown" } }
```

### Delete Comment

```graphql
mutation DeleteComment($id: String!) {
  commentDelete(id: $id) { success }
}
```

### Change Status / Transition

```graphql
mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue { id state { id name type } }
  }
}
```

```json
{ "input": { "stateId": "workflow-state-uuid" } }
```

Linear uses workflow states (UUIDs) rather than string literals. State UUIDs are team-specific. Fetch available states via `workflow.states` on the team.

### Add/Remove Labels

```graphql
mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue { id labelIds }
  }
}
```

```json
{ "input": { "labelIds": ["label-uuid"] } }
```

Labels are set (not appended) — send the full desired array. Use `issueLabelCreate` / `issueLabelDelete` for granular control.

### Set Priority

```graphql
mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue { id priority priorityLabel }
  }
}
```

```json
{ "input": { "priority": 1 } }
```

Priority integers: 0 = no priority, 1 = urgent, 2 = high, 3 = medium, 4 = low.

### Assign User

```graphql
mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue { id assignee { id name email } }
  }
}
```

```json
{ "input": { "assigneeId": "user-uuid" } }
```

Use `null` to unassign.

### Mention User

Use markdown syntax in issue/comment body:

```
Hey @[Name](user:user-uuid)
```

Rendered as a link to the user's profile. Linear resolves mentions from `user:` URNs.

### Close / Resolve / Archive

```graphql
mutation ArchiveIssue($id: String!) {
  issueArchive(id: $id) { success }
}
```

```graphql
mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    issue { id completedAt canceledAt }
  }
}
```

Set `stateId` to a "completed" or "canceled" workflow state, or use `issueArchive`. Archived issues are hidden from default views but not deleted.

### Attach File / Screenshot

```graphql
mutation AttachmentCreate($input: AttachmentCreateInput!) {
  attachmentCreate(input: $input) {
    success
    attachment { id url externalUrl }
  }
}
```

```json
{
  "input": {
    "issueId": "issue-uuid",
    "url": "https://...",
    "archivable": true
  }
}
```

Linear supports URL-based attachments. File upload (binary) is not supported via API — external URLs only.

## 5. Labels, Flags, Fields, Priorities

### Label Model

- **Type**: `IssueLabel` — per-workspace, optionally scoped to a team
- Fields: `id`, `name`, `color` (hex), `description`, `team`
- No hierarchy — flat list
- **Custom fields**: Yes, via `customFields` on Issue. Custom field types: `TEXT`, `NUMBER`, `TEXT_ARRAY`, `DATE`, `EMAIL`, `URL`, `RELATION`, `SELECT`, `MULTI_SELECT`, `ACTOR`, `ADDRESS`, `PHONE`, `FORMULA`, `AUTO_NUMBER`
- Custom fields are workspace-level; each field can be shown/hidden per project

### Status Model

- **Type**: `WorkflowState` — team-scoped workflow states
- Built-in `type`: `unstarted`, `started`, `completed`, `canceled`
- States are UUIDs, not strings — list via `team.workflow.states`
- Each team has its own workflow; states are not workspace-global

### Priority Model

- Integer scale: `0` = none, `1` = urgent, `2` = high, `3` = medium, `4` = low
- `priorityLabel`: human-readable string (e.g. `"Urgent"`)
- No custom priorities — fixed scale

### Severity Model

- No built-in severity. Use custom fields (`SELECT`) or labels.

## 6. Triggers We Can Match On

From incoming webhook payloads and API responses:

| Trigger | Source field |
|---|---|
| Label added/removed | `IssueWebhookPayload.labelIds` diff (compare previous vs current in update payload) |
| Status transition | `IssueWebhookPayload.state` / `fromState` / `toState` (on update action) |
| New issue | `action === "create" && type === "Issue"` |
| New comment | `action === "create" && type === "Comment"` |
| Comment body contains X | `CommentWebhookPayload.body` — regex on markdown body |
| Issue assignee = X | `IssueWebhookPayload.assignee` in update payload |
| Issue priority = X | `IssueWebhookPayload.priority` |
| Mention of bot user | `IssueWebhookPayload.body` / `CommentWebhookPayload.body` containing our `@[BotName](user:bot-id)` mention syntax |
| Project scope | `IssueWebhookPayload.project` / `team` |
| Custom field values | `Issue.customFields` JSON array |
| Cycle assigned | `IssueWebhookPayload.addedToCycleAt` |
| Due date set/changed | `IssueWebhookPayload.dueDate` |

**Action-based filtering**: Use `action` field to distinguish create/update/delete/archive on all entity types.

**no_self_retrigger via botActor**: Comments posted by our app user will have `botActor.id` set to our app user's ID. Compare against `process.env.LINEAR_APP_USER_ID`.

## 7. Identity Mapping

### User ID Shape

- Linear IDs are **ULID-formatted strings** (26-char, e.g. `01J7XK8P5DZF3N4M5Q6R7S8T9`)
- Not numeric, not UUID — sortable, time-ordered
- `User.id` is the stable identifier
- `User.email` is available on `User` objects
- `User.name`, `User.displayName` for display

### Resolving Platform User → Email

```graphql
query {
  user(id: "user-uuid") {
    id
    name
    email
  }
}
```

Or fetch `assignee` / `creator` on Issue/Comment — they include email.

### Bot Identity

- App users (created via OAuth or API key scoped to an app) have `User.app: true`
- `botActor` field on comments posted by app integrations
- `botActor.id` = the app user's own ID — use this for `no_self_retrigger`
- `User.isMe` on the authenticated user — self-identification

### Reliable Author Field on Our Posts

- When we post a comment via `commentCreate`, the response includes `comment.id`
- The comment's `creator` field will be our app user (matches `botActor`)
- We can persist `comment.id` + our internal `runId` for deduplication

## 8. Rate Limits

- **Global limit**: ~600 requests/minute per workspace (approximate; exact values may change)
- **Per-token limit**: same as global for PAT; OAuth tokens share the workspace quota
- **Rate-limit headers**: Not standard GraphQL headers; Linear uses a `X-RateLimit-*` header set
- **SDK error type**: `LinearErrorType.Ratelimited` — caught as `LinearGraphQLError` with `type: "Ratelimited"`
- **Retry-After**: Not explicitly documented; Linear's SDK returns a `LinearGraphQLError` with a `userPresentableMessage`; implement exponential backoff

```typescript
import { LinearErrorType } from "@linear/sdk";

try {
  await linear.query(gql, variables);
} catch (error) {
  if (error.type === LinearErrorType.Ratelimited) {
    // wait and retry
  }
}
```

- **No bulk endpoints** — all writes are single-record mutations

## 9. Pagination & Search

### Pagination Style

- **Cursor-based** using Relay Connections spec
- Fields: `first`, `last`, `after`, `before`
- Response shape: `{ nodes: T[], pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor } }`

```graphql
query Issues($after: String, $first: Int) {
  issues(first: $first, after: $after) {
    nodes { id identifier title }
    pageInfo { hasNextPage endCursor }
  }
}
```

- **Max page size**: Default 50; max 250 via `first: 250`
- **No `updated_since` parameter** — use `filter: { updatedAt: { gte: "..." } }`

### Search / Filter Endpoints

- `issues` query accepts `filter: IssueFilter` with rich predicates
- `IssueFilterSuggestion` query accepts a natural-language prompt and returns filtered results (AI-powered, use sparingly)
- `user.assignedIssues`, `user.createdIssues`, `user.subscribedIssues` for user-scoped queries
- Available filter fields on `IssueFilter`: `id`, `identifier`, `title`, `description`, `state`, `priority`, `labels`, `assignee`, `team`, `project`, `cycle`, `createdAt`, `updatedAt`, `archivedAt`, `dueDate`, `customFields`, and more
- Filter operators: `{ eq: ..., ne: ..., gt: ..., gte: ..., lt: ..., lte: ..., in: ..., contains: ..., startsWith: ... }`

```graphql
query {
  issues(
    first: 50
    filter: {
      team: { id: { eq: "team-uuid" } }
      state: { type: { ne: "completed" } }
      labels: { id: { in: ["label-uuid"] } }
    }
  ) {
    nodes { id identifier title priority }
    pageInfo { hasNextPage endCursor }
  }
}
```

## 10. Known Gotchas

1. **Cloud-only**: No self-hosted Linear. All tenants are on Linear's cloud — no multi-tenant isolation concern from a hosting perspective, but each tenant has their own workspace ID.

2. **Webhook registration requires API write permission**: The PAT or OAuth token must have `write` scope to call `webhookCreate`. Admin users can register webhooks.

3. **Webhook secret is generated by Linear or provided by us**: When creating via API, Linear generates a secret. Store it — it's only shown once.

4. **No `updated_since` cursor**: Polling must use `updatedAt` timestamps. Clock skew between our system and Linear can cause missed events. Solution: overlap windows (poll with `-5m` lookback).

5. **State UUIDs are team-specific**: `stateId` values are not global. Must query `team.workflow.states` to get valid state IDs before transitioning.

6. **Label IDs are not workspace-unique**: A label can exist in multiple teams with different IDs. Always scope labels by team context.

7. **Description is separate from body**: Issue has both `description` and a separate `body` for rich text. The SDK surfaces both; Linear's API uses `description` for the markdown body.

8. **Comments are threaded via `parentId`**: No separate "reply" action — set `parentId` on `CommentCreateInput`.

9. **Rich text body**: Issue descriptions and comments use markdown. The `bodyData` field exposes the rich-text JSON for advanced rendering.

10. **File attachments are URL-only**: No binary upload via API. Attachments require pre-signed URLs or external hosting.

11. **Webhook replay**: Same event can be delivered more than once. Use `id` dedup on stored entities, not just `updatedAt`.

12. **Eventual consistency on writes**: After `issueCreate`, the created issue may not appear in `issues` queries for several seconds. Don't assume immediate consistency.

13. **No per-endpoint rate limits documented**: Only global workspace limits are mentioned. Monitor for 429s and back off globally.

14. **OAuth app setup requires admin**: Only workspace admins can register OAuth apps. For MVP, PATs are simpler.

15. **SDK is auto-generated from schema**: The `@linear/sdk` is generated from Linear's production GraphQL schema. It will lag behind new features by days to weeks. Raw GraphQL gives access to the latest API.

16. **Linear's GraphQL schema is large** (1054 exported classes). The SDK wraps all queries/mutations as TypeScript classes. Consider using raw `fetch` to the GraphQL endpoint for simpler connector logic.

## 11. Recommended SupportAgent Connector Scope

### MVP (Phase 1)

**Endpoints to wrap**:
```graphql
# Intake
issues(first, after, filter)          # polling + initial sync
issue(id)                             # single issue fetch
comments(issueId, first, after)       # comment thread fetch
issueLabels(teamId)                   # available labels
workflowStates(teamId)                # available states
users                                 # user lookup for @-mention resolution
teams                                 # team scoping

# Outbound
issueCreate(input)                    # create issue
commentCreate(input)                  # post comment
commentUpdate(id, input)             # edit comment
commentDelete(id)                    # delete comment
issueUpdate(id, input)              # status change, priority, labels, assignee
issueArchive(id)                      # close/resolve
```

**Webhook events to handle**:
- `Issue` (create, update, archive)
- `Comment` (create, update)
- `IssueLabel` (create, update) — for label sync

**Minimum config fields in admin panel**:
- `LINEAR_API_KEY` — Personal API key
- `LINEAR_TEAM_ID` — Default team UUID (for issue creation scope)
- `LINEAR_WORKSPACE_URL` — e.g. `https://linear.app/acme` (for constructing URLs)
- `LINEAR_WEBHOOK_SECRET` — Webhook signing secret (read-only, shown once on creation)
- `LINEAR_APP_USER_ID` — Our bot/app user ID for `no_self_retrigger`

### Phase 2 (Parity with GitHub connector)

- Full webhook handling: `Cycle`, `Project`, `User` events
- `issueCreate` with template support (via Linear's template IDs)
- Custom field reads/writes via `customFields`
- OAuth flow for multi-tenant user-delegated access
- Attachment creation via external URL
- User email resolution for notification routing
- `updatedAt`-based incremental sync loop (polling backup)
- Slack-compatible `@mention` resolution

### Phase 3 (Advanced)

- Linear AI agent session integration (issues linked to agent sessions)
- GitHub PR ↔ Linear issue sync (Linear has `integrationSourceType`)
- Document/webhook for customer portal integration
- SLA breach event handling (`slaBreachesAt`, `slaHighRiskAt`)

## 12. Dependencies

### Official SDK

- **Package**: `npm install @linear/sdk` (v82.0.0 as of Apr 2026)
- **Exports**:
  - `@linear/sdk` — main GraphQL client + all typed models
  - `@linear/sdk/webhooks` — `LinearWebhookClient` for signature verification
- **Requirements**: Node 18+, TypeScript (types included)
- **SDK vs raw fetch**: Prefer raw `fetch` for connector logic
  - **Why**: SDK is auto-generated and heavy (1054 classes); raw GraphQL with a typed query builder is more controllable
  - **Exception**: Use `@linear/sdk/webhooks` for signature verification — it's well-tested and handles both Node.js and Fetch runtimes

### Webhook Helper (use this, don't reimplement)

```typescript
import { LinearWebhookClient } from "@linear/sdk/webhooks";

const client = new LinearWebhookClient(process.env.LINEAR_WEBHOOK_SECRET!);
const handler = client.createHandler();
// attach to your HTTP server:
//   Node: handler(request, response)
//   Fetch: handler(request) → Promise<Response>
```

### No CLI Equivalent

Linear does not have a CLI equivalent to `gh`. All operations are via API.

## 13. Open Questions

1. **OAuth vs PAT for MVP**: Confirm whether tenants will use PAT tokens (simpler) or need OAuth (for multi-user delegation). PAT recommended for initial build.

2. **Custom field schema**: Do any tenants use custom fields that need to be exposed as trigger criteria? If so, we need to document which custom field types are relevant for automation.

3. **Webhook endpoint availability**: Does each tenant need their own webhook receiver URL, or can we fan out from a single endpoint using workspace ID in the payload?

4. **Workspace vs Team scoping**: Issues belong to teams. Should the connector scope all operations to a single team, or support multi-team workspaces? Single team is simpler for MVP.

5. **Linear workspace URL format**: Is there a standard pattern for `linear.app/{org}` URLs, or do any tenants use custom domains?

6. **Rate limit buffer**: What retry strategy should the worker use on `Ratelimited` errors? Exponential backoff starting at 1s with max 60s delay?

7. **Comment threading depth**: Does SupportAgent need to support deeply nested comment threads, or is 1-level reply sufficient?

8. **Issue template support**: Does the connector need to create issues from Linear's template system, or is bare `issueCreate` sufficient?