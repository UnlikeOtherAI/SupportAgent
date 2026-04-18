# Mattermost Connector — Inbound Events Audit

**Verdict: CONDITIONAL PASS** — Core event intake is correct; significant gaps in mention detection precision, missing `post_edited` coverage in MVP scope, and missing replay protection acknowledgment.

---

## Findings

### 1. Event Coverage — Status Change

**Affected**: `status change` event requirement
**Issue**: Mattermost has no native issue/ticket status model. The document correctly identifies this as a limitation in Section 5 but does not prominently warn in the events section that `status change` events do not exist and cannot be synthesized.
**Correction**: Add explicit note in Section 3 or 6: *"Mattermost does not fire status-change events. The closest proxy is `channel_updated` when a channel is moved between categories, or `channel_deleted` for resolution. SupportAgent must implement status tracking via its own state machine, not via platform events."*

---

### 2. Event Coverage — Labels/Tags

**Affected**: `label/tag add/remove` event requirement
**Issue**: Mattermost has no native label/tag system. The document proposes emoji reactions as a proxy (Section 5) but does not map `reaction_added`/`reaction_removed` to the `label/tag add/remove` requirement in the trigger table.
**Correction**: In Section 6 Trigger Types table, add:
```
| Label/tag added | `reaction_added` event | Match `data.reaction.emoji_name` as label key |
| Label/tag removed | `reaction_removed` event | Match `data.reaction.emoji_name` as label key |
```
Note that `reaction_added`/`reaction_removed` are confirmed supported WebSocket events (Section 3).

---

### 3. Event Coverage — Assign / Close / Resolve

**Affected**: `assign`, `close/resolve` event requirements
**Issue**: Mattermost has no native assignment or resolution concept. The document does not explicitly state these events cannot be delivered.
**Correction**: Add to Section 6: *"No events exist for assignment or resolution. SupportAgent must implement these via its own state machine and write-back operations if needed."*

---

### 4. Mention Detection — Precision

**Affected**: Mention detection flow
**Issue**: Section 6 lists mention detection as: *"Match `@bot_username` in `data.post.message`"*. This is fragile — requires the connector to know the exact bot username string and do string matching. The document does not mention `post.props.mentions` which contains explicit mention data.
**Correction**: Change Section 6 and the trigger matcher implementation to use `post.props.mentions`:

```typescript
// Correct approach: check props.mentions for bot user ID
const post = JSON.parse(event.data.post);
const mentions: Record<string, User> = post.props?.mentions || {};
const botMentioned = mentions[config.botUserId] !== undefined;
```

The `props.mentions` field is a `Record<string, User>` keyed by user ID, populated by Mattermost's server-side mention parser. This is more reliable than string matching `@username` because:
- Handles aliases, case variations, and display names
- Works even if the bot's username was edited out
- Server-authoritative, not client-dependent

---

### 5. Post Object — `participants` and `metadata` Fields

**Affected**: WebSocket `posted` event payload, `PersistedPost` interface
**Issue**: The Post interface in Section 3 includes:
- `participants: User[]` — This is NOT a field on Mattermost Post objects. Participants are fetched separately via thread endpoint.
- `metadata: PostMetadata` — Listed but not defined or used.

The correct Post fields for SupportAgent purposes are:
```typescript
interface Post {
  id: string;
  create_at: number;
  update_at: number;
  edit_at: number;
  delete_at: number;
  is_pinned: boolean;
  user_id: string;
  channel_id: string;
  root_id: string;         // "" = root, non-empty = reply
  message: string;
  type: string;            // "" or "system_*"
  props: {
    from_bot?: string;     // "true"
    from_webhook?: string; // "true"
    mentions?: Record<string, User>; // Keyed by user_id
    attachments?: MessageAttachment[];
    // ... other custom props
  };
  hashtags: string;
  file_ids: string[];
  // Note: reply_count and last_reply_at are on thread, not post
}
```
**Correction**: Remove `participants` and `metadata` from the Post interface. Add `reply_count` and `last_reply_at` as thread-level fields accessed via `GET /api/v4/posts/{post_id}/thread`.

---

### 6. Post Object — `original_id` Field

**Affected**: WebSocket `posted` event payload
**Issue**: The Post interface includes `original_id: string`. Mattermost Post objects do not have an `original_id` field. This appears to be an error.
**Correction**: Remove `original_id` from the Post interface.

