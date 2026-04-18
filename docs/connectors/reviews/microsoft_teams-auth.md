# Microsoft Teams Connector — Authentication & Credentials Review

**Reviewer:** Claude auth audit
**Source:** `docs/connectors/microsoft_teams.md`
**Scope:** Authentication mechanisms, token transport, scopes, lifetimes, webhook verification, multi-tenant OAuth, secret classification, MVP justification

---

## Verdict

**REJECT — significant authentication errors.** Two critical bugs would cause outbound proactive messaging to fail entirely (wrong Bot Framework scope) and incoming bot webhooks to fail validation (wrong header name). Several scope classifications are incorrect, and token lifetimes are imprecise.

---

## Findings

### Finding 1 — CRITICAL: Wrong scope in Bot Framework token request

**Location:** `microsoft_teams.md:106`
**Current:**
```
scope=https://graph.microsoft.com/.default
```

**Required:**
```
scope=https://api.botframework.com/.default
```

**Why it matters:** The scope in an OAuth2 client credentials request determines the audience of the issued token. `https://graph.microsoft.com/.default` produces a token valid for Microsoft Graph API. `https://api.botframework.com/.default` produces a token valid for the Bot Connector service (`smba.trafficmanager.net`). Using the Graph scope in a Bot Framework token request yields a token that cannot be used to send proactive messages via Bot Framework — every outbound send would fail with 401/403. This is not a minor inaccuracy; it makes the documented outbound path completely non-functional.

**Note:** The document's Gotcha #8 (line 553) correctly identifies that "Bot Framework token is separate from Graph token" but the actual token request body on line 106 still uses the Graph scope — a direct contradiction within the same document.

**Concrete correction:** Change line 106 scope to `https://api.botframework.com/.default`. Keep Gotcha #8 as-is.

---

### Finding 2 — CRITICAL: Wrong header name for Bot Framework webhook verification

**Location:** `microsoft_teams.md:221`
**Current:**
> Header name: `Authorization` with value `Bearer {channel token}` — but the actual validation uses the request body HMAC against the bot secret, not a JWT.

**Why it's wrong:** This sentence is self-contradicting (Bearer header + HMAC body) and both parts are wrong for incoming Bot Framework webhooks. The actual mechanism is:

- **Header:** `MS-ChannelToken` (not `Authorization`)
- **Value:** `base64(HMAC-SHA256(raw_request_body_bytes, bot_secret))`

**Why it matters:** If implemented as documented, the connector would either look for a `Bearer` token that doesn't exist on incoming Bot Framework webhooks, or fail to validate the HMAC because the wrong header is being read. Incoming bot messages would be silently rejected or require disabled validation.

**Concrete correction:** Replace the description at lines 221-222 with:
> Incoming Bot Framework webhooks use `MS-ChannelToken` header. The value is a Base64-encoded HMAC-SHA256 of the raw request body bytes, computed using the bot's Bot Channels Registration secret. To validate: extract `MS-ChannelToken`, compute HMAC-SHA256 of the raw body, Base64-encode, and compare with constant-time comparison. Use the bot secret (not the Azure AD client secret).

---

### Finding 3 — MEDIUM: Incorrect permission classification — `ChannelMessage.Send` listed as application permission

**Location:** `microsoft_teams.md:87`
**Current table entry:**
| Post to channel | `ChannelMessage.Send` |

**Why it's wrong:** `ChannelMessage.Send` is **delegated-only**. There is no application (app-only) variant. The Graph API v1.0 [`POST /teams/{team-id}/channels/{channel-id}/messages`](https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0) endpoint's permission table lists only:
- Delegated (work/school): `ChannelMessage.Send`
- Application: `Teamwork.Migrate.All` (migration scenarios only, not general messaging)

Listing `ChannelMessage.Send` in the application-permission column implies the connector can send channel messages using client credentials auth — which it cannot.

