# Auth Review — GitHub Issues Connector

**Verdict**: Mostly correct with good coverage of the three main auth mechanisms. Several inaccuracies require correction before implementation, particularly around OAuth scope names, token lifetime claims, JWT signing details, webhook replay protection, and the PAT header for classic tokens.

---

## Findings

### 1. OAuth scope names are wrong

**Issue**: The OAuth App section lists `read:issues` and `write:issues` as valid OAuth scopes. These scopes do not exist on GitHub.

**Why it matters**: Implementers will request non-existent scopes, causing OAuth authorization to fail or silently fall back to no-scope access.

**Correction**: GitHub OAuth Apps use coarse-grained repository scopes only. The correct scopes are:
- `repo` — full read/write access to private and public repositories (includes issues, comments, labels, assignees)
- `public_repo` — same as `repo` but restricted to public repositories
- There is no `read:issues` or `write:issues` OAuth scope. Fine-grained permission names like "Issues: Read" apply only to fine-grained PATs and GitHub App permissions — not OAuth App scopes.

Update the OAuth scope table to:
| Capability | Scope |
|------------|-------|
| Read issues (private repos) | `repo` |
| Write issues/comments (private repos) | `repo` |
| Read/write issues (public repos only) | `public_repo` |

---

### 2. OAuth token lifetime claim is inaccurate

**Issue**: The doc states OAuth token lifetime is "8 hours, refreshable."

**Why it matters**: Classic GitHub OAuth App tokens do not expire after 8 hours. Treating them as short-lived will cause unnecessary re-auth flows and confuse implementers.

**Correction**: Classic GitHub OAuth App access tokens do **not** expire (they are non-expiring by default). GitHub introduced expiring tokens via the `expire_oauth_tokens` setting for OAuth Apps, but this is opt-in per app and off by default. If the app enables token expiry, tokens last for 8 hours and a refresh token (valid 6 months) is provided. The doc must distinguish between the default (non-expiring) and the opt-in expiring token mode, and document the refresh grant (`POST /login/oauth/access_token` with `grant_type=refresh_token`) only in the expiring-token path.

---

### 3. PAT header format does not cover classic PATs

**Issue**: The PAT section documents only `Authorization: Bearer <token>` and recommends fine-grained PATs.

**Why it matters**: Classic PATs (`ghp_...` prefix) also use `Authorization: token <token>` or `Authorization: Bearer <token>` — both are accepted. Fine-grained PATs (`github_pat_...` prefix) require `Authorization: Bearer <token>`. However, classic PATs are still widely used; the doc silently ignores them. More critically, fine-grained PATs are currently **not available for GitHub Enterprise Server versions prior to GHES 3.4**, which the doc itself notes in the plan table.

**Correction**: Add a note distinguishing the two PAT types:
- Fine-grained PAT (recommended, `github_pat_...`): `Authorization: Bearer <token>`
- Classic PAT (`ghp_...`): `Authorization: token <token>` or `Authorization: Bearer <token>` (both accepted)

For GHES < 3.4, classic PAT is the only option. The MVP config should accept both.

---

### 4. GitHub App JWT signing details are incomplete

**Issue**: The GitHub App section says "Generate JWT using app's private key" but does not specify the JWT algorithm, claims, or expiry.

**Why it matters**: Using the wrong algorithm or claim set will cause the JWT exchange to fail with a cryptic 401. The exact JWT structure is required for implementation.

**Correction**: GitHub requires the JWT to be signed with **RS256** (not HS256). The required JWT claims are:
- `iat` — issued-at (seconds since epoch, allow up to 60s clock skew by subtracting 60)
- `exp` — expiry (`iat + 600` seconds maximum, 10-minute max lifetime)
- `iss` — GitHub App ID (numeric, as a string)

JWT header must specify `"alg": "RS256"`. Example:
```typescript
const jwt = sign({ iss: appId }, privateKeyPem, {
  algorithm: 'RS256',
  expiresIn: 600
});
```
The private key is a PEM-encoded RSA key downloaded from the GitHub App settings page.

---

### 5. Installation token exchange endpoint is missing

**Issue**: The GitHub App section describes the two-step JWT → installation token flow but does not name the exchange endpoint.

**Why it matters**: Without the endpoint, developers must look it up separately, and subtle mistakes (wrong path, wrong method) will break auth silently.

**Correction**: Add the exchange endpoint explicitly:
```
POST /app/installations/{installation_id}/access_tokens
Authorization: Bearer <jwt>
```
Returns `{ token, expires_at, permissions, repository_selection }`. The `token` is the installation access token used for all subsequent API calls.

---

### 6. Webhook replay protection is not addressed

**Issue**: The webhook HMAC section covers signature verification correctly but says nothing about replay attacks.

**Why it matters**: An attacker who captures a valid webhook delivery can replay it. Without timestamp validation, every verified signature will be accepted indefinitely.

**Correction**: Add guidance to check the delivery timestamp. GitHub sends `X-GitHub-Delivery` (a UUID, not a timestamp) and does not include a signed timestamp header. The practical mitigation is:
- Track processed `X-GitHub-Delivery` UUIDs in a short-lived store (e.g., Redis, TTL 1–5 minutes) and reject duplicates.
- For stricter replay protection, record the delivery UUID persistently and reject any duplicate regardless of age.

Document this as a required implementation step alongside the HMAC check, not optional.

---

### 7. Webhook secret is marked `required: false` but should be effectively required

**Issue**: In the MVP admin panel config, `webhook_secret` has `required: false`.