---

### 7. WebSocket — Replay Protection Missing

**Affected**: WebSocket delivery semantics
**Issue**: The document does not mention replay protection for WebSocket events. Mattermost WebSocket does not provide per-message timestamps or sequence numbers suitable for replay detection.
**Correction**: Add to Section 3 (WebSocket Event Types) or Section 10 (Known Gotchas):

*"WebSocket events have no built-in replay protection or timestamp tolerance. The `seq` field provides ordering within a connection session but resets on reconnect. If replay protection is required, SupportAgent must deduplicate by `data.post.id` (for `posted`) or `data.post_id` (for `post_deleted`) using a persistent store with appropriate TTL."*

---

### 8. WebSocket — Per-Message Authentication Missing

**Affected**: Signature verification section
**Issue**: Section 3 (Signature Verification) only covers outgoing webhooks (token-based, no HMAC). For WebSocket, there is no per-message cryptographic signature — only initial connection auth via Bearer token and `authentication_challenge`.
**Correction**: Add a subsection under Section 3:

*"WebSocket — No Per-Message Signature*
*WebSocket events carry no HMAC or token in each message. Authentication happens once on connect via Bearer header and `authentication_challenge` payload. All subsequent events are trusted based on the established connection. This means:*
- *Do not expose the WebSocket endpoint publicly without additional transport-layer security (WSS/TLS)*
- *No body-bytes signing to verify per-message authenticity*
- *Connection-level auth is the sole trust anchor*"

---

### 9. Outgoing Webhook — Body Encoding

**Affected**: Outgoing webhook intake
**Issue**: Section 3 (Signature Verification) shows outgoing webhook payload as `Content-Type: application/x-www-form-urlencoded`. This is correct. However, the document does not clarify what the full payload looks like.
**Correction**: Add the full outgoing webhook POST body format:

```
POST /your-webhook-endpoint
Content-Type: application/x-www-form-urlencoded

token={webhook_token}
&team_id={team_id}
&channel_id={channel_id}
&channel_name={channel_name}
&timestamp={timestamp}
&user_id={user_id}
&user_name={user_name}
&post_id={post_id}
&text={url_encoded_message_content}
&trigger_word={trigger_word_if_matched}
```

Note: `text` is URL-encoded and truncated to 1MB. The `token` comparison is plaintext — no HMAC.

---

### 10. MVP Scope — Missing `post_edited` Handling

**Affected**: MVP scope (Section 11)
**Issue**: The MVP lists `post_edited` as a webhook event to handle, but the `post_edited` field is not in the Trigger Matcher Implementation in Section 6.
**Correction**: Add `post_edited` case to the trigger matcher in Section 6:

```typescript
if (trigger.type === 'post_edited') {
  if (event.event !== 'post_edited') continue;
  const post = JSON.parse(event.data.post);
  if (trigger.pattern && !trigger.pattern.test(post.message)) continue;
  return trigger;
}
```

Also clarify: `post_edited` fires when any post is edited. SupportAgent likely only cares about edits to its own posts or posts in monitored channels where it has replied.

---

### 11. Polling — `since` Parameter Clarification

**Affected**: Polling fallback strategy
**Issue**: Section 3 describes `&since={last_timestamp}` but does not clarify whether this returns posts created OR updated since the timestamp. Mattermost's `since` returns posts with `update_at > since`.
**Correction**: Add to polling section:

*"The `since` parameter filters posts where `update_at > timestamp`. This catches:*
- *Posts created after the timestamp*
- *Posts edited after the timestamp*
- *Deleted posts are NOT included (they have `delete_at > 0` but the post is excluded)*

*For new comments on existing items, compare incoming `post.root_id` against tracked root posts."*

---

### 12. Thread Updated — Event Name

**Affected**: WebSocket event list
**Issue**: Section 3 lists `thread_updated` as an event. The Mattermost WebSocket event for thread changes is `thread_updated` (confirmed). However, the document does not clarify what fields are in this event payload.
**Correction**: Add payload detail for `thread_updated`:

```
thread_updated:
  data.thread = {
    id: string;           // Post ID (root post)
    reply_count: number;
    last_reply_at: number;
    participants: User[];
    is_following: boolean;
    // ... thread metadata
  }
```

