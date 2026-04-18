# Confluence Connector Design

## 1. Overview

- **Category**: Documentation / Knowledge Base (not an issue tracker)
- **Cloud vs self-hosted**: Both Confluence Cloud and Confluence Data Center/Server supported
- **Official API reference**: https://developer.atlassian.com/cloud/confluence/rest/v2/intro/

Confluence is primarily a documentation/wiki platform. It does NOT have issue/ticket tracking. The connector targets knowledge-base workflows: page creation, comments, space management, and content monitoring.

---

## 2. Authentication

### Confluence Cloud

**Basic Auth (API Token)** — recommended for SupportAgent MVP
- Obtain: https://id.atlassian.com/manage-profile/security/api-tokens
- Header: `Authorization: Basic base64(email:api_token)`
- No OAuth flow required; single token per tenant
- Token lifetime: indefinite until revoked by user

**OAuth 2.0 (3LO)**
- Standard 3-legged OAuth for user-context operations
- Scopes required:
  - `read:confluence` — read pages, spaces, comments
  - `write:confluence` — create/update pages, comments
  - `offline_access` — refresh token
- Token lifetime: 1 hour access, 30-day refresh (if `offline_access` granted)

**Connect App (JWT)**
- Atlassian Forge/Connect apps use JWT signed by app private key
- More complex; not recommended for MVP

### Confluence Data Center / Server

- **Basic Auth** only — username + password or API token (deprecated in newer versions)
- Session-based auth also supported
- No OAuth
- No webhooks in older versions (added in Confluence 7.13+)

### Recommended for SupportAgent MVP

**Cloud**: Basic Auth (API token) — simplest, no OAuth redirect handling needed
**Data Center**: Basic Auth — username/password or personal access token

---

## 3. Inbound — Events and Intake

### Webhook Support (Cloud only)

Confluence Cloud supports webhooks via the Connect app framework.

**Available events (from modules/webhook):**
- `page_created`, `page_updated`, `page_removed`, `page_trashed`, `page_moved`, `page_published`
- `blog_created`, `blog_updated`, `blog_removed`, `blog_moved`
- `comment_removed` (no `comment_created` or `comment_updated`)
- `label_added`, `label_removed`
- `space_created`, `space_updated`, `space_removed`
- `attachment_created`, `attachment_removed`

**Signature verification**: JWT token in `Authorization` header (Connect app signature). Not HMAC-SHA256. Requires valid Connect app installation.

**Critical gotcha**: Webhook delivery is **best effort only**. Confluence explicitly states: *"webhook delivery is not guaranteed; if the add-on is down or network issues occur, the webhook event will not be received."* No retry mechanism.

**Payload example (page_created)**:
```json
{
  "userAccountId": "ff80808154510724015451074c160001",
  "accountType": "customer",
  "page": {
    "id": 16777227,
    "title": "Page Title",
    "spaceKey": "~admin",
    "contentType": "page",
    "version": 1,
    "creatorAccountId": "...",
    "self": "https://.../api/v2/pages/16777227",
    "creationDate": 1594752539309,
    "modificationDate": 1471926079631
  },
  "timestamp": 1471926079645
}
```

**Critical gotcha**: No `comment_created` or `comment_updated` events. Only `comment_removed`. This means two-way comment sync is impossible via webhooks alone.

### Polling Fallback (Required)

Since webhooks are not guaranteed, we must poll:

**Endpoints:**
- `GET /wiki/api/v2/pages` — list pages, supports `cursor`, `limit`, `sort`, `cql` filter
- `GET /wiki/api/v2/pages/{pageId}/comments` — list comments on a page
- `GET /wiki/api/v2/spaces` — list spaces

**Cursor strategy**: Use `cursor` from `Link` header or `/_links/next` in response body. Paginate with `limit=25` (default) up to `limit=100`.

**Filter via CQL** (Confluence Query Language):
- `type=page AND space=SPACEKEY` — pages in a space
- `ancestor=PAGE_ID` — child pages
- `label=important` — pages with label
- `created>=2024-01-01` — date filters

