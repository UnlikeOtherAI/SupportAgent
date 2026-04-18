# Discord Connector Design

## 1. Overview

- **Category**: Communication / Messaging platform
- **Cloud vs Self-hosted**: Cloud-only. No self-hosted option exists.
- **API reference**: https://docs.discord.com/developers

**Architecture note**: Discord does NOT use traditional webhooks for message events. The primary intake mechanism is the **Gateway** (WebSocket connection). Discord also has a separate "webhook events" system for app lifecycle events (authorization, entitlements), which is distinct from message intake.

---

## 2. Authentication

### Bot Token (Recommended for MVP)

| Aspect | Detail |
|--------|--------|
| **How to obtain** | Create app in Discord Developer Portal → Bot section → Reset Token |
| **Header** | `Authorization: Bot <token>` or `Authorization: Bearer <token>` |
| **Lifetime** | Permanent until rotated or revoked |
| **Refresh** | Not applicable |

### Required Intents

Intents are bitwise flags passed during Gateway connection:

| Intent | Value | Required For |
|--------|-------|-------------|
| GUILDS | `1 << 0` | Channel/guild events |
| GUILD_MESSAGES | `1 << 9` | Message events in servers |
| DIRECT_MESSAGES | `1 << 12` | Message events in DMs |
| MESSAGE_CONTENT | `1 << 15` | Access message content (privileged) |

### Required OAuth2 Scopes (for bot authorization link)

```
bot (required for bot apps)
identify
guilds
```

### Required Permissions (bitwise integer for authorization URL)

```
VIEW_CHANNEL (1 << 10)
SEND_MESSAGES (1 << 11)
SEND_MESSAGES_IN_THREADS (1 << 31)
READ_MESSAGE_HISTORY (1 << 34)
MANAGE_MESSAGES (1 << 13) — for deleting bot's own messages
MANAGE_THREADS (1 << 34) — for thread management
```

### MESSAGE_CONTENT Intent Warning

> This is a **privileged intent**. Apps in >100 servers require Discord verification approval.

**Without it**, message objects return:
- `content`: empty string
- `embeds`: empty array
- `attachments`: empty array
- `components`: empty array

**Implication**: If our target tenants have large Discord servers, we must apply for verification or work around content access.

### Other Auth Mechanisms

| Mechanism | Use Case | Notes |
|-----------|----------|-------|
| **OAuth2 Authorization Code** | User-installed apps | Returns access_token + refresh_token; `identify` scope for user info |
| **Client Credentials** | Testing with bot owner token | Limited scopes; team apps restricted to `identify` + `applications.commands.update` |
| **Webhook tokens** | Posting as incoming webhook | Separate from bot auth; `webhook.incoming` scope |

---

## 3. Inbound — Events and Intake

### Gateway (Primary Real-time Intake)

Discord uses WebSocket Gateway for message events. **Not traditional HTTP webhooks.**

**Connection**: `wss://gateway.discord.gg/?v=10&encoding=json`

**Events we care about:**

| Event | Intent Required | Trigger |
|-------|----------------|---------|
| `MESSAGE_CREATE` | GUILD_MESSAGES / DIRECT_MESSAGES | New message in channel/DM |
| `MESSAGE_UPDATE` | GUILD_MESSAGES / DIRECT_MESSAGES | Message edited |
| `MESSAGE_DELETE` | GUILD_MESSAGES / DIRECT_MESSAGES | Message deleted |
| `MESSAGE_DELETE_BULK` | GUILD_MESSAGES | Bulk delete |
| `THREAD_CREATE` | GUILDS | Thread started |
| `THREAD_UPDATE` | GUILDS | Thread modified/archived |
| `THREAD_DELETE` | GUILDS | Thread deleted |
| `GUILD_MEMBER_UPDATE` | GUILD_MEMBERS (privileged) | Member roles/nick changed |

**Event payload structure:**
```json
{
  "op": 0,
  "d": { /* event-specific data */ },
  "s": 42,
  "t": "MESSAGE_CREATE"
}
```

### Webhook Events (App Lifecycle — Not Message Intake)

Discord has a separate webhook system for app events (not message events):

