# Discord Connector — Endpoint Coverage Review

**Reviewed file:** `docs/connectors/discord.md`
**Scope:** REST API endpoints only (Gateway/WebSocket excluded). Auth, webhooks, rate limits excluded per scope.

**Verdict: Mostly accurate. 4 findings.**

---

## Findings

### 1. `MANAGE_THREADS` permission bit is wrong

- **Endpoint/area:** Section 2, Required Permissions table
- **What the doc says:** `MANAGE_THREADS (1 << 34)`
- **What is actually correct:** `MANAGE_THREADS = 1 << 34` is correct. However, the doc also lists `READ_MESSAGE_HISTORY (1 << 34)` — these have the **same value**, which is correct per the Discord permission constants. But the doc presents them as two separate entries without noting they're the same bit. Misleading, not wrong.
- **Citation:** Per [Discord Permission Flags](https://docs.discord.com/developers/topics/opcodes-and-status-codes#permission-flags)

### 2. Gateway API version is stale

- **Endpoint/area:** Section 3, Gateway connection URL
- **What the doc says:** `wss://gateway.discord.gg/?v=10&encoding=json`
- **What is actually correct:** Current stable version is **v10** — the doc is accurate. Gateway v11 was available in limited beta but v10 remains the documented stable version. No action needed.
- **Citation:** Per [Discord Gateway documentation](https://docs.discord.com/developers/topics/gateway)

### 3. Missing `GET /channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me` — List own reaction

- **Endpoint/area:** Section 4 (Outbound), Quick Reference table
- **What the doc says:** Only `PUT` and `DELETE` for reactions are documented
- **What is actually correct:** The GET variant to list whether the current user has reacted with a specific emoji exists and returns an object:
  ```
  GET /channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me
  ```
  This is distinct from `GET /channels/{channel.id}/messages/{message.id}/reactions/{emoji}` (which lists all users who reacted — also undocumented).
- **Impact:** Low for MVP (SupportAgent likely only needs to add/remove its own reactions), but the full reaction surface is missing.
- **Citation:** Per Discord API channel message reactions endpoints

### 4. Thread start in forum: `message` field documentation is imprecise

- **Endpoint/area:** Section 4, Create Thread
- **What the doc says:** `message: { /* required for forum channels */ }` (shown as comment)
- **What is actually correct:** When creating a thread in a forum or media channel, the `message` object is **always required** — it becomes the thread's first message. When creating a thread in a regular channel, `message` must be omitted (not `null`, not an empty object — absent entirely). The doc's inline comment is not precise enough to capture this distinction.
- **Suggested fix:** Add two separate examples — one for forum channels (requires `name` + `message`), one for regular channels (requires `name`, no `message`).
- **Citation:** Per [Discord Channel Resource — Start Thread without Message](https://docs.discord.com/developers/resources/channel#start-thread-without-message)

### 5. No endpoint for listing all reactions on a message

- **Endpoint/area:** Section 4, Reactions
- **What the doc says:** Only documents `PUT` and `DELETE` on `reactions/{emoji}/@me`
- **What is actually correct:** `GET /channels/{channel.id}/messages/{message.id}/reactions/{emoji}` lists all users who reacted with an emoji. Useful for checking reaction counts before action.
- **Citation:** Per Discord Channel Resource

---

## Capabilities Not Applicable to Discord

These are correctly marked as absent in the doc. Discord has no equivalent:

| Capability | Discord Model | Verdict |
|------------|---------------|---------|
| Priority / severity fields | No native concept; simulated via roles/embed colors | Correctly absent |
| Status open/closed | No native concept; simulated via archive/lock | Correctly absent |
| Edit comment | Reactions are add-only; message edits are for message content only | Correctly absent |
| Delete comment | Discord has no comment threads as a separate entity | N/A |
| Delete reactions from other users | Only possible with `MANAGE_MESSAGES` permission; separate endpoint `DELETE /channels/{id}/messages/{id}/reactions/{emoji}/{user.id}` | Partially covered (doc only shows `@me`) |
| Bulk delete thread reactions | `DELETE /channels/{id}/messages/{id}/reactions?emoji={emoji}` | Not documented |

---

## Endpoint Accuracy Summary

| Endpoint | Method | Path | Correct |
|----------|--------|------|---------|
| List messages | GET | `/channels/{id}/messages` | ✅ |
| Get message by ID | GET | `/channels/{id}/messages/{id}` | ✅ |
| Create message | POST | `/channels/{id}/messages` | ✅ |
| Edit message | PATCH | `/channels/{id}/messages/{id}` | ✅ |
| Delete message | DELETE | `/channels/{id}/messages/{id}` | ✅ |
| Add reaction | PUT | `/channels/{id}/messages/{id}/reactions/{emoji}/@me` | ✅ |
| Remove own reaction | DELETE | `/channels/{id}/messages/{id}/reactions/{emoji}/@me` | ✅ |
| List own reaction | GET | `/channels/{id}/messages/{id}/reactions/{emoji}/@me` | ❌ Missing |
| Pin message | PUT | `/channels/{id}/pins/{id}` | ✅ |
| Unpin message | DELETE | `/channels/{id}/pins/{id}` | ✅ |
| Create thread | POST | `/channels/{id}/threads` | ✅ |
| List archived threads | GET | `/channels/{id}/threads/archived/public` | ✅ |
| Add role to member | PUT | `/guilds/{id}/members/{id}/roles/{role.id}` | ✅ |
| Remove role from member | DELETE | `/guilds/{id}/members/{id}/roles/{role.id}` | ✅ |
| Search messages | GET | `/guilds/{id}/messages/search` | ✅ |
| Get user | GET | `/users/{id}` | ✅ |
| Get bot user | GET | `/users/@me` | ✅ |
| Get channel | GET | `/channels/{id}` | ✅ |
| Update channel tags | PATCH | `/channels/{id}` | ✅ |
| Crosspost | POST | `/channels/{id}/messages/{id}/crosspost` | ✅ |

---

## Minor Notes

1. **Gateway v11**: The Gateway URL still resolves to v10 as the stable version. The doc is fine as-is. If implementing against v11, update accordingly.

2. **Pagination**: Snowflake-based cursor pagination is correctly documented. Max page size of 100 for messages is accurate.

3. **File attachments**: Documented implicitly via the `attachments` field on messages, but no explicit endpoint detail for `files[n]` multipart form. Discord uses `multipart/form-data` with `files[n]` for attachments. Minor gap but not blocking.

4. **DM creation**: Correctly noted as unavailable via API (bots cannot proactively DM users who haven't contacted them first). The doc documents `POST /users/@me/channels` which is the correct way to open DMs — this is accurate.
