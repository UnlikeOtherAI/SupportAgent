# Sentry Connector Design Document

> Platform key: `sentry` | Type: error-monitoring | Last updated: 2026-04-18

---

## 1. Overview

- **Category**: error-monitoring / crash reporting
- **Cloud**: sentry.io (US region: `sentry.io`, EU region: `de.sentry.io`)
- **Self-hosted**: Sentry on-premises (single binary or Docker). API version parity: cloud v0 == self-hosted. Integration Platform (webhooks, internal integrations) available in self-hosted as of Sentry 21.x+.
- **Official API reference**: `https://docs.sentry.io/api/`
- **API base URL**: `https://sentry.io/api/0/` (cloud) or `{self-hosted-host}/api/0/` (self-hosted)
- **Key concepts**:
  - **Issue** = error group (one logical bug, multiple individual Events)
  - **Event** = one individual crash/occurrence within an Issue
  - **Tag** = Sentry's equivalent of labels (key:value pairs on Events and Issues)
  - **Project** = container for Issues and Events, belongs to an Organization

---

## 2. Authentication

### Supported Mechanisms

#### 2a. Organization Auth Token (Recommended for SupportAgent)

- **How to obtain**: Sentry UI → Settings → API → Auth Tokens → "New Token"
- **Header**: `Authorization: Bearer {token}`
- **Scope**: You pick scopes when creating the token; scopes are org-level and apply to all resources
- **Lifetime**: Non-expiring until revoked; tied to the creating user's org membership
- **Recommendation**: Use this for SupportAgent. Create a dedicated service account user in Sentry with minimal org role, then generate a token scoped to exactly what SupportAgent needs.

#### 2b. Internal Integration (Recommended for multi-tenant SupportAgent)

- **How to obtain**: Sentry UI → Settings → Integrations → "New Internal Integration"
- **Header**: `Authorization: Bearer {token}` (same as auth token, but the token is scoped to the integration)
- **Scope**: Configured on the integration; the integration gets a token with those scopes
- **Lifetime**: Non-expiring
- **Why better for multi-tenant**: Internal integrations can be scoped to specific organizations. SupportAgent creates one Internal Integration per tenant organization; each gets its own token. This isolates tenants cleanly.
- **Webhook secret**: The integration's "Webhook URL" page shows a "Client Secret" used for HMAC signature verification.

#### 2c. Member User Token (not recommended)

- **How to obtain**: Per-user API token (Settings → API → "New Token")
- **Header**: `Authorization: Bearer {token}`
- **Lifetime**: Tied to the user account; deactivates if the user leaves the org
- **Gotcha**: If the user is deprovisioned, the token dies immediately.

### Required Scopes

| Operation | Required Scope |
|---|---|
| Read issues / events | `event:read` |
| Post/edit/delete comments | `event:write` |
| Update issue status, assignee, priority | `event:write` |
| Delete issues | `event:admin` |
| List projects, list org members | `org:read` |
| Manage webhooks | `org:write` |
| List teams | `team:read` |

**SupportAgent MVP scope recommendation**: `event:read` + `event:write` (sufficient for reading issues, posting comments, updating status). Add `org:read` for listing projects during onboarding.

### Token Obtainment Flow

