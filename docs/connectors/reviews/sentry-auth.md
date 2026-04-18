# Sentry Auth Review

**Reviewed file:** `docs/connectors/sentry.md`
**Scope:** Authentication and credentials only
**Verdict:** REVISIONS NEEDED — OAuth2 auth is entirely absent, and the webhook secret provisioning model needs clarification.

---

## Finding 1: OAuth2 is not mentioned (HIGH)

**Issue:** The document lists three auth mechanisms — Organization Auth Token, Internal Integration, Member User Token — but Sentry also supports OAuth2 in two variants: authorization code flow (with PKCE) and device authorization flow (RFC 8628). Both are fully documented at `sentry.io/oauth/authorize/` and `sentry.io/oauth/device/code/`.

**Why it matters:** A reader evaluating whether to use Sentry OAuth vs. API tokens has no information to go on. This also creates a risk: someone could reasonably conclude OAuth is not supported and implement only token-based auth, only to later discover OAuth is available and have to re-architect. The MVP recommendation (use Internal Integration) is sound, but it should be framed as "chosen among available options" not "the only options."

**Correction:** Add a new auth section before or alongside §2 covering OAuth2:

```markdown
#### 2d. OAuth2 (not recommended for SupportAgent MVP)

- **Flows**: Authorization code + PKCE (browser-based), Device authorization (RFC 8628, headless)
- **Auth endpoint**: `https://sentry.io/oauth/authorize/`
- **Token endpoint**: `https://sentry.io/oauth/token/`
- **Header**: `Authorization: Bearer {access_token}` (same as tokens above)
- **Access token lifetime**: 30 days (2,591,999s)
- **Refresh token**: Supported via `grant_type=refresh_token`
- **Scopes**: Same as token scopes above (event:read, org:read, etc.), passed as space-separated list during authorization
- **Setup friction**: Requires client registration with Sentry, PKCE implementation, redirect URI, token refresh lifecycle. Higher complexity than Internal Integration tokens.
- **Why not MVP**: Internal Integration tokens are simpler to provision and have the same API surface. OAuth2 is appropriate for third-party published apps.
```

**Also update §2 intro** to state that "The primary mechanisms for SupportAgent are Internal Integration tokens (§2b) and Organization Auth Tokens (§2a). OAuth2 (§2d) is supported but not recommended for this use case."

---

## Finding 2: Webhook secret is conflated with auth token (MEDIUM)

**Issue:** §2b says "The integration's 'Webhook URL' page shows a 'Client Secret' used for HMAC signature verification" and §3a step 4 says "Copies the 'Token' (shown once) and 'Client Secret' (for HMAC verification)." This conflates two separate secrets:

1. **Auth token** — used in `Authorization: Bearer {token}` header, generated in the "Tokens" tab of the Internal Integration settings page
2. **Client Secret** — used for webhook HMAC verification, provisioned when you first save a webhook URL in the integration settings

The Client Secret is not visible in the general integration settings; it appears only when you configure a webhook URL, and it can be regenerated independently of the auth token.

**Why it matters:** A SupportAgent operator following this guide might look for the Client Secret in the wrong place, or might accidentally rotate the wrong secret and break webhook verification while thinking they rotated the auth token.

**Correction in §2b**:
```markdown
- **Auth token**: Separate from webhook secret. Generated in Settings → Developer Settings → [Integration] → Tokens tab. Used in `Authorization: Bearer {token}` header.
- **Webhook secret (Client Secret)**: Used for HMAC signature verification. Shown on the webhook URL configuration page when you first save a webhook. If lost, regenerate from the same page. Treat it as distinct from the auth token.
```

**Correction in §3a step 4**:
```markdown
4. SupportAgent stores `authToken` (for API calls), `clientSecret` (for HMAC webhook verification), `organizationSlug`, and optionally `region` (us/de) per tenant. The auth token comes from the Tokens tab; the client secret comes from the webhook URL configuration.
```

---

## Finding 3: Webhook replay protection threshold is not documented by Sentry (LOW)

**Issue:** §3a says "reject if >5min old" for the `Sentry-Hook-Timestamp` header, but Sentry's own documentation does not specify the replay window. The 5-minute threshold appears to be an implementation assumption, not a documented Sentry requirement.

**Why it matters:** If Sentry later changes this window (or if it differs by plan/tier), SupportAgent's fixed 5-minute window could be wrong. It could also be too generous (allowing old replays) or too strict (legitimate webhooks from buffering/delayed delivery get rejected).

**Correction**: Add a note acknowledging this is an implementation choice:
```markdown
- **Additional headers**: `Sentry-Hook-Timestamp` (Unix seconds) — Sentry does not document a minimum freshness requirement. SupportAgent enforces a 5-minute (300s) window as a reasonable replay guard. Verify this against current Sentry docs before hardening for production.
```

---

## Finding 4: Internal Integration token limit not mentioned (LOW)

**Issue:** Sentry caps Internal Integrations at 20 tokens per integration. The document does not mention this limit.

**Why it matters:** If a SupportAgent operator creates one Internal Integration per tenant and then generates many tokens (e.g., for rotation, multiple environments), they could hit the 20-token ceiling and be unable to generate new tokens without rotating old ones.

**Correction** in §2b or §3a: Add "Sentry limits Internal Integrations to 20 tokens per integration. Design token rotation around this ceiling if frequent rotation is needed."

---

## Finding 5: `event:write` scope clarification (MINOR)

**Issue:** The Sentry scopes reference says `event:write` covers PUT (updating issues only), and `event:admin` covers DELETE. The document correctly assigns `event:write` to updating issues, but assigns it to "Post/edit/delete comments" as well. Let me verify: comment POST/PUT/DELETE endpoints require `event:write` — this is correct per Sentry's API. The scopes reference only explicitly says "PUT (updating issues only)" but this is a simplification; `event:write` does cover comments.

**Verdict**: No change needed, but the scopes reference documentation could be misleading. Add a note: "`event:write` covers both issue mutations (PUT) and comment mutations (POST/PUT/DELETE) per Sentry's implementation, even though the scopes reference only explicitly calls out PUT for issues."

---

## Finding 6: Self-hosted webhook parity (no change needed)

The document correctly notes Integration Platform webhooks require Sentry 21.x+ on self-hosted. Verified against Sentry documentation — this is accurate.

---

## Summary of Changes Needed

| Priority | Section | Change |
|---|---|---|
| HIGH | §2 | Add OAuth2 (§2d) with auth code + device flow details |
| HIGH | §2 intro | Frame Internal Integration as the chosen option among available options |
| MEDIUM | §2b | Separate webhook Client Secret from auth token |
| MEDIUM | §3a step 4 | Separate `authToken` from `clientSecret` storage |
| LOW | §3a | Add note that 5-minute replay window is an implementation choice |
| LOW | §2b | Add Internal Integration 20-token limit |
| MINOR | §2 / scopes | Clarify `event:write` covers comments |

---

## What Is Correct

The core auth recommendations are sound:
- Internal Integration tokens are the right choice for multi-tenant SupportAgent
- Bearer token header format (`Authorization: Bearer {token}`) is correct
- `event:read` + `event:write` scope recommendation is appropriate for MVP
- HMAC-SHA256 algorithm, `Sentry-Hook-Signature` header name, and `JSON.stringify` HMAC input are all correct
- Non-expiring token behavior for Internal Integrations is accurate
- Member User Token deactivation on deprovisioning is correct
- Webhook retry semantics (exponential backoff, no dedup) are accurate
