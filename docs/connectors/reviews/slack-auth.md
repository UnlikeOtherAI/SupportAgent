# Slack Connector Auth Review

**Verdict: APPROVED WITH CORRECTIONS** — The auth section is broadly accurate but contains 7 issues that could lead to implementation errors or outdated guidance.

---

## Findings

### 1. Token Rotation: Access Token Prefix After Exchange Is Wrong

**Issue:** Lines 70–73 describe rotated tokens as inheriting the original prefix.

**Why it matters:** After calling `oauth.v2.exchange`, the access token prefix changes from `xoxb-` to `xoxe.xoxb-` (e.g., `xoxe.xoxb-1-...`). Continuing to treat it as `xoxb-` will break token validation, storage lookups, and type detection.

**Correction:** Replace line 72 with:
```
Access tokens after rotation use xoxe.xoxb-* (bot) or xoxe.xoxp-* (user) prefix.
Refresh tokens use xoxe-r-* prefix.
```

---

### 2. Token Rotation: Refresh Endpoint Is Wrong

**Issue:** Line 73 states:
```
Refresh via POST /api/oauth.v2.access with grant_type=refresh_token
```

**Why it matters:** `oauth.v2.access` is the **initial OAuth exchange** endpoint. The token rotation flow uses a two-step process: (1) `oauth.v2.exchange` converts a long-lived token into a refresh/expiring pair, then (2) `oauth.v2.access` with `grant_type=refresh_token` handles subsequent refreshes. Calling `oauth.v2.access` with just the refresh token on a fresh install will fail.

**Correction:** Replace line 73 with:
```
First exchange: POST /api/oauth.v2.exchange with client_id, client_secret, token (long-lived)
Subsequent refreshes: POST /api/oauth.v2.access with grant_type=refresh_token, refresh_token
```

---

### 3. Missing Token Types

**Issue:** The token type table (lines 40–46) omits workflow tokens and configuration tokens.

**Why it matters:** Workflow tokens (`xwfp-*`) are a distinct category — they expire in 15 minutes and cannot be refreshed. A connector that accidentally receives a workflow token instead of a bot token would fail silently. Configuration tokens are generated per-workspace from app settings and are used for App Manifest API calls.

**Correction:** Add to the token type table:

| Token Prefix | Type | Scope | Lifetime |
|-------------|------|-------|----------|
| `xwfp-` | Workflow token | Subset of bot | 15 min or step completion; non-refreshable |
| — | Configuration token | App manifest APIs only | Per-workspace; from app settings |

---

### 4. Enterprise Grid Token (`xoxe-`) Unverified

**Issue:** Line 44 claims:
```
xoxe- | Enterprise token | Org-wide access | Only on Enterprise Grid; xoxe-r- for refresh tokens
```

**Why it matters:** The current Slack documentation (docs.slack.dev/authentication/tokens) lists `xoxb-`, `xwfp-`, `xoxp-`, `xapp-` as token prefixes. `xoxe-` does not appear in the current token type reference. The rotated refresh token format is `xoxe-r-*` but this appears only in the rotation guide, not in the token types reference. The document may be describing a deprecated or Enterprise-only internal format that is no longer documented.

**Correction:** Either (a) remove the `xoxe-` entry and note "Enterprise Grid org tokens are an internal Salesforce/Enterprise feature not covered in public API docs", or (b) flag it as `[verify with Enterprise Grid docs]` and provide the actual prefix as confirmed by the Enterprise-specific authentication reference. Do not present it as a standard public token type.

---

### 5. OAuth Scopes: Granular vs. Legacy Ambiguity

**Issue:** The scope table (lines 77–90) uses only legacy scope names (e.g., `chat:write`, `channels:history`). Slack now documents granular scopes with `bot.` and `user.` prefixes (e.g., `chat:write` is the legacy form; the granular equivalent is not a simple rename but a new scoping model).

**Why it matters:** The document states `"token_rotation_enabled": true` in the manifest, which requires the OAuth V2 granular permission model. Legacy scopes still work with granular tokens but are no longer recommended. Using the table as-is for a fresh app manifest would generate invalid or deprecated scope declarations.

