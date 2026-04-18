# Auth Review: GitLab Connector

**Verdict:** Mostly accurate with one factual error on the alternative Bearer header, one gap on the `self_rotate` scope, one missing auth mechanism (deploy tokens), a misleading description of replay protection, and a subtle webhook registration endpoint discrepancy. No critical security holes, but the items below need correction before implementation.

---

## Findings

### 1. Alternative Bearer header claim is incorrect

- **Issue:** Section 2.1 states `Authorization: Bearer <token>` works "only if token type is `Bearer`". GitLab does not have a token type called "Bearer" for PATs — `PRIVATE-TOKEN` is always the correct header for PATs. `Authorization: Bearer <token>` is the correct header specifically for OAuth2 access tokens, not for PATs.
- **Why it matters:** Mixing up the headers will cause 401s. A developer reading this might try `Authorization: Bearer` with a PAT and spend time debugging an avoidable failure.
- **Correction:** Remove the alternative header note from section 2.1 entirely. Add a clear statement in section 2.2: OAuth2 access tokens use `Authorization: Bearer <access_token>`. PATs always use `PRIVATE-TOKEN: <token>`. The two are mutually exclusive.

---

### 2. `self_rotate` scope not defined or verified

- **Issue:** The MVP recommendation says "Rotate manually or via `self_rotate` scope." The `self_rotate` scope is not listed in GitLab's public PAT scope documentation. It does not appear to be a real GitLab PAT scope.
- **Why it matters:** If an implementer tries to request this scope during token creation it will fail silently (GitLab ignores unknown scopes) or produce an error. Rotation via API uses the `POST /personal_access_tokens/self/rotate` endpoint, which requires the `api` scope — not a special `self_rotate` scope.
- **Correction:** Remove the `self_rotate` reference. The correct rotation path is `POST /personal_access_tokens/self/rotate` (available since GitLab 16.0), which requires an existing token with `api` scope. Document this instead.

---

### 3. Missing auth mechanism: Deploy Tokens

- **Issue:** GitLab supports deploy tokens (`read_repository`, `write_repository`, `read_registry`, `write_registry`, `read_package_registry`, `write_package_registry`) scoped to a project or group. They are distinct from PATs and service account tokens and are commonly used for CI/CD access. They are not mentioned.
- **Why it matters:** A tenant connecting a self-managed GitLab instance may already have deploy tokens in use for CI pipelines. The connector design should explicitly call out that deploy tokens are not suitable for this connector (they do not support the Issues/Notes API) to avoid confusion.
- **Correction:** Add a brief note under section 2 (or 2.5 summary) stating deploy tokens exist but are not applicable — they only cover repository/registry operations, not the Issues or Notes REST APIs.

---

### 4. No replay protection exists — the doc does not flag this gap clearly enough

- **Issue:** Section 3.2 correctly states there is no HMAC, only a shared secret string comparison. However, the doc does not explicitly flag that GitLab provides no timestamp, nonce, or delivery ID that can be used for replay protection. The `Idempotency-Key` header mentioned in section 3.3 is presented as a replay-protection tool but its semantics are described as "not clearly documented" in section 10.10.
- **Why it matters:** Without replay protection, a captured `X-Gitlab-Token` header value plus a captured payload can be replayed by an attacker indefinitely. The connector must implement its own replay protection (short-window timestamp check, delivery ID deduplication, or both). Presenting `Idempotency-Key` as sufficient replay protection without caveat is misleading.
- **Correction:** Add an explicit security note in section 3.2: GitLab's webhook mechanism provides no replay protection. The `X-Gitlab-Token` comparison only proves the sender knew the secret at some point. Implement connector-side deduplication using `Idempotency-Key` combined with a narrow time window (e.g., reject events older than 5 minutes based on `object_attributes.updated_at`).

---

### 5. Webhook registration endpoint is wrong

- **Issue:** Section 3.1 shows the webhook registration endpoint as:
  ```
  POST /projects/:id/integrations/webhooks
  ```
  The correct GitLab REST API v4 endpoint is:
  ```
  POST /projects/:id/hooks
  ```
  The `/integrations/webhooks` path does not exist in the current GitLab REST API v4 documentation.
