# WhatsApp Business Connector — Authentication & Credentials Review

**Reviewer:** Claude auth audit
**Source:** `docs/connectors/whatsapp.md`
**Scope:** Authentication mechanisms, token transport, scopes, lifetimes, webhook verification, multi-tenant OAuth, secret classification, MVP justification
**Target platform:** WhatsApp Business Platform (Cloud API)

---

## Verdict

**REJECT — critical security contradiction; one significant token refresh inaccuracy.** The most urgent issue is that Section 2.5 describes ECDSA verification while the code example implements HMAC-SHA256 — and only the code is correct. A reader who follows the prose would implement the wrong algorithm. Secondary issues: the token auto-refresh claim is misleading, and the `X-Hub-SHA256` algorithm description is factually wrong.

---

## Findings

### Finding 1 — CRITICAL: Wrong signature algorithm in prose (Section 2.5)

**Location:** `whatsapp.md:79` and `whatsapp.md:88-89`
**Current:**
> Meta signs every inbound webhook delivery using **ECDSA** (curve: P-256) ... Compute HMAC-SHA256 of the body using your **app secret** as the key

**Why it's wrong:** `X-Hub-SHA256` is HMAC-SHA256, not ECDSA. Meta's Graph API webhook signing uses HMAC-SHA256 with the app secret — this is documented across Meta's developer materials and is the reason the code example at lines 91-106 works. ECDSA is used for Facebook Login SDKs and certain Facebook social graph endpoints, not for WhatsApp Business webhooks.

**Why it matters:** An implementer who reads "ECDSA (P-256)" and searches for a P-256 keypair or ECDSA verification library will build something that never matches the `X-Hub-SHA256` header. The signature comparison will always fail, silently dropping or misprocessing all inbound messages. The prose directly contradicts the code example which is actually correct.

**Concrete correction:**
- Line 79: Change "Meta signs every inbound webhook delivery using **ECDSA** (curve: P-256)" to "Meta signs every inbound webhook delivery using **HMAC-SHA256** with the app secret."
- Line 88: Change "Compute HMAC-SHA256 of the body using your **app secret** as the key" to "Compute HMAC-SHA256 of the raw request body using your **app secret** as the key."
- Optionally add a note: "Do not confuse `X-Hub-SHA256` with ECDSA — only the app secret is required, no keypair."

---

### Finding 2 — CRITICAL: Section 10.13 ECDSA claim also wrong, compounding the confusion

**Location:** `whatsapp.md:725-727`
**Current:**
> X-Hub-SHA256 uses **ECDSA** (P-256 curve), not HMAC-SHA256. However, Meta also supports a simpler HMAC verification in some cases. Use the ECDSA method for security.

**Why it's wrong:** The first sentence is incorrect. `X-Hub-SHA256` IS HMAC-SHA256. The second sentence ("Meta also supports a simpler HMAC verification") is backwards — HMAC-SHA256 is the primary method; there is no ECDSA alternative for this header. The third sentence ("Use the ECDSA method for security") is nonsensical — there is no ECDSA method to use.

**Why it matters:** This section is the most explicit statement of the ECDSA misconception. If an implementer skips the code example and reads this as a summary, they will conclude that they need to verify ECDSA signatures and spend hours setting up P-256 keys. This is a direct path to a broken implementation.

**Concrete correction:** Replace the entire section 10.13 with:
> **`X-Hub-SHA256` is HMAC-SHA256.** Meta signs webhook deliveries with an HMAC-SHA256 digest of the raw request body, using the app secret as the key. Compute `HMAC-SHA256(body, app_secret)` and compare with the `X-Hub-SHA256` header using constant-time comparison. No keypair required.

---

### Finding 3 — MEDIUM: Token auto-refresh claim is inaccurate

**Location:** `whatsapp.md:48-50`
**Current:**
> - Long-lived tokens (System User): **~60 days** with automatic refresh
> - System User tokens do not expire as long as the system user remains active and the app is not unpublished
> - No refresh token needed — token auto-refreshes; re-exchange if 401 is received

**Why it's inaccurate:** System User tokens are long-lived (up to ~60 days), but they do **not** automatically refresh. Meta's token extension mechanism works as follows: you exchange a short-lived token for a long-lived one via `fb_exchange_token` once. The resulting long-lived token lasts ~60 days. When it expires, you must perform another exchange — there is no background refresh, no refresh token, no silent renewal. The "auto-refreshes" phrasing implies a background process that does not exist.