| Event Type | Description |
|------------|-------------|
| `APPLICATION_AUTHORIZED` | User authorized app to guild |
| `APPLICATION_DEAUTHORIZED` | User removed app |
| `ENTITLEMENT_CREATE` | Entitlement created (purchase) |
| `ENTITLEMENT_DELETE` | Entitlement deleted |

**Signature verification:**
- Header: `X-Signature-Ed25519`
- Header: `X-Signature-Timestamp`
- Algorithm: Ed25519

### Polling Fallback Strategy

Use REST API to backfill or poll:

```
GET /channels/{channel.id}/messages
  Query params: limit (1-100), before/after (snowflake), around (snowflake)
  Returns: newest-first ordering

GET /guilds/{guild.id}/messages/search
  Query params: author_id, channel_id, min_created_timestamp, max_created_timestamp, content
  Requires: MESSAGE_CONTENT intent (or returns empty)
```

### Payload Fields to Persist

| Field | Source | Notes |
|-------|--------|-------|
| `id` | `snowflake` | Unique per channel |
| `channel_id` | `snowflake` | Parent channel |
| `guild_id` | `snowflake` | Server (null for DMs) |
| `author` | User object | `{ id, username, global_name, bot }` |
| `content` | string | Empty without MESSAGE_CONTENT intent |
| `timestamp` | ISO8601 | Creation time |
| `edited_timestamp` | ISO8601 | Nullable |
| `tts` | boolean | Text-to-speech flag |
| `attachments` | array | Empty without MESSAGE_CONTENT intent |
| `embeds` | array | Empty without MESSAGE_CONTENT intent |
| `mentions` | array | User objects mentioned |
| `mention_roles` | array | Role IDs mentioned |
| `mention_everyone` | boolean | @everyone/@here |
| `message_reference` | object | Quoted/replied message |
| `thread` | thread object | Parent thread if in thread |
| `flags` | integer | Bitfield (crosspost, etc.) |

---

## 4. Outbound — Writing Back

### Send Message

```
POST /channels/{channel.id}/messages
Authorization: Bot <token>
Content-Type: application/json

{
  "content": "Response text",
  "tts": false,
  "embeds": [ /* embed objects */ ],
  "components": [ /* message components */ ],
  "message_reference": {
    "channel_id": "...",
    "message_id": "..."
  }
}
```

**Limits**: Max 2000 characters per message. Files up to 25 MiB.

### Reply to Message

Include `message_reference`:
```json
{
  "content": "Reply",
  "message_reference": {
    "channel_id": "123",
    "message_id": "456"
  }
}
```

### Edit Message

```
PATCH /channels/{channel.id}/messages/{message.id}
{
  "content": "Updated text",
  "embeds": [...]
}
```

### Delete Message

```
DELETE /channels/{channel.id}/messages/{message.id}
```

Requires `MANAGE_MESSAGES` permission, or bot can delete its own messages without permission.

### Create Thread

```
POST /channels/{channel.id}/threads
{
  "name": "Thread name",
  "auto_archive_duration": 1440, // 60, 1440, 4320, 10080 minutes
  "type": 11, // PUBLIC_THREAD; 12 for PRIVATE_THREAD
  "message": { /* required for forum channels */ }
}
```

### Send Message in Thread

Same as channel message — thread inherits parent channel permissions.

### Add Reaction

```
PUT /channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me
DELETE /channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me
```

Emoji format: Unicode emoji or `name:id` for custom (e.g., `thumbsup:123456789`).

### Mention User

Syntax: `<@USER_ID>` (e.g., `<@123456789>`)

### Pin Message

```
PUT /channels/{channel.id}/pins/{message.id}
DELETE /channels/{channel.id}/pins/{message.id}
```

### Crosspost Message (Announcement Channels)

```
POST /channels/{channel.id}/messages/{message.id}/crosspost
```

Requires `MANAGE_MESSAGES`.

---

## 5. Labels, Flags, Fields, Priorities

Discord's model differs significantly from issue trackers:

### Roles (Approximate to Labels)

- Roles are per-guild (server), not global
- Assigned via: `PUT /guilds/{guild.id}/members/{user.id}/roles/{role.id}`
- Users can have multiple roles
- Role hierarchy affects permission grants

### Channel Categories (Approximate to Projects)

- Categories group channels
- Permissions cascade from category to children

### Threads (Approximate to Issues)

- Threads have names, can be archived/unlocked
- No built-in status/priority fields
- Can use forum channels with tags as structured issues

