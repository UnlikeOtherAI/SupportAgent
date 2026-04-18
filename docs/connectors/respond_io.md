# Respond.io Connector Design

## 1. Overview

- **Category**: Communication / Omnichannel Messaging
- **Cloud vs self-hosted**: Cloud-only. Respond.io is a SaaS platform with no self-hosted variant.
- **Official API reference**: https://developers.respond.io (Stoplight-hosted)
- **Official SDK**: `@respond-io/typescript-sdk` (npm), MIT license
- **API base URL**: `https://api.respond.io/v2`

### Platform Model

Respond.io is an **omnichannel customer messaging platform** unifying channels:

| Channel | Source value | Notes |
|---------|-------------|-------|
| WhatsApp | `whatsapp`, `whatsapp_cloud`, `360dialog_whatsapp`, `twilio_whatsapp`, `message_bird_whatsapp`, `nexmo_whatsapp` | Multiple WhatsApp aggregators |
| Facebook Messenger | `facebook` | |
| Instagram | `instagram` | |
| Telegram | `telegram` | |
| LINE | `line` | |
| Viber | `viber` | |
| Email | `gmail`, `other_email` | |
| SMS | `twilio`, `message_bird`, `nexmo` | |
| Twitter/X DM | `twitter` | |
| WeChat | `wechat` | |
| Web chat | `custom_channel` | |
| Other | `other_email`, `custom_channel` | |

### Key Concepts

- **Contact**: The primary entity. A contact represents a customer with identifiers (id, email, phone). Multiple channels can be connected to a single contact.
- **Conversation**: A contact's ongoing dialogue with your team. Has status (open/close) and an optional assignee.
- **Message**: An individual message within a conversation. Has direction (incoming/outgoing), traffic type, and delivery status.
- **Comment**: Internal notes attached to a contact (not visible to the customer).
- **Space (Workspace)**: The organization-level container containing users, channels, tags, and custom fields.
- **Channel**: A specific connection to a messaging platform (e.g., a specific WhatsApp Business account).

### Identity Resolution

A key feature of Respond.io is **contact unification** — a single contact can have multiple channel identities (email, phone, WhatsApp number, etc.). The connector must understand the identifier system:

```
ContactIdentifier = "id:123" | "email:user@example.com" | "phone:+60123456789"
```

---

## 2. Authentication

### API Token (Bearer Token)

The only authentication mechanism for the REST API.

**Token provisioning:**
1. Log in to Respond.io dashboard
2. Navigate to **Settings** → **Integrations** → **Developer API**
3. Click **Add Access Token**
4. Copy the generated token

**Token transport:**
```http
Authorization: Bearer {api_token}
Content-Type: application/json
```

**Token lifetime:**
- Tokens are long-lived (no expiry documented; revoke manually in dashboard)
- Store securely; treat as a password

**Required scopes / permissions:**
- There are no granular scopes — the API token grants access to the entire workspace
- Workspace-level permissions (agent, manager, owner) determine what operations succeed

**Recommendation for SupportAgent MVP:** API token is sufficient. No OAuth flow required.

### Webhook Authentication

Respond.io webhook subscriptions use the same API token for verification:

```http
Authorization: Bearer {api_token}
```

When registering a webhook, include the token in the Authorization header. Respond.io validates that the token has access to the workspace.

---

## 3. Inbound — Events and Intake

### Webhook Support: YES

Respond.io supports webhook subscriptions for real-time event delivery.

**Webhook subscription endpoint:**
```
POST https://api.respond.io/v2/integration/{integration}/subscribe
DELETE https://api.respond.io/v2/integration/{integration}/unsubscribe/{webhookId}
```

Available integrations: `n8n-api` (n8n), `zapier` (Zapier), and likely others.

**Webhook registration body:**
```json
{
  "webHookName": "SupportAgent Connector",
  "type": "NEW_INCOMING_MESSAGE",
  "url": "https://your-endpoint.com/webhooks/respond-io",
  "hookId": "unique-hook-id",
  "bundle": {
    "source": ["whatsapp", "instagram"],  // optional: filter by channel source
    "messageType": ["text", "attachment"],  // optional: filter by message type
    "workflowDetails": { ... }  // for internal workflow hooks
  }
}
```

### Webhook Events

