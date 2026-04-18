# PagerDuty Connector — Design Document

> Status: Research complete — implementation pending
> API Reference: https://developer.pagerduty.com/docs/rest-api-v2/r11-overview
> OpenAPI Spec: https://github.com/PagerDuty/api-schema (reference/REST/openapiv3.json)

---

## 1. Overview

- **Category**: Incident management / on-call alerting
- **Cloud vs self-hosted**: Cloud-only (SaaS). PagerDuty has no self-hosted variant.
- **Two distinct APIs**:
  1. **REST API** (`https://api.pagerduty.com`) — manage incidents, users, services, webhooks, escalation policies. Used for both inbound (reading) and outbound (writing).
  2. **Events API v2** (`https://events.pagerduty.com/v2`) — one-way event ingestion from monitoring tools. NOT used for our connector (we receive, not send events).
- **Webhook delivery**: PagerDuty webhooks are managed via the Extensions API (`POST /extensions`) with the `generic_webhook` extension schema (`PJFWPEP`). Webhooks are scoped to a **Service** (one service per webhook). There is no global account-level webhook.

---

## 2. Authentication

### API Key (REST API)

- **Format**: `Authorization: Token token=<API_KEY>`
- **Header name**: `Authorization`
- **How to obtain**: PagerDuty UI → Integrations → API Access Keys → Create Integration Key
- **Scopes**: API keys are account-level and inherit the creating user's permissions. No granular scopes.
- **Permission model**:
  - Account roles: `admin`, `owner`, `user`, `limited_user`, `observer`, `read_only_user`, `read_only_limited_user`, `restricted_access`
  - Ability-based: `teams`, `read_only_users`, `advanced_permissions`, `urgencies`, `response_operations` — some endpoints require specific abilities
- **Token lifetime**: Non-expiring unless revoked manually
- **Recommendation for MVP**: API Key. Store per-tenant. Requires a service account or admin user to create the key.

### OAuth 2.0

