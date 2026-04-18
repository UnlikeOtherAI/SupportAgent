# Notion Connector — SDK & Implementation Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, build plan realism, config field alignment, cross-connector consistency.
**Source:** `docs/connectors/notion.md`
**Date:** 2026-04-18

---

## Verdict: APPROVED WITH CRITICAL FLAG

The document is technically accurate on all verifiable claims. The `@notionhq/client` SDK exists with the stated capabilities. No phantom packages. No CLI parity claims to validate.

**Critical blocker:** Notion's UI-only webhook registration model fundamentally conflicts with SupportAgent's multi-tenant delivery adapter unless resolved in the open questions. This is not a correctness issue in the doc — it is an architectural incompatibility that must be addressed before implementation begins.

---

## Findings

### 1. npm Package Existence — VERIFIED

| Package | Version | Status | Notes |
|---|---|---|---|
| `@notionhq/client` | 5.19.0 | ✅ Exists | Official Notion SDK. Confirmed via npm registry. MIT license. Zero external runtime dependencies. TypeScript typings included at `./build/src/index.d.ts`. |

No phantom packages. This is the only npm dependency the doc references.

---

### 2. SDK Capabilities — VERIFIED

The doc states in Section 12:

> **Features**: Typed client for all endpoints, built-in retry with `Retry-After` handling, cursor pagination helpers

**Verified against SDK source (notionhq/notion-sdk-js, makenotion org):**

| Claim | Status | Evidence |
|---|---|---|
| Typed client | ✅ | TypeScript types included in package. `index.d.ts` exposes all endpoint methods. |
| Built-in retry with `Retry-After` handling | ✅ | SDK retries HTTP 429 (`rate_limited`) and 500/503 for GET/DELETE. Respects `Retry-After` header in both delta-seconds and HTTP-date formats. Exponential backoff with jitter. Configurable via `retry: { maxRetries, initialRetryDelayMs, maxRetryDelayMs }`. |
| Cursor pagination helpers | ✅ | `iteratePaginatedAPI(listFn, firstPageArgs)` utility turns any paginated API into an async iterator. Cursor-based via `start_cursor` / `has_more` pattern matches Notion's API. |

