# Jira Inbound Events Review

**Verdict:** CONDITIONAL PASS — The core webhook event list and delivery semantics are largely correct, but several gaps and inaccuracies in signature verification, event coverage, mention detection, polling cursor strategy, and loop-prevention need to be addressed before implementation begins.

---

## Findings

### 1. Missing required events

**Affected flow:** Webhook event table (Section 3.1)

**Problem:** The event table and MVP scope both omit events SupportAgent needs:

- No event for **mention** — Jira does not have a dedicated `mention_created` webhook event. Mentions arrive inside `comment_created` or `jira:issue_updated` payloads embedded in the ADF body. The doc does not explain this and does not list mention detection as a webhook concern at all.
- No event for **assignment change** — `jira:issue_updated` with `changelog.items[].field == "assignee"` covers this, but the table does not call it out explicitly. The doc treats `jira:issue_updated` as a single opaque event rather than explaining that it multiplexes status changes, label changes, assignee changes, and all other field edits via `changelog.items`.
- No event for **resolve/close** — covered by `jira:issue_updated` with a status transition changelog item, but not called out as a distinct intake concern.
- No event for **reply** — Jira comments are flat (no threading), so there is no reply event. The doc should state this explicitly so implementors do not look for one.
- No event for **label add/remove** — again covered by `jira:issue_updated` + changelog, but not flagged as a distinct event concern.

**Correction:**

Add a note under the event table:

> `jira:issue_updated` is a multiplexed event. To detect status transitions, label changes, assignee changes, and resolves, inspect `changelog.items[].field`. Field values are: `"status"`, `"assignee"`, `"labels"`, `"priority"`, `"resolution"`, etc. There is no dedicated event per field change.

Add a row to the table:

| `jira:issue_updated` (changelog) | Status, label, assignee, priority, resolve | All field-change triggers |

State explicitly: Jira has no reply event (comments are flat) and no dedicated mention event.

---

### 2. Signature verification — wrong algorithm claim

**Affected flow:** Signature Verification (Section 3.1)

**Problem:** The doc states the algorithm is **HMAC-SHA256** and the header is `X-Hub-Signature`. This is incorrect for Jira's native webhooks.

Jira Cloud native webhooks (registered via `/rest/webhooks/1.0/webhook`) do **not** include an HMAC signature header at all by default. The `secret` field in the webhook registration body is documented but Jira's actual delivery does not add a verification header in the same way GitHub does. The `X-Hub-Signature` header is a GitHub convention. Jira uses `X-Hub-Signature` only when using the Atlassian Forge or Connect app delivery pipeline, not for native REST-registered webhooks.

For native webhooks, Jira sends:
- `X-Atlassian-Webhook-Identifier` — unique delivery ID for deduplication
- No HMAC signature header is guaranteed

The example signature (`sha256=a4771c39...`) is copied from GitHub documentation patterns and is not sourced from Jira's own webhook docs.

**Correction:**

- Clarify whether the target is native admin webhooks (`/rest/webhooks/1.0/webhook`) or Connect/OAuth app webhooks (`/rest/api/2/webhook`).
- For native admin webhooks: state that Jira does not deliver an HMAC signature header. Network-level security (allowlist Atlassian IP ranges or use a secret path token in the URL) is the recommended mitigation.
- For Connect app webhooks: Connect delivers a signed JWT in the `Authorization` header; verify using the app's shared secret.
- Remove or clearly caveat the `X-Hub-Signature` / HMAC-SHA256 example — it is misleading.

---

### 3. Replay protection — not addressed

**Affected flow:** Signature Verification / Replay Protection (Section 3.1)

**Problem:** The doc does not mention replay protection or timestamp tolerance at all. For Jira native webhooks there is no built-in replay protection mechanism. This is a known gap.

**Correction:**

Add a note:

> Jira native webhooks have no built-in replay protection (no timestamp in the signature, no nonce). Deduplication must rely on `X-Atlassian-Webhook-Identifier`. Store seen identifiers with a TTL matching the retry window (up to ~75 minutes: 5 retries × 15-minute max backoff) to prevent duplicate processing.

---

### 4. Webhook expiration — renewal not flagged as an operational risk

**Affected flow:** Webhook delivery / Known Gotchas (Section 10.4)

**Problem:** The 30-day webhook expiration is mentioned in Known Gotchas but is not called out in Section 3.1 where it is most relevant to the inbound intake story. This is a critical operational concern: if a webhook expires silently, SupportAgent stops receiving events with no error.

**Correction:**

Add in Section 3.1 under Retry / Delivery Semantics:

