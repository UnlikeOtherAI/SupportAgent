# Microsoft Teams Connector Design

## 1. Overview

- **Category:** communication
- **Cloud vs self-hosted:** Cloud-only (Teams as a service). No on-premises equivalent. Teams connects via Microsoft Graph API — there is no "Teams Server" API that mirrors the cloud surface.
- **Official API reference:** https://learn.microsoft.com/en-us/graph/api/overview

Teams spans two distinct API surfaces that must both be wrapped:

| Surface | Purpose | Docs |
|---|---|---|
| **Microsoft Graph API** | Read/write messages, channels, chats, members; subscribe to change notifications | graph.microsoft.com/v1.0 |
| **Bot Framework** | Real-time bot messaging, proactive messages, conversation lifecycle | dev.botframework.com |

The connector primarily uses **Graph API** for inbound polling/subscriptions and outbound writes. **Bot Framework** is needed only for proactive messaging and real-time event handling via an HTTPS webhook endpoint.

---

## 2. Authentication

### 2.1 Azure AD App Registration

All authentication goes through Azure Active Directory (Entra ID). SupportAgent registers a single Azure AD application (app registration) and uses it to acquire tokens.

**Two app manifest models:**

| Model | Manifest setting | Use case |
|---|---|---|
| **Single-tenant** | `"signInAudience": "AzureADMyOrg"` | SupportAgent hosted in one tenant; only that tenant's Teams data |
| **Multi-tenant** | `"signInAudience": "AzureADMultipleOrgs"` | SupportAgent connects multiple customers across different tenants |

**Multi-tenant requires:**
- `"availableToOtherTenants": true` in manifest
- Tenant admins must grant admin consent to the app's permissions
- The connector stores per-tenant `tenantId` and uses it to construct the token endpoint:
  ```
  https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
  ```
  vs single-tenant:
  ```
  https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
  ```
  (Both use the same endpoint; multi-tenant uses the common endpoint only during the initial consent step: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`)

**Recommendation for SupportAgent MVP:** Multi-tenant with admin consent. Each tenant admin grants consent once; the connector then acquires tokens per-tenant.

### 2.2 Token Acquisition

**Client credentials flow (app-only, recommended for server-side connector):**

```http
POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

client_id={appId}&client_secret={appSecret}&scope=https://graph.microsoft.com/.default&grant_type=client_credentials
```

**Response:**
```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3599,
  "ext_expires_in": 3599
}
```

- **Lifetime:** Access tokens expire in ~1 hour (3599 seconds). Use the SDK's token cache or implement your own refresh with the same client credentials request.
- **No refresh token** in client credentials flow — just re-request with the same credentials.
- **Scope:** Use `https://graph.microsoft.com/.default` (the static list of permissions requested at app registration) instead of enumerating individual scopes.

### 2.3 Required Scopes / Permissions

Permissions are declared in the Azure portal under "API permissions" on the app registration. Two types:

| Permission type | When to use | Risk |
|---|---|---|
| **Delegated** | Acting on behalf of a signed-in user (not applicable for server-side connector) | Lower |
| **Application** | App-only auth, server-to-server (our use case) | Higher — admin consent required |

**Minimum required application permissions (Graph API v1.0):**

| Operation | Permission |
|---|---|
| Read channel messages | `ChannelMessage.Read.All` |
| Post to channel | `ChannelMessage.Send` |
| Read chat messages (1:1/group) | `Chat.Read.All` |
| Post to chat | `Chat.ReadWrite` |
| List teams | `Team.ReadBasic.All` |
| List channels | `Channel.ReadBasic.All` |
| List chat members | `ChatMember.Read.All` |
| Create/update subscriptions | `ChannelMessage.Read.All`, `Chat.Read.All` |
| Resolve user by email | `User.Read.All` |

**Admin consent:** All application permissions require tenant admin consent before they take effect. The `/oauth2/v2.0/tenantAdminConsent` endpoint or the admin consent URL can be used.

**Bot Framework auth (for proactive messaging / bot webhook):**

