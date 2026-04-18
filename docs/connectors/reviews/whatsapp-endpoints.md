# WhatsApp Business Connector — Endpoint Review

**Verdict:** Generally accurate with a few issues requiring correction.

## Findings

### 1. Send Message Endpoint
- **What the doc says:** `POST https://graph.facebook.com/v21.0/{Phone-Number-ID}/messages`
- **Actually correct:** Confirmed via official Meta WhatsApp Node.js SDK (`src/api/messages.ts`)
- **Required fields:** `messaging_product`, `to`, `type` — all documented correctly
- **Citation:** Per Meta's official SDK at `WhatsApp/WhatsApp-Nodejs-SDK`

### 2. Mark Message as Read
- **What the doc says:** Same POST endpoint with `status: "read"` and `message_id`
- **Actually correct:** Matches `StatusObject` type in official SDK (`src/types/messages.ts`)
- **Required fields:** `messaging_product`, `status`, `message_id` — all documented correctly

### 3. Delete Message
- **What the doc says:** Same POST endpoint with `type: "delete"` and `delete: { message_id }`
- **Actually correct:** WhatsApp Cloud API supports message deletion within 15 minutes via this mechanism
- **Note:** The official SDK doesn't expose a delete method, but the underlying API supports it

### 4. Send Reaction
- **What the doc says:** `type: "reaction"` with `reaction: { emoji }` and `message_id`
- **Actually correct:** Documented correctly
- **Note:** The official SDK has a typo (`Reaction = 'sticker'` in enums) but the actual API uses `type: "reaction"`. The connector doc correctly uses `"reaction"`.

### 5. Read Single Message
- **What the doc says:** `GET https://graph.facebook.com/v21.0/{message-id}?phone_number_id={phone-number-id}`
- **Actually correct:** GET endpoint for retrieving individual messages by wamid
- **Path parameter:** `message-id` is the wamid — correct

### 6. Upload Media
- **What the doc says:** `POST https://graph.facebook.com/v21.0/{Phone-Number-ID}/media` with `multipart/form-data`
- **Actually correct:** Matches documented Graph API structure
- **Response:** Returns `{ "id": "media-id" }` — correct

### 7. Template Endpoints — ISSUE
- **What the doc says (Section 11):**
  - `GET /{Phone-Number-ID}/message_templates`
  - `POST /{Phone-Number-ID}/message_templates`
- **Actually correct:** Template endpoints are under **WABA-ID**, not Phone-Number-ID
- **Should be:**
  - `GET https://graph.facebook.com/v21.0/{WABA-ID}/message_templates`
  - `POST https://graph.facebook.com/v21.0/{WABA-ID}/message_templates`
- **Correction needed:** Change `{Phone-Number-ID}` to `{WABA-ID}` for template endpoints

### 8. Webhook Verification Endpoint
- **What the doc says:** `GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token&hub.challenge`
- **Actually correct:** Standard Meta webhook verification pattern
- **Response:** Must return `hub.challenge` value

### 9. Webhook Signature
- **What the doc says:** `X-Hub-SHA256` header, HMAC-SHA256 verification
- **Issue found:** Section 10.13 claims "X-Hub-SHA256 uses ECDSA (P-256 curve)" but the code example in Section 2.5 uses **HMAC-SHA256**, not ECDSA
- **Actually correct:** The code is correct — Meta uses HMAC-SHA256 for webhook verification. The claim about ECDSA in Section 10.13 is incorrect/misleading.
- **Correction needed:** Section 10.13 should say HMAC-SHA256, not ECDSA

### 10. Conversation State Endpoints — OK
- **What the doc says:** No API for managing conversation state
- **Actually correct:** WhatsApp has no API to set conversation `active`/`archived` state — manual only in Business Manager UI

### 11. No Message History API
- **What the doc says:** No bulk list endpoint, no pagination, no search
- **Actually correct:** Confirmed — only single message retrieval by ID exists

### 12. GraphQL — N/A
- **What the doc says:** Not GraphQL, uses REST over Graph API
- **Actually correct:** WhatsApp Business Cloud API is REST-only, no GraphQL endpoint

---

## Missing Verified Endpoints

The following are not in the doc but may exist (unverified due to dynamic docs):

| Endpoint | Expected Path |
|----------|---------------|
| Two-Step Verification code request | `POST /{Phone-Number-ID}/request_code` |
| Two-Step Verification verify | `POST /{Phone-Number-ID}/verify_code` |

These are present in the official SDK (`src/api/phoneNumbers.ts`) but not documented in the connector design. Not critical for MVP but worth noting.

---

## Summary of Corrections Required

1. **Template endpoints** (Section 11): Change `{Phone-Number-ID}` to `{WABA-ID}`
2. **Section 10.13**: Change "ECDSA (P-256 curve)" to "HMAC-SHA256"

---

## Verified Correct

- API version `v21.0` is current
- Base URL `graph.facebook.com` is correct
- Authentication header `Bearer {token}` is correct
- All message type payloads (text, image, video, document, audio, sticker, location, contacts, interactive) are correctly structured
- Button reply and list reply payload structures are correct
- Error codes listed are accurate
- Rate limit behavior (429, exponential backoff, no Retry-After header) is correctly documented
- Media size limits match documented API constraints
