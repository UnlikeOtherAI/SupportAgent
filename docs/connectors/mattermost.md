# Mattermost Connector Design

## 1. Overview

- **Category**: Communication / Messaging Platform
- **Cloud**: Mattermost Cloud (mattermost.com) + Self-hosted (Team/Enterprise Edition)
- **API Reference**: https://developers.mattermost.com/api-documentation/ (redirects from api.mattermost.com)
- **Official SDK**: None for TypeScript/Node.js; Go SDK in `github.com/mattermost/mattermost/server/public/model`
- **Webhook Reference**: Incoming + Outgoing webhooks; slash commands
- **Install Reference**: https://developers.mattermost.com/integrate/

### Platform Model

Mattermost is a **team-based** messaging platform with:

- **Teams**: top-level workspace (equivalent to Slack workspace)
- **Channels**: persistent conversation spaces (public, private, DM, group DM)
- **Posts**: messages in channels (root posts and thread replies)
- **Threads**: collapsed reply threads (CRT mode) anchored to root posts via `root_id`
- **Reactions**: emoji reactions to posts
- **Slash commands**: `/command` triggers for integrations
- **Bot accounts**: first-class users for programmatic access
- **Webhooks**: incoming (post to channel) and outgoing (trigger on events)
- **WebSocket**: real-time event delivery via `wss://{domain}/api/v4/websocket`

### Hosting Modes

| Mode | Base URL | Notes |
|------|---------|-------|
| Mattermost Cloud | `https://mattermost.com` | Managed, no self-host |
| Self-hosted (Team/Enterprise) | `https://{your-domain}.com` | API at `/api/v4`; on-prem data |

**API versioning**: Single REST API at `v4` across all hosting modes. No v1/v2 distinction for the REST API.

---

## 2. Authentication

### Mechanism 1: Session Token (Bearer)

- **How obtained**: Login via `POST /api/v4/users/login` with `{"login_id": "...", "password": "..."}`
- **Header**: `Authorization: Bearer {token}`
- **Token lifetime**: Session-based; default 30 days (configurable). Refresh via session refresh endpoint.
- **Required permissions**: User must be member of team/channel to access it

```typescript
// Login
POST https://mattermost.example.com/api/v4/users/login
Content-Type: application/json
Body: { "login_id": "user@example.com", "password": "password" }

// Response: Set-Cookie: MMAUTHTOKEN={token}; Path=/; HttpOnly
// Or use header:
Authorization: Bearer {token}
```

### Mechanism 2: User Access Token

- **How obtained**: `POST /api/v4/users/{user_id}/tokens` (requires manage tokens permission)
- **Header**: `Authorization: Bearer {user_access_token}`
- **Token lifetime**: Persistent until revoked
- **Required permissions**: Based on user permissions (team/channel membership)

### Mechanism 3: API Token (Query Parameter)

- **How obtained**: System console generates personal access token (admin feature)
- **Parameter**: `?token={api_token}` (alternative to header)
- **Token lifetime**: Persistent until revoked
- **Note**: Less common; not recommended for multi-tenant

### Mechanism 4: Bot Account (Recommended for SupportAgent)

- **How obtained**: Create via `POST /api/v4/bots` or System Console
- **Header**: `Authorization: Bearer {bot_user_token}` (user token for the bot user)
- **Token lifetime**: Persistent until revoked
- **Required permissions**: Bot user must be member of teams/channels

```typescript
// Create bot
POST https://mattermost.example.com/api/v4/bots
Authorization: Bearer {admin_token}
Body: {
  "username": "support-agent",
  "display_name": "Support Agent Bot",
  "description": "Support automation bot"
}

// Bot posts as a regular user, carrying bot's identity
```

### Required Scopes (Permission Model)

Mattermost uses role-based access control (RBAC) — not OAuth scopes:

| Operation | Required Permission |
|-----------|-------------------|
| Read channels | Team + Channel membership |
| Read posts | Team + Channel membership |
| Post to channel | Team + Channel membership |
| Create thread reply | Team + Channel membership |
| Create incoming webhook | Manage webhooks (team admin) |
| Create outgoing webhook | Manage webhooks (team admin) |
| Create slash commands | Manage commands (team admin) |
| Manage bot accounts | System admin |

### Recommendation for SupportAgent MVP: Bot Account + User Access Token