> Webhooks expire after 30 days. Renewal endpoint: `PUT /rest/webhooks/1.0/webhook/{id}` or re-register. SupportAgent must schedule proactive renewal (e.g. re-register at day 25) and include a polling fallback to detect the gap.

---

### 5. Polling fallback — cursor strategy is fragile

**Affected flow:** Polling Fallback Strategy (Section 3.1)

**Problem:** The doc recommends using the `updated` timestamp as a cursor via `updated >= lastSyncTimestamp`. This has two known issues:

1. **Eventual consistency gap:** Jira's `updated` field may not be updated atomically with all field changes (particularly for cascade operations delivered via the Secondary flow, which can be up to 15 minutes late). An issue fetched at timestamp T may not yet reflect a field change that was written slightly after T.
2. **Timestamp cursor is not idempotent:** Two issues updated at exactly the same millisecond will both appear in the next poll, and one may be missed if the cursor is advanced past both after seeing only one.

The doc notes eventual consistency in Section 10.4 for webhooks but does not connect this concern to the polling cursor.

**Correction:**

- Use `updated >= lastCursorTimestamp - buffer` with a small overlap (e.g., minus 5 minutes) and deduplicate by `issue.id + issue.updated` to handle re-delivery.
- Or switch to offset-based pagination with a fixed page size and advance only after all pages at a given timestamp are consumed.
- Note that `nextPageToken` cursor pagination is forward-only and cannot be used to re-scan for missed items.

---

### 6. New comments on existing items — polling gap not addressed

**Affected flow:** Polling Fallback (Section 3.1), Comment detection

**Problem:** The polling strategy uses `updated >= timestamp` on issues, but the `updated` field on the issue is **not reliably updated when a new comment is added** in all Jira configurations. In some workflow/project configurations, commenting on an issue does not update the issue's `updated` field.

The doc does not address how to detect new comments on existing issues during polling fallback.

**Correction:**

Add:

> When polling for new comments during webhook downtime, do not rely solely on issue `updated` timestamp. For issues of interest, poll `GET /rest/api/3/issue/{key}/comment?orderBy=created&startAt=0&maxResults=50` directly. Store the last seen comment `id` per issue and compare. This is expensive at scale; limit to issues that are in an active state (not Done/Resolved).

---

### 7. Mention detection — requires ADF parsing, not a payload field

**Affected flow:** Mention detection (Section 6.1 trigger table)

**Problem:** Section 6.1 notes mention detection as "Match on `comment.body` containing mention ADF node" but does not explain:

- The `comment.body` in the webhook payload is an ADF object, not plain text.
- To detect a mention of the bot, the connector must recursively walk the ADF tree looking for `{ "type": "mention", "attrs": { "id": "<bot-account-id>" } }` nodes.
- The `comment.body` in webhook payloads for `comment_created` is the full ADF document — this is correct and sufficient, no separate API call is needed.
- However, for `jira:issue_updated`, the `comment` field in the changelog does not include the comment body — the connector must follow up with `GET /rest/api/3/issue/{key}/comment/{commentId}` to retrieve it.

**Correction:**

Add under Section 3.1 or create a dedicated Mention Detection subsection:

> Mentions are not surfaced as a top-level field. Parse the ADF tree in `comment.body` for nodes of type `"mention"` with `attrs.id` matching the bot's `accountId`. In `comment_created` webhooks the full body is present. In `jira:issue_updated` changelog entries, the comment body is absent — fetch via `GET /rest/api/3/issue/{key}/comment/{commentId}`.

---

### 8. Bot-authored content loop prevention — partially addressed but incomplete

**Affected flow:** Identity Mapping (Section 7), Loop Prevention

**Problem:** Section 7.3 notes that app/bot users have `accountType: "app"` and that the connector can detect its own comments via `author.accountId`. This is correct for the API token path where the token owner's `accountType` is `"atlassian"` (a regular user), not `"app"`. If the connector posts as an API token user, `accountType` will be `"atlassian"` — indistinguishable from a human user by type alone.

The doc does not recommend a loop-prevention marker (e.g., a label, a specific ADF metadata node, or a custom field) for cases where `accountId` comparison is insufficient or unavailable.

**Correction:**

- Clarify that `accountType: "app"` applies only to OAuth app users or service accounts created via the Atlassian developer console, not to API token users.
- Recommend storing the bot's `accountId` in connector config and comparing `comment.author.accountId` on every inbound `comment_created` event. If they match, skip processing.
- As a belt-and-suspenders measure, tag bot-authored comments with a known label or custom ADF metadata so they can be identified even if the accountId changes (e.g., token rotated to a different user).

