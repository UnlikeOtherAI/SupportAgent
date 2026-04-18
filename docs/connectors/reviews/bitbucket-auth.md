# Bitbucket Connector — Authentication & Credentials Review

**Reviewer scope:** Authentication mechanisms, token formats, scopes, webhook signatures, credential classification.
**Source:** `docs/connectors/bitbucket.md`
**Checked:** 2026-04-18

---

## Verdict

**Conditional pass with significant corrections needed.** The document covers the right auth mechanisms for both Cloud and Data Center, but has critical misalignments in header formats, scope mappings, webhook signature headers, and missing coverage of multi-tenant OAuth implications. These will cause integration failures if implemented as written.

---

## Findings

### 1. PAT vs App Password — Header Confusion (HIGH)

**Issue:** Section 2.1.1 (PAT) states:

```
Authorization: Bearer {token}
Or: Authorization: Basic {base64(user:token)} with App Password
```

**Problem:** The "Or" clause conflates PAT and App Password, which are separate authentication mechanisms with different header formats:

- **PAT**: `Authorization: Bearer {pat_token}` OR `Authorization: Basic {base64(username:pat_token)}`
- **App Password**: `Authorization: Basic {base64(email:app_password)}`

The parenthetical "with App Password" implies App Password uses `base64(user:token)`, but App Password uses `base64(email:app_password)` as shown correctly in Section 2.1.3.

**Why it matters:** A developer reading this may implement the wrong Basic auth format for App Password, causing auth failures.

**Correction:** Separate the PAT Basic auth example:

```
# PAT with Bearer
Authorization: Bearer {pat_token}

# PAT with Basic (username:pat as password)
Authorization: Basic {base64(username:pat_token)}

# App Password (email:app_password as password)
Authorization: Basic {base64(email:app_password)}
```

---

### 2. Incorrect Webhook Signature Header (HIGH)

**Issue:** Section 3.1.3 (Webhook Signature Verification) states for Cloud:

```
X-Hub-Signature: sha256={hmac_hex_digest}
X-Hub-Signature-256: sha256={hmac_hex_digest}
```

**Problem:** Bitbucket Cloud **only sends** `X-Hub-Signature`. It does **not** send `X-Hub-Signature-256`. The `X-Hub-Signature-256` variant is a GitHub-specific header.

**Why it matters:** If the connector expects `X-Hub-Signature-256`, webhook verification will always fail for Bitbucket Cloud, silently disabling security.

**Correction:**

```
# Bitbucket Cloud
X-Hub-Signature: sha256={hmac_hex_digest}

# Only one header, always sha256
```

---

### 3. MVP Scope Table — Over-scoped App Password Requirements (MEDIUM)

**Issue:** Section 2.1.1 MVP Required Scopes Table lists:

| Operation | Required Scope |
|-----------|----------------|
| Write pull request comments | `pullrequest:write` |
| Read issues | `issue:read` |
| Write issues/comments | `issue:write` |
| Read workspace/webhooks | `webhook` |
| Read user info | `account:read` |

**Problems:**

1. **`account:read` for webhook operations**: Reading workspace webhooks requires `repository:write` (for repo-level) or workspace admin permissions, not `account:read`.

2. **Scope granularity for comments**: Writing PR comments requires `pullrequest:write`. Reading PR comments also requires `pullrequest:read`. The table conflates these.

**Why it matters:** Over-scoping credentials violates least-privilege principle. Users may grant broader permissions than needed.

**Correction:** Minimum scopes for MVP:

| Operation | Required Scope |
|-----------|----------------|
| Read repos | `repository:read` |
| Read PRs | `pullrequest:read` |
| Comment on PRs | `pullrequest:write` |
| Read issues | `issue:read` |
| Write issues/comments | `issue:write` |
| Register webhooks | `repository:write` OR workspace admin |

---

### 4. OAuth 2.0 Token Lifetime — Vague (MEDIUM)

**Issue:** Section 2.1.2 states:

```
Token lifetime: 1-2 hours (access), refresh valid until revoked
```

**Problem:** "1-2 hours" is imprecise. Bitbucket Cloud OAuth 2.0 access tokens have a **fixed 2-hour lifetime** (7200 seconds). The `offline_access` scope is required to receive a refresh token, which does not expire unless explicitly revoked.

**Why it matters:** Without knowing the exact lifetime, connector developers may implement incorrect token refresh logic.

**Correction:**

```
Token lifetime: 2 hours (fixed, 7200 seconds)
Refresh token: Requires offline_access scope; does not expire until revoked
```

---

### 5. Missing: `repository:write` vs `webhook` Scope for Webhook Registration (MEDIUM)

**Issue:** Section 2.1.1 lists `webhook` as the required scope for "Read workspace/webhooks", and Section 11 (Recommended Scope) uses `webhook` in the BitbucketConfig interface.

**Problem:** The `webhook` scope in Bitbucket Cloud has specific semantics:
- `webhook` scope allows managing workspace-level webhooks
- For **repo-level** webhooks, `repository:write` is sufficient
- The doc does not clarify this distinction

**Why it matters:** If a user grants only `webhook` scope expecting repo-level webhook management, it may fail for repos where they lack workspace admin rights.

**Correction:** Add clarification:

```
# Workspace-level webhooks
Required: workspace admin + webhook scope

# Repository-level webhooks
Required: repository:write scope
```

---