- Create a dedicated bot account per tenant
- Use `Authorization: Bearer {bot_access_token}`
- Bot must be added to each team/channel where it needs to operate
- Simplest setup: no OAuth flow, no browser redirect
- For self-hosted: admin creates bot account in System Console

---

## 3. Inbound — Events and Intake

### Webhook Support: YES (Incoming + Outgoing)

**Incoming webhooks** — Mattermost posts to external URLs:
- Not applicable for inbound; this is outbound (Mattermost pushes to you)

**Outgoing webhooks** — External receives events from Mattermost:
- Trigger on post content (trigger words) or channel activity
- POST to your callback URL when matching conditions met
- Deprecated in favor of Mattermost Plugins and WebSocket

**Recommended for SupportAgent: WebSocket (Real-time)**

Mattermost's preferred real-time integration is WebSocket at:
```
wss://{domain}/api/v4/websocket
```

WebSocket auth: same `Authorization: Bearer {token}` header

### WebSocket Event Types

| Event | Description | Payload Key Fields |
|-------|-------------|-------------------|
| `posted` | New post created | `channel_id`, `post` (full Post object) |
| `post_edited` | Post edited | `post` |
| `post_deleted` | Post deleted | `post_id`, `channel_id` |
| `reaction_added` | Reaction added | `reaction`, `channel_id` |
| `reaction_removed` | Reaction removed | `reaction`, `channel_id` |
| `typing` | User typing | `channel_id`, `parent_id`, `user_id` |
| `channel_created` | Channel created | `channel_id` |
| `channel_updated` | Channel updated | `channel` |
| `channel_deleted` | Channel deleted | `channel_id` |
| `user_added` | User added to team/channel | `team_id`, `channel_id`, `user_id` |
| `user_removed` | User removed from team/channel | `team_id`, `channel_id`, `user_id` |
| `thread_updated` | Thread metadata updated | `thread` |
| `thread_follow_changed` | Thread follow state changed | `post_id`, `user_id`, `following` |

### WebSocket Payload Structure

```typescript
interface WebSocketMessage {
  event: string;           // e.g., "posted"
  data: {
    channel_id: string;
    team_id: string;
    post: string;          // JSON stringified Post object
    [key: string]: any;
  };
  broadcast: {
    omit_users?: Record<string, boolean>;
    user_id?: string;
    channel_id?: string;
    team_id?: string;
  };
  seq: number;             // Sequence number for ordering
}

// "posted" event data.post (after JSON.parse):
interface Post {
  id: string;
  create_at: number;        // Unix timestamp ms
  update_at: number;
  edit_at: number;
  delete_at: number;
  is_pinned: boolean;
  user_id: string;
  channel_id: string;
  root_id: string;         // "" for root post, ID for thread replies
  original_id: string;
  message: string;
  type: string;             // "" for normal, "system_*" for system messages
  props: Record<string, any>;
  hashtags: string;
  file_ids: string[];
  reply_count: number;
  last_reply_at: number;
  participants: User[];
  is_following: boolean;
  metadata: PostMetadata;
}
```

### Signature Verification (Outgoing Webhooks)

Outgoing webhooks use a **token** in the payload:
- Token is generated when webhook is created (`hook.token`)
- Compare payload token with stored token to verify

```
POST /your-webhook-endpoint
Content-Type: application/x-www-form-urlencoded
token={webhook_token}&team_id=...&channel_id=...&post_id=...
```

No HMAC signature — token is the verification mechanism.

### Retry / Delivery Semantics

- **WebSocket**: Connection-based; auto-reconnect with exponential backoff
- **Outgoing webhooks**: HTTP POST to callback URL; 429 = retry with backoff, 5xx = retry
- **Timeout**: Outgoing webhook expects response within 5 seconds

### Polling Fallback: `GET /api/v4/channels/{channel_id}/posts`

```typescript
// Get posts for channel with pagination
GET https://mattermost.example.com/api/v4/channels/{channel_id}/posts
  ?page=0
  &per_page=60
Authorization: Bearer {token}

// Response:
{
  "posts": {
    "post_id_1": { ... Post object ... },
    "post_id_2": { ... Post object ... }
  },
  "order": ["post_id_2", "post_id_1"],  // Most recent first
  "next_post_id": "...",
  "prev_post_id": "..."
}
```

