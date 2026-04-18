# Discord Connector — Inbound Events Audit Review

**Reviewed file:** `docs/connectors/discord.md`
**Angle:** Webhook/Gateway intake, event completeness, payload shapes, replay protection, polling fallback, mention detection
**Verdict:** CONDITIONAL PASS — Gateway intake is correctly described; two notable gaps on replay protection and forum tag lifecycle events

---

## Finding 1: Gateway Payload Shape — Correct

**Event affected:** All Gateway events (MESSAGE_CREATE, MESSAGE_UPDATE, MESSAGE_DELETE, THREAD_*)

**What is correct:**
```json
{
  "op": 0,
  "d": { /* event-specific data */ },
  "s": 42,
  "t": "MESSAGE_CREATE"
}
```

**Correction needed:** None. Shape is accurate. `op` (opcode), `d` (data), `s` (sequence), `t` (type/event name) are correct.

---

## Finding 2: Gateway Events List — Complete for MVP, Missing Phase 2 Thread Events for Tag Changes

**Event affected:** Forum tag add/remove

**What is wrong:**
The document covers forum channel tags in Section 5 and shows GET/PATCH endpoints for tags, but does not document whether Discord fires Gateway events for tag changes on threads. Forum channels (type 11/15) and their threads can have tags assigned/removed.

**Correction:**
Add to the Gateway events table:

| Event | Intent Required | Trigger |
|-------|----------------|---------|
| `CHANNEL_UPDATE` | GUILDS | Forum tag configuration changed |

Note that individual thread tag assignments may NOT fire a dedicated Gateway event — they may only be readable via `GET /channels/{channel.id}/threads/{thread.id}` or the thread's initial message payload, requiring a REST lookup to detect.

**Recommendation:** Flag this as a known gap — tag-change detection on existing threads may require polling the thread or forum channel after thread creation.

---

## Finding 3: No Replay Protection Mechanism Documented

**Event affected:** All Gateway events

**What is wrong:**
Discord's Gateway does not enforce replay protection. The WebSocket connection delivers events in real-time with no built-in deduplication or timestamp tolerance window. If the connection drops and resumes, Discord will replay events from the last sequence number, but there is no per-event cryptographic signature or timestamp header to verify freshness.

The document does not mention this gap.

**Correction:**
Add a subsection under Section 3:

> **Replay Protection**
>
> Discord Gateway does not provide per-event cryptographic signatures or timestamp headers. Events are delivered over a persistent WebSocket with sequence numbers (`s` field). On disconnect, the client can reconnect and resume from the last sequence to receive missed events.
>
> - No HMAC/SHA verification possible for individual events
> - Sequence number (`s`) allows gap detection but not event freshness proof
> - Implement deduplication by tracking processed message IDs (`d.id`)
> - Set a reconnect threshold — if sequence gap is too large, fall back to REST polling

---

## Finding 4: Webhook Events (App Lifecycle) — Signature Verification Correct

**Event affected:** APPLICATION_AUTHORIZED, APPLICATION_DEAUTHORIZED, ENTITLEMENT_CREATE, ENTITLEMENT_DELETE

**What is correct:**
- Header: `X-Signature-Ed25519` ✓
- Header: `X-Signature-Timestamp` ✓
- Algorithm: Ed25519 ✓

**Correction needed:** None for the algorithm and headers. However, the document conflates these webhook events with message intake. Clarify:

> These webhook events cover app lifecycle only (authorization, entitlements). They do NOT deliver message events. Message intake relies entirely on Gateway WebSocket.

---

## Finding 5: Gateway Has No Retry/Dead-Letter Guarantees

**Event affected:** All MESSAGE_* and THREAD_* events

**What is wrong:**
Discord Gateway is fire-and-forget over WebSocket. There is no at-least-once delivery guarantee, no retry window, and no dead-letter queue. If a message is delivered while the bot is disconnected, that event is lost unless the bot reconnects with a sequence number lower than the lost event.

The document does not address delivery guarantees.

**Correction:**
Add under Gateway section:

> **Delivery Guarantees**
>
> Discord Gateway provides at-most-once delivery. Events arrive once while connected. During disconnect, events are lost unless:
> 1. The bot reconnects before Discord's session timeout (varies, typically minutes)
> 2. The bot sends a valid `RESUME` opcode with its `session_id` and last `seq`
>
> For critical event capture, implement:
> - Periodic REST polling as reconciliation layer (see Polling Fallback)
> - Track the last processed message ID per channel
> - On reconnect, backfill any gaps via `GET /channels/{id}/messages?after={last_id}`

---

## Finding 6: Polling Fallback — Correctly Described

**Event affected:** Backfill / reconciliation polling

**What is correct:**
- Endpoint: `GET /channels/{channel.id}/messages` with `limit`, `before`, `after`, `around` snowflake params ✓
- Endpoint: `GET /guilds/{guild.id}/messages/search` with `author_id`, `channel_id`, `content`, timestamp filters ✓
- Returns newest-first ordering ✓
- MESSAGE_CONTENT intent required for content search ✓

**Correction needed:** None. Pagination is correctly described as snowflake-based.

