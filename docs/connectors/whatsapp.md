# WhatsApp Business Connector Design

## 1. Overview

- **Category:** communication
- **Cloud vs self-hosted:** Cloud-only (Meta-hosted WhatsApp Business Platform). The on-premises API was sunset October 23, 2025. No self-hosted equivalent exists.
- **Official API reference:** https://developers.facebook.com/docs/whatsapp

WhatsApp Business spans two Meta platforms:

| Platform | Purpose |
|---|---|
| **WhatsApp Business Platform (Cloud API)** | Send/receive messages, manage templates, webhooks — **primary** |
| **Meta Business Manager** | Business account management, phone number registration, permissions |

**Key concepts:**

- **WABA (WhatsApp Business Account):** The parent business account that owns phone numbers
- **Phone Number ID:** The specific business phone number used for messaging
- **WhatsApp Business API ID (App ID):** The Meta app that holds the permissions
- **System User Access Token:** Long-lived token for server-side API access

---

## 2. Authentication

### 2.1 Authentication Mechanism

**System User Access Token** (recommended for server-side connector)

Created in Meta Business Manager under "System Users" → "Apps." Uses the WhatsApp Business API app.

```http
POST https://graph.facebook.com/v21.0/oauth/access_token
Content-Type: application/x-www-form-urlencoded

grant_type=fb_exchange_token&client_id={app-id}&client_secret={app-secret}&fb_exchange_token={short-lived-token}
```

**Token transport:**
```
Authorization: Bearer {system_user_access_token}
```

### 2.2 Token Lifetime

- Short-lived tokens: ~1 hour
- Long-lived tokens (System User): **~60 days** with automatic refresh
- System User tokens do not expire as long as the system user remains active and the app is not unpublished
- No refresh token needed — token auto-refreshes; re-exchange if 401 is received

### 2.3 Required Permissions

| Permission | Scope | Purpose |
|---|---|---|
| `whatsapp_business_management` | App-level | Read WABA, phone numbers, business profile |
| `whatsapp_business_messaging` | App-level | Send/receive messages, manage templates |
| `business_management` | Business-level | Manage business settings |

**Admin consent:** The system user must have the "Manage app" role on the WhatsApp Business API app and "Manage WhatsApp Business Account" on the WABA.

### 2.4 Webhook Verification (Inbound)

When you configure your webhook URL in the Meta App Dashboard, Meta sends a GET request to verify:

```http
GET /webhooks/whatsapp?
  hub.mode=subscribe&
  hub.verify_token={your-verify-token}&
  hub.challenge={random-challenge}
```

Your endpoint must respond with `hub.challenge` if `hub.verify_token` matches.

**No HMAC signature on verification** — just token comparison.

### 2.5 Message Webhook Signature (Inbound)

Meta signs every inbound webhook delivery using **ECDSA** (curve: P-256):

```
X-Hub-SHA256: {signature}
```

**Verification:**
1. Get the raw request body as a string
2. Extract the `X-Hub-SHA256` header
3. Compute HMAC-SHA256 of the body using your **app secret** as the key
4. Compare the computed signature with the header value using timing-safe comparison

```javascript
const crypto = require('crypto');
const appSecret = process.env.WHATSAPP_APP_SECRET;

function verifySignature(req) {
  const signature = req.headers['x-hub-sha256'];
  const body = req.rawBody; // must be raw string, not parsed JSON
  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(body, 'utf8')
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

### 2.6 Recommendation for SupportAgent MVP

Use **System User Access Token** with `whatsapp_business_management` + `whatsapp_business_messaging` permissions. Store per-tenant:
- `wabaId` (WABA ID)
- `phoneNumberId` (Phone Number ID)
- `appId` (Meta App ID)
- `appSecret` (Meta App Secret)
- `systemUserAccessToken` (long-lived)
- `webhookVerifyToken` (random string for webhook verification)

---

## 3. Inbound — Events and Intake

### 3.1 Webhook Events

Subscribe to these webhook fields in the Meta App Dashboard:

| Field | When fired |
|---|---|
| `messages` | Inbound customer message (text, media, document, location, contacts, etc.) |
| `message_deliveries` | Delivery confirmation (sent → delivered) |
| `message_reads` | Read receipts |
| `message_reactions` | Reactions to messages |
| `conversations` | Conversation started/ended (billing awareness) |

**For SupportAgent inbound intake, we care about:**
- `messages` — new inbound messages
- `message_reactions` — reactions to our messages

### 3.2 Inbound Message Payload

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
        "contacts": [{
          "profile": { "name": "Customer Name" },
          "wa_id": "15559876543"
        }],
        "messages": [{
          "from": "15559876543",
          "id": "wamid.HBgLMTU1NTk4NzY1NDM...",
          "timestamp": "1713465600",
          "type": "text",
          "text": { "body": "Hello, I need help" }
        }]
      },
      "field": "messages"
    }]
  }]
}
```