| Event type | When fired | SupportAgent interest |
|------------|-------------|----------------------|
| `NEW_INCOMING_MESSAGE` | Customer sends a message | **Primary inbound** |
| `NEW_OUTGOING_MESSAGE` | Agent/automation sends a message | Useful for sync |
| `NEW_COMMENT` | Internal comment added to contact | Low priority |
| `CONVERSATION_OPENED` | Conversation status → open | Useful for routing |
| `CONVERSATION_CLOSED` | Conversation status → close | Useful for resolution tracking |
| `NEW_CONTACT` | New contact created | Useful for onboarding triggers |
| `CONTACT_UPDATED` | Contact fields changed | Useful for field-based triggers |
| `CONTACT_TAG_UPDATED` | Tags added/removed | **Useful for triage triggers** |
| `CONTACT_LIFECYCLE_UPDATED` | Lifecycle stage changed | Useful for lifecycle triggers |
| `CONTACT_ASSIGNEE_UPDATED` | Conversation assignee changed | Useful for assignment triggers |
| `CALL_ENDED` | Voice call completed | Low priority |

### Inbound Message Payload

```json
{
  "contact_id": 12345,
  "contact": {
    "id": 12345,
    "first_name": "John",
    "last_name": "Doe",
    "phone": "+60123456789",
    "email": "john@example.com",
    "language": "en",
    "country_code": "MY",
    "profile_pic": "https://...",
    "custom_fields": [
      { "name": "Company", "value": "Acme Corp" }
    ],
    "tags": ["vip", "premium"],
    "lifecycle": "lead"
  },
  "channel_id": 5678,
  "channel": {
    "id": 5678,
    "name": "WhatsApp Business",
    "source": "whatsapp"
  },
  "message": {
    "message_id": 987654,
    "channel_message_id": "wamid.xxx",
    "traffic": "incoming",
    "type": "text",
    "text": "Hello, I need help",
    "sender": {
      "source": "user",
      "user_id": null
    },
    "status": [
      { "value": "pending", "timestamp": 1713465600 },
      { "value": "sent", "timestamp": 1713465601 },
      { "value": "delivered", "timestamp": 1713465602 }
    ]
  },
  "timestamp": 1713465600
}
```

**Incoming message types:**
- `text` — plain text
- `attachment` — media (image, video, audio, file)
- `story_reply` — Instagram story reply
- `location` — location share
- `email` — email message
- `unsupported` — unsupported content type
- `whatsapp_interactive` — WhatsApp interactive (buttons, lists)
- `post` — TikTok/Instagram post
- `whatsapp_order` — WhatsApp order

**Message sender sources:**
- `user` — human customer
- `api` — sent via API
- `workflow` — sent via Respond.io workflow automation
- `ai_agent` — sent by AI agent
- `broadcast` — sent via broadcast campaign
- `echo` — echoed message

### Retry / Delivery Semantics

- Respond.io retries webhook delivery with exponential backoff on non-2xx responses
- Specific retry count and intervals not documented
- **No guaranteed delivery** — missed webhooks are not replayed

### Polling Fallback

For missed webhooks, use the message list API with pagination:

```http
GET /contact/{identifier}/message/list?limit=50&cursor_id={last_cursor}
```

Sort by `message_id` descending to get most recent first. Store checkpoint after each poll.

**Contact list with filters** for reconciliation:
```http
POST /contact/list
{
  "search": "",
  "timezone": "UTC",
  "filter": {
    "$and": [
      { "category": "contactField", "field": "updated_at", "operator": "isTimestampAfter", "value": "2024-01-01T00:00:00Z" }
    ]
  }
}
```

### Payload Fields to Persist

| Field | Path |
|-------|------|
| `id` (contact) | `$.contact.id` |
| `externalUrl` | Construct from contact_id: no direct URL; no stable web link to conversation |
| `firstName` | `$.contact.first_name` |
| `lastName` | `$.contact.last_name` |
| `email` | `$.contact.email` |
| `phone` | `$.contact.phone` |
| `tags` | `$.contact.tags` |
| `lifecycle` | `$.contact.lifecycle` |
| `custom_fields` | `$.contact.custom_fields` |
| `messageId` | `$.message.message_id` |
| `messageText` | `$.message.text` |
| `messageType` | `$.message.type` |
| `messageDirection` | `$.message.traffic` ("incoming" or "outgoing") |
| `channelId` | `$.channel.id` |
| `channelSource` | `$.channel.source` |
| `createdAt` | `$.timestamp` (Unix epoch) |

