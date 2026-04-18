# Asana Connector — Operational Reliability Review

**Reviewer:** Rate Limits, Pagination, Bulk Operations, Error Handling
**Source:** `docs/connectors/asana.md`
**Date:** 2026-04-18

---

## Verdict: Needs Correction

The document has several material inaccuracies and significant omissions in the operational-reliability section. Most critically: the claimed burst limit is fabricated, the document misses the Retry-After header, omits concurrent request limits entirely, and leaves the Search API's independent rate limit unmentioned.

---

## Findings

### Finding 1 — Rate Limit Numbers (Major)

**Section:** 8.1

**Doc claims:**
> Global (per token) ~1,500 requests/minute
> Burst: Up to 2,000 requests/minute for short periods

**Correct values (from Asana developer docs):**

| Tier | Limit |
|------|-------|
| Free domains | 150 req/min |
| Paid domains | 1,500 req/min |
| Search API (separate) | 60 req/min |
| GET concurrent | 50 max |
| POST/PUT/PATCH/DELETE concurrent | 15 max |

**Issues:**
1. The "~1,500" is correct only for **paid** domains. Free domains are limited to **150 req/min**. The doc does not distinguish tiers.
2. The "2,000 req/min burst" claim is **not present in Asana's official documentation**. Asana's public rate limit page (developers.asana.com/docs/rate-limits) specifies 1,500 req/min for paid, 150 for free, and concurrent ceilings — no burst ceiling is documented. This claim appears to be invented and should be removed.
3. The **concurrent request limits** (50 for GET, 15 for mutating) are missing entirely. These are operationally significant: a client can hit the concurrent ceiling even while well under the per-minute budget. Without respecting these limits, a batch or parallel-fetcher client will get 429s from concurrent overload, not from budget exhaustion.

**Fix:** Replace the two-row table in 8.1 with the full tier table above, add concurrent limits, and remove the burst claim.

---

### Finding 2 — Rate Limit Header Visibility (Medium)

**Section:** 8.2

**Doc claims:**
> Asana does NOT return explicit rate limit headers. If you exceed limits: Response: 429 Too Many Requests

**Correct behavior:**

Asana **does** return a `Retry-After` header on 429 responses, specifying the wait time in seconds. This is documented on the Asana rate limits page: "Rate limit information is surfaced via: HTTP status 429 Too Many Requests, Retry-After header specifying wait time in seconds."

**Issue:** The "no headers" claim is incorrect. Clients should read and obey the `Retry-After` header. Calling this "no headers" may cause integrators to implement naive polling-based backoff (sleeping N seconds blindly) instead of respecting the server's own directive.

**Fix:** Update 8.2 to state that Asana returns `Retry-After` with 429 responses, and that clients should honor it. The recommendation for exponential backoff is sound, but the backoff should be capped at the Retry-After value where present.

---

### Finding 3 — Missing Search API Rate Limit (Medium)

**Section:** 8.1 / 9.3

**Doc claims:** No mention of a separate Search API limit.

**Correct behavior:**

The Search API (`/workspaces/<gid>/tasks/search`) is subject to a **separate 60 requests/minute** limit, independent of the global 1,500 req/min budget.

**Issue:** A reconciliation loop hitting the search endpoint repeatedly will exhaust the 60/min search budget long before hitting the 1,500/min general budget. This is a common integration mistake — search is treated like a normal endpoint, but it has its own ceiling. The doc mentions the search endpoint in section 9.3 but never calls out the independent rate constraint.

**Fix:** Add a note in 9.3 and in 8.1 that Search API has its own 60 req/min limit.

---

### Finding 4 — Missing Concurrent Request Limits (Medium)

**Section:** 8.1 / 8.3

**Doc claims:** No mention of concurrent request limits.

**Correct behavior (from Asana rate limits docs):**
- GET requests: max 50 concurrent
- POST/PUT/PATCH/DELETE: max 15 concurrent

**Issues:**
1. These limits are separate from the per-minute budget. A client making 51 simultaneous GET requests will get 429s even if the total request count is under 1,500/min.
2. The batch endpoint is particularly affected: if batch is used for parallel execution of sub-requests, the concurrent counter still applies per-batch-request. A client sending 10 batch requests simultaneously is at risk of hitting the concurrent ceiling.