**Recommended polling strategy**:
- Store last known `create_at` timestamp
- Poll with `GET /api/v4/channels/{channel_id}/posts?page=0&per_page=60&since={last_timestamp}`
- `since` parameter filters posts updated since timestamp (ms)

```typescript
// Poll for updates since last known timestamp
GET https://mattermost.example.com/api/v4/channels/{channel_id}/posts
  ?page=0
  &per_page=60
  &since=1699999999000
Authorization: Bearer {token}
```

### Payload Fields to Persist

```typescript
interface PersistedPost {
  id: string;                    // Unique post ID
  channel_id: string;            // Channel where post was made
  team_id: string;               // Team for channel linkage
  root_id: string;               // "" = root post, else thread reply
  user_id: string;               // Author's user ID
  message: string;               // Post content
  create_at: number;             // Created timestamp (ms)
  update_at: number;             // Last updated timestamp (ms)
  edit_at: number;               // Edit timestamp
  is_pinned: boolean;            // Pinned status
  file_ids: string[];            // Attached file IDs
  props: {
    from_webhook?: string;       // "true" if posted via webhook
    from_bot?: string;           // "true" if posted via bot
    webhook_display_name?: string;
    attachments?: MessageAttachment[];
    mentions?: Record<string, User>; // Mentioned users
  };
  type: string;                  // Normal="" or system type
  hashtags: string;              // Extracted hashtags
}
```

---

## 4. Outbound — Writing Back

### Create Post (Root Message)

```
POST /api/v4/posts
Authorization: Bearer {token}
Content-Type: application/json

{
  "channel_id": "channel_id_here",
  "message": "Support response message"
}
```

**Response** (201 Created):
```json
{
  "id": "new_post_id",
  "create_at": 1699999999000,
  "update_at": 1699999999000,
  "user_id": "bot_user_id",
  "channel_id": "channel_id_here",
  "root_id": "",
  "message": "Support response message",
  "type": "",
  "props": {}
}
```

### Create Thread Reply

```
POST /api/v4/posts
Authorization: Bearer {token}
Content-Type: application/json

{
  "channel_id": "channel_id_here",
  "root_id": "root_post_id",    // ID of the thread root post
  "message": "Reply in thread"
}
```

**Note**: Mattermost threads use `root_id` field. When `root_id` is non-empty, post is a reply. Collapsed Threads (CRT) mode must be enabled for full thread support.

### Edit Post

```
PUT /api/v4/posts/{post_id}
Authorization: Bearer {token}
Content-Type: application/json

{
  "message": "Edited message"
}
```

### Delete Post

```
DELETE /api/v4/posts/{post_id}
Authorization: Bearer {token}
```

**Note**: Soft delete (sets `delete_at`). Requires post author or team/channel admin.

### Add Reaction

```
POST /api/v4/reactions
Authorization: Bearer {token}
Content-Type: application/json

{
  "user_id": "user_id",
  "post_id": "post_id",
  "emoji_name": "white_check_mark"   // Standard emoji name
}
```

### Remove Reaction

```
DELETE /api/v4/reactions
Authorization: Bearer {token}
Content-Type: application/json

{
  "user_id": "user_id",
  "post_id": "post_id",
  "emoji_name": "white_check_mark"
}
```

### Pin/Unpin Post

```
POST /api/v4/posts/{post_id}/pin
DELETE /api/v4/posts/{post_id}/pin
Authorization: Bearer {token}
```

### Post with Attachments

```
POST /api/v4/files
Authorization: Bearer {token}
Content-Type: multipart/form-data

file=@screenshot.png&channel_id=channel_id&filename=screenshot.png

// Response: { "id": "file_id", "filename": "screenshot.png" }
```

Then create post with file attachment:

```
POST /api/v4/posts
{
  "channel_id": "channel_id",
  "message": "See attached screenshot",
  "file_ids": ["file_id_from_upload"]
}
```

### Post via Incoming Webhook

```
POST /api/v4/hooks/{incoming_webhook_id}
Content-Type: application/json

{
  "text": "Message text",
  "username": "BotName",        // Override display name
  "icon_url": "https://...",    // Override icon
  "channel": "#channel-name",   // Override channel (if allowed)
  "attachments": [
    {
      "fallback": "Summary",
      "color": "#FF0000",
      "title": "Title",
      "text": "Description",
      "fields": [
        { "title": "Field", "value": "Value", "short": true }
      ]
    }
  ]
}
```