**For `type: text`:**
```json
"text": { "body": "message content" }
```

**For `type: image`:**
```json
"image": {
  "id": "media-id",
  "mime_type": "image/jpeg",
  "sha256": "abc123...",
  "caption": "optional"
}
```

**For `type: document`:**
```json
"document": {
  "id": "media-id",
  "filename": "file.pdf",
  "mime_type": "application/pdf",
  "sha256": "..."
}
```

**For `type: location`:**
```json
"location": {
  "latitude": 37.4849793563843,
  "longitude": -122.14717298690905,
  "name": "Optional Place Name",
  "address": "123 Main St, San Francisco, CA"
}
```

### 3.3 Retry / Delivery Semantics

- Meta retries webhook delivery **up to 7 times** with exponential backoff if your endpoint returns non-2xx
- Delivery timeout: your endpoint must respond within **20 seconds**
- If all retries fail, Meta marks the webhook as failed but does **not** replay missed events
- **No message replay API** — you must poll for missed messages if webhook delivery fails

### 3.4 Polling Fallback

WhatsApp does **not** have a native `updated_since` or cursor-based polling endpoint for messages.

**Available options:**

1. **Read received messages via webhook + persistent storage** — store last processed `message.id` (wamid) per conversation. On restart, request messages from a specific `message.id` using the [Read Messages endpoint](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages#read-messages).

2. **Mark messages as read** — `POST /me/messages` with `action=mark_read` and `message_id` to acknowledge receipt:
   ```json
   {
     "messaging_product": "whatsapp",
     "status": "read",
     "message_id": "wamid.xxx"
   }
   ```

3. **List recent messages** — No bulk list endpoint exists. You can only read individual messages by ID.

**Recommendation:** Use webhooks as primary, store checkpoint after each processed message, and implement a reconciliation job that re-fetches messages after known gaps.

### 3.5 Payload Fields to Persist

| Field | Path |
|---|---|
| `id` | `$.entry[0].changes[0].value.messages[0].id` (wamid — the canonical ID) |
| `externalUrl` | N/A — no direct WhatsApp URL. Construct: `https://wa.me/{phone_number_without_plus}` |
| `body` | `$.entry[0].changes[0].value.messages[0].text.body` (for text) or media caption |
| `authorId` | `$.entry[0].changes[0].value.messages[0].from` (E.164 phone number) |
| `authorName` | `$.entry[0].changes[0].value.contacts[0].profile.name` |
| `createdAt` | `$.entry[0].changes[0].value.messages[0].timestamp` (Unix epoch) |
| `conversationId` | `$.entry[0].changes[0].value.messages[0].from` + `phoneNumberId` |
| `type` | `$.entry[0].changes[0].value.messages[0].type` |
| `mediaId` | `$.entry[0].changes[0].value.messages[0].{image,document,audio,video}.id` |
| `replyToId` | `$.entry[0].changes[0].value.messages[0].context.id` (if reply) |
| `context.id` | Parent message ID if this is a reply |

---

## 4. Outbound — Writing Back

### 4.1 Send Text Message (Session Window)

Use when the customer has messaged you within the **24-hour session window**:

```http
POST https://graph.facebook.com/v21.0/{Phone-Number-ID}/messages
Authorization: Bearer {token}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "15559876543",
  "type": "text",
  "text": {
    "preview_url": false,
    "body": "Hello! How can I help you today?"
  }
}
```

**Response:**
```json
{
  "messaging_product": "whatsapp",
  "contacts": [{ "wa_id": "15559876543", "input": "15559876543" }],
  "messages": [{ "id": "wamid.HBgLMTU1NTk4NzY1NDM..." }]
}
```

- **Preview URL:** Set `preview_url: true` to enable link previews (links must be from whitelisted domains for production)
- **24-hour window:** Clock resets on every inbound customer message
- **Response `id`** (wamid) is your delivery tracking ID — store it for `no_self_retrigger`

### 4.2 Send Template Message (Outside Session)

Use **template messages** when:
- Starting a conversation (no inbound in 24h)
- Sending proactive notifications

```http
POST https://graph.facebook.com/v21.0/{Phone-Number-ID}/messages
Authorization: Bearer {token}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "15559876543",
  "type": "template",
  "template": {
    "name": "support_agent_notification",
    "language": { "code": "en_US" },
    "components": [{
      "type": "body",
      "parameters": [
        { "type": "text", "text": "Issue #1234" },
        { "type": "text", "text": "Triage complete" }
      ]
    }]
  }
}
```

### 4.3 Interactive Buttons

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "15559876543",
  "type": "interactive",
  "interactive": {
    "type": "button",
    "body": { "text": "What would you like to do?" },
    "action": {
      "buttons": [
        { "type": "reply", "reply": { "id": "action_triage", "title": "Start Triage" } },
        { "type": "reply", "reply": { "id": "action_status", "title": "Check Status" } }
      ]
    }
  }
}
```

**Button payload on reply:** Inbound webhook includes:
```json
{
  "type": "button",
  "button": { "payload": "action_triage", "text": "Start Triage" }
}
```

### 4.4 Interactive List

```json
{
  "type": "interactive",
  "interactive": {
    "type": "list",
    "header": { "type": "text", "text": "Actions" },
    "body": { "text": "Select an option" },
    "action": {
      "button": "View Options",
      "sections": [{
        "title": "Workflows",
        "rows": [
          { "id": "row_triage", "title": "Start Triage", "description": "Triage a new issue" },
          { "id": "row_status", "title": "Check Status", "description": "View run status" }
        ]
      }]
    }
  }
}
```

### 4.5 Media Messages

**Send image:**
```json
{
  "type": "image",
  "image": {
    "link": "https://example.com/screenshot.png"
  }
}
```

**Send by media ID** (media was uploaded to WhatsApp):
```json
{
  "type": "image",
  "image": { "id": "media-id-from-upload" }
}
```

**Supported types:** `image`, `audio`, `video`, `document`, `sticker`

### 4.6 Mark Message as Read

```json
{
  "messaging_product": "whatsapp",
  "status": "read",
  "message_id": "wamid.xxx"
}
```

### 4.7 Reply to a Message (Threading)

WhatsApp uses **context** for threading:

```json
{
  "type": "text",
  "text": { "body": "Replying to your message" },
  "context": {
    "message_id": "wamid.original-message-id"
  }
}
```

### 4.8 No Edit/Delete of Sent Messages

WhatsApp **does not support** editing sent messages via API. You can only:
- Delete (remove for everyone within 15 minutes):
```json
{
  "type": "delete",
  "delete": { "message_id": "wamid.xxx" }
}
```

### 4.9 Reactions

Send a reaction:
```json
{
  "type": "reaction",
  "reaction": { "emoji": "👍" },
  "message_id": "wamid.target-message-id"
}
```

### 4.10 Upload Media

Required before sending media by ID:

```http
POST https://graph.facebook.com/v21.0/{Phone-Number-ID}/media
Authorization: Bearer {token}
Content-Type: multipart/form-data