### Forum Channel Tags (Approximate to Issue Fields)

Forum channels (type 11) support tags:
- `name`: string
- `emoji`: emoji or null
- `moderated`: boolean (requires moderator approval)

Tags are set per-forum channel:
```
GET /channels/{channel.id}  // returns tags in forum_channel object
PATCH /channels/{channel.id} // update tags
```

### Status Model

No built-in status like "open/closed". Workarounds:
- Lock threads (prevents new messages)
- Archive threads (hides from active view)
- Move to a different channel

### Priority/Severity

No native concept. Can simulate with:
- Role-based priority assignment
- Embed colors (though not semantically meaningful)
- Separate priority channels

### Listing Available Options

```
GET /guilds/{guild.id}              // guild info
GET /guilds/{guild.id}/roles        // list roles
GET /channels/{channel.id}          // forum tags, permissions
GET /channels/{channel.id}/threads/archived/public  // archived threads
```

---

## 6. Triggers We Can Match On

### From MESSAGE_CREATE/MESSAGE_UPDATE payloads:

| Trigger | Source Field | Example |
|---------|--------------|---------|
| Content contains keyword | `content` | "error", "help" |
| @mention bot | `mentions` | Check if bot's user_id in array |
| @everyone/@here | `mention_everyone` | Boolean |
| Role mention | `mention_roles` | Check specific role ID |
| Thread creation | `t` == "THREAD_CREATE" | New support thread |
| Attachment present | `attachments.length > 0` | Has screenshot |
| Message in specific channel | `channel_id` | Support channel only |
| Author is specific user | `author.id` | VIP user |
| Author has role | `author` + guild lookup | Role-based routing |
| Message starts with command | `content` | "!support" |

### Regex Matching

Regex on `content` is supported. Example triggers:
```javascript
{ type: "content_regex", pattern: "(?i)error|bug|broken" }
{ type: "content_regex", pattern: "^!support\\s+" }
```

### Limitation

Without `MESSAGE_CONTENT` intent, `content` is empty — triggers based on content text won't work.

---

## 7. Identity Mapping

### User ID Shape

Snowflake — a 64-bit integer serialized as a string (e.g., `"123456789012345678"`).

Format: `Discord Snowflake` = timestamp + worker + sequence encoded in base-10.

### Resolve User to Email

**Not possible** via bot token. Bots cannot access user emails without OAuth2 authorization with `email` scope from the user.

Alternative: Use `GET /users/{user.id}` which returns:
```json
{
  "id": "123",
  "username": "john",
  "global_name": "John Doe",
  "avatar": "abc123",
  "bot": false
}
```

No email, phone, or external contact info exposed.

### Bot Identity (no_self_retrigger)

Bot's `author` object has `"bot": true`. Can filter:
```javascript
if (message.author.bot) return; // skip bot messages
```

### Author Field on Posted Messages

When bot posts, the message's `author` field is the bot's user object. This is reliable.

---

## 8. Rate Limits

### Global

| Limit | Scope |
|-------|-------|
| 50 requests/second | Global bot limit |
| Per-route buckets | Varies |

### Per-Route Buckets

Discord uses bucket-based rate limiting. Key routes:

| Route Prefix | Limit | Window |
|--------------|-------|--------|
| `POST /channels/{id}/messages` | 50 | 0.33s? (varies) |
| `GET /channels/{id}/messages` | 120 | 60s? (varies) |
| General (most routes) | ~300 | varies |

**Headers received:**
- `X-RateLimit-Limit`: Max requests allowed
- `X-RateLimit-Remaining`: Requests left
- `X-RateLimit-Reset`: Unix timestamp when limit resets
- `X-RateLimit-Reset-After`: Seconds until reset
- `X-RateLimit-Bucket`: Unique bucket identifier

**On 429 response:**
```json
HTTP 429
Retry-After: <seconds>
X-RateLimit-Scope: user | global | shared
```

### Retry Strategy

1. Read `Retry-After` header
2. Wait specified seconds
3. Retry request
4. If global limit hit, respect even if bucket differs

### Cloudflare Ban

> "Invalid requests (401, 403, 429) exceeding 10,000 per 10 minutes trigger Cloudflare IP bans."

Implement exponential backoff and jitter to avoid ban.

