# GitLab Connector Design

## 1. Overview

- **Category:** version-control / issue-tracker
- **Cloud vs self-hosted:** Both. GitLab.com (SaaS) and GitLab Self-Managed (CE/EE/Dedicated) share the same REST API surface. Self-managed supports additional admin endpoints and local config options.
- **Official API reference:** https://docs.gitlab.com/ee/api/rest/index.html
- **Key surfaces:** Issues, Merge Requests (MRs), Notes/Discussions, Labels, Milestones, Project/Group Members

> **Work Items vs Issues:** GitLab migrated issues to a unified Work Items framework (GA in 18.7). Issues are now work items with type `issue`. Both the legacy Issues API (`/api/v4/issues`) and the new Work Items API (`/api/v4/work_items`) are available. The connector should use the Issues API for broadest compatibility (Free tier), with Work Items API as an upgrade path for Premium/Ultimate tenants.

---

## 2. Authentication

### 2.1 Personal Access Token (PAT) — **Recommended for MVP**

- **How to obtain:** User visits Edit profile → Access → Personal access tokens → Create token with scopes. Also available via `/user_settings/personal_access_tokens` API.
- **Header:** `PRIVATE-TOKEN: <token>`
- **Alternative header (rare):** `Authorization: Bearer <token>` (only if token type is `Bearer`)
- **Scopes needed:**

| Operation | Scope |
|---|---|
| Read issues, MRs, comments | `read_api` |
| Create/update issues, MRs, comments | `api` |
| Register webhooks | `api` |
| Read projects/members | `read_api` |

- **Lifetime:** 365 days default, configurable by admin. Service account tokens can be set to never expire. GitLab 16.0+: new tokens must have an expiry.
- **Bot identity:** Create a dedicated service account (not a personal account). Service accounts can have non-expiring PATs if enabled by group owner or admin.

### 2.2 OAuth2 Application

- **How to obtain:** User registers an application at `/user_settings/applications`. Receives `application_id` and `client_secret`.
- **Recommended flow:** Authorization code with PKCE (most secure).
- **Scopes:** Same as PAT scopes. Pass as array during authorization.
- **Token response:**
  ```json
  {
    "access_token": "...",
    "token_type": "bearer",
    "expires_in": 7200,
    "refresh_token": "...",
    "created_at": 1607635748
  }
  ```
- **Lifetime:** Access token expires in 2 hours. Refresh token invalidates the old pair and issues new ones.
- **For multi-tenant:** Each tenant must register their own OAuth application and provide `client_id` + `client_secret`. No workaround — GitLab doesn't support cross-tenant OAuth delegation.

### 2.3 GitLab Agent for Kubernetes (`k8s_proxy` scope)

Not applicable for this connector.

### 2.4 Webhook Secret Token

- **Mechanism:** Shared secret, not HMAC-signed. GitLab sends the secret verbatim in the `X-Gitlab-Token` request header.
- **Provisioning:** Set during webhook creation via UI or API. No out-of-band provisioning — the secret is set once and GitLab echoes it on every delivery.
- **Verification:** Your endpoint receives `X-Gitlab-Token: <secret>` and must compare it against the stored secret.
- **Recommendation:** Use this for webhook verification. Store the secret per webhook registration.

### 2.5 Token Type Summary

| Token Type | Lifetime | Multi-tenant UX | Recommendation |
|---|---|---|---|
| PAT (personal account) | 365 days default | Per-user, not team-shared | MVP only (simple setup) |
| PAT (service account) | Never expire (if enabled) | Team-owned bot account | MVP+ (preferred) |
| OAuth2 access token | 2 hours | Per-tenant OAuth app required | Phase 2+ |
| Project/Group access token | Admin-configurable | Per-project/group | Not recommended |

**MVP Recommendation:** PAT on a dedicated service account (bot user). No OAuth complexity. Rotate manually or via `self_rotate` scope.

---

## 3. Inbound — Events and Intake

### 3.1 Webhook Support: Yes

GitLab webhooks are configured per-project. For group-level events (epics, group milestones), configure on the group.

#### Event Types (`X-Gitlab-Event` header values)

