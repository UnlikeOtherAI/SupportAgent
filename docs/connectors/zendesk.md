# Zendesk Connector Design

> Last updated: 2026-04-18
> API reference: https://developer.zendesk.com/api-reference/ticketing/introduction/

---

## 1. Overview

- **Category**: Issue-tracker / Support ticketing
- **Cloud vs self-hosted**: Cloud-only (Zendesk Suite); no on-prem equivalent in current product line (legacy Zenoss not related)
- **Official API reference**: https://developer.zendesk.com/api-reference/ticketing/introduction/

Zendesk is a multi-channel customer service platform. The Support API (ticketing) is the primary integration surface. There is no true self-hosted variant — organizations requiring on-prem may use legacy Zendesk Explore or third-party proxies, but this is not officially supported.

---

## 2. Authentication

### Supported Mechanisms

| Method | Token Format | Header | Notes |
|--------|-------------|--------|-------|
| API Token (Basic Auth) | `{email}/token:{api_token}` base64 | `Authorization: Basic {base64}` | Up to 256 tokens per account |
| OAuth 2.0 Access Token | `{access_token}` | `Authorization: Bearer {access_token}` | Per-instance access |
| Global OAuth (external apps) | `{access_token}` | `Authorization: Bearer {access_token}` | Required for multi-tenant distribution |
| End-user authentication | Email + password | — | For closed help centers only |

### API Token (Recommended for MVP)

1. Admin → Apps and Integrations → Zendesk API → API Token
2. Create token, copy value
3. Encode `{agent_email}/token:{token}` as base64
4. Send as `Authorization: Basic {base64}`

```http
Authorization: Basic amRvZUBleGFtcGxlLmNvbS90b2tlbjo2d2lJQldiR2tCTW8xbVJETXVWd2t3MUVQc05rZVVqOTVQSXoyYWt2
```

### OAuth 2.0 Flow (Production)

1. Register OAuth client in Admin Center
2. Redirect user to authorization URL
3. Exchange code for access token + refresh token
4. Store refresh token; access token expires

**Scope requirements** (Support API):

| Scope | For |
|-------|-----|
| `read` | Reading tickets, comments, users, orgs |
| `write` | Creating/updating tickets, posting comments |
| `ticketing:actions:execute` | Status transitions, assignments |
| `users:read` | User identity resolution |
| `organizations:read` | Organization lookup |

### Token Lifetime

- **API tokens**: Do not expire (until revoked)
- **OAuth access tokens**: Configurable TTL, default 1 hour
- **OAuth refresh tokens**: Configurable TTL; global OAuth clients require refresh flow as of Feb 2026

### Recommendation for SupportAgent MVP

**API Token (Basic Auth)** — simplest to implement, no OAuth redirect flow needed, no token refresh complexity. Scope: `read` + `write` on a dedicated SupportAgent agent account.

---

## 3. Inbound — Events and Intake

### Webhooks (Primary)

Zendesk webhooks are configured in Admin → Apps and Integrations → Webhooks.

**Event types** (subset relevant to SupportAgent):

| Event Name | Description |
|------------|-------------|
| `ticket.created` | New ticket created |
| `ticket.updated` | Any ticket field change |
| `ticket.status.changed` | Ticket status transition |
| `ticket.priority.changed` | Priority changed |
| `ticket.assignee.changed` | Assignee changed |
| `ticket.tags.changed` | Tags added/removed |
| `ticket.comment.created` | Public or private comment added |
| `ticket.sla.status_changed` | SLA breach/fulfillment |
| `ticket.responder_assigned` | Agent assigned |
| `user.created` / `user.updated` | User changes |
| `organization.created` / `organization.updated` | Org changes |

### Webhook Configuration

- HTTP endpoint: configurable URL
- HTTP method: `POST` (request body is JSON)
- Content-Type: `application/json`

### Signature Verification

Webhook requests include:

```http
X-Zendesk-Webhook-Signature: {base64_signature}
X-Zendesk-Webhook-Signature-Algorithm: HMAC-SHA256
```

