# Notion Connector — Inbound Events Audit Review

**Reviewed file:** `docs/connectors/notion.md`
**Audit scope:** Webhook event coverage, payload shapes, signature verification, replay protection, delivery guarantees, polling fallback, mention detection, and loop-prevention markers.
**Verdict:** CONDITIONAL — Webhook support exists but is severely limited for SupportAgent's event-intake needs. Critical events are missing or aggregated-only.

---

## Finding 1 — Missing `page.created` webhook event

**Affected flow:** New item creation detection.

Notion webhooks do NOT include a `page.created` event. The documented event types are limited to:
- `page.content_updated` (aggregated)
- `page.locked` (immediate)
- `comment.created` (immediate)
- `data_source.schema_updated` (2025-09-03)

There is no `page.created`, `page.updated`, or `page.deleted` webhook. A new page row created in a ticket database generates no webhook event.

**Correction:** Add a dedicated "new item" polling mechanism via `POST /v1/databases/{id}/query` with `sort: [{timestamp: "created_time", direction: "descending"}]` as a required complement to webhooks. The connector MUST poll for new items; webhooks alone cannot detect them.

---

## Finding 2 — No `page.property_updated` event; status/label changes are polling-only

**Affected flow:** Status change, label/tag add/remove, assignee change, close/resolve, priority change.

Notion has NO granular property-change webhook. The document's "Triggers" table (Section 6) maps status transitions and label changes to `page.content_updated`, but this event is explicitly marked as **aggregated / batched** — not immediate. The webhook payload example in the document confirms this is the only property-change mechanism.

Consequences:
- Status change detection has no real-time path. `page.content_updated` fires with variable delay (batching).
- No `page.property_updated` event type exists in Notion's webhook enum.
- Detecting a status transition requires polling `POST /v1/databases/{id}/query` with a `last_edited_time` filter and then diffing property values.

**Correction:** The polling fallback section (Section 3) must be elevated from "fallback when webhook fails" to **the primary mechanism for status/label/assignee detection**. Webhooks handle only comment events in real time. All property changes require polling.

**Recommended polling for property changes:**
1. Poll `POST /v1/databases/{id}/query` sorted by `last_edited_time` descending.
2. Cache the last-seen `last_edited_time` per page.
3. On page reappearing in results with newer `last_edited_time`, fetch `GET /v1/pages/{id}` and diff `properties.Status.status.name`, `properties.Labels.multi_select`, `properties.Assignee.people` against cached values.
4. Emit synthetic "status_changed", "label_added", "label_removed", "assignee_changed" events internally.

---

## Finding 3 — No `comment.updated` or `comment.deleted` events

**Affected flow:** Reply edits, comment deletion handling.

Notion webhooks do not include `comment.updated` or `comment.deleted`. Only `comment.created` is supported as an immediate event.

If a user edits a comment or deletes one, SupportAgent has no webhook notification. The polling fallback `GET /v1/comments?block_id={id}` can detect this via diff against cached comment state, but it is not documented as a polling requirement.

