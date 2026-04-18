# Auth Review — GitHub Connector

**Verdict**: Mostly accurate and well-structured. Several gaps and one unsafe claim need correction before this drives implementation.

---

## Findings

### 1. `X-GitHub-Token` header claim is incorrect

- **Issue**: Section 2A states the PAT can be sent via `Authorization: Bearer <token>` **or** `X-GitHub-Token: <token>`. The `X-GitHub-Token` header is not a valid GitHub REST API authentication header. GitHub accepts `Authorization: Bearer <token>` and the legacy `Authorization: token <token>` form, not `X-GitHub-Token`.
- **Why it matters**: An implementation that sends `X-GitHub-Token` will get 401 responses on every request without a clear error message.
- **Correction**: Remove `X-GitHub-Token: <token>` from the documented options. Valid forms are `Authorization: Bearer <token>` (preferred) and `Authorization: token <token>` (legacy, still accepted).

---

### 2. OAuth 2.0 device flow and client credentials flow are unmentioned

- **Issue**: The document lists PAT, GitHub App installation token, OAuth App, and `local_gh`. It does not mention OAuth 2.0 device flow (supported for CLI/headless tooling) or the GitHub App's JWT-signed request pattern as a first-class mechanism.
- **Why it matters**: The review scope requires all supported mechanisms to be listed. Device flow is relevant if SupportAgent ever needs to authenticate on behalf of a user without a redirect URI. The JWT-to-installation-token exchange (App auth step 1) is the primary GitHub App server-to-server flow and should be clearly documented as a distinct step, not buried in a note.
- **Correction**: Add a sub-section under GitHub App auth documenting the two-step flow: (1) sign a JWT with the App's private key (`RS256`, 10-minute max expiry), send as `Authorization: Bearer <jwt>` to `POST /app/installations/{id}/access_tokens`; (2) use the returned installation token (`Authorization: Bearer <installation_token>`) for all repo/org operations. Separately note that OAuth 2.0 device flow exists (`POST https://github.com/login/device/code`) but is not needed for server-to-server use.

---

### 3. GitHub App JWT details are absent

- **Issue**: Section 2B says installation tokens are obtained from `POST /app/installations/{installation_id}/access_tokens` but does not document how the caller authenticates *that* request. The answer is a short-lived JWT signed with the App's `RS256` private key. The JWT payload requires `iss` (App ID), `iat` (issued-at), `exp` (issued-at + ≤10 minutes).
- **Why it matters**: Without this, the implementation has no way to obtain installation tokens. Anyone reading only this doc will be stuck at the first API call.
- **Correction**: Add to section 2B: "To call `/app/installations/{id}/access_tokens`, construct a JWT with `{ iss: app_id, iat: now - 60s (clock skew buffer), exp: iat + 600 }`, signed with the App's PEM private key using RS256. Send as `Authorization: Bearer <jwt>`. The JWT itself is valid for ≤10 minutes."

---

### 4. Installation token scope/permissions not documented

- **Issue**: Section 2B lists App-level permission settings (Issues, Pull requests, etc.) but does not state what permissions can be requested when minting a specific installation token, nor that tokens inherit only the permissions granted at install time.
- **Why it matters**: If the App requests `{ "permissions": { "issues": "write" } }` when the installation only granted `read`, the token will have only `read`. This causes silent capability degradation at runtime.
- **Correction**: Add a note: "When calling `/app/installations/{id}/access_tokens`, you may optionally pass `{ "permissions": {...}, "repositories": [...] }` to further restrict the token. The token will never exceed the permissions granted by the installation. If no body is sent, the token inherits all installation permissions."

---

### 5. Classic PAT has no expiry — security advice is incomplete

- **Issue**: Section 2A notes "Classic PATs: no expiry (unless revoked)" as a factual statement without any security guidance. Classic PATs with `repo` scope are highly privileged long-lived credentials.
- **Why it matters**: Storing a non-expiring `repo`-scoped PAT in a connector config is a significant blast radius. Leakage means permanent access until manual revocation. This requires explicit guidance.
- **Correction**: Add: "Classic PATs with `repo` scope are effectively permanent read/write credentials for all private repos the user can access. Prefer fine-grained PATs with repository-scoped permissions and a 1-year expiry. If classic PATs must be used, document the rotation procedure and enforce secret scanning alerts on the GitHub org."

---

### 6. Fine-grained PAT scope for webhook registration is missing

- **Issue**: Section 2A's scope table lists `admin:repo_hook` / `admin:org_hook` for registering webhooks under classic PATs but does not specify the equivalent fine-grained PAT permission.
- **Why it matters**: Teams migrating to fine-grained PATs will be unable to register webhooks without the correct permission name.
- **Correction**: Add a column or note: "Fine-grained equivalent: `Webhooks: Read & Write` (repository permission) for repo-level hooks; organization webhooks require `Organization webhooks: Read & Write` (organization permission)."