**Payload fields to persist:**
| Field | Path in response |
|-------|-----------------|
| id | `id` (integer) |
| external URL | Construct: `https://{tenant}.atlassian.net/wiki/spaces/{spaceKey}/pages/{id}` |
| title | `title` |
| body | `body.storage.value` (storage format) or `body.atlas_doc_format` (ADF) |
| author | `author.accountId`, `author.displayName` |
| created_at | `createdAt` (ISO 8601) |
| space | `spaceKey` |
| parent | `parent.id` (for nested pages) |
| version | `version.number` |

---

## 4. Outbound — Writing Back

### Create Page

```
POST /wiki/api/v2/pages
```

**Minimal body:**
```json
{
  "type": "page",
  "title": "Page Title",
  "spaceId": "SPACE_ID",
  "body": {
    "storage": {
      "value": "<p>HTML content here</p>",
      "representation": "storage"
    }
  },
  "parentId": "PARENT_PAGE_ID"  // optional, for nested pages
}
```

**ADF format (modern):**
```json
{
  "body": {
    "atlas_doc_format": {
      "version": 1,
      "doc": { "type": "doc", "content": [...] }
    }
  }
}
```

**Storage vs ADF**: Use `storage` for simple HTML (easier). Use `atlas_doc_format` (ADF) for structured content with mentions, tables, etc.

### Post Comment

```
POST /wiki/api/v2/comments
```

**Body:**
```json
{
  "body": {
    "storage": {
      "value": "<p>Comment text with @mention here</p>",
      "representation": "storage"
    }
  },
  "container": {
    "id": "PAGE_ID",
    "type": "page"
  }
}
```

### Update Comment

```
PUT /wiki/api/v2/comments/{commentId}
```

### Delete Comment

Confluence does NOT have a native delete endpoint. Workaround: use content property to mark as hidden, or use `page_history` move to trash. **Deletion is not cleanly supported.**

### Update Page Status

Pages don't have a status field. Workaround: use labels (e.g., `status:draft`, `status:published`).

### Add/Remove Label

```
POST /wiki/api/v2/pages/{pageId}/labels
Body: { "name": "important" }
```

```
DELETE /wiki/api/v2/pages/{pageId}/labels/{labelName}
```

### Mention User

In storage format: `<ac:mention ac:uid="accountId"/>` or `<ac:link><ri:user ri:user-key="accountId"/></ac:link>`

In ADF:
```json
{
  "type": "mention",
  "attrs": { "id": "accountId", "text": "Display Name" }
}
```

### Attach File

```
POST /wiki/api/v2/attachments
Content-Type: multipart/form-data
X-Atlassian-Token: no-check  (required, disables CSRF)
```

Body: `file` (binary), `name` (filename), `mediaType` (MIME type), `containerId` (page ID), `containerType` ("page")

**Note**: Requires `file` multipart upload. Not a JSON API.

### Page Hierarchy

- Get children: `GET /wiki/api/v2/pages/{pageId}/children`
- Get ancestors: `GET /wiki/api/v2/pages/{pageId}/ancestors`
- Create with parent: `parentId` in create payload

---

## 5. Labels, Flags, Fields, Priorities

### Labels

- Simple key-value tags on any content
- List: `GET /wiki/api/v2/pages/{pageId}/labels`
- Create: `POST /wiki/api/v2/pages/{pageId}/labels`
- Delete: `DELETE /wiki/api/v2/pages/{pageId}/labels/{labelName}`
- **No label hierarchy or tag groups** — single flat namespace

### Custom Fields

Confluence does NOT have custom fields like Jira. Content is structured as:
- Title
- Body (ADF or storage)
- Labels
- Attachments
- Comments

**No per-project custom fields.** If you need metadata, use:
- Page properties (content properties API)
- Labels (use as tags)
- Space blueprints with predefined templates

### Status Model

Pages have `status`: `current` (published), `draft`, `trashed`. Not configurable.

### Priority / Severity

**Not applicable.** Confluence has no priority/severity fields. This is a wiki, not an issue tracker.

---

## 6. Triggers We Can Match On