Secret is provisioned per webhook in the Zendesk UI. Verify by computing `HMAC-SHA256(secret, raw_body)` and comparing base64-encoded.

### Retry / Delivery Semantics

- Zendesk retries failed requests (HTTP 4xx except 429, or 5xx)
- Circuit breaker avoids resending to broken endpoints
- Delivery is **at-least-once**; deduplicate by `zendesk_webhook_id` + event timestamp
- No guaranteed ordering

### Polling Fallback (Incremental Export API)

For reconciliation and missed webhooks:

```
GET /api/v2/incremental/tickets/cursor?start_time={unix_timestamp}
GET /api/v2/incremental/ticket_events/cursor?start_time={unix_timestamp}
```

- Cursor is opaque; store and paginate via `next_page` URL
- Cursor-based pagination has **no resource limits** (unlike offset pagination)
- Recommended: poll every 30-60 seconds for new events
- `start_time` in Unix epoch seconds (not milliseconds, as of Apr 2025)

### Payload Fields to Persist

| Field | Source Path |
|-------|-------------|
| Ticket ID | `ticket.id` |
| External URL | `https://{subdomain}.zendesk.com/agent/tickets/{id}` |
| Title | `ticket.subject` |
| Body/description | `ticket.description` (first comment) |
| Author | `ticket.requester_id`, `ticket.comments[].author_id` |
| Created at | `ticket.created_at` (ISO 8601) |
| Updated at | `ticket.updated_at` |
| Status | `ticket.status` (open, pending, hold, solved, closed) |
| Priority | `ticket.priority` (low, normal, high, urgent) |
| Tags | `ticket.tags[]` |
| Assignee | `ticket.assignee_id` |
| Organization | `ticket.organization_id` |
| Custom fields | `ticket.custom_fields[{id}]` |
| Thread/parent | Ticket comments are sequential; use `comment.id` as thread anchor |

---

## 4. Outbound — Writing Back

All endpoints: `https://{subdomain}.zendesk.com/api/v2/`

Headers required on mutating requests:
```http
Content-Type: application/json
Accept: application/json
```

### Create Ticket

```http
POST /api/v2/tickets.json
```

```json
{
  "ticket": {
    "subject": "Issue title",
    "comment": {
      "body": "Initial description"
    },
    "requester_id": 12345,
    "priority": "normal",
    "tags": ["supportagent", "automation"],
    "custom_fields": [
      { "id": 123456, "value": "custom value" }
    ]
  }
}
```

### Post Comment on Ticket

```http
POST /api/v2/tickets/{id}.json
```

```json
{
  "ticket": {
    "comment": {
      "body": "Reply text",
      "public": true
    }
  }
}
```

- `public: true` → visible to end user
- `public: false` → internal note

### Edit Comment

Comments in Zendesk are **immutable after creation**. There is no edit endpoint. Internal notes can be deleted; public comments cannot be deleted.

### Delete Internal Note

```http
DELETE /api/v2/tickets/{ticket_id}/comments/{comment_id}.json
```

Only works for internal notes (`public: false`). Public comments cannot be deleted.

### Change Status / Transition

```http
PUT /api/v2/tickets/{id}.json
```

```json
{
  "ticket": {
    "status": "solved"
  }
}
```

Valid statuses: `new`, `open`, `pending`, `hold`, `solved`, `closed`

### Add/Remove Tags

```http
PUT /api/v2/tickets/{id}.json
```

```json
{
  "ticket": {
    "tags": ["supportagent", "escalated"]
  }
}
```

Replaces all tags. To add without replacing, fetch current tags, merge, and submit.

Alternative — incremental tag operations are not available; must replace full tag set.

### Set Priority

```http
PUT /api/v2/tickets/{id}.json
```

```json
{
  "ticket": {
    "priority": "urgent"
  }
}
```

Valid priorities: `low`, `normal`, `high`, `urgent`

### Assign User

