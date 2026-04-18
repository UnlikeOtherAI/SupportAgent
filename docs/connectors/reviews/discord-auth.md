# Discord Connector — Auth Audit

**Verdict: APPROVED WITH CORRECTIONS** — The auth section is broadly accurate but contains 4 substantive issues in permission bit values, webhook signature reporting, and multi-tenant coverage.

---

## Findings

### 1. Permission Bit Shifts Are Wrong for `READ_MESSAGE_HISTORY`, `MANAGE_THREADS`, `SEND_MESSAGES_IN_THREADS`

**Issue**: Lines 47–52 list:

```
READ_MESSAGE_HISTORY (1 << 34)
MANAGE_MESSAGES (1 << 13)  — for deleting bot's own messages
MANAGE_THREADS (1 << 34)  — for thread management
```

The official Discord permission constants (confirmed via discord-api-types and the Permissions spec) are:

| Permission | Document says | Correct value |
|------------|--------------|---------------|
| `READ_MESSAGE_HISTORY` | `1 << 34` | `1 << 16` (65536) |
| `MANAGE_MESSAGES` | `1 << 13` | `1 << 13` is correct |
| `MANAGE_THREADS` | `1 << 34` | `1 << 34` is correct |
| `SEND_MESSAGES_IN_THREADS` | Not listed | `1 << 38` |

`READ_MESSAGE_HISTORY` at `1 << 34` collides with `MANAGE_THREADS` — they cannot both have the same bit value. The document uses `1 << 34` for both `MANAGE_THREADS` (correct) and `READ_MESSAGE_HISTORY` (wrong).

**Why it matters**: Incorrect bit values will produce wrong permission integers. When constructing a permission integer for the authorization URL or checking bot capabilities, the wrong bitset will grant or deny the wrong permissions silently. For example, using `1 << 34` for both would set the same bit twice (no-op for one, wrong value for the other).

**Correction**: Replace lines 47–52 with:

```
VIEW_CHANNEL          (1 << 10)  — 1024
SEND_MESSAGES        (1 << 11)  — 2048
MANAGE_MESSAGES      (1 << 13)  — 8192
READ_MESSAGE_HISTORY (1 << 16)  — 65536
MANAGE_THREADS       (1 << 34)  — 17179869184
SEND_MESSAGES_IN_THREADS (1 << 38)  — 274877906944
```

Also add `SEND_MESSAGES_IN_THREADS` to the Required Permissions list since it's used for thread replies.

---

### 2. Webhook Signature Section Lacks Concrete Verification Steps

**Issue**: Lines 118–122 describe the application webhook signature verification:

```
Signature verification:
- Header: X-Signature-Ed25519
- Header: X-Signature-Timestamp
- Algorithm: Ed25519
```

This is accurate for Discord's application webhooks (APPLICATION_AUTHORIZED, ENTITLEMENT_CREATE events). However, the section stops at listing the headers without explaining how to verify the signature or providing the replay protection threshold.

**Why it matters**: Ed25519 signature verification is non-trivial to implement correctly. A reader implementing this from scratch will need to know:
- The signature is over `X-Signature-Timestamp + rawRequestBody` (concatenated as bytes).
- The timestamp must be checked against the current time (replay protection window, typically 15 minutes).
- The signature is a 64-byte Ed25519 signature decoded from hex.

Without this, implementers will either skip verification entirely or implement it incorrectly, creating an auth bypass vector.

**Correction**: Expand lines 118–122 to:

```
Signature verification (Ed25519):
- Header: X-Signature-Ed25519 — 128-character hex-encoded Ed25519 signature
- Header: X-Signature-Timestamp — Unix timestamp string of the request
- Algorithm: Ed25519 (Ed25519ph variant)

Verification steps:
1. Extract X-Signature-Timestamp (string) and X-Signature-Ed25519 (hex bytes).
2. Compute: payload = X-Signature-Timestamp + rawRequestBody (UTF-8 bytes concatenated).
3. Verify Ed25519 signature over payload using the application's public key from
   the Developer Portal → General Information → Application Public Key.
4. Replay protection: reject if |current_time - timestamp| > 15 minutes.
5. Reject if signature verification fails.

Note: Discord uses Ed25519, not HMAC-SHA256. Do not confuse this with Slack's
webhook signature scheme.
```

---

### 3. Incoming Webhook Token Classification Missing

**Issue**: Line 72 mentions "Webhook tokens" as a separate mechanism but does not classify them:

```
**Webhook tokens** | Posting as incoming webhook | Separate from bot auth; `webhook.incoming` scope
```

**Why it matters**: Incoming webhooks have a distinct token embedded in the URL (`https://discord.com/api/webhooks/{webhook_id}/{webhook_token}`). This token is not a Bearer or Bot token — it is a standalone credential that grants posting access to one specific channel without any bot permissions. The document does not warn that:
- The incoming webhook token is part of the URL path (not a header).
- It cannot be rotated programmatically; regeneration is via the UI.
- It is scoped to one channel only.

A connector implementation could misuse this by treating it like a bot token or storing it with the wrong secret type.

**Correction**: Add a dedicated subsection for incoming webhooks:

