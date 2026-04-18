# Confluence Connector — Operational Reliability Review

**Reviewer**: Limits & Reliability
**Source**: `docs/connectors/confluence.md`
**Date**: 2026-04-18

## Verdict: FAIL — Material inaccuracies in rate limit characterization

The document severely understates Confluence Cloud's rate-limiting architecture. Atlassian publishes detailed, points-based rate limits with two tiers, but the doc claims they are "undocumented in public docs" and cites a bogus "100 req/min per tenant" figure. This will cause under-provisioning.

---

## Findings

### 1. Rate Limit Numbers — WRONG

**Area affected**: Section 8 (Rate Limits)

**Claim in doc**:
> "Undocumented in public docs — Atlassian has internal rate limits"
> "Typical: ~100 requests/minute per tenant"

**Correct value / behavior**:

Confluence Cloud REST API v2 uses a **points-based rate limiting** with **two tiers**:

**Tier 1 — Global Pool**: 65,000 points/hour shared across all tenants.

**Tier 2 — Per-Tenant Pool** (per edition):
- Free: 65,000 pts/hr
- Standard: 100,000 + (10 × users)/hr (capped at 500,000)
- Premium: 130,000 + (20 × users)/hr (capped at 500,000)
- Enterprise: 150,000 + (30 × users)/hr (capped at 500,000)

**Points system**:
- Base cost: 1 point per request
- Core domain objects (GET): +1 per object returned
- Identity & access objects (Users, Groups, Permissions): +2 per object returned
- Write operations (POST/PUT/PATCH/DELETE): 1 point flat (no per-object charge)

This means a paginated list response returning 25 pages costs ~51 points (1 base + 25 per-object), not 25 or 1. The claim of "undocumented" is false — Atlassian has a dedicated page at `developer.atlassian.com/cloud/confluence/rate-limiting`.

