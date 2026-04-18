# GitLab Connector — Authentication Review

**Reviewed by:** Auth & Credentials Audit
**Source:** `docs/connectors/gitlab.md`
**Scope:** Authentication and credentials only. No other aspects reviewed.

---

## Verdict

**Auth section has significant accuracy issues.** Two claims are internally contradicted within the same document, Project Access Token availability on GitLab.com Free is misrepresented, three relevant auth mechanisms are entirely missing, and the webhook security advice has a timing-attack vulnerability. Fix these before the connector ships.

---

## Findings

### 1. Internal contradiction: "Never-expire" PATs

- **Issue:** Section 2.1 says "Service accounts can have non-expiring PATs if enabled by group owner or admin."
- **Why it matters:** Section 10.2 says "GitLab.com service accounts have admin-configured expiry." These two statements contradict each other. Non-expiring PATs are only supported on **GitLab Self-Managed** (admin-configurable), not GitLab.com. Any tenant on gitlab.com will hit an expiry.
- **Concrete correction:** Split the claim:
  - *GitLab Self-Managed:* Admins can set tokens to never expire.
  - *GitLab.com:* Service account tokens always have admin-configured expiry (GitLab does not support truly non-expiring tokens on SaaS). Update section 2.1 to reflect this.

---

### 2. Internal contradiction: Project/Group Access Token availability

- **Issue:** Section 2.5 table lists "Project/Group access token" with no tier restriction. Section 10.2 says Project Access Tokens require GitLab.com Premium/Ultimate. Meanwhile, Group Access Tokens are available on **all tiers** (Free, Premium, Ultimate) on GitLab.com — the opposite of what the table implies.
- **Why it matters:** A connector deployer reading section 2.5 would think Group Access Tokens are available on GitLab.com Free, which is true. But the 10.2 note only mentions Project Access Token restrictions. The asymmetry is confusing and could cause misconfiguration.
- **Concrete correction:** Replace the table entry in section 2.5 with two separate rows:

  | Token Type | GitLab.com | Self-Managed | Lifetime |
  |---|---|---|---|
  | Project Access Token | **Premium/Ultimate only** | All tiers | Admin-configurable, max 365d (400d with flag) |
  | Group Access Token | All tiers | All tiers | Admin-configurable, max 365d (400d with flag) |

---

### 3. Missing auth mechanism: CI/CD Job Tokens

- **Issue:** CI/CD Job Tokens are not mentioned anywhere in the auth section.
- **Why it matters:** Job tokens use the `JOB-TOKEN` header (not `PRIVATE-TOKEN`) and are restricted to a specific allowlist of API endpoints. They are **not** suitable for this connector, but the absence creates a gap — someone might wonder "why isn't CI_JOB_TOKEN covered?" and incorrectly try to use it. Additionally, understanding that `JOB-TOKEN` is a separate auth mechanism from `PRIVATE-TOKEN` clarifies GitLab's token taxonomy.
- **Concrete correction:** Add a brief note in section 2 after OAuth2:

  > **CI/CD Job Token:** Not applicable for this connector. These tokens use the `JOB-TOKEN` header and are restricted to a allowlist of endpoints (package registry, container registry, specific project/group APIs). They cannot be used for general issue/MR operations.

---

### 4. Missing auth mechanism: Impersonation Tokens

- **Issue:** Impersonation Tokens are not documented. The document mentions "service account" and "bot user" but never addresses whether GitLab's Impersonation Tokens are the correct mechanism or if they are deprecated.
- **Why it matters:** Impersonation Tokens are **not deprecated** (as of GitLab 17.x). They are admin-created tokens that allow API access acting as a specific user. They are different from regular PATs and from "service accounts" as the document uses the term. The document's repeated use of "service account" without defining it could lead to confusion with Impersonation Tokens.
- **Concrete correction:** Add under section 2.1 or a new section:

  > **Impersonation Tokens:** Admin-created tokens for acting as a specific user. Not the same as a bot/service account PAT. Not deprecated. Requires admin access to create. Suitable for scenarios where actions must appear to come from a specific user rather than a bot. Scope is limited to what that user can access.

---

### 5. Misleading alternative header for PATs

