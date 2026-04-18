# Trello Connector — Authentication Review

**Reviewer:** Claude Code
**Date:** 2026-04-18
**Scope:** Authentication and credentials (everything in Section 2 + webhook auth in Section 3)
**Source:** `docs/connectors/trello.md`

---

## Verdict: Needs Fixes

The document correctly identifies API key+token as the MVP approach and accurately covers token placement, expiration options, and the scope table. However, it contains two security-critical errors (webhook secret ambiguity, OAuth header description), one missing mechanism (Atlassian Connect / Forge JWT), and inconsistent naming between the main text and quick reference. These must be corrected before implementation.

---

## Findings

### 1. Webhook HMAC — App Secret vs Token Secret

**Location:** Lines 100-103, line 807 (Quick Reference)

**Claim:**
> "Algorithm: base64(HMAC-SHA1(appSecret, JSON.stringify(body) + callbackURL))"
> Quick Reference: "Webhook HMAC: base64(HMAC-SHA1(appSecret, body + callbackURL))"

**Issue: Ambiguous secret name**

`appSecret` is not defined anywhere in the document. The secret used for webhook HMAC verification is the **token secret**, not the API key secret. These are different values:

- **API secret** (from https://trello.com/app-key): used to generate request signatures and derive the token secret
- **Token secret**: returned alongside the token during the OAuth1 flow; also visible in the token URL when the user approves access

The document never mentions that a token secret exists, never defines `appSecret`, and never explains where to obtain it.

**Why it matters:** Implementers will search for "Trello app secret" and may incorrectly use the API secret from trello.com/app-key, producing invalid signatures and either rejecting valid webhooks or accepting forged ones.

**Concrete correction:**
```
HMAC verification:
- Header: X-Trello-Webhook
- Algorithm: base64(HMAC-SHA1(tokenSecret, callbackURL + JSON.stringify(body)))
- The tokenSecret is the secret associated with the token, NOT the API secret.
  It is returned during OAuth1 flow or visible in the token grant URL.
- Example: if the user visits trello.com/1/authorize?...&expiration=never&response_type=token&scope=read
  and approves, the redirect URL contains #token={longToken}&tokenSecret={tokenSecret}
```

---

### 2. OAuth Header Format — Describes OAuth1, Not OAuth2

**Location:** Lines 35-36

**Claim:**
> "OAuth header: `OAuth oauth_consumer_key="{apiKey}", oauth_token="{apiToken}"`"

**Issue: OAuth1 header described as general auth mechanism**

This is the OAuth1 1.0a signature format, not a bearer-style auth header. It is also not the recommended approach — Trello's documented auth is via query parameters. The OAuth1 header is rarely used in practice and is not the standard way to authenticate with the Trello API.

More critically, this header format implies that `oauth_token` is a bearer-style token, but in OAuth1 it is a signed request token. Mixing this into the description alongside query-param auth creates confusion about what mechanism is actually supported.

**Why it matters:** A developer reading this might attempt to use `Authorization: OAuth oauth_consumer_key="..."` with a long-lived token, which is not how Trello authentication works. Trello accepts either query params OR OAuth1 signed requests — they are separate mechanisms.

**Concrete correction:**
```
Remove the OAuth header line entirely, or move it to a note:
"Note: OAuth1 1.0a signed requests are supported as an alternative to query params.
The Authorization header uses the format: OAuth oauth_consumer_key="{apiKey}", oauth_token="{token}"
This requires signing the full request per OAuth1 spec — not recommended for MVP."
```

---

### 3. OAuth2 3LO — Missing `action:` Scopes

**Location:** Lines 51-54

**Claim:**
> "New scopes use `data` and `action` prefixes: `data:read`, `data:write`, `action:read`, `action:write`, `account:read`"

**Issue: `action:` scopes listed but never used in scope table**

Section 2.3 lists only `read` and `write` for all operations. The `action:read` and `action:write` scopes (which control action-level permissions like posting comments, adding labels) are never mapped to operations. An implementer using OAuth2 would have no way to know what scopes their token needs.

Furthermore, the relationship between legacy scopes (`read`/`write`) and OAuth2 scopes (`data:`/`action:`) is not explained. In Atlassian's OAuth2 model:
- `data:read` / `data:write` → Trello data (boards, cards, lists)
- `action:read` / `action:write` → performing actions (comments, votes, labels)

The scope table in Section 2.3 implies `write` is sufficient for posting comments, but in OAuth2, `action:write` is the correct scope.

**Why it matters:** If Phase 2 implements OAuth2, the scope table will give incorrect guidance. Tokens with only `data:write` but missing `action:write` will fail when posting comments.

**Concrete correction:**
```
In Section 2.3, add a column for OAuth2 scopes:

| Operation | Legacy scope | OAuth2 scope |
|-----------|-------------|--------------|
| Read boards/lists/cards | read | data:read |
| Read actions/comments | read | data:read |
| Post/edit/delete comments | write | action:write |
| Create/update/archive cards | write | data:write |
| Add/remove labels | write | action:write |
| Manage webhooks | write | data:write |

And add a note: "For OAuth2 3LO, both data:write AND action:write may be required
depending on operations performed. data:write covers card/list/board CRUD; action:write
covers comments, votes, labels, and member operations."
```

---

### 4. Missing: Atlassian Connect / Forge App Authentication

**Location:** Section 2 (not present)

**Issue: No mention of JWT-based app authentication**

The document only covers API key + token and briefly mentions OAuth2 3LO. It does not mention Atlassian Connect (JWT) or Forge app authentication, which are documented Atlassian mechanisms.

While the document correctly states (line 71) that Forge apps cannot access batch or webhook endpoints, it never explains what Forge/JWT auth looks like or why it is excluded. An implementer reviewing the design might wonder if Atlassian Connect is an option.

**Why it matters:** Low — the document correctly identifies API key + token as the right approach for this use case. But omitting this mechanism entirely could cause confusion if stakeholders ask about it.

**Concrete correction:**
```
Add to Section 2.5 (or end of Section 2):

### 2.5 Not Covered: Atlassian Connect / Forge JWT

Trello supports Atlassian Connect (Forge) apps with JWT authentication. This is NOT used
by SupportAgent because:
- Forge apps cannot access /1/batch or /webhooks/ endpoints
- Forge apps require the app to be installed per-workspace, not globally
- API key + token is simpler for external webhook-driven integrations

If Forge becomes relevant in the future: authentication uses `GET /1/tokens/{token}/webhooks`
with standard Forge request signing (JWT in Authorization header).
```

---

### 5. Multi-Tenant Architecture — Per-Tenant Token Model Not Explicit

**Location:** Line 47, Section 10.12

**Issue: MVP recommendation says "store per-tenant credentials" but doesn't justify why**

The document recommends per-tenant API keys + tokens but doesn't explain the multi-tenant auth model implications. Specifically:
- Does each tenant need their own Trello API key, or can one API key be shared with different tokens?
- If one API key is shared, does Atlassian rate-limit by API key or by token?
- Are there workspace-level permission implications?

From line 47: "Store per-tenant credentials." Section 10.12 confirms each tenant needs their own API key + token. But the rate limit table (line 524) shows separate limits for "per token" and "per API key," implying sharing is possible.

**Why it matters:** If tenants share one API key, the connector needs only one API key registration with Atlassian. If each tenant needs their own, the onboarding UX is more complex (each tenant must register an app at developer.atlassian.com).

Clarification: Trello allows one API key to be used across many tokens. Each token represents a user's authorization. The API key limit (300 req/10s) is shared; the token limit (100 req/10s) is per-token. So sharing one API key across tenants is valid but means the API key's rate limit bucket is shared.

**Concrete correction:**
```
In Section 2.1, add after MVP recommendation:

Multi-tenant note: One API key can be shared across all tenants. Each tenant authorizes
with their own token (per-user). Rate limits: 100 req/10s per token, 300 req/10s per API key.
If many tenants share one API key, consider spreading requests to avoid token-level throttling
(100 req/10s per token × N tokens is fine; hitting the shared 300 req/10s API key limit is not).
```

---

### 6. Webhook Registration Endpoint — Inconsistent Trailing Slash

**Location:** Lines 83-88, 106-108

**Claim:**
> "POST https://api.trello.com/1/tokens/{token}/webhooks/"
> "GET /1/tokens/{token}/webhooks/?..."
> "DELETE /1/webhooks/{id}/?"

**Issue: DELETE uses `/webhooks/{id}/` without tokens/{token} prefix**

Webhook deletion is `DELETE /1/webhooks/{webhookId}?key=...&token=...` (no `/tokens/{token}/` prefix). This is correct in the actual endpoint but inconsistent with the listing endpoint which uses the token-prefixed form. More importantly, line 108 shows a trailing `/` after `{id}` — this should not be there.

**Why it matters:** Low — DELETE with an extra trailing slash may or may not work depending on Trello's routing. Safer to not include it.

**Concrete correction:**
```
Line 108:
DELETE /1/webhooks/{id}/?key={apiKey}&token={apiToken}
     — remove trailing slash
```

---

### 7. OAuth2 Token Exchange — Missing Details for Phase 2

**Location:** Section 2.2

**Issue: OAuth2 3LO section is skeletal**

The OAuth2 section (Phase 2) lists scopes and a registration URL but omits:
- Token endpoint URL
- Authorization endpoint URL
- How the client ID / client secret are obtained
- Whether device flow is supported (Atlassian supports it)
- Refresh token behavior

If OAuth2 is ever implemented, this section is insufficient for an implementer.

**Why it matters:** Phase 2 implementer will have to go to Atlassian docs anyway. But noting the key gaps prevents false confidence.

**Concrete correction:**
```
Add to Section 2.2:
Token endpoint: https://auth.atlassian.com/oauth2/token
Authorization endpoint: https://auth.atlassian.com/authorize
Device flow: https://auth.atlassian.com/device/code (for CLI/headless scenarios)
No refresh tokens — use long-lived tokens (30days or never) instead.
```

---

### 8. Secret Type Classification — `appSecret` Undefined

**Location:** Line 705, Section 11.1

**Claim (admin panel config):**
> `apiKey` (string)
> `apiToken` (string, sensitive)

**Issue: No `webhookSecret` or `tokenSecret` field**

The webhook HMAC verification requires a secret, but the admin panel config only lists `apiKey` and `apiToken`. The token itself (`apiToken`) could serve as the HMAC secret, but this should be explicit. If the connector uses the token secret for HMAC, it is the same value as `apiToken` (they are the token secret for the given token).

Trello's token secret is the same string as the token itself when obtained via the simple token flow (trello.com/1/authorize with `response_type=token`). The token IS the secret.

**Why it matters:** An implementer might try to configure a separate `webhookSecret` field, not realizing the token is used for HMAC. Or they might skip HMAC verification entirely if they don't see where the secret comes from.

**Concrete correction:**
```
In admin panel config, clarify:
- `apiToken` (string, sensitive): also used as HMAC secret for webhook signature verification
- `webhookCallbackUrl` (string): must be set before webhooks can be registered

Note: The token secret used for HMAC verification is the same value as apiToken.
No separate webhook secret field is needed.
```

---

### 9. Label Remove Trigger — Type in Trigger Table

**Location:** Line 459

**Claim:**
> `removeLabelToCard` — missing `From`

**Issue: `removeLabelFromCard` is misspelled as `removeLabelToCard`**

In line 129-130, the correct name is used (`removeLabelFromCard`). In line 459, it is `removeLabelToCard`. This is a typo that will cause the trigger to never match.

**Concrete correction:**
```
Line 459:
| Label removed | action.type === "removeLabelFromCard" | — |   (not removeLabelToCard)
```

---

### 10. Token Expiration `never` — Verify It Still Works

**Location:** Line 45

**Claim:**
> Token expiration options: `1hour`, `1day`, `30days`, `never`

**Status: Likely accurate but verify**

`never` expiry was deprecated on some Atlassian platforms in recent years. Trello still supports it for API tokens (manual generation). OAuth2 tokens have different expiration rules.

**Why it matters:** If `never` has been deprecated or restricted, the MVP recommendation of "long-lived token (`never` expiry)" would need to change to `30days`.

**Concrete correction:**
```
Add footnote: "Verify that 'never' expiration is still available for manual tokens.
If restricted, use 30days and implement token rotation."
```

---

## Summary Table

| Area | Claim | Status | Correction |
|------|-------|--------|------------|
| Token placement (query params) | `?key=&token=` | ✅ Correct | — |
| OAuth1 header format | `OAuth oauth_consumer_key=...` | ⚠️ Misleading | Move to note, not primary mechanism |
| Webhook HMAC algorithm | base64(HMAC-SHA1(appSecret, body+URL)) | ❌ Ambiguous | Clarify: use token secret, not app secret |
| Webhook HMAC header | `X-Trello-Webhook` | ✅ Correct | — |
| Token expiration options | 1hour/1day/30days/never | ✅ Likely correct | Footnote: verify `never` still available |
| OAuth2 scopes (data/action) | Listed | ✅ Correct | — |
| Scope table (operations) | `read`/`write` only | ⚠️ Incomplete | Add OAuth2 scope column |
| Forge restrictions | Correct | ✅ Correct | — |
| Multi-tenant token model | "per-tenant credentials" | ⚠️ Ambiguous | Clarify: one API key, per-tenant tokens |
| DELETE webhook endpoint | Has trailing slash | ⚠️ Minor | Remove trailing slash |
| Token secret handling | Not defined | ❌ Missing | Document that token IS the HMAC secret |
| Atlassian Connect/JWT | Not covered | ⚠️ Gap | Add brief note on excluded mechanism |

---

## Sources

- [Trello REST API Authentication](https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/)
- [Atlassian OAuth2 3LO](https://developer.atlassian.com/cloud/oauth2-2lo-for-trello/)
- [Trello Webhooks Guide](https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/)
- [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/)
