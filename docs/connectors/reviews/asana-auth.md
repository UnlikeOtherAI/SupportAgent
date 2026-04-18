# Asana Connector — Authentication Review

**Verdict:** REQUIRES CORRECTIONS — 4 issues that could cause implementation failures or security vulnerabilities

---

## Findings

### 1. Webhook Signature Verification Is Incomplete and Potentially Insecure

**Issue:** Section 3.4 states "Asana does NOT use HMAC signatures" and suggests verifying webhooks by "matching `X-Hook-Secret` header OR by re-registering webhook."

**Why it matters:** Matching a header value without cryptographic verification is not secure. An attacker could send forged webhook requests with any `X-Hook-Secret` value. The statement "OR by re-registering webhook" would make every event trigger a new webhook registration attempt — a DoS vector.

**Correction:** Asana's webhook verification works as follows:
- **Handshake phase:** Server sends `X-Hook-Secret` header → client must echo it back in response header
- **Subsequent events:** After handshake, Asana signs each request with HMAC-SHA256 using the established secret. The signature is sent in `X-Hook-Signature` header as `sha256=<hex_digest>`. The correct verification is:
  1. Compute `HMAC-SHA256(secret, request_body)` 
  2. Compare against `X-Hook-Signature` header value
  3. Reject if mismatch

The documentation should be corrected to show proper HMAC verification code.

---

### 2. Refresh Token Lifetime Is Inaccurate

**Issue:** Section 2.1 table says "Refresh tokens: 30 days."

**Why it matters:** If SupportAgent code implements a 30-day refresh token expiry check, it may fail prematurely or handle valid tokens incorrectly.

**Correction:** Asana's official OAuth documentation states refresh tokens are "long-lived" with no specified duration. The 30-day figure appears to be incorrect. Remove the specific duration or verify with Asana support. If any renewal logic depends on a 30-day window, remove it.

---

### 3. Service Account Scope Claim Is Imprecise

**Issue:** Section 2.5 says Service Accounts "provide org-wide access without user delegation" and Section 2.6 says they "provide better multi-tenant isolation."

**Why it matters:** The Asana docs say Service Accounts provide "complete org-wide access **including private user data**." This is significantly more permissive than described. Labeling them as "better isolation" is misleading — they have broader data access, not more restricted access.

**Correction:** Revise to clarify:
- Service Accounts bypass user consent requirements
- They can access private user data across the organization
- Use them only when org-wide machine access is required, not for "better isolation"
- This is a trade-off: convenience vs. least-privilege

---

### 4. Missing OpenID Connect Scopes

**Issue:** The scope table in Section 2.3 is incomplete.

**Why it matters:** Asana supports OpenID Connect authentication with additional scopes: `openid`, `email`, `profile`. If SupportAgent ever needs to authenticate users via Asana (e.g., SSO), these scopes are required.

**Correction:** Add to scope table:
| Scope | Permissions | Required For |
|-------|-------------|--------------|
| `openid` | Access to OpenID Connect ID tokens | SSO integration |
| `email` | Access to user's email via user info endpoint | SSO integration |
| `profile` | Access to user's name and profile photo | SSO integration |

Note these are only needed for OpenID Connect flows, not for standard API access.

---

### 5. Missing Webhook Secret Type Classification

**Issue:** The documentation does not specify how to classify the webhook secret for the platform registry.

**Why it matters:** Secret rotation, storage, and audit requirements differ by secret type (`api_key` vs `webhook_secret` vs `oauth_client_secret`).

**Correction:** Add to Section 2 or 3.4:

| Secret Type | Classification | Notes |
|-------------|----------------|-------|
| Personal Access Token | `api_key` | User's PAT, long-lived |
| OAuth Access Token | `oauth_token` | Short-lived (1hr), needs refresh |
| OAuth Refresh Token | `oauth_refresh_token` | Long-lived, store securely |
| Webhook Handshake Secret | `webhook_secret` | Set during handshake, used for HMAC verification |
| Service Account Token | `api_key` | Machine token, long-lived |

---

### 6. Missing `projects:read` Scope in MVP

**Issue:** Section 2.3 MVP Required Scopes lists `tasks:read`, `tasks:write`, `stories:read`, `stories:write`, `webhooks:write`, `users:read`.

**Why it matters:** Section 3.9 (Payload Fields to Persist) references `task.projects[]` — to resolve project names or custom field definitions on projects, `projects:read` is required. Without it, GET on `/projects/{gid}` will fail.

**Correction:** Add `projects:read` to MVP Required Scopes, or clarify that `projects:read` is needed only if project metadata resolution is required.

---

### 7. OAuth Authorization URL Has Incorrect Format

**Issue:** Section 2.4 shows the OAuth URL with space-separated scopes encoded as `%20`.

**Why it matters:** Asana's OAuth implementation requires scopes to be **space-separated** in the `scope` parameter. The current URL shows `%20` which is technically correct URL encoding, but the documented example may confuse readers about whether to use `+` or `%20`.

**Correction:** Verify with Asana docs that `%20` encoding is correct (preferred over `+` for OAuth 2.0 RFC 6749 compliance). Add a note that Asana accepts both space-separated and URL-encoded formats.

---

### 8. Missing Bot/User Scoping Note for PATs

**Issue:** The documentation notes PAT actions are "attributed to the generating user" but does not clarify PAT scope limitations.

**Why it matters:** PATs grant the same permissions as the user's web product access. This is **not** granular — if a user has access to all workspaces, their PAT does too. OAuth scopes are granular; PATs are not.

**Correction:** Add a note under Section 2.1 or 2.6:

> **PAT Scope Limitation:** PATs do not use OAuth-style scopes. They grant access equivalent to the user's Asana web product permissions. If fine-grained access control is needed, use OAuth with specific scopes, not PATs.

---

## Summary of Required Changes

| Priority | Issue | Section |
|----------|-------|---------|
| **Critical** | Webhook HMAC verification is missing/incorrect | 3.4 |
| **High** | Refresh token lifetime (30 days) is unverified | 2.1 |
| **High** | Service Account "isolation" claim is misleading | 2.5, 2.6 |
| **Medium** | Missing OpenID Connect scopes | 2.3 |
| **Medium** | Missing secret type classification | 2.x |
| **Medium** | Missing `projects:read` in MVP scopes | 2.3 |
| **Low** | OAuth URL encoding clarification | 2.4 |
| **Low** | PAT scope limitation note | 2.1 |

---

## Security Recommendations

1. **Always use HMAC verification for webhooks** — even if Asana doesn't enforce it, implementing it protects against forged webhook deliveries.

2. **Rotate webhook secrets** — if the handshake secret is compromised, re-register the webhook to get a new secret.

3. **Store OAuth refresh tokens securely** — they are long-lived and grant broad access to the Asana API.

4. **Use Service Accounts with minimal scopes** — they have org-wide access by default; configure only the scopes you need.

5. **PATs should be treated as passwords** — they don't expire and grant full user-level access. Rotate regularly.
