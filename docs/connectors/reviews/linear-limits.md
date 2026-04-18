# Linear Connector — Operational-Reliability Review

**Reviewer**: Operational-reliability (rate limits, pagination, error handling)
**Source**: `docs/connectors/linear.md`
**Date**: 2026-04-18
**Verdict**: ❌ Significant issues — rate limit numbers are wrong, header info is incomplete, error handling guidance is wrong.

---

## Findings

### Finding 1 — Rate Limit Numbers: Wrong

**Area affected**: Section 8 (Rate Limits), lines 436–441

**Claim in doc**:
> **Global limit**: ~600 requests/minute per workspace

**Correct value / behavior**:

From [Linear Developer Documentation](https://linear.app/developers/rate-limiting):

| Token type | Requests | Complexity |
|---|---|---|
| API key / OAuth | **5,000/hour** | **3,000,000 points/hour** |
| OAuth app | **5,000/hour** | **2,000,000 points/hour** |
| Unauthenticated | 600/hour | 100,000 points/hour |

**The doc claims ~600 requests/minute** — that is ~36,000/hour, which is **7× the actual limit**. The correct per-hour figure for authenticated requests is 5,000/hour.

The ~600/min figure does not appear in any official Linear documentation. This appears to be a conflation or fabrication. Retaining it would cause the connector to under-backoff by a large margin.

---

### Finding 2 — Complexity Budget: Missing Entirely

**Area affected**: Section 8 (Rate Limits)

**Claim in doc**: No mention of complexity-based limiting.

**Correct value / behavior**:

Linear enforces **two parallel budgets**:

1. **Request count** — 5,000/hour for API keys (see Finding 1)
2. **Complexity points** — 3,000,000/hour for API keys; max 10,000 points per single query

Complexity formula (from Linear docs): `each property = 0.1pt`, `each object = 1pt`, connections multiply children's points based on pagination (default 50). Score rounds up.

A typical issues query with 10 fields and 50 results costs ~15 points. At 3M points/hour, that allows ~200,000 such queries — far more than the 5,000-request ceiling. However, complex queries (e.g., fetching deeply nested relationships, large page sizes) can hit the **per-query cap of 10,000** independently.

The doc also claims "No bulk endpoints — all writes are single-record mutations" — this is confirmed. Linear has no batch create/update mutations (see [GitHub issue #210](https://github.com/linear/linear/issues/210), closed Dec 2025).

---

### Finding 3 — Rate-Limit Headers: Incomplete

**Area affected**: Section 8, line 438

**Claim in doc**:
> **Rate-limit headers**: Not standard GraphQL headers; Linear uses a `X-RateLimit-*` header set

**Correct value / behavior**:

From the SDK's `RatelimitedLinearError` class (which parses these from every response):

```
X-RateLimit-Requests-Limit       # max requests in window
X-RateLimit-Requests-Remaining   # requests left in window
X-RateLimit-Requests-Reset       # Unix timestamp when window resets
X-RateLimit-Complexity-Limit     # max complexity in window
X-RateLimit-Complexity-Remaining # complexity points left
X-RateLimit-Complexity-Reset     # Unix timestamp when complexity window resets
```

The doc mentions "a `X-RateLimit-*` header set" but does not enumerate which ones. The SDK exposes **both** a request bucket and a separate complexity bucket. Implementations should track both — the request bucket is the harder ceiling (5,000/hour), but complex queries can hit the per-query 10,000-point ceiling even with requests to spare.

---

### Finding 4 — Error HTTP Status: Wrong

**Area affected**: Section 8, line 440

**Claim in doc**:
> `LinearGraphQLError` with `type: "Ratelimited"`

**Correct value / behavior**:

According to the SDK error parsing logic and Linear docs:

- Rate limited errors return **HTTP 400** (not 429) with `"code": "RATELIMITED"` in the response body's error `extensions`.
- HTTP 429 is handled as `Ratelimited` but may be used for different conditions (the SDK maps HTTP 429 → Ratelimited but the primary signal is the extensions code).
- HTTP 403 is mapped to `Forbidden`, not `Ratelimited`.

The current code sample in the doc relies on `error.type === LinearErrorType.Ratelimited` which is correct, but the surrounding text implies HTTP 429 is the only signal. The SDK's `parseLinearError` checks both HTTP status and GraphQL error extensions to classify errors.

---

### Finding 5 — Retry-After: Wrong Semantics

**Area affected**: Section 8, line 440

**Claim in doc**:
> **Retry-After**: Not explicitly documented; Linear's SDK returns a `LinearGraphQLError` with a `userPresentableMessage`; implement exponential backoff

**Correct value / behavior**:

From `RatelimitedLinearError` in the SDK, the error class exposes:

```
error.retryAfter   # seconds to wait (from Retry-After header)
error.requestsResetAt  # Unix timestamp for request bucket reset
error.complexityResetAt  # Unix timestamp for complexity bucket reset
```

`retryAfter` is populated from the `retry-after` HTTP header. The header is documented and available — it is **not** undocumented.

**Retry strategy should be**: read `retryAfter` from `RatelimitedLinearError`, wait that duration, then retry. Only fall back to exponential backoff if `retryAfter` is absent.

The doc's recommendation to "implement exponential backoff" is not wrong, but it misses that Linear provides an explicit `retryAfter` value that should be used first. Using a fixed exponential backoff (e.g., starting at 1s) without checking `retryAfter` could cause unnecessary delays or premature retries.

---

### Finding 6 — Pagination Max Page Size: Correct

**Area affected**: Section 9, line 473

**Claim in doc**:
> **Max page size**: Default 50; max 250 via `first: 250`

**Correct value / behavior**: ✅ Confirmed. This matches the Relay Connections spec and the documented default/max.

---

### Finding 7 — No Bulk Endpoints: Confirmed

**Area affected**: Section 8, line 454

**Claim in doc**:
> **No bulk endpoints** — all writes are single-record mutations

**Correct value / behavior**: ✅ Confirmed. Linear has no batch mutation support ([GitHub issue #210](https://github.com/linear/linear/issues/210)). Each `issueCreate`, `commentCreate`, etc. is a separate request.

This is a genuine constraint. The connector should not imply bulk operations exist.

---

### Finding 8 — Error Response Shape: Partially Correct

**Area affected**: Section 8

**Claim in doc**: SDK error types described correctly.

**Correct value / behavior**: Partially accurate. The `LinearErrorType.Ratelimited` and `LinearGraphQLError` types are correctly named. However, the doc omits `LinearErrorType.UsageLimitExceeded` which is a separate error type for when the complexity budget is exhausted.

`UsageLimitExceededLinearError` is distinct from `RatelimitedLinearError`. Both require different handling:
- `Ratelimited` → wait and retry (use `retryAfter`)
- `UsageLimitExceeded` → query complexity must be reduced; retrying immediately won't help

---

### Finding 9 — Concurrency Recommendation: Missing

**Area affected**: Section 8 (no recommendation exists)

**Claim in doc**: N/A

**Correct value / behavior**: No concurrency guidance is given. With 5,000 requests/hour, the ceiling is ~1.4 requests/second sustained. For safety with complexity budgets and burst handling:

- **Recommended**: max **1 concurrent in-flight request** per workspace token for write operations
- **Read operations**: up to **3 concurrent** may be safe during initial sync, but track `X-RateLimit-Requests-Remaining` to stay under 5,000/hour
- **Complexity-intensive queries** (large `first`, nested connections): treat these as higher cost and avoid parallelizing them

The doc's open question 6 asks "What retry strategy should the worker use on `Ratelimited` errors?" — this is answerable from the documented `retryAfter` field.

---

## Summary

| # | Area | Severity | Status |
|---|---|---|---|
| 1 | Rate limit numbers (600/min) | High | ❌ Wrong — should be 5,000/hour |
| 2 | Complexity budget | High | ❌ Missing entirely — critical for large queries |
| 3 | Rate limit headers | Medium | ⚠️ Incomplete — only mentions X-RateLimit-*, doesn't enumerate |
| 4 | HTTP status for 429 vs 400 | Low | ⚠️ Slightly misleading — 400 with code in extensions is primary signal |
| 5 | Retry-After semantics | Medium | ⚠️ Says "not documented" — it is documented and available via SDK |
| 6 | Max page size (250) | None | ✅ Correct |
| 7 | No bulk endpoints | None | ✅ Correct |
| 8 | Error response shapes | Medium | ⚠️ Omits `UsageLimitExceeded` error type |
| 9 | Concurrency guidance | Low | ❌ Missing — no recommendation given |

---

## Recommended Corrections

1. **Replace "600 requests/minute"** with **"5,000 requests/hour"** (API key) and add the complexity budget (3,000,000 points/hour for API key, max 10,000 per query).

2. **Add the six rate limit headers** to the doc (X-RateLimit-Requests-Limit, -Remaining, -Reset; X-RateLimit-Complexity-Limit, -Remaining, -Reset).

3. **Fix Retry-After guidance**: read `error.retryAfter` from `RatelimitedLinearError` first; fall back to exponential backoff only if absent.

4. **Add `UsageLimitExceededLinearError`** to the error handling section as a distinct case from `RatelimitedLinearError`.

5. **Add concurrency recommendation**: 1 concurrent writer, up to 3 concurrent readers per workspace token; track remaining budget via headers.

6. **Resolve open question 6**: answer is "use `error.retryAfter` (seconds) from `RatelimitedLinearError`; cap max delay at 60s."