### Mention User

In message body:
- `@username` — mentions user by username
- `<channel>` — channel-wide notification (here/mention)
- `@here` / `@channel` — all members in channel

Example:
```
Hello @john.doe, the ticket #123 has been updated. @channel please review.
```

### Create Direct Message

```
POST /api/v4/channels/direct
Authorization: Bearer {token}
Content-Type: application/json

{
  "members": ["user_id_1", "user_id_2"]
}

// Response: Channel object with type "D"
```

### Create Group Channel

```
POST /api/v4/channels/group
{
  "members": ["user_id_1", "user_id_2", "user_id_3"]
}
```

### Execute Slash Command

```
POST /api/v4/commands/{command_id}/execute
Authorization: Bearer {token}
Content-Type: application/json

{
  "command": "/trigger arg1 arg2",
  "channel_id": "channel_id"
}
```

---

## 5. Labels, Flags, Fields, Priorities

### Labels/Tags

Mattermost **does not have a built-in label/tag system** like GitHub or Jira. Instead:

- **Channel-based organization**: Use channels to categorize conversations
- **Channel categories** (newer): Group channels into categories
- **Hashtags in messages**: `#tag` is parsed and searchable but not a structured label
- **No custom labels API**: No API to create/manage structured labels

**Workaround for SupportAgent**: Use Mattermost's built-in **emoji reactions** as labels, or channel-based categorization.

### Custom Fields

**No built-in custom fields API.** Mattermost focuses on:
- Channel-based organization
- Message threads
- File attachments

For structured data, you must:
1. Store custom metadata in `post.props` (up to 800K runes)
2. Use external database for structured custom fields

### Status Model

Mattermost has no global issue status (not an issue tracker). For channels:
- **Channel types**: `O` (public), `P` (private), `D` (direct), `G` (group)
- **No status workflow**: Messages are just messages; no "open/closed/resolved"

**SupportAgent adaptation**: Use channels as tickets/states:
- `#support-queue` — incoming
- `#support-investigating` — in progress
- `#support-resolved` — resolved
- Move users between channels to represent state

### Priority Model

Mattermost **does not have a built-in priority system**.

**SupportAgent adaptation options**:
1. Use **channel categories** with ordering
2. Use **emoji reactions** as priority markers (`🔴 urgent`, `🟡 medium`, `🟢 low`)
3. Use **thread mentions** with `@urgent-notify` group
4. Store priority in `post.props`

### Severity Model

Same as Priority — no built-in severity. Use emoji reactions.

---

## 6. Triggers We Can Match On

### From WebSocket Event Payloads

| Trigger Type | Source | Detection |
|-------------|--------|-----------|
| **New post in channel** | `posted` event | Match `data.channel_id` |
| **New thread reply** | `posted` event | Match `data.post.root_id !== ""` |
| **Post edited** | `post_edited` event | Match `data.post.id` |
| **Post deleted** | `post_deleted` event | Match `data.post_id` |
| **Mention of bot** | `posted` event | Match `@bot_username` in `data.post.message` |
| **Emoji reaction added** | `reaction_added` event | Match `data.reaction.emoji_name` |
| **Emoji reaction removed** | `reaction_removed` event | Match `data.reaction.emoji_name` |
| **User added to channel** | `user_added` event | Match `data.user_id` |
| **Channel created** | `channel_created` event | New intake channel |

### Trigger Matcher Implementation

```typescript
interface TriggerMatch {
  type: 'channel_post' | 'thread_reply' | 'mention' | 'reaction' | 'hashtag';
  channel_id?: string;
  root_id?: string;       // Non-empty = thread reply
  pattern?: RegExp;
  emoji_name?: string;
}

function matchTrigger(event: WebSocketMessage, triggers: TriggerMatch[]): TriggerMatch | null {
  for (const trigger of triggers) {
    if (trigger.type === 'channel_post' || trigger.type === 'thread_reply') {
      if (event.event !== 'posted') continue;
      const post = JSON.parse(event.data.post);
      if (trigger.channel_id && event.data.channel_id !== trigger.channel_id) continue;
      if (trigger.type === 'thread_reply' && !post.root_id) continue;
      if (trigger.pattern && !trigger.pattern.test(post.message)) continue;
      return trigger;
    }
    if (trigger.type === 'mention') {
      if (event.event !== 'posted') continue;
      const post = JSON.parse(event.data.post);
      if (trigger.pattern && !trigger.pattern.test(post.message)) continue;
      return trigger;
    }
    if (trigger.type === 'reaction') {
      if (event.event !== 'reaction_added') continue;
      if (trigger.emoji_name && event.data.reaction?.emoji_name !== trigger.emoji_name) continue;
      return trigger;
    }
  }
  return null;
}
```