```http
PUT /api/v2/tickets/{id}.json
```

```json
{
  "ticket": {
    "assignee_id": 789
  }
}
```

### Mention User

Zendesk uses `@{user_name}` syntax in comments. Mentions resolve to user profiles.

```json
{
  "ticket": {
    "comment": {
      "body": "Hi @john_doe, please review this."
    }
  }
}
```

### Close / Resolve

```http
PUT /api/v2/tickets/{id}.json
```

```json
{
  "ticket": {
    "status": "solved"
  }
}
```

To close permanently:
```json
{
  "ticket": {
    "status": "closed"
  }
}
```

### Attach File

```http
POST /api/v2/uploads.json
```

Headers:
```http
Content-Type: application/binary
```

Query parameter: `filename=attachment.pdf`

Returns `{upload: {token: "abc123"}}`. Use token in ticket comment:

```json
{
  "ticket": {
    "comment": {
      "body": "See attachment",
      "attachments": [{"token": "abc123"}]
    }
  }
}
```

---

## 5. Labels, Flags, Fields, Priorities

### Tags (Not True Labels)

Zendesk uses **tags** as a flat string array per ticket. There is no hierarchical label model.

- Tags are lowercase, hyphenated strings
- Listing available tags: `GET /api/v2/tags.json`
- No tag creation API; tags appear when used on a ticket

### Custom Fields

Custom fields must be pre-created in Admin → Objects → Tickets → Fields.

**Types**: text, textarea, integer, decimal, date, regexp, tagger (dropdown), multiselect, checkbox, currency

```json
{
  "ticket": {
    "custom_fields": [
      { "id": 123456, "value": "some value" }
    ]
  }
}
```

- Custom field IDs are tenant-specific (different per Zendesk instance)
- `GET /api/v2/ticket_fields.json` lists all fields with IDs and types

### Status Model

Fixed statuses (customizable labels, not values):

| Value | Default Label | Category |
|-------|--------------|----------|
| `new` | New | Open |
| `open` | Open | Open |
| `pending` | Pending | Open |
| `hold` | On hold | Open |
| `solved` | Solved | Closed |
| `closed` | Closed | Closed |

Custom ticket statuses available on Enterprise: `GET /api/v2/ticket_statuses.json`

### Priority Model

Four fixed priorities:

| Value | Label |
|-------|-------|
| `low` | Low |
| `normal` | Normal |
| `high` | High |
| `urgent` | Urgent |

### Listing Available Values

```bash
GET /api/v2/ticket_fields.json        # custom fields + field definitions
GET /api/v2/ticket_statuses.json      # status definitions (Enterprise)
GET /api/v2/tags.json                 # all tags in use
GET /api/v2/ticket_priorities.json    # priority options (all tenants)
```

---

## 6. Triggers We Can Match On

From webhook payloads (`ticket.created`, `ticket.updated`, `ticket.comment.created`):

### Labels/Tags

- `ticket.tags` — array of tag strings
- Match on: tag presence, tag absence, exact set
- Tag changes: `ticket.tags_changed` event field

### Status Transitions

- `ticket.status` — current status value
- Transition detection: compare `previous_value` vs `ticket.status`
- `ticket_comment.author_id` — who posted

### Mentions of Bot User

- Check `comment.body` for `@{bot_name}` pattern
- Bot user identified by its `user_id` in `comment.author_id`

### Comment Body Regex

- `comment.body` — plain text comment body
- HTML comments wrapped in `<tribute>` tags when using @mentions

### Assignee Change

- `ticket.assignee_id` — current assignee
- `ticket_comment.author_id` — commenter identity

### Project/Team Scope

- Organization-level: `ticket.organization_id`
- Group-level: `ticket.group_id` (Zendesk groups map to teams)
- Brand-level: `ticket.brand_id` (multi-brand tenants)

### Custom Field Values

- `ticket.custom_fields[{field_id}]` — per custom field
- Field IDs are tenant-specific; admin must configure field mappings

