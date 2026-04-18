# PagerDuty Connector — Authentication Review

**Reviewer**: Auth audit
**Source**: `docs/connectors/pagerduty.md`
**Verdict**: ⚠️ Issues found — several corrections needed

---

## Findings

### 1. API Key: Two distinct types not distinguished

**Issue**: The document describes API keys as a single concept but PagerDuty has **two distinct REST API key types**:

- **General Access REST API Keys**: 20-character account-level keys. Can be created by Admins/Account Owners. Optionally scoped to read-only (GET only).
- **User Token REST API Keys** (Personal API Keys): Associated with a specific user. Requests are restricted to the user's own permissions. 403 Forbidden if the user cannot perform the operation.

**Why it matters**: Confusing these types leads to permission errors. A connector using a General Access key with limited admin permissions will behave differently than one using a user's personal token. The document treats them identically.

**Concrete correction**: Add a subsection distinguishing the two key types. For the connector, recommend a **General Access REST API Key** (account-level, service account) rather than a personal user token. State the 20-character format. Note that personal tokens are tied to a human user's account and become invalid if they leave.

---

### 2. API Key format is correct but length not documented

**Issue**: The document correctly states `Authorization: Token token=<API_KEY>`. This matches the OpenAPI spec. However, it omits that REST API keys are exactly **20 characters** (vs. Events API keys which are 32 characters).

**Why it matters**: Without the format, implementers may not detect if they're using an Events API key (wrong key type) vs. a REST API key. Both appear as random alphanumeric strings but have different lengths and purposes.

**Concrete correction**: Add `REST API keys are 20-character alphanumeric strings` after "Create Integration Key". Add a note distinguishing from Events API keys (32 characters, used only with `events.pagerduty.com/v2`).

---

### 3. OAuth 2.0 section is dangerously incomplete

**Issue**: Section 2 describes OAuth 2.0 in two sentences:
> "Available but requires OAuth app registration per tenant. More complex to set up per-tenant."
> "Recommendation: Not for MVP."

This is insufficient for any future implementation. The section omits:
- Which OAuth2 grant types are supported (authorization code, client credentials, device flow?)
- Any scopes or permissions
- Token lifetimes and refresh semantics
- How multi-tenant app registration works (one global app vs. per-tenant)
- Whether PagerDuty supports OAuth2 at all for the REST API

**Why it matters**: The OpenAPI spec (`reference/REST/openapiv3.json`) defines only `api_key` as the security scheme — no OAuth2 flows appear anywhere in the spec. If PagerDuty REST API does not support OAuth2, the current text is misleading. If it does (via the Apps platform), the section is dangerously incomplete to act on.

**Concrete correction**: Verify and document whether PagerDuty REST API supports OAuth2:
- If yes: List supported grant types, scopes, token lifetimes, and per-tenant registration model.
- If no: Delete the OAuth2 subsection entirely to avoid confusion. The statement "Available but..." implies it exists when the OpenAPI spec shows no OAuth2 security scheme.

---

### 4. Webhook signature: case mismatch on header name

**Issue**: The document states the signature header is `X-PagerDuty-Signature`. PagerDuty's v3 webhook API (currently in use based on support docs) uses `x-pagerduty-signature` (lowercase `x-`). The older webhook API used `X-PagerDuty-Signature` (capital X, capital P, D).

**Why it matters**: Using the wrong header name means signature verification is bypassed entirely — a critical security gap.

**Concrete correction**: Confirm which webhook API version (v1/v2 vs. v3) PagerDuty is using for `generic_webhook` extensions. If v3: change header to `x-pagerduty-signature`. Add a note that the signature format may differ between webhook API versions.

---

### 5. Webhook signature: no replay protection documented

**Issue**: The document describes HMAC-SHA256 verification (`v1=<hex>`) but does not address replay protection. PagerDuty webhooks can be retried over ~24 hours with exponential backoff. An attacker with access to a valid webhook payload could replay it within that window.

**Why it matters**: Without replay protection, an intercepted webhook payload can be resubmitted to change incident state (acknowledge, resolve) without proper authorization.