| Header Value | `object_kind` | Actions | SupportAgent relevance |
|---|---|---|---|
| `Issue Hook` | `issue` | `open`, `close`, `reopen`, `update` | **Primary** — inbound issues |
| `Merge Request Hook` | `merge_request` | `open`, `close`, `reopen`, `update`, `merge`, `approval`, `approved`, `unapproval`, `unapproved` | **Primary** — inbound MRs |
| `Note Hook` | `note` | `create`, `update` | **Primary** — comments on issues/MRs/commits/snippets |
| `Pipeline Hook` | `pipeline` | status changes | Optional — build status |
| `Member Hook` | (group/project member events) | `user_add_to_group`, `user_update_for_group`, `user_remove_from_group`, etc. | Optional |
| `Milestone Hook` | `milestone` | `create`, `close`, `reopen` | Optional |
| `Release Hook` | `release` | `create`, `update`, `delete` | Optional |
| `Push Hook` | `push`, `tag_push` | — | Not needed |
| `Wiki Page Hook` | `wiki_page` | — | Not needed |
| `Job Hook` | `build` | — | Not needed |
| `Deployment Hook` | `deployment` | — | Not needed |
| `Emoji Hook` | `emoji` | `award`, `revoke` | Not needed |

#### Webhook Registration

```
POST /projects/:id/integrations/webhooks
```

Fields: `url`, `secret_token` (the shared secret), `enable_ssl_verification`, and `push_events`, `issues_events`, `merge_requests_events`, `note_events`, `pipeline_events`, etc. (boolean toggles per event type).

### 3.2 Signature Verification

**No HMAC.** GitLab uses a shared secret transmitted via `X-Gitlab-Token`. There is no cryptographic verification — just a string comparison.

```
# Your webhook handler
if (request.headers['X-Gitlab-Token'] !== storedSecret) {
  return 401;
}
```

### 3.3 Retry / Delivery Semantics

- GitLab retries with **exponential backoff** on non-2xx responses. After 40 consecutive failures, the webhook is **permanently disabled** and requires manual re-enabling.
- Webhook is re-enabled by a successful delivery (2xx response).
- **Idempotency:** GitLab sends an `Idempotency-Key` header with each delivery attempt. Store and deduplicate by this key.
- Webhooks can be tested via the UI or `POST /projects/:id/integrations/webhooks/test`.

### 3.4 Polling Fallback

Use `updated_after` / `updated_before` with `order_by: updated_at` for efficient cursor-based polling:

```
GET /projects/:id/issues?updated_after=2026-04-18T00:00:00Z&updated_before=2026-04-18T12:00:00Z&order_by=updated_at&sort=desc&per_page=100
GET /projects/:id/merge_requests?updated_after=...&order_by=updated_at&sort=desc&per_page=100
GET /projects/:id/issues/:iid/notes?updated_after=...&order_by=updated_at&sort=desc&per_page=100
GET /projects/:id/merge_requests/:iid/notes?updated_after=...&order_by=updated_at&sort=desc&per_page=100
```

Also useful: `GET /issues?state=opened&updated_after=...` (global across projects).

### 3.5 Payload Fields to Persist

**Issue/MR (from `objectAttributes`):**
```
id, iid, project_id, title, description, state, labels[], created_at, updated_at, closed_at,
web_url, references{relative, full}, confidential, due_date
```

**Issue-specific additional:**
```
milestone{id, title, due_date}, assignees[{id, username, name, avatar_url}],
author{id, username, name, avatar_url}, weight (Premium+), epic_id (Premium+),
health_status (Ultimate), iteration_id (Premium+)
```

**MR-specific additional:**
```
source_branch, target_branch, merge_status, detailed_merge_status,
assignees[], reviewers[], sha, merge_commit_sha, draft,
changes_count, head_pipeline{id, status}, blocking_discussions_resolved
```

**Comment/Note (from `Note Hook` payload `objectAttributes`):**
```
id, noteable_type (Issue|MergeRequest|Commit|Snippet), noteable_id,
body, author{id, username, name, email, avatar_url}, created_at, updated_at,
project_id, system (true for bot/system notes)
```

**Webhook envelope fields (persist for routing):**
```
object_kind, user{id, username, name, avatar_url}, project{id, name, path_with_namespace, web_url},
group (for group webhooks)
```

---

## 4. Outbound — Writing Back

### 4.1 Create Issue

```
POST /projects/:id/issues
```

| Param | Type | Notes |
|---|---|---|
| `title` | string | **Required** |
| `description` | string | Markdown supported |
| `labels` | string | Comma-separated: `"bug,needs-triage"` |
| `assignee_ids` | integer[] | |
| `milestone_id` | integer | |
| `due_date` | string | `YYYY-MM-DD` |
| `confidential` | boolean | |
| `created_at` | string | ISO 8601 (requires maintainer+ role) |
| `iid` | integer | Assign specific IID (requires admin) |

### 4.2 Create Merge Request

```
POST /projects/:id/merge_requests
```