---

## 9. Pagination & Search

### Cursor Style (Snowflake-based)

Most endpoints use snowflake-based pagination:

```bash
# Messages (newest first by default)
GET /channels/{channel.id}/messages?limit=100
GET /channels/{channel.id}/messages?before={snowflake}
GET /channels/{channel.id}/messages?after={snowflake}
GET /channels/{channel.id}/messages?around={snowflake}

# Guild members
GET /guilds/{guild.id}/members?limit=1000&after={snowflake}
```

### Max Page Size

| Endpoint | Max |
|----------|-----|
| Messages | 100 |
| Guild Members | 1000 |
| Threads/Channels | unspecified, typically 100 |

### Search Endpoints

```
GET /guilds/{guild.id}/messages/search
  ?author_id={user.id}
  &channel_id={channel.id}
  &content={text}
  &min_created_timestamp=2024-01-01T00:00:00Z
  &max_created_timestamp=2024-12-31T23:59:59Z

GET /channels/{channel.id}/messages/search?content={text}
```

**Requires**: MESSAGE_CONTENT intent for content search.

### Useful for Reconciliation

- Search for messages by bot to find previous bot-posted items
- Get message by ID: `GET /channels/{channel.id}/messages/{message.id}`

---

## 10. Known Gotchas

### Privileged Intent Requirements

- **MESSAGE_CONTENT** requires Discord verification for apps in >100 servers
- **GUILD_MEMBERS** requires explicit opt-in in Developer Portal
- Without MESSAGE_CONTENT, content fields are empty — trigger matching fails

### No Traditional Webhooks for Messages

Discord webhook events (APPLICATION_AUTHORIZED, ENTITLEMENT_*) do NOT include message events. For message intake, must implement Gateway WebSocket client.

### Threads Are Mutable Only When Active

- Archived threads are immutable
- Must unarchive to send messages
- Archiving is automatic based on `auto_archive_duration`

### Forum Channels

- Support structured "issues" via forum channel tags
- Thread creation in forums requires initial message
- Tags are per-channel, not guild-wide

### Permission Hierarchy

- Bot can only manage roles lower than its highest role
- Cannot ban users with higher role
- Channel permissions override guild permissions (but with specific order)

### Slowmode

Channels can have slowmode (0-21600 seconds). Applies to messages and thread creation.

### No Native Status/Priority

Discord has no "open/closed" status or priority levels. Must implement via:
- Thread locking/archiving
- Role assignment
- Separate priority channels

### Token for Webhook vs Bot

Incoming webhook URLs contain a token. These are separate from bot tokens and can post without bot permissions — but limited to one channel.

### DM Channels

- DMs are not in guilds — `guild_id` is null
- Cannot create DMs via API (only access existing DMs)
- Bots cannot initiate DMs unless user has contacted bot first

### Message Content Intent and Search

Search endpoints require MESSAGE_CONTENT intent or return empty content.

### Discord API Version

Currently v10. Gateway URL includes `?v=10`.

---

## 11. Recommended SupportAgent Connector Scope

### MVP

**Intake:**
- Gateway connection with GUILDS, GUILD_MESSAGES, DIRECT_MESSAGES intents
- MESSAGE_CREATE for new messages
- MESSAGE_UPDATE for edits (optional, lower priority)
- THREAD_CREATE for new threads

**Config fields required:**
- Bot token
- Guild ID(s) to monitor
- Channel ID(s) to watch
- Bot's own user ID (for no_self_retrigger)

**Outbound:**
- POST messages to channels
- Reply with message_reference
- Edit bot's own messages
- Delete bot's messages
- Create threads

**Triggers:**
- Content regex matching
- @mention detection
- Channel-based routing
- Attachment detection

### Phase 2

**Intake additions:**
- MESSAGE_DELETE tracking
- Thread archive/unarchive events
- Guild member role changes

**Outbound additions:**
- Add/remove reactions
- Pin messages
- Manage forum tags
- Lock/unlock threads

**Triggers:**
- Author role matching
- Thread creation detection
- @everyone/@here detection

### Phase 3

**Advanced features:**
- Full role-based routing and assignment
- Forum channel as structured issue tracker with tags
- Multi-guild support per tenant
- Audit log integration for moderation events

---

## 12. Dependencies

### Official SDK

