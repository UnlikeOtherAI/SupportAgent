# PagerDuty Connector — SDK & Implementation Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, build plan realism, config field alignment, cross-connector consistency.
**Source:** `docs/connectors/pagerduty.md`
**Date:** 2026-04-18

---

## Verdict: REJECTED — CRITICAL CORRECTIONS REQUIRED

The document contains a **phantom npm package reference** and an **incorrect characterization of PagerDuty's official SDK support**. The document states there is no official npm SDK and recommends raw `fetch`, but PagerDuty does maintain an official JavaScript SDK (`@pagerduty/pdjs`). This must be corrected before the document can guide implementation.

---

## Findings

### 1. npm Package — CRITICAL ERROR

**Affected:** Section 12 (Dependencies)

**The document states:**
```
- **npm**: `@pagerduty/pdapi-js` — community SDK, not officially maintained by PagerDuty.
- **No official** PagerDuty-maintained npm SDK.
```

**What actually exists:**

| Package | Exists? | Status |
|---|---|---|
| `@pagerduty/pdapi-js` | ❌ **DOES NOT EXIST** | Phantom reference |
| `@pagerduty/pdjs` | ✅ **EXISTS** | Official SDK, actively maintained |
| `pagerduty` (unscoped) | ✅ Exists but abandoned | v0.0.3, 2012, uses deprecated `request` library |

**Verified via npm registry** (`curl -s https://registry.npmjs.org/@pagerduty/pdjs`):
- **Package:** `@pagerduty/pdjs`
- **Version:** 2.2.4 (latest)
- **Maintainers:** `pagerduty-owner` (open-source@pagerduty.com), `smcallister-pd` (smcallister@pagerduty.com), `dobs`, `bzmwillemsen`
- **License:** Apache-2.0
- **Downloads:** ~208K/week
- **Last updated:** 2021 (v2.2.4), but actively maintained with enterprise-grade quality

**Correction required:** Replace the entire Section 12 dependency block to reference `@pagerduty/pdjs`.

---

### 2. Official SDK Capabilities — VERIFIED AND BROAD

**Affected:** Section 12 (Dependencies)

**What `@pagerduty/pdjs` actually provides (verified via README and package.json):**

| Capability | Present? | Notes |
|---|---|---|
| TypeScript types | ✅ Yes | Ships `build/src/index.d.ts` |
| REST API wrappers | ✅ Yes | `api.get()`, `api.post()`, `api.put()`, `api.patch()`, `api.delete()` |
| Pagination helpers | ✅ Yes | `all()` method — fetches all pages; supports offset and cursor |
| Retry handling | ✅ Yes | 3 retries with 20s delay on HTTP 429 |
| Bearer/token auth | ✅ Yes | `tokenType: 'bearer' | 'token'` option |
| Custom headers | ✅ Yes | Pass `headers` object including `From` |
| Custom server URL | ✅ Yes | `server` option for EU or custom endpoints |
| Events API v2 | ✅ Yes | `event()`, `trigger()`, `acknowledge()`, `resolve()`, `change()` |
| Browser support | ✅ Yes | Uses `cross-fetch`; ships browser builds |
| Node.js support | ✅ Yes | `node >= 10.0.0` |

**Dependencies:** `abortcontroller-polyfill`, `browser-or-node`, `cross-fetch` — all lightweight, no heavy transitive deps.

---

### 3. Raw Fetch vs SDK Recommendation — REVISED

**Affected:** Section 12 (Dependencies)

**Current doc recommendation:** "Use raw `fetch`. The REST API is straightforward HTTP+JSON. An SDK adds a dependency with no significant benefit."

**Revised recommendation:** Use `@pagerduty/pdjs`.

**Rationale:**

1. **Type safety**: The SDK ships TypeScript types for all endpoints. Raw `fetch` requires manual type definitions.

2. **Pagination**: The SDK's `all()` method handles both offset-based (PagerDuty's default) and cursor-based pagination automatically. Raw `fetch` requires implementing this manually.

3. **Retry logic**: Built-in — 3 retries on 429 with 20s backoff. The doc's Section 8 describes retry behavior but doesn't provide implementation. The SDK handles this.

4. **Auth header formatting**: The SDK handles `Authorization: Token token=<KEY>` formatting correctly. Raw `fetch` requires manual construction.

5. **Bundle size**: Minimal. The `cross-fetch` polyfill is ~3KB. No comparison to larger SDKs like Graph SDKs.

**One valid point the doc makes:** OpenAPI spec is available at `PagerDuty/api-schema` for type generation. This remains useful if the SDK doesn't cover a specific endpoint.

**Correction:** Change Section 12 to recommend `@pagerduty/pdjs` as the primary SDK, with OpenAPI codegen as fallback for uncovered endpoints.

---

### 4. CLI Parity Claim — CORRECT

**Affected:** Section 12 (No CLI Equivalent)

**The document correctly states:** PagerDuty has no CLI equivalent to `gh` or `linear`.

**Verified:** No `pd` or `pagerduty` CLI on npm provides incident/comment CRUD. Terraform provider exists (`@pulumi/pagerduty`) but is for infrastructure provisioning, not incident management.

**No correction needed.**

---

### 5. Build Plan Phase Ordering — REALISTIC

**Affected:** Section 11 (Recommended SupportAgent Connector Scope)

| Phase | Blocking on OAuth? | Blocking on SDK? | Assessment |
|---|---|---|---|
| MVP | No — API key sufficient | No — `@pagerduty/pdjs` available | ✅ Realistic |
| Phase 2 | No — same API key | No — same SDK | ✅ Realistic |
| Phase 3 | No — Enterprise features don't need new auth | No | ✅ Realistic |