| Param | Type | Notes |
|---|---|---|
| `source_branch` | string | **Required** |
| `target_branch` | string | **Required** |
| `title` | string | **Required** |
| `description` | string | Markdown |
| `labels` | string | Comma-separated |
| `assignee_ids` | integer[] | |
| `reviewer_ids` | integer[] | |
| `milestone_id` | integer | |
| `squash` | boolean | |
| `remove_source_branch` | boolean | |

### 4.3 Post Comment / Note on Issue

```
POST /projects/:id/issues/:issue_iid/notes
```

| Param | Type | Notes |
|---|---|---|
| `body` | string | **Required**, max 1,000,000 chars |
| `created_at` | string | ISO 8601 (requires admin/owner) |

**Response:** Note object with `id`, `body`, `author`, `created_at`, `updated_at`, `system`, `noteable_type`, `noteable_id`, `project_id`.

### 4.4 Post Comment / Note on MR

```
POST /projects/:id/merge_requests/:merge_request_iid/notes
```

| Param | Type | Notes |
|---|---|---|
| `body` | string | **Required** |
| `internal` | boolean | Internal note (hidden from external users) |
| `merge_request_diff_head_sha` | string | For merge quick action validation |

### 4.5 Edit Comment

```
PUT /projects/:id/issues/:issue_iid/notes/:note_id
PUT /projects/:id/merge_requests/:merge_request_iid/notes/:note_id
```

| Param | Type | Notes |
|---|---|---|
| `body` | string | **Required** |

### 4.6 Delete Comment

```
DELETE /projects/:id/issues/:issue_iid/notes/:note_id
DELETE /projects/:id/merge_requests/:merge_request_iid/notes/:note_id
```

### 4.7 Change Status (Close/Reopen Issue or MR)

```
PUT /projects/:id/issues/:issue_iid
PUT /projects/:id/merge_requests/:merge_request_iid
```

| Param | Value | Notes |
|---|---|---|
| `state_event` | `close` \| `reopen` | |
| `add_labels` | string | Comma-separated, add-only |
| `remove_labels` | string | Comma-separated, remove-only |
| `labels` | string | Set all labels (empty string = remove all) |

### 4.8 Add / Remove Labels

Via issue/MR update:
```
PUT /projects/:id/issues/:issue_iid
```
- `add_labels`: comma-separated labels to add
- `remove_labels`: comma-separated labels to remove
- `labels`: full replacement (empty string clears all)

Via dedicated labels API:
```
POST   /projects/:id/labels         # create label
PUT    /projects/:id/labels/:label_id  # update (name, color, description, priority)
DELETE /projects/:id/labels/:label_id # delete
```

### 4.9 Set Assignee / Reviewer

```
PUT /projects/:id/issues/:issue_iid
PUT /projects/:id/merge_requests/:merge_request_iid
```

| Param | Type | Notes |
|---|---|---|
| `assignee_ids` | integer[] | Set to `0` or empty array to unassign |
| `reviewer_ids` | integer[] | MRs only, set to `0` or empty to unset |

### 4.10 Set Milestone

```
PUT /projects/:id/issues/:issue_iid
PUT /projects/:id/merge_requests/:merge_request_iid
```

| Param | Type | Notes |
|---|---|---|
| `milestone_id` | integer | Set to `0` to unassign |

### 4.11 Mention User

Use `@username` in Markdown body (GitLab auto-resolves mentions on render). No special API call needed.

