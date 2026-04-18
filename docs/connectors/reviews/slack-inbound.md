# Slack Connector — Inbound Events Review

**Reviewer**: inbound-events audit
**Source**: `docs/connectors/slack.md`
**Verdict**: ACCEPTS WITH GAPS

Slack is a communication channel, not an issue tracker. Many standard events (new item, status change, assign, close/resolve) are not applicable — this is correctly noted in §5. The inbound story for messaging, mentions, and reactions is solid but has gaps in thread reply detection, message subtype filtering, and `message.im` payload shape.

---

## Findings

### 1. Thread reply detection — misleading event names

**Issue**: The table lists `message.channels`, `message.groups`, `message.im`, `message.mpim` as separate event types. This implies thread replies arrive as a distinct event type. In practice, thread replies in Slack arrive as the same `message.channels` (or `message.groups`, etc.) event with an additional `thread_ts` field set to the parent message timestamp. There is no `message.thread_reply` event type.

**Current text**:
```
| `message.channels` | `channels:history` | Message in public channel |
| `message.groups` | `groups:history` | Message in private channel |
| `message.im` | `im:history` | Direct message to bot |
| `message.mpim` | `mpim:history` | Multi-person DM |
```

**Correction**: The "Description" column conflates channel type with reply context. Add a row clarifying thread detection:

```
| `message.channels` | `channels:history` | Message in public channel; also fires for thread replies where `thread_ts !== ts` |
| `message.groups` | `groups:history` | Message in private channel; thread replies arrive the same way |
| `message.im` | `im:history` | Direct message to bot; thread replies arrive the same way |
| `message.mpim` | `mpim:history` | Multi-person DM; thread replies arrive the same way |
```

Also add an explicit detection rule in §6 Triggers:

```
| Thread reply | `message.*` | `event.thread_ts && event.thread_ts !== event.ts` |
```

---

### 2. `message.im` payload — missing `channel_type`

**Issue**: The "Payload Fields to Persist" section shows `message.channels` example with `"channel_type": "channel"`. However, `message.im` events do **not** include a `channel_type` field. The field only appears on messages from multi-channel-capable sources (`channels`, `groups`, `mpim`).

**Current**:
```json
{
  "type": "message",
  "channel": "C123ABC456",
  "channel_type": "channel",   // always present in docs
  "user": "U123ABC456",
  "text": "Hello world",
  "ts": "1515449522.000016",
  "thread_ts": "1515449522.000016",
  "bot_id": "B123ABC456",
  "subtype": "bot_message"
}
```

**Correction**: Add a separate `message.im` payload block:

```json
// message.im — no channel_type field
{
  "type": "message",
  "channel": "D123ABC456",   // DM channel ID starts with D
  "user": "U123ABC456",
  "text": "Hello world",
  "ts": "1515449522.000016",
  "thread_ts": "1515449522.000016",  // threads supported in DMs
  "bot_id": "B123ABC456",
  "subtype": "bot_message"
}
```

Also note: DM channel IDs start with `D`, while channel IDs start with `C`, group IDs with `G`, and MPIM IDs with `M`. This is a useful disambiguation signal.

---

### 3. Message subtype filtering — system messages not excluded

**Issue**: The `no_self_retrigger` section only checks `bot_id` and `user`. It does not address `subtype`. Bot messages, channel join/leave events, channel purpose changes, and file shares arrive with various `subtype` values and must be filtered out before processing as user-triggered events.

**Known subtypes requiring filtering**:
- `bot_message` — message posted by a bot (even a different bot)
- `channel_join` — user joined channel
- `channel_leave` — user left channel
- `channel_topic` — channel topic changed
- `channel_purpose` — channel purpose changed
- `channel_name` — channel renamed
- `file_share` — file attached to message
- `pinned_item` — item pinned to channel
- `me_message` — `/me` action
- `tombstone` — message deleted/hidden

**Current**:
```typescript
// On any incoming event:
if (event.bot_id && event.bot_id === ourBotId) return;
if (event.user && event.user === ourBotUserId) return;
```