file=@screenshot.png
```

**Response:**
```json
{ "id": "media-id" }
```

---

## 5. Labels, Flags, Fields, Priorities

WhatsApp has **no native** issue-tracker model. It has:

### 5.1 Labels (Internal to Business Account)

WABAs support **labels** for organizing conversations, but these are **not** exposed via Cloud API — only available in the WhatsApp Business Manager UI.

### 5.2 No Status/Priority/Severity Model

WhatsApp is a messaging platform, not an issue tracker. It has:

| Concept | WhatsApp equivalent |
|---|---|
| Labels | Manual (use labels in WABA UI — no API) |
| Status | Conversation state: `active`, `archived` |
| Priority | None |
| Severity | None |
| Custom fields | None |

### 5.3 Conversation State

```json
{ "type": "conversation", "id": "...", "origin": { "type": "customer_initiated" } }
```

Conversation origin types: `customer_initiated`, `business_initiated`, `referral`

---

## 6. Triggers We Can Match On

From inbound message payloads:

| Trigger | Payload path |
|---|---|
| New message | `$.entry[*].changes[*].value.messages[*]` |
| Message from specific phone | `$.entry[*].changes[*].value.messages[*].from` |
| Message content regex | `$.entry[*].changes[*].value.messages[*].text.body` |
| Message type | `$.entry[*].changes[*].value.messages[*].type` |
| Media caption | `$.entry[*].changes[*].value.messages[*].{image,document}.caption` |
| Reply to our message | `$.entry[*].changes[*].value.messages[*].context.id` (check if context.id matches our sent wamid) |
| Reaction to our message | `$.entry[*].changes[*].value.messages[*].reaction` with `message_id` pointing to our wamid |
| Button reply | `$.entry[*].changes[*].value.messages[*].button.payload` |

**Conversation-level triggers:**
| Trigger | Payload path |
|---|---|
| Conversation started | `$.entry[*].changes[*].value.conversations[*].id` |
| Conversation origin | `$.entry[*].changes[*].value.conversations[*].origin.type` |

**What we CANNOT match on:**
- Label changes (no API)
- Status transitions (no status on individual messages)
- Assignee changes (no concept)
- Custom fields (no concept)

---

## 7. Identity Mapping

### 7.1 User ID Shape

- **WA ID:** E.164 formatted phone number string, e.g. `"15559876543"`
- Stable per user — the same phone number always maps to the same WA ID
- No UUID — just the phone number

### 7.2 Resolving User

WhatsApp **does not expose email or display name** via Cloud API for arbitrary users. You get:

```json
{
  "profile": { "name": "Customer Name" },
  "wa_id": "15559876543"
}
```

The `name` is the customer's WhatsApp display name (set by them — may be anything or empty).

**For SupportAgent identity mapping:**
- Map WA ID (phone number) to internal user identity
- Store the mapping in SupportAgent's user table
- Fallback: require users to verify via pairing code (see Section 11)

### 7.3 Bot Identity for no_self_retrigger

**Critical:** WhatsApp does **not** have a bot user identity concept like Slack or Teams.

When you send a message, **your sent message comes back in the webhook** as an inbound message. The `from` field will be the **customer's** phone number, not your business number.

To detect our own outbound messages:
1. **Store the `wamid`** (message ID) of every message you send
2. On inbound webhook, check if `entry[*].changes[*].value.messages[*].id` or `entry[*].changes[*].value.messages[*].context.id` matches a known outbound wamid
3. If it matches, it's likely a delivery confirmation, read receipt, or reaction to your message

**Important:** The `context.id` field links replies. If the customer replies to your message, `context.id` = your outbound wamid.

**Loop prevention strategy:**
- Maintain `outbound_message_ids: Set<string>` in memory/database
- On inbound: if `message.id` ∈ `outbound_message_ids` → skip
- On inbound: if `message.context.id` ∈ `outbound_message_ids` → this is a reply to our message → process normally (it's a user reply)
- Reactions also include `reaction.message_id` pointing to the reacted-to message

### 7.4 Author Field on Posted Messages

Our outbound messages return a `wamid` but **no author attribution** in the response. The author is implicit: the phone number associated with `Phone-Number-ID` in the request.

---

## 8. Rate Limits

### 8.1 Limits by Tier

WhatsApp Business API tiers are based on **quality rating** and **volume tier**:

| Tier | Messages/second | Monthly sent limit |
|---|---|---|
| Unverified WABA | 20 | 250 |
| Verified WABA | 80 | 1,000 |
| High quality | 250 | 10,000 |
| Enterprise | 1,000 | Unlimited |

**Cloud API total throughput:** Up to 1,000 messages/second.

### 8.2 Per-Conversation Limits

- **Session messages:** 15 messages/minute per conversation
- **Template messages:** Rate-limited per template category

### 8.3 How Rate-Limit Info is Exposed

HTTP **429 Too Many Requests** response with body:
```json
{
  "error": {
    "message": "(#131030) Too many requests",
    "type": "OAuthException",
    "code": 131030,
    "error_data": {
      "messaging_product": "whatsapp",
      "details": "Rate limit exceeded for phone number ID"
    }
  }
}
```

**No `Retry-After` header** in the traditional sense. Implement exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s.

### 8.4 Template Message Limits

- **Marketing templates:** 1 contact per day per template (unless customer opts in)
- **Utility templates:** Higher frequency allowed
- **Authentication templates:** Highest frequency, used for OTP

### 8.5 Bulk/Batch Endpoints

No batch message endpoint exists. Each message is a separate API call. To reduce call volume:
- Use interactive list/buttons to collect multiple pieces of information in one exchange
- Send media links instead of uploading per-message
- Webhooks are free (no limit on inbound)

---

## 9. Pagination & Search

### 9.1 Pagination

WhatsApp Cloud API does **not** support pagination for message history. The primary APIs (`/messages` endpoint) do not return paginated results — they return the current state or single records.

**No cursor-based pagination.** For message history, you must:
1. Receive messages via webhook
2. Store messages in your own database
3. Query your own storage for history

### 9.2 Search

No search API exists. Implement your own full-text search on stored message content.

### 9.3 Read Single Message

```http
GET https://graph.facebook.com/v21.0/{message-id}?phone_number_id={phone-number-id}
Authorization: Bearer {token}
```

Returns the message by ID (if from your WABA).

---

## 10. Known Gotchas

### 10.1 Cloud-Only

On-Premises API was **sunset October 23, 2025**. Only Cloud API is available. No self-hosted option.

### 10.2 24-Hour Session Window

You **cannot** send freeform messages outside the 24-hour session window. Must use pre-approved templates. This is the single biggest constraint for proactive notifications.

### 10.3 Template Approval Required

Every template must be:
1. Created in Meta Business Manager or via API
2. Reviewed and approved by Meta (24-48 hours)
3. Named exactly (case-sensitive)
4. Reviewed again on every change

**Startup implication:** Before going live, you must have at minimum:
- One utility template (e.g., `support_status_update`)
- One template for pairing/confirmation

### 10.4 No Edit/Delete of Messages

WhatsApp does not support editing sent messages. You can only delete within 15 minutes.

### 10.5 No Message History API

There is **no API** to retrieve message history beyond the most recent message via ID lookup. You must store all messages yourself via webhook.

### 10.6 Phone Number Verification (Business Account Tier)

To send messages, your WABA must be:
1. Verified by Meta (business verification with documents)
2. Have the phone number registered and approved

Unverified WABAs have severely limited sending (20 msg/sec, 250/month).

### 10.7 Webhook Delivery Not Guaranteed

Meta retries failed webhook deliveries but does **not** replay events if all retries fail. You will miss messages if your webhook is down.

### 10.8 No Standard User ID — Phone Numbers Only

WhatsApp does not provide UUIDs, emails, or usernames. You work with E.164 phone numbers. This complicates identity mapping — you cannot cross-reference with other systems without the user explicitly providing/confirming their number.

### 10.9 Template Content Restrictions

Templates cannot contain:
- More than 15 variables in the body
- Dynamic URLs (links must be static and verified)
- Promotional content in utility templates
- Excessive capitalization or special characters

### 10.10 Multi-Tenant Complexity

Each WABA is associated with **one** Meta Business Manager account. For multi-tenant support:
- You need separate WABA per tenant, OR
- Use one WABA and manage conversation routing internally

**Per-tenant WABA is cleaner** but requires each tenant to go through WhatsApp Business verification.

### 10.11 Interactive Buttons/Lists — Limited Options

- Maximum **3 buttons** per message
- Maximum **10 sections** in a list, **10 rows** per section
- Buttons cannot have URLs (only reply payloads)
- Buttons work in the 24-hour session window only

### 10.12 Media Size Limits

| Type | Max size |
|---|---|
| Image | 5 MB |
| Audio | 16 MB |
| Video | 16 MB |
| Document | 100 MB |

### 10.13 ECDSA Signature

X-Hub-SHA256 uses **ECDSA** (P-256 curve), not HMAC-SHA256. However, Meta also supports a simpler HMAC verification in some cases. Use the ECDSA method for security.

### 10.14 No Support for Group Chats (Standard)

The Cloud API **does not support** group messages. Only 1:1 conversations with business phone numbers. (Business Management API has limited group support for specific enterprise tiers.)

### 10.15 Phone Number Formatting

All phone numbers must be in **E.164 format**: `+{countrycode}{number}` (e.g., `+15559876543`). Without `+` prefix.

---

## 11. Recommended SupportAgent Connector Scope

### MVP

**Endpoints to wrap:**

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/{Phone-Number-ID}/messages` | Send text message |
| `POST` | `/{Phone-Number-ID}/messages` | Send template message |
| `POST` | `/{Phone-Number-ID}/messages` | Send interactive buttons |
| `POST` | `/{Phone-Number-ID}/messages` | Send interactive list |
| `POST` | `/{Phone-Number-ID}/messages` | Send media message |
| `POST` | `/{Phone-Number-ID}/messages` | Mark message as read |
| `POST` | `/{Phone-Number-ID}/messages` | Delete message |
| `POST` | `/{Phone-Number-ID}/messages` | Send reaction |
| `GET` | `/{message-id}` | Read single message |
| `POST` | `/{Phone-Number-ID}/media` | Upload media |
| `GET` | `/{Phone-Number-ID}/message_templates` | List templates |
| `POST` | `/{Phone-Number-ID}/message_templates` | Create template |
| `GET` | `/v21.0/{WABA-ID}` | Get WABA info |