- Bot Framework uses the same Azure AD app but requires a separate **Bot Channels Registration** in the Azure portal.
- Bot is addressed via its **bot ID** (same as app ID) and uses the same client secret.
- Bot token is obtained via the Bot Framework's token endpoint:
  ```
  https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token
  ```
  With body: `grant_type=client_credentials&client_id={botId}&client_secret={botSecret}&scope=https://graph.microsoft.com/.default`
- Bot tokens expire in ~60 minutes and must be refreshed.

### 2.4 Token Transport

All requests carry the token as:
```
Authorization: Bearer {access_token}
```

### 2.5 Recommendation for MVP

Use Azure AD application permissions (app-only, client credentials) with multi-tenant app registration. This is the only viable server-to-server model. Store per-tenant: `tenantId`, `clientId`, `clientSecret`.

---

## 3. Inbound — Events and Intake

### 3.1 Graph API Change Notifications (Webhooks)

Teams does **not** use traditional HMAC-signed webhooks with a secret per-event. Instead, Microsoft Graph uses **subscription-based change notifications** (webhooks):

1. Create a subscription (`POST /subscriptions`) pointing to your notification URL.
2. Graph delivers HTTP POST to your URL when changes occur.
3. Validate using `clientState` — a random string you set at subscription creation; the webhook delivery echoes it back.

**Subscription payload:**
```json
{
  "changeType": "created",
  "notificationUrl": "https://your-connector.example.com/webhooks/teams",
  "resource": "teams/{team-id}/channels/{channel-id}/messages",
  "expirationDateTime": "2026-04-20T00:00:00Z",
  "clientState": "your-secret-random-string"
}
```

**Delivery validation:**
- Your endpoint must respond to a `POST` with a `VALIDATION` chip (a JSON body containing `validationRequest.type === "verificationRequest"` and echoing back the challenge).
- Every notification delivery must return HTTP 200 within 3 seconds or the delivery is retried.

**Supported subscription resources for Teams:**

| Resource | Subscription path | Permissions needed |
|---|---|---|
| Channel message | `teams/{team-id}/channels/{channel-id}/messages` | `ChannelMessage.Read.All` (app) |
| Chat message | `chats/{chat-id}/messages` | `Chat.Read.All` (app) |
| Chat (member changes) | `chats/{chat-id}` | `Chat.Read.All` |
| Channel | `teams/{team-id}/channels/{channel-id}` | `Channel.ReadBasic.All` |
| Team | `teams/{team-id}` | `Team.ReadBasic.All` |

**To subscribe to ALL channel messages org-wide:** `teams/getAllMessages` (requires `ChannelMessage.Read.All` and admin consent).

**Notification payload fields for chatMessage:**

```json
{
  "value": [{
    "subscriptionId": "id",
    "clientState": "your-secret-random-string",
    "changeType": "created",
    "resource": "teams/{team-id}/channels/{channel-id}/messages",
    "tenantId": "tenant-id",
    "resourceData": {
      "id": "1616990032035",
      "messageType": "message",
      "createdDateTime": "2021-03-29T03:53:52.035Z",
      "from": {
        "user": { "id": "uuid", "displayName": "..." }
      },
      "body": {
        "contentType": "html",
        "content": "<p>Hello</p>"
      },
      "channelIdentity": {
        "teamId": "uuid",
        "channelId": "19:uuid@thread.tacv2"
      },
      "mentions": [{ "mentioned": { "user": { "id": "uuid" }}}]
    }
  }]
}
```

**Subscription expiration:** Subscriptions expire. Maximum lifetime is **4230 minutes** (~3 days). You must renew before expiration or re-create. Subscriptions also expire if the Azure AD app secret is rotated.

### 3.2 Bot Framework Webhook (Real-Time)

The Bot Framework provides a separate HTTPS webhook for real-time bot messages. When a user sends a direct message to the bot or the bot is @mentioned in a channel:

- Teams POSTs to your registered bot webhook: `https://your-connector.example.com/bot/teams`
- Payload follows the Bot Framework Activity schema:
```json
{
  "type": "message",
  "id": "uuid",
  "timestamp": "2026-04-18T...",
  "channelId": "msteams",
  "conversation": {
    "id": "19:uuid@thread.v2"
  },
  "from": {
    "id": "uuid",
    "name": "User Name"
  },
  "recipient": {
    "id": "bot-id"
  },
  "text": "Hello bot",
  "entities": [{"type": "mention", "mentioned": {"id": "bot-id", "name": "SupportAgent"}}]
}
```

**Bot identity in payload:** The bot identifies itself via `recipient.id` (its bot ID). The `from.id` is the user's AAD object ID.

**Signature verification:** Bot Framework uses a different mechanism — a shared bot secret set during Bot Channels Registration. The `MS-ChannelToken` header is signed. Validate by computing HMAC-SHA256 of the raw request body with the bot secret. Header name: `Authorization` with value `Bearer {channel token}` — but the actual validation uses the request body HMAC against the bot secret, not a JWT.

### 3.3 Polling Fallback

Graph API does not provide an `updated_since` cursor directly. Use:

**Delta query:** `GET /teams/{team-id}/channels/{channel-id}/messages?$deltaToken=...` — returns changes since last token. Use the `@odata.nextLink` from the response to continue paging. Store the `@odata.deltaLink` as your cursor.

**List with top/filter:**
```http
GET /teams/{team-id}/channels/{channel-id}/messages?$orderby=createdDateTime desc&$top=50
```
No native `createdDateTime gt {timestamp}` filter — you must filter client-side or use `$search`.

**Pagination:** OData with `@odata.nextLink` header (URL for next page), `$top` (max 50 or 100 depending on endpoint), `$skip`.

### 3.4 Payload Fields to Persist

| Field | Path in chatMessage |
|---|---|
| `id` | `$.id` |
| `externalUrl` | `$.webUrl` (e.g. `https://teams.microsoft.com/l/message/...`) |
| `title` | N/A — no title field; use first line or subject |
| `body` | `$.body.content` (strip HTML tags or use `body.contentType`) |
| `authorId` | `$.from.user.id` |
| `authorName` | `$.from.user.displayName` |
| `createdAt` | `$.createdDateTime` (ISO 8601) |
| `threadId` | `$.channelIdentity.channelId` or `$.chatId` |
| `teamId` | `$.channelIdentity.teamId` |
| `mentions` | `$.mentions[*].mentioned.user.id` |
| `replyToId` | `$.replyToId` (for threading) |
| `messageType` | `$.messageType` |

---

## 4. Outbound — Writing Back

### 4.1 Post Message to Channel

```http
POST https://graph.microsoft.com/v1.0/teams/{team-id}/channels/{channel-id}/messages
Authorization: Bearer {token}
Content-Type: application/json

{
  "body": {
    "contentType": "html",
    "content": "<p>SupportAgent has analyzed this issue and created a ticket.</p>"
  }
}
```

- **Permission:** `ChannelMessage.Send` (delegated) or `Teamwork.Migrate.All` (app-only, migration only — not for normal use). **App-only normal messaging is NOT supported on v1.0** — you must use delegated permissions for channel message posting.
- **Response:** `201 Created` with the created `chatMessage` object including `id`.
- **Mentions:** `<at>displayName</at>` in the HTML content. Teams resolves to the user.
- **Adaptive Cards:** Set `contentType` to `"adaptiveCard"` and `content` to the Adaptive Card JSON.

### 4.2 Post Message to Chat (1:1 or Group)

```http
POST https://graph.microsoft.com/v1.0/chats/{chat-id}/messages
Authorization: Bearer {token}
Content-Type: application/json

{
  "body": {
    "contentType": "html",
    "content": "<p>Hello from SupportAgent</p>"
  }
}
```

- **Permission:** `Chat.ReadWrite` (app-only is NOT supported — must be delegated or use `Teamwork.Migrate.All` for migration).
- **Constraint:** You cannot create a new chat via Graph API — you must know the existing `chat-id`. Retrieve existing chats via `GET /chats`.
- **Group chats:** Same endpoint; `chat-id` must be for a group conversation.