- **Issue:** Section 2.1 says "Alternative header (rare): `Authorization: Bearer <token>` (only if token type is `Bearer`)". This implies GitLab tokens can be of type "Bearer", which is true for OAuth2 tokens but misleading for PATs. GitLab's REST API docs explicitly recommend `PRIVATE-TOKEN` as the header for personal, project, and group access tokens. The `Authorization: Bearer` header is for OAuth2 tokens.
- **Why it matters:** Using `Authorization: Bearer` with a PAT is not documented as the standard approach. A connector implementer might incorrectly use Bearer auth for PATs, which could fail or behave unexpectedly. The phrase "only if token type is `Bearer`" implies a concept that doesn't apply to PATs — they are not typed.
- **Concrete correction:** Remove the "Alternative header" line for PATs, or clarify:

  > **Header:** `PRIVATE-TOKEN: <token>`
  >
  > Note: OAuth2 tokens use `Authorization: Bearer <token>` instead.

---

### 6. Missing auth mechanism: Deploy Tokens

- **Issue:** Deploy Tokens are not documented, despite being a distinct GitLab token type.
- **Why it matters:** Deploy Tokens use HTTP Basic Auth (username + token as password), not bearer-token auth. They have specific scopes (`read_repository`, `read_registry`, etc.) and critically **cannot be used with the GitLab public API** (only package registry, container registry, and git operations). An implementer unaware of this could waste time trying to use Deploy Tokens with the issue/MR API. The existing token summary table in section 2.5 lists "Project/Group access token" but omits Deploy Tokens entirely.
- **Concrete correction:** Add to section 2:

  > **Deploy Tokens:** Use HTTP Basic Auth (username + token). Cannot access the GitLab public API for issues/MRs/comments. Only suitable for container/package registry and git operations. Not applicable for this connector.

---

### 7. Webhook security: constant-time comparison missing

- **Issue:** Section 2.4 and 3.2 show simple string comparison:
  ```
  if (request.headers['X-Gitlab-Token'] !== storedSecret) {
    return 401;
  }
  ```
- **Why it matters:** This is a timing-attack vulnerability. String comparison (`!==`) short-circuits on the first mismatched character, leaking information about the secret length and content via timing. For a webhook secret, even a marginal leak is undesirable.
- **Concrete correction:** Use constant-time comparison:

  ```typescript
  import { timingSafeEqual } from 'crypto';
  const stored = Buffer.from(storedSecret, 'utf8');
  const received = Buffer.from(req.headers['x-gitlab-token'] ?? '', 'utf8');
  if (stored.length !== received.length || !timingSafeEqual(stored, received)) {
    return 401;
  }
  ```

---

### 8. Missing: Webhook UUID for replay protection

