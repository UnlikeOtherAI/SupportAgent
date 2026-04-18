# GitHub Connector — Authentication & Credentials Review

**Verdict: APPROVED WITH CORRECTIONS** — The document correctly identifies the primary auth mechanisms (PAT and GitHub App) and their trade-offs. Six findings require correction before this goes into production.

---

## Findings

### 1. `X-GitHub-Token` header may be unsupported or deprecated

**Issue:** Line 36 lists `X-GitHub-Token: <token>` as a valid header alongside `Authorization: Bearer <token>`.

**Why it matters:** GitHub's current REST API documentation only documents `Authorization: Bearer` and `Authorization: token` formats. `X-GitHub-Token` is not mentioned in the official docs and may be a deprecated or internal header. Implementing it could produce silent failures.

**Correction:** Remove `X-GitHub-Token` from the header options. Use only:
```
Authorization: Bearer <token>
Authorization: token <token>    # legacy but still supported
```

---

### 2. GitHub App JWT algorithm not specified

**Issue:** Section B describes generating installation tokens but never states the JWT signing algorithm required for the app-level token.

**Why it matters:** GitHub App JWTs must be signed with RS256. Using HS256 or another algorithm produces `401 Unauthorized` with no further error detail.

**Correction:** Add to section B:
> **JWT signing algorithm:** RS256 (RSA Signature with SHA-256). Use the app's private key (PEM format). Libraries: `jsonwebtoken` (Node), `jose` (universal).

---

### 3. GitHub App JWT lifetime stated incorrectly

**Issue:** The document does not state the JWT lifetime for app-level tokens.

**Why it matters:** App-level JWTs expire in **10 minutes maximum**. Tokens issued with longer expiry are rejected. This is a common setup mistake.

**Correction:** Add after the JWT header description:
> **Token lifetime:** Maximum 10 minutes. Recommended: set `exp` to `iat + 9 minutes` to allow clock drift tolerance.

---

### 4. Installation token endpoint missing `POST /app/installations/{installation_id}/access_tokens`

**Issue:** Section B mentions "obtained from `POST /app/installations/{installation_id}/access_tokens`" but does not describe the request or response shape.

**Why it matters:** Implementers need the full endpoint contract to build the token exchange flow.

**Correction:** Add the endpoint spec:
```
POST /app/installations/{installation_id}/access_tokens
Authorization: Bearer <jwt>
Accept: application/vnd.github+json

# Optional body (repositories / repository_selection)
{ "repositories": ["repo-name"] }

Response 201:
{
  "token": "v1.----------",
  "expires_at": "2024-01-01T12:00:00Z",
  "permissions": { ... },
  "repository_selection": "all"
}
```

---

### 5. GitHub App `repository_metadata` permission name mismatch

**Issue:** Line 66 lists "Repository metadata" as `Read` permission. GitHub's actual permission key is `repository_metadata` (not "Repository metadata" with spaces).

**Why it matters:** App manifest JSON requires the exact key name. Typos cause silent permission failures where the app works but can't read metadata.

**Correction:** Change line 66 to:
```
| Repository metadata | repository_metadata | Read |
```

---

### 6. OAuth App section is vague and outdated

**Issue:** Section C says "Not recommended for server-side connectors" but provides no specifics on why, and omits that GitHub deprecated the OAuth device flow for GitHub.com in 2024.

**Why it matters:** OAuth tokens require user interaction to authorize, expire, and need refresh logic. They are unsuitable for headless server-side connectors. Misunderstanding this leads to fragile implementations.

**Correction:** Replace section C with:
> **OAuth App / User Access Token — Not suitable**
> - Requires user browser redirect for authorization.
> - Tokens expire and require refresh with client secret.
> - No server-to-server use case without storing user credentials.
> - **Deprecated:** GitHub disabled the OAuth device flow on github.com (2024). Only browser-based flow remains.
> - Not recommended for SupportAgent.

---

### 7. Missing `admin:org_hook` vs `admin:repo_hook` scope for webhook registration

