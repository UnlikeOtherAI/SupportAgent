# Slack Connector Design

## 1. Overview

- **Category**: Communication channel
- **Cloud**: Slack cloud only (api.slack.com); no self-hosted variant
- **API reference**: https://api.slack.com (REST API)
- **Official SDK**: `@slack/web-api` (TypeScript), `@slack/bolt` (framework with Events API handling)
- **Webhook reference**: https://api.slack.com/reference/events
- **Install reference**: https://api.slack.com/reference/manifests

### Platform Model

Slack operates as a **workspace** (formerly "team") containing **channels** (public `#`, private, DM, MPIM). Bots are first-class users within a workspace. Unlike issue trackers, Slack is a real-time messaging platform with:

- **Channels**: persistent conversation spaces (public `#`, private `##`, shared)
- **Messages**: time-ordered posts with optional thread replies
- **Threads**: sub-conversations anchored to a parent message
- **Reactions**: emoji reactions to messages
- **Slash commands**: bot-triggering `/commands`
- **Interactive components**: buttons, select menus, modals opened by bots
- **Slack Connect**: cross-workspace channels

### Hosting Modes

| Mode | Notes |
|------|-------|
| Slack cloud (default) | `https://slack.com/api/*` — all API methods |
| Enterprise Grid | org-wide app deployment; org token (`xoxe-`) vs workspace token |
| No self-hosted | No equivalent to GitHub Enterprise Server |

---

## 2. Authentication

### Token Types

Slack has three distinct token types with different capabilities:

| Token Prefix | Type | Scope | Lifetime |
|-------------|------|-------|----------|
| `xoxb-` | Bot token | Scoped to bot's installed workspace | Default: indefinite; optional token rotation (12h expiry) |
| `xoxp-` | User token | Scoped to a specific user | Default: indefinite; optional token rotation |
| `xoxe-` | Enterprise token | Org-wide access | Only on Enterprise Grid; `xoxe-r-` for refresh tokens |
| `xoxe-` (refresh) | Refresh token | Single-use, rotates org token | `xoxe-r-*` prefix |

**App-Level Token** (`xapp-*`): Created in app settings under "Basic Information". Grants workspace-level access across all installed workspaces.

### Recommended for SupportAgent MVP: Bot Token (`xoxb-`)

- Simplest setup: create app → add bot user → install to workspace → receive bot token
- No OAuth redirect flow required for single-workspace tenants
- Bot token inherits `bot` scope + granular permission scopes
- Scoped to workspace; works for DMs, channels where bot is added

### OAuth 2.0 Flow (Multi-Workspace)

For Slack Connect or multi-workspace tenants:

```
1. Direct user to: https://slack.com/oauth/v2/authorize?client_id=<client_id>&scope=<scopes>
2. User approves → redirect with ?code=...
3. POST https://slack.com/api/oauth.v2.access with code, client_id, client_secret
4. Response: { ok, authed_user, bot: { bot_user_id, bot_access_token: "xoxb-..." } }
5. Store bot_access_token
```

### Token Rotation

Enable via `"token_rotation_enabled": true` in app manifest:
- Access tokens expire every **12 hours**
- Refresh tokens (`xoxe-r-*`) are single-use
- Refresh via `POST /api/oauth.v2.access` with `grant_type=refresh_token`

### Required Scopes

| Operation | Scope |
|-----------|-------|
| Post messages | `chat:write` |
| Read public channel messages | `channels:history` |
| Read private channel messages | `groups:history` |
| Read DMs | `im:history` |
| Read group DMs | `mpim:history` |
| List channels | `channels:read`, `groups:read`, `im:read`, `mpim:read` |
| List users | `users:read` |
| Read user email | `users:read.email` (required for apps after Jan 4, 2017) |
| Receive mention events | `app_mentions:read` |
| Receive all message events | per-channel history scope |
| Add reactions | `reactions:write` |
| Read reactions | `reactions:read` |

### Header Carrying the Token

```
Authorization: Bearer <bot_token_or_user_token>
```

---

## 3. Inbound — Events and Intake

### Events API Support: YES

Slack delivers events via HTTP POST to your configured Request URL.

### Event Wrapper Structure

```json
{
  "token": "xxx",
  "team_id": "T123ABC456",
  "api_app_id": "A123ABC456",
  "event": { ... },
  "type": "event_callback",
  "event_id": "Ev123ABC456",
  "event_time": 1234567890
}
```

### Signature Verification (HMAC SHA256)

**Headers**: `X-Slack-Signature` (value: `v0=<hex_digest>`), `X-Slack-Request-Timestamp` (Unix timestamp)