**Citation**: [Confluence Cloud Rate Limiting (developer.atlassian.com)](https://developer.atlassian.com/cloud/confluence/rate-limiting)

---

### 2. Rate Limit Headers — Incomplete

**Area affected**: Section 8 (Rate Limits)

**Claim in doc**:
> "Response may include `X-RateLimit-*` headers if exceeded"

**Correct value / behavior**:

Headers are returned **when approaching or exceeding limits**, not only when exceeded:

| Header | Purpose |
|--------|---------|
| `X-RateLimit-Limit` | Max request rate for current scope |
| `X-RateLimit-Remaining` | Remaining capacity in current window |
| `X-RateLimit-Reset` | ISO 8601 timestamp when window resets |
| `X-RateLimit-NearLimit` | Returns `"true"` when <20% quota remains |
| `RateLimit-Reason` | Throttle reason (e.g., `confluence-quota-global-based`) |
| `Retry-After` | Seconds to wait (only on 429) |

Additionally, Beta headers are present (`Beta-RateLimit-Policy`, `Beta-RateLimit`) containing `q` (total quota), `w` (window), `r` (remaining), `t` (seconds until reset).

The framing "may include" is too passive — implementers should expect these headers and should **monitor `X-RateLimit-Remaining` proactively**, not just react to 429s.

**Citation**: [Confluence Cloud Rate Limiting (developer.atlassian.com)](https://developer.atlassian.com/cloud/confluence/rate-limiting)

---

### 3. 429 Response Behavior — Incomplete

**Area affected**: Section 8 (Rate Limits)

**Claim in doc**:
> "Use exponential backoff if 429 received"

**Correct value / behavior**:

The doc under-specifies 429 semantics. Atlassian states:
- Returns **HTTP 429 Too Many Requests**
- All requests are denied until the hourly window resets — **no gradual throttling, hard block**
- `Retry-After` header value is in seconds
- Recommended backoff: exponential with jitter, delay doubles after each 429, **max delay: 30s**
- Maximum recommended retries: **4**
- Retry only when the request is **idempotent** and `Retry-After` header is present

The "add 200-500ms delay between requests" advice in the same section is oddly specific and contradicts the actual quota budget — with 65,000–500,000 points/hour, a 250ms inter-request delay caps out at ~14,400 requests/day per tenant, well within budget.

**Citation**: [Confluence Cloud Rate Limiting (developer.atlassian.com)](https://developer.atlassian.com/cloud/confluence/rate-limiting)

---

### 4. Pagination — ACCURATE

**Area affected**: Section 9 (Pagination & Search)

**Claim in doc**: "Cursor-based via `cursor` parameter and `Link` header", default 25, max 100.

**Correct value / behavior**: Confirmed. Cursor-based pagination via `limit` and `cursor` parameters, with both `Link` header (`rel="next"`) and `/_links/next` in response body. Default 25, max 100. **No issues found.**

**Pagination under concurrent writes**: The doc does not address cursor stability under concurrent writes. Cursor pagination in Confluence can skip or duplicate items if pages are created/modified during traversal. For reconciliation scenarios, implementers should:
- Bookmark the cursor before starting
- After full traversal, diff against persisted state
- Re-fetch items with `updatedAt >= last_sync` to catch missed items

---

### 5. Bulk Endpoints — No Claims Made (OK)

**Area affected**: Outbound section

**Claim in doc**: No bulk endpoints mentioned.

**Correct value / behavior**: Confluence REST API v2 does not provide batch or bulk endpoints (e.g., no bulk page create, bulk comment post). Each operation is a separate request. **This is accurate.** The connector is correctly scoped without assumed bulk operations.

---

### 6. Error Response Shape — Not Characterized (Missing)

**Area affected**: Section 8 and general

**Claim in doc**: Error responses are not described.

**Correct value / behavior**: Confluence returns structured error bodies. Standard API errors look like:

```json
{
  "message": "string",
  "reason": "string",
  "data": { ... },
  "documentation_url": "string"
}
```

Validation errors:
```json
{
  "message": "string",
  "errors": [{ "message": "string", "path": "string" }],
  "data": { ... }
}
```

The doc should characterize these shapes so implementers can handle them correctly. HTTP status codes are standard: 400 (validation), 401 (auth), 403 (forbidden), 404 (not found), 429 (rate limited), 500 (server error).

**Recommendation**: Add a small error response section or reference Atlassian's error format.

---

### 7. Concurrency Limits — Under-specified

**Area affected**: Section 8 (Rate Limits)

**Claim in doc**: No concurrency guidance.

**Correct value / behavior**: Atlassian explicitly states:
- Burst limits exist over short windows (seconds) to prevent traffic spikes
- "Do not use concurrency to bypass limits"
- Excessive parallelism triggers 429s
- High-impact endpoints (Permissions, Search, Admin) have additional burst protections

The doc's recommendation of "add 200-500ms delay between requests" does not address concurrency at all. Implementers running multiple workers should be warned to avoid parallel bursts on the same tenant.

**Recommendation**: Add a note that max **2-4 concurrent requests per tenant** is advisable given burst limits, and to spread load over time with jitter.

---

### 8. Data Center Rate Limits — ACCURATE

**Area affected**: Section 8 (Rate Limits)

**Claim in doc**: "No rate limits (self-hosted)."

**Correct value / behavior**: Confirmed. Confluence Data Center/Server does not apply Atlassian Cloud rate limits. **No issues found.**

---

### 9. Claims of "Unlimited" — Not Found (OK)

**Area affected**: General

**Claim in doc**: No "unlimited" rate limit claims made.

**Correct value / behavior**: N/A. No false "unlimited" claims found. The ~100 req/min figure is an undercount, not an overcount of unlimited.

---

### 10. Retry Advice That Worsens Rate Limiting — FOUND

**Area affected**: Section 8 (Rate Limits)

**Claim in doc**: "Add 200-500ms delay between requests"

**Issue**: This is not retry advice per se, but the arbitrary delay recommendation does not account for the actual rate budget. A 250ms delay produces ~14,400 req/day, which is conservative relative to a 65,000–500,000 point/hour budget. However, for high-throughput reconciliation (e.g., syncing thousands of pages), this delay could make the sync unacceptably slow. Implementers should instead rely on `X-RateLimit-Remaining` to pace requests dynamically.

---

## Summary Table

| Area | Doc Claim | Correct Value | Status |
|------|-----------|---------------|--------|
| Rate limit numbers | "Undocumented, ~100 req/min" | Points-based: 65K–500K pts/hr, 2-tier | FAIL |
| Rate limit headers | "May include" on exceed | Always present near limit; monitor proactively | FAIL |
| 429 Retry-After | "Exponential backoff if 429" | Exponential + jitter, max 30s, 4 retries, only if Retry-After present | PARTIAL |
| Pagination scheme | Cursor, Link header, default 25, max 100 | Correct | OK |
| Pagination stability | Not addressed | Cursor can skip items under concurrent writes | MISSING |
| Bulk endpoints | None claimed | None exist; correct | OK |
| Error response shape | Not characterized | Structured `{message, reason, data}` | MISSING |
| Concurrency limits | Not addressed | Burst limits + excessive parallelism triggers 429; no bypass | MISSING |
| Data Center limits | No rate limits | Correct | OK |

---

## Recommended Updates

1. Replace Section 8 entirely with the two-tier points-based model, explicit X-RateLimit header table, and proper 429 handling guidance.
2. Add cursor pagination stability caveat for reconciliation scenarios.
3. Add error response shape characterization (standard Atlassian format).
4. Add concurrency guidance: max 2-4 concurrent requests per tenant, spread load with jitter.
5. Replace the "200-500ms delay" guidance with dynamic pacing based on `X-RateLimit-Remaining`.