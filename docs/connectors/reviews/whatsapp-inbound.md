# WhatsApp Inbound Events Review

**Reviewed file:** `docs/connectors/whatsapp.md`
**Reviewer:** inbound-events audit
**Scope:** webhook events, signature verification, polling fallback, payload shapes, replay protection, loop prevention
**Excluded:** auth, endpoint CRUD, rate limits

---

## Verdict

**Needs fixes before this connector ships.** Two critical issues: a signature algorithm mismatch (ECDSA claimed, HMAC-SHA256 actual), and a missing webhook field (`message_edits`). Several payload path gaps and semantics gaps also need addressing.

---

## Findings

### 1. [CRITICAL] Signature algorithm — ECDSA claimed, HMAC-SHA256 actual

**Affected:** Sections 2.5 (Message Webhook Signature), 10.13 (ECDSA Signature)

**What is wrong:**
Section 2.5 states: "Meta signs every inbound webhook delivery using **ECDSA** (curve: P-256)." Then Section 10.13 repeats: "X-Hub-SHA256 uses **ECDSA** (P-256 curve), not HMAC-SHA256."

Both are wrong. `X-Hub-SHA256` on WhatsApp Cloud API is verified using **HMAC-SHA256** with the app secret as the key. ECDSA (P-256) is used by Facebook for access token signing, not for webhook payloads.

The verification code in Section 2.5 is actually correct — it uses `crypto.createHmac('sha256', appSecret)` — but the surrounding prose contradicts it and will mislead implementers.

**Correction:** Remove all references to ECDSA. The header is `X-Hub-SHA256`. The algorithm is HMAC-SHA256. The key is the Meta App Secret. The raw request body (byte-for-byte string, not parsed JSON) is what gets signed. No timestamp field is included in the signed payload.

```javascript
// Corrected (keep existing code, fix the prose):
const signature = req.headers['x-hub-sha256'];
const body = req.rawBody; // raw string bytes
const expected = crypto
  .createHmac('sha256', appSecret)
  .update(body, 'utf8')
  .digest('hex');
```

---

### 2. [CRITICAL] Missing `message_edits` webhook field

**Affected:** Section 3.1 (Webhook Events)

**What is wrong:**
The documented webhook fields are `messages`, `message_deliveries`, `message_reads`, `message_reactions`, `conversations`. This is missing `message_edits`.

WhatsApp Cloud API added the `message_edits` webhook field in 2024. When a user edits a message within the WhatsApp editor window (~30 minutes), Meta delivers a webhook with `field: "message_edits"` containing the edited message with a new `id` and the original edited message's `id` in `context.edited`.

**Correction:** Add to the webhook fields table in Section 3.1:

| Field | When fired |
|---|---|
| `message_edits` | Customer edited a message within the edit window |

