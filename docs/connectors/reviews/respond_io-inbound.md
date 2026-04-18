# Respond.io Inbound Events Review

**Verdict: CONDITIONAL PASS — Significant gaps in webhook security, payload verification, and delivery semantics. Do not implement without resolving the critical issues below.**

---

## Critical Issues

### 1. Webhook Subscription Endpoint Is Likely Wrong

**Affected flow:** Webhook registration

**What's wrong:** The document claims:
```
POST https://api.respond.io/v2/integration/{integration}/subscribe
DELETE https://api.respond.io/v2/integration/{integration}/unsubscribe/{webhookId}
```
with `integration` being `n8n-api` or `zapier`. This suggests Respond.io's webhook registration is tied to third-party integration frameworks rather than a generic webhook endpoint.

**Correction:** Respond.io has a dedicated **Integration Management API** (not `n8n-api` integration). The endpoint should be:
```
POST https://api.respond.io/v2/integration-management/subscribe
DELETE https://api.respond.io/v2/integration-management/unsubscribe/{webhookId}
```

**Action required:** Verify the exact integration-management endpoint path. The `integration` path parameter in the current doc suggests either:
1. The endpoint is only available through integration partner frameworks (n8n, Zapier), or
2. The `integration` placeholder is `{integrationType}` and supports values like `webhook` or `custom`

Do not hard-code `n8n-api` as the integration type for SupportAgent's own webhook.

---

### 2. No Signature Verification Documented

**Affected flow:** All webhook intake

**What's wrong:** The document documents Bearer token auth for the REST API but explicitly omits webhook signature verification. The "Webhook Authentication" section only covers how to authenticate when *registering* a webhook, not how to *verify* incoming deliveries.

**Missing:** Every major webhook-receiving platform signs its payloads. Expected at minimum:
- Header name: likely `X-Respond-Signature` or `X-Hub-Signature` or similar
- Algorithm: HMAC-SHA256 expected (SHA1 is deprecated)
- Body bytes that must be signed: raw request body
- Timestamp header if replay protection exists

**Correction:** Research and document:
```
X-Respond-Signature: sha256={hmac_hex}
X-Respond-Timestamp: {unix_timestamp}  // if replay protection exists
```

**Verification code pattern:**
```typescript
const crypto = require('crypto');
const signature = req.headers['x-respond-signature'];
const timestamp = req.headers['x-respond-timestamp'];
const body = req.rawBody; // must use raw body, not parsed JSON

// Check timestamp tolerance (e.g., 5 minutes = 300 seconds)
// const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
// if (parseInt(timestamp) < fiveMinutesAgo) reject();

const expectedSig = 'sha256=' + crypto
  .createHmac('sha256', webhookSecret)
  .update(body)
  .digest('hex');

if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
  reject(new Error('Invalid signature'));
}
```

**Action required:** Find the actual signature header name and algorithm from Respond.io docs. If no signature verification exists, this is a **security gap** that must be flagged.

---

### 3. Retry/Delivery Semantics Are Contradictory

**Affected flow:** Webhook delivery guarantees

**What's wrong:** The document contains two contradictory statements:
- Line ~201: "Respond.io retries webhook delivery with exponential backoff on non-2xx responses"
- Line ~203: "**No guaranteed delivery** — missed webhooks are not replayed"

These are mutually exclusive. Retries with backoff on failure IS a delivery guarantee mechanism.

**Correction:** Clarify the actual retry behavior:
1. Does Respond.io retry on 2xx but no response (timeout)?
2. What's the retry count and intervals?
3. What's the dead-letter behavior after exhausting retries?
4. Is there a webhook event log/replay UI in the dashboard for missed events?

The polling fallback section (lines 205-214) should specify the checkpoint strategy more precisely:
- Store `last_processed_message_id` per contact
- Use `message_id > last_checkpoint` for reconciliation
- But: this requires listing messages per contact, which is O(n) contacts. A workspace-wide "recent messages" endpoint would be more efficient for polling.

---

### 4. Polling Fallback Is Incomplete

**Affected flow:** Polling fallback for missed webhooks

