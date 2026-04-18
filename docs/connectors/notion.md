# Notion Connector — Design Research

## 1. Overview

- **Category**: Project-management / knowledge-base (docs-as-database model)
- **Cloud vs self-hosted**: Cloud-only. No self-hosted Notion. No on-prem option.
- **Official API reference**: https://developers.notion.com/reference/intro
- **Base URL**: `https://api.notion.com`
- **API version header**: `Notion-Version: 2026-03-11` (date-based versioning)
- **Key distinction**: Notion is not a traditional wiki. Everything is a **page**. Databases are special pages with property schemas. Blocks are the content unit (paragraphs, headings, callouts, lists, etc.). There is no inherent "ticket" concept — tickets are database rows.

## 2. Authentication

### Integration Token (Internal Integration)

- **How to obtain**: Create at notion.so/profile/integrations → "New integration" → copy token
- **Header**: `Authorization: Bearer {INTEGRATION_TOKEN}`
- **Scope model**: No granular scopes. Users manually share individual pages/databases with the integration. The integration can only access what is explicitly shared.
- **Token lifetime**: Static. No expiry, no refresh. Revocable from the integration settings UI.
- **Best for**: Single-workspace, single-tenant setups.

### OAuth 2.0 (Public Integration)

- **Authorization URL**: `https://api.notion.com/v1/oauth/authorize`
- **Token exchange**: `POST https://api.notion.com/v1/oauth/token` with HTTP Basic auth (`base64(CLIENT_ID:CLIENT_SECRET)`)
- **Header for token use**: `Authorization: Bearer {access_token}`
- **Refresh**: `refresh_token` provided; exchange via same token endpoint
- **Scope model**: No granular scopes. Same sharing model as integration tokens.
- **Best for**: Multi-tenant SaaS where each tenant installs the integration into their own workspace.

### Required Capabilities (Shared Page Access)

| Capability | Requirement |
|---|---|
| Read pages | Page must be shared with integration |
| Read comments | Page shared + "Read content" capability |
| Post comments | Page shared + "Comment" capability |
| Create pages | Parent page/database shared + "Insert" capability |
| Update page properties | Page shared + "Update" capability |
| Manage webhooks | Integration-level, but subscription requires shared pages |

### Recommendation for SupportAgent MVP