**Why it matters:** The downstream sections (2.5 MVP recommendation, 4.1 Post Message to Channel, Gotcha #1) all correctly state that app-only messaging is blocked in Graph v1.0. The table at 2.3 contradicts these by showing a permission that doesn't exist for application auth. This creates confusion about whether the documented approach can actually send messages.

**Concrete correction:** In the section 2.3 table, change the "Post to channel" entry to show `Teamwork.Migrate.All` (app, migration-only) or remove it from the application column entirely. Add a note: "App-only message sending requires `Teamwork.Migrate.All` (migration only) — for normal messaging use Bot Framework."

---

### Finding 4 — MEDIUM: Bot Framework token lifetime imprecise

**Location:** `microsoft_teams.md:107`
**Current:**
> Bot tokens expire in ~60 minutes

**Required:**
> Bot tokens expire in 3600 seconds (exactly 1 hour); `ext_expires_in` is also 3600.

**Why it matters:** "60 minutes" is an informal approximation. "3600 seconds" is the exact value returned by the Bot Framework token endpoint (`"expires_in": 3600`). If the connector implements a token cache with a hardcoded expiry assumption, a 1-second difference matters for edge-case renewal timing.

**Concrete correction:** Change "~60 minutes" to "3600 seconds (exactly 1 hour)".

---

### Finding 5 — LOW: Graph API token lifetime imprecise

**Location:** `microsoft_teams.md:64`
**Current:**
```json
"expires_in": 3599,
```

**Required:** `3600`

**Why it matters:** Graph API access tokens expire in 3600 seconds, not 3599. Minor typo, but would mislead anyone copying the example response for testing.

**Concrete correction:** Change `3599` to `3600`.

---

### Finding 6 — LOW: `clientState` is not a cryptographic signature — document implies otherwise

**Location:** `microsoft_teams.md:144` (also relevant: line 545 in Gotchas)

**Current:** The description of Graph webhook validation uses "validate" and "clientState" language without distinguishing this from cryptographic signature verification.

**Why it matters:** `clientState` is a plain-text shared string echoed back in notifications. It provides no cryptographic integrity guarantee — if an attacker obtains the string, they can craft valid webhook payloads. There is no replay protection built in. This is distinct from HMAC-signed webhooks (e.g., GitHub's `X-Hub-Signature-256`). The document correctly notes this in Gotcha #4 but the main body description does not make the distinction clear.

**Concrete correction:** In section 3.1, add a note after the delivery validation description: "`clientState` is a plain-text shared string, not a cryptographic signature. It verifies that the sender knows the configured string but does not protect against tampering or replay. Implement replay protection by tracking seen `subscriptionId` + delivery `sequenceNumber` combinations."

---

### Finding 7 — LOW: MVP recommendation omits admin consent friction

**Location:** `microsoft_teams.md:46`
**Current:**
> Multi-tenant with admin consent. Each tenant admin grants consent once; the connector then acquires tokens per-tenant.

**Why it matters:** Admin consent is a non-trivial hurdle — a tenant admin must be identified, must trust the app publisher, and must complete the Azure portal consent flow. This is not "grant once, done" friction-free. The MVP recommendation presents this as straightforward without flagging the operational burden for multi-tenant deployments.

**Concrete correction:** Add to the MVP recommendation: "Note: Multi-tenant admin consent requires a tenant administrator to explicitly grant consent to all application permissions in Azure portal. For self-hosted deployments, each customer tenant admin must perform this step. Document the admin consent URL in the setup guide (`https://login.microsoftonline.com/{tenantId}/adminconsent?client_id={appId}`)."

---

## Summary Table

| Severity | Location | Issue |
|---|---|---|
| CRITICAL | §2.2 Bot token request, line 106 | Wrong OAuth scope — would break all proactive sends |
| CRITICAL | §3.2 Bot webhook, line 221 | Wrong header name (`Authorization` vs `MS-ChannelToken`); self-contradicting description |
| MEDIUM | §2.3 permissions table, line 87 | `ChannelMessage.Send` listed as app permission — does not exist for app-only auth |
| MEDIUM | §2.2 Bot token, line 107 | Token lifetime "~60 minutes" imprecise; should be 3600 seconds |
| LOW | §2.2 Graph token example, line 64 | `expires_in: 3599` should be `3600` |
| LOW | §3.1 webhook validation, line 144 | `clientState` described as "validate" without distinguishing from cryptographic signatures |
| LOW | §2.1 multi-tenant, line 46 | Admin consent friction not flagged in MVP recommendation |