**What's wrong:** The polling fallback only covers:
```http
GET /contact/{identifier}/message/list?limit=50&cursor_id={last_cursor}
```

This requires knowing which contacts to poll. For a workspace with thousands of contacts, you cannot efficiently poll all of them.

**Missing:**
1. Is there a workspace-wide "recent messages" endpoint that returns all messages across all contacts?
2. What sorting does `/message/list` use? The doc says "descending by message_id" but this should be verified.
3. How to handle new contacts (contacts that didn't exist when we stored the last checkpoint)?

**Correction:** Document the polling strategy for full reconciliation:
1. **Primary polling:** If a workspace-wide recent messages endpoint exists, use that with `message_id > checkpoint`
2. **Contact-based polling:** If not, maintain a list of active contacts and poll each
3. **Checkpoint per contact:** Store `last_message_id` per contact, not global
4. **Startup reconciliation:** On connector restart, run a full reconciliation pass

---

### 5. Event Names Need Verification Against Official Docs

**Affected flow:** All webhook event handling

**What's wrong:** The event names listed in the document:
- `NEW_INCOMING_MESSAGE`
- `NEW_OUTGOING_MESSAGE`
- `NEW_COMMENT`
- `CONVERSATION_OPENED`
- `CONVERSATION_CLOSED`
- `NEW_CONTACT`
- `CONTACT_UPDATED`
- `CONTACT_TAG_UPDATED`
- `CONTACT_LIFECYCLE_UPDATED`
- `CONTACT_ASSIGNEE_UPDATED`
- `CALL_ENDED`

These appear to be correct based on the SDK type definitions, but the **exact casing and spelling must be verified** from the official API docs. Respond.io may use:
- Different casing: `new_incoming_message` or `NewIncomingMessage`
- Prefixes: `message.new_incoming` vs `new_incoming_message`
- Versioned namespaces: `v2/new_incoming_message` vs just `new_incoming_message`

**Correction:** Fetch the actual event type enum from Respond.io's Integration Management API:
```http
GET https://api.respond.io/v2/integration-management/supported-events
```

---

### 6. No Mention of Webhook Event ID / Deduplication

**Affected flow:** Webhook idempotency

**What's wrong:** The document doesn't mention whether webhooks include a unique event ID for deduplication. Without an event ID, it's impossible to:
- Detect duplicate deliveries (at-least-once semantics)
- Safely retry processing
- Implement idempotent handlers

**Correction:** Check if the webhook payload includes:
- `event_id` or `id` at the top level
- `webhook_id` identifying which subscription triggered
- Any idempotency key for deduplication

If no event ID exists, the deduplication strategy must be based on `(contact_id, message_id, timestamp)` tuples.

---

### 7. Bot Self-Loop Prevention Incomplete

**Affected flow:** Loop prevention for bot-authored content

**What's wrong:** The document shows:
```json
"sender": {
  "source": "api",
  "user_id": null
}
```

But the `sender.user_id` is `null` for API-sent messages. Without a `user_id`, there's no way to distinguish between:
- Messages sent by SupportAgent
- Messages sent by another API integration or workflow

**Correction:** Clarify whether `user_id` is populated for API-sent messages:
- If yes: store the user ID associated with our API token and filter `sender.source === "api" && sender.user_id === our_user_id`
- If no: our deduplication strategy must use `message_id` returned from the send response, stored in a set, and checked on inbound

The document also doesn't mention whether we can tag/label messages we send for easier filtering.

---

### 8. Mention Detection Not Applicable — Correct

**Finding:** This section is NOT APPLICABLE to Respond.io.

**Rationale:** Respond.io is a messaging/CRM platform, not a collaboration platform with @mention syntax. There are no "mentions" in the traditional sense. The `NEW_COMMENT` event mentions users via `{{@user.123}}` syntax, but that's for *sending* internal notes, not receiving them.

**No correction needed.**

---

### 9. New Comment Webhook Is Low-Priority but Should Be Verified

**Affected flow:** `NEW_COMMENT` event handling

**What's wrong:** The document classifies `NEW_COMMENT` as "Low priority" for MVP but doesn't document the comment webhook payload structure.

**Correction:** Add the `NEW_COMMENT` payload:
```json
{
  "event_type": "NEW_COMMENT",
  "contact_id": 12345,
  "contact": { ... },
  "comment": {
    "id": 67890,
    "text": "Internal note text",
    "author": {
      "id": 111,
      "name": "Agent Name",
      "email": "agent@example.com"
    },
    "created_at": 1713465600
  },
  "timestamp": 1713465600
}
```

Verify: Is `NEW_COMMENT` a separate webhook subscription type, or is it bundled with contact events?

---

### 10. Eventual Consistency Gap Not Documented

**Affected flow:** New inbound message detection

**What's wrong:** Respond.io may have a brief delay between when a message is received and when it's queryable via the API. The polling fallback section doesn't address this.

**Correction:** Add a note:
> **Eventual consistency note:** After receiving a `NEW_INCOMING_MESSAGE` webhook, there may be a brief delay (typically < 1 second, but can be up to 5 seconds) before the message is queryable via `GET /contact/{identifier}/message/list`. When using polling fallback, add a small delay or retry window before querying for new messages.

---

### 11. No Dead-Letter / Webhook Log Documentation

**Affected flow:** Webhook reliability

**What's wrong:** Respond.io has a webhook management UI in the dashboard. The document doesn't mention:
1. Whether failed webhooks are visible/replayable in the dashboard
2. Whether there's an API to list webhook delivery failures
3. Whether SupportAgent can manually trigger a replay from the dashboard

**Correction:** Document the webhook observability story:
- Webhook logs accessible in Respond.io dashboard → Settings → Integrations → Webhooks
- Failed deliveries can be manually retried from the dashboard
- No API access to webhook logs mentioned in public docs

---

## Minor Issues

### 12. `sender.user_id` Type Is Unclear

**Affected flow:** Loop prevention

**What's wrong:** The `sender` object shows `user_id: null` but doesn't clarify the type or when it's populated.

**Correction:** Document the `sender` field type more precisely:
```typescript
interface MessageSender {
  source: 'user' | 'api' | 'workflow' | 'ai_agent' | 'broadcast' | 'echo';
  user_id: number | null;  // Populated only for 'user' source
  name?: string;
  avatar?: string;
}
```

---

### 13. `message_id` Type Is Mixed

**Affected flow:** Message deduplication

**What's wrong:** The document uses `message_id` (numeric) in some places and `channel_message_id` (string, e.g., `wamid.xxx`) in others. The dedup strategy should clarify which to use.

**Correction:** State explicitly:
- `message_id`: Respond.io's internal message ID (numeric, use for dedup)
- `channel_message_id`: The channel's native message ID (string, for reference only)

---

## Summary of Required Actions Before Implementation

1. **Verify webhook subscription endpoint** — is it `integration/{type}/subscribe` or `integration-management/subscribe`?
2. **Document signature verification** — find header name (`X-Respond-Signature`?), algorithm (HMAC-SHA256), and implement verification
3. **Clarify retry semantics** — resolve the contradiction between "retries with backoff" and "no guaranteed delivery"
4. **Add workspace-wide polling endpoint** — or document the per-contact polling strategy
5. **Verify event type names** — fetch from official API, not guess from SDK types
6. **Add deduplication strategy** — based on `(contact_id, message_id)` or event ID
7. **Document comment webhook payload** — even if low priority, the shape should be known
8. **Add eventual consistency note** — brief delay between webhook and API availability

---

## What Is Correct

The following are correctly documented and don't need changes:

- **Event coverage is comprehensive** for a messaging platform (new message, status change, contact update, tag update, assignment)
- **Message direction detection** via `$.message.traffic === "incoming"` is correct
- **Channel source abstraction** is correctly documented with the WhatsApp aggregator variants
- **Bot identity via `sender.source`** is the correct mechanism for loop prevention
- **Polling cursor strategy** using `cursor_id` is correctly documented
- **Contact identifier resolution** (`id:`, `email:`, `phone:`) is correctly documented