1. Tenant admin creates a Sentry account (or uses existing org).
2. Tenant admin (or SupportAgent operator acting as admin) creates an Internal Integration in Sentry settings.
3. During Internal Integration creation, the admin:
   - Sets the integration name (e.g., "SupportAgent")
   - Picks scopes: `event:read`, `event:write`
   - Optionally sets a webhook URL (SupportAgent's webhook receiver endpoint)
   - Copies the "Token" (shown once) and "Client Secret" (for HMAC verification)
4. SupportAgent stores `token` + `clientSecret` + `organizationSlug` + optionally `region` (us/de) per tenant.

---

## 3. Inbound — Events and Intake

### 3a. Webhook Intake (Primary)

Sentry delivers webhooks via the **Integration Platform**. Configure a webhook URL in the Internal Integration settings.

#### Webhook Event Types (via `Sentry-Hook-Resource` header)

| `Sentry-Hook-Resource` | Actions | Relevant? |
|---|---|---|
| `issue` | `created`, `resolved`, `assigned`, `archived`, `unresolved` | **Yes** |
| `comment` | `created`, `updated`, `deleted` | **Yes** |
| `error` | (raw individual events; high volume) | No (use polling) |
| `installation` | `created`, `deleted` | Yes (setup) |
| `event_alert` | triggered | Low priority |
| `metric_alert` | triggered | Low priority |

#### Signature Verification

- **Header**: `Sentry-Hook-Signature`
- **Algorithm**: HMAC-SHA256
- **Input**: Raw request body as UTF-8 JSON string (no parsing/canonicalization)
- **Verification** (Node.js / fetch):
  ```js
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', clientSecret);
  hmac.update(JSON.stringify(requestBody), 'utf8');
  const digest = hmac.digest('hex');
  const isValid = digest === signature; // compare constant-time
  ```
- **Additional headers**: `Sentry-Hook-Timestamp` (Unix seconds) — verify freshness (reject if >5min old) to prevent replay attacks.
- **Secret provisioning**: The Internal Integration's settings page shows the Client Secret when you first save the webhook URL. If lost, regenerate it.

#### Retry / Delivery Semantics

- Sentry retries with exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s (up to 6 retries).
- After all retries fail, Sentry marks the webhook as failing in the integration settings. It does **not** drop the webhook permanently.
- 2xx response = success; anything else = failure (including 4xx).
- **Gotcha**: Sentry does not deduplicate webhook deliveries. If SupportAgent's processing is slow, the same event can arrive twice. SupportAgent must handle idempotency via `issue_id` + `action` + `timestamp`.

#### Issue Webhook Payload

```json
{
  "action": "created",
  "installation": { "uuid": "24b...280" },
  "data": {
    "issue": {
      "id": "1234567890",
      "url": "https://sentry.io/api/0/organizations/example-org/issues/1234567890/",
      "web_url": "https://example-org.sentry.io/issues/1234567890/",
      "project_url": "https://example-org.sentry.io/issues/?project=4509877862268928",
      "status": "unresolved",
      "substatus": "new",
      "issueType": "error",
      "issueCategory": "error"
    }
  },
  "actor": { "type": "application", "id": "supportagent-integration", "name": "SupportAgent" }
}
```

**Fields to persist for Issue events**:
- `data.issue.id` — primary key (numeric string, e.g., `"1234567890"`)
- `data.issue.web_url` — external deep link
- `data.issue.status` — `unresolved` | `resolved` | `ignored`
- `data.issue.substatus` — `new` | `escalating` | `regressed` | `archived_until_escalating` | `archived_until_condition_met` | `archived_forever` | `ongoing`
- `data.issue.issueType` — error type identifier (e.g., `error`, `uptime_domain_failure`)
- `data.issue.issueCategory` — `error` | `feedback` | `performance` | `crons` | `replays`
- `action` — `created` | `resolved` | `assigned` | `archived` | `unresolved`
- `actor` — who triggered the action
- `installation.uuid` — maps to which tenant's integration received the event

#### Comment Webhook Payload

```json
{
  "action": "created",
  "installation": { "uuid": "eac5...ec" },
  "data": {
    "comment": "adding a comment",
    "project_slug": "my-project",
    "comment_id": 1234,
    "issue_id": 100,
    "timestamp": "2022-03-02T21:51:44.118160Z"
  },
  "actor": { "type": "user", "id": 1, "name": "colleen" }
}
```

**Fields to persist for Comment events**:
- `data.comment_id` — primary key
- `data.issue_id` — link to the Issue
- `data.comment` — comment body text
- `data.timestamp` — when created/updated
- `action` — `created` | `updated` | `deleted`

### 3b. Polling Fallback

If webhook delivery fails or during initial sync, poll the REST API.

**Endpoint**: `GET /api/0/organizations/{organization_slug}/issues/`

**Query parameters**:
- `query` — Sentry search syntax. Default: `is:unresolved`. SupportAgent MVP: `is:unresolved` to find all active issues.
- `statsPeriod` — `24h` | `14d` | `90d` | `""` (no stats). Default: `24h`.
- `cursor` — pagination cursor (format: `{timestamp},{shard},{shardNumber}`)
- `shortIdLookup` — `0` (set to `0` for org-level queries; `1` enables short-ID resolution)

**Search syntax examples**:
```
is:unresolved
is:resolved
is:unresolved tag:environment:production
is:unresolved tag:level:error
is:unresolved user.id:{user_id}
is:unresolved assigned_to:{user_id}
is:unresolved project:{project_slug}
is:unresolved issue.type:error
```

**Polling strategy**:
- On first sync: fetch all `is:unresolved` issues, paginate through all pages.
- Ongoing sync: poll with `statsPeriod=1h` or `statsPeriod=14d` to catch recent changes. Use `cursor` from the previous poll to page efficiently.
- **Gotcha**: The `data.issue.status` in webhook payloads is `unresolved`/`resolved`/`ignored`, but the search query uses `is:unresolved`/`is:resolved`. Normalize this.

---

## 4. Outbound — Writing Back

All outbound calls use `Authorization: Bearer {token}` and `Content-Type: application/json`.

### 4a. Post Comment on Issue

```
POST /api/0/issues/{issue_id}/comments/
```

**Scope**: `event:write`

**Request body**:
```json
{
  "body": "This is a comment from SupportAgent triage."
}
```

**Response** (201 Created):
```json
{
  "id": "25474923",
  "body": "This is a comment from SupportAgent triage.",
  "user": { "id": "12345", "username": "supportagent-bot", "email": "bot@example.com" },
  "dateCreated": "2026-04-18T10:00:00.000Z",
  "dateModified": "2026-04-18T10:00:00.000Z",
  "issue": "1234567890"
}
```

### 4b. Edit Comment

```
PUT /api/0/issues/{issue_id}/comments/{comment_id}/
```

**Scope**: `event:write`

**Request body**:
```json
{
  "body": "Updated comment text."
}
```

### 4c. Delete Comment

```
DELETE /api/0/issues/{issue_id}/comments/{comment_id}/
```

**Scope**: `event:write`

**Response**: 204 No Content

### 4d. Change Issue Status

```
PUT /api/0/organizations/{organization_slug}/issues/{issue_id}/
```

**Scope**: `event:write`

**Request body** (examples):
```json
// Resolve
{ "status": "resolved" }

// Unresolve (reopen)
{ "status": "unresolved" }

// Ignore/Archive
{ "status": "ignored" }

// Resolve with substatus (regression tracking)
{ "status": "resolved", "statusDetails": {} }

// Ignore for a duration
{ "status": "ignored", "statusDetails": { "ignoreDuration": 60 } }
```

**Status values**: `resolved`, `unresolved`, `ignored`
**Substatus values** (set automatically by Sentry or via search): `new`, `escalating`, `regressed`, `ongoing`, `archived_until_escalating`, `archived_until_condition_met`, `archived_forever`

### 4e. Assign Issue

```
PUT /api/0/organizations/{organization_slug}/issues/{issue_id}/
```

**Scope**: `event:write`

**Request body**:
```json
// Assign to a user by email
{ "assignedTo": "colleen@example.com" }

// Assign to a team
{ "assignedTo": "team:my-team" }

// Unassign (clear)
{ "assignedTo": "" }
```

**Accepted formats for `assignedTo`**:
- `user:{id}` — by numeric user ID
- `user:{email}` — by email
- `user:{username}` — by username
- `team:{team_slug}` — by team slug
- `""` (empty string) — clears assignment

### 4f. Set Priority

```
PUT /api/0/organizations/{organization_slug}/issues/{issue_id}/
```

**Scope**: `event:write`

**Request body**:
```json
{ "priority": "high" }
```

**Priority values**: `None` (no priority), `low`, `medium`, `high`, `critical`

**Gotcha**: Priority was added in 2023. Older Sentry instances may not have it. Check if `priority` is in the issue object before relying on it.

### 4g. Add/Remove Tags

Tags are set via the tag API (not labels like GitHub).

```
GET  /api/0/issues/{issue_id}/tags/
POST /api/0/issues/{issue_id}/tags/{tag_key}/
```

**Scope**: `event:write`

**POST body**:
```json
{
  "value": "production"
}
```

**Note**: Sentry tags are immutable once set — you can add a new `key:value`, but you cannot change an existing tag value. Tags are on Events within the Issue; most recent Event's tags are shown on the Issue.

### 4h. List Issue Events (for context)

```
GET /api/0/issues/{issue_id}/events/
```

**Scope**: `event:read`

Returns the individual crash occurrences with their timestamps, stack traces, and environment details. Useful for SupportAgent to get the latest crash context.

### 4i. Close / Archive Issue

```
PUT /api/0/organizations/{organization_slug}/issues/{issue_id}/
```

Use `status: resolved` (resolves) or `status: ignored` (archives/ignores). No separate close endpoint.

### 4j. Attach File / Screenshot

Not supported via API. Sentry's file attachment system uses a separate upload mechanism (multipart form, direct DSN upload). Not applicable to SupportAgent's triage flow.

---

## 5. Labels, Flags, Fields, Priorities

### Tags (= Labels)

Sentry has **tags**, not labels. Tags are key:value pairs attached to Events (and shown on Issues).

- Built-in tags: `level`, `server_name`, `site`, `release`, `user`, `transaction`, `environment`, `os`, `browser`, `device`, `url`, `runtime`
- Custom tags: Any `tag:{key}` on the Event in your SDK code. For example: `tag:tenant_id`, `tag:feature_flag`.
- **How to list available tags on an Issue**: `GET /api/0/issues/{issue_id}/tags/` — returns tag keys with top values.
- **How to list all tag keys for a project**: `GET /api/0/projects/{org}/{project}/tags/`

### Status Model

- **Top-level status**: `resolved`, `unresolved`, `ignored`
- **Substatus** (unresolved issues only): `new`, `escalating`, `regressed`, `archived_until_escalating`, `archived_until_condition_met`, `archived_forever`, `ongoing`
- Workflow is determined by `status` + `substatus` combined. Sentry's UI shows "New", "Escalating", "Ongoing", "Regressed", "Archived" based on substatus.

### Priority Model

Five priority levels: `None`, `low`, `medium`, `high`, `critical`. Priority is set on the Issue and propagates from Events. Available via API since Sentry 23.x.

### Severity Model

Not a separate concept. `level` tag (error, warning, info, debug, fatal) plays this role. Priority is orthogonal.

### Custom Fields

Sentry doesn't have custom fields in the traditional CRM sense. Custom data is carried as **tags** (key:value pairs) in the Event payload. If tenants need structured custom fields (e.g., "customer_id", "plan tier"), SupportAgent should treat these as tags to search and filter on.

### Listing Available Values

- **Tags**: `GET /api/0/issues/{issue_id}/tags/` (per issue) or `GET /api/0/projects/{org}/{project}/tags/` (per project)
- **Status**: Not an enum API — statuses are implicit. Use the values from §4d.
- **Priority**: `GET /api/0/ organization's/{org}/issues/` returns `priority` field. There is no dedicated priority list endpoint.
- **Projects**: `GET /api/0/organizations/{org}/projects/` (scope: `org:read`)

---

## 6. Triggers We Can Match On

SupportAgent inbound triggers map to Sentry's webhook and API payload fields:

### Label / Tag Triggers

- **Tag key exists**: `tag:{key}` in issue payload
- **Tag value equals**: `tag:environment:production`
- **Tag value matches regex**: not directly supported via Sentry search, but SupportAgent can filter after fetching

### Status Transition Triggers

- **Action from issue webhook**: `created`, `resolved`, `archived`, `unresolved`
- **Status equals**: `is:unresolved`, `is:resolved`, `is:ignored`
- **Substatus**: `issue.substatus` field (e.g., `substatus:escalating`)
- **Status change via polling**: Compare previous vs. current `status` field

### Mention / Bot Triggers

- **Sentry does not have @mentions** in the same way GitHub does. Comments are flat.
- Bot identity is the actor on comments SupportAgent posts (see §7).
- **Trigger on comment from specific user**: `data.actor.id` in comment webhook.

### Comment Body Triggers

- **Regex match on comment text**: `data.comment` in comment webhook payloads — SupportAgent can apply regex after receiving the event.
- **Contains @-mention of bot**: `data.comment` contains `@supportagent` — SupportAgent can detect mentions.

### Assignee Change Trigger

- **From webhook**: `action: assigned` in issue webhook. The `data.issue.assigned_to` field in subsequent issue GET shows the current assignee.
- **Polling filter**: `assigned_to:{user}` or `assigned_to:team:{team}` in search query.

### Project / Team Scope

- **Scope by project**: `project:{project_slug}` in search query or `data.issue.project_url` in webhook payload.
- **Scope by organization**: Internal integration tokens are org-scoped.

### Custom Field Values (Tags)

- `tag:{key}:{value}` in search query (e.g., `tag:tenant_id:acme`)

### Summary Trigger Matrix

| Trigger Type | Source | Field Path |
|---|---|---|
| New issue created | Webhook | `action == "created"` |
| Issue resolved | Webhook | `action == "resolved"` |
| Issue reopened | Webhook | `action == "unresolved"` |
| Issue archived | Webhook | `action == "archived"` |
| New comment | Webhook | `Sentry-Hook-Resource == "comment"` + `action == "created"` |
| Comment edited | Webhook | `action == "updated"` |
| Comment deleted | Webhook | `action == "deleted"` |
| Assignee changed | Webhook | `action == "assigned"` |
| Escalation | Webhook | `data.issue.substatus == "escalating"` |
| Regression | Webhook | `data.issue.substatus == "regressed"` |
| High priority | Polling | `priority:high` in search |
| Tag value | Polling | `tag:{key}:{value}` in search |
| Assigned to bot | Webhook | `data.issue.assigned_to` matches bot user |

---

## 7. Identity Mapping

### User ID Shape

- Numeric string: `"12345"` (assigned by Sentry, stable within org)
- User identifiers in API: `id`, `email`, `username`, `name`

### Resolving User → Email / External ID

```
GET /api/0/organizations/{org}/users/
```

**Scope**: `org:read`

Returns all org members with their `id`, `email`, `username`, `name`. Cache this list.

**Mapping strategy**:
1. Maintain a local cache of `{sentry_user_id: {email, name, username}}` per tenant.
2. Refresh on initial sync and periodically (e.g., daily).
3. For incoming webhook actors: if `actor.type == "user"`, the `actor.id` is the numeric user ID.

### Bot Identity (no_self_retrigger)

This is critical for SupportAgent's `no_self_retrigger` invariant.

- On **issue events** (created, resolved, etc.): `actor.type` indicates who triggered it. If `actor.type == "application"` and `actor.name` matches SupportAgent's integration name, the event was triggered by SupportAgent itself (e.g., when SupportAgent resolves an issue).
- On **comments**: When SupportAgent posts a comment, Sentry records `user` as the integration's bot user (the user associated with the Internal Integration's token). The returned comment object has `user.id` and `user.email`.
- **Strategy**: After posting a comment, persist the returned `user.id` as the "bot user ID". When receiving a `comment.created` webhook, if `data.actor.id == bot_user_id`, skip processing (self-retrigger).