### 4.3 Adaptive Cards

To send an Adaptive Card, use the channel or chat message endpoint with:

```json
{
  "body": {
    "contentType": "adaptiveCard",
    "content": {
      "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
      "type": "AdaptiveCard",
      "version": "1.4",
      "body": [
        {
          "type": "TextBlock",
          "text": "New Issue Created",
          "weight": "Bolder",
          "size": "Medium"
        },
        {
          "type": "FactSet",
          "facts": [
            { "title": "Status", "value": "Open" },
            { "title": "Priority", "value": "High" }
          ]
        },
        {
          "type": "TextBlock",
          "text": "**Description:** Short summary here"
        }
      ],
      "actions": [
        {
          "type": "Action.OpenUrl",
          "title": "View in SupportAgent",
          "url": "https://support.example.com/issues/123"
        }
      ]
    }
  }
}
```

Teams renders the card natively. `contentType` is `"adaptiveCard"` (lowercase, no space).

### 4.4 Reply to a Message (Threading)

```http
POST https://graph.microsoft.com/v1.0/teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies
Authorization: Bearer {token}
Content-Type: application/json

{
  "body": {
    "contentType": "html",
    "content": "<p>Replying to the thread</p>"
  }
}
```

- Same permissions as posting to channel.
- Replies appear nested under the parent message in Teams.

### 4.5 Edit Message

Not directly supported via Graph API v1.0. You can PATCH a message you sent:

```http
PATCH https://graph.microsoft.com/v1.0/teams/{team-id}/channels/{channel-id}/messages/{message-id}
Authorization: Bearer {token}
Content-Type: application/json

{
  "body": {
    "contentType": "html",
    "content": "<p>Updated content</p>"
  }
}
```

Only works for messages sent by your bot/app.

### 4.6 Delete Message

Not supported in Graph API v1.0. The Bot Framework SDK supports message deletion via `TurnContext.DeleteActivityAsync()`.

### 4.7 Mention User

In HTML content, wrap the display name:
```html
<at>John Doe</at>
```

Teams will render as `@John Doe` and notify that user. Must match the user's display name exactly as it appears in the tenant directory.

### 4.8 Attachments (Files)

Files are sent as online attachments via the message's `attachments` property. You must first upload the file to SharePoint/OneDrive and then reference it:

```json
{
  "body": { "contentType": "html", "content": "<p>See attached</p>" },
  "attachments": [{
    "id": "1",
    "contentType": "reference",
    "contentUrl": "https://tenant.sharepoint.com/sites/site/Shared%20Documents/file.pdf",
    "name": "file.pdf"
  }]
}
```

Uploading requires `Sites.ReadWrite.All` and SharePoint permissions.

### 4.9 Close / Archive Thread

Teams has no "close issue" concept. If you're monitoring a specific channel, there is no status transition. You can:
- Pin a message as a resolution indicator
- Post a "Resolved" reply in the thread
- Use tags/tagging if the workspace has tag support

---

## 5. Labels, Flags, Fields, Priorities

Teams does **not** have an issue-tracker-style label/priority model. Its organizational primitives are:

| Primitive | Description |
|---|---|
| **Team** | Top-level group (like an organization) |
| **Channel** | Topic-based conversation within a team (like a category) |
| **Chat (1:1)** | Direct message between two users |
| **Chat (Group)** | Group conversation, up to 250 users |
| **Message** | Individual post within channel or chat |
| **Tag** | Lightweight label that can be applied to team members for notification |

**Tags:** Teams supports tagging users within a team. Tags are defined at the team level and can include multiple members. Tag a group with `<at>tag:TagName</at>`.

**There are no:** labels, status values, severity levels, custom fields, issue types, or workflows in the Teams API. These concepts do not map to Teams — it is a communication platform, not an issue tracker.

**What we can use for grouping/triggering:**
- Team ID and name
- Channel ID, name, and type (`standard`, `private`, `shared`)
- Tags
- Message content (regex matching on `body.content`)

