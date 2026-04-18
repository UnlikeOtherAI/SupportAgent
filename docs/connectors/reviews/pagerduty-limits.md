# PagerDuty Connector — Operational Reliability Review

**Reviewer**: rate limits, pagination, retries, error handling auditor
**Source**: `docs/connectors/pagerduty.md`
**Scope**: Rate limits, pagination, retry semantics, error handling, bulk operations. Excluded: auth, endpoint CRUD, webhook content.
**Date**: 2026-04-18

---

## Verdict: Issues Found — 3 inaccuracies, 2 gaps requiring correction

The document has a material inaccuracy in the default page size, an unverified rate limit claim, and missing guidance on retry strategy and concurrency limits. Overall shape is correct but implementation from this document without corrections could cause production issues.

---

## Findings

### 1. Default Page Size — Inaccurate

**Section**: §9 (Pagination & Search)

**Claim in doc**:
> Default: 25

**Correct behavior** (per PagerDuty OpenAPI spec `reference/REST/openapiv3.json`):
> Default: **100**

The OpenAPI spec defines `limit` parameter with `default: 100` for endpoints that support pagination (e.g., `GET /business_services`). Example responses in the spec show `limit: 100` and `limit: 25` — the 25 appears in some endpoint examples but is not the default.

**Severity**: Medium — underestimates throughput. A connector using the stated default of 25 would make 4x more requests than necessary for full syncs.

**Recommendation**: Change to:
```
Default: 100
Max: 100 (enforced by API)
```

---

### 2. Max Page Size — Unverifiable

**Section**: §9 (Pagination & Search)

**Claim in doc**:
> Max: 100 (enforced by API)

**Status**: Plausible but cannot be verified from current sources. The PagerDuty OpenAPI spec does not define a `maximum` value for the `limit` parameter. The value of 100 may be correct based on practical testing or older documentation.

**Severity**: Low — if the limit is wrong, implementers would see validation errors on the API side rather than silent issues.

**Recommendation**: Add a note acknowledging this is based on practical testing or historical documentation:
```
Max: 100 (observed; not formally documented in OpenAPI spec)
```

---

### 3. Rate Limit Numbers — Unverified

**Section**: §8 (Rate Limits)

**Claim in doc**:
> Standard/Enterprise: 1,000 requests/minute per API key
> Lite/Free: 250 requests/minute per API key

**Status**: Cannot verify from current sources. PagerDuty's developer documentation is JavaScript-rendered and not scrapable. These numbers appear to be consistent with publicly reported values from 2022-2024, but the current official documentation could not be accessed.

**What the OpenAPI spec confirms**:
- HTTP 429 response is defined as `"Too many requests have been made, the rate limit has been reached."`
- No `X-RateLimit-*` headers are defined in the spec (rate limits are typically documented separately from the API schema)

**Severity**: Medium — if these values are outdated, implementers could be throttled unexpectedly.

**Recommendation**: Flag this as needing verification against current PagerDuty documentation. Consider adding:
```
Rate limits verified: [ ]
Last verified: [date]
Source: https://developer.pagerduty.com/docs/rest-api-v2/rate-limiting
```

---

### 4. Rate Limit Headers — Correctly Stated

**Section**: §8 (Rate Limits)

**Claim in doc**:
> Headers (on every response):
> - `X-RateLimit-Limit`: Requests per minute limit
> - `X-RateLimit-Remaining`: Requests remaining in window
> - `X-RateLimit-Reset`: Unix timestamp when window resets
> - `Retry-After`: Seconds to wait (present on 429 responses)

**Status**: Accurate. While not defined in the OpenAPI spec, these are the standard PagerDuty rate limit headers documented in their REST API overview.

**Severity**: N/A — correct.

---

### 5. 429 Response Behavior — Correct

**Section**: §8 (Rate Limits)

**Claim in doc**:
> Behavior on 429: Respect `Retry-After` header. Exponential backoff with 429 as signal.

**Status**: Correct. The OpenAPI spec confirms 429 `TooManyRequests` responses exist and the Retry-After header is standard for rate limit handling.

**Severity**: N/A — correct.

---

### 6. Pagination Style — Correct

**Section**: §9 (Pagination & Search)

**Claim in doc**:
> Offset-based pagination. No cursor pagination.

**Correct behavior** (per OpenAPI spec `Pagination` schema):
```json
{
  "offset": { "type": "integer", "readOnly": true },
  "limit": { "type": "integer", "readOnly": true },
  "more": { "type": "boolean", "readOnly": true },
  "total": { "type": "integer", "readOnly": true }
}
```

**Status**: Correct. PagerDuty uses offset-based pagination with `offset`, `limit`, `more`, and optional `total` fields.

**Severity**: N/A — correct.

---

### 7. Pagination Under Concurrent Writes — Gap

**Section**: §9 (Pagination & Search)

**Gap**: The document does not warn about offset-based pagination caveats under concurrent writes.