### Author Field on Posted Comments

When SupportAgent posts a comment via `POST /api/0/issues/{issue_id}/comments/`, the response includes:
```json
{
  "user": {
    "id": "12345",
    "username": "supportagent-integration",
    "email": "supportagent@your-tenant.com"
  }
}
```
SupportAgent should persist this `user.id` as its identity within this tenant's Sentry org.

---

## 8. Rate Limits

- **Style**: Fixed-window per-endpoint. Each endpoint has its own limit.
- **Communication**: Response headers on every API response:
  - `X-Sentry-Rate-Limit-Limit`: max requests in window
  - `X-Sentry-Rate-Limit-Remaining`: requests left
  - `X-Sentry-Rate-Limit-Reset`: Unix timestamp when window resets
  - `X-Sentry-Rate-Limit-ConcurrentLimit`: max concurrent requests
  - `X-Sentry-Rate-Limit-ConcurrentRemaining`: concurrent requests left

**Representative limits** (cloud, may vary by plan):

| Endpoint Category | Approximate Limit |
|---|---|
| Issues (GET list) | 1000/min |
| Issues (POST/PUT) | 100/min |
| Events (GET) | 500/min |
| Comments (POST) | 60/min |
| Comments (PUT/DELETE) | 30/min |
| Projects (GET) | 100/min |