---

## 4. Outbound — Writing Back

### Send Text Message

```http
POST https://api.respond.io/v2/contact/{identifier}/message
Authorization: Bearer {token}
Content-Type: application/json

{
  "channelId": 5678,  // optional: specify channel; null = last interacted
  "message": {
    "type": "text",
    "text": "Hello! How can we help you today?"
  }
}
```

**Response:**
```json
{
  "messageId": 123456
}
```

### Send Attachment

```json
{
  "channelId": 5678,
  "message": {
    "type": "attachment",
    "attachment": {
      "type": "image",  // image | video | audio | file
      "url": "https://example.com/image.jpg"
    }
  }
}
```

### Send WhatsApp Template

```json
{
  "channelId": 5678,
  "message": {
    "type": "whatsapp_template",
    "template": {
      "name": "support_status_update",
      "languageCode": "en",
      "components": [
        {
          "type": "body",
          "text": "Hello {{1}}, your order #{{2}} is ready!",
          "parameters": [
            { "type": "text", "text": "John" },
            { "type": "text", "text": "12345" }
          ]
        }
      ]
    }
  }
}
```

### Send Email

```json
{
  "channelId": 1234,
  "message": {
    "type": "email",
    "text": "Your order has shipped!",
    "subject": "Order Shipment Notification",
    "cc": ["manager@example.com"],
    "replyToMessageId": 987654
  }
}
```

### Send Quick Reply

```json
{
  "channelId": 5678,
  "message": {
    "type": "quick_reply",
    "title": "How would you rate your experience?",
    "replies": ["Great", "Okay", "Not good"]
  }
}
```

### Post Internal Comment

```http
POST https://api.respond.io/v2/contact/{identifier}/comment
Authorization: Bearer {token}
Content-Type: application/json

{
  "text": "Customer requested callback. Follow up tomorrow at 2 PM."
}
```

**Mention users in comments:**
```json
{
  "text": "Please follow up with this contact {{@user.456}}"
}
```

### Assign Conversation

```http
POST https://api.respond.io/v2/contact/{identifier}/conversation/assignee
Authorization: Bearer {token}
Content-Type: application/json

{
  "assignee": "agent@example.com"
  // or by user ID:
  // "assignee": 456
  // or to unassign:
  // "assignee": null
}
```

### Update Conversation Status

```http
POST https://api.respond.io/v2/contact/{identifier}/conversation/status
Authorization: Bearer {token}
Content-Type: application/json

{
  "status": "open"  // or "close"
}
// or with closing notes:
{
  "status": "close",
  "category": "Resolved",
  "summary": "Issue was resolved by providing documentation"
}
```

### Update Contact

```http
PUT https://api.respond.io/v2/contact/{identifier}
Authorization: Bearer {token}
Content-Type: application/json

{
  "firstName": "Jane",
  "custom_fields": [
    { "name": "Company", "value": "New Corp" }
  ]
}
```

### Add/Remove Tags

```http
POST https://api.respond.io/v2/contact/{identifier}/tag
Authorization: Bearer {token}
Content-Type: application/json

["vip", "priority-support"]
```

Remove tags:
```http
DELETE https://api.respond.io/v2/contact/{identifier}/tag
Authorization: Bearer {token}
Content-Type: application/json

["old-tag"]
```

### Update Contact Lifecycle

```http
POST https://api.respond.io/v2/contact/{identifier}/lifecycle/update
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "qualified-lead"
}
// or to remove:
// { "name": null }
```

### No Edit/Delete of Sent Messages

Respond.io does **not** support editing or deleting sent messages via API.

---

## 5. Labels, Flags, Fields, Priorities

### Tags (Contact-level)

Tags are simple string labels attached to contacts. They are **workspace-level** (shared across all contacts).

**API operations:**
- List: Available via space API
- Add: Up to 10 tags per request, max 255 characters each
- Remove: Delete existing tags

**Supported operations:**
- Add tags on contact create/update
- Filter contacts by tag via `contactTag` filter category
- Tags can trigger workflows when added/removed

### Lifecycle Stages

