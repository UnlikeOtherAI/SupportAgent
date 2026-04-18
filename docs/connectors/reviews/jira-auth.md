# Jira Connector — Authentication Review

**Reviewer:** Claude Code audit
**Source:** `docs/connectors/jira.md`
**Date:** 2026-04-18
**Scope:** Authentication and credentials only

---

## Verdict

**APPROVED WITH CORRECTIONS** — The document is broadly accurate but contains five issues that must be fixed before this goes live: one likely incorrect webhook header name, one incomplete Connect JWT description, one scope discrepancy, one missing deprecation flag, and one imprecise token-lifetime description.

---

## Findings

### 1. Webhook signature header — likely wrong name

**Issue:** Section 3.1 (Signature Verification) states the header is `X-Hub-Signature`.

**Why it matters:** Atlassian migrated Jira Cloud webhooks to `X-Atlassian-Signature` with a structured JSON format (`{"hash":"sha256=..."}`) and deprecated the GitHub-style `sha256=` plain-text format. If connectors are built against `X-Hub-Signature`, they will silently fail signature verification on current Jira Cloud tenants.

**Concrete correction:** Replace section 3.1 with `X-Atlassian-Signature` and update the example signature format to:
```
X-Atlassian-Signature: {"hash":"sha256=4771c39fbe90f317c7824e83ddef3caae9cb3d976c214ace1f2937e133263c9"}
```
Note that the hash value is base64-encoded (not hex as shown in the current document's `sha256=...` example block). Verify the exact format against [Atlassian's webhook security docs](https://developer.atlassian.com/cloud/jira/platform/jira-webhook-security/).

---

### 2. Connect JWT — missing public key (RS256) path

**Issue:** Section 2.1 states the algorithm is HMAC-SHA256 and implies a symmetric shared secret.

**Why it matters:** Connect apps use HS256 (symmetric) for normal API calls but RS256 (asymmetric) for lifecycle callbacks (installation, uninstallation, `lifecycle-updated`). If the connector ever needs to handle lifecycle callbacks (e.g., a Connect app model), asymmetric verification is required. More critically, the `Authorization` header format for Connect JWTs is incorrect.

**Concrete correction:**
- Remove `Authorization: JWT <jwt_token>` from the JWT section — Connect JWTs are passed as a bearer token in `Authorization: JWT <token>`, or more commonly passed as a query parameter (`jwt=<token>`) for GET requests. They are not in the `Authorization: Bearer <token>` format.
- Add a note: "For lifecycle callback verification, use RS256 with public keys from `https://connect-install-keys.atlassian.com/{kid}`. For normal API calls, use HS256 with the shared secret from the installation payload."
- The `sub` claim description is missing: it is the Atlassian Account ID of the acting user (required for user-context requests).

---

### 3. OAuth scopes — incomplete `read:comment:jira` granularity

**Issue:** Section 2.1 lists `read:comment:jira` as the granular scope for reading comments. Section 2.1 also lists `write:comment:jira` for posting comments.

**Why it matters:** Jira's granular scopes for comments are split between `read:comment.custom:jira` (custom field comments) and `read:comment:jira` (regular comments). The write scope for comments may not exist as a standalone granular scope — writing comments typically requires `write:jira-work` at the granular level or falls under `write:issue.jira` since comments are part of issue resources. Listing non-existent granular scopes could lead to incorrect OAuth app configuration.

**Concrete correction:** Verify `write:comment:jira` exists in the [Jira scope reference](https://developer.atlassian.com/cloud/jira/platform/scope-reference/). If it does not, replace with `write:jira-work` (classic) or note that comment posting falls under issue write scope. Add a disclaimer: "Granular scope availability varies — when in doubt, use the classic scope or consult the 'OAuth scopes required' field on each REST API endpoint's documentation page."

---

### 4. OAuth 1.0a — marked deprecated but missing removal date context

**Issue:** Section 2.2 states OAuth 1.0a is "Deprecated" but provides no context about urgency.

**Why it matters:** Atlassian deprecated OAuth 1.0a for Jira Cloud in 2019 and shut down the endpoint in 2024. New integrations must not reference it. For Data Center, the situation may differ but the endpoint is still end-of-life.

**Concrete correction:** Add to section 2.2: "OAuth 1.0a was removed for Jira Cloud in 2024. Do not use for any new integration." For Data Center, clarify: "OAuth 1.0a is deprecated but may still function on self-hosted instances for backward compatibility."

---

### 5. API token — "does not expire" is imprecise

**Issue:** Section 2.1 says "Tokens do not expire but can be revoked by user."

**Why it matters:** While Atlassian API tokens don't have a built-in TTL, they can be invalidated by Atlassian admins via SCIM/provisioning systems, security policy enforcement, or account deletion. They are also tied to the account that created them — if that account is deactivated, the token dies. Describing them as "never expire" sets incorrect expectations for reliability.

**Concrete correction:** Replace with: "Tokens do not have a defined Atlassian-side TTL but are tied to the creating account. They become invalid upon account deactivation, admin revocation, or Atlassian security policy enforcement. Design for token invalidation scenarios."

---

## Minor Issues

### 6. Missing: Atlassian API token collection warning

**Issue:** The document recommends API tokens without flagging a known Atlassian policy concern.

**Why it matters:** Atlassian has flagged that apps collecting and storing user API tokens may violate their security requirements for marketplace apps. While this is primarily relevant for Connect/Forge apps, it could affect how SupportAgent is classified.

**Concrete correction:** Add a note in the API Token section: "Note: Storing user API tokens in external systems may conflict with Atlassian's app security requirements. For production OAuth-capable integrations, prefer OAuth 2.0 over API tokens."

---

### 7. Data Center PAT header — imprecise

**Issue:** Section 2.2 shows PAT with `Authorization: Bearer <pat_token>` but doesn't specify the exact header name used in Data Center responses or registration.

**Why it matters:** Jira Data Center versions vary in PAT header support. Some versions use a custom header (`X-Atlassian-Token`) rather than `Authorization: Bearer`.

**Concrete correction:** Confirm against the specific Data Center REST API docs whether PATs are passed as `Authorization: Bearer` or `X-Atlassian-Token`. Add a version-specific note if needed.

---

### 8. Missing: Connect app webhook 30-day expiration clarification

**Issue:** Section 3.1 says webhooks expire after 30 days and auto-extend via API.

**Why it matters:** The 30-day expiration and auto-extension behavior applies specifically to admin-registered webhooks. Connect app webhooks are tied to the app installation and do not expire on the same schedule.

**Concrete correction:** Add a clarification: "Admin-registered webhooks expire after 30 days unless renewed via API. Connect app webhooks do not expire but are removed on app uninstallation."

---

## Verified Correct

- API token header format (`Authorization: Basic base64(email:token)`) — confirmed correct
- Basic Auth usage (email:token) for Jira Cloud API tokens — confirmed
- JWT QSH calculation (`HMAC-SHA256(method&uri&query_string)`) — confirmed
- JWT `exp` max 3 minutes from `iat` — confirmed
- Access token lifetime of 1 hour — confirmed
- PAT usage for Data Center — confirmed correct format
- OAuth scopes table structure — structurally sound, but see finding #3
- Webhook retry semantics (5 retries, flow types, deduplication header) — confirmed
- `X-Atlassian-Webhook-Identifier` for deduplication — confirmed
- Multi-tenant config fields (`baseUrl`, `email`, `apiToken`) — correct

---

## Security Summary

No critical auth-bypass vulnerabilities found. The primary risks are:

1. **Outdated webhook header** (finding #1) — causes signature verification failures or bypass if connectors check the wrong header
2. **Over-collection of API tokens** (finding #6) — could violate Atlassian policies in certain deployment contexts
3. **Missing RS256 note for Connect JWT** (finding #2) — relevant if the team ever builds a Connect app model

All other items are documentation precision issues rather than security risks.

---

**Sources:**
- [Jira Cloud REST API v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
- [Jira Webhooks](https://developer.atlassian.com/cloud/jira/platform/webhooks/)
- [Understanding JWT for Connect Apps](https://developer.atlassian.com/cloud/jira/platform/understanding-jwt-for-connect-apps/)
- [Basic Auth for REST APIs](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/)
- [OAuth 2.0 for 3LO Apps](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/)
- [Scope Reference](https://developer.atlassian.com/cloud/jira/platform/scope-reference/)
- [Jira Data Center REST API](http://docs.atlassian.com/jira-software/REST/latest/)