**Issue:** Table on line 47 lists `admin:repo_hook` and `admin:org_hook` as the scopes for webhook registration, but PATs do not use scopes — they use the `repo` scope or `public_repo` for all repo-level operations.

**Why it matters:** PATs are not scoped the same way GitHub Apps are. `admin:repo_hook` and `admin:org_hook` do not exist as PAT scopes.

**Correction:** Replace line 47 entry with:
| Register webhooks | `repo` (private repos) or `public_repo` (public only) | PATs do not have separate webhook scopes. Org-level webhooks require org ownership or admin. |

---

### 8. Fine-grained PAT expiration statement is imprecise

**Issue:** Line 52 says fine-grained PATs have "configurable max 1 year."

**Why it matters:** Fine-grained PATs can be set to expire in 1 day, 7 days, 30 days, 90 days, or 1 year. "Max 1 year" is correct but omits the shorter options that are often better for security.

**Correction:** Change to:
> **Fine-grained PATs:** Configurable expiry: 1 day, 7 days, 30 days, 90 days, or 1 year (maximum). Shorter expiry is recommended.

---

### 9. Rate limit bonus misstates the bonus for GitHub App tokens

**Issue:** Line 499 says GitHub App installation tokens get "5,000 (base) + 0.5× installs bonus."

**Why it matters:** GitHub App rate limits are not computed as a simple multiplier. The bonus depends on the number of installations and is applied differently. This phrasing could mislead implementers into expecting guaranteed additional quota.

**Correction:** Change to:
> | GitHub App installation token | 5,000 per installation per hour | Bonus applies per installation; rate limits are tracked per token. |

---

### 10. `bot_login` field in config lacks auth mode context

**Issue:** Line 677 includes `bot_login` as a config field but the discussion of bot identity in section 7 focuses on PAT-based bots. For GitHub App mode, the bot identity is different.

**Why it matters:** `GET /user` on an installation token returns the GitHub App's bot identity (e.g., `app-name[bot]`), not a PAT user's identity. The config field alone does not clarify which auth mode determines the login format.

**Correction:** Add a note to section 11 config fields:
> For GitHub App mode, `bot_login` resolves to `<app-name>[bot]` from `GET /app/installations/{id}/access_tokens`. For PAT mode, it resolves to the PAT owner's login from `GET /user`.

---

## What's Correct

- PAT header format (`Authorization: Bearer` and `Authorization: token`) is accurate.
- PAT rate limit of 5,000 req/hour is correct.
- Classic PAT lifetime ("no expiry unless revoked") is correct.
- GitHub App installation token lifetime (1 hour) is correct.
- Webhook HMAC-SHA256 signature format (`sha256=...`) is correct.
- Webhook delivery headers (`X-Hub-Signature-256`, `X-GitHub-Delivery`, etc.) are correct.
- Constant-time comparison recommendation is correct.
- PAT requiring `repo` or `public_repo` scope for private repo access is correct.
- GitHub App recommendation for multi-tenant is sound.
- `local_gh` unsuitability for production is correct.
- OAuth App unsuitability for server-side is directionally correct (though needs update per finding #6).

---

## Secret Classification Summary

| Field | Platform Registry | GitHub Doc | Consistent? |
|-------|-------------------|------------|-------------|
| `access_token` | `api_key` | PAT | Yes |
| `webhook_secret` | `webhook_secret` | Webhook HMAC secret | Yes |

The `api_key` classification for the PAT is appropriate. GitHub does not have a separate "service_account" concept — GitHub Apps fill that role, and their secrets (app ID + private key) are not yet covered in the connector config fields (Phase 2 only).

---

## MVP Recommendation Verdict

**PAT for MVP — Justified.**

The justification holds because:
1. GitHub.com PAT setup is: Settings → Developer settings → Generate token. Zero configuration beyond scope selection.
2. GitHub App requires: App registration → private key generation → OAuth install flow → per-tenant installation. ~30 minutes vs 2 minutes.
3. `repo` scope PAT grants full read/write to a single repo, sufficient for MVP.
4. PAT revocation is instant — no token rotation complexity.

The Phase 2 migration to GitHub App is the right call for multi-tenant org-wide deployments.