**Correction**: Add subtype guard:

```typescript
const SYSTEM_SUBTYPES = new Set([
  'bot_message', 'channel_join', 'channel_leave', 'channel_topic',
  'channel_purpose', 'channel_name', 'file_share', 'pinned_item',
  'me_message', 'tombstone'
]);

function isUserMessage(event): boolean {
  if (event.subtype && SYSTEM_SUBTYPES.has(event.subtype)) return false;
  if (event.bot_id && event.bot_id === ourBotId) return false;
  if (event.user && event.user === ourBotUserId) return false;
  return true;
}
```

---

### 4. `app_mention` in threads — ambiguous behavior

**Issue**: The document does not address whether `app_mention` fires when a user replies to a bot message in a thread and also mentions the bot (`@botname`). This is a common SupportAgent flow: user receives triage output, replies in thread with a follow-up and `@botname`.

**Clarification needed**: Slack's Events API `app_mention` fires when the message text contains `<@BOT_USER_ID>`. In a thread reply, if the user types `@botname help`, the event arrives as `app_mention` with both `thread_ts` (parent) and `ts` (reply). This is supported. Document this edge case explicitly.

**Add to §6 Triggers**:
```
| Thread reply with mention | `app_mention` | `event.thread_ts !== undefined && event.text.includes("<@BOT_USER_ID>")` |
```

---

### 5. Signature verification header name mismatch

**Issue**: The document says "Headers: `X-Slack-Signature` (value: `v0=<hex_digest>`), `X-Slack-Request-Timestamp`". The code function signature shows `timestamp: string` as a parameter but does not show how to extract it from the header. The variable name in the function (`timestamp`) is clear but the documentation flow (header → code) is disconnected.

**Correction**: Add explicit header extraction step:

```typescript
const rawBody = req.rawBody;           // must be raw, not parsed+re-serialized
const timestamp = req.headers['x-slack-request-timestamp'];
const signature = req.headers['x-slack-signature'];
if (!verifySlackSignature(rawBody, timestamp, signature, signingSecret)) {
  return res.status(400).send('Invalid signature');
}
```

Also note: the raw body must be used as-is. Parsing with `express.json()` and then serializing loses the exact bytes Slack signed. Use a raw body middleware or read the stream directly.

---

### 6. Webhook delivery guarantees — partially documented

**Issue**: The document notes `event_id` deduplication and 3-second timeout. It does not document Slack's retry behavior or dead-letter story.

**Missing details**:
- Slack retries with exponential backoff over ~4 hours if endpoint returns non-2xx
- HTTP 409 (challenge response) does NOT trigger retry
- If SupportAgent is down for >4 hours, events are lost — no dead-letter queue
- No guaranteed ordering; use `ts` as source of truth for sequencing

**Add to §3**:

```
### Delivery Guarantees

- **At-least-once**: Slack retries non-2xx responses with backoff (~4h window)
- **No ordering guarantee**: Use `event.event_time` and `message.ts` for sequencing
- **Deduplication**: Store `event_id` (e.g., `Ev123ABC456`) as idempotency key
- **Event loss possible**: If endpoint is down >4h, missed events require polling reconciliation
- **Challenge response**: `HTTP 409` with `challenge` field stops retry; do not return 409 for other cases
```

---

### 7. Polling fallback — `conversations.replies` limit is blocking

**Issue**: The document mentions the `conversations.replies` rate limit (1 req/min, max 15) but does not provide a workaround. For SupportAgent's primary use case (detecting new comments/replies), polling thread replies is essentially unusable at this limit.

**Workaround needed**: The only viable path is to not poll `conversations.replies` at all. Instead, rely on:
1. Real-time `message.*` events (which fire for thread replies)
2. `conversations.history` with `thread_ts` filter for reconciliation

**Correction** in §3 polling section:

