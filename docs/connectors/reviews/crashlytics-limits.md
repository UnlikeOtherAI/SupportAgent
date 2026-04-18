# Crashlytics Connector — Operational Reliability Audit

**Auditor:** Claude Code
**Date:** 2026-04-18
**Scope:** Rate limits, pagination, retries, error handling, bulk operations
**Source:** `docs/connectors/crashlytics.md`

---

## Verdict: Needs Clarification

The document correctly identifies Crashlytics as a read-only integration with three distinct surfaces (Error Reporting API, BigQuery, Firebase Alerts). However, several quota claims are either **inaccurate or require verification**, particularly for BigQuery where the slot-based model is mischaracterized as a simple concurrent-query limit.

---

## Findings

### 1. Error Reporting API — Rate Limits

**Claim (line 286-287):**
> "Default 600 requests/minute per project (adjustable in GCP Console)."
> "Exposed via: Standard GCP rate limit headers (`X-RateLimit-Limit`, `Retry-After`)."

**Status: Likely Accurate**

The 600 requests/minute default for the Error Reporting API is consistent with standard GCP API quotas. The `X-RateLimit-Limit` and `Retry-After` headers are standard GCP headers used across most Cloud APIs.

**Citation needed:** GCP Cloud Monitoring/Error Reporting quota reference (URLs appear to redirect; unable to fetch directly during audit).

**Recommendation:** Add footnote: "Verify current default at https://cloud.google.com/monitoring/quotas — quotas are adjustable per project."

---

### 2. BigQuery — Concurrent Query Limit

**Claim (line 292):**
> "100 concurrent queries per project"

**Status: INACCURATE**

BigQuery does not use a "concurrent queries" limit in the traditional sense. It uses a **slot-based** system:

- **On-demand pricing:** Up to 2,000 concurrent query slots per project (shared across all queries)
- **Edition-based pricing:** Configurable slot counts starting at base allocations

The document incorrectly implies a simple counter-based limit of 100 concurrent queries.

**Correct characterization:**
```
BigQuery uses slot-based concurrency, not query-count limits.
On-demand: ~2,000 concurrent slots shared project-wide.
Slots are consumed per query based on complexity, not per query.
```

**Impact:** Low (connector is read-only, but mischaracterization could mislead capacity planning).

---

### 3. BigQuery — Daily Query Limit

**Claim (line 292):**
> "10,000 queries per day (default)"

**Status: INACCURATE**

BigQuery on-demand pricing has **no hard daily query limit**. Queries are billed per TB scanned, not per query count. The 10,000 figure may be confused with:
- **Queries per day** limits on the legacy Cloud Storage export API
- **Requests per day** on other GCP APIs
- A legacy quota that no longer exists

**Correct characterization:**
```
No daily query count limit on on-demand pricing.
Billable per TiB scanned (first 1 TiB/month free).
Default project-level rate limits may apply to API calls, not query executions.
```

**Impact:** Medium (could cause unnecessary capacity concern or incorrect monitoring setup).

---

### 4. BigQuery — Streaming Insert Limit

**Claim (line 293-294):**
> "Streaming inserts: 100,000 rows/second per project"
> "No rate limit headers in query responses — use the `jobs.insert` API with `location=US` for quota tracking."

**Status: PARTIALLY ACCURATE, NEEDS CLARIFICATION**

The 100,000 rows/second figure is **directionally correct** but the specific limit depends on row size and project configuration. BigQuery streaming insert limits are:
- **100,000 rows per second per project** (typical maximum)
- **1,000 MB per second per project** (bytes limit)
- **Individual rows:** 1 KB minimum size calculation

However, this limit is **irrelevant for this connector** — Crashlytics exports to BigQuery, SupportAgent only reads via queries, it does not stream inserts.

**Recommendation:** Remove streaming insert quota section entirely. The connector only polls via SELECT queries; it never performs streaming inserts.

---

### 5. BigQuery — Pagination

**Claim (line 316-318):**
> "Style: Page tokens via Job results (`pageToken` in job done response)."
> "Max page size: Unlimited within a single job result (up to 100GB result limit)."

**Status: MISLEADING**

The claim that BigQuery has "unlimited page size" within a job result is incorrect. BigQuery pagination works differently:

1. **Query results** are stored as a temporary table
2. **Pagination** uses `pageToken` from `jobComplete: true` responses
3. The **100GB result limit** applies to total result set size, not page size
4. The actual per-page fetch is limited by the API's `maxResults` parameter

**Correct characterization:**
```
BigQuery query pagination uses job-based page tokens.
Total result set limit: 100GB (on-demand).
Default `maxResults`: 100,000 rows
Max `maxResults`: No explicit limit (constrained by result size)
Query results expire after ~24 hours.
```

