# Linear Connector — Auth & Credentials Review

**Verdict: APPROVED WITH FIXES — 9 findings (3 critical, 4 moderate, 2 informational)**

---

## Critical Findings

### 1. OAuth Scopes Are Wrong

**Issue:** The scope list in §2 is fabricated. Linear does not have scopes named `comments`, `issues`, `projects`, `teams`, or `users`.

**Actual Linear scopes:**
- `read` — default, read access
- `write` — write access
- `issues:create` — create issues and attachments
- `comments:create` — create issue comments
- `timeSchedule:write` — create/modify time schedules
- `admin` — full admin (use sparingly)
- Agent-specific: `app:assignable`, `app:mentionable`

**Why it matters:** Anyone following this doc to configure OAuth would request non-existent scopes and get unexpected permission errors or fall back to the default `read` scope.

**Correction:** Replace the scope table in §2 with the correct scopes above. For MVP read operations, `read` is sufficient. For write operations, `write` is the correct scope (Linear does not expose granular write scopes beyond `issues:create` and `comments:create`).

---

### 2. Webhook Signature Header Name Is Wrong

**Issue:** The doc states the header is `linear-signature`. Linear's actual header is `Linear-Signature` (mixed-case, with capital S).

**Why it matters:** Signature verification will silently fail (no match) if using the wrong header name, causing all webhook events to be rejected or bypassed.

**Correction:** Update §3 "Signature Verification" header line to:
```
- **Header**: `Linear-Signature` — HMAC-SHA256 hex digest of raw request body
```

---

### 3. Webhook Timestamp Is Not a Header

**Issue:** The doc states the timestamp is in header `linear-timestamp`. It is actually a JSON field `webhookTimestamp` inside the request body.

**Why it matters:** Code looking for a `linear-timestamp` header will never find it, and replay protection will silently never engage.

**Correction:** Update §3 to:
```
- **Timestamp field**: `webhookTimestamp` in the JSON payload — Unix milliseconds; used for replay-attack prevention
```
Remove reference to `LINEAR_WEBHOOK_TS_HEADER` entirely. The SDK exposes this as `LINEAR_WEBHOOK_TS_FIELD`, not a header.

---

## Moderate Findings

### 4. OAuth Token Lifetime Is Vague

**Issue:** The doc says access tokens are "short-lived, hours." Linear's actual access token lifetime is **24 hours (86,399 seconds)**. Client credentials tokens last **30 days (2,591,999 seconds)**.

**Why it matters:** Implementers cannot set appropriate refresh timers without knowing the actual lifetime.

**Correction:** Update §2 Mechanism 2:
```
- Returns an `accessToken` (valid 24 hours) + optional `refreshToken`
- Client credentials token: valid 30 days; note: multiple credentials invalidate the previous one
```

---

### 5. Client Credentials Flow Is Missing

**Issue:** Linear supports Client Credentials OAuth (service accounts / agent identity) with a toggle in app settings. The doc only covers the authorization code flow.

**Why it matters:** Client credentials is the correct pattern for service-to-service / agent automation without a human delegating access. Without it, implementers may incorrectly use PATs or authorization code flows for server-side agents.

**Correction:** Add a third mechanism to §2:
```
### Mechanism 3: OAuth 2.0 Client Credentials

- Requires "Enable Client Credentials" toggle in OAuth app settings
- Token endpoint: `POST https://api.linear.app/oauth/token`
- Grant type: `client_credentials`
- Authentication: `Authorization: Basic <base64(client_id:client_secret)>`
- Token lifetime: 30 days
- **Important**: Each new token invalidates the previous one; rotating the client secret invalidates all active tokens
- Accesses all public teams by default (no per-team grants)
- Use for server-side agents and service accounts — no user delegation needed
```

---

### 6. OAuth Missing CSRF State and PKCE

**Issue:** The doc describes OAuth as "standard authorization code flow; callback URL must be registered" but omits the `state` parameter for CSRF protection and PKCE (`code_challenge` / `code_challenge_method`).

**Why it matters:** Without `state`, the flow is vulnerable to CSRF attacks. Without PKCE, the authorization code can be intercepted. Linear's SDK and docs recommend PKCE.

**Correction:** Add to §2 Mechanism 2:
```
- Include `state` parameter for CSRF protection (validate on callback)
- PKCE is supported: pass `code_challenge` and `code_challenge_method=S256` on authorize, then `code_verifier` on token exchange
```

---

### 7. Actor Types Not Explained

**Issue:** The doc mentions "app user token tied to a bot/app identity" but does not explain Linear's actor system — `actor=user` (default, actions as the authorizing human) vs `actor=app` (actions as the application).

**Why it matters:** For agent use cases, actions should appear as the app, not the human who authorized OAuth. Without `actor=app` in mutations, comments and issues appear to come from the human user.

**Correction:** Add after §2 Mechanism 2:
```
### Actor Selection in Mutations

OAuth tokens default to `actor=user` (actions attributed to the authorizing user). For agent/service behavior, use `actor=app` in mutation input:
```json
{ "input": { "actor": "app", "teamId": "...", "title": "..." } }
```
The resulting issue/comment will show the app's bot identity (`botActor`) rather than the user's identity.
```

---

### 8. Multi-Tenant OAuth Complexity Understated

**Issue:** The doc says "use for multi-tenant / user-delegated flows" but does not mention that each tenant workspace requires its own OAuth app registration, and only workspace admins can create OAuth apps.

**Why it matters:** For multi-tenant deployment, each tenant must create and configure an OAuth app in their Linear workspace. This is a significant onboarding burden not present with PATs.

**Correction:** Update §2:
```
- **Use for multi-tenant / user-delegated flows** — each tenant workspace requires its own OAuth app registered by a workspace admin
- **Setup overhead**: Only workspace admins can register OAuth apps. Each tenant must create their own app, generate a client ID/secret, and authorize. Consider PATs for simpler single-workspace deployments.
```

---

## Informational Findings

### 9. Platform Registry Missing OAuth Fields

**Issue:** The platform-registry declares `supportsOAuth: true` for Linear, but the connector config in §11 only lists `LINEAR_API_KEY` as required. No OAuth client ID, client secret, or redirect URI fields.

**Why it matters:** If SupportAgent claims to support OAuth for Linear, the admin panel must surface the necessary OAuth fields. Currently only PAT is actually configurable.

**Correction:** Either add OAuth config fields (`oauth_client_id`, `oauth_client_secret`, `oauth_redirect_uri`) to the platform-registry, or update the design doc to explicitly scope Linear MVP to PAT-only and update `supportsOAuth: false` in the registry until OAuth is implemented.

---

## Verified Correct

- PAT header: `Authorization: Bearer <token>` — correct
- PAT location: Settings → Account → Security → API Keys — correct
- PAT lifetime: indefinite until revoked — correct
- PAT scope: workspace-level, inherits user permissions — correct
- SDK usage patterns with `apiKey` and `accessToken` — correct
- Webhook HMAC-SHA256 algorithm — correct
- Webhook 60-second timestamp tolerance — correct
- Webhook `LinearWebhookClient` from `@linear/sdk/webhooks` — correct
- Required scope `write` for webhook registration — correct
- OAuth app requires workspace admin to register — correct
