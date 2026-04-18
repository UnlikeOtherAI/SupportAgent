# Zendesk Connector — Inbound Events Review

**Verdict: REVISION REQUIRED**

The inbound event intake story has significant issues across event naming, payload structure, signature verification, and deduplication. Several events listed do not match Zendesk's actual webhook delivery format.

---

## Event Names

### CRITICAL: Wrong event name prefix

**Affected:** All webhook events in Sections 3, 6, and 11

**Problem:** The document lists bare event names (`ticket.created`, `ticket.updated`, `ticket.status.changed`, `ticket.comment.created`, etc.) but Zendesk delivers webhooks with the `zen:event-type:` prefix.

**Correction:** All event names must use the full prefix. Confirmed real-world format from production integrations:

| Document (Wrong) | Actual Zendesk Event Name |
|-----------------|--------------------------|
| `ticket.created` | `zen:event-type:ticket.created` |
| `ticket.updated` | `zen:event-type:ticket.updated` |
| `ticket.status.changed` | `zen:event-type:ticket.status.changed.solved` (or `.open`, `.pending`, `.hold`, `.closed`) |
| `ticket.comment.created` | `zen:event-type:ticket.CommentAdded` |
| `ticket.priority.changed` | N/A — delivered as `zen:event-type:ticket.changed` with field diff in payload |
| `ticket.assignee.changed` | N/A — delivered as `zen:event-type:ticket.changed` |
| `ticket.tags.changed` | N/A — delivered as `zen:event-type:ticket.changed` |
| `ticket.responder_assigned` | N/A — delivered as `zen:event-type:ticket.changed` |

**Why this matters:** If SupportAgent registers webhook handlers expecting `ticket.updated`, it will never receive events. Zendesk sends `zen:event-type:ticket.updated`, `zen:event-type:ticket.changed`, etc.

---

### CRITICAL: `ticket.comment.created` does not exist

**Affected:** Section 3 (Event types table), Section 6 (Trigger matchers), Section 11 (MVP webhook events)

**Problem:** `ticket.comment.created` is not a valid Zendesk webhook event name.

**Correction:** Use `zen:event-type:ticket.CommentAdded` for new comments on tickets.

---

### CRITICAL: `ticket.status.changed` is underspecified

**Affected:** Section 3, Section 11

**Problem:** Status changes are not delivered as a single `ticket.status.changed` event. Zendesk delivers separate events per status value.

**Correction:** Handle these specific events for status-driven workflows:
- `zen:event-type:ticket.status.changed.solved`
- `zen:event-type:ticket.status.changed.open`
- `zen:event-type:ticket.status.changed.pending`
- `zen:event-type:ticket.status.changed.hold`
- `zen:event-type:ticket.status.changed.closed`

Alternatively, listen for `zen:event-type:ticket.changed` and inspect `ticket.status` in the payload to detect transitions.

---

### MISSING: Generic `ticket.changed` event

**Affected:** Section 3 (Event types table), Section 11

**Problem:** The document does not mention `zen:event-type:ticket.changed`, which is the parent event for field-level changes (priority, assignee, tags, custom fields).

**Correction:** Add `zen:event-type:ticket.changed` to the event types table. This event fires for any ticket field modification and includes previous/new values in the payload.

---

### MISSING: `ticket.sla.status_changed` — verify existence

**Affected:** Section 3 (Event types table)

**Problem:** `ticket.sla.status_changed` is listed but unverified. SLA events may use different naming or be unavailable on all plans.

**Correction:** Verify SLA event availability per plan tier. If unavailable, remove from the event table and note as Enterprise-only.

---

## Payload Structure

### CRITICAL: Wrong top-level field names

**Affected:** Section 3 (Payload Fields to Persist)

**Problem:** The document uses flat paths like `ticket.id`, `ticket.subject`, `ticket.description`, but Zendesk webhook payloads nest these under a `ticket` object key:

```json
{
  "type": "zen:event-type:ticket.created",
  "webhook_id": "12345",
  "account_id": 67890,
  "ticket": {
    "id": 123,
    "subject": "Help needed",
    "description": "...",
    "status": "open",
    "priority": "normal",
    "requester_id": 456,
    "assignee_id": 789,
    "organization_id": 111,
    "group_id": 222,
    "brand_id": 333,
    "external_id": "EXT-123",
    "tags": ["bug", "urgent"],
    "custom_fields": {...},
    "via": {...},
    "satisfaction_rating": {...},
    "created_at": "2026-04-18T10:00:00Z",
    "updated_at": "2026-04-18T10:00:00Z",
    "due_at": null,
    "url": "https://acme.zendesk.com/api/v2/tickets/123.json"
  },
  "requester": {
    "id": 456,
    "name": "Jane Doe",
    "email": "jane@example.com"
  },
  "assignee": {
    "id": 789,
    "name": "Agent Smith",
    "email": "agent@acme.com"
  },
  "current_user": {...}
}
```

**Correction:** Update all field paths in Section 3:
- `ticket.id` → `payload.ticket.id` (correct as-is)
- `ticket.subject` → `payload.ticket.subject` (correct as-is)
- `ticket.description` → `payload.ticket.description` (correct as-is)
- `ticket.requester_id` → `payload.ticket.requester_id` or `payload.requester.id` for enriched object

The paths are syntactically correct but the surrounding context (that `ticket` is nested under a top-level `ticket` key in the JSON payload) must be made explicit. The document's phrasing implies these are top-level, but they are not.

---

### MISSING: Comment event payload structure

**Affected:** Section 3, Section 6

**Problem:** The document does not describe the payload shape for `zen:event-type:ticket.CommentAdded` events. Comment events likely include the comment body, author, and ticket reference.

**Correction:** Add payload structure for comment events:
```json
{
  "type": "zen:event-type:ticket.CommentAdded",
  "ticket_id": 123,
  "comment": {
    "id": 456,
    "body": "Comment text",
    "html_body": "<p>Comment text</p>",
    "author_id": 789,
    "public": true,
    "attachments": [...]
  },
  "ticket": {...}
}
```

---

## Signature Verification

### CRITICAL: Missing `X-Zendesk-Webhook-Signature-Nonce` header

**Affected:** Section 3 (Signature Verification)

**Problem:** The document only mentions two headers:
```
X-Zendesk-Webhook-Signature: {base64_signature}
X-Zendesk-Webhook-Signature-Algorithm: HMAC-SHA256
```

Zendesk actually sends **three** signature-related headers:
```
x-zendesk-webhook-signature: {base64_signature}
x-zendesk-webhook-signature-timestamp: {unix_timestamp}
x-zendesk-webhook-signature-nonce: {random_nonce}
```

**Correction:** Update the signature verification section. The correct signing string is:
```
HMAC-SHA256(secret, timestamp + nonce + rawBody)
```
Where the output is base64-encoded.

---

### MISSING: Timestamp tolerance verification

**Affected:** Section 3 (Signature Verification)

**Problem:** The document does not mention timestamp tolerance. Without this, replay attacks are possible.

**Correction:** Add timestamp tolerance check. Zendesk webhooks should be rejected if the `x-zendesk-webhook-signature-timestamp` is more than 5 minutes old (300 seconds). This prevents replay of captured webhook requests.

---

## Deduplication and Replay Protection

### MISSING: `X-Zendesk-Webhook-Id` header for deduplication

**Affected:** Section 3 (Retry / Delivery Semantics)

**Problem:** The document mentions deduplication by `zendesk_webhook_id + event timestamp`, but:
1. The header is `X-Zendesk-Webhook-Id` (not `zendesk_webhook_id`)
2. The document doesn't mention this header at all

**Correction:** Add `X-Zendesk-Webhook-Id` to the webhook intake documentation. Use this value combined with `payload.type` and `payload.ticket.id` for deduplication keys.

---

### MISSING: Deduplication window

**Affected:** Section 3 (Retry / Delivery Semantics)

**Problem:** The document says "deduplicate by `zendesk_webhook_id` + event timestamp" but doesn't specify how long to store deduplication keys.