**Why it matters**: Operating a webhook endpoint without signature verification allows any party to inject arbitrary events. This is a significant security risk for a support automation system.

**Correction**: Change `required` to `true` for `webhook_secret`, or at minimum surface a strong warning in the UI and documentation that omitting the secret disables integrity verification. Failing open on webhook auth is unsafe.

---

### 8. GitHub App webhook permissions are understated

**Issue**: The GitHub App permissions table lists "Webhooks: Read & write (for subscription management)." This conflates two separate permission surfaces.

**Why it matters**: Requesting the wrong permission scope will cause webhook registration calls to fail, and over-requesting permissions raises security concerns during app review.

**Correction**: For GitHub Apps, webhook subscriptions are defined at app registration time (not per-installation at runtime). The app subscribes to events in its settings; no "Webhooks" permission is needed for receiving events. The "Webhooks" permission (`administration: write` or `hooks` write) is only required if the connector programmatically creates or manages repository webhooks via the API (`POST /repos/{owner}/{repo}/hooks`). Clarify this distinction:
- Receiving webhook events: no special permission needed beyond having the event subscribed at app registration
- Creating/managing webhooks via API: requires `administration: write` (repository) or org-level `administration: write`

---

### 9. Missing: GitHub App `installation_id` discovery

**Issue**: The GitHub App auth flow mentions using installation access tokens but does not explain how to discover the `installation_id` for a given organization or repository.

**Why it matters**: Without this, multi-tenant onboarding is incomplete. The installation ID is required to call the exchange endpoint.

**Correction**: Add the discovery endpoints:
```
GET /app/installations                         # list all installations
GET /repos/{owner}/{repo}/installation         # get installation for a specific repo
GET /orgs/{org}/installation                   # get installation for a specific org
GET /users/{username}/installation             # get installation for a user account
```
All of these require the JWT (not an installation token) in the `Authorization` header.

---

### 10. Missing: Device flow / CLI flow not mentioned

**Issue**: The document does not mention the OAuth Device Flow, which GitHub supports for headless or CLI auth scenarios.

**Why it matters**: For the review to be complete, all supported mechanisms must be present or explicitly excluded. If the connector is ever used in a CLI or admin-CLI context, device flow is the correct OAuth path.

**Correction**: Add a brief note acknowledging the device flow exists (`POST /login/device/code` → poll `POST /login/oauth/access_token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`) and explicitly mark it as out of scope for MVP. This prevents a reviewer from wondering if it was simply missed.

---

### 11. `secretType: 'api_key'` for PAT is acceptable but inconsistent with GitHub terminology

**Issue**: The MVP config assigns `secretType: 'api_key'` to the `access_token` field. A GitHub PAT is not technically an API key.

**Why it matters**: If the platform registry distinguishes between `pat`, `api_key`, `oauth_token`, and `service_account`, using `api_key` for a PAT may route the credential to the wrong secret storage tier or audit category.

**Correction**: If the platform registry supports a `pat` secret type, use it. If only `api_key` and `oauth_token` are defined, `api_key` is acceptable as a fallback — document the choice explicitly. When GitHub App support is added, the installation access token should be classified differently (it is ephemeral and auto-rotated, not a long-lived secret).

---

### 12. SAML SSO PAT authorization gap understated

**Issue**: The multi-tenant gotchas section notes "Fine-grained PATs require per-organization SAML authorization" but does not explain the failure mode or detection path.

**Why it matters**: A PAT that has not been SAML-authorized will return `403` with a specific error body (`{"message":"Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization."}`), not a generic auth failure. Without this, implementers will misdiagnose the error.

**Correction**: Document the `403` SAML enforcement error body. Add a setup step in the connector config UI or documentation: after generating the PAT, the user must visit GitHub Settings → Personal access tokens → select the token → "Configure SSO" → authorize for the required org. Without this step, the connector will silently fail on SSO-enforced orgs.

---

### 13. No mention of token scope validation on connector setup

**Issue**: The connector does not describe any validation step to verify the provided PAT or installation token has the required permissions at setup time.

**Why it matters**: A user may provide a token with insufficient scope. Without proactive validation, errors surface at runtime during issue processing, which is harder to diagnose.

**Correction**: Add a recommended validation call on connector save:
```
GET /user      # verifies token is valid and returns authenticated identity
GET /repos/{owner}/{repo}  # verifies Issues: Read access to the target repo
```
Surface any `403` or scope mismatch to the user during setup. This is a standard connector best practice.

---

## Summary Table

| # | Finding | Severity |
|---|---------|----------|
| 1 | OAuth scopes `read:issues` / `write:issues` do not exist | High — blocks OAuth implementation |
| 2 | OAuth token "8 hours, refreshable" is wrong by default | Medium — misleading behavior |
| 3 | Classic PAT token format undocumented | Low — informational gap |
| 4 | GitHub App JWT algorithm and claims not specified | High — required for implementation |
| 5 | Installation token exchange endpoint missing | High — required for implementation |
| 6 | Webhook replay protection absent | Medium — security gap |
| 7 | `webhook_secret` marked `required: false` | Medium — security risk |
| 8 | GitHub App webhook permissions conflated | Medium — incorrect permission advice |
| 9 | `installation_id` discovery endpoints missing | Medium — multi-tenant gap |
| 10 | Device flow not mentioned or excluded | Low — completeness gap |
| 11 | `secretType: 'api_key'` for PAT may be wrong type | Low — registry-dependent |
| 12 | SAML SSO `403` error body undocumented | Low — diagnosability gap |
| 13 | No token validation step on connector setup | Low — operational quality gap |