---

## 7. Identity Mapping

### User ID Shape

- Numeric integer: `12345`
- User type: `end-user`, `agent`, `admin`
- Lookup: `GET /api/v2/users/{id}.json`

### Resolving Platform User → Email

```http
GET /api/v2/users/{id}.json
```

Response:
```json
{
  "user": {
    "id": 12345,
    "name": "John Doe",
    "email": "john@example.com",
    "role": "end-user"
  }
}
```

### Bot Identity (no_self_retrigger)

SupportAgent connector posts comments as the authenticated agent user. To detect own activity:

1. Store the `author_id` of the bot agent user at config time
2. On inbound `ticket.comment.created` events, compare `comment.author_id` against stored bot user ID
3. Alternatively: check `comment.public` vs `public: false` if using internal notes for outbound

**Important**: Comments created via API appear identical to agent-created comments in the UI. There is no "via API" indicator on the comment itself.

### Author Field on Posted Comments

When SupportAgent posts a comment, the `author_id` is the authenticated agent's user ID. This is the same ID to track for `no_self_retrigger`.

---

## 8. Rate Limits

### Support API (Ticketing)

| Plan | Requests/Minute |
|------|-----------------|
| Essential (legacy) | 10 |
| Team | 200 |
| Professional | 400 |
| Enterprise | 700 |
| High Volume Add-on | 2,500 |

### Response Headers

```http
X-Rate-Limit: 400
X-Rate-Limit-Remaining: 387
Retry-After: {seconds}   # included on 429 responses
```

For jobs endpoint:
```http
zendesk-ratelimit-inflight-jobs: total=30; remaining=29; resets=60
```

### Retry-After Semantics

- On `429 Too Many Requests`: read `Retry-After` header, wait specified seconds
- Exponential backoff recommended for transient overload

### Other API-Specific Limits

| API | Limit |
|-----|-------|
| Chat API | 200 req/min |
| Talk API (general) | 15,000 req/5 min |
| Talk API (queue activity) | 2,500 req/5 min |
| Talk API (callback request) | 30 req/10 min |
| Incremental User Export | 20 req/min (standard), 60 req/min (high-volume) |
| Agent Availability API | 300 req/min |
| Omnichannel Queue APIs | 300 req/min |

### Bulk/Batch Endpoints

- Side-loading: `GET /api/v2/tickets.json?include=users,organizations` fetches related records in same request
- No true batch mutation endpoint; must send individual requests

---

## 9. Pagination & Search

### Pagination Styles

**Cursor-based (recommended for large datasets)**

```http
GET /api/v2/tickets.json?page[size]=100
```

Response includes `links.next`; paginate via:
```http
GET /api/v2/tickets.json?page[after]={cursor}
```

- Max page size: 100
- No resource limits
- Preferred for large datasets

**Offset-based (legacy)**

```http
GET /api/v2/tickets.json?per_page=100&page=1
```

- Max per page: 100
- **Hard limit**: 10,000 records across 100 pages
- Returns `next_page` and `previous_page` URLs
- Stop when `next_page` is `null`

### Search Endpoint

```http
GET /api/v2/search.json?query={query}&page[size]=100
```

Query syntax examples:
- `type:ticket status:open assignee:{user_id}`
- `type:ticket tags:supportagent`
- `type:ticket created>{date}`

Search is useful for reconciliation: find tickets modified since last sync.

### Incremental Export (Real-time)

```http
GET /api/v2/incremental/tickets/cursor?start_time={unix_timestamp}
GET /api/v2/incremental/ticket_events/cursor?start_time={unix_timestamp}
```

- `start_time` in Unix seconds (not milliseconds)
- Returns cursor for pagination
- Ideal for polling-based sync

---

## 10. Known Gotchas

### Cloud-Only Product

Zendesk has no true self-hosted option. Organizations with data residency requirements must use Zendesk's regional cloud endpoints (`{subdomain}.zendesk.com` vs regional variants).

### Optimistic Locking (Breaking Change, May 2025)