**Correction:** Add a note after the scope table:
```
Note: Scopes above are in legacy format. Modern Slack apps use granular scopes
(bot.*, user.* namespaces). When creating an app manifest, prefer granular scopes
if your SDK or distribution path supports them. Legacy scopes remain valid.
```

---

### 6. Missing Granular Scope Mapping for MVP Operations

**Issue:** The MVP connector scope (lines 436–441 in Section 11) lists API methods but never maps them to the granular scopes required under the modern token model.

**Why it matters:** The MVP recommends bot tokens with OAuth but does not specify which granular scopes to request. A developer implementing this by copy-pasting the method list would not know which scopes to declare in the app manifest.

**Correction:** Add granular scope recommendations to the MVP config fields:
```
Required bot scopes (granular):
  chat:write — postMessage, update, delete
  channels:history — conversations.history (public channels)
  groups:history — conversations.history (private channels)
  im:history — conversations.history (DMs)
  mpim:history — conversations.history (group DMs)
  users:read — users.list, users.info
  reactions:write — reactions.add, reactions.remove
  files:write — files.uploadV2
```

---

### 7. Multi-Workspace: Single App Architecture Not Stated

**Issue:** The OAuth 2.0 Flow section (lines 56–66) describes the multi-workspace OAuth sequence but never explicitly states that Slack supports a single app serving multiple workspaces via the standard OAuth install flow.

**Why it matters:** Section 13 (Open Questions, line 516) flags "single vs multi-workspace: need OAuth for Enterprise Grid?" as unresolved. Slack's standard OAuth V2 install flow already handles multi-workspace: each workspace installs the app independently and generates its own token pair stored with `team_id`. This is not an "Enterprise Grid" feature — it works on free/pro workspaces. The open question misleads implementers into thinking multi-workspace requires a different architecture.

**Correction:** Replace line 516 with:
```
Multi-workspace: Supported via standard OAuth V2. Each workspace installs the app;
tokens are stored keyed by team_id. Single app serves all tenants.
Enterprise Grid adds org-scoped tokens (xoxe-*) and org-wide app distribution.
```

---

### 8. No Security Gap: Webhook Signature Verification Is Correct

**Verified:** The HMAC SHA256 implementation (lines 122–147) matches the official spec:
- Header names: `X-Slack-Signature` and `X-Slack-Request-Timestamp` ✓
- Timestamp window: 5 minutes (300 seconds) ✓
- HMAC base string: `v0:{timestamp}:{rawBody}` ✓
- Constant-time comparison ✓

No corrections needed.

---

### 9. No Security Gap: Bearer Token Header Is Correct

**Verified:** Line 95 shows `Authorization: Bearer <token>` — this is the Slack API standard. ✓

---

### 10. Secret Type Consistency

**Note:** The platform-registry does not yet include a Slack entry. The connector config (lines 452–463) defines `botToken` and `signingSecret` but does not annotate them with `secretType`. Before the Slack connector is registered in `packages/contracts/src/platform-registry.ts`, assign:

```typescript
{ key: 'botToken', secretType: 'api_key' },
{ key: 'signingSecret', secretType: 'webhook_secret' },
```

---

## Summary of Corrections

| # | Section | Priority | Change |
|---|---------|----------|--------|
| 1 | Token Rotation | High | Access token prefix changes to `xoxe.xoxb-*` after exchange |
| 2 | Token Rotation | High | `oauth.v2.exchange` is first step; `oauth.v2.access` for refreshes |
| 3 | Token Types | Medium | Add workflow (`xwfp-*`) and configuration tokens |
| 4 | Token Types | Medium | Verify or remove `xoxe-` entry — not in public token reference |
| 5 | Scopes | Medium | Add note about legacy vs. granular scope distinction |
| 6 | MVP Config | Medium | Map MVP methods to granular scope declarations |
| 7 | Multi-Workspace | Medium | Clarify standard OAuth V2 is multi-workspace by default |
| 10 | Registry | Low | Annotate config fields with `secretType` before platform registry entry |