**Verification**:
1. Reject if `abs(timestamp - now) > 300 seconds` (replay attack protection)
2. Compute: `HMAC-SHA256(signing_secret, "v0:{timestamp}:{raw_request_body}")`
3. Constant-time compare to header value

```typescript
import crypto from 'crypto';

function verifySlackSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  signingSecret: string
): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(base)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
}
```

### Relevant Event Types

| Event | Scope Required | Description |
|-------|---------------|-------------|
| `message.channels` | `channels:history` | Message in public channel |
| `message.groups` | `groups:history` | Message in private channel |
| `message.im` | `im:history` | Direct message to bot |
| `message.mpim` | `mpim:history` | Multi-person DM |
| `app_mention` | `app_mentions:read` | Bot mentioned in channel |
| `reaction_added` | `reactions:read` | Emoji reaction added |
| `reaction_removed` | `reactions:read` | Emoji reaction removed |
| `message_changed` | per-channel scope | Message edited |
| `message_deleted` | per-channel scope | Message deleted |

### Retry / Delivery Semantics

- **Timeout**: Return HTTP 2xx within **3 seconds** or Slack retries
- **HTTP 409**: Does NOT trigger retry
- **Deduplication**: Use `event_id` as idempotency key

### Polling Fallback

Poll via `POST /api/conversations.history`:

```typescript
const result = await slack.conversations.history({
  channel: 'C123',
  oldest: lastProcessedTimestamp,
  limit: 200
});
```

**Note**: `conversations.replies` has **1 request/minute, max 15 total** for non-Marketplace apps (post-May 2025).

### Payload Fields to Persist

**Message event**:
```json
{
  "type": "message",
  "channel": "C123ABC456",
  "channel_type": "channel",
  "user": "U123ABC456",
  "text": "Hello world",
  "ts": "1515449522.000016",
  "thread_ts": "1515449522.000016",
  "bot_id": "B123ABC456",
  "subtype": "bot_message"
}
```

**App mention event**:
```json
{
  "type": "app_mention",
  "user": "U123ABC456",
  "text": "<@U0LAN0Z89> help with this",
  "ts": "1515449522.000016",
  "channel": "C123ABC456"
}
```

### no_self_retrigger

```typescript
// On any incoming event:
if (event.bot_id && event.bot_id === ourBotId) return; // Skip our own messages
if (event.user && event.user === ourBotUserId) return;

// Store delivery markers:
const response = await slack.chat.postMessage({ channel, text });
const deliveryMarker = response.ts;
```

---

## 4. Outbound — Writing Back

### Post Message

```
POST /api/chat.postMessage
Authorization: Bearer <token>
{
  "channel": "C123ABC456",
  "text": "Hello world",
  "blocks": [ ... ],
  "thread_ts": "1234567890.123456",
  "metadata": { "event_type": "...", "event_payload": {} }
}
```
**Rate limit**: 1 message/second per channel.

### Update Message

```
POST /api/chat.update
{ "channel": "C123ABC456", "ts": "1234567890.123456", "text": "Updated text" }
```
**Constraint**: Can only update messages posted by the same bot.

### Delete Message

```
POST /api/chat.delete
{ "channel": "C123ABC456", "ts": "1234567890.123456" }
```

### Post Ephemeral Message

```
POST /api/chat.postEphemeral
{ "channel": "C123ABC456", "user": "U123ABC456", "text": "Visible only to you" }
```

### Open a DM

```
POST /api/conversations.open
{ "users": "U123ABC456", "return_im": true }
Response: { "ok": true, "channel": { "id": "D123ABC456" } }
```

### Add/Remove Reaction

```
POST /api/reactions.add
{ "name": "thumbsup", "channel": "C123ABC456", "timestamp": "123456.789" }
```

### Slash Commands

Configured in app settings. POST to Request URL with:

| Parameter | Description |
|-----------|-------------|
| `command` | e.g., `/triage` |
| `text` | Arguments |
| `user_id`, `channel_id` | Invoker context |
| `response_url` | Ephemeral response URL (valid 30 min) |
| `trigger_id` | For `views.open` modals |

**Response**:
```json
{ "response_type": "ephemeral", "text": "Processing..." }
```

### Mention User

Use `<@U123ABC456>` syntax in message text.

### Attach File

```
POST /api/files.uploadV2
{ "channel_id": "C123ABC456", "filename": "screenshot.png", "file": <binary> }
```

---

## 5. Labels, Flags, Fields, Priorities

Slack is a communication channel, not an issue tracker. It has no native:
- Labels, custom fields, priority, severity, or workflow statuses

**Workarounds**:
- Emoji reactions as lightweight tags (`:bug:`, `:eyes:`, `:white_check_mark:`)
- Message `metadata` for structured data:
```json
{ "metadata": { "event_type": "support_ticket", "event_payload": { "priority": "high" } } }
```

