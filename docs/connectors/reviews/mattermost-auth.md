# Mattermost Connector — Auth Audit

**Verdict: Condition with corrections required.** The document correctly identifies bot accounts as the primary mechanism and the Bearer token pattern. However, three substantive auth issues and several accuracy gaps must be addressed before this can guide implementation.

---

## Findings

### 1. Outgoing webhook has no cryptographic signature — missing security warning

**Issue**: Section 3 (Webhook / Signature Verification) states "No HMAC signature — token is the verification mechanism." This is accurate but incomplete. The document does not warn that the webhook token is transmitted as a plain form parameter (`token={webhook_token}`) with no HMAC, no timestamp, and no replay protection.

**Why it matters**: Any party who obtains the webhook token (e.g., from logs, config leaks, or a man-in-the-middle) can forge inbound events to SupportAgent, causing false intake, comment injection, or DoS. The current description gives no signal that inbound webhook validation requires additional safeguards (token rotation, IP allowlisting, or pairing with an HMAC mechanism the connector must enforce externally).

**Concrete correction**: Add a security note in the signature section:

```
Outgoing webhook verification is token-only — no HMAC or timestamp.
The token is transmitted as a plain form parameter (application/x-www-form-urlencoded).
This means:
- Any recipient of the token can forge events.
- There is no replay protection (no sequence number or timestamp).
- The token cannot be rotated programmatically — must be regenerated via the UI/API.
Mitigation: store the token with the same sensitivity as a password; enforce TLS; consider
IP allowlisting on the receiving endpoint.
```

---

### 2. Bot token lifecycle is misdescribed — creates ambiguity between bot account and bot token

**Issue**: Mechanism 4 ("Bot Account / Recommended") describes bot account creation via `POST /api/v4/bots` and says the bot uses `Authorization: Bearer {bot_user_token}`. It conflates bot account creation with token generation. It does not explain that a bot account is a user identity and that you must separately generate a user access token for that bot user before you can make API calls.

**Why it matters**: A reader following this doc will create a bot account and try to use a bot "token" — which does not exist as a distinct resource. The bot account is just a user with a `bot` flag. The actual bearer token is a user access token scoped to the bot user. This is a source of real integration failures.

**Concrete correction**: Split Mechanism 4 into two sub-steps:

```
### Mechanism 4: Bot Account + Bot User Access Token

**Step 1 — Create bot account**: `POST /api/v4/bots`
Requires: system admin permission.
Response: { "user_id": "bot_id", "username": "support-agent", ... }

**Step 2 — Generate token for the bot user** (NOT a separate bot token):
`POST /api/v4/users/{bot_user_id}/tokens`
Requires: 'create_user_access_token' permission (system admin).
Body: { "description": "Support Agent bot token" }
Response: { "token": "26-char-token-value", "user_id": "bot_user_id" }

**Header**: `Authorization: Bearer {bot_user_access_token}`
This is a user access token for the bot user — same format as Mechanism 2.
```

The MVP recommendation at line 106 should also reference `POST /api/v4/users/{bot_user_id}/tokens` as an additional step, not just `POST /api/v4/bots`.

---

### 3. User access token endpoint is missing required POST body field

**Issue**: Mechanism 2 states the endpoint is `POST /api/v4/users/{user_id}/tokens` but does not document the required request body. The Go SDK shows the endpoint requires a JSON body with a `description` field (non-blank).

**Why it matters**: An integrator following this doc will make a request without a description and get a 400. This is an incomplete API reference.

**Concrete correction**: Update Mechanism 2:

```
- **Endpoint**: `POST /api/v4/users/{user_id}/tokens`
- **Header**: `Authorization: Bearer {admin_or_self_token}` (caller must have 'create_user_access_token' permission)
- **Body**: `{ "description": "Support Agent token" }` — non-blank description required
- **Response**: `{ "id": "token_id", "token": "26-char-token", "user_id": "user_id", "description": "..." }`
- **Token lifetime**: Persistent until revoked (26-char alphanumeric)
```

---

### 4. Session token description is misleading about header delivery

**Issue**: Mechanism 1 shows two code paths — Set-Cookie header `MMAUTHTOKEN` and `Authorization: Bearer {token}`. The comment implies both are valid alternatives. In practice, Mattermost returns the session token in the `Set-Cookie` header on login; the `Authorization: Bearer` header is typically used for re-authenticating an existing session via `POST /api/v4/users/{user_id}/tokens` or for token-based auth (not session-based).

**Why it matters**: Using session tokens in `Authorization: Bearer` is valid but the session token comes from the cookie. Describing both paths without this distinction could lead to confusion about which token to store and how to obtain it.

**Concrete correction**: Reframe Mechanism 1:

```
- **Obtain**: `POST /api/v4/users/login` with `{"login_id": "...", "password": "..."}`
- **Token delivery**: Session token returned in `Set-Cookie: MMAUTHTOKEN={token}; HttpOnly`
- **Bearer use**: The same token value can also be sent as `Authorization: Bearer {token}` for API calls.
  This is the typical pattern for non-browser clients.
- **Token lifetime**: Session-based; default 30 days (configurable via server setting).
```

---

### 5. OAuth 2.0 support is present in Mattermost but undocumented