---

## 7. Identity Mapping

### User ID Shape

**Format**: 26-character alphanumeric string (Base36-like)
- Example: `4ykj1tfwj1yuidqsj3tg1dxcsa`
- No fixed prefix like GitHub's `U` prefix
- Similar to UUID but using different character set

### Resolve Platform User → Email

```typescript
// Get user by ID
GET /api/v4/users/{user_id}
Authorization: Bearer {token}

// Response:
{
  "id": "user_id",
  "username": "john.doe",
  "email": "john@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "nickname": "",
  "locale": "en",
  "timezone": { "automaticTimezone": "America/New_York" },
  "create_at": 1699999999000,
  "update_at": 1699999999000,
  "roles": "system_user"
}

// Resolve by username
GET /api/v4/users/username/{username}
```

### Bot Identity (no_self_retrigger)

```typescript
// Create bot account
POST /api/v4/bots
{
  "username": "support-agent",
  "display_name": "Support Agent"
}

// Bot user ID is in response
// Posts by bot have:
// - user_id = bot_user_id
// - props.from_bot = "true"
// - props.from_webhook = "true" (if via webhook)

// For no_self_retrigger detection:
function isBotPost(post: Post, botUserId: string): boolean {
  return post.user_id === botUserId ||
         post.props?.from_bot === "true" ||
         post.props?.from_webhook === "true";
}
```

### Author Field on Posts We Post

Yes — when posting via API with bot token:
- `user_id` field = bot's user ID
- `create_at` = server timestamp
- `props.from_bot` = "true"

Reliable for self-detection.

---

## 8. Rate Limits

### Configuration (Server-Set)

Mattermost rate limiting is **configurable by server admin**:

```go
// From server config (defaults):
RateLimitSettings.PerSec = 100           // Requests per second
RateLimitSettings.MaxBurst = 100         // Burst capacity
RateLimitSettings.VaryByUser = true      // Rate limit by auth token
RateLimitSettings.VaryByRemoteAddr = false
RateLimitSettings.VaryByHeader = ""     // Optional header (e.g., "X-Real-IP")
RateSettings.MemoryStoreSize = 15000    // In-memory store size
```

### Response on Rate Limit Exceeded

**HTTP 429 Too Many Requests**

Headers (from throttled library):
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1699999999
Retry-After: 5
Content-Type: text/plain
```

**Note**: `Retry-After` is in seconds.

### Retry-After Semantics

```typescript
async function apiRequestWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  const response = await fetch(url, options);
  
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 1000;
    
    if (maxRetries > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
      return apiRequestWithRetry(url, options, maxRetries - 1);
    }
  }
  
  return response;
}
```

### Bulk/Batch Endpoints

| Endpoint | Method | Use Case |
|----------|--------|----------|
| `/api/v4/posts/ids` | POST | Fetch multiple posts by ID (body: `["id1", "id2"]`) |
| `/api/v4/users/ids` | POST | Fetch multiple users by ID |
| `/api/v4/channels/{id}/posts/ids` | GET | Get post IDs for channel |
| `/api/v4/posts/{id}/thread` | GET | Get full thread in one call |

**Example batch fetch**:
```
POST /api/v4/posts/ids
Authorization: Bearer {token}
Content-Type: application/json
Body: ["post_id_1", "post_id_2", "post_id_3"]
```

---

## 9. Pagination & Search

### Pagination Style

**Page-based with cursor support** (hybrid model):

| Endpoint Pattern | Pagination |
|----------------|------------|
| `/api/v4/channels/{id}/posts` | `page` (int, 0-based) + `per_page` (int) |
| `/api/v4/posts/ids` | Batch (no pagination) |
| `/api/v4/users` | `page` + `per_page` |
| `/api/v4/teams/{id}/channels` | `page` + `per_page` |

### Query Parameters

```
?page=0&per_page=60
```

### Max Page Size

- **Default**: 60 posts per page
- **Max**: Varies by endpoint (typically 100-1000)
- **Reporting API**: Max 1000 posts per page (`MaxReportingPerPage`)

### Search/Filter Endpoints

```typescript
// Search posts in team
GET /api/v4/teams/{team_id}/posts/search
Authorization: Bearer {token}
Content-Type: application/json