---

## 6. Triggers We Can Match On

From the inbound chatMessage payload:

| Trigger | Path in payload |
|---|---|
| New message in channel | `$.resourceData.channelIdentity` + `$.changeType === "created"` |
| New message in chat | `$.resourceData.chatId` + `$.changeType === "created"` |
| Message content regex | `$.resourceData.body.content` (HTML, strip tags or match on text content) |
| User @mention of bot | `$.resourceData.mentions[*].mentioned.user.id === botId` |
| Reply to bot message | `$.resourceData.replyToId` is set and parent message authored by bot |
| Channel scope | Filter by `teamId` + `channelId` from channel message subscription |
| Tag mention | Match `<at>tag:TagName</at>` in body content |

**Notable:** There is no webhook event for status changes, label changes, or close events — these don't exist in Teams.

---

## 7. Identity Mapping

### 7.1 User ID Shape

- AAD Object ID: **UUID** format, e.g. `8ea0e38b-efb3-4757-924a-5f94061cf8c2`
- Stored in `from.user.id` on every message

### 7.2 Resolving User by Email

```http
GET https://graph.microsoft.com/v1.0/users?$filter=mail eq 'user@example.com'&$select=id,displayName,mail
Authorization: Bearer {token}
```

Requires `User.Read.All` permission.

### 7.3 Bot Identity for no_self_retrigger

- Bot's identity is its AAD Object ID (same as `appId` in the Bot Channels Registration).
- In `chatMessage.from`: `$.from.application.id` is the bot's app ID when the message is from the bot.
- When the bot posts a message, `from.application` is non-null; when a user posts, `from.user` is non-null.
- Store the bot's own AAD ID in config and filter: if `from.application.id === botId`, skip processing.

### 7.4 Author Field on Posted Messages

When our bot posts a message, the `from` field shows:
```json
"from": {
  "application": {
    "id": "bot-app-id",
    "displayName": "SupportAgent"
  }
}
```
This is reliable — the API correctly attributes messages to the app identity.

---

## 8. Rate Limits

Microsoft Graph returns **HTTP 429** when throttled, with a `Retry-After` header (seconds to wait).

**Teams/Communication limits (from service-specific limits):**

| Resource | Limit |
|---|---|
| Messages per app per tenant | Context-dependent; implement exponential backoff |
| Subscriptions per app | 1 per resource path per tenant |
| Subscription max lifetime | 4230 minutes (~3 days) |

**General Graph limits:**
- OData pagination default: 100 items
- Max `$top`: varies by endpoint (often 999 or unlimited with delta tokens)
- Batching: JSON batching is supported — combine up to ~20 requests per batch, evaluated individually against rate limits

**Best practice:** Use Graph SDK (handles Retry-After automatically), implement a message queue to smooth bursty sends, and use delta queries instead of full-list polling.

---

## 9. Pagination & Search

**Pagination style:** OData with `@odata.nextLink` (URL in response header, also in `$.@odata.nextLink` in body). No page-number pagination.

**Max page size:** `$top` supports up to 999 on most endpoints. Default is 100.

**Delta queries (preferred for incremental sync):**
```http
GET /teams/{team-id}/channels/{channel-id}/messages?$deltaToken=...
```
Response contains `@odata.deltaLink` (next delta URL) or `@odata.nextLink` (more pages in current batch).

**Search:** Teams messages support `$search` parameter for full-text search (requires `ChannelMessage.Read.All` with `-All` suffix for org-wide search). Limited to OData filter on `createdDateTime` range + message type.

---

## 10. Known Gotchas

1. **App-only channel/chat message POST is restricted.** Graph API v1.0 does not support sending channel or chat messages with application (app-only) permissions. You must use delegated permissions or the Bot Framework. This is a critical limitation for a server-side connector — consider using the Bot Framework for sending, or require a delegated user context.

2. **Cannot create new chats via Graph.** You can only post to existing `chat-id` values. There is no `POST /chats` to create a new 1:1 or group chat. Retrieve existing chats via `GET /chats` (requires `Chat.ReadBasic.All`).

