# WhatsApp Business Connector — SDK & Implementation Review

**Reviewer:** Claude Code (SDK/Implementation angle)
**Source:** `docs/connectors/whatsapp.md`
**Date:** 2026-04-18

---

## Verdict: APPROVED WITH CORRECTIONS

The doc is architecturally sound and the MVP plan is realistic. Three issues require correction before implementation: one incorrect ECDSA claim, one fictional package reference, and one incomplete SDK acknowledgment.

---

## Findings

### 1. Package `@抽離/whatsapp-webhook` Does Not Exist

**What the doc says (Section 12.1):**
> `@抽離/whatsapp-webhook` — Webhook handling helpers

**What is actually true:**

`@抽離/whatsapp-webhook` is not a real npm package. I verified via `npm view` — no output means the package does not exist. The Unicode characters suggest either a placeholder or a misremembered package name.

**Impact:** Medium — any developer who copy-pastes this package name will have a broken build. The `whatsapp-api-js` package (v6.2.1, MIT, zero deps) provides webhook handling helpers and is a real package.

**Correction:** Replace `@抽離/whatsapp-webhook` with `whatsapp-api-js` and note that it provides webhook message parsing and type definitions, or remove the package entirely and document manual webhook handling (which the doc already describes in detail in Section 2.4/2.5).

---

### 2. ECDSA Signature Claim Is Inaccurate

**What the doc says (Section 2.5 and 10.13):**
> Section 2.5: "Meta signs every inbound webhook delivery using **ECDSA** (curve: P-256)"
> Section 10.13: "X-Hub-SHA256 uses **ECDSA** (P-256 curve), not HMAC-SHA256."

**What is actually true:**

`X-Hub-SHA256` is **HMAC-SHA256**, not ECDSA. The header name itself is a clue — ECDSA would produce a signature that doesn't fit neatly in a header as hex. The code in Section 2.5 (computing `crypto.createHmac('sha256', appSecret)`) is correct and is the actual verification method.

Meta does use ECDSA for **some** Graph API signing (notably for app access token signing), but the webhook signature uses HMAC-SHA256. The doc's implementation code is correct; only the text description is wrong.

**Impact:** Low — the code is correct, but a developer who reads the text and tries to implement ECDSA verification will waste time.

**Correction:** In Section 2.5, change "Meta signs every inbound webhook delivery using **ECDSA** (curve: P-256)" to "Meta signs every inbound webhook delivery using **HMAC-SHA256** with your app secret as the key."

In Section 10.13, remove or correct the ECDSA claim. The current text says "Use the ECDSA method for security" which is doubly wrong — it's not ECDSA and the HMAC method is perfectly secure.

---

### 3. Official SDK Acknowledgment Is Incomplete

**What the doc says (Section 12.1):**
> "For Cloud API, there is **no official npm SDK** from Meta."
> "Meta provides the **WhatsApp Business SDK** but it is primarily for **on-premises** (now deprecated)."

**What is actually true:**

There is a package named `whatsapp` (v0.0.5-Alpha, maintained by `fb`) on npm — this is a Meta-hosted SDK for the Cloud API. It's labeled "Alpha" and is not widely adopted, which partially validates the doc's dismissive tone, but the claim "no official npm SDK" is technically incorrect.

Additionally, `whatsapp-api-js` (v6.2.1) is a mature, actively-maintained third-party library with zero dependencies, full TypeScript types, and webhook helpers. It has 114 versions and 592KB unpacked size.

**Current SDK landscape:**

| Package | Publisher | Status | Notes |
|---|---|---|---|
| `whatsapp` | `fb` | v0.0.5-Alpha | Official Meta SDK, sparse docs, 1 dep |
| `whatsapp-api-js` | secreto31126 | v6.2.1, MIT | Third-party, zero deps, 114 versions |
| `@chat-adapter/whatsapp` | cramforce | v4.26.0 | Vercel/chat ecosystem adapter |

**Impact:** Low — the raw-fetch recommendation is defensible, but the doc should acknowledge these packages exist so implementers can make an informed choice. The current text reads as if no SDK options exist at all.