**Concrete correction**: Add guidance to track webhook delivery timestamps and reject requests with timestamps older than a configured threshold (e.g., 5 minutes). Alternatively, track a deduplication ID if PagerDuty provides one per delivery attempt. Note that `changed_fields` may differ between retries.

---

### 6. Secret type classification missing

**Issue**: The document does not classify the two secret types:
1. **REST API Key** (`api_key`) — stored as `Authorization: Token token=<KEY>`
2. **Webhook HMAC Secret** (`webhook_secret`) — used for `HMAC-SHA256(secret, raw_body)`

The admin panel config fields listed include "PagerDuty API Key" and "HMAC webhook secret" but these aren't typed in a registry format.

**Why it matters**: Without explicit type classification, the secrets may be stored or rotated incorrectly (e.g., API keys rotated on user离职, webhook secrets rotated on every redeploy).

**Concrete correction**: Add a secret type mapping:
- `pagerduty_api_key` → REST API key (`api_key` type in registry)
- `pagerduty_webhook_secret` → HMAC secret for webhook verification (`webhook_secret` type in registry)

---

### 7. Multi-tenant setup friction understated

**Issue**: The document mentions "Store per-tenant" for API keys but does not address the webhook registration challenge in multi-tenant scenarios: each tenant's PagerDuty account may have N services, and each service requires a separate webhook registration.

**Why it matters**: In multi-tenant, the connector must register one webhook per service per tenant. This is not a single credential — it's N×M webhook registrations. The auth section implies a single API key solves multi-tenant, but webhook setup is the harder problem.

**Concrete correction**: Add a note under §2 clarifying that while API key auth scales linearly per tenant, webhook registration scales per service per tenant. Reference §10 gotcha about per-service webhooks.

---

### 8. `From` header semantics slightly unclear

**Issue**: The document states the `From` header is "required on all mutating requests" and must be "a valid account user's email." It does not clarify whether this user must have permissions to perform the action.

**Why it matters**: Based on PagerDuty docs, requests with a `From` header for a user who lacks permissions return 403 Forbidden. The document should tie this to the API key's associated user or the General Access key's admin permissions.

**Concrete correction**: Clarify that the `From` header email should belong to the same user whose permissions the API key inherits (for User Token keys), or any admin user (for General Access keys). State that using a non-admin user's email with a General Access key does not elevate permissions.

---

### 9. Permission model listing is accurate

**Issue**: None.

**Verification**: The account roles (`admin`, `owner`, `user`, `limited_user`, `observer`, `read_only_user`, `read_only_limited_user`, `restricted_access`) and ability-based flags (`teams`, `read_only_users`, `advanced_permissions`, `urgencies`, `response_operations`) match PagerDuty's documented permission model. The document correctly notes that some endpoints require specific abilities.

---

### 10. Token lifetime statement is correct

**Issue**: None.

**Verification**: "Non-expiring unless revoked manually" is accurate for PagerDuty REST API keys. There is no built-in expiration. This matches PagerDuty documentation.

---

### 11. MVP recommendation is justifiable

**Issue**: None.

**Verification**: API key auth is the correct MVP choice. OAuth2 requires app registration per tenant with unclear benefit for a service-account-based bot. The recommendation is sound.

---

## Summary of Required Changes

| # | Severity | Finding |
|---|---|---|
| 1 | Medium | Distinguish General Access vs. User Token REST API keys |
| 2 | Low | Document 20-character REST key length, distinguish from 32-char Events key |
| 3 | High | OAuth2 section either document fully or delete; contradicts OpenAPI spec |
| 4 | Medium | Webhook header case mismatch (`X-PagerDuty-Signature` vs. `x-pagerduty-signature`) |
| 5 | Medium | No replay protection guidance for webhook payloads |
| 6 | Low | Missing secret type classification for registry |
| 7 | Low | Multi-tenant webhook scaling not addressed in auth section |
| 8 | Low | `From` header permission semantics need clarification |

**High-priority items**: #3 (OAuth2 contradiction with OpenAPI spec), #4 (signature bypass risk).