- Available but requires OAuth app registration per tenant. More complex to set up per-tenant.
- **Recommendation**: Not for MVP. Revisit if tenants need user-scoped access (i.e., the tenant's own users authenticate on behalf of themselves).

### Events API v2 (outbound only)

- Uses a **Routing Key** (Integration Key) instead of an API key.
- Format: passed as `routing_key` in the JSON body.
- Not used for reading — only for sending events into PagerDuty.
- **Recommendation**: Not relevant for inbound connector.

---

## 3. Inbound — Events and Intake

### Webhook Support: YES

PagerDuty webhooks are delivered as **HTTP POST** to a configured endpoint URL per **Service**. There is no global account-level webhook — each Service that needs webhook delivery must have a `generic_webhook` extension registered against it.

#### Registering a Webhook

```
POST /extensions
Headers:
  Authorization: Token token=<API_KEY>
  Content-Type: application/json
  From: <user_email>   # required header — email of valid account user
Body:
{
  "extension": {
    "name": "SupportAgent Webhook",
    "endpoint_url": "https://your-endpoint.com/pd-webhook",
    "extension_schema": {
      "id": "PJFWPEP",
      "type": "extension_schema_reference"
    },
    "extension_objects": [
      { "id": "<SERVICE_ID>", "type": "service_reference" }
    ],
    "config": {}
  }
}
```

#### Webhook Event Types

| Event Type | Description |
|---|---|
| `incident.trigger` | New incident created |
| `incident.acknowledge` | Incident acknowledged |
| `incident.unacknowledge` | Incident unacknowledged (timeout) |
| `incident.resolve` | Incident resolved |
| `incident.assign` | Incident reassigned |
| `incident.escalate` | Incident escalated to next level |
| `incident.delegate` | Incident reassigned to different escalation policy |
| `incident.annotate` | Note added to incident |

#### Webhook Payload Structure

```json
{
  "id": "bb4fcb00-6324-11e6-b9aa-22000affca53",
  "created_on": "2016-08-15T20:13:28.000Z",
  "changed_fields": ["status", "assignments"],
  "_incident_key": "3ef39f02b53c4e4b8b2d4f4b2e8c4f8",
  "version": "1",
  "account_id": "PIJ90N7",
  "description": "Triggered",
  "event": "incident.resolve",
  "incident": {
    "id": "PIJ90N7",
    "incident_number": 1013,
    "title": "CPU is high",
    "status": "resolved",
    "created_on": "2016-08-15T20:13:28.000Z",
    "service": { "id": "PIJ90N7", "name": "my-service", "type": "service_reference" },
    "assignments": [
      { "assignee": { "id": "PUSER01", "summary": "Jane Doe", "type": "user_reference" } }
    ],
    "priority": { "id": "Ppriority", "summary": "High", "type": "priority_reference" },
    "urgency": "high",
    "html_url": "https://subdomain.pagerduty.com/incidents/PIJ90N7"
  },
  "log_entries": [
    {
      "id": "R0FFIOTKIU30MN7XWR99SI0",
      "type": "resolve_log_entry",
      "summary": "Resolved by Jane Doe",
      "created_at": "2016-08-15T20:13:28.000Z",
      "agent": { "id": "PUSER01", "type": "user_reference" }
    }
  ]
}
```

**Key fields to persist:**

| Field | Path | Notes |
|---|---|---|
| Incident ID | `incident.id` | Alphanumeric, e.g. `PIJ90N7` |
| Incident number | `incident.incident_number` | Integer, unique per account |
| Title | `incident.title` | |
| Status | `incident.status` | `triggered`, `acknowledged`, `resolved` |
| Service | `incident.service.id`, `incident.service.name` | |
| Assignees | `incident.assignments[*].assignee` | |
| Priority | `incident.priority.id`, `incident.priority.summary` | Requires Standard+ plan |
| Urgency | `incident.urgency` | `high` or `low` |
| Created at | `incident.created_on` | ISO8601 |
| External URL | `incident.html_url` | |
| Event type | `event` | |
| Changed fields | `changed_fields` | Array of modified field names |
| Agent (who triggered event) | `log_entries[*].agent` | |
| Note content | `log_entries[*].note` | For `incident.annotate` events |

#### Signature Verification

- **Header**: `X-PagerDuty-Signature`
- **Algorithm**: HMAC-SHA256
- **Format**: `v1=<hmac_hex_digest>`
- **Payload**: Raw request body (string)
- **Secret**: Set when registering the webhook extension (passed in the extension `config` object — PagerDuty does not auto-generate the secret; you set it)
- **Verification**: Compute `HMAC-SHA256(secret, raw_body)` and compare `v1=` prefix

#### Retry / Delivery Semantics

- PagerDuty retries delivery with **exponential backoff** over ~24 hours.
- HTTP 2xx = success; HTTP 4xx/5xx = failure → retry.
- No delivery confirmation headers or message IDs in the webhook payload itself.
- The `changed_fields` array indicates which incident fields changed, useful for debouncing.

### Polling Fallback

If webhooks are unavailable, poll these endpoints:

#### `GET /incidents`

**Query params for polling strategy:**

| Param | Use |
|---|---|
| `statuses[]` | Filter: `triggered`, `acknowledged`, `resolved` |
| `sort_by` | `created_at:desc` for newest first |
| `include[]` | `log_entries`, `acknowledgements`, `assignments`, `priority`, `service` |
| `since` | ISO8601 lower bound (required for efficient polling) |
| `until` | ISO8601 upper bound (optional) |

**Example**: `GET /incidents?statuses[]=triggered&statuses[]=acknowledged&sort_by=created_at:desc&include[]=log_entries&since=2024-01-01T00:00:00Z`

#### `GET /incidents/{id}/log_entries`

Get detailed log entries for a specific incident. Params: `since`, `until`, `is_overview=false`, `include[]`.

#### `GET /log_entries`

Account-level log entry query. Params: `since`, `until`, `time_zone`, `total=true`.

**Polling recommendation**: Store `last_polled_at` per service and pass as `since`. Use `statuses[]` to track state transitions. Paginate with `offset`/`limit` (offset-based, see §9).

---

## 4. Outbound — Writing Back

### Create Incident

```
POST /incidents
Headers:
  Authorization: Token token=<API_KEY>
  Content-Type: application/json
  From: <user_email>
Body:
{
  "incident": {
    "type": "incident",
    "title": "CPU is high on prod-server-01",
    "service": { "id": "<SERVICE_ID>", "type": "service_reference" },
    "urgency": "high",
    "body": {
      "type": "incident_body",
      "details": "Additional context from SupportAgent"
    }
  }
}
```

Returns: `{ "incident": { "id": "...", "incident_number": 123, ... } }`

**Notes**:
- `incident_key` field enables deduplication (same key + service = rejected if open incident exists).
- `assignments` or `escalation_policy` can be specified directly.
- Requires a Service ID — incidents are always tied to a Service.

### Post Note (Comment) on Incident

```
POST /incidents/{id}/notes
Headers:
  Authorization: Token token=<API_KEY>
  Content-Type: application/json
  From: <user_email>
Body:
{
  "note": {
    "content": "This is a comment from SupportAgent. Resolving now."
  }
}
```

**Note**: PagerDuty **does not support editing or deleting notes** via API. Notes are append-only.

### Acknowledge Incident

```
PUT /incidents/{id}
Headers:
  Authorization: Token token=<API_KEY>
  Content-Type: application/json
  From: <user_email>
Body:
{
  "incident": {
    "type": "incident",
    "status": "acknowledged"
  }
}
```

### Resolve Incident

```
PUT /incidents/{id}
Headers:
  Authorization: Token token=<API_KEY>
  Content-Type: application/json
  From: <user_email>
Body:
{
  "incident": {
    "type": "incident",
    "status": "resolved",
    "resolution": "Fixed by updating the config."
  }
}
```

### Assign Incident

```
PUT /incidents/{id}
Headers:
  Authorization: Token token=<API_KEY>
  Content-Type: application/json
  From: <user_email>
Body:
{
  "incident": {
    "type": "incident",
    "assignments": [
      { "assignee": { "id": "<USER_ID>", "type": "user_reference" } }
    ]
  }
}
```

### Reassign to Escalation Policy

```
PUT /incidents/{id}
Headers:
  Authorization: Token token=<API_KEY>
  Content-Type: application/json
  From: <user_email>
Body:
{
  "incident": {
    "type": "incident",
    "escalation_policy": { "id": "<EP_ID>", "type": "escalation_policy_reference" }
  }
}
```

### Update Priority (Standard+ plans only)

```
PUT /incidents/{id}
Body:
{
  "incident": {
    "type": "incident",
    "priority": { "id": "<PRIORITY_ID>", "type": "priority_reference" }
  }
}
```

### Escalate Incident

```
POST /incidents/{id}/snooze
Body:
{
  "duration": 0   # Setting duration=0 immediately escalates
}
```

Actually, to escalate, use:

```
POST /incidents/{id}/responder_requests
Body:
{
  "requester_id": "<BOT_USER_ID>",
  "message": "Escalation requested by SupportAgent",
  "responder_request_targets": [
    { "type": "user_reference", "id": "<USER_ID>" }
  ]
}
```

### Snooze Incident

```
POST /incidents/{id}/snooze
Body:
{
  "duration": 3600   // seconds
}
```

### Add Tags to Incident (or any entity)

```
POST /{entity_type}/{id}/change_tags
Body:
{
  "add": ["engineering", "database"],
  "remove": ["low-priority"]
}
```

Valid `entity_type`: `incidents`, `escalation_policies`, `teams`, `users`.

### List Tags on Entity

```
GET /{entity_type}/{id}/tags
```

### Set Priority (per entity)

Priority is **plan-gated** (Standard+). Priority is set via the incident update body. There is no separate endpoint.

### Attach Link (no native attachment — use Log Entry with link context)

PagerDuty log entries support `contexts`:

```json
{
  "note": "See monitoring dashboard",
  "contexts": [
    {
      "type": "link",
      "href": "https://grafana.example.com/dashboard",
      "text": "Grafana Dashboard"
    }
  ]
}
```

### NO Native File Upload

PagerDuty does not support file/screenshot uploads. Use log entry `contexts` with `image` type to embed images via URL.

---

## 5. Labels, Flags, Fields, Priorities

### Tags

- Free-form string labels, max 191 chars, applied to Users, Teams, Escalation Policies, and Incidents.
- NOT the same as labels in GitHub or Linear — PagerDuty has no native "label" concept for incidents.
- Managed via:
  - `POST /tags` — create tag
  - `GET /tags` — list tags (supports `query` filter)
  - `POST /{entity_type}/{id}/change_tags` — add/remove tags

### Priority (Standard+ only)

- Account-level priority labels (e.g., "P1", "P2", "P3").
- Set via `incident.priority` on create/update.
- List priorities: `GET /priorities` — returns `{ priorities: [{ id, summary, description }] }`.
- Not all accounts have priorities enabled (requires Standard or Enterprise plan).

### Urgency

- Built-in per-incident: `high` or `low`.
- Not a label — a property of the incident. Defaults to `high`.
- Can be set on create and update.

### Status

Fixed three-state model: `triggered` → `acknowledged` → `resolved`. No custom workflows. Transitions are:

- New incident: `triggered`
- Any responder acknowledges: `acknowledged`
- User marks resolved: `resolved`
- Acknowledgement timeout (service-level setting): reverts to `triggered` → `unacknowledged`

### Severity (Alert-level)

PagerDuty has a **severity** field at the **Alert** level (within an incident), not at the incident level. Values: `info`, `warning`, `error`, `critical`. Relevant when using the Events API v2 to send events (which become alerts under an incident). Not directly settable on incidents via REST API.

### Custom Fields

PagerDuty does **not** have user-defined custom fields on incidents. This is a known limitation. Metadata is limited to: title, body/details, urgency, priority, service, escalation policy, tags, and log entry notes.

### Assignees

List of `UserReference` objects. Not a single assignee — multiple assignees possible.

---

## 6. Triggers We Can Match On

From inbound webhook payloads:

| Trigger | Payload Path | Notes |
|---|---|---|
| New incident | `event == "incident.trigger"` | |
| Status change | `event in ("incident.acknowledge", "incident.resolve", "incident.unacknowledge")` | |
| Assignee change | `event == "incident.assign"` + `changed_fields` | |
| Escalation | `event == "incident.escalate"` | |
| Note added | `event == "incident.annotate"` + `log_entries[*].note` | |
| Priority change | `changed_fields` contains `"priority"` | Requires Standard+ |
| Specific service | `incident.service.id == "<SERVICE_ID>"` | |
| Specific urgency | `incident.urgency == "high"` | |
| Note body regex | `log_entries[*].note` | For `incident.annotate` events |
| Tag add/remove | Polling `/incidents/{id}/tags` | Webhooks don't carry tags directly |
| Assignee match | `incident.assignments[*].assignee.id` | |

**`no_self_retrigger`**: Use the `agent` field in the triggering `log_entry` to detect our own activity. The `agent` is a `UserReference` — store the bot user's PagerDuty ID and compare `agent.id`.

**No webhook for tag changes**: Tag add/remove events are NOT sent via webhook. Must be polled via `GET /incidents/{id}/tags`.

---

## 7. Identity Mapping

### User ID Shape

- Alphanumeric strings, e.g. `PXXXXX` or `PIJ90N7`.
- Stable across the account (not email-based).
- `type` field always `"user_reference"` in API responses.

### Resolving User Identity

```
GET /users/{id}       → { id, name, email, html_url, ... }
GET /users/me          → current authenticated user
GET /users?query=<email>  → search by email
```

PagerDuty **exposes email** in user responses: `{ email: "jane@example.com" }`. Use this to cross-reference with other systems.

### Bot / Connector Identity

- The bot's PagerDuty user account is needed. The API key is associated with a user.
- For outbound actions, the `From` header must contain a valid account user's email.
- When acting as a bot, use a dedicated service account user (not a real person's account).
- The `agent.id` in log entries will match the bot user's PagerDuty ID — use this for `no_self_retrigger`.

### Author Field on Comments (Notes)

- Notes created via `POST /incidents/{id}/notes` record the creating user in the `user` field of the response.
- The `user` field is a `UserReference`: `{ id: "...", summary: "Jane Doe", type: "user_reference" }`.
- **No guarantee** the note's author is in the same format as the bot's own user reference. Store both IDs.

---

## 8. Rate Limits

- **Standard/Enterprise**: 1,000 requests/minute per API key.
- **Lite/Free**: 250 requests/minute per API key.
- **Headers** (on every response):
  - `X-RateLimit-Limit`: Requests per minute limit
  - `X-RateLimit-Remaining`: Requests remaining in window
  - `X-RateLimit-Reset`: Unix timestamp when window resets
  - `Retry-After`: Seconds to wait (present on 429 responses)
- **Behavior on 429**: Respect `Retry-After` header. Exponential backoff with 429 as signal.
- **Pagination**: Offset-based (`offset`/`limit`). Not a bulk API.
- **Webhook delivery**: PagerDuty retries webhooks on our endpoint — we don't have rate limit concern for receiving.

---

## 9. Pagination & Search

### Style

**Offset-based** pagination. No cursor pagination.

```
GET /incidents?offset=0&limit=25
```

Response envelope:

```json
{
  "incidents": [...],
  "limit": 25,
  "offset": 0,
  "more": true,
  "total": null   // null by default; pass ?total=true to get total
}
```

### Max Page Size

- Default: 25
- Max: 100 (enforced by API)

### Useful Search/Filter Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /incidents?statuses[]=triggered&since=...` | Polling for new/updated incidents |
| `GET /users?query=<email>` | Resolve user by email |
| `GET /services` | List services (to find service ID by name) |
| `GET /teams` | List teams |
| `GET /priorities` | List priority levels |
| `GET /tags` | List available tags |
| `GET /incidents/{id}/notes` | Get all notes on an incident |
| `GET /incidents/{id}/tags` | Get tags on an incident |
| `GET /oncalls?escalation_policy_ids[]=...` | Who is currently on-call |
| `GET /audit/records?since=...` | Audit trail (Enterprise only) |

---

## 10. Known Gotchas

### Webhooks are per-Service

There is no account-level webhook. Each PagerDuty Service must have a `generic_webhook` extension registered. Multi-tenant: one webhook per tenant per service. A tenant's PagerDuty account may have many services; we need to register a webhook for each service we care about.

### `From` Header Required on All Mutating Requests

Every `POST`, `PUT`, `PATCH`, `DELETE` request **must** include:
```
From: <valid_user_email>
```
without which the API returns 400. The email must belong to an active account user.

### No Global Incident ID

Incidents have two identifiers:
- `id`: Alphanumeric, e.g. `PIJ90N7`
- `incident_number`: Integer, unique per account, shown in the UI

`incident_number` resets per account — not globally unique. Use `id` as the canonical external ID.

### Tags Are Not in Webhook Payloads

Tag add/remove events are NOT sent via webhook. The `changed_fields` array in webhooks never includes tags. Must poll `GET /incidents/{id}/tags` to detect tag changes.

### No Edit or Delete for Notes

Notes are append-only. There is no `PUT /incidents/{id}/notes/{note_id}` or `DELETE /notes/{note_id}`.

### Priority Requires Standard+ Plan

The `priority` field on incidents returns `null` for Free/Lite accounts. `GET /priorities` returns empty array. Code must handle `priority: null` gracefully.

### Webhook Signature Secret is User-Provided

PagerDuty does not auto-generate the HMAC secret when creating a webhook extension. The connector must generate a secret and pass it in the extension's `config` object. If not set, no signature verification is possible.

### `changed_fields` May Be Empty

On the first delivery attempt, `changed_fields` may be empty. Subsequent retries may have `changed_fields` populated.

### No Reliable "Created By" on Incidents

The webhook payload for `incident.trigger` includes the `agent` in `log_entries` (the trigger log entry), but not a direct "created_by" field on the incident object itself. Use the `log_entries[0].agent` from the trigger event.

### Events API v2 Is Separate from REST API

The Events API v2 (`events.pagerduty.com`) is for **sending** events to PagerDuty, not for managing incidents. It uses `routing_key` (integration key), not the REST API key. Our connector uses REST API exclusively for reading and writing.

### Enterprise-Only: Audit Records, Response Plays, Business Services

- `GET /audit/records` — Enterprise plan only.
- `GET /business_services` — Enterprise plan only.
- `GET /response_plays` — Standard+ plan.

### Service Account Required for Bot Identity

The connector needs a dedicated PagerDuty user account (service account) to act as the bot. This user's ID is the `agent.id` used for `no_self_retrigger`.

### URL Format

PagerDuty URLs are subdomain-based: `https://<account-subdomain>.pagerduty.com/incidents/<id>`. The subdomain is per-account and not directly available from the API (`html_url` gives the full URL).

---

## 11. Recommended SupportAgent Connector Scope

### MVP (minimum to be useful)

**Webhook handling**:
- Register `generic_webhook` extension per service (`POST /extensions`)
- Handle events: `incident.trigger`, `incident.acknowledge`, `incident.resolve`, `incident.annotate`
- HMAC-SHA256 signature verification (`X-PagerDuty-Signature: v1=...`)

**Outbound**:
- `POST /incidents/{id}/notes` — post comments
- `PUT /incidents/{id}` — acknowledge, resolve, assign
- `GET /users?query=<email>` — user resolution

**Polling fallback**:
- `GET /incidents` with `since`, `statuses[]`, `sort_by`, `include[]`
- `GET /incidents/{id}/log_entries` for state diffs

**Admin panel config fields**:
- PagerDuty API Key (`Token token=<KEY>`)
- Bot user email (for `From` header)
- Service IDs to monitor (array of service IDs to register webhooks for)
- HMAC webhook secret (user-generated)
- Webhook endpoint URL (our public URL)

### Phase 2 (parity with GitHub connector)

- `POST /incidents` — create incidents (proactive alerting)
- `POST /incidents/{id}/responder_requests` — escalate/assign
- `POST /incidents/{id}/snooze` — snooze
- `GET /priorities` — list and set priority
- `POST /{entity_type}/{id}/change_tags` — tag management
- `GET /oncalls` — who is currently on-call for routing
- Handle `incident.unacknowledge`, `incident.escalate`, `incident.delegate`, `incident.assign` events
- Note polling (notes not in webhooks)

### Phase 3 (advanced)

- `GET /audit/records` — Enterprise-only audit trail
- `POST /analytics/raw/incidents` — incident analytics
- Business service mapping (Enterprise only)
- Response play execution
- Multi-tenant webhook auto-registration via PagerDuty Terraform provider or Events API v2 deduplication

---

## 12. Dependencies

### Official SDK

- **npm**: `@pagerduty/pdapi-js` — community SDK, not officially maintained by PagerDuty. Last updated ~2022.
- **No official** PagerDuty-maintained npm SDK. PagerDuty officially maintains SDKs for: Ruby, Python, Go, Terraform.
- **Recommendation**: Use raw `fetch`. The REST API is straightforward HTTP+JSON. An SDK adds a dependency with no significant benefit. The OpenAPI spec is available at `reference/REST/openapiv3.json` in the `PagerDuty/api-schema` GitHub repo — could be used to generate a typed client.

### No CLI Equivalent

Unlike GitHub (`gh`) or Linear (`linear` CLI), PagerDuty has no CLI for API parity. No `pd` CLI that would replace REST calls.

### OpenAPI Schema

Available at: `https://raw.githubusercontent.com/PagerDuty/api-schema/master/reference/REST/openapiv3.json`

---

## 13. Open Questions

1. **Per-tenant OAuth vs API Key**: Do we expect tenants to provision API keys, or will they want OAuth (so users authenticate with their own PagerDuty account)? API key is simpler for MVP.

2. **Service ID discovery**: How will tenants know their Service IDs? We should provide a UI to list their services (`GET /services`) so they can select which services to monitor.

3. **Webhook secret management**: PagerDuty doesn't auto-generate secrets. Do we generate a random secret server-side and store it, or require the tenant to provide one?

4. **Priority plan gating**: Can we assume Standard+ plans? If not, we must handle `priority: null` and `GET /priorities` returning empty.

5. **Enterprise features**: Do any target tenants use Enterprise-only features (audit records, business services)? This affects whether we should wrap those endpoints conditionally.

6. **Subdomain for deep links**: PagerDuty URLs include the account subdomain. Is the subdomain derivable from the API key or do we need it from tenant config?

7. **Webhook delivery reliability**: PagerDuty webhooks have no delivery guarantees and can be missed. Should we run a periodic reconciliation poll (e.g., every 15 min) even when webhooks are active, to catch missed events?