**Why it matters:** A connector that implements token caching based on the assumption that tokens "auto-refresh" in the background will hold stale tokens. When the 60-day token expires, the connector will get 401s. The correct behavior is: on 401, perform a fresh `fb_exchange_token` exchange. The document already mentions this ("re-exchange if 401 is received"), but the "auto-refreshes" framing contradicts it and misleads the reader about why 401s happen.

**Concrete correction:** Replace the three bullets with:
> - Short-lived tokens: ~1 hour (standard Facebook Login OAuth flow)
> - Long-lived tokens (System User): up to **~60 days** from the time of exchange. The token does not auto-renew.
> - Re-exchange on expiry: When a long-lived token expires or returns 401, perform a new `fb_exchange_token` exchange to obtain a fresh long-lived token. Store and cache the updated token.
> - System User tokens remain valid as long as the system user and app remain active and the app is not unpublished.

---

### Finding 4 — LOW: Token exchange endpoint HTTP method and path may be imprecise

**Location:** `whatsapp.md:34-38`
**Current:**
```http
POST https://graph.facebook.com/v21.0/oauth/access_token
Content-Type: application/x-www-form-urlencoded

grant_type=fb_exchange_token&client_id={app-id}&client_secret={app-secret}&fb_exchange_token={short-lived-token}
```

**Why it may be imprecise:** Meta's Graph API OAuth token exchange is typically a `GET` request with query parameters, not a `POST` with form-encoded body. Using `POST` for token exchange is non-standard and may not work on all Graph API versions.

**Why it matters:** If the endpoint is implemented with `POST`, some calls may be rejected or behave unexpectedly. Meta's standard OAuth pattern for the Graph API is `GET /oauth/access_token?grant_type=...&client_id=...&client_secret=...&fb_exchange_token=...`.

**Concrete correction:** Change the example to:
```http
GET https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id={app-id}&client_secret={app-secret}&fb_exchange_token={short-lived-token}
```

---

### Finding 5 — LOW: Permission scope names should be verified against Meta's official reference

**Location:** `whatsapp.md:54-58`
**Current:**
| `whatsapp_business_management` | App-level | Read WABA, phone numbers, business profile |
| `whatsapp_business_messaging` | App-level | Send/receive messages, manage templates |
| `business_management` | Business-level | Manage business settings |

**Why it may be imprecise:** The exact permission scope names for WhatsApp Business API should be cross-referenced with Meta's official permissions reference. `whatsapp_business_management` and `whatsapp_business_messaging` are likely correct. However, `business_management` at the "Business-level" tier is ambiguous — in Meta's Graph API, the equivalent is typically `business_management` as a page-level or business-level scope for broader Meta business objects, but the exact granularity and token type requirements for WhatsApp-specific operations may differ.

**Why it matters:** Wrong scope names in setup instructions lead to tokens that lack required permissions. API calls then fail with OAuth errors, and troubleshooting requires reading token debug output — a poor user experience.

**Concrete correction:** Verify the three permission names against the current Meta developer documentation at `developers.facebook.com/docs/whatsapp/business-management-api/overview`. If `business_management` is correct for Business Manager-level operations, add a note specifying that it requires a Business Manager access token (not a System User token alone).

---

### Finding 6 — LOW: App secret vs Verify Token — roles should be explicitly distinguished

**Location:** `whatsapp.md:113-117` and Section 2.4

**Current:** The MVP config lists `appSecret` and `webhookVerifyToken` as separate fields, which is correct. However, the prose does not clearly explain when each is used.

**Why it matters:** The `appSecret` is used for `X-Hub-SHA256` message signature verification. The `webhookVerifyToken` is used for the `hub.verify_token` comparison during webhook setup verification. These are two distinct secrets from two distinct sources. Conflating them leads to using the app secret for verification GET requests or the verify token for message signature checks — both would fail.

**Concrete correction:** Add a brief note in Section 2.4 clarifying:
> Two distinct secrets are required:
> - **`webhookVerifyToken`**: A random string you define. Meta echoes it back in the `hub.verify_token` parameter during webhook setup verification. Set this in the Meta App Dashboard.
> - **`appSecret`**: The Meta App Secret, found in the App Dashboard under Settings > Basic. Used only for `X-Hub-SHA256` message signature verification.

---

### Finding 7 — LOW: Multi-tenant architecture section omits per-tenant app considerations

**Location:** `whatsapp.md:111-117` (MVP recommendation) and Section 10.10