---

### 9. `comment_created` payload shape — issue context is shallow

**Affected flow:** Payload top-level shape (Section 3.1, Appendix B)

**Problem:** Appendix B shows an `jira:issue_updated` payload with a full `issue` object. The doc does not show a `comment_created` payload. The actual `comment_created` webhook payload has this top-level shape:

```json
{
  "timestamp": 1642533600000,
  "webhookEvent": "comment_created",
  "comment": { ... },
  "issue": { "id": "...", "key": "...", "self": "..." }
}
```

The `issue` object in `comment_created` is a **stub** (id, key, self only) — it does not include `fields`. If the connector needs issue context (project, labels, status) when processing a comment event, it must make a separate API call to `GET /rest/api/3/issue/{key}`.

**Correction:**

Add a `comment_created` payload example to Appendix B showing the stub `issue` shape, and add a note:

> The `issue` field in `comment_created` and `comment_updated` payloads is a stub containing only `id`, `key`, and `self`. Fetch full issue fields separately if needed for routing or matching.

---

### 10. `jira:issue_updated` — `issueEventTypeName` field not mentioned

**Affected flow:** Event Field Availability (Section 6.3), Status change detection

**Problem:** Jira's `jira:issue_updated` payload includes an `issueEventTypeName` field at the top level that more specifically identifies the sub-event type. Common values:

- `"issue_commented"` — a comment was added (note: this can arrive as `jira:issue_updated` in some configurations in addition to `comment_created`)
- `"issue_assigned"` — assignee changed
- `"issue_generic"` — generic field update
- `"issue_resolved"` — issue resolved
- `"issue_closed"` — issue closed
- `"issue_updated"` — other field update

Ignoring this field and relying solely on `changelog.items` means the connector may process `issue_commented` events as generic updates and miss that a comment was involved.

**Correction:**

Add `issueEventTypeName` to the payload field documentation and the event field availability table. Note that when `issueEventTypeName == "issue_commented"`, the payload may also include a `comment` object alongside the `changelog`.

---

### 11. Webhook registration endpoint inconsistency

**Affected flow:** Webhook Registration (Section 3.1), MVP Scope (Section 11)

**Problem:** Section 3.1 correctly states the registration endpoint as `POST /rest/webhooks/1.0/webhook`. However, Section 11 MVP scope lists `POST /rest/api/3/webhooks/1.0/webhook` and `DELETE /rest/api/3/webhooks/1.0/webhook/{id}` — both prefixed with `/rest/api/3/` which is wrong. The webhooks API lives under `/rest/webhooks/1.0/`, not under `/rest/api/3/`.

**Correction:**

In Section 11, correct to:
- `POST /rest/webhooks/1.0/webhook`
- `DELETE /rest/webhooks/1.0/webhook/{id}`

---

### 12. OAuth webhook limit operationally significant — not surfaced as risk

**Affected flow:** Webhook Registration, Multi-Tenant (Section 10.6)

**Problem:** The doc notes "OAuth apps: 5 webhooks per app per user" in Section 3.1 and repeats it in 10.6, but does not flag the practical consequence: at 5 webhooks per user, a multi-project SupportAgent deployment will exhaust the limit immediately if it registers one webhook per project. This forces use of admin webhooks (which require Jira admin access) or a single webhook with JQL filter covering all projects.

**Correction:**

Add a note:

> The 5-webhook OAuth limit per user means multi-project deployments must use a single webhook with a broad JQL filter (`project in (A, B, C)`) or use admin webhooks. Design the connector to register one webhook per tenant, not one per project.

---

## Summary of Gaps by Category

| Category | Status |
|---|---|
| Event names and spelling | Mostly correct; `jira:issue_created`, `jira:issue_updated`, `comment_created`, `comment_updated`, `comment_deleted` are accurate |
| Multiplexed event coverage (status, label, assign, resolve) | Missing explicit documentation |
| Mention event | Missing — requires ADF tree walk, not a top-level field |
| Reply event | Missing — should state Jira has no reply events |
| Signature verification | Incorrect — `X-Hub-Signature` + HMAC-SHA256 not accurate for native webhooks |
| Replay protection | Missing |
| Webhook expiration risk | Present but not surfaced in intake section |
| Polling cursor | Present but fragile; eventual-consistency gap not connected |
| New comments via polling | Missing |
| Payload top-level shapes | `comment_created` stub shape not documented; `issueEventTypeName` missing |
| Bot loop prevention | Partially present; `accountType` caveat missing |
| Webhook registration path | Inconsistency in Section 11 |
