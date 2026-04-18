# Auth Review — Bitbucket Connector

**Reviewer**: claude-sonnet-4-6  
**Date**: 2026-04-18  
**Source**: `docs/connectors/bitbucket.md`  
**Scope**: Authentication and credentials only

---

## Verdict

**Fail — multiple material errors.** The document describes an auth model that is partially out of date and partially wrong. Several mechanism names are incorrect or deprecated, scope names for the primary auth method are wrong, the OAuth refresh flow misnames the required scope, and the webhook signature header claim is unverified and likely wrong. None of these are cosmetic; all would cause integration failures or security regressions.

---

## Findings

### 1. App Passwords are deprecated — not a valid MVP recommendation

**Issue**: Section 2.1.3 documents App Passwords as a current mechanism and section 2.1.1 conflates App Passwords with the PAT/API Token by presenting `Authorization: Basic {base64(email:app_password)}` as a PAT variant. Section 11 `BitbucketConfig` treats `accessToken` as if App Passwords and PATs are interchangeable.

**Why it matters**: Atlassian deprecated App Passwords on September 9, 2025 (no new creation) and will hard-disable all existing App Passwords on June 9, 2026. An integration built on this doc's MVP recommendation will stop working within months.

**Correction**: Remove App Passwords as a recommended mechanism. Replace with API Tokens (the official successor). API Tokens use `Authorization: Basic {base64(email:api_token)}` — same header shape, but the credential type is different and must be obtained from Account Settings → API Tokens, not App Passwords. The `authType` field in `BitbucketConfig` should be renamed or annotated to make clear this is an API Token, not an App Password.

---

### 2. Scope names for Cloud are wrong — `:read` suffix does not exist

**Issue**: Sections 2.1.1 and 2.1.2 list scopes as `repository:read`, `pullrequest:read`, `issue:read`, and `account:read`. These scope names do not exist in Bitbucket's actual scope registry.

**Why it matters**: Requesting non-existent scopes in an OAuth 2.0 flow will cause the authorization to fail or silently grant no permissions for those resources.

**Correction**: Bitbucket Cloud uses bare names for read access and suffixes only for write/admin:

| Operation | Correct Scope |
|-----------|---------------|
| Read repositories | `repository` |
| Read pull requests | `pullrequest` |
| Read issues | `issue` |
| Write pull request comments | `pullrequest:write` |
| Write/create issues | `issue:write` |
| Register webhooks | `webhook` |
| Read user profile | `account` |

The `:read` suffix pattern does not exist. Replace every instance of `repository:read`, `pullrequest:read`, `issue:read`, and `account:read` with the bare scope names.

---

### 3. OAuth 2.0 refresh token requires `offline_access` scope, not documented

**Issue**: Section 2.1.2 states refresh tokens are obtained "with `offline_access` scope" in a parenthetical, but `offline_access` is not listed in the OAuth scopes table and the implication is that refresh tokens are returned automatically.

**Why it matters**: Without explicitly requesting `offline_access` in the authorization URL, the authorization server will not issue a refresh token. The OAuth integration would break on first token expiry (1 hour for Cloud).

**Correction**: Add `offline_access` explicitly to the scopes table and document that it must be appended to the `scope` parameter of the authorization URL. Note that `offline_access` is not selectable in the Bitbucket app permissions UI — it must be manually added to the auth URL scope string. Also, the Atlassian refresh token endpoint is `https://auth.atlassian.com/oauth/token`, not `https://bitbucket.org/site/oauth2/access_token` — verify whether these are now different (Atlassian has been migrating to the central auth domain).

---

### 4. OAuth Client Credentials grant is not documented

**Issue**: The document lists only "Authorization Code Grant" under OAuth 2.0 (section 2.1.2). Bitbucket Cloud also supports the Client Credentials grant (RFC 6749 §4.4), which is suitable for server-to-server integrations where no user interaction is possible.

**Why it matters**: For a support-agent integration running as a backend service, the Client Credentials flow is often more appropriate than 3LO. Omitting it means implementers will default to 3LO unnecessarily.

**Correction**: Add a sub-section for Client Credentials grant. Endpoint: `POST https://bitbucket.org/site/oauth2/access_token` with `grant_type=client_credentials`. Note that this flow returns an access token representing the OAuth consumer owner (the registered app), not an end user.

---

### 5. Workspace/Project/Repository Access Tokens not documented

**Issue**: The document does not mention Bitbucket Cloud's resource-scoped Access Tokens (repository access tokens, project access tokens, workspace access tokens). These are distinct from user-level API Tokens.

**Why it matters**: Resource access tokens are not tied to a user account and are preferred for CI/CD and service integrations because they do not become invalid if the creating user leaves the workspace. Ignoring them leaves the connector at risk of broken auth when a team member's account is deactivated.

**Correction**: Add section 2.1.4 (or similar) documenting the three access token types:
- Repository Access Token — single-repo scope, `Bearer` header
- Project Access Token — all repos in a project, `Bearer` header  
- Workspace Access Token — all projects/repos in workspace, `Bearer` header

These are created at the resource level (not user account settings) and use `Authorization: Bearer {token}`.

---

### 6. Webhook signature header claim is wrong — only `X-Hub-Signature` exists

**Issue**: Section 3.1.3 claims Bitbucket Cloud sends both `X-Hub-Signature` and `X-Hub-Signature-256`. Official Atlassian documentation and the published Python sample code confirm only `X-Hub-Signature` is sent (with value `sha256=<hex>`).