| Trigger | How to detect |
|---------|--------------|
| New page in space | Poll `GET /wiki/api/v2/pages` with `space=KEY` filter, track `createdAt` |
| Page updated | Poll with `updatedAt` cursor, detect `version` increment |
| New comment on page | Poll `GET /wiki/api/v2/pages/{id}/comments`, track by `createdAt` |
| Label added/removed | Use webhooks `label_added`/`label_removed` (Cloud only) |
| Page mentioned our bot | Search body content for `@botName` or `<ac:mention ac:uid="..."/>` |
| Page in specific space | Filter by `spaceKey` in CQL |
| Body content regex | Fetch page body, match regex on `body.storage.value` or ADF `content[].text` |

**Note**: No comment_created webhook means comment triggers require polling.

---

## 7. Identity Mapping

### User ID Shape

- **Cloud**: `accountId` — UUID format (e.g., `ff80808154510724015451074c160001`)
- **Data Center**: `userKey` — string identifier (varies by version)

### Resolve User

```
GET /wiki/api/v2/users/{accountId}
Response: { "accountId", "displayName", "email", "profilePicture" }
```

**Note**: `email` requires `read:confluence` scope and user consent. May not be available for all users.

### Bot Identity

Our connector identifies itself via:
- **Cloud**: Bot user account with `accountId`. Set in `author` when creating content.
- **Data Center**: Bot user key from Confluence user directory.

To detect our own activity in webhooks/comments: use the bot's `accountId` in `userAccountId` field.

### Author Field on Posted Content

Confluence includes `author` object on all created content. When we POST a page/comment, the response includes the author. This is reliable.

---

## 8. Rate Limits

Confluence Cloud REST API v2:

- **Undocumented in public docs** — Atlassian has internal rate limits
- Typical: ~100 requests/minute per tenant
- Response may include `X-RateLimit-*` headers if exceeded

**Best practice:**
- Batch reads where possible
- Add 200-500ms delay between requests
- Use exponential backoff if 429 received

**Data Center**: No rate limits (self-hosted).

---

## 9. Pagination & Search

### Pagination Style

Cursor-based via `cursor` parameter and `Link` header.

**Request:**
```
GET /wiki/api/v2/pages?limit=25&cursor=abc123
```

**Response:**
```json
{
  "results": [...],
  "_links": {
    "next": "/wiki/api/v2/pages?cursor=xyz789&limit=25"
  }
}
```

**Headers also include:**
```
Link: <https://.../next>; rel="next"
```

### Max Page Size

Default: 25
Max: 100 (via `limit` parameter)

### Search

**CQL (Confluence Query Language):**
```
GET /wiki/api/v2/pages?cql=text~"search term" AND space="KEY"
```

Useful filters:
- `text~"query"` — full-text search
- `space="KEY"` — within space
- `type=page` — pages only
- `label="important"` — by label
- `created>=2024-01-01` — by date
- `ancestor=PAGE_ID` — children of page

**Search endpoint (legacy, still works):**
```
GET /wiki/api/v2/search?cql=...
```

---

## 10. Known Gotchas

### Cloud-specific

1. **No comment_created webhook** — only `comment_removed`. Must poll for new comments.
2. **No retry on webhooks** — delivery is best effort, no queue or replay.
3. **User email may be hidden** — privacy settings can block email resolution.
4. **ADF vs Storage format** — ADF is modern but complex; storage is HTML but limited.
5. **Rate limits undocumented** — not in public docs; test before heavy polling.

### Data Center / Server

1. **Webhooks added in v7.13+** — older versions have no webhooks.
2. **No OAuth** — Basic Auth only.
3. **User key format** — differs from Cloud `accountId`.
4. **No v2 API** — Data Center uses v1 REST API (different endpoint structure).
5. **SAML/SSO** — authentication may require special handling.

### Multi-tenant

1. **Per-tenant API token required** — Basic Auth for each tenant's Cloud instance.
2. **Space isolation** — tenant data is scoped by space permissions; filter CQL by allowed spaces.

### Content Quirks

1. **Confluence HTML is sanitized** — storage format doesn't support all HTML; use ADF for complex content.
2. **No page locking** — multiple users can edit simultaneously.
3. **Version history** — pages track full history; can restore.

---

## 11. Recommended SupportAgent Connector Scope

### MVP (Phase 1)