{
  "terms": "support ticket",
  "is_or_search": false,           // AND vs OR
  "in_channels": ["channel_id"],
  "from_users": ["user_id"],
  "excluded_users": ["user_id"],
  "after_date": "2024-01-01",
  "before_date": "2024-12-31",
  "include_deleted_channels": false
}

// Search channels
GET /api/v4/teams/{team_id}/channels/search
{
  "term": "support"
}

// Autocomplete users
GET /api/v4/users/autocomplete?term=john
```

### Post List Response Shape

```typescript
interface PostListResponse {
  posts: Record<string, Post>;    // Map of post ID -> Post object
  order: string[];                // Ordered post IDs (most recent first)
  next_post_id: string;          // Cursor for next page
  prev_post_id: string;          // Cursor for previous page
}

// Fetch next page
GET /api/v4/channels/{id}/posts?page=1&per_page=60&before={prev_post_id}
```

---

## 10. Known Gotchas

### Cloud vs Self-Hosted Differences

| Feature | Cloud | Self-Hosted |
|---------|-------|-------------|
| Bot accounts | Always available | Requires admin enablement |
| User access tokens | Always available | Requires admin enablement |
| API rate limits | Configurable per instance | Server-admin controlled |
| WebSocket | Available | Available |
| Plugins | Marketplace | Enterprise only (v10) |

### Webhook Gotchas

1. **Outgoing webhooks deprecated**: Mattermost prefers Plugins over outgoing webhooks
2. **Trigger words limited**: Only exact matches or prefix matches
3. **Token not HMAC**: No cryptographic signature, just token comparison
4. **Callback timeout**: 5-second timeout; no retry notification

### WebSocket Gotchas

1. **Connection stability**: Requires robust reconnection with exponential backoff
2. **Sequence numbers**: Must handle sequence mismatch (code 4001)
3. **Message size limit**: 8KB max message size (`SocketMaxMessageSizeKb`)
4. **Auth challenge**: WebSocket requires auth challenge on connect

### Post/Thread Gotchas

1. **Collapsed Threads (CRT)**: Must be enabled per user for thread-based notifications
2. **Thread detection**: `root_id !== ""` means reply; `root_id === ""` means root
3. **No atomic thread operations**: Reply + mention must be separate calls
4. **Edit time limit**: Configurable `PostEditTimeLimit` (default: -1 = no limit)
5. **Deleted posts**: Soft delete; `delete_at > 0` = deleted

### Multi-Tenant Gotchas

1. **Per-team bot membership**: Bot must be added to each team separately
2. **No cross-team webhooks**: Outgoing webhooks are team-scoped
3. **WebSocket broadcasts**: Can be filtered by `team_id` and `channel_id`
4. **No workspace-level API**: Teams are silos; cross-team ops require multiple auth tokens

### API Quirks

1. **Page calculation**: `page * per_page` for offset in some endpoints
2. **Emoji name validation**: Must match `/^[a-zA-Z0-9\-\+_]+$/`
3. **Post props limit**: 800K runes max (`PostPropsMaxRunes`)
4. **File IDs**: Attached files must be uploaded before post creation
5. **Channel type letters**: `O`=public, `P`=private, `D`=DM, `G`=Group (not intuitive)

### Eventual Consistency

1. **Webhook vs WebSocket timing**: WebSocket events may arrive before webhook confirmation
2. **Create + immediate read**: New posts may not appear in `GetPostsForChannel` for ~100ms
3. **Reaction consistency**: Reactions have separate `reaction_added`/`reaction_removed` events

---

## 11. Recommended SupportAgent Connector Scope

### MVP (Minimum to be useful)

**Endpoints to wrap**:
```
POST   /api/v4/posts                         # Create post
GET    /api/v4/channels/{id}/posts           # Get channel posts
GET    /api/v4/posts/{id}/thread             # Get thread replies
GET    /api/v4/users/{id}                     # Get user by ID
GET    /api/v4/users/username/{username}      # Get user by username
POST   /api/v4/channels/direct               # Create DM
WS     /api/v4/websocket                     # Real-time events
```

**Webhook events to handle**:
- `posted` — new posts in monitored channels
- `post_edited` — edits to tracked posts
- `post_deleted` — deletions
- `reaction_added` — reactions (label proxy)
- `typing` — typing indicators (optional)

**Minimum config fields**:
```typescript
interface MattermostConfig {
  baseUrl: string;           // "https://mattermost.example.com"
  botToken: string;          // Bot user access token
  botUserId: string;         // Bot's user ID (for self-detection)
  teamId: string;            // Primary team ID
  monitoredChannels: string[]; // Channel IDs to monitor
}
```

### Phase 2 (Parity with GitHub connector)

**Additional endpoints**:
```
POST   /api/v4/posts/{id}                    # Edit post
DELETE /api/v4/posts/{id}                   # Delete post
POST   /api/v4/reactions                    # Add reaction
POST   /api/v4/files                         # Upload file
GET    /api/v4/channels                     # List channels
GET    /api/v4/teams/{id}/channels         # List team channels
POST   /api/v4/channels                     # Create channel
POST   /api/v4/channels/group               # Create group DM
GET    /api/v4/users                         # List users
GET    /api/v4/users/autocomplete            # Search users
GET    /api/v4/teams                        # List teams
POST   /api/v4/webhooks/incoming            # Create incoming webhook
```

**Delivery ops**:
- Post with attachments
- Thread replies
- Channel creation for tenant isolation
- Reactions as label proxy

**Trigger matchers enabled**:
- Channel post matching
- Thread reply matching
- `@botname` mention detection
- Hashtag extraction
- Emoji reaction triggers

### Phase 3 (Advanced)

**Platform-unique features**:
```
POST   /api/v4/posts/{id}/pin                # Pin/unpin
POST   /api/v4/commands/{id}/execute         # Execute slash commands
GET    /api/v4/channels/search              # Advanced channel search
POST   /api/v4/posts/search                  # Search posts
GET    /api/v4/teams/{id}/posts/search      # Team post search
POST   /api/v4/bots                          # Create bot account
GET    /api/v4/bots                          # List bot accounts
```

**Advanced features**:
- Slash command registration for interactive triggers
- Channel category management for ticket state organization
- Scheduled posts for follow-up reminders
- Thread following management
- Channel bookmark management

---

## 12. Dependencies

### Official SDK Availability

**Go SDK**: `github.com/mattermost/mattermost/server/public/model`
- Full type coverage for all models
- `Client4` with all API methods
- `WebSocketClient` for real-time events
- Best reference for exact field names and types

**No official TypeScript/JavaScript SDK**

### Preferred: Raw fetch vs SDK

**Recommendation**: Raw `fetch` / custom TypeScript wrapper

**Why**:
1. No official Node.js SDK exists
2. Mattermost Go SDK is the canonical reference
3. `fetch` + TypeScript types is lightweight and sufficient
4. Go SDK types can be ported to TypeScript interfaces

**Alternative**: `@mattermost/server-sdk` (community)
- npm: `npm install @mattermost/server-sdk`
- Community-maintained, not official

```typescript
// Recommended: Custom wrapper
import { Client4 } from './mattermost-client'; // Your wrapper