- **Why it matters:** Using the wrong endpoint will return 404 during webhook provisioning.
- **Correction:** Change the endpoint to `POST /projects/:id/hooks`. For group-level webhooks: `POST /groups/:id/hooks`. The field names (`url`, `secret_token`, `push_events`, `issues_events`, etc.) are correct — only the path is wrong.

---

### 6. OAuth2 client credentials flow not mentioned

- **Issue:** Section 2.2 documents only the authorization code flow with PKCE. GitLab also supports OAuth2 client credentials flow (for server-to-server, no user involved) via `POST /oauth/token` with `grant_type=client_credentials`. This is relevant when the connector acts as a server-side integration without a user-facing OAuth consent step.
- **Why it matters:** For a multi-tenant SaaS connector where each tenant registers an OAuth app, the client credentials flow may be more appropriate than auth-code-with-PKCE if user identity delegation is not required. Omitting it means the Phase 2 OAuth design may be overcomplicated.
- **Correction:** Add a note in section 2.2 that GitLab supports client credentials grant for server-to-server OAuth. Scopes available are the same. Access token lifetime is 2 hours; no refresh token is issued for client credentials — the client must re-authenticate. Clarify when each flow is appropriate.

---

### 7. Token lifetime for service account tokens may be inaccurate for GitLab.com

- **Issue:** Section 2.1 states service account tokens "can be set to never expire." Section 10.2 partially corrects this: "GitLab.com service accounts have admin-configured expiry." However, as of GitLab 16.0, GitLab.com enforces that all new PATs (including service accounts on GitLab.com) must have an expiry date — never-expiring tokens are only possible on self-managed instances where an admin has disabled the expiry requirement.
- **Why it matters:** If a tenant is on GitLab.com and the connector design assumes non-expiring tokens, the connector will break silently when the token expires and there is no rotation logic in place.
- **Correction:** Clarify in section 2.1: on GitLab.com, all PATs (including service accounts) must have an expiry as of GitLab 16.0. Never-expiring tokens are only available on self-managed instances with the admin setting explicitly disabled. Implement token expiry tracking and alerting regardless.

---

### 8. `read_api` scope is read-only — insufficient for all listed operations

- **Issue:** The scope table in section 2.1 lists `read_api` as sufficient for "Read issues, MRs, comments" and "Read projects/members." This is correct. However, the table implies `api` is only needed for create/update/webhook operations. This is fine, but the MVP config in section 11 lists only `api` scope for `botToken` — which is correct but not explained. A developer following section 2.1 might provision a PAT with only `read_api` and discover it cannot register webhooks.
- **Why it matters:** Under-scoped tokens will produce 403s on webhook registration without a clear error message pointing to the scope.
- **Correction:** Add a clear callout in section 2.1: for the MVP connector, provision the PAT with `api` scope only — it is a superset of `read_api`. Using both is redundant. The scope table is useful for documentation but could cause confusion.

---

### 9. Secret-type classification not explicitly mapped to a registry schema

- **Issue:** The document never names the `secret_type` values that would be stored in the platform-registry (e.g., `api_key`, `webhook_secret`, `service_account`). Section 11 lists config field names (`botToken`, `webhookSecret`) but does not assign them registry secret types.
- **Why it matters:** Connector registration in the platform registry requires consistent `secret_type` values. Without explicit classification, the connector developer may invent ad-hoc names that don't align with the registry schema.
- **Correction:** Add a credentials classification table, e.g.:

  | Field | `secret_type` | Notes |
  |---|---|---|
  | `botToken` | `api_key` | PAT; treat as opaque bearer credential |
  | `webhookSecret` | `webhook_secret` | Shared secret; plain string comparison |
  | OAuth `client_secret` (Phase 2) | `oauth_client_secret` | Per-tenant OAuth app secret |

---

### 10. No mention of token verification endpoint for boot-time validation

- **Issue:** The document does not mention `GET /user` (or `GET /personal_access_tokens/self`) as a way to verify token validity and retrieve the bot's own user ID at startup.
- **Why it matters:** The MVP config requires `botUserId` to be set manually. If the connector can call `GET /user` with the PAT at boot, it can self-populate `botUserId` and `botUsername` instead of requiring manual entry — and it validates the token is working before accepting the first webhook.
- **Correction:** Add a note in section 11 (MVP config) or section 2.1: on connector initialization, call `GET /user` (returns `{ id, username, name, ... }`) to validate the PAT and auto-populate bot identity fields. This also surfaces expired or revoked tokens early.