Lifecycle is a **single-select** stage field on contacts (not a tag). Common stages: `lead`, `qualified-lead`, `customer`, `churned`.

**API operations:**
- Update lifecycle: `POST /contact/{identifier}/lifecycle/update`
- Filter by lifecycle: via `lifecycle` filter category

### Custom Fields

Custom fields are **workspace-level** definitions with **per-contact values**.

**Data types:**
| Type | Description |
|------|-------------|
| `text` | Free-form text |
| `list` | Single-select from allowed values |
| `checkbox` | Boolean |
| `email` | Email (validated) |
| `number` | Numeric |
| `url` | URL (validated) |
| `date` | Date only |
| `time` | Time only |

**Limits:**
- Field name: max 50 characters
- Field slug: max 50 characters (alphanumeric + underscore)
- Description: max 255 characters
- Allowed values (for list): configurable

**API operations:**
```http
POST /space/custom_field  // Create
GET /space/custom_field   // List all
GET /space/custom_field/{id}  // Get one
```

### No Native Priority/Severity Model

Respond.io does **not** have built-in priority or severity models. Use:
- Tags (e.g., `priority-high`, `severity-critical`)
- Custom fields (e.g., `priority` list field with values `Low`, `Medium`, `High`, `Critical`)

### Status Model

Contact conversations have a simple **open/close** status:

```json
{ "status": "open" | "close" }
```

Closing a conversation optionally supports:
- **Category**: predefined closing reason (configured in workspace settings)
- **Summary**: free-text notes

List closing notes:
```http
GET /space/closing_notes
```

### Conversation Assignee

A conversation can have **one assignee** (a workspace user) or be unassigned.

Assignee identified by:
- User ID: `assignee: 123`
- User email: `assignee: "agent@example.com"`
- Null: unassign

---

## 6. Triggers We Can Match On

From inbound webhook payloads:

| Trigger | Payload path |
|---------|--------------|
| New inbound message | `$.message.traffic === "incoming"` |
| New outbound message | `$.message.traffic === "outgoing"` |
| Message from specific channel | `$.channel.source` in `["whatsapp", "instagram", ...]` |
| Message content regex | `$.message.text` |
| Message type | `$.message.type` |
| New contact | Event type `NEW_CONTACT` |
| Contact updated | Event type `CONTACT_UPDATED` |
| Tags added | Event type `CONTACT_TAG_UPDATED` + `$.contact.tags` diff |
| Tags removed | Event type `CONTACT_TAG_UPDATED` + `$.contact.tags` diff |
| Assignee changed | Event type `CONTACT_ASSIGNEE_UPDATED` + `$.contact.assignee` |
| Lifecycle changed | Event type `CONTACT_LIFECYCLE_UPDATED` + `$.contact.lifecycle` |
| Conversation opened | Event type `CONVERSATION_OPENED` |
| Conversation closed | Event type `CONVERSATION_CLOSED` |
| Comment added | Event type `NEW_COMMENT` |

**Filter conditions available via Contact List API:**

```json
{
  "$and": [
    { "category": "contactField", "field": "email", "operator": "isEqualTo", "value": "user@example.com" },
    { "category": "contactTag", "field": null, "operator": "hasAnyOf", "value": ["vip"] },
    { "category": "lifecycle", "field": null, "operator": "isEqualTo", "value": "lead" },
    { "category": "contactField", "field": "updated_at", "operator": "isTimestampAfter", "value": "2024-01-01T00:00:00Z" }
  ]
}
```

**Filter operators:**
- `isEqualTo`, `isNotEqualTo`
- `isTimestampAfter`, `isTimestampBefore`, `isTimestampBetween`
- `exists`, `doesNotExist`
- `isGreaterThan`, `isLessThan`, `isBetween`
- `hasAnyOf`, `hasAllOf`, `hasNoneOf`

---

## 7. Identity Mapping

### User ID Shape

- **Contact ID**: Numeric integer, e.g., `12345`
- **User ID** (workspace agents): Numeric integer
- **No UUID** — all IDs are integers

### Contact Identifier Resolution

Contacts are identified by composite keys:

```
"id:12345"           // by numeric contact ID
"email:user@example.com"  // by email
"phone:+60123456789"      // by phone (E.164 format)
```

**For SupportAgent identity mapping:**
1. Use contact ID as the canonical external ID
2. Store `email` and `phone` for human-readable display
3. Map Respond.io contact to internal user by email (most reliable identifier)