```typescript
// CORRECT approach: use conversations.history with thread_ts filter
// NOT conversations.replies (rate limited to death)

// To get thread replies for a specific parent message:
const result = await slack.conversations.history({
  channel: 'C123',
  oldest: lastProcessedTimestamp,
  limit: 200,
  // Slack returns all messages including thread replies when querying
  // the parent message's channel. Filter client-side:
});
// Then filter: messages.filter(m => m.thread_ts === parentTs)

// CRITICAL: conversations.replies is 1 req/min for non-Marketplace apps.
// Do not use for polling. Only use for one-off audit of a specific thread.
```

---

### 8. Bot-authored content detection — `bot_id` is unreliable for token-based bots

**Issue**: The `no_self_retrigger` section checks `event.bot_id`. This field is only present when the message was posted by a bot via a bot token **and** the app has `bot` token characteristics. If SupportAgent uses a user token or a custom integration token, `bot_id` may be absent even for its own messages.

**Better approach**: Use `auth.test()` result cached at startup:

```typescript
const auth = await slack.auth.test();
const ourBotUserId = auth.user_id;   // U prefix, e.g. U0LAN0Z89

function isOurMessage(event): boolean {
  // Check user ID first (works for all token types)
  if (event.user === ourBotUserId) return true;
  // bot_id is a secondary signal for bot token users
  if (event.bot_id && event.bot_id === ourBotId) return true;
  return false;
}
```

Also note: bot messages posted via `chat.postMessage` have `bot_id` set. Messages posted via the `files.shared` endpoint may not.

---

### 9. Emoji reactions as tags — ambiguous update/diff story

**Issue**: §5 notes "emoji reactions as lightweight tags" but does not address how to detect a reaction change on a message SupportAgent already processed. `reaction_added` and `reaction_removed` fire as independent events — there is no payload indicating what message was reacted to (only `item.ts` and `item.channel`).

**Correction**: Add reaction event payload:

```json
{
  "type": "reaction_added",
  "user": "U123ABC456",
  "reaction": "thumbsup",
  "item": {
    "type": "message",
    "channel": "C123ABC456",
    "ts": "1515449522.000016"
  },
  "event_ts": "1515449522.000018"
}
```

The `item.ts` and `item.channel` form a composite key to identify the target message. SupportAgent must look up the original message by `(channel, ts)` to determine which run/triage this reaction belongs to. This requires maintaining a message-to-run index or fetching the message via `conversations.history` + filter.

---

### 10. Eventual consistency gap not actionable

**Issue**: §10 "Known Gotchas" says "Message may not appear in history immediately after posting" but provides no mitigation. For SupportAgent's polling fallback, if the last processed `ts` is near real-time, the next poll may miss the most recent messages.

**Correction**: Add a 2-second grace period to polling:

```typescript
const gracePeriodMs = 2000;
const lastProcessedTs = lastProcessedTimestamp;
// Add buffer to avoid reading messages still being written
const oldest = (lastProcessedTs * 1000 - gracePeriodMs) / 1000;
```

---

## Summary

| Area | Status |
|------|--------|
| Webhook events listed | Accept — covers messaging, mentions, reactions |
| Event names (scoping) | Accept |
| Payload top-level shapes | Minor gap — `message.im` missing `channel_type` note |
| Signature verification | Accept — algorithm, header names, body bytes all correct |
| Replay protection | Accept — 300s window documented |
| Webhook delivery guarantees | Incomplete — retry window, dead-letter gap |
| Polling fallback | Misleading — `conversations.replies` is unusable; needs `conversations.history` + filter approach |
| Mention detection | Accept — both `app_mention` and text-search for DMs covered |
| Bot loop prevention | Partial — `bot_id` is secondary; user ID check is primary |
| System subtype filtering | Missing — must exclude `bot_message`, `channel_join`, etc. |
| Thread reply detection | Misleading — no distinct event type; `thread_ts` is the key |
| `app_mention` in threads | Ambiguous — needs explicit note |
| Reaction events as tags | Acceptable — payload shape, composite key note needed |

**No critical correctness issues** in the webhook signature or event type names. The main gaps are operational: polling story is unrealistic for `conversations.replies`, system subtypes are unfiltered, and thread reply detection is described as separate events rather than a filter condition on `message.*`.