**Webhook events to handle:**
- `messages` → inbound text, media, document, location, contacts, reactions, button replies, list replies
- `message_deliveries` → delivery receipts
- `message_reads` → read receipts
- `conversations` → conversation started/ended (for billing/quality awareness)

**Webhook verification:**
- Handle `hub.mode=subscribe` verification
- Verify `X-Hub-SHA256` signature on all message deliveries

**Minimum admin panel config fields:**
- `wabaId` (WABA ID)
- `phoneNumberId` (Phone Number ID)
- `appId` (Meta App ID)
- `appSecret` (Meta App Secret)
- `systemUserAccessToken` (long-lived)
- `webhookVerifyToken` (random string for hub.verify)
- `webhookUrl` (your endpoint URL)
- `outboundMessageIds: Set<string>` (stored for loop prevention)

**Pairing flow (required per communication-channels.md):**
1. Customer sends a message to the business WhatsApp number
2. SupportAgent sends a pairing code via the 24-hour session window or template
3. Customer provides the code in the admin UI
4. Admin UI verifies the code and creates the channel pairing
5. Store: `wa_id` → internal user/tenant mapping
6. Re-verification required when phone number, WABA, or tenant binding changes

### Phase 2

- Template management UI (create, edit, submit for approval)
- Rich notification templates with media
- Conversation state tracking (active/archived)
- Full-text search on stored message history
- Per-conversation message history retrieval
- Quality rating monitoring and alerting