For `@-mentioning a user in a specific context:** Mention syntax is just inline Markdown — no special header, no resolve step.

### 4.12 Close / Resolve MR

Via update endpoint with `state_event`:
```
PUT /projects/:id/merge_requests/:merge_request_iid
body: { state_event: "close" }
```

To merge (if needed):
```
PUT /projects/:id/merge_requests/:merge_request_iid/merge
```
Params: `squash`, `squash_commit_message`, `merge_commit_message`, `should_remove_source_branch`.

### 4.13 Set Priority / Severity

GitLab doesn't have built-in priority/severity fields. Implement via **Labels**:
- Create labels like `priority::critical`, `severity::high`, `priority::low`
- Filter by label pattern (`labels=~priority::critical`)

Premium+ has `weight` field:
```
PUT /projects/:id/issues/:issue_iid
body: { weight: 5 }
```

Premium+ has `health_status`: `on_track`, `at_risk`, `needs_attention`.

### 4.14 Attach File / Screenshot

GitLab doesn't support file uploads via REST API for issue descriptions. Workarounds:
1. Upload to container registry or generic package registry: `POST /projects/:id/uploads`
2. Return an upload URL in the response: `full_path`, `url`, `alt`
3. Reference uploaded file in Markdown: `![alt text](/uploads/...)`

Direct image in note body: same upload approach.

### 4.15 Threaded Discussions (Two-Way Comment Sync)

If the GitHub connector supports threaded review comments, GitLab's equivalent is the **Discussions API**:

**Create a threaded discussion (with initial note):**
```
POST /projects/:id/issues/:issue_iid/discussions
body: { body: "comment text", position?: diff position }
```

**Add reply to existing thread:**
```
POST /projects/:id/issues/:issue_iid/discussions/:discussion_id/notes
```

**Resolve/unresolve thread:**
```
PUT /projects/:id/issues/:issue_iid/discussions/:discussion_id
body: { resolved: true }
```

> **Note vs Discussion:** The Notes API returns root-level comments only. The Discussions API returns threads (parent + replies). **Important:** "Items of type DiscussionNote are not returned as part of the Note API." For full comment sync, use Discussions API.

Same pattern for MRs: `/projects/:id/merge_requests/:iid/discussions`.

---

## 5. Labels, Flags, Fields, Priorities

### 5.1 Label Model

- Labels are **per-project** (no global labels without promoting to group). Group labels can be promoted.
- **Fields:** `id`, `name`, `color` (hex), `description`, `description_html`, `priority` (integer ≥0), `open_issues_count`, `closed_issues_count`, `subscribed`, `is_project_label`, `archived`
- **Listing:** `GET /projects/:id/labels`
- Labels can be promoted to group labels: `PUT /projects/:id/labels/:label_id/promote`

### 5.2 Priority / Severity

No built-in priority or severity. Implement via:
- **Labels:** `priority::critical`, `severity::p1`, `priority::high/low/medium`
- **Weight (Premium+):** Integer 0–100. Query with `GET /issues?weight=5`
- **Health status (Ultimate):** `on_track`, `at_risk`, `needs_attention`

### 5.3 Status Model

Status is the `state` field: `opened`, `closed`, `locked` (MRs only), `merged` (MRs only).

Transitions are controlled by `state_event` on update:
- Issue: `opened` ↔ `closed` (via `state_event: "close"` or `"reopen"`)
- MR: `opened` → `closed`, `reopened`, `merged`

No workflow-defined states (unlike Jira). All status is binary-open/closed.

### 5.4 Custom Fields

**No custom field API.** GitLab does not expose per-project custom fields via REST API. The only structured metadata is:
- `labels` (free-form, string tags)
- `weight` (Premium+)
- `milestone`
- `due_date`
- `health_status` (Ultimate)
- `iteration` (Premium+)
- `epic` (Premium+)

If a tenant needs structured custom fields, they must use labels as a workaround or the GraphQL API (which exposes custom attributes via `customAttributes`).

### 5.5 Listing Available Options

```
GET /projects/:id/labels?per_page=100
GET /projects/:id/milestones?per_page=100
GET /projects/:id/members/all  # for assignee/reviewer resolution
```

---

## 6. Triggers We Can Match On

From webhook payloads (`objectAttributes`, `changes`, `labels`, `assignees`):

| Trigger | Source field | Example |
|---|---|---|
| **Label added** | `changes.labels.previous[]` / `changes.labels.current[]` diff | `"needs-triage"` in added |
| **Label removed** | same diff | `"needs-triage"` in removed |
| **Label set** | `objectAttributes.labels[]` on issue/MR | Match exact label names |
| **Status → closed** | `objectAttributes.action === "close"` | Issue closed |
| **Status → reopened** | `objectAttributes.action === "reopen"` | Issue reopened |
| **Status → merged** | `objectAttributes.action === "merge"` | MR merged |
| **MR approved** | `objectAttributes.action === "approved"` | MR approved |
| **Mention of bot user** | `objectAttributes.body` text scan for `@bot-username` | Bot mentioned |
| **Comment body regex** | `objectAttributes.body` (Note Hook payload) | `/(?i)build failed/` |
| **Assignee change** | `changes.assignees` with `previous`/`current` | Assigned to specific user |
| **Reviewer change** | `changes.reviewers` | Reviewer added/removed |
| **New comment** | `object_kind === "note"` + `objectAttributes.action === "create"` | Any new comment |
| **Project scope** | `project.id` or `project.path_with_namespace` | Tenant isolation |
| **Milestone set** | `changes.milestone` | |
| **Weight set (Premium+)** | `changes.weight` | |
| **Health status (Ultimate)** | `changes.health_status` | |

**Filtering with API params (for reconciliation):**
```
GET /projects/:id/issues?labels=needs-triage&state=opened
GET /projects/:id/issues?assignee_id=123
GET /projects/:id/issues?milestone=Release%20v2.1
GET /projects/:id/issues?search=bug&in=title,description
```

---

## 7. Identity Mapping

### 7.1 User ID Shape

Integer global ID: `12345678`. GitLab uses `id` for global uniqueness, `iid` for project-level (issues/MRs), `username` for handles.

### 7.2 Resolve User → Email or Stable External ID

```
GET /users/:id
```
Returns: `{ id, username, name, state, avatar_url, web_url, created_at }`

**No email in response.** Email is only exposed in some contexts and only for users with public email set. For email resolution:
1. If the user has set a public email in GitLab profile, it's visible in `GET /users/:id`
2. Otherwise, email is not accessible via API (privacy protection)

**Stable external ID:** Use `username` (string, stable handle) or `id` (integer). Prefer `id` for internal routing; expose `username` in UI.

### 7.3 Bot Identity — `no_self_retrigger`

The bot identifies itself the same way as any other user — by `author.id` and `author.username` on webhook payloads and API responses.

**Detecting self:**
- The connector stores the bot user's `id` and `username`
- On webhook delivery: `payload.user.username === botUsername || payload.user.id === botId`
- On notes API response: `note.author.username === botUsername`

**Webhook events from our own writes:**
- GitLab sends webhook events for actions initiated by any user, including our bot account.
- Use `objectAttributes.system === true` on note payloads to filter system notes (bot notes have this flag when created via certain actions; note: not all bot notes are marked `system: true`).
- The `system` field on notes is `true` for system-generated notes (e.g., "MR was merged"), but notes posted by our PAT as a regular user are NOT marked `system: true`.

**Best practice for no_self_retrigger:**
1. Store bot's global `userId` and `username`
2. On every inbound event, check `payload.user.id === botId` or `payload.user.username === botUsername`
3. Additionally track `objectAttributes.system === true` where applicable
4. For notes, check `author.id === botId`

### 7.4 Author Field on Comments We Post

When we post a comment via `POST /projects/:id/issues/:iid/notes`, the response includes:
```json
{
  "id": 123,
  "body": "Our reply...",
  "author": {
    "id": 987,
    "username": "support-agent",
    "name": "Support Agent",
    "state": "active",
    "avatar_url": "...",
    "web_url": "..."
  },
  "created_at": "2026-04-18T10:00:00Z",
  "project_id": 456,
  "noteable_type": "Issue",
  "noteable_id": 789
}
```

Persist `author.id` to match our bot identity.

---

## 8. Rate Limits

### 8.1 GitLab.com Limits

| Scope | Limit |
|---|---|
| Authenticated API requests | **2,000 req/min** |
| Authenticated non-API HTTP | **1,000 req/min** |
| All traffic from single IP | **2,000 req/min** |
| Issue creation | **200 req/min** |
| Notes (comments) on issues/MRs | **60 req/min** ← **critical for our use case** |
| Pipeline creation | **25 req/min** |
| Search API | **10 req/min per IP** |
| `project/:id/jobs` | **600 req/min per authenticated user** |
| Groups list | **200 req/min** |
| Users list | **200 req/min** |
| Package registry | **3,000 req/min per IP** |
| Alert integration | **3,600 req/hour per project** |
| Protected paths (`/users/password`) | **10 req/min per IP** |

### 8.2 Rate Limit Headers

**Header names:** `RateLimit-*` (not `XRateLimit-*`)

| Header | Meaning |
|---|---|
| `RateLimit-Limit` | Ceiling for this throttle |
| `RateLimit-Name` | Throttle name (e.g., `throttle_authenticated_api`) |
| `RateLimit-Observed` | Requests in current window |
| `RateLimit-Remaining` | Remaining in window |
| `RateLimit-Reset` | Unix timestamp of window reset |
| `Retry-After` | Seconds to wait (only on 429) |

**429 response body:** Plain text `Retry later`.

### 8.3 Gotcha: Some Endpoints Don't Return Headers

> "Rate limiting responses for the Projects, Groups, and Users APIs do not include informational headers." These endpoints silently return 429 without `RateLimit-*` headers — you won't see the reset time.

### 8.4 Gotcha: Two Independent Rate Limit Systems

GitLab has two independent systems: `Rack::Attack` (network-layer) and application-level throttles. Hitting one does not consume from the other.

### 8.5 Gotcha: Notes Rate Limit is Very Low

**60 notes/min** is the per-user limit. If the connector processes multiple tenants from one token, this is a bottleneck. Mitigations:
- Use one PAT per tenant (preferred for isolation anyway)
- Implement per-tenant rate tracking with backoff
- Use bulk operations where possible

### 8.6 Gotcha: Git Operations Exhaust Auth Rate Limit First

HTTPS Git operations to private repos attempt unauthenticated first, burning the unauthenticated rate limit (500/min) before the PAT is tried. Not relevant for API-only connectors, but worth knowing for debugging.

### 8.7 Bulk / Batch Endpoints

- **GraphQL API** — multiplex multiple queries into one request. Query complexity limit: 200 (unauthenticated), 250 (authenticated). Max query size: 10,000 chars. Request timeout: 30s.
- **REST with `per_page=100`** — reduce round-trips for list endpoints
- **`statistics=true`, `simple=true`** — reduce response payload size
- **Keyset pagination** — more efficient than offset for large datasets (commits, container registry listing)

---

## 9. Pagination & Search

### 9.1 Pagination Styles

| Style | Parameter | Notes |
|---|---|---|
| **Offset (default)** | `page`, `per_page` | Max 100 per page, default 20 |
| **Keyset (recommended)** | `pagination=keyset`, `order_by`, `sort` | More efficient for large datasets |

### 9.2 Max Page Size

**100 records per page** (enforced). Default is 20. Use `per_page=100` to maximize throughput.

### 9.3 Search / Filter Endpoints

| Endpoint | Use case |
|---|---|
| `GET /issues?search=...&in=title,description` | Full-text search |
| `GET /merge_requests?search=...&in=title,description` | MR search |
| `GET /projects/:id/issues?labels=bug` | Filter by label |
| `GET /projects/:id/issues?assignee_id=123&state=opened` | Filter by assignee + state |
| `GET /projects/:id/issues?milestone=Release%20v2.1` | Filter by milestone |
| `GET /projects/:id/issues?created_after=...&updated_after=...` | Time-based cursor |
| `GET /groups/:id/issues` | Group-level search (Premium+) |

### 9.4 Performance Gotcha

> For queries returning more than 10,000 records, GitLab does NOT return `x-total`, `x-total-pages`, or `rel="last"` link headers. Use keyset pagination instead.

---

## 10. Known Gotchas

### 10.1 Tier Restrictions

| Feature | Free | Premium | Ultimate | API availability |
|---|---|---|---|---|
| Basic Issues / Tasks | Yes | Yes | Yes | Both APIs |
| Incident work items | No | Yes | Yes | Work Items API |
| Test case work items | No | Yes | Yes | Work Items API |
| Epics | No | Yes | Yes | `/groups/:id/epics` |
| Epic notes | No | Yes | Yes | |
| Group Iterations | No | Yes | Yes | `/groups/:id/iterations` |
| Issue weight | No | Yes | Yes | `weight` field |
| Health status | No | No | Yes | `health_status` field |
| Objectives & Key Results | No | No | Yes | Work Items API |
| Requirements management | No | No | Yes | `/projects/:id/requirements` |
| Multiple assignees | Yes | Yes | Yes | `assignee_ids[]` |

### 10.2 GitLab.com vs Self-Managed Differences

- **Rate limits:** Self-managed admins configure limits (default: very permissive). GitLab.com has fixed limits.
- **Webhook limits:** Self-managed default is 500 webhooks per top-level namespace. GitLab.com tiers scale from 500 to 13,000 per minute based on seat count.
- **Container registry `size`:** Only available for repos created after 2021-11-04 on GitLab.com. Self-managed always has size data.
- **`internal` visibility:** Not available on GitLab.com (only self-managed).
- **Service account tokens:** Self-managed admins can enable never-expiring tokens. GitLab.com service accounts have admin-configured expiry.
- **Admin API:** `admin_mode` scope only works on self-managed (not GitLab.com).

### 10.3 Notes vs Discussions API Confusion

**Critical:** The Notes API returns only root-level comments. Threaded replies (DiscussionNotes) are NOT returned by the Notes API. Use the Discussions API for full comment visibility. The two APIs are completely separate response shapes.

### 10.4 Email Redaction

> Email addresses show as `[REDACTED]` when the user has not set a public email. The `author.email` field in webhooks and API responses is not reliably populated.

### 10.5 `system` Field on Notes

`note.system === true` only marks system-generated notes (e.g., status changes, MR merge events). Regular user comments (including our bot's comments via PAT) are NOT marked `system: true`.

### 10.6 Work Items API — Not All Endpoints Documented

The Work Items API documentation was partially behind auth redirect during research. The legacy Issues API is confirmed stable and works across all tiers. Consider Work Items API for Premium+ tenants only.

### 10.7 MR Labels Are Always Comma-Separated Strings

The `labels` param on the MR update endpoint is a **comma-separated string**, not a JSON array. E.g., `body: "labels=bug,security"`. This differs from how GitHub handles labels and is easy to miss.

### 10.8 No Custom Field API

GitLab has no per-project custom field concept exposed via REST API. Tenants expecting Jira-like custom fields must use labels as a workaround.

### 10.9 Multi-Tenant OAuth Complexity

Each tenant must register their own GitLab OAuth application. There is no cross-tenant OAuth delegation. This significantly complicates Phase 2 OAuth flow compared to GitHub's GitHub App model.

### 10.10 Webhook Idempotency

GitLab sends an `Idempotency-Key` header but the value format and semantics are not clearly documented. Use it for deduplication alongside `payload.objectAttributes.updated_at` to detect stale events.

### 10.11 Project IID vs Global ID

- `id` — global integer ID (unique across GitLab instance)
- `iid` — project-level internal ID (unique within project, used in URLs: `/projects/:id/issues/:iid`)

Always use `iid` for API paths. `id` is used for cross-project references.

### 10.12 Failed Auth Ban (Undocumented)

> 300 failed authentication attempts in 1 minute triggers a 15-minute ban for Git and container registry operations. Does NOT apply to API token auth — only to Git/registry auth. Not documented in the API docs.

---

## 11. Recommended SupportAgent Connector Scope

### MVP — Minimum to Be Useful

**Endpoints to wrap:**

| Endpoint | Method | Purpose |
|---|---|---|
| `GET /projects/:id/issues` | GET | List/fetch issues |
| `GET /projects/:id/issues/:iid` | GET | Get single issue |
| `POST /projects/:id/issues` | POST | Create issue |
| `PUT /projects/:id/issues/:iid` | PUT | Update issue (state, labels, assignees) |
| `GET /projects/:id/issues/:iid/notes` | GET | List comments on issue |
| `POST /projects/:id/issues/:iid/notes` | POST | Post comment on issue |
| `PUT /projects/:id/issues/:iid/notes/:note_id` | PUT | Edit comment |
| `DELETE /projects/:id/issues/:iid/notes/:note_id` | DELETE | Delete comment |
| `GET /projects/:id/merge_requests` | GET | List/fetch MRs |
| `GET /projects/:id/merge_requests/:iid` | GET | Get single MR |
| `POST /projects/:id/merge_requests` | POST | Create MR |
| `PUT /projects/:id/merge_requests/:iid` | PUT | Update MR (state, labels) |
| `GET /projects/:id/merge_requests/:iid/notes` | GET | List MR comments |
| `POST /projects/:id/merge_requests/:iid/notes` | POST | Post MR comment |
| `GET /projects/:id/labels` | GET | List labels |
| `POST /projects/:id/labels` | POST | Create label |
| `GET /projects/:id/milestones` | GET | List milestones |
| `GET /projects/:id/members/all` | GET | Resolve user identity |

**Webhook events to handle:**
- `X-Gitlab-Event: Issue Hook` (object_kind: `issue`)
- `X-Gitlab-Event: Merge Request Hook` (object_kind: `merge_request`)
- `X-Gitlab-Event: Note Hook` (object_kind: `note`)

**Minimum admin panel config fields:**
- `apiUrl` — base GitLab URL (`https://gitlab.com/api/v4` or self-managed)
- `projectId` — numeric project ID or URL-encoded path (`namespace%2Fproject`)
- `botToken` — PAT with `api` scope
- `webhookSecret` — shared secret for `X-Gitlab-Token` verification
- `botUserId` — bot's global user ID for no-self-retrigger
- `botUsername` — bot's username for no-self-retrigger