**Correction:** Add `comment.updated` and `comment.deleted` to the "Known Gotchas" section (#10) as **not supported via webhook; polling required**. Document the polling approach: cache `comment.id` + `comment.last_edited_time` per block, re-query on `page.content_updated` to detect modified/deleted comments.

---

## Finding 4 — No `page.archived` / `page.deleted` / `page.moved` events

**Affected flow:** Close/resolve detection, page archival.

Notion does not fire webhooks for page archival, deletion, or movement. Closing/archiving a ticket page (setting `in_trash: true`) does not generate a webhook event. The document correctly notes `page.in_trash` change detection in the triggers table but marks it as polling-only.

**Correction:** The triggers table (Section 6) entry for "Page in trash" should be explicit that **webhook coverage is NONE** — this is a polling-only signal via `page.in_trash` field changes detected through `last_edited_time` polling.

---

## Finding 5 — No mention-specific event

**Affected flow:** Bot mention detection.

Notion does not fire a separate `mention.created` or `user.mentioned` event. Bot mention detection relies on parsing `comment.created` payloads: inspect `comment.rich_text` for structured `mention` type blocks with type `user` and matching `user.id == bot_user_id`.

This is documented correctly in Section 6 ("Mention of bot user" trigger). The document also correctly notes (gotcha #10) that plain `@username` text is NOT a structured mention — only `mention` type rich-text blocks trigger notifications from Notion's side.

**Correct as documented.** No change needed, but the connector must implement two detection paths:
1. **Structured mention:** `comment.rich_text[].mention.type === "user" && mention.user.id === bot_user_id`
2. **Plain text fallback:** regex match `comment.rich_text[].plain_text` for `@bot_display_name` (this will NOT trigger a Notion webhook, but users may type it expecting a response; SupportAgent must decide whether to act on plain-text @mentions).

---

## Finding 6 — Signature verification algorithm: CORRECT as documented

**Header:** `X-Notion-Signature: sha256={HMAC-SHA256(request_body, verification_token)}`
**Algorithm:** HMAC-SHA256
**Body signed:** raw request body bytes (not a derived string)
**Verification token:** stored from UI setup, used as the HMAC key

This matches the document's description (Section 3, "HMAC verification"). Implementation is straightforward.

**No issue.**

---

## Finding 7 — Replay protection / timestamp tolerance: NOT documented

**Affected flow:** Replay attack prevention.

The document does not mention whether Notion includes a timestamp header (e.g., `X-Notion-Timestamp`) or enforces a tolerance window for webhook replay. The "at-least-once" delivery guarantee and exponential backoff retry are documented, but there is no mention of:
- Whether a `timestamp` or `nonce` field is included in the payload for deduplication
- Whether the webhook URL change requires re-verification (it does — documented in the API reference, which notes subscription must be deleted and recreated after URL changes)
- How long Notion retries before dead-lettering a delivery

**Correction:** Add to "Known Gotchas" (#10): webhooks have no documented replay-protection mechanism beyond at-least-once delivery. SupportAgent should implement its own deduplication via `event.id` (UUID in payload) as a unique delivery key. Store processed event IDs with a TTL (recommend 24h window based on Notion's retry behavior).

---

## Finding 8 — Delivery guarantee: correctly documented as "at-least-once"

**Affected flow:** Idempotency requirement.

Section 3 states: "Notion retries delivery with exponential backoff. Delivery guaranteed at-least-once."

This is correctly stated. No correction needed. SupportAgent must handle duplicate webhook deliveries idempotently.

---

## Finding 9 — Polling fallback: incomplete for new comments on existing items

**Affected flow:** Comment sync on existing pages.

The polling fallback section (Section 3) covers:
- `POST /v1/search` with `last_edited_time` sort (limited, title-only)
- `POST /v1/databases/{id}/query` filtered by `last_edited_time`
- `GET /v1/pages/{id}/properties/{prop_id}`
- `GET /v1/comments?block_id={id}`

However, it does not document:
1. **How to detect new comments on existing pages** without webhook coverage (e.g., if `comment.created` webhook fails). The `GET /v1/comments?block_id={id}` endpoint returns comments sorted by `last_edited_time` with cursor pagination, but the document doesn't specify a cursor strategy for incremental comment sync.
2. **How to detect comment edits/deletions** — requires caching `comment.last_edited_time` and diffing on each poll.

**Correction:** Add to polling fallback:
```
Comment sync strategy:
1. On page appearing in `last_edited_time` poll results, query GET /v1/comments?block_id={page_id}
2. Cache last seen comment.id + comment.last_edited_time per block_id
3. On re-poll, diff returned comments against cache:
   - New comment.id not in cache → new comment event
   - comment.last_edited_time increased → comment updated event
   - comment.id missing from response but in cache → comment deleted event
```

---

## Finding 10 — `no_self_retrigger` implementation: correctly documented

**Affected flow:** Bot comment loop prevention.

Section 7 ("`no_self_retrigger` Implementation") correctly documents:
- Store bot user id from `GET /v1/users/me` at setup
- Compare `data.comment.created_by.id` against stored bot id
- Skip if match

**Correct as documented. No change needed.**

---

## Finding 11 — Bot-authored content filtering: available via payload

**Affected flow:** Loop prevention, bot comment detection.

The `comment.created` webhook payload includes `data.comment.created_by.id`. This can be compared against the bot's user id stored at setup. The document correctly identifies this as the mechanism for `no_self_retrigger`.

**No issue.**

---

## Finding 12 — Eventual-consistency gap: documented for `page.content_updated`

**Affected flow:** Property change detection timing.

The document's gotcha #4 correctly notes: "`page.content_updated` is batched; not suitable for real-time triggers. Use `comment.created` and `page.locked` for immediate detection."

However, the document does not note that `page.content_updated` fires **before** the updated content is readable via API in some cases. This is a known Notion behavior — webhook delivery may precede API-readability by a short window (seconds to low tens of seconds for aggregated events).

**Correction:** Add to "Known Gotchas" (#10): `page.content_updated` webhook may fire before the updated page content/properties are readable via `GET /v1/pages/{id}`. Implement a read-backoff with retry: after receiving `page.content_updated`, wait 2-3 seconds before fetching the page, then retry up to 3 times with exponential backoff before treating as a false alarm.

---

## Finding 13 — `data_source.schema_updated` event: correct, limited scope

**Affected flow:** Database schema change detection.

The document lists `data_source.schema_updated` (added 2025-09-03) as a webhook event. This event fires when a data source's schema changes. The document correctly scopes it.

However, `data_source.schema_updated` is for connected databases (data sources synced from external systems). It does NOT fire on regular database property schema changes (adding/removing columns). The document's gotcha #13 confirms: "database schema changes ... do NOT fire webhooks."

**Correction:** The event table in Section 3 should note that `data_source.schema_updated` applies only to connected/external databases, not standard Notion databases. For standard database schema changes, polling via `GET /v1/databases/{id}` is required.

---

## Summary

| Category | Status | Notes |
|---|---|---|
| `comment.created` webhook | CORRECT | Immediate delivery, correct payload shape |
| `page.content_updated` webhook | LIMITED | Aggregated/batched only; not real-time |
| `page.locked` webhook | CORRECT | Immediate delivery |
| `data_source.schema_updated` | CORRECT | Only for connected databases |
| `page.created` event | MISSING | No webhook; polling required |
| `page.property_updated` event | MISSING | No granular property webhooks |
| Status change detection | POLLING-ONLY | No real-time path |
| Label/tag add/remove detection | POLLING-ONLY | No real-time path |
| Assignee change detection | POLLING-ONLY | No real-time path |
| Close/resolve detection | POLLING-ONLY | No webhook for `in_trash` changes |
| Mention detection | CORRECT | Via `comment.created` rich_text parsing |
| `comment.updated` event | MISSING | No webhook; polling required |
| `comment.deleted` event | MISSING | No webhook; polling required |
| Signature verification (HMAC-SHA256) | CORRECT | `X-Notion-Signature: sha256={...}` |
| Replay protection / timestamp | NOT DOCUMENTED | Implement own deduplication via `event.id` |
| At-least-once delivery | CORRECT | Documented |
| Polling fallback for new items | INCOMPLETE | Missing cursor strategy for comment sync |
| Bot loop prevention | CORRECT | `created_by.id` comparison available |
| Eventual-consistency gap | PARTIAL | `page.content_updated` batching noted, API-readability delay not noted |

**Bottom line:** SupportAgent's Notion connector can handle comment-triggered events in real time via `comment.created`. All property-change events (status, labels, assignee, close/resolve) require polling with `last_edited_time` as the cursor. The connector must implement its own deduplication via the payload `id` field since Notion does not document a timestamp-based replay protection mechanism.