**Plan tiers** (sentry.io):
- **Developer**: 50k events/mo, limited API rate
- **Team**: 500k events/mo, higher rate limits
- **Business**: 5M events/mo, higher rate limits
- **Enterprise**: Negotiated, highest limits

**Retry strategy**: On 429 response, respect the `Retry-After` header if present (Sentry does include it on 429). Otherwise, back off exponentially starting at 1s, max 5 retries.

**Gotcha**: Sentry rate limits by **token identity**, not by endpoint. A single slow tenant can exhaust its token's rate limit and affect all SupportAgent operations for that tenant. Isolate by giving each tenant its own token.

---

## 9. Pagination & Search

### Pagination Style

**Cursor-based** on all list endpoints.

- **Parameter**: `cursor`
- **Format**: `{timestamp},{shard},{shardIndex}` — opaque string from `Link` header
- **Link header** (RFC 5988):
  ```
  Link: <https://sentry.io/api/0/...?cursor=abc>; rel="previous"; results="false",
        <https://sentry.io/api/0/...?cursor=def>; rel="next"; results="true"
  ```
- **Page size**: Controlled by `?limit={n}` (default varies, typically 25–100). Max `limit` is 100 on most endpoints.
- **Pattern**: Fetch next page while `rel="next"` is present and `results="true"`.