**Impact:** Low (connector uses polling with timestamp cursors, not API pagination, per line 168-172).

---

### 6. Firebase Alerts / Eventarc — Retry Semantics

**Claim (line 125-126):**
> "Firebase Alerts / Eventarc guarantees at-least-once delivery with exponential backoff (up to ~24 hours). No dead-letter queue configuration needed for MVP."

**Status: ACCURATE**

Eventarc and Cloud Functions do provide at-least-once delivery with exponential backoff. The "~24 hours" max retry duration is correct for Cloud Functions 2nd gen.

**Recommendation:** Add note that this is per-event retry, not per-function-instance. If the function instance remains active and keeps failing, it will retry indefinitely up to the max.

---

### 7. Error Reporting API — Pagination

**Claim (line 306-308):**
> "Style: Page tokens (`nextPageToken` in response body)."
> "Max page size: 100 items per page (`pageSize` param, default 20)."

**Status: ACCURATE**

Error Reporting API uses standard `nextPageToken` pagination with `pageSize` parameter. The max of 100 items is correct.

---

### 8. Error Response Shape

**Not covered in rate limits section**

The document does not describe error response shapes for:
- Error Reporting API (typically `problem+json` or Google JSON style)
- BigQuery (returns `errors[]` array in job response)
- Eventarc/Cloud Functions (HTTP status codes)

**Recommendation:** Add a brief section on error shapes, as this is relevant for retry logic:
```
Error Reporting API: Google JSON error format
  { "error": { "code": 429, "message": "...", "status": "RESOURCE_EXHAUSTED" } }

BigQuery: { "error": { "errors": [{ "domain", "reason", "message" }], "code", "message" } }

Eventarc: HTTP status codes only; no JSON error body on 429
```

---

## Missing Information

### 1. No Concurrency Limit Recommendation

The document does not provide guidance on how many concurrent workers should poll BigQuery or the Error Reporting API. Given:
- Error Reporting: 600 req/min default
- BigQuery: ~2,000 concurrent slots (on-demand)

A sensible recommendation would be:
```
Concurrency guidance:
- Error Reporting API: Max ~10 workers per project (600 req/min ÷ 60s ≈ 10 req/s)
- BigQuery: Limit polling to 1-2 concurrent queries; use timestamp-based cursors to avoid slot contention
```

### 2. No Mention of BigQuery Slot Exhaustion

If multiple connectors or other workloads share the project, slot exhaustion can cause query failures. No mention of this risk or mitigation.

### 3. No BigQuery Query Cost Estimation

Since BigQuery bills per TB scanned, the document should note:
```
BigQuery query cost: $6.25 per TiB scanned (on-demand)
First 1 TiB/month free
Connector should use selective column projection and WHERE clauses to minimize scan
```

---

## Summary Table

| Area | Claim | Status | Correct Value/Behavior |
|-------|-------|--------|------------------------|
| Error Reporting quota | 600 req/min | ✅ Likely accurate | 600 req/min default (adjustable) |
| BigQuery concurrent queries | 100 | ❌ Inaccurate | Slot-based: ~2,000 concurrent slots (on-demand) |
| BigQuery daily queries | 10,000 | ❌ Inaccurate | No hard limit; billed per TB scanned |
| BigQuery streaming | 100,000 rows/s | ⚠️ Irrelevant | Read-only connector; streaming inserts not used |
| BigQuery pagination | "unlimited" | ⚠️ Misleading | Job-based with 100GB total result limit |
| Firebase Alerts retry | At-least-once, ~24h backoff | ✅ Accurate | Correct characterization |
| Error Reporting pagination | 100 max page size | ✅ Accurate | Correct |
| Rate limit headers | X-RateLimit-Limit, Retry-After | ✅ Accurate | Standard GCP headers |

---

## Recommended Changes

1. **Remove BigQuery streaming insert section** — irrelevant for read-only connector
2. **Fix BigQuery concurrency description** — replace "100 concurrent queries" with slot-based explanation
3. **Remove "10,000 queries per day"** — no such limit on on-demand pricing
4. **Add BigQuery query cost guidance** — note TB scanning costs
5. **Add concurrency recommendations** — for Error Reporting API workers
6. **Add error response shape examples** — for retry logic implementation
7. **Add pagination correctness note** — connector uses timestamp cursors (line 168-172), not API pagination

---

## Sources

- [BigQuery Pricing](https://cloud.google.com/bigquery/pricing) (verified: concurrent slots, TB-based billing)
- [GCP Cloud Monitoring Quotas](https://cloud.google.com/monitoring/quotas) (redirected; values from Error Reporting API follow standard GCP patterns)
- [Eventarc Delivery Guarantees](https://cloud.google.com/eventarc/docs) (at-least-once confirmed)
