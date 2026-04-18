# Auth Review — Jira Connector

**Verdict:** Mostly correct with several meaningful gaps and a few factual errors. The doc covers the main authentication mechanisms but is missing OAuth 2.0 Client Credentials, misstates the QSH algorithm, omits replay protection for webhooks, misclassifies the API token secret type, and leaves multi-tenant OAuth app setup underspecified. Fix these before building.

---

## Findings

### 1. OAuth 2.0 Client Credentials flow is not listed

**Issue:** Section 2.1 lists only Authorization Code Grant under OAuth 2.0. Atlassian also supports the OAuth 2.0 Client Credentials flow (sometimes called machine-to-machine or service account OAuth) for server-to-server integrations without user involvement.

**Why it matters:** For a support automation connector that acts as a bot, Client Credentials is often the correct flow — no user redirect, no refresh token management, and credentials are tied to a service principal rather than a human user's API token.

**Correction:** Add a subsection for OAuth 2.0 Client Credentials:
- Grant type: `client_credentials`
- Token endpoint: `https://auth.atlassian.com/oauth/token`
- Requires: `client_id`, `client_secret`, and target `resource` (cloud site ID)
- Access token lifetime: 1 hour, no refresh token issued; re-request using credentials
- Scopes are the same granular/classic scope strings as Authorization Code

---

### 2. Scopes table placed under API Token section but scopes only apply to OAuth

**Issue:** The scopes table (classic and granular) is nested inside the API Token subsection. API tokens use Basic Auth and do not use OAuth scopes — the token inherits whatever permissions the user account holds in Jira.

**Why it matters:** This is a category error. Readers building an API-token integration will believe they need to configure scopes, which is not possible or relevant. Readers building OAuth integrations need to find scope information quickly, and it is buried in the wrong section.

**Correction:** Move the scopes table to the OAuth 2.0 section. Under API Token, replace the scopes table with: "Permissions are determined by the Jira project roles and global permissions of the user account that owns the token. No scope configuration is needed."

---

### 3. Missing `ACCESS_EMAIL_ADDRESSES` scope in the OAuth scopes table

**Issue:** Section 10.2 mentions that email access requires `ACCESS_EMAIL_ADDRESSES` scope or admin, but this scope does not appear in the scopes table in section 2.1.

**Why it matters:** If a connector developer uses the scopes table as the authoritative list, they will ship without requesting email access, then be surprised when `emailAddress` is redacted in API responses.

**Correction:** Add a row to the granular scopes table:
- Operation: Read user email addresses
- Classic scope: `read:jira-user`
- Granular scope: `read:user:jira` plus `ACCESS_EMAIL_ADDRESSES` (separate opt-in required via app configuration in the Atlassian developer console)

---

### 4. Connect JWT QSH algorithm description is wrong

**Issue:** Section 2.1 states: `QSH calculation: HMAC-SHA256(method&uri&query_string)`. QSH is not an HMAC. It is a plain SHA-256 hash of the canonical string `{HTTP_METHOD}&{canonical_uri}&{canonical_query}`.

**Why it matters:** An implementer following this description would compute an HMAC (which requires a key) instead of a keyless SHA-256 digest, producing a wrong QSH value and causing all Connect JWT calls to fail verification on the Atlassian side.

**Correction:** Change to: `QSH = SHA-256("{HTTP_METHOD}&{canonical_URI}&{canonical_query_string}")` where the canonical query string is alphabetically sorted, URL-encoded key=value pairs joined by `&`.

---

### 5. Webhook signature replay protection is not addressed

**Issue:** Section 3.1 describes HMAC-SHA256 signature verification but says nothing about replay protection. The doc does note the `X-Atlassian-Webhook-Identifier` header for deduplication but does not tie it to replay defense.

**Why it matters:** An attacker who captures a valid signed webhook can replay it indefinitely unless the receiver checks for duplicate identifiers or timestamp windows. Without explicit guidance to reject replays, implementations will be vulnerable.

**Correction:** Add to the signature verification steps:
- Extract `X-Atlassian-Webhook-Identifier` (UUID string) from each delivery
- Persist seen identifiers in a short-lived store (e.g., 15-minute TTL matches the secondary flow window)
- Reject duplicate identifiers immediately after signature check
- Optionally validate that the webhook `timestamp` field is within an acceptable window (e.g., ±5 minutes of current time)

---

### 6. Webhook `X-Hub-Signature` header name may not be correct for Jira Cloud

**Issue:** The doc states the signature header is `X-Hub-Signature`. This header name originates from GitHub's webhook spec. Atlassian's official webhook documentation does not consistently use `X-Hub-Signature` — the actual header delivered by Jira Cloud REST webhooks registered via `/rest/webhooks/1.0/webhook` is not `X-Hub-Signature`; Atlassian's signature is delivered differently depending on webhook type (Connect vs admin webhook).

**Why it matters:** If the header name is wrong, the connector will never find a signature to verify, either silently accepting all payloads or incorrectly rejecting valid ones.