---

### 13. Eventual Consistency Gap — Undocumented

**Affected**: `posted` event and polling
**Issue**: Section 10 (Known Gotchas) mentions "New posts may not appear in `GetPostsForChannel` for ~100ms" but does not connect this to a gap in the WebSocket + polling dual-intake strategy.
**Correction**: Add to Section 3 or 10:

*"Eventual consistency gap: A `posted` WebSocket event may fire before the post is queryable via `GET /api/v4/channels/{id}/posts`. If SupportAgent uses WebSocket as primary and polling as fallback for missed events, it must handle the case where polling returns a post that was already processed via WebSocket (deduplicate by `post.id`). The ~100ms gap is typical; longer delays (up to several seconds) may occur under high server load."*

---

### 14. Loop Prevention — Bot Filter Completeness

**Affected**: Bot-authored content filtering
**Issue**: Section 7 shows the `isBotPost` function with `props.from_bot` and `props.from_webhook`. This is correct for bot posts via API. However, the document does not note that posts sent via incoming webhook (Section 4) will have `from_webhook: "true"` but NOT `from_bot: "true"`.
**Correction**: Update the `isBotPost` function comment:

```typescript
// Posts by bot account via API:   user_id === botUserId, props.from_bot = "true"
// Posts by incoming webhook:       props.from_webhook = "true", user_id = creating user
// Posts by outgoing webhook relay: user_id !== botUserId (has its own user)
function isBotPost(post: Post, botUserId: string): boolean {
  return post.user_id === botUserId ||
         post.props?.from_bot === "true" ||
         post.props?.from_webhook === "true"; // Only for incoming webhook posts
}
```

---

## Summary of Corrections

| # | Section | Change |
|---|---------|--------|
| 1 | 3 / 6 | Add explicit "no status-change events" warning |
| 2 | 6 | Map `reaction_added`/`reaction_removed` to label add/remove |
| 3 | 6 | Add note: no assign or close/resolve events |
| 4 | 6, 7 | Use `post.props.mentions[botUserId]` instead of string matching |
| 5 | 3 | Remove `participants` and `metadata` from Post; add thread fields note |
| 6 | 3 | Remove `original_id` from Post interface |
| 7 | 3 / 10 | Add replay protection gap documentation |
| 8 | 3 | Add WebSocket no-per-message-signature warning |
| 9 | 3 | Document full outgoing webhook POST body |
| 10 | 6 / 11 | Add `post_edited` to trigger matcher |
| 11 | 3 | Clarify `since` = `update_at > timestamp` semantics |
| 12 | 3 | Add `thread_updated` payload detail |
| 13 | 3 / 10 | Document eventual consistency gap between WS and polling |
| 14 | 7 | Clarify incoming webhook `from_webhook` vs `from_bot` distinction |

---

## Events Not Applicable (Platform Does Not Have)

These requirements cannot be met by Mattermost — document should mark them N/A:

| Requirement | Mattermost | Notes |
|-------------|-----------|-------|
| Status change event | N/A | No status model; closest proxy is channel category change |
| Assign event | N/A | No native assignment; closest proxy is user_added to channel |
| Close/resolve event | N/A | No resolution model; closest proxy is channel deletion or category change |
| Native label/tag system | N/A | No labels; reactions can serve as proxy with `reaction_added`/`reaction_removed` |

---

## Platform Events Summary

| Event | SupportAgent Requirement | Mattermost Event | Notes |
|-------|-------------------------|------------------|-------|
| New item (channel post) | new item | `posted` (root_id === "") | Correct |
| New comment (thread reply) | new comment | `posted` (root_id !== "") | Correct |
| Edit | edit | `post_edited` | Correct; missing from trigger matcher |
| Delete | delete | `post_deleted` | Correct |
| Mention | mention | `posted` + `post.props.mentions` | Needs fix: use props not string match |
| Label/tag add | label add | `reaction_added` | Correct; needs trigger table mapping |
| Label/tag remove | label remove | `reaction_removed` | Correct; needs trigger table mapping |
| Status change | N/A | N/A | Platform lacks this |
| Assign | N/A | N/A | Platform lacks this |
| Close/resolve | N/A | N/A | Platform lacks this |
| Thread updated | N/A | `thread_updated` | Exists; relevance to SupportAgent unclear |