**Integration token** is sufficient for single-workspace tenants. For multi-tenant, **OAuth** is required (each tenant's workspace needs its own OAuth install). Notion does NOT support cross-workspace tokens.

## 3. Inbound — Events and Intake

### Webhook Support: YES (introduced 2025)

- **Registration**: UI-based at notion.so/profile/integrations → Webhooks tab. No API for subscription management.
- **HMAC verification**: `X-Notion-Signature: sha256={HMAC-SHA256(request_body, verification_token)}`
- **Verification token**: One-time token sent during subscription setup; stored and used to verify all subsequent requests
- **Retry / delivery**: Notion retries delivery with exponential backoff. Delivery guaranteed at-least-once.
- **Public URL required**: Webhook endpoint must be publicly accessible SSL URL. localhost not supported.

#### Supported Event Types

| Event | Delivery |
|---|---|
| `page.content_updated` | Aggregated (batched, may not be immediate) |
| `page.locked` | Immediate |
| `comment.created` | Immediate |
| `data_source.schema_updated` | New (2025-09-03) |

#### Webhook Payload Fields

```json
{
  "id": "uuid",
  "timestamp": "ISO8601",
  "event": "page.content_updated | page.locked | comment.created",
  "workspace_id": "uuid",
  "workspace_name": "string",
  "integration_id": "uuid",
  "data": {
    "page": { /* page object */ },
    "comment": { /* comment object */ }  // only for comment.created
  }
}
```

### Polling Fallback

No native `updated_since` cursor. Polling strategy:

- **`POST /v1/search`** with `sort: {timestamp: "last_edited_time", direction: "descending"}` — limited to title search
- **`POST /v1/databases/{id}/query`** — query by `last_edited_time` filter (most reliable)
- **`GET /v1/pages/{id}/properties/{prop_id}`** — retrieve individual property values
- **`GET /v1/comments?block_id={id}`** — list comments on a page

**Recommended cursor**: `last_edited_time` on pages/databases. Poll interval: 30s–60s for MVP.

### Payload Fields to Persist

| Field | Source |
|---|---|
| `id` | `page.id` (UUID) |
| `url` | `page.url` |
| `title` | `page.properties.title.title[].plain_text` or first rich_text title |
| `parent_id` | `page.parent.page_id` or `page.parent.database_id` |
| `created_time` | `page.created_time` |
| `last_edited_time` | `page.last_edited_time` |
| `author` | `page.created_by.id` → resolve via `GET /v1/users/{id}` |
| `in_trash` | `page.in_trash` |
| `properties` | Full `page.properties` object for custom field values |
| `blocks` | `GET /v1/blocks/{id}/children` for page content |
| `comments` | `GET /v1/comments?block_id={id}` |

## 4. Outbound — Writing Back

### Create Page

```
POST /v1/pages
```

```json
{
  "parent": { "page_id": "uuid" } | { "database_id": "uuid" },
  "properties": {
    "title": [{ "type": "text", "text": { "content": "Title" } }]
  },
  "children": [
    { "object": "block", "type": "paragraph", "paragraph": { "rich_text": [{ "type": "text", "text": { "content": "Body" } }] } }
  ]
}
```

### Post Comment

```
POST /v1/comments
```

```json
{
  "parent": { "page_id": "uuid" } | { "block_id": "uuid" },
  "rich_text": [{ "type": "text", "text": { "content": "Comment body" } }]
}
```

Supports `markdown` field alternatively. Up to 3 file attachments via `attachments` array.

### Edit Comment

```
PATCH /v1/comments/{comment_id}
```

```json
{ "rich_text": [...] }
```

### Delete Comment

```
DELETE /v1/comments/{comment_id}
```

### Update Page Properties

```
PATCH /v1/pages/{page_id}
```

| Field | Body param |
|---|---|
| Any writable property | `properties.{name}` in body |
| Archive / move to trash | `in_trash: true` (or `is_archived: true`) |
| Restore from trash | `in_trash: false` |
| Icon | `icon: { "type": "emoji", "emoji": "🙂" }` |
| Cover | `cover: { "type": "external", "external": { "url": "..." } }` |

### Set Status / Select / Multi-select

```json
{
  "properties": {
    "Status": { "status": { "name": "Done" } },
    "Priority": { "select": { "name": "High" } },
    "Tags": { "multi_select": [{ "name": "urgent" }, { "name": "bug" }] }
  }
}
```

### Assign User (People Property)

```json
{
  "properties": {
    "Assignee": { "people": [{ "id": "user_uuid" }] }
  }
}
```

### Mention User

Rich text mentions use Notion's internal user format:

```json
{
  "type": "mention",
  "mention": { "type": "user", "user": { "id": "uuid" } }
}
```

Plain `@name` text does not trigger a mention — must use the structured `mention` block.

### Append Blocks (Page Content)

```
PATCH /v1/blocks/{block_id}/children
```

```json
{
  "children": [
    { "object": "block", "type": "paragraph", "paragraph": { "rich_text": [...] } }
  ]
}
```

Append-only. To edit an existing block, use `PATCH /v1/blocks/{block_id}`.

### Attach File

Files attached via:
- **Page property**: `files` property type (set via `PATCH /v1/pages/{id}`)
- **Comment attachment**: `attachments` array on comment creation (max 3)
- **Block**: `file` or `image` block types via `PATCH /v1/blocks/{id}/children`

All file uploads go through `POST /v1/file_uploads` first (multipart), then reference the returned `file_upload_id`.

### Move Page

```
POST /v1/pages/{page_id}/move
```

```json
{ "parent": { "page_id": "uuid" } }
```

## 5. Labels, Flags, Fields, Priorities

### Built-in Label/Tag Model

Notion has no built-in labels. Use these as labels:
- **Status** property (workflow values with colors, e.g. "In Progress", "Done")
- **Select** property (single choice, e.g. "Priority: High/Medium/Low")
- **Multi-select** property (multiple tags, e.g. "Labels: bug, urgent")

### Custom Field Support

- **Per-database**: Each database has its own property schema
- **Per-page**: Properties are per-page overrides within the database schema
- **No global/custom fields**: Must be defined in the database schema first
- **22 property types**: title, rich_text, number, select, multi_select, status, date, checkbox, url, email, phone_number, files, people, relation, formula, rollup, created_time, created_by, last_edited_time, last_edited_by, unique_id, verification, plus location, button, place

### Status Model

- **Status property**: Workflow-style with customizable options, colors, and categories
- **No fixed statuses**: Each database defines its own options
- **Grouping**: Options can be grouped (e.g. "To Do", "In Progress", "Done")

### Priority/Severity Model

No built-in model. Use:
- **Select** or **status** property for priority levels
- **Number** property (1-5 scale)
- **Multi-select** for severity tags

### Listing Available Options via API

```
POST /v1/databases/{database_id}/query  // with empty body to get schema
GET /v1/databases/{database_id}        // full database object including properties schema
```

The database object includes `properties: { name: { select: { options: [...] } } } }` revealing all available select/status options.

## 6. Triggers We Can Match On

| Trigger | How to detect |
|---|---|
| Label add/remove | Monitor `page.properties.{prop}.multi_select` changes via polling or `page.content_updated` webhook |
| Status transition | Monitor `page.properties.Status.status.name` changes |
| Mention of bot user | `comment.created` webhook → inspect `comment.rich_text` for `@bot_name` or structured mentions |
| Comment body regex | `comment.created` webhook → parse `comment.rich_text[].plain_text` |
| Assignee change | Monitor `page.properties.Assignee.people` changes |
| Project/team scope | `page.parent` (page_id or database_id) — parent database is the "project" |
| Custom field values | Any property change via polling `last_edited_time` + property diff |
| Page in trash | `page.in_trash` field change |

**Note**: Notion webhooks do NOT fire on database schema changes for MVP scope. Only `page.content_updated`, `page.locked`, `comment.created` are reliably available.

## 7. Identity Mapping

### User ID Shape

- UUIDv4 format (e.g., `1e2a3b4c-5d6e-7f8a-9b0c-1d2e3f4a5b6c`)
- Returned as `user.id` on all user objects

### Resolving User → Email

```
GET /v1/users/{user_id}
```

Response:
```json
{
  "object": "user",
  "id": "uuid",
  "name": "John Doe",
  "avatar_url": "https://...",
  "type": "person",
  "person": { "email": "john@example.com" }
}
```

- Person-type users: email available via `person.email`
- Bot-type users: no email field; use `bot.owner` or `bot.workspace_name`

### Bot Identity (Our Connector)

- Bot user: `GET /v1/users/me` returns the integration's bot user
- Bot user has `type: "bot"` with `bot.owner` indicating workspace ownership
- Comments posted by our bot: `comment.created_by.id` matches bot user id

### `no_self_retrigger` Implementation

- Store the bot user id from `GET /v1/users/me` at setup
- On `comment.created` events, compare `data.comment.created_by.id` against stored bot id
- If match, skip (our own comment)

## 8. Rate Limits

- **Global limit**: 3 requests per second average per integration
- **Burst**: Bursts beyond average are permitted
- **Rate limit headers**: `Retry-After: {seconds}` (integer, seconds to wait)
- **Retry-After semantics**: Wait the indicated time, then retry without exponential backoff
- **Bulk endpoints**: None available. No batch operations.
- **Concurrency**: Not explicitly limited; safe to run concurrent requests within burst allowance

**Recommendation**: Implement token-bucket at 2.8 req/s (10% headroom). Respect `Retry-After` header.

## 9. Pagination & Search

### Pagination Style

- **Cursor-based**: `start_cursor` (string UUID) + `page_size` (max 100, default 100)
- **Response shape**:
```json
{ "object": "list", "has_more": true, "next_cursor": "uuid", "results": [...] }
```

### Max Page Size

- 100 items per page across all paginated endpoints

### Useful Search/Filter Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /v1/search` | Search pages/databases by title |
| `POST /v1/databases/{id}/query` | Query database with filters and sorts |
| `GET /v1/comments?block_id={id}` | List comments on a page/block |
| `GET /v1/pages/{id}/properties/{prop}` | Get specific property (handles >25 relations) |

### Query Database Filter Example

```json
{
  "filter": {
    "property": "Status",
    "status": { "equals": "In Progress" }
  },
  "sorts": [{ "timestamp": "last_edited_time", "direction": "descending" }]
}
```

## 10. Known Gotchas

1. **Cloud-only**: No self-hosted Notion. No on-prem. All tenants are cloud-only.
2. **No programmatic webhook registration**: Webhook subscriptions must be created in the Notion UI. No API to create/delete/list webhooks. This is a significant multi-tenant challenge — each tenant must manually configure webhooks in their Notion workspace settings.
3. **No webhook management API**: Cannot programmatically enable/disable webhooks per tenant. This limits automation of tenant onboarding.
4. **Aggregated events**: `page.content_updated` is batched; not suitable for real-time triggers. Use `comment.created` and `page.locked` for immediate detection.
5. **No `updated_since` / change feed**: Polling must use `last_edited_time` sort + filter. Notion does not provide a native change stream.
6. **No cross-workspace access**: An integration token or OAuth install is scoped to a single workspace. Cannot access multiple tenants' workspaces from one integration.
7. **Per-tenant OAuth requirement**: Multi-tenant SaaS requires each tenant to separately install the OAuth app. Notion does not support workspace-level authorization — only per-user installs.
8. **No granular scopes**: "Read content" and "Comment" are the only meaningful capability distinctions. Cannot restrict to read-only.
9. **Comments on blocks vs pages**: Comments can be attached to blocks (`block_id`) or pages (`page_id`). Must query both when syncing comments.
10. **Rich text mentions are structured**: Plain `@username` text is NOT a mention. Must construct a `mention` type block. This complicates comment posting.
11. **Properties > 25 items truncated**: `relation`, `people`, `rich_text`, `title`, and `formula` properties with >25 items require separate `GET /v1/pages/{id}/properties/{prop_id}` calls.
12. **Page parent immutability**: Cannot change a page's parent after creation. Must create a new page and archive the old one.
13. **Database schema changes**: Changes to database property schemas (new columns, deleted columns) do NOT fire webhooks. Must re-poll database schema periodically.
14. **File uploads require multipart**: `POST /v1/file_uploads` is multipart form-data, not JSON. Separate upload flow from other API calls.
15. **Workspace vs page_id parent**: Pages can be created under a workspace (root) or under a page/database. Workspace-root pages may not have the same access semantics.

## 11. Recommended SupportAgent Connector Scope

### MVP (minimum to be useful)

**Must-wrap endpoints:**
- `GET /v1/users/me` — bot identity
- `GET /v1/users/{id}` — user → email resolution
- `POST /v1/pages` — create ticket/issue page
- `PATCH /v1/pages/{id}` — update status, properties, archive
- `POST /v1/comments` — post comments
- `GET /v1/comments?block_id={id}` — sync comments
- `POST /v1/databases/{id}/query` — query ticket database (with filters)
- `GET /v1/databases/{id}` — get database schema (available labels/statuses)
- `GET /v1/blocks/{id}/children` — get page content
- `PATCH /v1/blocks/{id}/children` — append blocks to page
- `POST /v1/search` — page discovery

**Webhook events to handle:**
- `comment.created` — immediate, for comment-triggered automation
- `page.content_updated` — aggregated, for property-change detection
- `page.locked` — immediate, for lock-detection

**Minimum config fields:**
- `integration_token` (or `oauth_access_token` + `oauth_refresh_token`)
- `workspace_id`
- `bot_user_id` (from `users/me`)
- `database_id` (the ticket database to query)
- `webhook_verification_token` (from UI setup)
- `webhook_secret` (for HMAC verification)
- `poll_interval_seconds` (fallback when webhook fails)

### Phase 2 (parity with GitHub connector)

- Handle `comment.created` with regex matching and bot-mention detection
- Full property diff on `page.content_updated` to detect status/label changes
- File attachment support via `POST /v1/file_uploads`
- Database schema introspection and caching (for available labels/statuses)
- `no_self_retrigger` via `created_by.id` matching bot user id
- Block-level comment threading via `block_id` comment queries
- `@mention` construction in comment rich_text

### Phase 3 (advanced)

- Multi-database support (multiple project boards)
- Relation property traversal (linked pages)
- Rollup/formula property evaluation (computed fields)
- Page archival/restore workflow automation
- Template page creation for standardized ticket structures
- Real-time sync proxy: expose a local SSE endpoint that fan-broadcasts Notion webhook events to multiple SupportAgent workers

## 12. Dependencies

### Official SDK

- **Package**: `@notionhq/client`
- **npm**: https://www.npmjs.com/package/@notionhq/client
- **Features**: Typed client for all endpoints, built-in retry with `Retry-After` handling, cursor pagination helpers
- **Use it**: YES. `@notionhq/client` is well-maintained, fully typed, and handles the quirks (token format, version header, retry logic). Do not use raw `fetch`.

### No Native CLI

Notion has no equivalent to `gh` or `glab`. No CLI for parity operations.

### Notion MCP

Notion provides an official MCP server at notion.so/developers/guides/mcp/mcp. This is for AI tool integration, not for programmatic connector development. Not relevant for SupportAgent's needs.

## 13. Open Questions

1. **Cloud vs per-tenant OAuth**: Does SupportAgent need to support multi-tenant Notion, or is single-workspace integration token sufficient for MVP?
2. **Webhook manual setup**: Since Notion requires UI-based webhook registration, what is the tenant onboarding flow? Do tenants manually create webhook subscriptions in their Notion workspace?
3. **Database selection**: Does the tenant have an existing "tickets" database, or does SupportAgent need to create one?
4. **Property mapping**: Which Notion property names correspond to "title", "status", "assignee", "priority", "labels"? This must be configurable per-tenant since database schemas differ.
5. **Comment threading**: Should SupportAgent support replies to existing comment threads (`discussion_id`), or only top-level page comments?
6. **File attachment scope**: Is file/screenshot attachment required for MVP, or deferred to Phase 2?
7. **Workspace vs database parent**: Are tickets created as standalone pages in a workspace, or as rows in a specific database? This changes the `parent` object shape.