**Why it matters**: Code that reads `X-Hub-Signature-256` will always find it missing and either silently skip verification (security bypass) or always reject valid webhooks (outage).

**Correction**: Remove `X-Hub-Signature-256`. The only header is:
```
X-Hub-Signature: sha256={hmac_hex_digest}
```
Atlassian's own documentation notes: "Right now, Bitbucket will send HMACs using sha256. This might change in the future." Implement header reading against `X-Hub-Signature` only.

---

### 7. No replay protection exists — checklist item is misleading

**Issue**: Appendix B's webhook security checklist item says to "Consider webhook signature algorithm preference (`sha256` over `sha1`)". The implication is that `sha1` may be sent. Official docs say only `sha256` is used. More importantly, there is no mention that Bitbucket provides no timestamp or nonce for replay protection.

**Why it matters**: Implementers may assume replay protection is handled at the platform level. It is not — Bitbucket provides only payload integrity verification via HMAC, not freshness guarantees.

**Correction**: Remove the `sha1` implication. Add an explicit note that Bitbucket webhooks carry no timestamp or nonce. Implementers must implement their own replay protection (e.g., store and deduplicate on a delivery ID or use a short-lived idempotency window based on event payload hash).

---

### 8. OAuth 2.0 `offline_access` scope missing from scopes table

**Issue**: Related to finding 3 but worth a separate callout: the scopes table in section 2.1.2 does not include `offline_access`, `email`, `wiki`, `snippet`, `runner`, or `runner:write`, all of which exist in the real scope registry.

**Why it matters**: Incomplete scope documentation leads to under-scoped or over-scoped OAuth app registrations.

**Correction**: Add at minimum `offline_access` (required for refresh tokens) and `email` (commonly needed for user identity mapping). Document that `snippet`, `wiki`, and `runner` exist but are out of scope for this connector.

---

### 9. Data Center OAuth — wrong protocol listed in comparison table

**Issue**: The overview comparison table (section 1) says Data Center supports "OAuth 1.0a + Basic Auth + PAT". Section 2.2.3 says Data Center uses "OAuth 1.0a (3-legged)". This is correct for older Server versions but Data Center 7.17+ also added OAuth 2.0 support via Application Links.

**Why it matters**: Listing only OAuth 1.0a for Data Center may cause implementers to avoid the newer flow on recent Data Center versions, or to implement the wrong flow.

**Correction**: Note that Data Center 7.17+ supports OAuth 2.0 via Application Links in addition to OAuth 1.0a. For integrations targeting modern Data Center deployments, prefer OAuth 2.0. OAuth 1.0a should be documented as the legacy fallback for older versions only.

---

### 10. Secret-type classification missing from config schema

**Issue**: The `BitbucketConfig` interface in section 11 stores `accessToken` and `webhookSecret` as plain `string` fields with no classification. The platform-registry secret-type model is not applied — there is no `api_key`, `webhook_secret`, or `oauth_token` type annotation.

**Why it matters**: Without explicit type classification, the encryption-at-rest and secret-rotation logic in the connector framework cannot correctly identify which fields require vault storage vs. configuration storage.

**Correction**: Annotate the config schema with secret types consistent with the platform registry:
```typescript
interface BitbucketConfig {
  authType: 'api_token' | 'oauth2' | 'access_token';
  // secret_type: api_key — encrypted at rest
  accessToken: string;
  // secret_type: webhook_secret — encrypted at rest
  webhookSecret?: string;
  workspaceSlug: string;
  defaultRepoSlug?: string;
  botUsername?: string;
}
```
The `authType` value `'pat'` used in the document does not match the actual credential type (which is now an API Token, not a PAT in the traditional sense).

---

### 11. MVP recommendation needs revision

**Issue**: Section 2.1.1 recommends App Passwords as "MVP preferred". Given the deprecation timeline (App Passwords disabled June 2026), this recommendation is actively harmful.

**Why it matters**: Any connector built today following the MVP recommendation will require urgent rework before or shortly after launch.

**Correction**: The MVP recommendation should be updated to:
- **Primary**: API Token (user-scoped, Basic auth with email:token, max 1-year expiry, must be rotated)
- **Preferred for services**: Workspace or Project Access Token (resource-scoped, Bearer auth, no forced expiry)
- **OAuth 2.0**: Appropriate when acting on behalf of end users (marketplace/multi-tenant scenarios)

Document that API Tokens require rotation logic (max 1 year lifetime) whereas resource Access Tokens do not expire unless explicitly revoked.

---

## Summary Table

| # | Area | Severity | Type |
|---|------|----------|------|
| 1 | App Passwords deprecated | Critical | Outdated |
| 2 | Scope names use non-existent `:read` suffix | Critical | Wrong |
| 3 | `offline_access` scope not documented for OAuth | High | Missing |
| 4 | Client Credentials grant not documented | Medium | Missing |
| 5 | Resource Access Tokens not documented | High | Missing |
| 6 | Wrong webhook signature header (`X-Hub-Signature-256`) | High | Wrong |
| 7 | No replay protection disclosure | Medium | Missing / Misleading |
| 8 | Incomplete OAuth scopes table | Medium | Missing |
| 9 | Data Center OAuth 2.0 omitted | Low | Missing |
| 10 | Secret-type classification absent from config schema | Medium | Missing |
| 11 | MVP recommendation points to deprecated mechanism | Critical | Outdated |