### Max Page Size

- Most endpoints: 100
- `GET /api/0/organizations/{org}/issues/`: max 100
- `GET /api/0/issues/{issue_id}/events/`: max 100

### Search / Filter Endpoints

Primary search: `GET /api/0/organizations/{org}/issues/` with `query` parameter.

**Search syntax** (Sentry structured search):
```
is:unresolved
is:resolved
is:ignored
tag:environment:production
tag:level:error
release:latest
user.id:{id}
user.email:{email}
assigned_to:{user}
assigned_to:team:{team}
project:{project_slug}
issue.type:error
error.type:{error_type}
error.handled:false
transaction:{transaction_name}
```

**Boolean operators**: `AND`, `OR`, parentheses. Example:
```
is:unresolved AND tag:environment:production AND (level:error OR level:fatal)
```

---

## 10. Known Gotchas

### 10a. Cloud vs. Self-Hosted Parity

- Integration Platform (webhooks + internal integrations) is **available on self-hosted** since Sentry 21.x (released ~2021). Before that, self-hosted had a different webhook system.
- Self-hosted users may be on older versions (20.x or earlier) that lack webhook integration. Check tenant's version during onboarding.
- Self-hosted has **no built-in rate limit enforcement** in some versions; implement defensive backoff.

### 10b. Webhook Eventual Consistency