### Phase 3

- Group chat support (enterprise tier)
- Automated quality score management
- A/B testing of templates
- Advanced analytics (delivery rates, response rates)
- Multi-language template variants
- Referral tracking for conversation origins

---

## 12. Dependencies

### 12.1 Official SDK

Meta provides the **WhatsApp Business SDK** but it is primarily for **on-premises** (now deprecated). For Cloud API, there is **no official npm SDK** from Meta.

**Available packages (third-party):**

| Package | Description |
|---|---|
| `whatsapp-api-js` | Lightweight wrapper for WhatsApp Cloud API |
| ` @抽離/whatsapp-webhook` | Webhook handling helpers |
| Meta's `fb-sdk` | General Meta API access (not WhatsApp-specific) |

**Recommendation: Use raw `fetch`.**

The WhatsApp Cloud API is a simple REST API over Graph API. The endpoint structure is:
```
https://graph.facebook.com/v21.0/{phone-number-id}/messages
```

No SDK provides significant value over well-typed `fetch` calls with TypeScript interfaces.

### 12.2 Raw fetch vs SDK

**Use raw `fetch`** with typed interfaces. Reasons:
- WhatsApp Cloud API is standard REST over Graph API — no complex auth flows
- Official SDK is on-premises only (deprecated)
- Raw fetch gives full control over retry logic, error handling, and signature verification
- Simpler dependency footprint