As of May 2025, ticket updates are protected by optimistic locking. Concurrent updates return `409 Conflict`. SupportAgent must implement retry logic on 409.

### Basic Auth Deprecation

Basic authentication for `/api/v2/` endpoints deprecated for new accounts as of Jan 12, 2026. OAuth or API tokens are required.

### Implicit/Password Grant Deprecation

OAuth implicit grant and password grant flows deprecated; removal Feb 17, 2025. Use authorization code + refresh token flow.

### Comment Immutability

Public comments **cannot be edited or deleted** via API. Only internal notes can be deleted. Design accordingly — prefer internal notes for SupportAgent's own comments if editability is needed.

### Tag Replace Semantics

There is no add/remove tag endpoint — tags are replaced in full. Fetch current tags, merge, then submit. Race conditions possible with concurrent updates.

### Custom Field IDs Are Tenant-Specific

Custom field IDs differ between Zendesk instances. Admin must configure field mappings per tenant; no universal field names.

### Per-Tenant API Subdomain

Multi-brand Zendesk accounts use different subdomains per brand. API requests scope to brand via subdomain: `https://{brand_subdomain}.zendesk.com/api/v2/`

### Webhook Eventual Consistency

Webhooks are delivered asynchronously. There may be a delay between ticket creation and webhook delivery. Use the Incremental Export API for authoritative state.

### Rate Limit Burst Handling

Rate limits are per-minute windows. Distribute requests evenly; burst at end of window causes 429s.

### Global OAuth Token Expiration (Feb 2026)

Global (external) OAuth clients now require refresh token flow. Non-global tokens can still be long-lived.

### Multiple Zendesk Products

The unified API reference covers:
- Support (ticketing) — main connector target
- Chat (live chat) — separate API, different base URL
- Talk (voice) — separate API
- Sell (CRM) — separate API, different base URL (`api.getbase.com`)

Do not conflate with Sunshine Conversations (messaging layer) — being sunset.

---

## 11. Recommended SupportAgent Connector Scope

### MVP (Minimum to be Useful)

**Endpoints to wrap:**
```http
POST   /api/v2/tickets.json                        # create ticket
PUT    /api/v2/tickets/{id}.json                   # update ticket, post comment, change status
GET    /api/v2/tickets/{id}.json                   # fetch single ticket
GET    /api/v2/tickets.json                         # list tickets (with pagination)
GET    /api/v2/tickets/{id}/comments.json           # list comments
POST   /api/v2/uploads.json                         # upload attachment
GET    /api/v2/ticket_fields.json                   # list custom fields
GET    /api/v2/users/{id}.json                      # user identity
GET    /api/v2/tags.json                            # list available tags
GET    /api/v2/search.json                          # search tickets
```

**Webhook events to handle:**
- `ticket.created`
- `ticket.updated`
- `ticket.comment.created`
- `ticket.status.changed`

**Minimum config fields:**
- `subdomain` — Zendesk subdomain (e.g., `acme`)
- `agent_email` — agent email for API auth
- `api_token` — API token (encrypted at rest)
- `bot_user_id` — user ID of SupportAgent agent (for no_self_retrigger)
- `brand_id` (optional) — for multi-brand tenants

### Phase 2 (Parity with GitHub Connector)

**Additional endpoints:**
```http
GET    /api/v2/incremental/tickets/cursor           # real-time sync
GET    /api/v2/incremental/ticket_events/cursor    # event stream
PUT    /api/v2/tickets/{id}/tags.json               # (no such endpoint; implement tag merge)
DELETE /api/v2/tickets/{ticket_id}/comments/{id}.json  # delete internal notes
GET    /api/v2/ticket_statuses.json                 # custom statuses (Enterprise)
GET    /api/v2/organizations/{id}.json              # org lookup
GET    /api/v2/groups.json                          # group/team listing
```

**Additional webhook events:**
- `ticket.priority.changed`
- `ticket.assignee.changed`
- `ticket.tags.changed`
- `ticket.responder_assigned`