Discord's official library: `discord.js` (Node.js)
- npm: `npm install discord.js`
- Supports Gateway, REST API, full object model
- Actively maintained

Alternative: `discord.py` (Python)

### Recommendation

**Use `discord.js`** over raw fetch because:
- Handles Gateway connection lifecycle (heartbeat, resume, reconnect)
- Automatic rate limit handling
- Object-oriented with type definitions
- Permission checking utilities
- Event names and structures already typed

**However**: For a lightweight connector, raw `fetch` with manual Gateway handling is viable. `discord.js` adds significant bundle size (~4MB minified).

### CLI Parity

No equivalent to `gh` CLI for Discord. Discord's CLI tools are limited to:
- Developer Portal web UI
- API testing via browser devtools

---

## 13. Open Questions

1. **MESSAGE_CONTENT Intent Verification**: Do our target tenants have large Discord servers (>100 members)? If so, we must apply for verification or implement content-independent triggers.

2. **Multi-guild vs Single-guild**: Does a tenant need monitoring across multiple Discord servers, or just one? Multi-guild requires tracking multiple `guild_id` values.

3. **DM Support**: Do we need to support DMs to the bot, or only server channels? DMs have different auth context and limited API surface.

4. **Forum as Issue Tracker**: Should we treat Discord forum channels as structured issue trackers with tags? This would require mapping forum tags to SupportAgent labels.

5. **Role-based Routing**: How critical is role-based message routing? Requires GUILD_MEMBERS privileged intent and role lookup.

6. **Bot Verification Level**: Are we targeting verified Discord apps? Unverified apps with limited features may affect our market.

---

## Quick Reference: API Endpoints

| Action | Endpoint | Method |
|--------|----------|--------|
| Send message | `/channels/{id}/messages` | POST |
| Edit message | `/channels/{id}/messages/{msg_id}` | PATCH |
| Delete message | `/channels/{id}/messages/{msg_id}` | DELETE |
| Get messages | `/channels/{id}/messages` | GET |
| Create thread | `/channels/{id}/threads` | POST |
| List threads | `/channels/{id}/threads/archived/public` | GET |
| Add reaction | `/channels/{id}/messages/{msg_id}/reactions/{emoji}/@me` | PUT |
| Remove reaction | `/channels/{id}/messages/{msg_id}/reactions/{emoji}/@me` | DELETE |
| Pin message | `/channels/{id}/pins/{msg_id}` | PUT |
| Get guild | `/guilds/{id}` | GET |
| List members | `/guilds/{id}/members` | GET |
| Get user | `/users/{id}` | GET |
| Get bot user | `/users/@me` | GET |
| Get channel | `/channels/{id}` | GET |
| Create webhook | `/channels/{id}/webhooks` | POST |
| Search messages | `/guilds/{id}/messages/search` | GET |

---

## Quick Reference: Gateway Intents

```
GUILDS                    = 1 << 0       // 1
GUILD_MEMBERS             = 1 << 1       // 2  (privileged)
GUILD_MODERATION          = 1 << 2       // 4
GUILD_EXPRESSIONS         = 1 << 3       // 8
GUILD_INTEGRATIONS        = 1 << 4       // 16
GUILD_WEBHOOKS            = 1 << 5       // 32
GUILD_INVITES             = 1 << 6       // 64
GUILD_VOICE_STATES        = 1 << 7       // 128
GUILD_PRESENCES           = 1 << 8       // 256 (privileged)
GUILD_MESSAGES            = 1 << 9       // 512
GUILD_MESSAGE_REACTIONS    = 1 << 10      // 1024
GUILD_MESSAGE_TYPING       = 1 << 11      // 2048
DIRECT_MESSAGES            = 1 << 12      // 4096
DIRECT_MESSAGE_REACTIONS   = 1 << 13      // 8192
DIRECT_MESSAGE_TYPING      = 1 << 14      // 16384
MESSAGE_CONTENT            = 1 << 15      // 32768 (privileged)
GUILD_SCHEDULED_EVENTS     = 1 << 16      // 65536
AUTO_MODERATION_CONFIG     = 1 << 20      // 1048576
AUTO_MODERATION_EXECUTION  = 1 << 21      // 2097152
```

Minimum for message intake: `GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT` = 1 + 512 + 32768 = 33281