### 12.3 No Native CLI

There is no `gh`-equivalent CLI for WhatsApp Business. All management happens via:
- Meta Business Manager (web UI)
- Meta Business SDK (on-premises, deprecated)
- Direct API calls

For parity with `@support-agent/github-cli`, there is no equivalent.

### 12.4 Media Upload

For sending media, you may want to use the `@抽離/whatsapp-upload` or implement multipart upload manually.

---

## 13. Open Questions

### 13.1 Multi-Tenant Architecture

**Decision needed:** Do we require a separate WABA per tenant (cleaner isolation, but requires each tenant to complete WhatsApp Business verification), or do we use one WABA with internal conversation routing?

**Recommendation:** Phase 1 = single WABA per SupportAgent deployment. Phase 2 = per-tenant WABA for enterprise customers.

### 13.2 Template Approval Timeline

Meta's template review takes **24-48 hours** (can be longer). For MVP, we need at minimum one approved template before launch. How do we handle this in the onboarding flow?

### 13.3 Pairing Flow UX

The pairing code flow (admin-initiated code → customer confirms in WhatsApp → admin verifies) requires a working WhatsApp Business number from day one. Is the customer providing their own WABA, or are we provisioning one?

### 13.4 Business Verification

Meta requires business verification (document upload to confirm legal business identity) for full API access. Which verification tier do we target for MVP? Unverified = severely limited (20 msg/sec, 250/month).

