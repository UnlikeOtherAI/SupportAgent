# Asana Connector — Inbound Events Audit Review

**Reviewed file:** `docs/connectors/asana.md`
**Scope:** Webhook/polling event intake, payload shapes, signature verification, delivery guarantees, mention detection, bot self-retrigger prevention
**Date:** 2026-04-18

---

## Verdict: CONDITIONAL PASS — Requires corrections

The webhook/event intake story is mostly sound, but three issues block production readiness: incorrect signature verification implementation, incorrect delivery guarantee (and retry window), and missing tag story types.

---

## Findings

### 1. Signature Verification — WRONG algorithm and header

**Section:** 3.4 Webhook Signature Verification

**Problem:** The document states:
> "Asana does NOT use HMAC signatures on individual events. Instead... Verify by matching `X-Hook-Secret` header OR by re-registering webhook."

**Correction:** Asana **does** sign payloads with HMAC-SHA256.

- **Algorithm:** SHA256 HMAC
- **Header name:** `X-Hook-Signature`
- **Bytes signed:** Raw request body (entire JSON payload)
- **Secret:** The value from `X-Hook-Secret` received during handshake

Verification must compute `HMAC-SHA256(secret, raw_body)` and compare base64/sha256-hex against the `X-Hook-Signature` header value.

**Why it matters:** Without proper signature verification, any entity that can reach your webhook endpoint can inject fake events.

---

### 2. Delivery Guarantee — WRONG retry semantics

**Section:** 3.5 Webhook Retry Semantics

**Problem:** The document states:
> "Asana retries failed deliveries with exponential backoff. If endpoint fails 3 times, webhook is automatically disabled."

**Correction:** Asana's actual behavior:
- **Delivery guarantee:** At-most-once (not at-least-once). Events CAN be missed in rare circumstances.
- **Retry window:** Up to 24 hours of consecutive failures before webhook is deleted
- **Retry strategy:** Exponential backoff, but no fixed retry count is published

**Why it matters:** If the document said "at-least-once" or implied guaranteed delivery, the polling fallback would be undersized. At-most-once means SupportAgent MUST poll for reconciliation regardless of webhook health.

---

### 3. Tag Events — MISSING story types

**Section:** 3.6 Webhook Event Types

**Problem:** The table lists only `added_to_project` and `removed_from_project` under project events. Tag operations are entirely absent.

**Correction:** Asana fires **separate story types** for tags:

| Story Type | Description | Useful For |
|------------|-------------|------------|
| `tag_added` | Tag added to task | Tag trigger |
| `tag_removed` | Tag removed from task | Tag trigger |
| `added_to_project` | Task added to project | Project intake trigger |
| `removed_from_project` | Task removed from project | |

**Source:** Asana webhook resource event map shows Tag as a first-class resource with `added`, `changed`, `deleted`, `undeleted` actions. Story events on tasks for tags use `tag_added` and `tag_removed` types.

**Why it matters:** SupportAgent's tag-based triggers will never fire without `tag_added`/`tag_removed` handling.

---

### 4. Custom Field Changes — MISSING story type

**Section:** 3.6 Webhook Event Types

**Problem:** No mention of custom field change events.

**Correction:** When a task's custom field value changes, Asana fires a story with:
- `type: "changed_custom_field"` (or `changed` with `field: "custom_fields.<field_gid>"`)
- The `change` object contains `field`, `new_value`, `old_value`

**Recommendation:** Add to the table:
| Story Type | Description | Useful For |
|------------|-------------|------------|
| `changed_custom_field` | Custom field value changed | Status/priority triggers |

**Note:** Not all custom field changes produce a dedicated story type. Some appear as `changed` with `field` referencing `custom_fields.<gid>`. Both patterns should be handled.

---

### 5. Story Action Mismatch — Wrong actions on non-comment stories

**Section:** 3.7 Webhook Payload Structure

**Problem:** The example shows `"action": "changed"` on a non-comment story (the status change example). Per Asana documentation, story types OTHER than `comment` only support `added`, `removed`, and `undeleted` actions.

**Correction:**
- **Comment stories:** Can be `added`, `changed`, `removed`, `undeleted`
- **Non-comment stories (all others):** Only `added`, `removed`, `undeleted`

The example is incorrect for a status change story. A `changed_status` story fires with `action: "changed"`, but the `changed_status` story type is the exception, not the rule. Verify with Asana documentation that `changed_status` is indeed a valid non-comment story type that can carry the `changed` action.

---

### 6. Mention Detection — Incomplete guidance

**Section:** 6.3 Mentions of Bot User

**Problem:** The document says to parse `story.text` for bot mentions. This works but is fragile.