**Correction:** Verify the exact header name against the live Atlassian webhook documentation. For admin webhooks registered via `POST /rest/webhooks/1.0/webhook`, confirm whether Atlassian delivers a signature header at all when the `secret` field is set. At time of review, Atlassian's REST webhook signature delivery behavior for admin webhooks is distinct from Connect webhooks; this needs explicit cross-referencing with the live spec before implementation.

---

### 7. Secret type classification is missing from the credential fields

**Issue:** Section 11 (MVP Config Fields) lists `apiToken` and `webhookSecret` as config fields but does not classify them using a `secret_type` or platform-registry-consistent label (e.g., `api_key`, `webhook_secret`).

**Why it matters:** Without a consistent type classification, the connector registry cannot enforce correct secret storage (encrypted at rest vs plaintext), rotation policies, or UI masking behavior. Other connectors in the system presumably follow a typed classification scheme.

**Correction:**
- `apiToken` → type: `api_key` (user-scoped, non-expiring, revocable by user)
- `webhookSecret` → type: `webhook_secret` (symmetric, set at registration time)
- If OAuth is added: `clientSecret` → type: `oauth_client_secret`; refresh token → type: `oauth_refresh_token`

---

### 8. OAuth 2.0 token lifetime for refresh tokens may be inaccurate

**Issue:** Section 2.1 states the refresh token lifetime is "90 days (until revoked)." Atlassian's actual behavior is that refresh tokens do not have a published fixed expiry — they are valid until the user revokes the app's access or the token is used (sliding window). The 90-day figure appears to be a community approximation rather than official documentation.

**Why it matters:** If the implementation assumes a hard 90-day expiry and proactively invalidates refresh tokens at that boundary, it will log users out unnecessarily. If the real expiry is shorter or if Atlassian changes behavior, silent auth failures will occur.

**Correction:** Replace "90 days" with the precise Atlassian-documented value or note explicitly that the lifetime is not officially published and the connector should rely on the error response (`401` with `invalid_grant`) to detect expiry and trigger re-authorization.

---

### 9. Multi-tenant OAuth app requirements are underspecified

**Issue:** Section 10.6 notes that "each tenant needs their own Jira Cloud instance URL" and references the 5-webhook limit per OAuth user, but it does not describe the single-app vs per-tenant app model for OAuth.

**Why it matters:** A multi-tenant SupportAgent deployment using OAuth needs to understand: (a) one OAuth app registration covers all tenants (Atlassian uses the same app key across tenants), (b) per-tenant authorization requires a separate authorization grant and token pair per tenant, and (c) the `cloudId` or site identifier must be stored alongside each token to route API calls to the correct tenant.

**Correction:** Add a multi-tenant OAuth section covering:
- One OAuth app registration in the Atlassian developer console serves all tenants
- Each tenant's user independently authorizes the app; store `(tenantCloudId, accessToken, refreshToken)` per authorization
- Obtain `cloudId` from `GET https://api.atlassian.com/oauth/token/accessible-resources` after token exchange
- Use `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...` as the base URL for per-tenant API calls (not the raw `atlassian.net` URL)

---

### 10. Unassign by `name: null` is incorrect for Jira Cloud

**Issue:** Section 4.8 shows unassigning a user by setting `"assignee": { "name": null }`. In Jira Cloud, user fields use `accountId` not `name`. The correct payload to unassign is `"assignee": null` (set the field to null directly, not an object with a null name).

**Why it matters:** Sending `{ "name": null }` will either fail with a 400 error or be silently ignored on Cloud instances where `name` is deprecated, leaving the assignee unchanged.

**Correction:** Change to:
```json
{
  "fields": {
    "assignee": null
  }
}
```

---

### 11. Data Center OAuth 2.0 scopes and setup are not described

**Issue:** Section 2.2 mentions "OAuth 2.0: Available" for Data Center but provides no detail — no scopes, no token endpoint, no grant types.

**Why it matters:** Data Center OAuth 2.0 (introduced in Data Center 8.x via Atlassian's new OAuth 2.0 app model) has different setup requirements from Cloud OAuth. Without this detail, a Data Center integration will fall back to Basic Auth or PAT even when OAuth is preferred.

**Correction:** Either document Data Center OAuth 2.0 (client credentials and auth code, token endpoint at `https://dc-host/rest/oauth2/latest/token`, scopes configured in the app link) or explicitly mark it as out of scope for MVP with a note that PAT is the recommended Data Center credential type.

---

### 12. MVP recommendation omits service account risk for API token

**Issue:** The MVP recommendation of API Token is reasonable, but the doc does not flag that the token is tied to a specific human user account. If that user is deprovisioned (employee leaves), all integrations using their token break silently.

**Why it matters:** This is a common production outage vector for API-token-based integrations.

**Correction:** Add a note: "Create a dedicated service account in Jira (e.g., `supportagent@company.com`) and generate the API token for that account. Do not use a personal user account's token."