**One addition needed:** Clarify how to detect new comments on existing threads:

> **Detecting New Thread Messages via Polling**
>
> For thread message backfill: `GET /channels/{thread.id}/messages?limit=100&after={last_processed_id}`
> Threads inherit the same message endpoint as parent channels. Use the thread's `id` as `channel.id`.

---

## Finding 7: Mention Detection — Correctly Feasible from Payload Alone

**Event affected:** MESSAGE_CREATE

**What is correct:**
The `mentions` array in MESSAGE_CREATE payloads contains User objects for all users @mentioned. Checking if the bot was mentioned is deterministic from the payload alone — no separate lookup required.

```json
{
  "mentions": [
    { "id": "123", "username": "bot", "global_name": "Bot", "bot": true }
  ]
}
```

**Correction needed:** None. The document correctly identifies this at line 327.

**Additional note:** `mention_roles` and `mention_everyone` boolean fields are also available for broader ping detection.

---

## Finding 8: Bot Loop Prevention — Correctly Documented

**Event affected:** MESSAGE_CREATE

**What is correct:**
The `author.bot` boolean field is reliably present on bot-authored messages. The document correctly shows:

```javascript
if (message.author.bot) return; // skip bot messages
```

**Correction needed:** None. This is sufficient — no separate loop-prevention marker required. The payload field is authoritative.

---

## Finding 9: MESSAGE_UPDATE Covers Edits — Reply Edits May Not Fire

**Event affected:** MESSAGE_UPDATE

**What is wrong:**
MESSAGE_UPDATE fires for message edits. However, Discord does NOT fire MESSAGE_UPDATE when the *referenced message* (in a `message_reference`) is edited. Only the direct message edit triggers an update event.

**Correction:**
Add a note:

> **Reply Edit Detection**
>
> MESSAGE_UPDATE only fires when the message itself is edited. If a user replies to a thread message, and the original thread message is later edited, the bot receives no event for that edit. To detect edited referenced messages, implement periodic REST polling of tracked thread messages.

---

## Finding 10: Close/Resolve — No Native Event, Requires Workaround Tracking

**Event affected:** Thread archival / lock events

**What is wrong:**
Discord has no native "close/resolve" concept. The document mentions thread locking/archiving as the workaround (Section 5), and THREAD_UPDATE is listed in the events table. However:

1. THREAD_UPDATE fires for any thread property change — not specifically "resolved"
2. The `archived`, `locked`, `auto_archive_duration` fields are not distinguished in the event type alone
3. There is no dedicated "thread resolved" event

**Correction:**
Add clarification:

> **Thread State Change Detection**
>
> THREAD_UPDATE fires for all thread modifications. To detect "resolved" state:
> 1. Track thread state changes via THREAD_UPDATE
> 2. Inspect `d` fields: `archived` (boolean), `locked` (boolean), `name`
> 3. There is no canonical "resolved" status — coordinate with tenant on what field(s) map to "resolved" (e.g., archived=true OR moved to a specific channel)
> 4. Phase 2 should implement THREAD_UPDATE tracking for this

---

## Finding 11: Eventual Consistency Gap — Gateway vs REST API

**Event affected:** MESSAGE_CREATE, MESSAGE_UPDATE

**What is wrong:**
Discord may deliver Gateway events for messages that are not yet readable via REST API (`GET /channels/{id}/messages/{msg.id}`). This is a known Discord behavior — the Gateway event fires optimistically before the message is fully committed to the database.

The document does not flag this gap.

**Correction:**
Add:

> **Eventual Consistency: Gateway vs REST**
>
> Discord may deliver a MESSAGE_CREATE event before the message is queryable via REST API. This can cause failures when the connector tries to fetch full message details immediately after receiving the Gateway event.
>
> Mitigation:
> - Implement a short retry loop (100-500ms delay) when REST fetch returns 404 after Gateway event
> - Cap retry attempts (e.g., 3 attempts with exponential backoff)
> - Log warning after max retries; rely on next polling cycle for reconciliation

---

## Summary

| Finding | Severity | Event/Flow |
|---------|----------|------------|
| Gateway payload shape correct | — | All events |
| Missing CHANNEL_UPDATE for tag config changes | Medium | Forum tag lifecycle |
| No replay protection documented | Medium | All Gateway events |
| Webhook events signature correct | — | App lifecycle webhooks |
| No delivery guarantees documented | Medium | All Gateway events |
| Polling fallback complete | — | Backfill |
| Mention detection correctly feasible | — | MESSAGE_CREATE |
| Bot loop prevention correct | — | MESSAGE_CREATE |
| Reply edit detection gap | Low | MESSAGE_UPDATE |
| Close/resolve tracking ambiguity | Medium | THREAD_UPDATE |
| Eventual consistency gap not flagged | Medium | MESSAGE_CREATE, REST fetch |

**Top priorities to address:**
1. Add replay protection / deduplication guidance (Finding 3)
2. Flag delivery guarantees gap (Finding 5)
3. Add eventual consistency note (Finding 11)
4. Clarify thread state change detection (Finding 10)