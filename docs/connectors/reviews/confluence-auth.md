# Confluence Connector — Authentication & Credentials Audit

**Verdict: APPROVED WITH CORRECTIONS** — The document's auth coverage is functional but has several gaps around Personal Access Tokens, webhook signature details, OAuth scope naming, and Data Center auth surface that should be corrected before the connector ships.

---

## Findings

### 1. Personal Access Tokens (PAT) missing from Confluence Cloud auth

**Issue:** The Cloud auth section only documents API tokens (Basic Auth with `email:api_token`). Confluence Cloud also supports Personal Access Tokens, which use a simpler auth header (`Authorization: Basic base64(pat_token)` — no email prefix) and are tied directly to a user's account rather than requiring a separate email+token pair.

**Why it matters:** PATs are Atlassian's recommended replacement for API tokens in new integrations. They are easier to manage (no email pairing), offer better audit trails per user, and are the path Atlassian is investing in. Not covering them leaves the connector with an outdated auth model for future users.

**Concrete correction:** Add a `**Personal Access Token**` entry under Cloud auth alongside Basic Auth (API Token):

```
**Personal Access Token** (recommended over API tokens for new integrations)
- Obtain: https://id.atlassian.com/manage-profile/security/api-tokens
  (PATs are created alongside API tokens on the same page)
- Header: Authorization: Basic base64(pat_token)
- No email prefix required — token alone is the credentials
- Token lifetime: indefinite until revoked by user
- Supports all v2 API endpoints; same scope as the creating user's permissions
```

Update the header reference in the Quick Reference section accordingly.

---

### 2. Personal Access Tokens missing from Data Center / Server auth

**Issue:** The Data Center section only mentions Basic Auth with username/password. Confluence Data Center 8.x+ supports PATs as an alternative — better than sharing passwords, and available in the user profile settings.

**Why it matters:** Data Center users who want to avoid storing plaintext passwords need PATs. Omitting them means the connector cannot serve that use case cleanly.

**Concrete correction:** Update the Data Center section:

```
**Basic Auth (username/password)** — legacy; not recommended for production
**Personal Access Token** — recommended; created per user in Confluence settings
- Header: Authorization: Basic base64(username:token) for password-based
- Header: Authorization: Basic base64(token) for PAT (no username prefix)
- Session-based auth also supported but requires CSRF token handling
- No OAuth in any Data Center / Server version
```

---

### 3. Webhook signature verification lacks algorithm detail

**Issue:** Line 63 states webhook signatures use "JWT token in Authorization header (Connect app signature). Not HMAC-SHA256." This is correct but incomplete. The actual algorithm is RS256 (RSA-SHA256) with asymmetric keys, and verification requires fetching the public key from Atlassian's CDN using a `kid` parameter embedded in the JWT header.

**Why it matters:** Without knowing the algorithm and key retrieval mechanism, an implementer cannot build correct webhook signature verification. The current wording implies the algorithm simply "isn't HMAC" without specifying what it actually is.

**Concrete correction:** Replace the signature verification line:

```
**Signature verification**: JWT token (RS256 / RSA-SHA256) in Authorization header.
- Extract `kid` from JWT header
- Fetch public key from https://connect-install-keys.atlassian.com/{kid}
- Verify signature against the retrieved public key
- Check `iss` (issuer) claim is your app's base URL
- Check `exp` claim to reject expired tokens (replay protection via TTL)
- Note: No built-in nonce/replay table — enforce short TTL (e.g., 5 min) on `exp`
```

---

### 4. OAuth 2.0 refresh token lifetime is stale (30 days → 90 days)

**Issue:** Line 29 states refresh tokens last 30 days with `offline_access`. Atlassian updated this — refresh tokens now last 90 days.

**Why it matters:** A connector built against the 30-day assumption will unexpectedly fail token refresh after 30 days, causing silent auth失效 for long-running integrations.

**Concrete correction:** Change line 29 to:

```
- Token lifetime: 1 hour access, 90-day refresh (if offline_access granted)
```

---

### 5. OAuth 2.0 scope names are the legacy broad form