**Correction:** Zendesk's circuit breaker retry window is unspecified but typically retries for ~24 hours. Store deduplication keys for at least 1 hour minimum, 24 hours recommended to handle delayed retries.

---

## Polling Fallback

### PARTIALLY CORRECT: Incremental Export API

**Affected:** Section 3 (Polling Fallback), Section 9

**Problem:** The polling endpoints listed are correct, but:
1. `start_time` is Unix seconds — document says "not milliseconds, as of Apr 2025" which is the correct current behavior, but this date-based caveat should be removed as it implies a future change
2. Comment detection strategy is underspecified

**Correction:** For detecting new comments on existing tickets via polling:
1. Poll `incremental/tickets/cursor` to find tickets with `updated_at` changes
2. For each updated ticket, fetch `GET /api/v2/tickets/{id}/comments.json` and diff against stored comment IDs
3. There is no "comment created_at" incremental export — comment detection requires the two-step ticket-then-comments approach

---

### MISSING: Polling strategy for comment-only changes

**Affected:** Section 3 (Polling Fallback)

**Problem:** If a comment is added to a ticket, the ticket's `updated_at` changes, so the incremental ticket export will surface it. However, the connector needs to know which specific comment is new.

**Correction:** Document that polling must:
1. Track last known `updated_at` per ticket
2. When `updated_at` advances, fetch comments and diff by `comment.id`
3. New comment IDs since last sync are the inbound comments to process

---

## Mention Detection

### CORRECT BUT INCOMPLETE: Mention detection via comment body

**Affected:** Section 6 (Mentions of Bot User)

**Problem:** The document correctly notes checking `comment.body` for `@{bot_name}` pattern, but:
1. HTML comments wrap mentions in `<tribute>` tags — a simple string search misses these
2. The `html_body` field contains `<tribute>` wrapped mentions that won't match plain `@mention` text

**Correction:** For robust mention detection, search both:
- `comment.body` for `@{display_name}` plain text pattern
- `comment.html_body` for `<tribute>` tag content:
  ```html
  <tribute zdinment="mention">
    <span data-user-id="123">@John Doe</span>
  </tribute>
  ```

Extract `data-user-id` from the HTML to confirm the mentioned user ID matches the bot's `user_id`.

---

## Bot Loop Prevention

### CORRECT: Bot self-detection via `author_id`

**Affected:** Section 7 (Bot Identity)

**Problem:** None — the approach is correct. Store `bot_user_id` at config time and compare against `comment.author_id`.

**Important caveat documented correctly:** There is no "via API" indicator on comments. SupportAgent-commented tickets look identical to agent-commented ones. The `author_id` comparison is the only reliable mechanism.

---

## Eventual Consistency

### DOCUMENTED CORRECTLY: Webhook delay warning

**Affected:** Section 10 (Known Gotchas)

**Problem:** None — the "Webhook Eventual Consistency" note is correct.

**Note:** The Incremental Export API should be used as the authoritative state source for reconciliation, not webhooks.

---

## Summary of Required Changes

| Priority | Issue | Location |
|----------|-------|----------|
| CRITICAL | Prefix all event names with `zen:event-type:` | Sections 3, 6, 11 |
| CRITICAL | Replace `ticket.comment.created` with `zen:event-type:ticket.CommentAdded` | Sections 3, 6, 11 |
| CRITICAL | Split `ticket.status.changed` into per-status events | Sections 3, 11 |
| CRITICAL | Add `zen:event-type:ticket.changed` for field diffs | Section 3 |
| CRITICAL | Add `x-zendesk-webhook-signature-nonce` to signature verification | Section 3 |
| CRITICAL | Add timestamp tolerance (5 min) to signature verification | Section 3 |
| CRITICAL | Add `X-Zendesk-Webhook-Id` header for deduplication | Section 3 |
| HIGH | Document comment event payload structure | Section 3 |
| HIGH | Update mention detection for `<tribute>` HTML tags | Section 6 |
| MEDIUM | Clarify polling strategy for comment diffing | Sections 3, 9 |
| LOW | Remove date-based caveat on `start_time` unit | Section 3 |
| LOW | Verify `ticket.sla.status_changed` event existence | Section 3 |