### Phase 2 — Parity with GitHub Connector

- Discussions API (threads with resolve/unresolve)
- `GET /groups/:id/epics` (Premium+) — epic-level support
- Group-level webhooks for multi-project support
- `GET /projects/:id/issues/:iid/discussions` — threaded comment sync
- `POST /projects/:id/issues/:iid/discussions/:discussion_id/resolve` — resolve thread
- User search: `GET /users?search=...`
- MR-specific: assignees, reviewers, approvers
- OAuth2 multi-tenant flow (per-tenant OAuth apps)
- Rate limit tracking per tenant (note creation: 60/min hard limit)

### Phase 3 — Advanced

- Work Items API for Premium+ tenants (incident, test case, objective work items)
- GraphQL API for multiplexed queries
- Group-level iteration management (Premium+)
- Requirements API (Ultimate)
- OKR/Objectives (Ultimate)
- File upload: `POST /projects/:id/uploads` → embed in Markdown
- Health status monitoring (Ultimate)
- Webhook management via API (`POST /projects/:id/integrations/webhooks`)

---

## 12. Dependencies

### 12.1 Official SDK

No official GitLab SDK for JavaScript/TypeScript from GitLab itself. However:

| Package | Notes |
|---|---|
| `@gitbeaker/rest` or `@gitbeaker/core` | Popular community SDK. Well-maintained, covers full REST API. Supports all token types. |
| `gitlab` (old) | Original JS SDK, still maintained but older API surface. |
| `@octokit/rest` | GitHub SDK, not applicable. |