**Current:** The MVP recommendation says to store `appId`, `appSecret`, and `systemUserAccessToken` per-tenant. Section 10.10 notes that each WABA is associated with one Meta Business Manager account.

**Why it matters:** The architecture is underspecified for multi-tenant deployments. Two valid approaches exist:
1. **One WhatsApp Business API app, many WABAs** — The single app has one `appId`/`appSecret` but each tenant has their own WABA and System User token. This requires a single Meta app registered with all relevant webhook fields and phone numbers across WABAs.
2. **One app per tenant** — Each tenant registers their own Meta app, WABA, and credentials. Cleaner isolation but higher setup friction (each tenant must complete Meta's business verification process).

**Concrete correction:** The MVP recommendation should note which approach is recommended for Phase 1 and flag the trade-off:

> **Multi-tenant note:** For Phase 1 MVP, use **one Meta app with multiple WABAs** (one per tenant). This keeps `appId` and `appSecret` shared while storing per-tenant `wabaId`, `phoneNumberId`, and `systemUserAccessToken`. This avoids requiring each tenant to register a new Meta app. For stricter isolation, each tenant can register their own Meta app, but this requires each tenant to complete Meta's business verification separately.

---

### Finding 8 — INFO: No `platform-registry` entry yet — consistency cannot be assessed

**Status:** The platform-registry (`packages/contracts/src/platform-registry.ts`) does not yet include a `whatsapp` entry. Secret type classification (e.g., `api_key`, `webhook_secret`) should be added once the connector is implemented. Expected classification:

- `systemUserAccessToken` → `api_key`
- `appSecret` → `api_key` (or a dedicated `app_secret` type if one is added)
- `webhookVerifyToken` → `webhook_secret`

---

### Finding 9 — INFO: Webhook verification token replay protection not addressed

**Location:** Section 2.4

**Current:** The document describes responding with `hub.challenge` when `hub.verify_token` matches but does not address replay protection.

**Why it matters:** The webhook verification GET request can be replayed by an attacker who learns the `hub.verify_token`. If the endpoint blindly responds with `hub.challenge`, an attacker with network access can trigger verification at will. Mitigation: use a timing-safe comparison (already implied) and consider returning 403 for requests where `hub.mode` is unknown.

**Concrete correction:** Add one sentence:
> Always compare `hub.verify_token` using constant-time comparison. Ignore requests where `hub.mode` is not `subscribe` — do not echo back `hub.challenge` for unexpected modes.

---

## Items Confirmed Correct

| Item | Status |
|---|---|
| Token transport header: `Authorization: Bearer {token}` | Correct |
| Token type: System User Access Token for server-side connector | Correct |
| Short-lived token lifetime: ~1 hour | Correct |
| Long-lived token lifetime: ~60 days | Correct |
| Webhook verification GET flow (`hub.mode`, `hub.verify_token`, `hub.challenge`) | Correct |
| `X-Hub-SHA256` header name | Correct |
| `hub.challenge` response pattern | Correct |
| Required permissions: `whatsapp_business_management` + `whatsapp_business_messaging` | Likely correct (needs official doc cross-check, see Finding 5) |
| MVP recommendation to use System User tokens | Correct and justifiable |
| Per-tenant storage fields | Correct and appropriately scoped |
| Platform category: `communication` | Correct |

---

## Summary Table

| Severity | Location | Issue |
|---|---|---|
| CRITICAL | §2.5, line 79 | Wrong algorithm — says ECDSA, should be HMAC-SHA256 |
| CRITICAL | §10.13, lines 725-727 | ECDSA claim contradicts code; use of "simpler HMAC" phrasing is backwards |
| MEDIUM | §2.2, lines 48-50 | "Auto-refresh" token claim is inaccurate — tokens do not auto-renew |
| LOW | §2.1, lines 34-38 | Token exchange should use GET, not POST |
| LOW | §2.3, lines 54-58 | Permission scope names need official doc cross-reference |
| LOW | §2.4 and §2.5 | App secret vs verify token roles should be explicitly distinguished |
| LOW | §2.6 and §10.10 | Multi-tenant architecture should specify single-app vs per-tenant app approach |
| INFO | platform-registry | No entry yet — expected `api_key`/`webhook_secret` classification when added |
| INFO | §2.4 | Webhook verify token replay protection should be mentioned |

**Required fixes (blocking before merge):** Findings #1 and #2 — the ECDSA/HMAC contradiction would lead to a broken implementation. Finding #3 is recommended before the auth section is used for implementation guidance.
