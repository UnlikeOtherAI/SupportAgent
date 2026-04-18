# Microsoft Teams Connector — Inbound Events Review

**Verdict: REJECTED — requires revisions before approval**

---

## 1. Bot Framework Webhook — Incorrect Signature Description

**Affected section:** 3.2

The document describes Bot Framework signature verification as:

> `Authorization: Bearer {channel token}` — but the actual validation uses the request body HMAC against the bot secret, not a JWT.

This conflates two unrelated mechanisms. Bot Framework does **not** use an `Authorization: Bearer` header for HMAC validation.

**Correction:** Bot Framework uses the `MS-ChannelToken` header. The connector computes an HMAC-SHA256 of the raw request body using the bot secret, then base64-encodes it and sends it as the header value:

```
MS-ChannelToken: base64(hmac_sha256(body_bytes, bot_secret))
```

Validate by:
1. Reading the raw request body bytes (before JSON parsing)
2. Computing HMAC-SHA256 with the bot secret
3. Comparing the result against the incoming `MS-ChannelToken` value

The bot secret is the **Bot Channels Registration** secret, not the Azure AD client secret.

---

## 2. Subscription `resourceData` Does Not Contain Full Message Object

**Affected section:** 3.1 and 3.4

Section 3.4 specifies `$.webUrl` as the `externalUrl` field path. However, the subscription notification payload `resourceData` does **not** contain the full `chatMessage` object — it contains a minimal subset.

**The documented payload shows `webUrl` as if it's in `resourceData`:** It is not. Graph change notifications for messages deliver only a subset of message fields in `resourceData`: `id`, `messageType`, `createdDateTime`, `from`, `body`, `channelIdentity`, `mentions`, `replyToId`. `webUrl` is **not** included in `resourceData` delivered via subscription.

**Correction:** For `externalUrl`, either:
- Build it from the known structure: `https://teams.microsoft.com/l/message/{teamId}/{channelId}/{messageId}`
- Fall back to a Graph API `GET` call for full message details after receiving the notification
- Note that the full message object via Graph API includes `webUrl`

---

## 3. Subscription Notifications Have Unknown Delivery Guarantees

**Affected section:** 3.1, 3.2, and gotcha #4

The document describes Graph change notification delivery (3-second response, retry) but does not state the delivery guarantee model.

**Known behavior:** Microsoft Graph change notifications are **at-least-once** delivery. Microsoft retries notifications with exponential backoff for up to ~4 hours. There is no dead-letter queue API — if your endpoint fails persistently, you miss events.

**Missing from the document:**
- Expected retry window: Graph retries for ~4 hours with backoff
- No dead-letter visibility: there is no API to list missed deliveries
- Reconciliation strategy: how to detect and recover from missed notifications

**Correction:** Add a note that subscriptions alone are insufficient for reliable event ingestion. A periodic full-sync or delta query reconciliation job is required as a safety net. Suggested reconciliation interval: every 15 minutes per subscribed resource.

---

## 4. `teams/getAllMessages` Scope — Oversimplified

**Affected section:** 3.1, table row

The document says: "To subscribe to ALL channel messages org-wide: `teams/getAllMessages` (requires `ChannelMessage.Read.All` and admin consent)."

**Issues:**
- This scope requires **organization-wide** admin consent — not just tenant admin consent. This is a higher bar and should be flagged.
- The scope name is actually `Chat.Read.All` for chats and `ChannelMessage.Read.All` for channels — the "getAllMessages" resource path works, but the permission scoping is more nuanced than stated.
- `teams/getAllMessages` does not include 1:1 chat messages. Separate subscriptions for `chats` are needed.

**Correction:** Add a note that `teams/getAllMessages` requires organization-level admin consent and does not cover 1:1 chats. For most multi-tenant scenarios, per-team per-channel subscriptions are more practical and consent-scoped.

---

## 5. Bot Webhook vs Graph Subscription — Unclear Overlap

**Affected section:** 3.1 and 3.2

The document presents two webhook paths (Graph subscriptions + Bot Framework) but does not clarify which events arrive via which path.

**The actual behavior:**
- Graph subscriptions (section 3.1) handle **channel** and **chat** message events for all messages in subscribed resources — including messages that @mention the bot
- Bot Framework webhook (section 3.2) is triggered when a user **directly messages** the bot or the bot is **@mentioned in a channel** — but it may also fire for the same events that Graph subscriptions deliver

**Correction:** Clarify the deduplication strategy:
- Graph subscriptions deliver all messages in a channel/chat
- Bot Framework webhook fires for bot @mentions and direct messages
- For MVP, choose one: either use Graph subscriptions and filter for bot mentions from `mentions` array, or use Bot Framework webhook. Using both creates duplicate event processing.
- Recommend: use Graph subscriptions as the primary inbound path; use Bot Framework only for proactive command scenarios that require real-time TurnContext.

---

## 6. Mention Detection — Partial Coverage for Tag Mentions

**Affected section:** 3.1, table, and section 6