---

## 6. Triggers We Can Match On

| Trigger | Source | Match Criteria |
|---------|--------|----------------|
| App mentioned | `app_mention` | `event.type === "app_mention"` |
| Message in channel | `message.*` | `event.channel === channelId` |
| Thread reply | `message.*` | `event.thread_ts === parentTs` |
| Reaction added | `reaction_added` | `event.reaction === "thumbsup"` |
| Exact command | `event.text` | `event.text === "/triage"` |
| Contains mention | `event.text` | `event.text.includes("<@BOT_USER_ID>")` |
| Regex match | `event.text` | `/triage\\s+(https?://\\S+)/i` |

---

## 7. Identity Mapping

### User ID Shape

- Format: `U` prefix + alphanumeric (e.g., `U123ABC456`)
- Globally unique across workspaces in Enterprise Grid

### Bot Identity

```typescript
const auth = await slack.auth.test();
const ourBotUserId = auth.user_id;      // "U0LAN0Z89"
const botInfo = await slack.bots.info({ bot: ourBotUserId });
const ourBotId = botInfo.bot?.bot_id;  // "B123ABC456"
```

### Resolve User → Email

```
POST /api/users.info
{ "user": "U123ABC456" }
```
Requires `users:read.email` scope. Returns `profile.email`.

---

## 8. Rate Limits

### Tier System

| Tier | Calls/Minute | Methods |
|------|--------------|---------|
| Tier 2 | 20+ | `conversations.list` |
| Tier 3 | 50+ | Most methods |
| Special | Varies | Method-specific |

### Specific Limits

| Operation | Limit |
|-----------|-------|
| `chat.postMessage` | 1 msg/sec per channel |
| `conversations.replies` (non-Marketplace) | **1 req/min, max 15** |
| `views.open` | 10/workspace/min |
| Events API | 30,000/workspace/app/60 min |

### Rate Limit Response

```json
{ "ok": false, "error": "ratelimited", "retry_after": 12 }
```

---

## 9. Pagination & Search

### Cursor-Based Pagination

```typescript
const result = await slack.conversations.list({ cursor: '...', limit: 200 });
// response_metadata.next_cursor until empty
```

### Max Page Sizes

| Method | Max `limit` |
|--------|-------------|
| `conversations.list` | 1,000 |
| `conversations.history` | 999 |
| `users.list` | 200 |

### Search API

```
POST /api/search.messages
{ "query": "triage has:permalink in:channel", "count": 20 }
```

Query syntax: `in:channel`, `from:@username`, `has:permalink`, `has:metadata metadata_type:X`, `after:2024-01-01`

---

## 10. Known Gotchas

1. **Event deduplication**: Use `event_id` as idempotency key; Slack may retry
2. **Message ordering not guaranteed**: Use `ts` as source of truth
3. **Signing secret timestamp window**: 5 minutes; reject older requests
4. **Bot can only modify its own messages**: `chat.update`/`chat.delete`
5. **Channel membership required**: Bot must be invited to receive events
6. **`conversations.replies` rate limit (critical)**: 1 req/min for non-Marketplace apps
7. **Multi-workspace**: Each workspace generates its own access token; `team_id` identifies source
8. **Eventual consistency**: Message may not appear in history immediately after posting

---

## 11. Recommended SupportAgent Connector Scope

### MVP (Phase 1)

**Endpoints**:
- `auth.test`, `bots.info` — identity resolution
- `users.info`, `users.list` — user lookup
- `conversations.list`, `conversations.history`, `conversations.open` — channel ops
- `chat.postMessage`, `chat.postEphemeral`, `chat.update`, `chat.delete` — messaging
- `reactions.add`, `reactions.remove` — reactions
- `files.uploadV2` — attachments

**Webhook events**:
- `app_mention`, `message.channels`, `message.groups`, `message.im` — triggers
- `reaction_added`, `reaction_removed` — optional signals
- `message_changed`, `message_deleted` — state sync

**Slash commands**: `/triage <url>`, `/status <run-id>`, `/notify <message>`

**Config fields**:
```typescript
interface SlackConnectorConfig {
  botToken: string;           // "xoxb-..."
  signingSecret: string;       // From Basic Information
  botUserId: string;          // Resolved at startup
  botId: string;              // Resolved at startup
  teamId: string;             // Workspace ID
  defaultChannel: string;     // Notification channel
  monitoredChannels: string[];
  dmPolicy: 'allow' | 'block';
  mentionStyle: 'require' | 'allow';
}
```

### Phase 2

