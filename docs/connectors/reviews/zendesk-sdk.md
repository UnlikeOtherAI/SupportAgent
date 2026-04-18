# Zendesk Connector — SDK & Implementation Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, build plan realism, config field alignment, cross-connector consistency.
**Source:** `docs/connectors/zendesk.md`
**Date:** 2026-04-18

---

## Verdict: APPROVED WITH CORRECTIONS

The document is technically thorough and the build plan ordering is realistic. Two issues require fixes before implementation: a critical config field gap (Zendesk is absent from `platform-registry.ts`), and an inaccurate SDK maintenance claim that misleads the raw-fetch-vs-SDK rationale. No structural problems with the build plan.

---

## Findings

### 1. npm Package Existence — VERIFIED WITH DATE CORRECTION

| Package | Version | Status | Notes |
|---|---|---|---|
| `node-zendesk` | 6.0.1 | ✅ Exists | Confirmed via npm |

**Critical correction to doc claim (Section 12.1):**

The document states the SDK "last significant update ~2022." This is **incorrect by approximately 2 years**.

Actual `node-zendesk` timeline:
- Version 6.0.1 published: **2024-12-20** (December 20, 2024)
- License: MIT
- Transitive dependencies: `cross-fetch ^4.0.0` only — extremely lightweight, no licensing concerns

The doc should read: "Limited maintenance — last significant update late 2024 (v6.0.1)."

The unmaintained characterization is wrong. This matters because the raw-fetch-vs-SDK rationale in Section 12 relies on this claim.

---

### 2. SDK Capabilities — VERIFIED

**TypeScript types:** ✅ Confirmed — `node-zendesk` ships TypeScript declarations at `./dist/types/index.d.ts`. No separate `@types` package needed.

**Webhook helpers:** ❌ Absent — The SDK does not include webhook signature verification helpers. The doc correctly shows manual HMAC-SHA256 verification using `crypto.createHmac` and `timingSafeEqual`. No correction needed.

**Pagination helpers:** ❌ Absent — The SDK does not include pagination utilities. The doc correctly describes cursor-based pagination via `page[size]`/`page[after]` and offset-based via `per_page`/`page`. Manual iteration is required. No correction needed.

**Retry handling:** ❌ Absent — The SDK does not include automatic retry with backoff. The doc correctly states the need for manual retry logic on 409 (optimistic locking) and 429 (rate limit) responses. No correction needed.

**SDK sub-exports:** `node-zendesk` exposes `clients/*` sub-paths for granular access (e.g., `tickets`, `users`, `organizations`). The MVP can import the top-level client or specific clients. No correction needed.

**Transitive deps:** The only dependency is `cross-fetch ^4.0.0`. No heavy transitive dependency tree or licensing concerns.

---

### 3. Raw Fetch vs SDK Recommendation — COHERENT BUT RATIONALE IS WRONG

Section 12.3 recommends raw `fetch` over the SDK:

**Rationale given:**
1. "SDK may be unmaintained and miss recent API changes (optimistic locking, cursor pagination)" — Incorrect (SDK updated Dec 2024)
2. "Lightweight connector doesn't need full SDK coverage" — Valid
3. "Explicit control over error handling, retries, rate limit backoff" — Valid
4. "Avoids transitive dependency risk" — Valid but overstated (only 1 dep)

**Corrected rationale should read:**
```
node-zendesk lacks webhook verification helpers, pagination utilities, and retry
handling — all three must be implemented manually regardless. The SDK provides
typed endpoint wrappers but adds ~30KB (cross-fetch dep). For a connector that
needs full manual implementation anyway, raw fetch with typed response interfaces
offers better control and smaller bundle.
```

**The decision to prefer raw fetch is sound.** The justification is just factually wrong and should be corrected to focus on capability gaps rather than stale-maintenance claims.

---

### 4. No CLI — CORRECT

Section 12.4 states "Zendesk has no CLI tool for API parity." This is correct. Unlike GitHub (`gh`), Zendesk has no equivalent CLI. No correction needed.

---

### 5. Build Plan Phase Ordering — REALISTIC

| Phase | Blocking on OAuth? | Notes |
|---|---|---|
| MVP: API Token auth + webhooks | No — single token, no redirect | ✅ Realistic |
| Phase 2: Incremental sync, trigger matchers | No — same auth, additional endpoints | ✅ Realistic |
| Phase 3: AI Agents, Omnichannel Routing | No — same auth, Phase 2 builds the foundation | ✅ Realistic |

The Phase 1 → Phase 2 → Phase 3 ordering is correctly staggered. API Token auth requires no OAuth redirect or callback setup — it's a static credential. OAuth is correctly deferred (Section 13, Open Question #1) rather than mandated. The optimistic locking retry strategy (Section 13, Open Question #6) is appropriately flagged as an implementation decision.

---

### 6. Config Fields — CRITICAL GAP: ZENDESK NOT IN PLATFORM REGISTRY

**The `platform-registry.ts` (`packages/contracts/src/platform-registry.ts`) has no `zendesk` entry.** The doc's MVP config field list (Section 11) assumes a registry entry that does not exist.

**Doc MVP config lists 5 fields:**
```
subdomain        — Zendesk subdomain (e.g., "acme")
agent_email      — agent email for API auth
api_token        — API token (encrypted at rest)
bot_user_id      — user ID of SupportAgent agent (no_self_retrigger)
brand_id         — (optional) for multi-brand tenants
```

**Required additions to `platform-registry.ts`**:

| Key | Label | Type | Required | Notes |
|---|---|---|---|---|
| `subdomain` | Zendesk Subdomain | text | Yes | `{subdomain}.zendesk.com` |
| `agent_email` | Agent Email | text | Yes | Email of the agent account |
| `api_token` | API Token | password | Yes | `{email}/token:{token}` |
| `bot_user_id` | Bot User ID | text | Yes | For `no_self_retrigger` |
| `brand_id` | Brand ID | text | No | For multi-brand tenants |

**Category and flags** (consistent with Jira and Linear):

```typescript
key: 'zendesk',
displayName: 'Zendesk',
description: 'Integrate Zendesk Support tickets for inbound intake and outbound updates.',
category: 'issue-tracker',           // Same as Jira, Linear
iconSlug: 'zendesk',
defaultDirection: 'both',             // Inbound + outbound
defaultIntakeMode: 'webhook',         // Primary event intake
supportsCustomServer: true,           // Regional cloud endpoints exist
supportsOAuth: true,                  // OAuth 2.0 supported for production
```

**Note on `bot_user_id`**: The doc correctly marks this as "resolved at config time." Unlike some connectors (GitHub's `bot_login`, Linear's `botActor.id`), the bot user ID in Zendesk is a static integer discovered during initial setup — it should be a **required admin-panel config field**, not runtime-discovered, since Zendesk doesn't expose a lightweight identity endpoint equivalent to `auth.test`.

---

### 7. Cross-Connector Consistency — CONSISTENT

Zendesk connector follows the same structural pattern as Jira, Linear, and GitHub:

| Aspect | GitHub | Jira | Linear | Zendesk | Consistent? |
|---|---|---|---|---|---|
| Direction | `both` | `both` | `both` | `both` (implied) | ✅ |
| Intake mode | webhook | webhook | webhook | webhook | ✅ |
| Auth for MVP | PAT | API Token | PAT | API Token | ✅ — equivalent simplicity |
| Outbound ops | REST mutations | REST (ADF) | GraphQL | REST | ✅ |
| Delivery adapter | POST JSON | POST JSON | POST JSON | POST JSON | ✅ |

No conflicting abstraction detected. The async delivery model, webhook-first intake, and delivery adapter write-back pattern are consistent.

**One unique concern**: Zendesk comments use `public: true/false` for visibility. The connector should support internal notes vs public comments — this is correctly flagged in Open Question #4.

---

### 8. Open Questions — APPROPRIATE

| Question | Status |
|---|---|
| Multi-brand vs single-brand | ✅ Correctly flagged — affects subdomain routing |
| Enterprise vs Team plans | ✅ Correctly flagged — affects custom statuses, SLA fields |
| Help Center vs Support tickets | ✅ Correctly scoped — MVP: Support only |
| Internal vs public comments | ✅ Correctly flagged — affects delete-ability |
| Attachment handling | ✅ Correctly deferred — text-only MVP is fine |
| Optimistic locking retry strategy | ✅ Correctly flagged — requires fetch-fresh-then-retry |
| Webhook vs polling trade-off | ✅ Correctly flagged — proxies/firewalls may block webhooks |
| Custom field schema storage | ✅ Correctly flagged — tenant-specific field IDs |

All open questions raise legitimate deployment/operational blockers. No missing blockers.

**Notable:** The "optimistic locking retry strategy" (Section 13, #6) is correctly surfaced as a blocker. With `409 Conflict` responses mandatory since May 2025, the connector MUST implement retry logic. The open question format is appropriate — the answer should be "fetch-fresh-then-retry" (not surface to user) for automated operations.

---

### 9. Platform Category — NEEDS UPDATE

The `PlatformRegistryEntry` interface uses:
```typescript
category: 'issue-tracker' | 'error-monitoring' | 'version-control' | 'project-management';
```

Zendesk fits `issue-tracker` (same as Jira, Linear). The type does not need modification — only the registry entry needs to be added.

---

## Summary of Required Changes

| # | Location | Issue | Severity |
|---|---|---|---|
| 1 | `platform-registry.ts` | Add `zendesk` entry with 5 config fields | **Critical** — admin panel cannot configure Zendesk without this |
| 2 | Section 12.1 | Correct "last significant update ~2022" → "last significant update late 2024 (v6.0.1)" | Medium |
| 3 | Section 12.3 | Revise raw-fetch-vs-SDK rationale to cite capability gaps, not maintenance status | Medium |
| 4 | Section 11 | `bot_user_id` should be required admin-panel config (not optional) — Zendesk needs static ID at setup time | Low |
| 5 | Section 13 | Add "optimistic locking retry strategy" answer: fetch-fresh-then-retry for automated ops | Low |

Items 1 and 2 must be resolved before implementation. Items 3 and 4 are documentation corrections. Item 5 converts an open question to an architectural decision.

---

## Notes for Implementation Team

1. **Webhook HMAC verification**: Implement `HMAC-SHA256(secret, raw_body)` with `timingSafeEqual`. The `X-Zendesk-Webhook-Signature` header uses base64 encoding. The algorithm header (`X-Zendesk-Webhook-Signature-Algorithm`) is `HMAC-SHA256`.

2. **Optimistic locking (May 2025)**: The 409 Conflict response is now standard. Implement retry with exponential backoff: retry up to 3 times with 100ms base delay.

3. **Rate limit handling**: Use `Retry-After` header on 429. Zendesk rate limits are per-minute windows — distribute requests evenly.

4. **Cursor pagination**: Use `?page[size]=100` with `links.next` for iteration. Store the opaque cursor string between polls.