The notification payload includes `mentions: [{ "mentioned": { "user": { "id": "uuid" }}]` for user mentions. This correctly handles bot @mention detection.

**Missing:** Tag mentions are **not** in the `mentions` array with the same structure. When a user types `<at>tag:TagName</at>`, the `mentions` array may include a mention entry with `mentioned.application` or a different structure, or may not appear at all.

**Correction:** Add a note that tag mentions (`<at>tag:TagName</at>`) may not appear in the `mentions[*].mentioned.user` array. Fall back to regex matching on `body.content` for `<at>tag:TagName</at>` patterns. Test this against actual Graph subscription payloads.

---

## 7. Polling Fallback — No Timestamp Filtering

**Affected section:** 3.3

The document correctly notes "No native `createdDateTime gt {timestamp}` filter — you must filter client-side or use `$search`." However, it does not address the performance implication.

**Correction:** For high-volume channels, client-side filtering on `createdDateTime desc` is O(n) — the API returns the most recent N messages and you filter locally. This does not scale. Add a note that delta queries (section 3.3) are the preferred fallback, not list-with-filter. Delta queries return only changed items and handle the cursor state automatically.

---

## 8. Eventual Consistency Gap — Not Documented

**Affected section:** 3.1

Graph change notifications can fire **before** the message is readable via the Graph API. There is a documented delay of ~5–15 seconds between event firing and API availability. This is a known Graph behavior.

**Correction:** Add a note: "After receiving a subscription notification, wait at least 5 seconds before fetching the full message via Graph API. If the `GET /messages/{id}` call returns 404, retry with exponential backoff up to 3 times over 30 seconds."

---

## 9. Loop Prevention — `from.application` Incomplete for Chat Messages

**Affected section:** 7.3

The document says `from.application.id` is the bot's app ID when the message is from the bot. This is correct for **channel messages**.

**Issue for chat messages:** In 1:1 and group chats, when the bot sends a message via Bot Framework proactively, the `from` field in the chatMessage object may show the application ID — but when the bot sends via Graph API, the attribution behavior in chats can differ from channels.

**Correction:** Add a note that bot-authored messages in **channel messages** are reliably identified by `from.application.id === botId`. For **chat messages**, verify this behavior with a live test before relying on it for loop prevention. If unreliable, use the `replyToId` + our own `messageId` tracking as a fallback.

---

## 10. Missing Events — Not Flagged as Platform Gaps

**Affected section:** 3.1, 3.2

The document correctly identifies that Teams has no status, labels, or close events. However, it does not flag that the following events are also missing from Teams' webhook/polling surface:

| Event | Teams equivalent? |
|---|---|
| Status change | No — Teams has no issue status |
| Label/tag add/remove | Tags exist but are for user groups, not items |
| Assign | No assignment concept |
| Close/resolve | No resolution workflow |
| Message edit | Available via subscription `changeType: "updated"` — but not mentioned |
| Message delete | Available via subscription `changeType: "deleted"` — but not mentioned |
| Reaction add/remove | No Graph subscription for reactions |

**Correction:** Add a section listing which SupportAgent events are **not supported** on Teams, with a clear "not applicable" designation per event. Specifically:
- Message edit events (`changeType: "updated"`) — should be added to supported webhook events
- Message delete events (`changeType: "deleted"`) — should be added to supported webhook events
- Reaction events — not available via Graph subscriptions

---

## 11. Subscription Renewal — Missing Failure Mode

**Affected section:** 3.1 and gotcha #3

The document says subscriptions expire and must be renewed before expiry. It does not address what happens if the renewal job fails or runs late.

**Correction:** Add a note: If a subscription expires before renewal, the connector must re-create the subscription. This means the resource path must be stored independently of the subscription ID. Track: `resource` (e.g., `teams/{team-id}/channels/{channel-id}/messages`), `notificationUrl`, `clientState`, and `expirationDateTime`. On re-creation, the subscription starts fresh — events during the gap are lost unless the polling fallback fills them.

---

## Summary of Required Fixes

1. **Bot Framework signature**: Fix header name to `MS-ChannelToken`, describe HMAC computation correctly
2. **`externalUrl` field**: Note that `webUrl` is not in `resourceData`; provide fallback URL construction
3. **Delivery guarantees**: Add at-least-once description, 4-hour retry window, no dead-letter visibility
4. **`getAllMessages` scope**: Flag organization-level admin consent requirement; note it excludes 1:1 chats
5. **Deduplication**: Clarify whether to use Graph subscriptions or Bot Framework as primary inbound; document deduplication approach
6. **Tag mention detection**: Add regex fallback for `<at>tag:TagName</at>` patterns in `body.content`
7. **Polling performance**: Recommend delta queries over list-with-filter for high-volume channels
8. **Eventual consistency**: Add 5-second wait before API fetch after notification receipt
9. **Loop prevention for chats**: Verify `from.application.id` for chat messages; add fallback strategy
10. **Missing events**: Document which SupportAgent events are unsupported; add `changeType: "updated"` and `"deleted"` to supported webhook events
11. **Subscription renewal failure**: Document re-creation strategy and event gap during expiry