- `views.open`, `views.publish` — modals and Home tab
- `search.messages` — history reconciliation
- `team_join`, `channel_archive` events
- Reaction-based triggers
- Thread-aware updates

### Phase 3

- Slack Connect multi-workspace
- `views.publish` Home tab dashboard
- Scheduled message delivery
- Workflow builder integration

---

## 12. Dependencies

### Official SDKs

| Package | Purpose | npm |
|---------|---------|-----|
| `@slack/web-api` | Core API client | @slack/web-api |
| `@slack/bolt` | Framework with Events API, OAuth, interactivity | @slack/bolt |
| `@slack/oauth` | OAuth installation helpers | @slack/oauth |

**@slack/bolt** recommended for webhook server:
```typescript
import { App } from '@slack/bolt';
const app = new App({ token, signingSecret });

app.event('app_mention', async ({ event, client }) => {
  await client.chat.postMessage({ channel: event.channel, text: `Hi <@${event.user}>!` });
});
app.command('/triage', async ({ command, ack, client }) => {
  await ack();
  await client.chat.postMessage({ channel: command.channel_id, text: `Starting triage...` });
});
```

**Use raw `fetch`** for outbound-only workers (smaller bundle).

### No CLI

Slack has no CLI equivalent to GitHub's `gh`.

---

## 13. Open Questions

1. **Single vs multi-workspace**: Need OAuth for Enterprise Grid? MVP: single workspace with bot token.
2. **DM policy**: Require `@mention` in channels, allow DMs? Recommendation: yes.
3. **Threading strategy**: Reply in thread when original is threaded? Recommendation: yes.
4. **Reaction signals**: Treat reactions as triggers? Recommendation: Phase 2, configurable.
5. **`conversations.replies` limit**: Cache aggressively or use `message.channels` with thread_ts filter.
6. **Interactive vs slash commands**: Slash commands for MVP, interactive components for Phase 2.
7. **Token rotation**: Add only if needed (adds complexity).
8. **Webhook URL per tenant**: Single endpoint, fan out by `team_id` in payload. Recommendation: yes.

---

## Appendix A: Key Endpoints

| Method | Endpoint | Rate Limit |
|--------|----------|-----------|
| `auth.test` | `POST /api/auth.test` | Tier 3 |
| `bots.info` | `POST /api/bots.info` | Tier 3 |
| `users.info` | `GET /api/users.info` | Tier 3 |
| `conversations.list` | `POST /api/conversations.list` | Tier 2 |
| `conversations.history` | `POST /api/conversations.history` | Tier 3 |
| `conversations.replies` | `POST /api/conversations.replies` | **1/min** |
| `conversations.open` | `POST /api/conversations.open` | Tier 3 |
| `chat.postMessage` | `POST /api/chat.postMessage` | **1/sec** |
| `chat.postEphemeral` | `POST /api/chat.postEphemeral` | Tier 3 |
| `chat.update` | `POST /api/chat.update` | Tier 3 |
| `chat.delete` | `POST /api/chat.delete` | Tier 3 |
| `reactions.add` | `POST /api/reactions.add` | Tier 3 |
| `files.uploadV2` | `POST /api/files.uploadV2` | Tier 3 |
| `views.open` | `POST /api/views.open` | 10/min |

---

## Appendix B: Block Kit Reference

```json
// Section with button
{ "type": "section", "text": { "type": "mrkdwn", "text": "Bold" }, "accessory": { "type": "button", "action_id": "btn", "text": { "type": "plain_text", "text": "Click" } } }

// Actions
{ "type": "actions", "elements": [{ "type": "button", "action_id": "approve", "text": { "type": "plain_text", "text": "Approve" } }] }

// Divider
{ "type": "divider" }

// Context
{ "type": "context", "elements": [{ "type": "mrkdwn", "text": "Status: Running" }] }
```

---

## Appendix C: Documentation Links

- API reference: https://api.slack.com
- Authentication: https://docs.slack.dev/authentication
- Token types: https://docs.slack.dev/authentication/token-types
- Token rotation: https://docs.slack.dev/authentication/token-rotation
- OAuth scopes: https://docs.slack.dev/reference/scopes
- Events API: https://docs.slack.dev/reference/events
- Signing verification: https://docs.slack.dev/authentication/verifying-requests-from-slack
- Conversations API: https://docs.slack.dev/reference/methods/conversations.list
- Chat API: https://docs.slack.dev/reference/methods/chat.postMessage
- Rate limits: https://docs.slack.dev/apis/web-api/rate-limits
- Block Kit: https://api.slack.com/block-kit
- @slack/bolt: https://github.com/slackapi/bolt-js
- @slack/web-api: https://github.com/slackapi/node-slack-sdk