3. **Subscriptions expire and must be renewed.** Max lifetime is 3 days. If you don't renew, you stop receiving events. Implement a background job that renews subscriptions before expiry.

4. **No traditional webhook secrets.** Graph change notification webhooks use `clientState` for validation — this is not a cryptographic signature, just a shared random string. Protect against replay attacks by tracking subscription IDs and delivery timestamps.

5. **No issue-tracker model.** Teams has no labels, statuses, priorities, or custom fields. If SupportAgent's trigger model depends on these concepts, Teams cannot support them. Use channel membership and message content as the primary matching mechanism.

6. **Channel IDs use the `thread.tacv2` format.** IDs look like `19:561fbdbbfca848a484f0a6f00ce9dbbd@thread.tacv2`. Do not assume these are stable GUIDs — they contain a hash of the channel name plus the domain.

7. **Multi-tenant consent complexity.** Each tenant admin must grant admin consent to application permissions. There is no way around this — Teams tenant data is protected by Azure AD. Document this in the admin setup flow.

8. **Bot Framework token is separate from Graph token.** Bot tokens use `https://login.microsoftonline.com/botframework.com` endpoint with `scope=https://graph.microsoft.com/.default`. The bot token and Graph token are separate — both must be refreshed independently.

9. **TeamsFx SDK is deprecated.** The previous recommended SDK (TeamsFx) is in community-only support until September 2026. Use raw `fetch` or `@microsoft/graph-sdk` instead.

10. **Adaptive Card version must be 1.4+ for Teams.** Use `"version": "1.4"` in the card schema. Earlier versions may render inconsistently.

11. **HTML content must be properly escaped.** When posting HTML, entities like `<`, `>`, `&` must be HTML-escaped. The message body content is plain HTML, not Markdown.

12. **Notification endpoint must be reachable from Microsoft's IPs.** Graph sends webhooks to your public HTTPS URL. Local dev requires a tunnel (ngrok, cloudflared). Must accept HTTPS with a valid certificate.

13. **Moderation policies can block messages.** Tenants with data loss prevention (DLP) or message moderation policies may silently block bot-sent messages. There is no API to detect this — messages may simply not appear.

---

## 11. Recommended SupportAgent Connector Scope

### MVP