- Sentry webhooks are **delivered after** the event is processed internally. There is a small delay (typically <1s, but can be minutes during high load).
- During reconciliation, use the polling API with `statsPeriod=1h` as the source of truth for issue state. Webhook events are for real-time alerting, polling is for consistency.

### 10c. Webhook Retries Without Deduplication

- Sentry retries failed webhook deliveries but does **not** deduplicate. The same event can arrive 2-7 times.
- SupportAgent must handle idempotency. Key: `(issue_id, action, timestamp)` from the webhook `data` block.
- Store processed webhook IDs in a dedup table with a TTL (e.g., 1 hour).

### 10d. Substatus vs. Status

- Older Sentry instances use only `status` (resolved/unresolved/ignored). Substatus was introduced ~2023.
- Always check for `substatus` in responses; fall back to `status` if absent.
- The webhook issue payload does not include all issue fields — use `GET /api/0/issues/{issue_id}/` to fetch full details after a webhook event.

### 10e. Webhook Missing Fields

- Issue webhook `data.issue` contains: `id`, `url`, `web_url`, `project_url`, `status`, `substatus`, `issueType`, `issueCategory`.
- **Missing from webhook**: `title`, `culprit`, `shortId`, `assignee`, `tags`, `priority`, `annotations`, `count`, `user`.
- **Workaround**: After receiving an issue webhook, do `GET /api/0/issues/{issue_id}/` to fetch full details.