**Correction:** Mentions should be detected via:
1. **Primary:** Parse `story.text` for `@<user_gid>` or `@me` patterns
2. **Supplementary:** If `story.hearts` or `story.likes` contains our bot user, the bot was acknowledged
3. **Note:** Asana does not provide a dedicated `mentions[]` array in story payloads. A separate API lookup on the task is required to enumerate all mentions in a comment.

**Why it matters:** Complex comments with multiple mentions require a second API call to resolve. Document this as a polling/lookup step, not just inline parsing.

---

### 7. Eventual Consistency — NOT documented

**Section:** 3.x (missing section)

**Problem:** The document does not address Asana's eventual consistency guarantees.

**Correction:** Add note:

> **Eventual Consistency:** Asana does not guarantee events arrive in chronological order. Stories created within one hour may be consolidated into a single event. Always check `event.created_at` before processing. For comment detection, poll the task's `/stories` endpoint and use `created_at` for dedup, not just story GID.

---

### 8. Bot Self-Retrigger Prevention — CORRECT but incomplete

**Section:** 7.3 Bot Identity Detection

**Problem:** The document correctly identifies `event.user.gid` for loop prevention, but does not address comment edits.

**Correction:** Add:

> When SupportAgent edits a comment via `PUT /stories/{gid}`, this may generate a webhook with `action: "changed"` and `type: "comment"`. The `user` field will be our bot's user GID, so `event.user.gid === bot_gid` is sufficient for edit self-retrigger as well.

---

### 9. Polling Fallback — Generally correct, missing mention detection

**Section:** 3.8 Polling Fallback Strategy

**Problem:** The polling strategy uses `modified_since` on tasks, but does not address how to detect:
1. New comments on existing tasks (need to poll `/tasks/{gid}/stories`)
2. Mentions via polling

**Correction:** Expand polling strategy:

```
Primary: Webhooks for new tasks and task field changes
Fallback poll (tasks): GET /tasks?workspace=<gid>&modified_since=<cursor>
Fallback poll (comments): GET /tasks/{gid}/stories?modified_since=<cursor>
```

- Store separate sync cursors for tasks and per-task stories
- Mention detection via polling requires fetching the story's full `text` and parsing for `@<bot_gid>`

---

### 10. Story Resource Type — Minor inconsistency

**Section:** 3.7 Webhook Payload Structure (comment example)

**Problem:** The comment example shows:
```json
"resource": {
  "gid": "9876543210",
  "resource_type": "story",
  "name": ""
}
```

But for comments, the parent is the task, not the story itself. The `resource.resource_type` for a comment story should still be `story`, but the `parent` field correctly identifies the task.

**Verification needed:** Confirm whether `resource.gid` on comment events equals the story GID or the task GID. Some Asana documentation suggests `resource.gid` is the task GID with `resource_type: "story"` indicating it's a story event on that task.

---

## Summary of Required Changes

| Priority | Section | Issue | Fix |
|----------|---------|-------|-----|
| P0 | 3.4 | Wrong signature verification | Use HMAC-SHA256 with `X-Hook-Signature` header |
| P0 | 3.5 | Wrong delivery guarantee | Change to at-most-once; 24-hour retry window |
| P0 | 3.6 | Missing tag events | Add `tag_added`, `tag_removed` story types |
| P1 | 3.6 | Missing custom field events | Add `changed_custom_field` or `changed` with `custom_fields.<gid>` |
| P1 | 3.x | Missing eventual consistency note | Add 24-hour consolidation warning |
| P2 | 6.3 | Incomplete mention detection | Note that mentions require separate API lookup |
| P2 | 3.8 | Incomplete polling strategy | Add per-task story polling for comments |
| P2 | 7.3 | Incomplete self-retrigger | Note that edit events also need loop prevention |

---

## Events Checklist — Verified Coverage

| Event | Story Type | Action | Status |
|-------|-----------|--------|--------|
| New item created | `created` | `added` | ✓ Covered |
| New comment | `comment` | `added` | ✓ Covered |
| Comment edited | `comment` | `changed` | ⚠️ Covered but action mismatch concern |
| Status change | `changed_status` | `changed` | ✓ Covered |
| Tag added | `tag_added` | `added` | ✗ Missing |
| Tag removed | `tag_removed` | `removed` | ✗ Missing |
| Mention (bot) | `comment` story | `added` | ⚠️ Partial (no mention array) |
| Reply | `comment` | `added` | ✓ Covered |
| Close/resolve | `marked_complete` | `added` | ✓ Covered |
| Assignee change | `assigned` | `added` | ✓ Covered |
| Custom field change | `changed_custom_field` | `changed` | ✗ Missing |
| Reopen | `marked_incomplete` | `added` | ✓ Covered |

---

## Sources Consulted

- [Asana Webhooks Guide](https://developers.asana.com/docs/webhooks)
- [Asana Webhook Events Reference](https://developers.asana.com/docs/webhook-events)
- [Asana Creating Webhooks API](https://developers.asana.com/reference/createwebhook)