**No webhook helpers claimed or expected.** The doc correctly does not claim webhook verification helpers. HMAC-SHA256 via `X-Notion-Signature` must be implemented manually (Section 3, Gotcha #2). This is correct — Notion has no SDK webhook handler.

**SDK type guards claimed accurately:**
- `isFullPage`, `isFullBlock`, `isFullUser`, `isFullComment` — all verified in SDK exports
- `isFullPageOrDataSource` — verified (Notion added DataSource types in 2025)

**SDK auth handling:** The doc correctly shows `Client({ auth: token })`. The SDK accepts both integration tokens and OAuth access tokens — the same client works for both auth modes. The `baseUrl` override is supported for future GHES-equivalent if Notion ever offers self-hosting (currently cloud-only per Section 2).

---

### 3. Raw Fetch vs SDK Recommendation — COHERENT

Section 12 states:

> **Use it**: YES. `@notionhq/client` is well-maintained, fully typed, and handles the quirks (token format, version header, retry logic). Do not use raw `fetch`.

**This is correct.** Unlike the Linear doc (which recommends raw `fetch` for GraphQL because the SDK is auto-generated with 1054+ classes), Notion's REST SDK is purpose-built and lightweight. The SDK's built-in retry handling and typed endpoint methods are worth the dependency. Raw `fetch` would lose:
- Automatic `Retry-After` header handling
- Async iterator pagination via `iteratePaginatedAPI`
- Typed request/response contracts
- The version header (`Notion-Version: 2026-03-11`) which the SDK injects automatically

**No contradictory guidance** between the doc's outbound examples and SDK usage.

---

### 4. CLI Parity Claim — ACCURATE

Section 12 states:

> Notion has no equivalent to `gh` or `glab`. No CLI for parity operations.

**Verified.** Notion does not ship a CLI tool. There is no `@notionhq/cli` on npm. No validation needed — this is definitively correct.

---

### 5. Build Plan Phase Ordering — REALISTIC with one critical gap

| Phase | Blocking on OAuth? | Status |
|---|---|---|
| MVP: Integration token + webhook events + polling fallback | No — integration token is a single static token | ✅ Realistic |
| Phase 2: Regex matching, property diffs, file uploads | No — uses same auth | ✅ Realistic |
| Phase 3: Multi-database, relation traversal, real-time SSE proxy | No | ✅ Realistic |

The phase ordering is correct. Integration token is sufficient for MVP. OAuth is additive, not blocking.

**However, there is a critical gap in the MVP scope**: Section 11 lists webhook handling as MVP scope, but Section 10 (Gotcha #2) and Section 3 explicitly state:

> Webhook subscriptions must be created in the Notion UI. No API to create/delete/list webhooks.

This means every tenant must manually configure webhooks in their Notion workspace. This is not an implementation detail — it is a **fundamental onboarding blocker** for multi-tenant SaaS. The doc mentions this in Gotchas and Open Questions, but the MVP scope in Section 11 does not reflect this reality.

**Recommended fix**: The MVP scope in Section 11 should explicitly state that webhook registration is a **manual per-tenant step** and that the MVP connector code must handle:
1. Receiving webhook deliveries (already in scope)
2. Storing the webhook verification token per-tenant
3. Providing documentation for the tenant to configure the webhook in their Notion workspace

Without this, the MVP is underspecified for multi-tenant deployment.

---

### 6. Config Fields — NO PLATFORM REGISTRY ENTRY

**Notion has no entry in `packages/contracts/src/platform-registry.ts`.** This is expected for a new connector, but the doc's Section 11 MVP config fields list must be validated against the `PlatformConfigField` schema.

**Doc Section 11 lists 7 fields:**

| Doc field | Type | Required? | Matches schema? |
|---|---|---|---|
| `integration_token` | password | ✅ | ✅ |
| `workspace_id` | text | ✅ | ✅ |
| `bot_user_id` | text | ✅ | ✅ |
| `database_id` | text | ✅ | ✅ |
| `webhook_verification_token` | password | ✅ | ✅ |
| `webhook_secret` | password | ✅ | ✅ |
| `poll_interval_seconds` | number | ✅ | ✅ |

**Schema alignment:** The `PlatformConfigField` interface uses `type: 'text' | 'password' | 'url' | 'number' | 'toggle'`. All doc fields map cleanly:
- Token fields → `type: 'password'`, `secretType: 'api_key'`
- UUID fields (`workspace_id`, `database_id`, `bot_user_id`) → `type: 'text'`
- `poll_interval_seconds` → `type: 'number'`

**Missing from doc but needed for multi-tenant:** If OAuth is eventually supported, the doc will need `oauth_access_token` and `oauth_refresh_token` fields. The doc correctly uses `integration_token` for MVP but should note the OAuth field plan.

**Action required**: Add Notion entry to `platform-registry.ts` with these 7 fields before implementation. The category should be `project-management` (per Section 1's categorization).

---

### 7. Cross-Connector Consistency — CONSISTENT

| Aspect | GitHub | Linear | Notion | Consistent? |
|---|---|---|---|---|
| Direction | `both` | `both` | `both` | ✅ |
| Intake mode | webhook | webhook | webhook + polling fallback | ✅ (polling is explicit fallback) |
| Auth for MVP | PAT | PAT | Integration token | ✅ (equivalent) |
| Outbound ops | REST | GraphQL | REST | ✅ |
| Delivery adapter | POST JSON | POST JSON | POST JSON | ✅ |
| `no_self_retrigger` | issue author id | `botActor.id` | `created_by.id` vs bot user id | ✅ (consistent pattern) |

The `no_self_retrigger` implementation in Section 7 is consistent with other connectors. Storing `bot_user_id` from `GET /v1/users/me` and comparing `data.comment.created_by.id` matches the pattern used in GitHub and Linear.

**Notion-specific nuance correctly handled:** Notion's bot-type users have no `person.email` field (Section 7). The doc correctly acknowledges this and uses `bot.owner` and `workspace_name` as fallbacks. This is accurate.

---

### 8. Open Questions — APPROPRIATE with one addition

| Question | Status |
|---|---|
| Cloud vs per-tenant OAuth | ✅ Correctly flags the core multi-tenant question |
| Webhook manual setup | ✅ Correctly flags the UI-only limitation — **this is the critical blocker** |
| Database selection | ✅ Correctly flags tenant schema dependency |
| Property mapping | ✅ Correctly flags configurable field names per tenant |
| Comment threading | ✅ Correctly flags `block_id` vs `page_id` |
| File attachment scope | ✅ Correctly defers to Phase 2 |
| Workspace vs database parent | ✅ Correctly flags `parent` object shape difference |

**Recommended addition to Open Questions:**

> **Webhook delivery URL availability**: Notion requires a public HTTPS URL for webhook endpoints. Does SupportAgent expose a shared inbound URL per tenant, or does each tenant need to provision their own public endpoint? This affects whether Notion is viable for multi-tenant deployments without significant infrastructure work.

This is distinct from the "webhook manual setup" question and should be called out separately, as it affects the deployment architecture.

---

### 9. Webhook Verification — MANUAL HMAC (CORRECT)

Section 3 describes HMAC-SHA256 verification:
- Header: `X-Notion-Signature: sha256={HMAC-SHA256(request_body, verification_token)}`
- Verification token stored from UI setup

This matches Notion's documented webhook verification scheme. The doc does not claim SDK support for this — correctly so, as the SDK has no webhook handler.

The `timingSafeEqual` guidance is implicit (not shown explicitly), but standard practice. The doc should explicitly recommend constant-time comparison:

> **Verification code must use `crypto.timingSafeEqual`** to prevent timing attacks on the HMAC comparison.

---

### 10. Rate Limit Claim — VERIFIED

Section 9 states:
- 3 req/s average per integration
- `Retry-After` header respected
- Token-bucket at 2.8 req/s recommended

**Verified against Notion API documentation.** The SDK respects `Retry-After` in delta-seconds format. The 10% headroom recommendation (2.8 vs 3.0) is prudent.

**Note**: The SDK's built-in retry is already configured to handle this. The doc's `token-bucket at 2.8 req/s` recommendation is conservative guidance for request orchestration — the SDK will back off on 429s regardless.

---

### 11. Polling Fallback — COMPLETE

Section 3 polling section is well-specified:
- Uses `last_edited_time` sort on `databases/{id}/query` — correct
- 30s–60s interval for MVP — reasonable
- Cursor: `last_edited_time` — correct

The polling fallback is more viable for Notion than for webhook-first platforms because:
1. Notion's webhook events are limited (`page.content_updated` is aggregated/batched)
2. No API for programmatic webhook registration
3. Polling `databases/{id}/query` with `last_edited_time` filter is deterministic

This makes the polling fallback **primary intake mechanism** for MVP, not just a fallback. The doc should clarify this in Section 3.

---

## Summary of Required Changes

| # | Location | Issue | Severity |
|---|---|---|---|
| 1 | Section 11 (MVP scope) | Add explicit note that webhook registration is a manual per-tenant UI step | Critical |
| 2 | Section 3 (Webhook Support) | Add explicit recommendation to use `crypto.timingSafeEqual` for HMAC verification | Medium |
| 3 | Section 3 (Polling Fallback) | Clarify that polling is the primary MVP intake, not just a fallback | Low |
| 4 | Open Questions (#13) | Add question about public webhook URL availability per tenant | Medium |
| 5 | Implementation | Add Notion entry to `platform-registry.ts` with 7 config fields | Required before impl |
| 6 | Category metadata | Set `category: 'project-management'`, `defaultDirection: 'both'`, `defaultIntakeMode: 'polling'` (or `'webhook'` with manual setup caveat) | Required before impl |

Item 1 is the critical blocker — the document underspecifies the MVP scope by not acknowledging that webhook registration cannot be automated. Items 2–6 are implementation prerequisites, not correctness issues.

---

## Sources

- [@notionhq/client npm package](https://www.npmjs.com/package/@notionhq/client) (v5.19.0)
- [Notion SDK JS GitHub](https://github.com/makenotion/notion-sdk-js) (README verified for retry, pagination, types)