### 13.5 Message Storage Strategy

Since there's no message history API, we must store all inbound messages ourselves. Questions:
- How long do we retain messages?
- Do we store media locally or only reference the media ID?
- How do we handle media that expires (media URLs are temporary)?

### 13.6 Outbound Template Strategy

For MVP notifications (triage complete, PR ready, etc.), we need pre-approved templates. Which templates should we create first? Suggested minimum:
- `support_agent_status` (utility) — for status updates
- `support_agent_pairing` (utility) — for pairing code delivery

### 13.7 Quality Rating Monitoring

WhatsApp can disable your WABA if quality rating drops too low. Should we implement quality monitoring and alerting? Who receives alerts when quality degrades?

### 13.8 Self-Hosting Limitation

The Cloud API requires Meta's infrastructure. Can we run this connector in a truly self-hosted environment, or are we always dependent on Meta's cloud? (On-premises API is gone.)

---

## Appendix A: Webhook Payload Reference

### Inbound Text Message
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
        "contacts": [{
          "profile": { "name": "John Doe" },
          "wa_id": "15559876543"
        }],
        "messages": [{
          "from": "15559876543",
          "id": "wamid.HBgLMTU1NTk4NzY1NDM...",
          "timestamp": "1713465600",
          "type": "text",
          "text": { "body": "Hello!" }
        }]
      },
      "field": "messages"
    }]
  }]
}
```

### Button Reply
```json
{
  "messages": [{
    "from": "15559876543",
    "id": "wamid.new-message",
    "timestamp": "1713465600",
    "type": "button",
    "button": {
      "payload": "action_triage",
      "text": "Start Triage"
    },
    "context": {
      "from": "BUSINESS-PHONE",
      "id": "wamid.original-message"
    }
  }]
}
```

### List Reply
```json
{
  "messages": [{
    "from": "15559876543",
    "id": "wamid.new-message",
    "timestamp": "1713465600",
    "type": "interactive",
    "interactive": {
      "type": "list_reply",
      "list_reply": {
        "id": "row_triage",
        "title": "Start Triage",
        "description": "Begin triage for this issue"
      }
    },
    "context": {
      "from": "BUSINESS-PHONE",
      "id": "wamid.original-message"
    }
  }]
}
```

### Reaction
```json
{
  "messages": [{
    "from": "15559876543",
    "id": "wamid.new-message",
    "timestamp": "1713465600",
    "type": "reaction",
    "reaction": {
      "emoji": "👍",
      "message_id": "wamid.reacted-to"
    }
  }]
}
```

## Appendix B: Error Codes

| Code | Name | Description |
|---|---|---|
| `131030` | Rate limit | Too many requests |
| `131032` | Phone number not reachable | Number cannot receive messages |
| `131043` | Template does not exist | Template name mismatch |
| `132000` | Message too long | Text exceeds 4096 characters |
| `132001` | Media upload failed | Error uploading media |
| `132005` | Invalid media type | Unsupported media format |
| `132015` | Template rejected | Pending approval or rejected |
| `1005` | Number registered on wrong API | Attempted on-premises after July 2024 |