```
### Incoming Webhook Token

| Aspect | Detail |
|--------|--------|
| **How to obtain** | Create incoming webhook in channel settings → Copy Webhook URL |
| **Token location** | Part of the webhook URL path: `/api/webhooks/{id}/{token}` |
| **Authorization** | None required — the URL itself is the credential |
| **Scope** | Posting to exactly one channel |
| **Limitations** | Cannot read messages; cannot use for intake; cannot be rotated programmatically |
| **Lifetime** | Permanent until regenerated via UI |
| **Secret type** | `api_key` (treat as sensitive as a bot token) |

**Note**: Incoming webhooks are outbound-only (SupportAgent → Discord). They cannot be used for
reading or monitoring messages. For the MVP, incoming webhooks are not used.
```

---

### 4. Multi-Tenant Architecture for Discord Is Underspecified

**Issue**: The document does not discuss multi-tenant OAuth app architecture. Discord supports a single bot app being added to multiple guilds (servers) by different tenants. The "How to obtain" section describes the bot token flow as if it is a single-tenant setup.

**Why it matters**: For SupportAgent multi-tenant deployments, each tenant's Discord server requires the bot to be added to that server. Discord's bot install flow uses an OAuth authorization URL that directs each tenant's server admin to grant the bot access. A single bot token serves all tenants; tenant isolation is achieved by guild ID (server ID) routing. The document should state this explicitly so implementers understand the multi-tenant model.

**Correction**: Add under Section 2 (Authentication):

```
### Multi-Tenant Architecture

Discord bots use a **single app, single bot token** model:
- One bot app registered in the Discord Developer Portal.
- One bot token (created from the Bot section) serves all tenants.
- Each tenant adds the bot to their own guild (server) via an authorization URL:
  `https://discord.com/api/oauth2/authorize?client_id={app_id}&permissions={perm_int}&scope=bot`
- Tenant isolation is by `guild_id` (the Discord server ID). Store `{ guild_id: config }` per tenant.
- The bot token is stored once; the auth URL is tenant-specific.

This differs from platforms with per-tenant app credentials. No additional bot tokens are needed
as tenants scale.
```

---

### 5. Authorization Header: `Bot <token>` Is Correct, `Bearer <token>` Is Not Supported

**Issue**: Line 20 states:

```
**Header** | `Authorization: Bot <token>` or `Authorization: Bearer <token>`
```

Discord's REST API only accepts `Authorization: Bot <token>`. The `Bearer` prefix is **not** supported for bot tokens.

**Why it matters**: If a developer sends `Authorization: Bearer <token>` to Discord's REST API, they will receive a 401. The document currently allows both, which could lead to a subtle auth failure. The `Bearer` prefix appears in Discord's OAuth2 token responses (`token_type: "Bearer"`) for user-level OAuth tokens (obtained via the OAuth authorization code flow). Bot tokens obtained from the Developer Portal are only valid with the `Bot` prefix.

**Correction**: Replace line 20 with:

```
**Header**: `Authorization: Bot <token>`
```

And add a clarifying note:

```
Note: Discord's REST API only accepts the "Bot" prefix for bot tokens obtained from the
Developer Portal. Discord OAuth2 access tokens (user-level, obtained via the authorization
code flow) use "Bearer" — but user-level OAuth tokens have different capabilities and are
not used for the MVP bot-intake pattern.
```

---

### 6. No Deprecated Auth Methods

**Verified**: Discord's bot token mechanism is current and supported. The document does not list any deprecated methods. Discord has not deprecated bot tokens, the Gateway WebSocket connection, or Ed25519 signature verification — all are actively maintained.

The OAuth2 Implicit Grant (returning tokens via URL fragment) is documented in Discord's OAuth2 spec but is not mentioned in the connector doc. This is acceptable since the Implicit Grant is not relevant to the SupportAgent use case (server-side bot token management).

---

### 7. Missing Secret Type Annotations

**Issue**: The connector config fields (Section 11, lines 556–559) list:

```
Config fields required:
- Bot token
- Guild ID(s) to monitor
- Channel ID(s) to watch
- Bot's own user ID (for no_self_retrigger)
```

These are not annotated with `secretType` values for the platform registry.

**Why it matters**: Before the Discord connector is registered in `packages/contracts/src/platform-registry.ts`, the config fields need `secretType` assignments consistent with the registry schema.

**Correction**: Add annotations:

```typescript
// Config fields with secretType for platform-registry:
{ key: 'botToken', secretType: 'api_key' },
{ key: 'guildIds', secretType: null },       // not a secret
{ key: 'channelIds', secretType: null },     // not a secret
{ key: 'botUserId', secretType: null },     // not a secret
// Incoming webhook tokens (if used for outbound):
{ key: 'webhookToken', secretType: 'api_key' },
```

---

## Summary

| # | Finding | Severity | Change |
|---|---------|----------|--------|
| 1 | Permission bit values: `READ_MESSAGE_HISTORY` wrong, `SEND_MESSAGES_IN_THREADS` missing | High | Fix to `1 << 16` and add `1 << 38` |
| 2 | Webhook Ed25519 verification lacks implementation steps | Medium | Add verification algorithm, replay window |
| 3 | Incoming webhook token not classified | Medium | Add table with URL token format, channel-only scope |
| 4 | Multi-tenant architecture not described | Medium | Add single-app / per-guild routing model |
| 5 | `Bearer <token>` header is not valid for bot tokens | Medium | Remove `Bearer` from header; clarify user vs. bot token distinction |
| 7 | Config fields lack `secretType` annotations | Low | Annotate before platform-registry registration |

**No deprecated auth methods detected.** Discord's current auth mechanisms (bot token, OAuth2 authorization code, client credentials) are all active. No corrections needed for freshness.