**Trigger matchers to enable:**
- Tag add/remove
- Status transition (from/to)
- Assignee change
- Custom field value
- Comment body regex

### Phase 3 (Advanced)

- **Custom Objects API**: Define relationships between tickets and business-specific data
- **AI Agents API**: Trigger flows based on AI agent decisions (requires AI agents add-on)
- **Omnichannel Routing**: Manage agent capacity and routing queues
- **Multi-brand**: Handle webhook events scoped to specific brands

---

## 12. Dependencies

### Official SDK

**Node.js/JavaScript**: `node-zendesk` (community-maintained, not official)
- npm: https://www.npmjs.com/package/node-zendesk
- Limited maintenance; last significant update ~2022

**No official Zendesk-maintained SDK exists.** The community `node-zendesk` package wraps most endpoints but may lag behind API changes.

### Recommendation: Raw `fetch`

Prefer raw `fetch` over the community SDK because:
1. SDK may be unmaintained and miss recent API changes (optimistic locking, cursor pagination)
2. Lightweight connector doesn't need full SDK coverage
3. Explicit control over error handling, retries, rate limit backoff
4. Avoids transitive dependency risk

Implement thin wrapper for:
- Auth header construction
- Base URL composition
- Pagination handling (cursor + offset)
- Rate limit reading from headers
- 409 retry on optimistic lock failures

### No Native CLI

Unlike GitHub (`gh`), Zendesk has no CLI tool for API parity. No `zendesk` CLI equivalent to `@support-agent/github-cli`.

---

## 13. Open Questions

1. **Multi-brand vs single-brand**: Does SupportAgent need to support tenants with multiple Zendesk brands? If yes, webhook subscription scope and API subdomain routing add complexity.

2. **Enterprise vs Team plans**: Does the MVP need to support Enterprise features (custom ticket statuses, granular permissions, SLA fields)? Team plan has fewer capabilities.

3. **Help Center vs Support tickets**: Should the connector also handle Help Center article comments and community posts, or only Support tickets?

4. **Internal vs public comments**: Does SupportAgent need to post internal notes (visible only to agents) or only public comments? Internal notes can be deleted; public comments cannot.

5. **Attachment handling**: Should SupportAgent support attaching files to tickets, or is text-only sufficient for MVP?

6. **Optimistic locking retry strategy**: With 409 Conflict responses from May 2025 onward, need to define retry backoff strategy. Should we fetch-fresh-then-retry, or surface conflict to user?

7. **Webhook vs polling trade-off**: Does tenant infrastructure allow reliable webhook delivery? Some proxies/firewalls may block webhook callbacks, requiring polling fallback as primary.

8. **Custom field schema storage**: Custom field IDs are tenant-specific. Should the connector store field ID mappings, or require admin to configure per tenant?

---

## Quick Reference

### Base URL
```
https://{subdomain}.zendesk.com/api/v2/
```

### Key Headers
```http
Authorization: Basic {base64_email_token}
Content-Type: application/json
Accept: application/json
```

### Pagination Params
```http
# Cursor (recommended)
?page[size]=100
?page[after]={cursor}

# Offset (legacy)
?per_page=100&page=1
```

### Rate Limit Tiers
```
Team:     200 req/min
Pro:      400 req/min
Enter:    700 req/min
High Vol: 2,500 req/min
```

### Incremental Export
```
GET /api/v2/incremental/tickets/cursor?start_time={unix_seconds}
```

---

*Sources:*
- *https://developer.zendesk.com/api-reference/ticketing/introduction/*
- *https://developer.zendesk.com/api-reference/introduction/security-and-auth/*
- *https://developer.zendesk.com/api-reference/webhooks/introduction/*
- *https://developer.zendesk.com/api-reference/introduction/pagination/*
- *https://developer.zendesk.com/api-reference/introduction/rate-limits/*
- *https://developer.zendesk.com/api-reference/changelog/changelog/*