### 6. OAuth Multi-Tenant Gap — Missing Workspace App Approval Requirement (MEDIUM)

**Issue:** Section 10.4 (Multi-Tenant Considerations) mentions "Each tenant needs own OAuth app registration for workspace-level webhooks" but doesn't address the approval flow.

**Problem:** Workspace-level webhooks require the OAuth app to be:
1. Registered with workspace scope
2. Approved by workspace admin (Bitbucket prompts approval on first use)

This creates friction for multi-tenant deployments where each tenant may have different workspace admins.

**Why it matters:** Without documenting this approval flow, the MVP timeline may be underestimated.

**Correction:** Add to Section 10.4:

```
Workspace-level OAuth apps require workspace admin approval:
1. User authorizes the app
2. Workspace admin receives notification to approve
3. Until approved, webhook registration fails with 403
```

---

### 7. Data Center PAT Endpoint — Version Ambiguity (LOW)

**Issue:** Section 2.2.1 states:

```
Endpoint: POST /rest/access-tokens/latest/
```

**Problem:** The `/latest/` path is ambiguous. Data Center 10.0+ uses `/rest/access-tokens/latest/`, but earlier versions may use different paths. The doc should clarify this is DC 10.0+ only.

**Why it matters:** Connector may fail against DC 8.x or 9.x instances that use different token endpoints.

**Correction:**

```
Endpoint: POST /rest/access-tokens/latest/ (Data Center 10.0+)
Earlier versions: POST /rest/access-tokens/1.0/ or /rest/api/latest/access-tokens/
```

---

### 8. Missing: Bot Identity — Workspace vs Personal Account Limitation (LOW)

**Issue:** Section 2.1.4 (Bot Identity) suggests creating a "dedicated workspace member account."

**Problem:** The doc doesn't mention that Bitbucket Cloud has limitations on the number of free workspace members. For organizations on free plans, adding a bot account consumes a seat.

**Why it matters:** Cost planning for self-hosted Bitbucket may be underestimated.

**Correction:** Add note:

```
Bot account considerations:
- Consumes a workspace seat on free plans (5 free members)
- Paid plans: unlimited members, bot adds cost
- Alternative: Use existing admin account (security trade-off)
```

---

### 9. Webhook Secret Handling — Missing Replay Protection Note (LOW)

**Issue:** Section 3.1.3 and Appendix B don't mention replay protection.

**Problem:** Bitbucket webhooks do not include timestamps or nonce values by default. Without replay protection, captured webhooks could be replayed.

**Why it matters:** In theory, an attacker who intercepts a webhook request could replay it. Most implementations skip this since Bitbucket's HMAC verification is sufficient for most threat models.

**Correction:** Add to Appendix B:

```
Replay protection: Bitbucket does not include timestamps/nonces.
Consider implementing time-window validation (reject webhooks older than 5 minutes)
if replay attacks are a concern.
```

---

### 10. OAuth Scopes — Missing `account:email` Scope (LOW)

**Issue:** Section 2.1.2 lists OAuth scopes but omits `account:email`.

**Problem:** If the connector needs to verify user email (e.g., for identity resolution), `account:email` is required.

**Why it matters:** Minor gap — most use cases don't need email, but it's a common oversight.

**Correction:** Add to OAuth scopes list:

```
account:email           # Read user email addresses
```

---

## Summary Table

| # | Area | Severity | Claim in Doc | Correct Value / Action |
|---|---|---|---|---|
| 1 | PAT/App Password headers | HIGH | Conflates two auth mechanisms | Separate headers clearly |
| 2 | Webhook signature header | HIGH | Lists `X-Hub-Signature-256` | Bitbucket only sends `X-Hub-Signature` |
| 3 | MVP scope table | MEDIUM | Over-claims `account:read`, `webhook` | Minimal scopes: `repository:read/write`, `pullrequest:read/write`, `issue:read/write` |
| 4 | OAuth token lifetime | MEDIUM | "1-2 hours" | Fixed 2 hours (7200 seconds) |
| 5 | Webhook scope semantics | MEDIUM | Lists `webhook` without context | Distinguish workspace vs repo-level requirements |
| 6 | Multi-tenant OAuth gap | MEDIUM | Mentions per-tenant apps | Document workspace admin approval flow |
| 7 | DC PAT endpoint version | LOW | `/rest/access-tokens/latest/` | Clarify DC 10.0+ requirement |
| 8 | Bot account limitation | LOW | "Create dedicated account" | Note free plan seat limit |
| 9 | Replay protection | LOW | None mentioned | Add time-window validation note |
| 10 | OAuth scopes missing | LOW | Omits `account:email` | Add to scope list |

---

## Priority Actions

1. **Fix webhook signature header** (Finding 2) — will cause immediate auth failures
2. **Separate PAT and App Password auth flows** (Finding 1) — prevents developer confusion
3. **Correct scope table** (Finding 3) — enables least-privilege credential setup
4. **Document OAuth approval flow** (Finding 6) — affects MVP timeline estimation
5. **Clarify DC version requirement** (Finding 7) — prevents version mismatch failures

---

## Security Observations

**No critical security issues found.** The document does not recommend:
- Storing plaintext tokens
- Over-broad scope grants (minor over-scoping in Finding 3)
- Hardcoding secrets
- Disabling signature verification

The document correctly recommends PAT over Basic Auth for Data Center, HMAC-SHA256 for webhook verification, and HTTPS for endpoints.