### Bot Identity for no_self_retrigger

**Identifying our outbound messages:**

In message webhooks, the `sender.source` field distinguishes who sent the message:

```json
"sender": {
  "source": "api",  // sent via API (our connector)
  "source": "workflow",  // sent via Respond.io automation
  "source": "user"  // human customer
}
```

**Loop prevention strategy:**
1. When sending a message via API, store the returned `messageId`
2. On inbound webhook, check if `$.message.sender.source === "api"` and `$.message.sender.user_id` matches our system user
3. Alternative: maintain a set of `outbound_message_ids` and skip processing if the incoming message matches

**Important:** Messages sent via API have `sender.source === "api"`. This allows distinguishing our connector's outbound from human agent replies.

### Author Field on Posted Messages

Our outbound messages return `{ "messageId": 123456 }`. The author is implicit — it's the API token's workspace identity. No explicit author attribution in the response.

---

## 8. Rate Limits

### Rate Limit Headers

Respond.io exposes rate limit info via response headers:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
Retry-After: 60  (seconds, present on 429 responses)
```

### Error Codes

| HTTP Status | Code | Meaning |
|-------------|------|---------|
| 400 | 400 | Validation error |
| 401 | 401 | Unauthorized (invalid/missing token) |
| 404 | 404 | Resource not found |
| 409 | 409 | Conflict (e.g., duplicate) |
| 429 | 429 | Rate limit exceeded |
| 449 | 449 | Retry with (specific retry instruction) |
| 500 | 500 | Internal server error |

### Retry Logic

The official SDK implements automatic retry with exponential backoff:
- Retries on 429 and 5xx responses
- Uses `Retry-After` header if present
- Falls back to exponential backoff: `min(1000 * 2^attempt, 10000ms)`
- Maximum 3 retries by default

### Specific Limits (Not Documented)

The official rate limit values are **not publicly documented**. Monitor `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers to understand limits for each endpoint.

**Best practices:**
1. Implement exponential backoff with jitter
2. Cache workspace data (users, channels, custom fields) to reduce API calls
3. Batch tag operations when possible (up to 10 tags per request)

### Bulk/Batch Endpoints

No bulk message endpoints exist. Each message requires a separate API call.

---

## 9. Pagination & Search

### Cursor-Based Pagination

```http
GET /contact/{identifier}/message/list?limit=50&cursor_id=100
```

```http
POST /contact/list
{
  "search": "john",  // searches across name, email, phone
  "filter": { ... },
  "limit": 50,
  "cursor_id": 100
}
```

**Pagination limits:**
- Default: 10 items
- Minimum: 1
- Maximum: 100

### Pagination Response

```json
{
  "items": [ ... ],
  "pagination": {
    "next": "cursor_token_or_url",
    "previous": "cursor_token_or_url"
  }
}
```

### Search

Contact search is built into the list endpoint:

```json
{
  "search": "john@example.com",
  "timezone": "Asia/Kuala_Lumpur"
}
```

Searches across: name, email, phone, custom fields.

---

## 10. Known Gotchas

### Cloud-Only

Respond.io is **exclusively SaaS**. No self-hosted option. All data resides on Respond.io infrastructure.

### No Direct Conversation URL

Respond.io does **not** expose a stable, bookmarkable URL to a specific conversation. The web dashboard uses internal IDs not exposed via API.

### Multi-Channel Contact Model

A single contact can have **multiple channel identities** (email, phone, WhatsApp, Instagram, etc.). When sending messages:
- Specify `channelId` to send on a specific channel
- Omit `channelId` to send on the contact's last-interacted channel
- The contact's `id` is the canonical identifier across all channels

### 24-Hour WhatsApp Window (Inherited from Channel)