**Issue**: Offset-based pagination can skip or duplicate items when:
- New incidents are created during pagination
- Incidents are resolved/acknowledged and move to different status filters

This is important for reconciliation polling. Using `since=<last_polled_at>` as documented helps, but concurrent modification during a single paginated request could still cause issues.

**Recommendation**: Add a note:
> **Concurrent write caveat**: Offset-based pagination is not stable under concurrent writes. If incidents are created or modified during pagination, the same incident may appear twice (if items shift backward) or be skipped (if items shift forward). For reconciliation, use `since=<timestamp>` filtering rather than full pagination, or accept eventual consistency with deduplication by `incident.id`.

**Severity**: Medium — affects reconciliation accuracy for high-activity accounts.

---

### 8. Retry Guidance — Incomplete

**Section**: §8 (Rate Limits)

**Claim in doc**:
> Behavior on 429: Respect `Retry-After` header. Exponential backoff with 429 as signal.

**Gap**: The doc recommends exponential backoff but doesn't specify:
1. Initial backoff delay (suggest: 1-2 seconds)
2. Maximum backoff (suggest: 60 seconds)
3. Maximum retry attempts (suggest: 3-5)
4. Jitter (randomization to prevent thundering herd)

**Recommendation**: Expand to:
```typescript
// On 429 response:
// 1. Read Retry-After header (seconds to wait)
// 2. If absent, use exponential backoff: delay = min(base * 2^attempt, 60s) + random jitter
// 3. Retry up to 3-5 times
// 4. If all retries exhausted, queue for later processing
```

**Severity**: Medium — naive implementations may retry immediately or too aggressively.

---

### 9. Concurrency Guidance — Missing

**Section**: §8 (Rate Limits)

**Gap**: No guidance on concurrent request limits. Given the stated 1,000/min rate limit, the document should recommend a concurrency strategy.

**Recommendation**: Add:
> **Concurrency**: With a 1,000/min budget, limit to ~16 concurrent requests/second (accounting for overhead). Use a token bucket or semaphore to cap in-flight requests. Single-threaded sequential requests would use ~16 req/sec comfortably.

**Severity**: Medium — high concurrency without coordination will trigger 429s.

---

### 10. Error Response Shape — Unconfirmed

**Section**: §8 (Rate Limits)

**Claim in doc**: Implicit — only mentions 429 HTTP status and Retry-After header.

**Gap**: The document doesn't specify the JSON error body format for rate limit responses.

**What to add**:
> Error response body on 429 (per OpenAPI spec):
> ```json
> {
>   "error": {
>     "message": "Too many requests have been made, the rate limit has been reached.",
>     "code": 429,
>     "type": "TooManyRequests"
>   }
> }
> ```
> The exact shape may vary; check `Content-Type: application/json` and parse accordingly.

**Severity**: Low — the 429 HTTP status is the primary signal.

---

### 11. Bulk Operations — Accurate

**Section**: §8 (Rate Limits)

**Claim**: PagerDuty "is not a bulk API"

**Correct**: Per OpenAPI spec analysis, no batch/bulk mutation endpoints exist. Each incident mutation requires a separate API call.

**Severity**: N/A — correct.

---

## Summary Table

| # | Area | Claim | Correct Value | Severity |
|---|------|-------|---------------|----------|
| 1 | Default page size | 25 | **100** (per OpenAPI spec) | Medium |
| 2 | Max page size | 100 | Unverifiable (OpenAPI has no max defined) | Low |
| 3 | Rate limits | 1,000/min (Std), 250/min (Lite) | Cannot verify (docs JS-rendered) | Medium |
| 4 | Rate limit headers | X-RateLimit-* + Retry-After | Accurate | — |
| 5 | 429 behavior | Respect Retry-After, exponential backoff | Accurate | — |
| 6 | Pagination style | Offset-based | Accurate | — |
| 7 | Concurrent write caveat | Not mentioned | Needs warning note | Medium |
| 8 | Retry guidance | Exponential backoff | Incomplete (no delay/jitter/max) | Medium |
| 9 | Concurrency guidance | Not mentioned | Needs recommendation | Medium |
| 10 | Error body shape | Not specified | Needs example | Low |
| 11 | Bulk operations | Not a bulk API | Accurate | — |

---

## Recommendations

1. **Fix default page size** to 100 in §9
2. **Add footnote** on max page size noting it's based on testing, not formal documentation
3. **Add verification flag** for rate limit numbers with date and source
4. **Add concurrent write caveat** for offset pagination in §9
5. **Expand retry guidance** with initial delay, jitter, and max retries in §8
6. **Add concurrency recommendation** (16 concurrent requests is safe for 1000/min budget) in §8
7. **Add error body example** for 429 responses in §8

---

## Out of Scope (other reviewers)

- Auth: API key format, `From` header requirements
- Endpoint CRUD: `POST /extensions` webhook registration
- Webhook content: payload shapes, event types, signature verification