const client = new Client4({
  baseUrl: 'https://mattermost.example.com',
  token: process.env.MATTERMOST_TOKEN
});

const posts = await client.getPostsForChannel(channelId, { page: 0, perPage: 60 });
```

### Native CLI

No equivalent to `gh` CLI for Mattermost. The Mattermost server is the primary interface.

**mmctl (Mattermost CLI)**:
- Server administration CLI
- Not useful for connector development
- Requires server SSH access

---

## 13. Open Questions

1. **Hosting mode**: Does tenant use Mattermost Cloud (mattermost.com) or self-hosted? Affects rate limit configuration and bot account availability.

2. **CRT (Collapsed Threads)**: Does the tenant have CRT enabled? Affects thread reply handling and notification behavior.

3. **Team isolation**: Does the tenant have multiple teams that need separate monitoring, or single team?

4. **Bot provisioning**: Can the tenant admin create bot accounts, or does this require organization-level admin?

5. **Channel structure**: What's the existing channel organization? Are there dedicated support channels, or should the connector create them?

6. **Authentication method**: User access token (bot) vs session token? Bot account is recommended but requires admin enablement on self-hosted.

7. **Webhook vs WebSocket**: Does the tenant allow incoming webhooks? Some self-hosted instances disable webhooks for security.

8. **Message limits**: Are there custom `PostMessageMaxRunes` or `PostEditTimeLimit` configurations that differ from defaults?

---

## Appendix: Endpoint Quick Reference

### Base URL
```
https://{domain}/api/v4
```

### Auth Header
```
Authorization: Bearer {token}
```

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/users/login` | POST | Login with credentials |
| `/users/me` | GET | Get current user |
| `/users/{id}` | GET | Get user by ID |
| `/users/username/{name}` | GET | Get user by username |
| `/users/{id}/tokens` | POST | Create user access token |
| `/channels` | GET | List all channels |
| `/channels/{id}` | GET | Get channel |
| `/channels/{id}/posts` | GET | Get channel posts |
| `/channels/direct` | POST | Create DM |
| `/channels/group` | POST | Create group DM |
| `/posts` | POST | Create post |
| `/posts/{id}` | GET | Get post |
| `/posts/{id}` | PUT | Edit post |
| `/posts/{id}` | DELETE | Delete post |
| `/posts/{id}/thread` | GET | Get thread |
| `/posts/{id}/pin` | POST | Pin post |
| `/posts/{id}/pin` | DELETE | Unpin post |
| `/reactions` | POST | Add reaction |
| `/reactions` | DELETE | Remove reaction |
| `/bots` | POST | Create bot |
| `/bots` | GET | List bots |
| `/webhooks/incoming` | POST | Create incoming webhook |
| `/webhooks/outgoing` | POST | Create outgoing webhook |
| `/teams` | GET | List teams |
| `/teams/{id}/channels` | GET | List team channels |
| `/commands` | POST | Create slash command |
| `/commands/{id}/execute` | POST | Execute slash command |
| `/files` | POST | Upload file |
| `/websocket` | WS | WebSocket connection |