---

### 7. `read:org` scope justification is incomplete

- **Issue**: Section 2A lists `read:org` for "List org memberships" without stating what the fine-grained PAT equivalent is, and without noting that `read:org` on a classic PAT also exposes team membership for all orgs the user belongs to.
- **Why it matters**: Over-scoping. `read:org` grants broad org visibility, not just membership listing.
- **Correction**: Narrow the description: "List org repos / discover orgs the token has access to. Fine-grained PAT equivalent: `Members: Read` (organization permission). Classic `read:org` is broader than needed if only repo discovery is required."

---

### 8. Webhook replay protection is not documented

- **Issue**: Section 3 documents `X-Hub-Signature-256` verification and `X-GitHub-Delivery` deduplication, but does not document timestamp-based replay protection. GitHub does not include a timestamp in the webhook payload or headers, so the only replay protection available is the delivery UUID.
- **Why it matters**: Without noting this limitation, an implementer might expect a timestamp check (as other platforms provide) and be confused when none exists, or might assume the current deduplication approach is insufficient.
- **Correction**: Add: "GitHub webhooks do not include a delivery timestamp in headers. Replay protection relies entirely on the `X-GitHub-Delivery` UUID. Store processed UUIDs with a TTL matching your acceptable replay window (24h is sufficient given GitHub's retry window). There is no `X-GitHub-Timestamp` or similar header to validate delivery recency."

---

### 9. `secret_type` classification for platform-registry is missing

- **Issue**: The document refers to `webhook_secret` in connector config but does not classify secret types using the platform-registry naming convention (`api_key`, `webhook_secret`, `oauth_client_secret`, `private_key`, etc.).
- **Why it matters**: Registry consumers need consistent type labels to apply correct secret handling (encryption at rest, masking in logs, rotation policy).
- **Correction**: Add a secret-type classification table:

  | Config Field | `secret_type` | Notes |
  |---|---|---|
  | `access_token` (PAT) | `api_key` | |
  | `webhook_secret` | `webhook_secret` | |
  | `private_key` (GitHub App) | `private_key` | PEM, RSA, store encrypted |
  | `client_secret` (OAuth App) | `oauth_client_secret` | If OAuth App path is ever used |

---

### 10. OAuth App section undersells its real risk

- **Issue**: Section 2C says OAuth App is "not recommended for server-side connectors" and is "equivalent to PAT for server use." This is misleading. OAuth App tokens act as the *user*, not the app, for rate limiting and audit. They also require a human OAuth dance to obtain the initial token.
- **Why it matters**: "Equivalent to PAT" could lead an implementer to treat OAuth App tokens as drop-in PAT replacements, which is wrong for multi-tenant deployments.
- **Correction**: Replace with: "OAuth Apps issue tokens that act on behalf of a specific user, count against that user's rate limit, and require a user-initiated OAuth redirect flow. They are not suitable for unattended server-to-server automation. Use GitHub App installation tokens instead."

---

### 11. MVP recommendation is justified but should note fine-grained PAT preference

- **Issue**: The MVP recommendation (Phase 1: PAT) is reasonable for setup simplicity. However, it defaults to classic PATs without mentioning that fine-grained PATs are now GA and should be the preferred PAT type for new integrations.
- **Why it matters**: Recommending classic PATs in 2024+ nudges users toward over-privileged, non-expiring credentials when fine-grained PATs are available and safer.
- **Correction**: Update Phase 1 recommendation: "Phase 1: Fine-grained PAT preferred (repository-scoped, 1-year expiry, explicit permission grants). Classic PAT acceptable for legacy GHES versions that do not yet support fine-grained PATs."

---

### 12. No mention of GitHub App private key rotation

- **Issue**: Section 2B describes GitHub App token lifetime (1-hour installation tokens) but does not address private key rotation. GitHub App private keys do not expire automatically — they must be manually rotated.
- **Why it matters**: Leaked private keys allow minting unlimited installation tokens until the key is revoked. No rotation guidance means keys may never be rotated.
- **Correction**: Add: "GitHub App private keys do not expire. Rotate them manually via the App settings page. Store only the active key in the secret store; revoke the old key after confirming the new key is in use. Consider a rotation policy of 90–180 days."

---

## Minor / Non-Blocking Notes

- The `Authorization: token <token>` legacy form is still accepted by GitHub for PATs and installation tokens. Not a bug in the current doc (which uses `Bearer`), but worth noting for compatibility with older code.
- The document correctly notes `timingSafeEqual` for signature comparison — this is correct and safe.
- The `X-GitHub-Event` header value for `issues.opened` is actually `issues` (event type) with `action: opened` in the payload body — not `issues.opened` in the header itself. The header carries `issues`, not `issues.opened`. This is a naming convention issue in the triggers table (section 6) rather than an auth issue, noted here for completeness.