**Correction:** In Section 12.1, add a note:
> "While these packages exist, the Cloud API is straightforward enough that raw `fetch` with typed TypeScript interfaces is the recommended path. `whatsapp-api-js` is a viable alternative if you prefer an SDK. The official `whatsapp` package from Meta is in Alpha and not recommended for production."

---

### 4. `@抽離/whatsapp-upload` Is Also Non-Existent

**What the doc says (Section 12.4):**
> "For sending media, you may want to use the `@抽離/whatsapp-upload` or implement multipart upload manually."

**What is actually true:**

`@抽離/whatsapp-upload` is not a real npm package. The multipart upload for WhatsApp is a simple `multipart/form-data` POST — no SDK is needed. The doc already describes the upload endpoint in Section 4.10.

**Correction:** Remove the package reference. The recommendation "implement multipart upload manually" is correct — WhatsApp media upload is a single `POST` with `file` field and returns a media ID. No extra package needed.

---

### 5. Raw-Fetch Recommendation Is Coherent and Correct

**Assessment:**

The doc recommends raw `fetch` with typed TypeScript interfaces. This is the right call:

- No first-party Cloud API SDK (the `whatsapp` package is Alpha and not widely used)
- `whatsapp-api-js` exists but has limited adoption compared to the simplicity of the API
- The WhatsApp Cloud API is a straightforward REST API over Graph API
- Full control over retry logic, error handling, and signature verification
- Zero transitive dependency risk

**No action required.** This is correct.

---

### 6. No CLI Option — Correct

**Assessment:**

The doc correctly identifies that there is no `gh`-equivalent for WhatsApp Business. All management happens via the Meta Business Manager web UI or direct API calls.

**No action required.** This is accurate.

---

### 7. Build Plan Ordering — Realistic

**MVP scope assessment:**

| Phase | Feature | Blocking Dependencies |
|---|---|---|
| MVP | Webhook intake, send text/media/template | System User token (no OAuth needed) |
| MVP | Webhook verification | App secret + verify token (simple) |
| MVP | Pairing flow | Working business number + session window |
| Phase 2 | Template management UI | Template approval timeline (non-blocking) |
| Phase 3 | Group chat, analytics | Enterprise tier, full verification |

**Assessment:**

The MVP does not require full OAuth setup — it uses System User tokens which are long-lived and don't need refreshing. This is the right approach for a server-side connector.

The pairing flow is well-specified and works within the 24-hour session window (or template fallback).

**One concern:** Phase 3 "Group chat support (enterprise tier)" is listed but the doc notes in Section 10.14 that the Cloud API does not support group messages. This is contradictory — either remove group chat from Phase 3 or qualify it as "limited enterprise support."

**Correction:** In Section 11 Phase 3, add a qualifier: "Group chat support (enterprise tier, limited availability — see Section 10.14)."

---

### 8. Config Fields — Complete

**Admin panel fields listed (Section 11):**
- `wabaId` ✓
- `phoneNumberId` ✓
- `appId` ✓
- `appSecret` ✓
- `systemUserAccessToken` ✓
- `webhookVerifyToken` ✓
- `webhookUrl` ✓
- `outboundMessageIds` (stored, not a config field) ✓

**Assessment:** All required fields are present. No missing fields for the MVP path.

**One note:** `outboundMessageIds` is listed as a config field but it should be stored state, not config. Label it clearly in the admin UI as "runtime storage" or similar.

---

### 9. Open Questions — Correct and Complete

**Issues correctly raised:**
- Multi-tenant WABA architecture ✓
- Template approval timeline (24-48 hours) ✓
- Business verification tier for MVP ✓
- Message storage strategy ✓
- Outbound template strategy ✓
- Quality rating monitoring ✓
- Self-hosting limitation ✓

**Assessment:** All critical deployment/operational blockers are present. The multi-tenant WABA question (Section 13.1) is the most important — it's a fundamental architecture decision.

**One missing question:**
- **Webhook endpoint reachability** — for local dev you need a tunnel; for production you need valid HTTPS. This affects the admin UI setup flow. Suggest adding to Section 13.

---

### 10. Cross-Connector Consistency — No Issues

**Assessment:**