### Pagination Query Parameters
```
?page=0&per_page=60
```

### Rate Limit Response Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1699999999
Retry-After: 5
```

---

## Appendix: WebSocket Connection

```typescript
class MattermostWebSocket {
  private ws: WebSocket;
  private url: string;
  private token: string;
  private sequence: number = 0;

  constructor(url: string, token: string) {
    this.url = url.replace(/^http/, 'ws') + '/api/v4/websocket';
    this.token = token;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, undefined, {
        headers: { Authorization: `Bearer ${this.token}` }
      });

      this.ws.on('open', () => {
        // Authenticate via WebSocket
        this.ws.send(JSON.stringify({
          seq: 1,
          action: 'authentication_challenge',
          data: { token: this.token }
        }));
      });

      this.ws.on('message', (data) => {
        const message = JSON.parse(data);
        if (message.event === 'hello') {
          resolve();
        }
        this.handleEvent(message);
      });

      this.ws.on('error', reject);
    });
  }

  private handleEvent(event: WebSocketMessage) {
    switch (event.event) {
      case 'posted':
        const post = JSON.parse(event.data.post);
        console.log('New post:', post);
        break;
      case 'reaction_added':
        console.log('Reaction added:', event.data.reaction);
        break;
      // ... handle other events
    }
  }
}
```

---

## Appendix: Post Message Format

Mattermost uses **Markdown** for message formatting:

```markdown
# Heading
## Subheading
**bold** and *italic*
- bullet list
1. numbered list
`inline code`
```
code block
```
@username - mention user
#channel - channel reference
[link text](https://example.com)
```

### Message with Structured Content (Attachments)

```json
{
  "message": "Ticket #123 has been updated",
  "props": {
    "attachments": [
      {
        "color": "#FF0000",
        "title": "Bug: Login fails on Safari",
        "text": "User cannot log in when using Safari 17",
        "fields": [
          { "title": "Priority", "value": "High", "short": true },
          { "title": "Status", "value": "Investigating", "short": true }
        ],
        "footer": "Support Agent",
        "ts": 1699999999
      }
    ]
  }
}
```