**Issue:** Lines 25–28 document `read:confluence` and `write:confluence` (the original Atlassian Cloud umbrella scopes). Atlassian has since introduced granular content-specific scopes: `read:confluence-content` and `write:confluence-content`. The older umbrella scopes still work but are over-scoped — `read:confluence` also grants access to user profiles, spaces, and settings beyond content.

**Why it matters:** Using `read:confluence` means requesting permissions the connector doesn't need (user profiles, space settings). This violates least-privilege and may concern security-conscious tenants reviewing OAuth app permissions.

**Concrete correction:** Update the OAuth scopes section to recommend the granular scopes for the MVP:

```
**OAuth 2.0 (3LO)**
- Standard 3-legged OAuth for user-context operations
- Scopes recommended for MVP:
  - `read:confluence-content` — read pages, spaces, comments (per-content granularity)
  - `write:confluence-content` — create/update pages, comments, labels
  - `confluence-api-status` — optional, for health check endpoints
  - `offline_access` — refresh token (90-day validity)
- Legacy scopes `read:confluence` / `write:confluence` still work but are over-scoped
- Token lifetime: 1 hour access, 90-day refresh (if offline_access granted)
```

---

### 6. Label management scope is under-specified

**Issue:** The document implies `write:confluence` covers label operations (`label_added`/`label_removed` webhook events, `POST /wiki/api/v2/pages/{id}/labels` endpoint). Atlassian's actual permission model requires `manage:confluence` scope for adding/removing labels on pages you don't own. Read scopes do not cover label mutation.

**Why it matters:** An OAuth integration using only `write:confluence` will fail at runtime when attempting to add or remove labels on pages owned by other users, with a 403 error that is non-obvious without knowing the scope requirement.

**Concrete correction:** In Section 11 (MVP Scope), update the label-related items:

```
**Label operations** (adding/removing labels via API):
- Required scope: manage:confluence (not covered by write:confluence alone)
- Webhook events (label_added/label_removed): require manage:confluence scope
```

And update the scopes table in Section 2:

| Operation | Required OAuth scope |
|-----------|---------------------|
| Read pages, spaces, comments | `read:confluence-content` |
| Post comments | `write:confluence-content` |
| Create/update pages | `write:confluence-content` |
| Add/remove labels | `manage:confluence` |
| Manage webhooks | `manage:confluence` |

---

### 7. Session-based auth for Data Center needs CSRF caveat

**Issue:** Line 38 mentions "Session-based auth also supported" for Data Center without noting that session-based API access requires handling Atlassian's CSRF token (`acsrf` token from the auth endpoint, sent as a cookie).

**Why it matters:** Without the CSRF token, session-based requests return 403. This is a footgun for anyone trying to implement session auth based on the current docs.

**Concrete correction:** Add to the Data Center section:

```
Session-based auth requires Atlassian's CSRF token:
- Obtain `acsrf` token from /context/authenticate response
- Pass it as a cookie in subsequent requests
- Session expires; requires re-authentication on expiry
- Not recommended for automated integrations — use PAT instead
```

---

### 8. API token rotation and multi-token guidance absent

**Issue:** The Basic Auth (API Token) section notes tokens are "indefinite until revoked" but doesn't mention that Atlassian allows creating multiple API tokens per account and that best practice is to create one token per integration rather than sharing a single token across use cases.

**Why it matters:** Without multi-token guidance, operators may reuse a single token across the connector and other tools, making rotation impossible without disrupting unrelated integrations.

**Concrete correction:** Add to the Basic Auth (API Token) section:

```
- Create one token per integration — do not reuse tokens across tools
- Rotation: create new token, update connector config, then revoke old token
- Atlassian supports multiple active tokens per account simultaneously
- No auto-rotation; revocation is the only lifecycle action
```

---

### 9. Multi-tenant per-tenant-token language is ambiguous

**Issue:** Section 10 (Known Gotchas) says "Per-tenant API token required — Basic Auth for each tenant's Cloud instance." This is technically true but could be misread as requiring one token per space within a tenant rather than one token per tenant Cloud instance.