WhatsApp uses webhooks for inbound and a REST API for outbound. This matches the pattern used by other connectors (GitHub, Teams, Linear). The delivery is async throughout.

No wild abstraction differences from other connectors. The `no_self_retrigger` mechanism (storing outbound message IDs) is a reasonable pattern that could be standardized.

---

### 11. TypeScript Types and Webhook Helpers

**What's available:**

- `whatsapp-api-js`: TypeScript types for message payloads, webhook event types ✓
- `whatsapp` (Meta): Type definitions included ✓
- No webhook signature verification helper exists in any package — manual implementation is required ✓

**Assessment:** The doc correctly describes manual signature verification. No helper package would add significant value over the code shown in Section 2.5.

**No action required** on TypeScript types — raw fetch with typed interfaces is the path forward.

---

### 12. Transitive Dependencies and Licensing

**`whatsapp-api-js`:**
- Zero dependencies
- MIT licensed
- No concerns

**`whatsapp` (Meta official):**
- Single dependency: `@types/node`
- MIT licensed
- No concerns

**`@chat-adapter/whatsapp`:**
- Depends on `chat` and `@chat-adapter/shared`
- MIT licensed
- No concerns

**No licensing or transitive dependency concerns identified.**

---

## Summary

| # | Component | Issue | Severity | Status |
|---|---|---|---|---|
| 1 | Section 12.1 | `@抽離/whatsapp-webhook` is not a real npm package | Medium | Fix required |
| 2 | Section 2.5, 10.13 | ECDSA claim is wrong — webhook uses HMAC-SHA256 | Low | Fix required |
| 3 | Section 12.1 | "No official npm SDK" is technically incorrect | Low | Fix recommended |
| 4 | Section 12.4 | `@抽離/whatsapp-upload` is not a real package | Medium | Fix required |
| 5 | Section 12.2 | Raw-fetch recommendation | — | No action |
| 6 | Section 12.3 | No CLI option | — | No action |
| 7 | Section 11 | Build plan ordering | — | No action (pending Phase 3 qualifier) |
| 8 | Section 11 | Config fields completeness | — | No action |
| 9 | Section 13 | Open questions | — | No action (recommend one addition) |
| 10 | Architecture | Cross-connector consistency | — | No action |
| 11 | Types/typing | Webhook helpers | — | No action |
| 12 | Licensing | Transitive deps | — | No action |

**Required fixes (blocking):**
- Finding #1: Replace or remove `@抽離/whatsapp-webhook`
- Finding #2: Correct ECDSA → HMAC-SHA256
- Finding #4: Remove `@抽離/whatsapp-upload`

**Recommended improvements:**
- Finding #3: Acknowledge `whatsapp-api-js` as an option
- Add Phase 3 qualifier on group chat limitation
- Add webhook reachability to open questions

---

## Recommended Changes (diff-style)

```diff
--- a/Section 2.5
- Meta signs every inbound webhook delivery using **ECDSA** (curve: P-256)
+ Meta signs every inbound webhook delivery using **HMAC-SHA256** with your app secret as the key.

--- a/Section 10.13
- X-Hub-SHA256 uses **ECDSA** (P-256 curve), not HMAC-SHA256. However, Meta also supports a simpler HMAC verification in some cases. Use the ECDSA method for security.
+ X-Hub-SHA256 uses **HMAC-SHA256** with your app secret as the key. This is the standard verification method — no ECDSA involved.

--- a/Section 12.1 (table)
- | @抽離/whatsapp-webhook | Webhook handling helpers |
+ Remove this row (package does not exist).

- | whatsapp-api-js | Lightweight wrapper for WhatsApp Cloud API |
+ Keep but add note: "Consider this if you prefer an SDK over raw fetch."

--- a/Section 12.4
- For sending media, you may want to use the `@抽離/whatsapp-upload` or implement multipart upload manually.
+ Implement media upload manually using `POST /{Phone-Number-ID}/media` with `multipart/form-data`. No SDK needed.

--- a/Section 13 (add)
+ **9. Webhook endpoint reachability.** WhatsApp sends webhooks to your public HTTPS URL. For local dev, you need a tunnel (ngrok/cloudflared). For production, you need a valid TLS cert. How does this affect the onboarding flow?
```