When using WhatsApp, the standard 24-hour session window applies (inherited from WhatsApp's policy). Outside the window, you must use **WhatsApp templates**.

### Webhook Reliability

Respond.io does **not guarantee** webhook delivery. Failed deliveries are retried but not replayed if all retries fail. Implement:
1. Regular polling as fallback for missed events
2. Store last processed `message_id` as checkpoint
3. Query messages with `message_id > last_checkpoint` on startup

### Channel Source Abstraction

Respond.io abstracts multiple WhatsApp aggregators under similar source names:
- `whatsapp` — generic WhatsApp
- `whatsapp_cloud` — WhatsApp Cloud API (Meta)
- `twilio_whatsapp` — Twilio WhatsApp
- `360dialog_whatsapp` — 360dialog WhatsApp

When filtering by channel, use the `source` field in the webhook payload.

### API Token Scope

The API token grants **workspace-level access**. There are no granular scopes. Token holders can:
- Send messages as any user
- Access all contacts and conversations
- Modify workspace settings (depending on user role)

**Security implication:** If the API token is compromised, an attacker has full access to the workspace.

### No Message Edit/Delete

Sent messages **cannot** be edited or deleted via API. Workaround: send a correction message.

### Closing Notes Are Categorized

When closing a conversation, Respond.io supports **closing categories** (predefined in workspace settings). List available categories:
```http
GET /space/closing_notes
```

---

## 11. Recommended SupportAgent Connector Scope

### MVP (Minimum Viable Connector)

**Endpoints to wrap:**

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/contact/{identifier}/message` | Send text message |
| `POST` | `/contact/{identifier}/message` | Send attachment |
| `POST` | `/contact/{identifier}/message` | Send WhatsApp template |
| `POST` | `/contact/{identifier}/message` | Send email |
| `GET` | `/contact/{identifier}/message/list` | List messages |
| `GET` | `/contact/{identifier}` | Get contact by ID |
| `POST` | `/contact/list` | List contacts with filters |
| `PUT` | `/contact/{identifier}` | Update contact |
| `POST` | `/contact/{identifier}/tag` | Add tags |
| `DELETE` | `/contact/{identifier}/tag` | Remove tags |
| `POST` | `/contact/{identifier}/conversation/status` | Open/close conversation |
| `POST` | `/contact/{identifier}/conversation/assignee` | Assign conversation |
| `POST` | `/contact/{identifier}/lifecycle/update` | Update lifecycle |
| `GET` | `/space/user` | List workspace users |
| `GET` | `/space/channel` | List channels |
| `GET` | `/space/custom_field` | List custom fields |

**Webhook events to handle:**

| Event | Purpose |
|-------|---------|
| `NEW_INCOMING_MESSAGE` | Primary inbound trigger |
| `CONTACT_TAG_UPDATED` | Tag-based triage triggers |
| `CONTACT_ASSIGNEE_UPDATED` | Assignment triggers |
| `CONVERSATION_OPENED` | Routing triggers |
| `CONVERSATION_CLOSED` | Resolution tracking |
| `NEW_CONTACT` | New customer onboarding |

**Webhook registration:**
```http
POST https://api.respond.io/v2/integration/n8n-api/subscribe
```

**Minimum admin panel config fields:**
- `apiToken` — Respond.io API token
- `workspaceId` — (optional, for multi-workspace support)
- `webhookUrl` — our endpoint URL
- `webhookSecret` — (if needed for verification)
- `defaultChannelId` — fallback channel for messages

### Phase 2 (Parity with Other Connectors)

- `NEW_COMMENT` webhook handling
- `CONTACT_LIFECYCLE_UPDATED` trigger
- `CONTACT_UPDATED` with field-specific filtering
- `NEW_OUTGOING_MESSAGE` for two-way sync
- Closing notes integration
- Quick reply button handling

### Phase 3 (Advanced)

- Bulk message sending via broadcast campaigns
- AI agent integration (Respond.io AI capabilities)
- Advanced workflow triggers
- Analytics and reporting endpoints

---

## 12. Dependencies

### Official SDK

**Package:** `@respond-io/typescript-sdk`

```bash
npm install @respond-io/typescript-sdk
```

**Features:**
- Full TypeScript type definitions
- Automatic retry with exponential backoff
- Automatic rate limit handling
- Error class with typed error codes

**Recommendation: Use the SDK.**

The SDK provides:
- Complete type safety for all endpoints
- Built-in retry logic matching best practices
- Rate limit header parsing
- Clean, chainable API

### Raw fetch vs SDK

**Use the SDK for MVP.** Reasons:
- Well-maintained by Respond.io
- Comprehensive type coverage
- Automatic retry and rate limit handling
- Maps directly to documented API patterns

The API is simple REST over HTTPS. The SDK adds significant value through:
1. Automatic retry with backoff
2. Type safety
3. Error class with rate limit info

### MCP Server Available

Respond.io provides an **official MCP server** (`@respond-io/mcp-server`) for Model Context Protocol integration:

```bash
npx @respond-io/mcp-server
```

**Modes:**
- `stdio` — local subprocess for Claude Desktop
- `http` — hosted HTTP server at `/mcp` endpoint

This is useful for Claude Desktop integration but not directly applicable to the SupportAgent connector.

### No Native CLI

No `gh`-equivalent CLI for Respond.io. All management is via:
- Web dashboard
- REST API
- Official SDK

---

## 13. Open Questions

### Multi-Workspace Architecture

**Question:** Does SupportAgent need to support multiple Respond.io workspaces per deployment, or is one workspace per SupportAgent deployment?

**Implication:** If multi-tenant, each tenant needs their own API token and webhook configuration.

### Webhook Reliability Strategy

**Question:** How should we handle missed webhooks given no guaranteed delivery?

**Recommendation:** Implement polling fallback:
1. Store `last_processed_message_id` checkpoint
2. On connector startup, poll for `message_id > last_checkpoint`
3. Run periodic reconciliation job (e.g., every 15 minutes)

### Channel Selection Strategy

**Question:** How should the connector handle contacts with multiple channel identities?

**Recommendation:** For MVP:
- Use `channelId` from webhook payload
- If sending outbound, prefer `channelId` from contact's last message
- Allow admin to configure default channel per tenant

### WhatsApp Template Management

**Question:** Should SupportAgent manage WhatsApp templates (create, submit for approval, track status)?

**Recommendation:** MVP = use existing templates. Phase 2 = template management UI.

### Closing Conversation Flow

**Question:** Should SupportAgent auto-close conversations when triage completes?

**Recommendation:** Optional per workflow. Expose `CONVERSATION_CLOSED` trigger and allow workflows to set closing category/summary.

### Contact Merge Handling

**Question:** Respond.io supports merging contacts. How should we handle when two contacts merge?

**Recommendation:** Listen for contact update events and detect ID changes. If contact A merges into B, update internal mappings.

---

## Appendix A: Contact Type Reference

```typescript
interface Contact {
  id: number;
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  language?: string | null;
  profilePic?: string | null;
  countryCode?: string | null;
  custom_fields?: { name: string; value: string | number | boolean | null }[] | null;
  status?: 'open' | 'close';
  tags?: string[];
  assignee?: { id: number; firstName: string; lastName: string; email: string } | null;
  lifecycle?: string | null;
  created_at: number;
}
```

## Appendix B: Message Type Reference

```typescript
type MessageType = 'text' | 'attachment' | 'whatsapp_template' | 'email' | 'quick_reply' | 'custom_payload';

type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

type MessageTraffic = 'incoming' | 'outgoing';

type MessageSenderSource = 'user' | 'api' | 'workflow' | 'ai_agent' | 'broadcast' | 'echo';
```

## Appendix C: Channel Source Reference

```typescript
type ChannelSource =
  | 'facebook'
  | 'instagram'
  | 'line'
  | 'telegram'
  | 'viber'
  | 'twitter'
  | 'wechat'
  | 'custom_channel'
  | 'gmail'
  | 'other_email'
  | 'twilio'
  | 'message_bird'
  | 'nexmo'
  | '360dialog_whatsapp'
  | 'twilio_whatsapp'
  | 'message_bird_whatsapp'
  | 'whatsapp'
  | 'nexmo_whatsapp'
  | 'whatsapp_cloud';
```

## Appendix D: Filter Operators Reference

```typescript
type FilterOperator =
  | 'isEqualTo'
  | 'isNotEqualTo'
  | 'isTimestampAfter'
  | 'isTimestampBefore'
  | 'isTimestampBetween'
  | 'exists'
  | 'doesNotExist'
  | 'isGreaterThan'
  | 'isLessThan'
  | 'isBetween'
  | 'hasAnyOf'
  | 'hasAllOf'
  | 'hasNoneOf';

type FilterCategory = 'contactField' | 'contactTag' | 'lifecycle';
```

## Appendix E: Error Code Reference

```typescript
const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMIT: 429,
  REQUEST_QUEUED: 449,
  SERVER_ERROR: 500,
};
```
