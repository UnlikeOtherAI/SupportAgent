# Zendesk Connector Auth Review

> Review date: 2026-04-18
> Reviewer: Auth Security Audit
> Source: `docs/connectors/zendesk.md`

---

## Verdict

**REVIEW COMPLETE WITH FINDINGS** — The auth section is mostly accurate but has critical gaps in webhook signature verification (missing replay protection) and OAuth scope naming.

---

## Findings

### 1. Missing Timestamp Header for Webhook Replay Protection

**Issue:** The webhook signature verification section omits the `X-Zendesk-Webhook-Signature-Timestamp` header and does not document replay protection.

**Why it matters:** Without timestamp validation, the connector is vulnerable to replay attacks where an attacker reuses a valid webhook payload.

**Current doc says:**
```
X-Zendesk-Webhook-Signature: {base64_signature}
X-Zendesk-Webhook-Signature-Algorithm: HMAC-SHA256
Secret is provisioned per webhook in the Zendesk UI.
Verify by computing `HMAC-SHA256(secret, raw_body)` and comparing base64-encoded.
```

**Correction:**
```
Headers present on webhook requests:
X-Zendesk-Webhook-Signature: {base64_signature}
X-Zendesk-Webhook-Signature-Algorithm: HMAC-SHA256
X-Zendesk-Webhook-Signature-Timestamp: {unix_timestamp}

Verification steps:
1. Extract timestamp from header
2. Reject if timestamp older than 5 minutes (configurable tolerance)
3. Compute: HMAC-SHA256(secret, "{timestamp}.{raw_body}")
4. Compare base64 signatures using constant-time comparison
```

---

### 2. OAuth Scope Names May Be Incorrect

**Issue:** The document uses generic scope names (`read`, `write`) that do not match Zendesk's actual scope format.

**Why it matters:** Using incorrect scope names will cause OAuth authorization to fail or grant unintended permissions.

**Current doc lists:**
| Scope | For |
|-------|-----|
| `read` | Reading tickets, comments, users, orgs |
| `write` | Creating/updating tickets, posting comments |
| `ticketing:actions:execute` | Status transitions, assignments |
| `users:read` | User identity resolution |
| `organizations:read` | Organization lookup |

**Correction:** Zendesk uses underscore-separated scopes. Verify exact scope strings from `GET /oauth/authorizations/new`. Common Support API scopes include:
| Scope | For |
|-------|-----|
| `read` | General read access |
| `write` | General write access |
| `helpdesk:read` | Ticket and comment access |
| `helpdesk:write` | Ticket and comment modifications |
| `users:read` | User lookup |
| `organizations:read` | Organization lookup |

**Recommendation:** Add a note to verify scopes during OAuth client setup since exact scope strings may vary by Zendesk plan.

---

### 3. Basic Auth Deprecation Date Inconsistency

**Issue:** The document states "Basic authentication for `/api/v2/` endpoints deprecated for new accounts as of Jan 12, 2026." This date appears inconsistent with known deprecation timelines.

**Why it matters:** Users may make incorrect assumptions about which authentication method to use.

**Correction:** Verify the actual Basic Auth deprecation date from Zendesk's official changelog. The implicit/password grant deprecation (Feb 17, 2025) is correctly documented.

---

### 4. Global OAuth Multi-Tenant Requirements Clarification Needed

**Issue:** The document mentions Global OAuth is "Required for multi-tenant distribution" but does not explain the operational implications.

**Why it matters:** If SupportAgent needs to be distributed to multiple Zendesk instances, Global OAuth requires a different registration flow and may have different rate limits.

**Correction:** Add clarification:
- Single-tenant: Standard API token or per-instance OAuth client
- Multi-tenant: Global OAuth client required (Zendesk Developer Console)
- Global OAuth requires refresh token flow (documented correctly)
- Global OAuth tokens are per-instance, not cross-instance

---

### 5. API Token Limit Discrepancy

**Issue:** The document states "Up to 256 tokens per account (2048 for accounts exceeding this)." The 2048 limit is for Enterprise accounts with a specific add-on.

**Why it matters:** Users may misunderstand their token limit tier.

**Correction:**
```
Token limits by plan:
- Team: Up to 256 tokens
- Professional: Up to 256 tokens
- Enterprise: Up to 256 tokens (base), up to 2048 with High Volume API add-on
```

---

### 6. Missing: Device Authorization Grant (Flow)

**Issue:** The document does not mention the OAuth Device Authorization Grant (device flow), which Zendesk supports for CLI tools and devices without a browser.

**Why it matters:** If SupportAgent needs to support headless or CLI-based authentication, the device flow is the appropriate mechanism.

**Correction:** Add to supported mechanisms table:
| Method | Use Case |
|--------|----------|
| Device Authorization Grant | CLI tools, headless authentication |

---

### 7. Missing: Secret Classification

**Issue:** The document does not classify the API token type for the platform registry.

**Why it matters:** SupportAgent needs to classify credentials for secure storage.

**Correction:** Add secret classification:
- `api_token` — Zendesk API token (long-lived, does not expire until revoked)
- `oauth_access_token` — OAuth access token (short-lived, TTL configurable)
- `oauth_refresh_token` — OAuth refresh token (long-lived, revokable)
- `webhook_secret` — Webhook signing secret (per-webhook, rotatable)

---

### 8. Missing: Token Rotation Guidance

**Issue:** The document does not cover token rotation procedures.

**Why it matters:** Users need to know how to rotate tokens without downtime.

**Correction:** Add rotation guidance:
- API tokens: Create new token, update config, then revoke old token
- OAuth: Use refresh token to obtain new access token; refresh tokens can be rotated
- Webhook secrets: Zendesk provides regenerate functionality; update before rotating

---

## Verified Correct

The following are correctly documented:

1. **API Token Format:** `{email}/token:{api_token}` base64-encoded — CORRECT
2. **API Token Header:** `Authorization: Basic {base64}` — CORRECT
3. **OAuth Access Token Header:** `Authorization: Bearer {access_token}` — CORRECT
4. **OAuth Access Token TTL:** Configurable, default 1 hour — CORRECT
5. **OAuth Refresh Token:** Required for Global OAuth (Feb 2026) — CORRECT
6. **Implicit/Password Grant Deprecation:** Feb 17, 2025 — CORRECT
7. **TLS Requirement:** TLS 1.2 mandatory — CORRECT

---

## Summary of Required Corrections

1. Add `X-Zendesk-Webhook-Signature-Timestamp` header documentation
2. Add replay protection steps (timestamp validation)
3. Verify OAuth scope names match current Zendesk API
4. Verify Basic Auth deprecation date
5. Clarify Global OAuth multi-tenant implications
6. Correct API token limit documentation
7. Add Device Authorization Grant support
8. Add secret type classification for registry
9. Add token rotation guidance

---

## Risk Assessment

| Risk | Severity | Likelihood |
|------|----------|------------|
| Replay attack via webhook | HIGH | MEDIUM (if timestamp check missing) |
| OAuth auth failure due to wrong scopes | HIGH | HIGH (if scopes incorrect) |
| Token limit confusion | LOW | LOW |
| Missing device flow support | MEDIUM | LOW (only if headless auth needed) |

---

*Sources:*
- *https://developer.zendesk.com/api-reference/introduction/security-and-auth/*
- *https://developer.zendesk.com/api-reference/webhooks/introduction/*