**Endpoints:**
- `GET /wiki/api/v2/pages` — list pages (polling)
- `GET /wiki/api/v2/pages/{id}` — get page details
- `GET /wiki/api/v2/pages/{id}/comments` — list comments (polling)
- `POST /wiki/api/v2/comments` — post comment
- `POST /wiki/api/v2/pages` — create page (optional)
- `GET /wiki/api/v2/spaces` — list spaces
- `GET /wiki/api/v2/users/{id}` — resolve user

**Webhook events to handle (Cloud only):**
- `page_created`, `page_updated` — for page monitoring
- `page_removed` — for deletion detection
- `label_added`, `label_removed` — for label triggers

**Admin panel config:**
- Cloud instance URL (`https://{tenant}.atlassian.net`)
- API token (Basic Auth email:token)
- Space keys to monitor (comma-separated)
- Bot user accountId (for no_self_retrigger)

**Polling strategy:**
- Poll pages every 60s filtered by monitored spaces
- Poll comments every 60s on recently-active pages
- Track last cursor per resource for efficient pagination

### Phase 2

- Handle `blog_created`, `blog_updated` events (blog posts in spaces)
- Full label CRUD via API
- Attachment upload
- Page version tracking and update detection
- User mention parsing in body content
- CQL search integration

### Phase 3

- Page hierarchy traversal (ancestors/children)
- Space blueprint creation
- Page template support
- Advanced ADF construction for rich content
- Page permission management

---

## 12. Dependencies

### SDK

- **Official**: `@atlassian/jira-work-management` — not relevant to Confluence
- **Unofficial**: `confluence-api` (npm) — partial coverage of v1 API only
- **Recommended**: Raw `fetch` — Atlassian REST APIs are well-documented; SDKs lag behind. Use `fetch` with typed interfaces.

### No CLI

Confluence has no equivalent to `gh` CLI. No shell-out option.

### Libraries to consider

- `confluence-markup` — parse/serialize Confluence storage format (if needed)
- Standard `fetch` with JSON for ADF handling

---

## 13. Open Questions

1. **Cloud vs Data Center**: Is tenant using Confluence Cloud or Data Center/Server? This determines auth method (Basic token vs Basic password) and API version (v2 vs v1).

2. **Webhook vs Polling**: Does tenant want real-time webhooks (best effort, no retry) or polling fallback? Recommend polling as primary.

3. **Page vs Blog**: Should connector handle blog posts (`type=blogpost`) in addition to pages (`type=page`)?

4. **Content format**: Which body format to use for creating content — storage (HTML, simpler) or ADF (structured, complex)?

5. **User resolution**: Can we reliably get user email from `accountId`? Some tenants have privacy restrictions.

6. **Data Center version**: For self-hosted, what Confluence version is running? Webhooks require v7.13+.

7. **Space permissions**: Should we filter content by user's space permissions, or assume all spaces are accessible?

---

## Quick Reference

### Base URLs

- Cloud v2: `https://{tenant}.atlassian.net/wiki/api/v2`
- Cloud v1 (legacy): `https://{tenant}.atlassian.net/wiki/rest/api`
- Data Center v1: `https://{server}/confluence/rest/api`

### Common Headers

- Authorization: `Basic base64(email:api_token)` (Basic Auth)
- Content-Type: `application/json`
- X-Atlassian-Token: `no-check` (for attachment uploads)

### Key Endpoints

| Operation | Endpoint |
|-----------|----------|
| List pages | `GET /wiki/api/v2/pages?space={key}&limit=25` |
| Get page | `GET /wiki/api/v2/pages/{id}` |
| Create page | `POST /wiki/api/v2/pages` |
| Update page | `PUT /wiki/api/v2/pages/{id}` |
| List comments | `GET /wiki/api/v2/comments?containerId={pageId}&containerType=page` |
| Post comment | `POST /wiki/api/v2/comments` |
| Add label | `POST /wiki/api/v2/pages/{id}/labels` |
| List spaces | `GET /wiki/api/v2/spaces?limit=25` |
| Get user | `GET /wiki/api/v2/users/{accountId}` |
| Search | `GET /wiki/api/v2/pages?cql=space="KEY"` |