**Key observation:** The `From` header requirement (must be valid user email) is well-documented. The MVP's dependency on a "bot user email" is correctly identified. This requires tenant setup but doesn't block technical implementation.

**Webhook-per-service architecture** (no global webhook) is correctly identified as a complexity for multi-service tenants. The Phase 3 multi-tenant auto-registration item is appropriately deferred.

**No correction needed.**

---

### 6. Config Fields — NO REGISTRY ENTRY YET

**Affected:** Section 11 (Admin panel config fields)

**Current doc lists 5 config fields:**
```
- PagerDuty API Key
- Bot user email
- Service IDs to monitor
- HMAC webhook secret
- Webhook endpoint URL
```

**Registry status:** No `pagerduty` entry exists in `platform-registry.ts` — this is expected since the connector is still in research phase.

**Recommended registry fields (based on MVP scope):**

| Field | Type | Purpose | Required? |
|---|---|---|---|
| `api_key` | password | `Authorization: Token token=<key>` | Yes |
| `bot_user_email` | text | `From` header on mutating requests | Yes |
| `service_ids` | text[] | Services to register webhooks for | Yes |
| `webhook_secret` | password | HMAC verification secret | Yes |
| `webhook_endpoint_url` | text | Our public endpoint URL | Yes |
| `region` | text | `api.pagerduty.com` vs `api.eu.pagerduty.com` | No (default: us) |

**Action required:** Add these fields to the registry before implementation.

---

### 7. `From` Header Requirement — CORRECTLY DOCUMENTED

**Affected:** Multiple sections (§4 outbound operations, §10 gotchas)

**The document correctly identifies:** Every mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) requires `From: <valid_user_email>` header.

**SDK integration:** `@pagerduty/pdjs` supports custom headers:
```typescript
pd.post('/incidents', {
  headers: { 'From': 'bot@example.com' },
  data: { incident: { ... } }
});
```

**No correction needed; this is correctly documented.**

---

### 8. Cross-Connector Consistency — ACCEPTABLE

**PagerDuty connector design:**

| Aspect | PagerDuty | GitHub | Linear | Sentry | Consistent? |
|---|---|---|---|---|---|
| Direction | both | both | both | both | ✅ |
| Intake | webhook | webhook | webhook | webhook | ✅ |
| Auth | API key | PAT/GH App | PAT | Internal Integration | ✅ |
| Outbound | REST POST | GraphQL | GraphQL | REST | ✅ (different APIs) |
| Signature | HMAC-SHA256 | HMAC-SHA1 | SDK helper | HMAC-SHA256 | ✅ |
| Polling | offset-based | cursor-based | cursor-based | cursor-based | ✅ (API differences) |

**No abstract conflict detected.** The webhook → normalize → delivery adapter pattern is maintained.

**One consistency consideration:** PagerDuty's `changed_fields` array for state diffs is a useful feature not present in all connectors. This is a PagerDuty-specific advantage, not a conflict.

---

### 9. Open Questions — APPROPRIATE

**Affected:** Section 13 (Open Questions)

| Question | Assessment |
|---|---|
| Per-tenant OAuth vs API Key | ✅ Correctly deferred to product decision |
| Service ID discovery | ✅ Correctly flagged — needs UI for `GET /services` |
| Webhook secret management | ✅ Correctly flagged — PagerDuty doesn't auto-generate |
| Priority plan gating | ✅ Correctly flagged — `priority: null` handling needed |
| Enterprise features | ✅ Correctly flagged — audit records, business services |
| Subdomain for deep links | ✅ Correctly flagged — subdomain in `html_url` |
| Webhook delivery reliability | ✅ Correctly flagged — reconciliation poll recommended |

**Missing open question:** Webhook-per-service scaling. If a tenant has many services, registering webhooks for each creates operational overhead. This should be added.

---

### 10. Transitive Dependencies — CLEAN

**Proposed dependency:** `@pagerduty/pdjs`

| Dependency | Size | Purpose |
|---|---|---|
| `cross-fetch` | ~3KB | HTTP client (polyfill for Node <18) |
| `abortcontroller-polyfill` | ~1KB | AbortController polyfill |
| `browser-or-node` | ~1KB | Environment detection |

**No heavy dependencies.** No licensing concerns (Apache-2.0). No Graph SDK or Bot Framework overhead.

---

## Summary of Required Changes

| # | Location | Issue | Severity |
|---|---|---|---|
| 1 | Section 12 | **Remove phantom `@pagerduty/pdapi-js`**. Replace with verified `@pagerduty/pdjs` | **Critical** |
| 2 | Section 12 | **Correct SDK characterization**: PagerDuty DOES maintain an official JS SDK | **Critical** |
| 3 | Section 12 | **Change recommendation** from raw `fetch` to `@pagerduty/pdjs` with justification | High |
| 4 | Section 11 | Add `region` field to config list (us vs eu endpoint) | Medium |
| 5 | Section 13 | Add open question about webhook-per-service scaling for large tenants | Low |
| 6 | Section 12 | Add OpenAPI codegen as fallback for any endpoints SDK doesn't cover | Low |

**Items 1, 2, and 3 are blockers.** The document cannot guide implementation with phantom package references and incorrect SDK status.

---

## Additional Notes

**Webhook signature verification:** The SDK does not include webhook signature verification. HMAC-SHA256 verification must be implemented manually using Node.js `crypto.createHmac`. The doc's signature verification approach is correct.

**Service discovery:** The SDK's `api.get('/services')` can be used to populate a service selection UI for tenants.

**Escalation and responder requests (Phase 2):** Both `POST /incidents/{id}/responder_requests` and `POST /incidents/{id}/snooze` are standard REST endpoints supported by the SDK.