**Fix:** Add concurrent limits to the rate limits table. Section 8.3 (Bulk/Batch) should note that each batch request still counts toward the concurrent ceiling and that the 15-concurrent mutating limit constrains how many simultaneous batch requests a client can have in flight.

---

### Finding 5 — Pagination Scheme Correct

**Section:** 8.4 / 9.1 / 9.2

**Doc claims:** Offset-based pagination, `limit` 1-100 (default 20), `next_page.offset` token, offset expires on data change.

**Verification:** Confirmed correct against Asana pagination docs.

**Minor note:** The doc correctly warns that "offset tokens expire when underlying data changes." This is accurate and important for reconciliation loops.

**No change required.**

---

### Finding 6 — Bulk/Batch Endpoint (Low — Unverified)

**Section:** 8.3

**Doc claims:**
> Accepts up to 10 actions per request

**Verification:** Could not confirm against current Asana documentation (the batch reference page returned 404 at time of review). The batch endpoint URL and JSON-RPC-style request structure appear in the doc but could not be cross-referenced.

**Issue:** If the 10-action limit is wrong, clients could submit oversized batches and get silent failures or truncation.

**Fix:** Confirm against a live Asana API response or the current reference docs. The JSON-RPC structure shown (`{ "method": "...", "relative_path": "..." }`) appears non-standard for Asana's REST API; Asana's batch endpoint is a POST to `/batch` with a `data.actions` array, but the exact schema and action limit should be verified from the official reference.

---

### Finding 7 — Error Response Shape (Low — Missing)

**Section:** 8 / 10

**Doc claims:** No description of error response shape.

**Correct error format (from Asana error docs):**

```json
{
  "errors": [
    {
      "message": "Not Authorized"
    }
  ]
}
```

For 500 errors, a `phrase` field is included for support correlation.

**Issue:** Integrators need to know the error body shape to implement proper error dispatch. A 403 "Not Authorized" and a 404 "Not Found" look identical in shape — only the `message` differs. The doc does not document this, leaving implementers to discover it by hitting real errors.

**Fix:** Add an error handling section to 8 describing the `{ "errors": [{ "message": "..." }] }` shape, the status codes in use, and that 429 responses include a `Retry-After` header.

---

### Finding 8 — Concurrency Recommendation Missing

**Section:** 8

**Doc claims:** No recommendation on concurrent request limits.

**Issue:** Given that Asana enforces 50 concurrent GET / 15 concurrent mutating limits separately from the per-minute budget, a naive client that parallelizes aggressively will hit 429s from concurrent overload before exhausting the per-minute budget. There is no guidance on how to stay within these limits.

**Fix:** Add a recommendation: limit GET concurrency to ~40 (headroom under the 50 ceiling) and mutating concurrency to ~10 (headroom under the 15 ceiling). If using the batch endpoint, each batch request counts as one concurrent request; limit parallel batch requests to the same ceilings.

---

## Summary Table

| Area | Doc Claim | Correct Value | Status |
|------|-----------|---------------|--------|
| Rate limit (paid) | ~1,500/min | 1,500/min | OK (paid only) |
| Rate limit (free) | Not mentioned | 150/min | Missing |
| Burst limit | 2,000/min | **Not documented** | Fabricated, remove |
| Search API limit | Not mentioned | 60/min separate | Missing |
| Concurrent GET limit | Not mentioned | 50 | Missing |
| Concurrent mutating limit | Not mentioned | 15 | Missing |
| Rate limit headers | None | Retry-After header | Incorrect |
| Pagination scheme | Offset-based | Offset-based | Correct |
| Max page size | 100 | 100 | Correct |
| Offset token expiry | "expire on data change" | Confirmed | Correct |
| Batch action limit | 10 | Unverified | Flag for confirmation |
| Error body shape | Not documented | `{errors: [{message}]}` | Missing |

---

## Sources

- [Asana Rate Limits](https://developers.asana.com/docs/rate-limits)
- [Asana Pagination](https://developers.asana.com/docs/pagination)
- [Asana Error Handling](https://developers.asana.com/docs/errors)
- [Asana Batch Requests (unverified)](https://developers.asana.com/reference/batch)