### 10f. User ID in Webhook Actors

- `actor.id` in webhook payloads is a numeric string.
- For bot users (Internal Integration), `actor.type == "application"` and `actor.name` is the integration name.
- For human users, `actor.type == "user"` and `actor.id` is the Sentry user ID.
- **Email is never in webhook actor** — must resolve via `GET /api/0/organizations/{org}/users/`.

### 10g. Comment Body Encoding

- Comment bodies are plain text. Sentry does not support Markdown rendering in comments via API (only in the UI's "Activity" feed). Use plain text.
- Comments on Issues appear in the Issue's "Activity" section.

### 10h. Multi-Project / Multi-Org

- **One Sentry org per tenant**: Each tenant maps to one Sentry organization. SupportAgent does not need to handle cross-org scenarios.
- If a tenant uses multiple Sentry orgs, SupportAgent needs one Internal Integration + token per org. Treat as multiple tenant configurations.

### 10i. API Deprecation

- `GET /api/0/projects/{org}/{project}/issues/` is **deprecated** (2024). Use `GET /api/0/organizations/{org}/issues/?project={project_id}` instead.
- `event:admin` scope required for DELETE operations (deleting issues). This is a sensitive scope.

### 10j. Internal Integration Scopes Are Org-Wide

- When you create an Internal Integration and set its scopes, those scopes apply to **all projects** in the org.
- There is no per-project scope granularity for Internal Integration tokens.

---

## 11. Recommended SupportAgent Connector Scope

### MVP (minimum to be useful)

**Endpoints to wrap**:
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/0/organizations/{org}/issues/` | List/search issues |
| `GET` | `/api/0/issues/{issue_id}/` | Fetch issue details |
| `POST` | `/api/0/issues/{issue_id}/comments/` | Post triage comment |
| `PUT` | `/api/0/organizations/{org}/issues/{issue_id}/` | Update status, assignee, priority |
| `GET` | `/api/0/organizations/{org}/projects/` | List projects (for onboarding) |
| `GET` | `/api/0/organizations/{org}/users/` | Map user IDs to emails (for notifications) |

**Webhook events to handle**:
| Resource Header | Actions |
|---|---|
| `issue` | `created`, `resolved`, `archived`, `unresolved` |
| `comment` | `created`, `updated`, `deleted` |
| `installation` | `created` (for onboarding) |

**Webhook events to ignore** (MVP): `error`, `event_alert`, `metric_alert`, `seer`, `preprod_artifact`

**Trigger matchers to enable in MVP**:
- `issue.status` transition (unresolved → resolved → unresolved)
- `issue.action` (created, assigned)
- `issue.tag.{key}` value matches
- `issue.priority` equals
- `comment.body` regex match

**Minimum admin panel config fields**:
```
sentry.organizationSlug     # org slug from sentry.io URL
sentry.authToken             # Internal Integration token
sentry.clientSecret          # Webhook HMAC secret
sentry.region                # "us" | "de" (cloud only; omit for self-hosted)
sentry.selfHostedUrl         # base URL for self-hosted (omit for cloud)
```

### Phase 2 (parity with GitHub connector)

- Full tag CRUD (`POST /api/0/issues/{issue_id}/tags/{key}/`)
- `issue.assigned` webhook handler with assignee lookup
- Escalation / regression substatus tracking
- Bulk issue operations via `PUT /api/0/organizations/{org}/issues/` (batch)
- Periodic polling reconciliation job (fallback + dedup verification)
- `GET /api/0/issues/{issue_id}/events/` — fetch latest crash stack trace for triage context

### Phase 3 (advanced)

- Spike protection / rate limit advisory from Sentry quota headers
- Sentry Release tracking integration (relate issues to deploys)
- Performance issue support (`issueCategory: performance`)
- Sentry AI autocomplete (Seer) — `seer` webhook resource
- Multi-integration per tenant (if tenant has multiple Sentry orgs)

---

## 12. Dependencies

### Official SDK

- **npm package**: `@sentry/api` (https://github.com/getsentry/sentry-javascript/tree/develop/packages/api)
  - The official REST API client for Node.js/browser.
  - Wraps all `/api/0/` endpoints with typed interfaces.
  - Does **not** include webhook handling (that's the Integration Platform, not the SDK).
- **Alternative**: Raw `fetch` / `undici` — fine for the thin HTTP surface needed here. The `@sentry/api` package adds ~50KB; raw fetch is simpler for a connector.

**Recommendation**: Use raw `fetch` (or `undici`). The Sentry API is straightforward REST. The `@sentry/api` package is primarily used by the Sentry SDK itself for things like source map uploads and session tracking — not ideal for a connector. It also has a different mental model (SDK-internal event pipeline) vs. (external integration REST API).

### No CLI Equivalent

Unlike GitHub's `gh` CLI, Sentry has no equivalent CLI for external integrations. The Integration Platform is webhooks + REST only.

### Webhook Signature Library

Standard `crypto.createHmac('sha256', secret)` from Node.js built-ins. No external package needed.

---

## 13. Open Questions

1. **Cloud vs. self-hosted per tenant**: Do any SupportAgent tenants use self-hosted Sentry? If so, what version? (Webhooks on self-hosted require Sentry 21.x+.)
2. **Multi-org tenants**: Can a single tenant have multiple Sentry organizations? If so, need one connector instance per org.
3. **Sentry version detection**: For self-hosted tenants, how does SupportAgent detect the Sentry version during onboarding? Is the `/api/0/` endpoint stable across versions?
4. **Priority field availability**: Do all target tenants have Sentry 23.x+ (when priority was introduced)? Older versions may return `priority: null`.
5. **Comment threading**: Sentry comments are flat (no reply threads). Is threaded discussion required, or is flat activity sufficient?
6. **Rate limit monitoring**: Should SupportAgent surface rate limit exhaustion to tenants, or silently backoff?
7. **Tenant user provisioning**: Will SupportAgent need to create Sentry users (for assigning issues), or only map existing users?
8. **Outbound-only flow**: Per prior decision, Sentry is inbound-only for SupportAgent (outbound routes to Linear/GitHub). Confirm: do we need SupportAgent to post comments back to Sentry at all, or only read Sentry issues and push triage results to other platforms?

---

## Appendix: Key API Reference

### Base URLs

- Cloud US: `https://sentry.io/api/0/`
- Cloud EU: `https://de.sentry.io/api/0/`
- Self-hosted: `{host}/api/0/`

### Core Endpoints Summary

```
GET    /api/0/organizations/{org}/issues/          event:read    List issues (search query)
GET    /api/0/issues/{issue_id}/                   event:read    Issue details
PUT    /api/0/organizations/{org}/issues/{id}/     event:write   Update issue (status, assignee, priority)
DELETE /api/0/issues/{issue_id}/                   event:admin    Delete issue
GET    /api/0/issues/{issue_id}/events/            event:read    List events in issue
POST   /api/0/issues/{issue_id}/comments/          event:write   Create comment
PUT    /api/0/issues/{issue_id}/comments/{cid}/    event:write   Edit comment
DELETE /api/0/issues/{issue_id}/comments/{cid}/    event:write   Delete comment
GET    /api/0/issues/{issue_id}/tags/              event:read    List tags on issue
POST   /api/0/issues/{issue_id}/tags/{key}/        event:write   Set tag value
GET    /api/0/organizations/{org}/projects/        org:read      List projects
GET    /api/0/organizations/{org}/users/            org:read      List org members
```

### Webhook Headers

```
Content-Type: application/json
Sentry-Hook-Resource: issue|comment|error|installation|...
Sentry-Hook-Timestamp: 1713440400
Sentry-Hook-Signature: <hmac_sha256_hex>
```