- **Issue:** The webhook section (3.2) does not mention `X-Gitlab-Webhook-UUID`, which GitLab sends with every webhook delivery. The `Idempotency-Key` header is mentioned (3.3) but without guidance on whether it provides replay protection.
- **Why it matters:** Neither `X-Gitlab-Webhook-UUID` nor `Idempotency-Key` provides cryptographic replay protection (unlike GitHub's `X-Hub-Signature-256` with HMAC). They are deduplication keys, not replay guards. The document should be clear that GitLab webhooks lack HMAC signature verification entirely and rely only on the shared secret and deduplication keys.
- **Concrete correction:** In section 3.2, add:

  > **Note:** GitLab does not support HMAC-signed webhook verification. There is no `X-Gitlab-Signature` or equivalent. Replay protection relies solely on the shared secret (`X-Gitlab-Token`) and deduplication via `X-Gitlab-Webhook-UUID` or `Idempotency-Key`. GitLab sends both headers with every delivery. Store the webhook UUID and reject any event with a UUID you've already processed.

---

### 9. OAuth2 device authorization grant not documented

- **Issue:** The document describes OAuth2 authorization code with PKCE as the recommended flow but does not mention the device authorization grant (GitLab 17.1+).
- **Why it matters:** For server-side connectors that need OAuth without user browser interaction (e.g., CLI setup tools, non-interactive installer), the device flow is the correct OAuth approach. Mentioning it gives implementers a complete picture of available OAuth flows.
- **Concrete correction:** Add under section 2.2:

  > **Device Authorization Grant (GitLab 17.1+):** For non-interactive OAuth flows where a browser is available but no persistent user session exists. Polls `/oauth/token` with a device code. Suitable for CLI tools and server-side initial setup.

---

### 10. OAuth scopes: incomplete scope list

- **Issue:** Section 2.2 says "Same as PAT scopes" without listing what those scopes are or noting which additional OAuth-specific scopes exist.
- **Why it matters:** GitLab OAuth exposes additional scopes not available to PATs: `openid`, `profile`, `email` (OpenID Connect scopes), and `sudo`. The document should clarify the relationship between PAT scopes and OAuth scopes to prevent confusion.
- **Concrete correction:** Add to section 2.2:

  > **Scopes:** Same as PAT scopes (`api`, `read_api`, etc.) plus OpenID Connect scopes: `openid`, `profile`, `email`. The `sudo` scope allows acting as another user (requires admin OAuth app). For this connector, `api` or `read_api` is sufficient.

---

### 11. Security: PAT `api` scope over-scopes for read-only MVP

- **Issue:** The MVP recommendation (section 2, section 11) says to use a PAT with `api` scope. But for an MVP that only reads issues/comments, `read_api` is sufficient.
- **Why it matters:** Granting `api` scope (full read/write) when only `read_api` is needed violates least-privilege. If the token leaks, the blast radius is larger than necessary.
- **Concrete correction:**
  - For MVP read-only initial setup: Recommend `read_api` as the default.
  - Only escalate to `api` when outbound features (posting comments, creating issues) are enabled.
  - Update section 11 admin panel fields to clarify: "For read-only MVP: `read_api` scope. Add write operations: upgrade to `api` scope."

---

### 12. Missing: secret classification for platform registry

- **Issue:** The document defines `botToken` and `webhookSecret` as connector config fields but does not annotate them with `secretType` values for the platform registry.
- **Why it matters:** Other reviewed connectors (GitHub, Slack) annotate config fields with `secretType` before platform registry entry. Without this annotation, the connector cannot be properly registered.
- **Concrete correction:** Add a secret classification section near the end:

  > **Secret Classification (Platform Registry)**
  >
  > | Config Field | `secretType` | Rationale |
  > |---|---|---|
  > | `botToken` | `api_key` | PAT is a long-lived bearer token used for API authentication |
  > | `webhookSecret` | `webhook_secret` | Shared secret for webhook delivery verification |
  >
  > GitLab does not have a separate "service_account" token type. Bot/service accounts in GitLab are regular user accounts authenticated with PATs — the PAT is the `api_key`.

---

## What Was Verified as Correct

- `PRIVATE-TOKEN` header for PATs: accurate.
- `X-Gitlab-Token` as webhook secret (shared secret, no HMAC): accurate.
- OAuth2 access token lifetime of 2 hours: accurate.
- Refresh token invalidation behavior: accurate.
- Multi-tenant OAuth requiring per-tenant app registration: accurate.
- MVP PAT recommendation for initial simplicity: justified (GitLab PAT creation is Settings → Access Tokens → Generate, no OAuth redirect flow needed).
- `self_rotate` scope for token rotation: accurate.
- GitLab 16.0+ requiring expiry on new tokens: accurate.
- OAuth2 PKCE support: accurate.

---

## Summary of Corrections

| # | Severity | Location | Correction |
|---|---|---|---|
| 1 | High | §2.1, §10.2 | Clarify non-expiring PATs are self-managed only |
| 2 | High | §2.5, §10.2 | Split Project vs Group Access Token availability |
| 3 | Medium | §2 | Add CI/CD Job Token as not-applicable |
| 4 | Medium | §2 | Add Impersonation Token documentation |
| 5 | Medium | §2.1 | Remove misleading Bearer header claim for PATs |
| 6 | Medium | §2 | Add Deploy Token as not-applicable with explanation |
| 7 | High | §3.2 | Use constant-time comparison for webhook secret |
| 8 | Medium | §3.2 | Document lack of HMAC verification + UUID for replay |
| 9 | Low | §2.2 | Add device authorization grant (GitLab 17.1+) |
| 10 | Low | §2.2 | Clarify OAuth scope list including OIDC scopes |
| 11 | Medium | §2, §11 | Recommend `read_api` for read-only MVP, not `api` |
| 12 | Medium | End | Add platform registry secret classification table |
