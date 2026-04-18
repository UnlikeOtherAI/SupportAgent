# Respond.io Connector — Authentication & Credentials Review

**Reviewer**: Auth & credentials
**Source file**: `docs/connectors/respond_io.md`
**Date**: 2026-04-18
**Verdict**: FAIL — One critical mismatch, two documentation gaps, one security framing issue, one rate-limit contradiction.

---

## Findings

### 1. [CRITICAL] Webhook verification method is wrong

**Issue**: Section 2 ("Webhook Authentication") states webhook verification uses the same API token in an `Authorization: Bearer` header:
```http
Authorization: Bearer {api_token}
```
When registering a webhook, the document says to "include the token in the Authorization header."

**Why it matters**: The official docs overview page states webhook events "supports secure delivery via HTTPS. You can verify authenticity using **signing secrets**." The connector doc conflates API auth (Bearer token on outbound requests) with webhook auth (inbound signature verification). These are two separate mechanisms. If SupportAgent implements webhook verification by passing the API token in a header, it will not correctly verify Respond.io's signature. It may silently accept unauthenticated or spoofed payloads.

**Concrete correction**: Replace the webhook auth section entirely. Describe the actual webhook verification flow:
- Respond.io signs outbound webhook payloads with HMAC-SHA256 (or similar) using a **webhook signing secret** generated per-subscription.
- The signature is delivered in a request header (e.g., `X-Webhook-Signature` or `X-Hub-Signature-256` — **confirm exact header name from Respond.io docs**).
- To verify: compute HMAC-SHA256 of the raw request body using the webhook secret, compare against the signature header.
- Clarify whether the signing secret is the same as the API token or a separate credential. If separate, document where to obtain it.
- Add replay protection guidance (timestamp header, tolerance window).

If the actual verification method cannot be confirmed from docs, mark the section as `[UNVERIFIED — confirm with Respond.io support]` and flag for follow-up before implementation.

---

### 2. [MEDIUM] Token limit (10 per workspace) is missing

**Issue**: Section 2 states tokens are "long-lived (no expiry; revoke manually)" but omits the workspace-level cap.

**Why it matters**: The official docs state "You can generate up to **10** Access Tokens per workspace." This is a hard limit, not a soft recommendation. If SupportAgent creates one token per tenant/workspace, a deployment with multiple workspaces will hit this ceiling. The connector design mentions multi-workspace support as an open question in Section 13 but doesn't flag the token limit as a constraint.

**Concrete correction**: Add to Section 2, under "Token provisioning":
> "Maximum 10 tokens per workspace. Plan accordingly for multi-workspace deployments — one token per workspace is the limit."

And cross-reference Section 13's multi-workspace question: "Each workspace needs its own token. The 10-token limit constrains how many workspaces can be managed from a single account."

---

### 3. [MEDIUM] Webhook signing secret — algorithm, header name, replay protection unspecified

**Issue**: The connector doc uses a `webhookSecret` field in the admin config (Section 11), but:
- The signing algorithm is not named (HMAC-SHA256? HMAC-SHA1?)
- The header carrying the signature is not named
- Replay protection is unaddressed (timestamps, tolerance windows)

**Why it matters**: Implementers will fill in unspecified fields with guesses. Wrong HMAC algorithm or missing replay protection creates vulnerabilities. Even if Respond.io's current implementation is simple, the connector doc should not leave security-critical fields undefined.

**Concrete correction**: Once the actual verification method is confirmed, fill in:
- Algorithm: e.g., `HMAC-SHA256`
- Signature header: e.g., `X-Webhook-Signature`
- Secret format: where it's obtained, whether it expires, rotation procedure
- Replay protection: e.g., "Respond.io includes a `X-Webhook-Timestamp` header; reject requests where `|timestamp - now| > 5 minutes`"

---

### 4. [LOW] Connector doc rate limit contradicts official docs

**Issue**: Section 8 says "The official rate limit values are **not publicly documented**."

The official docs overview page explicitly states: "Each API call method is limited to **5 requests per second**. Rate limits are enforced per **HTTP method** and per **unique request path**."

**Why it matters**: Incorrectly stating rate limits are undocumented leads implementers to skip header-based rate limit monitoring. The connector doc correctly describes the `X-RateLimit-*` headers but then says values aren't documented — which is factually wrong.

**Concrete correction**: In Section 8, replace the "Specific Limits (Not Documented)" subsection with the actual documented limits (5 req/s per HTTP method per unique path), then note that the `X-RateLimit-*` headers provide the authoritative per-workspace actual limits.

---

### 5. [LOW] Security framing understates blast radius

**Issue**: Section 10 ("Known Gotchas") states: "If the API token is compromised, an attacker has full access to the workspace."

This is accurate but buried in a gotcha list. The auth section recommends API token for MVP without mentioning that this grants workspace-level read/write access equivalent to an admin, with no granular scopes or token-level permissions.

**Why it matters**: An implementer may treat the API token like a read-only key. The connector config uses `apiToken` as a single field with no warning about sensitivity, rotation, or exposure risk. This leads to tokens being stored in plaintext config files, logged in debug output, or shared across services.

**Concrete correction**: In Section 2 (API Token), add a "Security considerations" callout:
> "The API token grants **workspace-admin-equivalent access**. Treat it like a password: never commit to version control, rotate on compromise, and use separate tokens per integration. There are no scopes — any operation the workspace allows is available to the token holder."

---

## Confirmed correct

- API Access Token is the **only** REST API auth method — no OAuth2, no API key in query params, no JWT. ✅
- `Authorization: Bearer {api_token}` header format is correct. ✅
- Token provisioning path (Settings → Integrations → Developer API) is correct. ✅
- Long-lived tokens with manual revocation is accurate. ✅
- 401 = invalid token, 403 = access denied (security block) are correct. ✅
- MVP recommendation (API token over OAuth) is correct — there is no OAuth for the Management API. ✅
- The `alternative_auth_header` and `oauth_client_apps` references in the Stoplight platform data are platform-level (Stoplight docs portal OAuth), not Respond.io API OAuth. No false positive here.

---

## Missing / Unverified

| Item | Status |
|------|--------|
| Webhook signature algorithm | **Unknown** — not confirmed from docs |
| Webhook signature header name | **Unknown** |
| Webhook signing secret provisioning path | **Unknown** |
| Replay protection mechanism | **Unknown** |
| HMAC key format (hex, base64) | **Unknown** |
| Webhook secret rotation | **Unknown** |
| Whether webhook signing secret is same as API token | **Unknown** |

All of the above need confirmation from Respond.io support or live testing before the webhook auth section is safe to implement.

---

## Secret type classification

The connector doc uses `apiToken` and `webhookSecret` in the admin config. Based on available information:
- `apiToken` → classify as `api_key` (long-lived workspace token, Bearer auth)
- `webhookSecret` → classify as `webhook_secret` once algorithm is confirmed

The `webhookSecret` field is currently listed in config but the corresponding verification mechanism (Section 2) is wrong, so this field is non-functional until webhook auth is corrected.