Add a payload example in Appendix A:

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA-ID",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": {
          "display_phone_number": "15551234567",
          "phone_number_id": "PHONE-NUMBER-ID"
        },
        "contacts": [...],
        "messages": [{
          "from": "15559876543",
          "id": "wamid.new-id-after-edit",
          "timestamp": "1713465700",
          "type": "text",
          "text": { "body": "Edited message content" },
          "context": {
            "edited": "wamid.original-message-id"
          }
        }]
      },
      "field": "message_edits"
    }]
  }]
}
```

For SupportAgent: treat edited messages as an update to the existing message with `id = context.edited`. Do not create a new item.

---

### 3. [HIGH] `authorName` assumes single contact without note

**Affected:** Section 3.5, Table in Section 3.5 — `authorName` path

**What is wrong:**
The path `$.entry[0].changes[0].value.contacts[0].profile.name` only maps to the first contact. A single inbound message can include multiple contacts (e.g., `type: "contacts"` with a vCard). The document does not warn about this.

Additionally, the `name` field is the customer's WhatsApp display name — set by them, not verified. It can be empty, a nickname, or a business name. The document mentions this in Section 7.2 but not as a caveat on the `authorName` persistence path.

**Correction:** Add a note to the `authorName` row in Section 3.5:
> Note: Only maps `contacts[0]`. For `type: contacts` messages, this is the first contact only. The name is self-reported and may be empty or unreliable.

Also clarify the identity path in the table: `authorName` defaults to `contacts[0].profile.name` but for `type: contacts` messages, extract from `contacts[*].name` as appropriate for your use case.

---

### 4. [HIGH] `metadata.phone_number_id` not in persistence table

**Affected:** Section 3.5 (Payload Fields to Persist)

**What is wrong:**
The persistence table is missing `phoneNumberId` (the business phone number that received the message). The path is `$.entry[0].changes[0].value.metadata.phone_number_id`. This is critical for multi-phone-number WABAs and for routing.

**Correction:** Add to the table:

| Field | Path |
|---|---|
| `phoneNumberId` | `$.entry[0].changes[0].value.metadata.phone_number_id` |
| `wabaId` | `$.entry[0].id` (the entry-level `id`, not the `metadata` field) |

The `wabaId` at entry level is also missing from the table. Without it, multi-WABA deployments cannot route the event.

---

### 5. [MEDIUM] `replyToId` path is correct but the `context` shape is incomplete

**Affected:** Sections 3.5 and 4.7

**What is wrong:**
The document correctly identifies `replyToId` as `$.entry[0].changes[0].value.messages[0].context.id`. However, for the `message_edits` field, the context field is `context.edited` (not `context.id`). The document should note this distinction.

**Correction:** In Section 3.5, under `replyToId`, add:
> For `message_edits` field: the parent message ID is at `messages[0].context.edited`, not `messages[0].context.id`.

Also in Appendix A's `message_edits` example, ensure `context.edited` is shown (see finding #2 above).

---

### 6. [MEDIUM] At-least-once delivery semantics not explicitly called out

**Affected:** Section 3.3 (Retry / Delivery Semantics)

**What is wrong:**
Section 3.3 correctly describes the retry window (7 retries, exponential backoff) and notes no replay API. However, it does not state the delivery guarantee model. Meta may deliver the same message multiple times (e.g., on webhook endpoint restart, or transient failures before acknowledgment). This means SupportAgent must deduplicate on `messages[0].id` (the wamid).

**Correction:** Add to Section 3.3:
> **At-least-once delivery:** Meta may deliver the same message more than once (e.g., on endpoint restart or before acknowledgment). SupportAgent must deduplicate on `messages[0].id` (the wamid) before processing. Store processed wamids and check before acting.

---

### 7. [MEDIUM] `replyToId` logic for our own outbound is correct but needs emphasis

**Affected:** Section 7.3 (Bot Identity for no_self_retrigger)

**What is wrong:**
The loop prevention strategy (checking `outbound_message_ids`) is correctly described. However, the document should also clarify that when a customer **replies** to our outbound message, the `context.id` in the reply webhook equals our outbound wamid — so the inbound IS a new event (a customer reply), not an echo of our own message. The distinction matters: we skip pure echoes, but we process replies to our messages.

The current text at line 558 says "this is a user reply → process normally" but the logic flow isn't explicit.

**Correction:** In Section 7.3, add a concrete decision tree:

```
On inbound message:
1. Extract wamid = messages[0].id
2. Extract contextId = messages[0].context?.id
3. If wamid ∈ outbound_message_ids → skip (echo of our own send)
4. If contextId ∈ outbound_message_ids → this is a customer reply → PROCESS
5. Else → new inbound from customer → PROCESS
```

---

### 8. [LOW] No timestamp tolerance — document is silent

**Affected:** Section 2.5 (Webhook Signature)

**What is wrong:**
Unlike Slack (3-5 min window) or Teams, WhatsApp Cloud API webhook signatures do not include a timestamp field. There is no timestamp tolerance. The signature covers only the raw body. The document is correct to not mention a tolerance window, but this should be stated explicitly so implementers don't look for a `X-Hub-Timestamp` header.

**Correction:** In Section 2.5, add:
> WhatsApp does not include a timestamp in the signed payload. There is no `X-Hub-Timestamp` header and no tolerance window. Only the raw body bytes are signed.

---

### 9. [LOW] `@mentions` are not applicable — should be documented as N/A

**Affected:** Section 3.1 and Section 6

**What is wrong:**
WhatsApp is a 1:1 messaging platform. There is no group @mention concept. The document does not explicitly state that @mention detection is not applicable, which could lead to confusion when mapping against the generic connector interface (which expects `mention` as a trigger).

**Correction:** In Section 3.1, add a row:

| Field | When fired | SupportAgent relevance |
|---|---|---|
| `@mentions` | N/A | WhatsApp is 1:1 messaging; no group chat mentions |

In Section 6 (Triggers We Can Match On), add `N/A — no group mentions on WhatsApp` to the "What we CANNOT match on" list.

---

### 10. [LOW] Button reply `context.from` is not a business phone field

**Affected:** Appendix A, Button Reply payload

**What is wrong:**
The Button Reply example shows:
```json
"context": {
  "from": "BUSINESS-PHONE",
  "id": "wamid.original-message"
}
```
The `context.from` field is not reliable as a "business phone" identifier. In practice, `context.from` mirrors the sender — it may be the business phone or omitted in some payload variants. Relying on it is fragile.

**Correction:** Remove `context.from` from the button reply example. The reliable business phone identifier is always `metadata.phone_number_id` at the entry level, not `context.from`.

---

### 11. [LOW] Polling fallback is realistic — no issues found

**Affected:** Section 3.4 (Polling Fallback)

**Verdict:** The polling story is accurate and complete. No native `updated_since` or cursor-based polling for messages is correct. The recommendation to use the Read Messages endpoint with stored checkpoint (last processed wamid) is the right approach. The lack of a bulk list endpoint is correctly noted. No changes needed.

---

### 12. [INFO] `hsm`, `order`, and other legacy message types omitted

**Affected:** Section 3.2 and Appendix A

**What is wrong:**
The document covers `text`, `image`, `document`, `location` but omits `audio`, `video`, `sticker`, `contacts`. These are all valid inbound `type` values. The document is not wrong for focusing on the main support-relevant types, but completeness is a concern.

**Correction:** Add `audio`, `video`, `sticker`, `contacts` to the list of message types in Section 3.2, with brief payload shapes. At minimum:

- `type: audio` → `audio: { id, mime_type, sha256 }`
- `type: video` → `video: { id, mime_type, sha256, caption? }`
- `type: sticker` → `sticker: { id, mime_type, sha256 }`
- `type: contacts` → `contacts: [{ wa_id, profile: { name }, name: { first_name, last_name, formatted_name }, phones, emails, addresses }]`

---

## Summary of Required Changes

| Priority | Finding | Section |
|---|---|---|
| Critical | Remove ECDSA references; confirm HMAC-SHA256 only | 2.5, 10.13 |
| Critical | Add `message_edits` webhook field + payload example | 3.1, Appendix A |
| High | Add `phoneNumberId` and `wabaId` to persistence table | 3.5 |
| High | Note multi-contact caveat on `authorName` path | 3.5 |
| Medium | Clarify `context.edited` for edits vs `context.id` for replies | 3.5, 7.3 |
| Medium | Add at-least-once deduplication requirement | 3.3 |
| Medium | Add explicit loop-prevention decision tree | 7.3 |
| Low | Explicitly state no timestamp tolerance | 2.5 |
| Low | Document `@mentions` as N/A | 3.1, 6 |
| Low | Remove `context.from` from button reply example | Appendix A |
| Low | Add `audio`, `video`, `sticker`, `contacts` message types | 3.2, Appendix A |

---

## Events Coverage Assessment

| SupportAgent event need | WhatsApp capability | Status |
|---|---|---|
| New item / new message | `messages` field | Covered |
| New comment | `messages` field + `context.id` for reply threading | Covered |
| Status change | Only delivery receipts (`message_deliveries`) and read receipts (`message_reads`) | Partially covered — no issue-status model |
| Label/tag add/remove | None — no labels API | Not applicable |
| Mention | None — WhatsApp is 1:1, no group @mentions | Not applicable |
| Reply | `messages` + `context.id` | Covered |
| Close/resolve | None — WhatsApp is not an issue tracker | Not applicable |
| Assign | None — no assignee concept | Not applicable |
| Message edited | `message_edits` field | **Missing — must add** |
| Reaction to our message | `message_reactions` field | Covered |