**Endpoints to wrap (Graph API v1.0):**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/chats` | List available group chats |
| `GET` | `/teams/{id}/channels` | List channels in a team |
| `GET` | `/teams/{id}/channels/{id}/messages` | Read channel messages |
| `GET` | `/chats/{id}/messages` | Read chat messages |
| `POST` | `/teams/{id}/channels/{id}/messages` | Send to channel |
| `POST` | `/chats/{id}/messages` | Send to chat |
| `POST` | `/teams/{id}/channels/{id}/messages/{id}/replies` | Reply in thread |
| `POST` | `/subscriptions` | Create change notification subscription |
| `GET` | `/subscriptions/{id}` | Get subscription status |
| `PATCH` | `/subscriptions/{id}` | Renew subscription |
| `DELETE` | `/subscriptions/{id}` | Delete subscription |
| `GET` | `/users?$filter=mail eq '{email}'` | Resolve user by email |

**Webhook events to handle:**
- `channelMessage` created (via Graph subscription)
- `chatMessage` created (via Graph subscription)
- Bot Framework incoming message (for proactive bot commands and @mentions)

**Minimum admin panel config fields:**
- `tenantId` (Azure tenant ID)
- `clientId` (app registration client ID)
- `clientSecret` (app registration client secret)
- `botId` (bot app ID, same as clientId)
- `botSecret` (bot channel registration secret)
- `webhookNotificationUrl` (your public HTTPS endpoint for Graph subscriptions)
- `botWebhookUrl` (your public HTTPS endpoint for Bot Framework messages)
- `watchedTeamIds[]` (list of team IDs to monitor)
- `watchedChannelIds[]` (list of channel IDs to monitor per team)
- `botAadId` (stored for no_self_retrigger filtering)

**Bot Framework addition for MVP:** Because app-only message sending is blocked, the MVP should use the Bot Framework for outbound. Bot Framework supports proactive messaging with app-only auth via the bot credentials. This requires registering a Bot Channels Registration in the same Azure AD app.

### Phase 2

- Adaptive Cards renderer for rich notifications
- Tag-based notifications (`<at>tag:TagName</at>`)
- Delta query cursors for efficient incremental sync
- Subscription auto-renewal background job
- 1:1 chat message handling (must enumerate existing chats)
- Message edit detection via subscription lifecycle

### Phase 3

- Message reactions monitoring
- Channel member join/leave events (via `conversationMember` subscriptions)
- Link unfurling for support ticket URLs
- Message extension (search command) for desktop Teams integration

---

## 12. Dependencies

### 12.1 Official SDKs

**Node.js / TypeScript:**
- `@microsoft/graph-sdk` (GA, v5.x) — official Graph SDK. Supports TypeScript, has built-in retry handling, batch requests, and token caching.
- `botbuilder` (GA) — Bot Framework SDK for Node.js. Handles bot webhook, proactive messaging, Adaptive Cards.
- `@microsoft/adaptivecards-tools` — Adaptive Card authoring and rendering helpers.

**NPM package names:**
- `npm install @microsoft/graph @microsoft/msal-node botbuilder adaptivecards`
- Note: The package is `@microsoft/graph` not `@microsoft/msgraph`.

### 12.2 Raw fetch vs SDK

**Use the Graph SDK** (`@microsoft/graph`). Reasons:
- Handles token acquisition and caching automatically
- Implements Retry-After backoff for 429 responses
- Strongly typed models for all resources (ChatMessage, Channel, Subscription, etc.)
- Batch request builder built in

**Use Bot Framework SDK** (`botbuilder`) for:
- Bot webhook handling
- Proactive messaging
- Adaptive Card templating
- Conversation state management

**Do not use:** `TeamsFx` — it is deprecated.

### 12.3 No Native CLI

There is no `gh`-equivalent CLI for Teams. The closest tooling:
- **Teams Admin Center** (web UI for tenant management)
- **Microsoft Graph PowerShell SDK** (`Install-Module Microsoft.Graph`)
- **Microsoft 365 CLI** (`npm install -g @pnp/cli-microsoft365`) — cross-platform CLI for Graph + Teams management

For parity with `@support-agent/github-cli`, there is no equivalent. Consider building a thin CLI wrapper around the Graph SDK if CLI access is needed.

---

## 13. Open Questions

1. **App-only messaging?** Can we use Bot Framework's proactive message API with only application permissions (no user context)? If yes, the MVP can avoid the delegated auth complexity. If no, we need to require a "SupportAgent" user account in each tenant.

2. **Tenant type?** Do we need to support GCC/GCC-High/DoD tenants (US Government clouds)? These have separate Graph endpoints (`graph.microsoft.us`, `dod.graph.microsoft.com`) and different app registration flows. Flag this as a Phase 2 consideration.

3. **China sovereign cloud?** Teams operated by 21Vianet uses a separate sovereign cloud endpoint. Only include if customers require it.

4. **Bot user in tenant?** Does the customer need to install the SupportAgent app into their Teams tenant (app distribution via App Studio / Developer Portal)? We need a distribution strategy — either sideload the app manifest or publish to the Teams Store.

5. **Message deletion?** Is soft-delete (editing to empty content) acceptable, or is hard-delete via Bot Framework required?

6. **1:1 chat discovery?** How do we identify relevant 1:1 chats to monitor? There is no "watch list" — we must enumerate all chats the bot is part of via `GET /chats`. How do we surface new incoming 1:1 chats?

7. **Moderation compliance?** Should we implement a compliance check for DLP policy violations, or is this out of scope for MVP?

8. **Webhook reliability?** Graph change notification delivery is not guaranteed. Should we implement a secondary polling fallback for missed events, or rely on subscription renewal + reconciliation?