**Why it matters:** Space isolation within a tenant is done via CQL filtering (as noted in the same section), not via separate tokens. The wording conflates tenant isolation with space-level isolation.

**Concrete correction:** Clarify line 408:

```
1. Per-tenant credentials required — each Confluence Cloud instance is a separate tenant;
   store one API token or PAT per tenant instance, not per space.
2. Space isolation within a tenant — use CQL filtering by allowed space keys;
   a single tenant token has access to all spaces the user has permission to.
```

---

### 10. MVP recommendation is sound but lacks justification context

**Issue:** The MVP recommendation (Cloud: Basic Auth API token; Data Center: Basic Auth) is correct but the document doesn't explain *why* Basic Auth is chosen over OAuth — specifically the trade-off of setup simplicity vs. user-level revocation and audit trail.

**Why it matters:** An operator reviewing the connector later may incorrectly assume Basic Auth was chosen for security reasons or may try to "upgrade" to OAuth prematurely for a non-critical integration, adding complexity without benefit.

**Concrete correction:** Add a brief rationale in the MVP section:

```
**Why Basic Auth for MVP:**
- API tokens / PATs require no OAuth redirect, callback URL, or app registration in the Atlassian Marketplace — one URL (id.atlassian.com) and one token string to configure
- OAuth 2.0 3LO adds: app registration, redirect URI handling, CSRF state management, and refresh token persistence
- For server-to-server integrations where a human user provisions the connector once, OAuth overhead is disproportionate
- Trade-off: OAuth provides per-app revocation and marketplace discoverability; PATs provide per-user audit trails. For an internal tool, Basic Auth + PAT is pragmatic.
```

---

### 11. Secret-type classification not addressed

**Issue:** The document does not classify credential types for the platform registry (e.g., `api_key` vs `service_account` vs `webhook_secret`). The Atlassian Connect webhook secret is conceptually different from an API token — Connect apps use asymmetric RSA keys, not shared secrets.

**Why it matters:** A connector implementation using this document must correctly classify secrets in its credential store. Mixing up the Connect app JWT verification (asymmetric, public-key-based) with a simple API token storage will lead to incorrect secret rotation policies and observability labels.

**Concrete correction:** Add a credential classification section:

```
## Credential Types for Platform Registry

| Credential | Type | Format | Rotation |
|-----------|------|--------|---------|
| Confluence Cloud API token (email:token) | `api_key` | base64(email:token_string) | Manual revoke only |
| Confluence Cloud PAT | `api_key` | base64(token_string) | Manual revoke only |
| Confluence Data Center PAT | `api_key` | base64(username:token) | Manual revoke only |
| Confluence Data Center password | `api_key` | plaintext | Change password |
| Atlassian Connect app JWT | `webhook_secret` | RSA public key URL (`kid` → CDN) | App reinstall required |
| Atlassian OAuth access token | `access_token` | opaque JWT | 1h expiry, refresh with PAT |
| Atlassian OAuth refresh token | `refresh_token` | opaque | 90-day expiry |

Note: Connect app JWT uses asymmetric RSA keys — the "secret" is the private key held by Atlassian, verified against the public key from Atlassian's CDN. Classify as `webhook_secret` with verification_method: `rsa_public_key`.
```

---

## Summary of Severity

| Severity | Finding |
|----------|---------|
| **High** | #1 (PATs missing — Cloud), #3 (webhook signature incomplete), #6 (label management scope) |
| **Medium** | #2 (PATs missing — Data Center), #4 (refresh token lifetime), #5 (scope naming), #7 (session CSRF), #8 (rotation guidance) |
| **Low** | #9 (ambiguous multi-tenant language), #10 (MVP justification), #11 (secret classification) |

## What Is Correct

- Basic Auth header format for email+API token is accurate
- OAuth 2.0 3LO existence and flow description is correct
- Connect App JWT exists as a separate mechanism (for Forge/Connect apps, not user-context)
- No OAuth on Data Center / Server is accurate
- Webhook delivery being best-effort is correctly flagged
- No `comment_created` webhook is accurately documented
- Data Center v1 API vs Cloud v2 API distinction is correct
- The MVP Basic Auth recommendation is pragmatically justified