**Recommendation:** Use **`@gitbeaker/rest`** (or the newer unified `@gitbeaker/core`). It's the most complete JS/TS SDK, supports all authentication methods, and has TypeScript types. However, for minimal overhead, raw `fetch` with typed wrapper functions is also viable — GitLab's REST API is straightforward.

**Why not raw fetch:** `@gitbeaker/rest` handles:
- Automatic pagination (with `pagination: 'keyset'` mode)
- Token management
- Rate limit header reading and automatic retry with `Retry-After`
- Consistent error shape

### 12.2 CLI Tool

GitLab CLI (`glab`) is the equivalent of `gh`. Available at https://github.com/cli/gitlab

- Cross-platform, open source
- Covers auth, issues, MRs, pipelines, releases, and more
- Can be shelled out to for parity operations
- Supports both GitLab.com and self-managed instances

**Recommendation:** Shell out to `glab` for initial setup (auth flow, webhook registration) and ad-hoc debugging. Core connector logic uses the REST API directly.

### 12.3 GraphQL SDK

If multiplexed queries are needed for Phase 3, use `graphql-request` — it's framework-agnostic and lightweight.

---

## 13. Open Questions

1. **SaaS vs Self-Managed:** Does tenant X use gitlab.com or a self-managed instance? Which version (CE/EE)? If self-managed, what's the admin-configured rate limit ceiling? This determines the rate limit strategy.