**Issue**: The Go SDK (`server/public/model/oauth.go`, `oauth_dcr.go`) shows Mattermost supports:
- OAuth 2.0 Dynamic Client Registration (`POST /api/v4/oauth/register`)
- OAuthApp creation (`POST /api/v4/oauth/apps`)
- Token endpoint auth methods (client secret POST, none for public clients)
- Authorization code flow with `code_verifier` (PKCE) support
- Grant type validation in the model layer

The document does not mention OAuth 2.0 at all. It also sets `supportsOAuth: false` implicitly by not covering it.

**Why it matters**: For cloud-hosted multi-tenant scenarios, OAuth 2.0 would allow per-tenant authorization without sharing credentials. The document's MVP recommendation (bot account per tenant) is simpler but the trade-off should be explicit — OAuth requires redirect handling which is complex for CLI-style deployments; bot tokens are simpler but require admin-issued credentials.

**Concrete correction**: Add an OAuth section:

```
### Mechanism 5: OAuth 2.0 (Available for Mattermost Cloud and Enterprise)

Mattermost supports OAuth 2.0 with PKCE for integrations. It does not have a native
authorization server for third-party API delegation — OAuth here is for embedding
Mattermost in SSO flows (e.g., Mattermost as an OAuth provider to an external app),
not for authenticating as a Mattermost API client.

For SupportAgent, bot accounts + user access tokens remain the recommended approach.
OAuth 2.0 is available but the use case (acting as the Mattermost server for an external
IDP) does not align with SupportAgent's read/write API model.
```

This also resolves the platform-registry inconsistency: if the registry is extended with a Mattermost entry later, `supportsOAuth: true` would need justification.

---

### 6. Permission model table has accuracy gaps

**Issue**: The permission table (Section 2) lists operations but:
- "Manage bot accounts" requires system admin — not scoped to team admin. The document correctly notes this elsewhere but the table is the canonical auth reference.
- "Create incoming webhook" / "Create outgoing webhook" say "Manage webhooks (team admin)" — on self-hosted Enterprise this is team-scoped, but on Mattermost Cloud the webhook creation UI may be restricted further.
- The document does not mention that channel-level read/write is gated by team + channel membership, which is the actual permission boundary for the SupportAgent use case.

**Why it matters**: The permission table drives what roles the bot account needs. If a reader grants "team admin" expecting webhook creation, they may not realize the bot also needs channel membership for every monitored channel.

**Concrete correction**: Update the permission table:

| Operation | Required Permission |
|-----------|-------------------|
| Read channels | Team membership + Channel membership |
| Read posts | Team membership + Channel membership |
| Post to channel | Team membership + Channel membership |
| Create thread reply | Team membership + Channel membership |
| Create incoming webhook | Team admin + channel must be webhook-enabled |
| Create outgoing webhook | Team admin + channel must be webhook-enabled |
| Create slash commands | Team admin |
| Manage bot accounts | System admin only (not team-scoped) |

---

### 7. Multi-tenant guidance is underspecified

**Issue**: The recommendation says "Create a dedicated bot account per tenant" but does not address the team-silo problem: Mattermost teams are isolated silos. A bot added to Team A cannot read posts in Team B. Cross-team monitoring requires multiple bot tokens (one per team the bot is added to).

**Why it matters**: A multi-tenant SupportAgent deployment connecting to a Mattermost instance with multiple teams would appear to work with a single bot token but silently fail to monitor teams the bot was not added to.

**Concrete correction**: Add a note under the MVP recommendation:

```
Multi-team note: Mattermost teams are isolated. Bot membership is per-team.
If the tenant has multiple teams, a single bot account must be added to each team separately.
A separate bot token is not required, but channel membership must be granted in each team.
For cross-team support, the connector config should track { teamId: botToken }.
```

---

### 8. Token format stated incorrectly

**Issue**: The document does not specify the token format for user access tokens. The Go SDK (`user_access_token.go`) shows `IsValid()` enforces `len(t.Token) != 26` — user access tokens are exactly 26 characters.

**Why it matters**: Enables callers to validate tokens client-side before use and helps distinguish user access tokens from other token types.

**Concrete correction**: Add token format to Mechanisms 2 and 4:

```
- **Token format**: 26-character alphanumeric string (Base36-like, no hyphens)
  Example: `4ykj1tfwj1yuidqsj3tg1dxcsa`
- **Token lifetime**: Persistent until revoked; no expiry, no refresh
```

---

## Summary

| Finding | Severity | Fix required |
|---------|----------|--------------|
| No HMAC/replay protection on webhooks — missing security warning | High | Add security note with mitigations |
| Bot account vs. bot token conflated | High | Split into two sub-steps |
| User access token POST body not documented | Medium | Add required `description` field |
| Session token dual-delivery misleading | Medium | Clarify cookie vs. Bearer distinction |
| OAuth 2.0 support undocumented | Medium | Add OAuth section with context |
| Permission table incomplete | Medium | Fix scoping for bot/webhook perms |
| Multi-tenant team-silo not documented | Medium | Add cross-team bot guidance |
| Token format (26-char) not specified | Low | Add format to token mechanisms |

**No deprecated auth methods flagged** — the listed mechanisms (session login, user access tokens, bot accounts) are all current and supported as of Mattermost v10. The outgoing webhook deprecation noted in Section 10 is accurate but orthogonal to auth.