2. **GitLab Tier:** What tier does the tenant's GitLab instance run (Free/Premium/Ultimate)? Determines whether epics, iterations, weight, health_status, work items are available. If the tenant is on GitLab Free, we must avoid calling Premium+ endpoints or handle 403 gracefully.

3. **Per-Tenant or Shared Bot Account:** Does the tenant want a dedicated service account for SupportAgent, or will they share a personal PAT? Service accounts (never-expiring tokens) are strongly preferred for production.

4. **OAuth2 Required?:** Does the product require OAuth2 (vs PAT) from day one? If yes, each tenant must register a GitLab OAuth app — significantly more onboarding complexity.

5. **MR Support:** Should MRs be in MVP scope, or only Issues? MRs add a second event type, discussions (threads), approval flows, and branch management. If the tenant only uses Issues, omit MR support.

6. **Custom Fields:** Does any tenant need per-issue structured custom fields (Jira-style)? GitLab doesn't support this natively. Would they accept labels-as-fields as a workaround, or is it a blocker?

7. **Comments or Discussions:** Do tenants use threaded discussions (GitHub PR review comments equivalent), or only flat comments? If threaded, we must implement the Discussions API, not just Notes API.

8. **Webhook or Polling:** Will the tenant allow incoming webhooks (requires a publicly accessible endpoint)? Or must we rely entirely on polling with `updated_after` cursors?

9. **Multi-Project Support:** Is single-project support sufficient, or does the tenant need to watch multiple projects under a group? Group-level webhooks are available but only on Premium+ for some event types.

10. **Webhook Reliability:** GitLab webhooks disable after 40 consecutive failures with no automatic re-enable. What's the operational plan for webhook recovery?

---

## Quick Reference: Core API Base

- **Base URL (GitLab.com):** `https://gitlab.com/api/v4`
- **Base URL (self-managed):** `https://self-hosted.example.com/api/v4`
- **Auth header:** `PRIVATE-TOKEN: <token>`
- **Pagination:** `?per_page=100&page=1` (offset) or `?pagination=keyset&order_by=updated_at&sort=desc`
- **Webhook header:** `X-Gitlab-Token: <secret>` (plain shared secret, no HMAC)
- **Event header:** `X-Gitlab-Event: Issue Hook` (event type name)
- **Rate limit headers:** `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After`
- **Key gotcha:** Notes API ≠ Discussions API. Discussions = threads with resolve. Notes = root comments only.