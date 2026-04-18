# Rate Limits & Operational Reliability Review — GitHub Connector

**Source**: `docs/connectors/github.md`
**Reviewer focus**: rate limits, pagination, retries, error handling, bulk operations

---

## Verdict

The document is broadly accurate but contains several material errors and omissions in the rate-limit section that would lead to incorrect quota assumptions and missing secondary-limit handling. Pagination is described partially incorrectly. One retry statement is misleading. Details below.

---

## Findings

### 1. GitHub App installation token rate limit — wrong number

**Area**: Section 8, Default Limits table

**Claim in doc**:
> GitHub App installation token — 5,000 (base) + 0.5× installs bonus

**Correct value**:
GitHub Apps get **15,000 requests/hour** per installation token when the app is installed on an organization, and **5,000/hour** when installed on a personal account. The "0.5× installs bonus" formula does not exist in current GitHub documentation. The actual formula for org-owned installations is a flat 15,000 req/hr, not a sliding bonus.

**Citation**: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#primary-rate-limit-for-github-app-installations

**Action required**: Replace the row with:

| Auth Level | Requests/Hour |
|---|---|
| GitHub App (personal account install) | 5,000 |
| GitHub App (org account install) | 15,000 |

---

### 2. Secondary rate limits not documented

**Area**: Section 8 — entirely absent

**Claim in doc**: No mention of secondary rate limits.

**Correct value**:
GitHub enforces secondary rate limits independent of the primary hourly quota. These limits trigger a **429 Too Many Requests** (not 403) with a `Retry-After` header:

- No more than **100 concurrent requests** to the REST API at a time.
- No more than **900 points per minute** for REST (mutation-heavy routes cost more).
- No more than **90 seconds of CPU time per 60-second window**.
- No more than **10 concurrent GraphQL mutations**.

Secondary limits return HTTP 429 with `Retry-After: <seconds>`. The doc's retry section only documents the primary-limit 403 path.

**Citation**: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#about-secondary-rate-limits

**Action required**: Add a "Secondary Rate Limits" subsection in Section 8. The retry logic must handle 429 in addition to 403.

---

### 3. Rate-limit 403 vs 429 — misleading statement

**Area**: Section 8, Retry Semantics

**Claim in doc**:
> GitHub returns `403 Forbidden` with `Retry-After: <seconds>` header when rate limited.

**Correct value**:
- **Primary rate limit exhausted** (`X-RateLimit-Remaining === 0`): GitHub returns **403** with no `Retry-After`; the reset time is in `X-RateLimit-Reset` (Unix timestamp).
- **Secondary rate limit hit**: GitHub returns **429** with a `Retry-After: <seconds>` header.

The doc conflates the two. The `Retry-After` header is only present on **429**, not on **403** primary exhaustion. The connector must branch on status code:

- `403` + `X-RateLimit-Remaining: 0` → sleep until `X-RateLimit-Reset`
- `429` → sleep for `Retry-After` seconds

**Citation**: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit

**Action required**: Split the retry semantics into two cases.

---

### 4. Search API rate limit — wrong unit

**Area**: Section 8, Default Limits table; Section 9, Search API

**Claim in doc** (Section 8 table):
> Search API — 30 (authenticated)

**Claim in doc** (Section 9 body):
> Rate limited: 30 requests/minute for authenticated search.

**Correct value**:
The Search API limit is **30 requests/minute** — not per hour. The table header says "Requests/Hour" but the search row means requests/minute. The table is therefore internally inconsistent; either the header should note the different unit for search, or a separate note is needed. Section 9 correctly says /minute; the table misleadingly implies /hour.

**Action required**: Annotate the table row to clarify the unit is per-minute, not per-hour, to avoid a 60× misestimate.

---

### 5. `X-RateLimit-Resource` header values not enumerated

**Area**: Section 8, Rate Limit Headers

**Claim in doc**:
> X-RateLimit-Resource: core

**Correct value**:
GitHub exposes multiple resource buckets, each with its own quota:

| Resource | Notes |
|---|---|
| `core` | All REST endpoints except search and GraphQL |
| `search` | Search API (30 req/min) |
| `graphql` | GraphQL (5,000 points/hr; 15,000 for org GitHub App) |
| `integration_manifest` | GitHub App manifest creation |
| `code_scanning_upload` | Code scanning |

The connector should check `X-RateLimit-Resource` when deciding which budget is exhausted. Treating all resources as `core` will cause the connector to block GraphQL or search calls unnecessarily.

**Citation**: https://docs.github.com/en/rest/rate-limit/rate-limit#get-rate-limit-status-for-the-authenticated-user

---

### 6. Pagination style is partially incorrect

**Area**: Section 9, Pagination Style

**Claim in doc**:
> GitHub uses **page number pagination** (not cursor-based) for most endpoints.

**Correct value**:
This is an oversimplification. GitHub uses both styles:

- **REST list endpoints**: Link-header-based pagination (RFC 5988). The `Link` header provides `rel="next"` and `rel="last"` URLs, which may contain either `page=N&per_page=100` or opaque cursor parameters depending on the endpoint. Iterating by incrementing `page` manually is fragile and will skip items if new items are inserted between pages (classic pagination hazard under concurrent writes).
- **GraphQL**: Cursor-based (`edges`/`pageInfo`/`endCursor`/`hasNextPage`) — not mentioned anywhere in the pagination section despite GraphQL being listed as a supported API variant.

The correct approach is to follow `rel="next"` from the `Link` header verbatim, not to compute page numbers manually. The doc's example shows `page=2&per_page=100` as if the caller increments `page`, which is the fragile pattern.

**Citation**: https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api

**Action required**:
- Restate that pagination is Link-header-driven, not page-number arithmetic.
- Add a note that page-number iteration skips items under concurrent writes (relevant for reconciliation).
- Add a GraphQL cursor pagination subsection.

---

### 7. `per_page` max of 1,000 for search is overstated

**Area**: Section 9, Pagination Style

**Claim in doc**:
> `per_page` max: 100 (most endpoints), 1000 (search)

**Correct value**:
The Search API caps `per_page` at **100**, not 1,000. The Search API additionally caps total results at **1,000 items** regardless of pagination (i.e., you cannot retrieve more than 1,000 search hits via pagination even if the `total_count` is higher). The "1000" figure likely conflates the total result cap with the per-page max.

**Citation**: https://docs.github.com/en/rest/search/search#about-search

**Action required**: Correct to `per_page` max 100 for search. Add a note that results are capped at 1,000 total.

---

### 8. Retry advice does not specify backoff strategy

**Area**: Section 8, Retry Semantics; Section 12, Dependencies

**Claim in doc**:
> @octokit/rest: built-in throttling plugin. Set `throttle: { onRateLimit, onAbuseLimit }` in constructor options.

**Correct value**:
The advice is correct as far as it goes, but the doc gives no guidance on what the `onRateLimit` / `onAbuseLimit` callbacks should do. A common mistake is to call `retryRequest: true` unconditionally, which will retry immediately after a 403 primary exhaustion and hammer the API for the entire reset window. The callbacks must:

- On primary exhaustion: wait until `retryAfter` (seconds until reset, provided by the plugin).
- On secondary limit (abuse): wait the `Retry-After` value; apply exponential backoff with jitter if the plugin retries multiple times.

Without this guidance, an implementer might write an immediate-retry handler that worsens rate limiting.

**Action required**: Add a minimal callback example showing sleep-until-reset for primary and backoff for secondary.

---

### 9. No bulk mutation endpoints — correctly documented, but missing GraphQL batching note

**Area**: Section 8, Bulk/Batch Endpoints

**Claim in doc**:
> No batch mutation endpoint — each POST/PATCH is one operation.

**Correct value**:
This is accurate for REST. However, **GraphQL does support request batching** (multiple queries/mutations in a single HTTP request via the `queries` array). This is particularly relevant for Projects v2 operations (Phase 3). The absence of this note is not a bug for MVP but is a gap given that GraphQL is listed as an active API variant.

**Action required** (low priority): Add a note under bulk/batch that GraphQL supports batched queries, and that the graphql budget (5,000 pts/hr) applies to the aggregate.

---

### 10. Error response shape — incomplete

**Area**: No dedicated section; Section 8 mentions 403/429 but no error body shape.

**Correct value**:
GitHub REST errors return JSON with `{ "message": "...", "documentation_url": "...", "errors": [...] }`. The `errors` array is present on 422 Unprocessable Entity (validation failures) and contains per-field error objects. The doc does not document this shape at all.

For operational reliability, the connector should:
- Parse `message` from all 4xx responses for logging.
- Parse `errors[]` on 422 to surface validation failures (e.g., label not found, assignee not a collaborator).
- Never swallow a 4xx silently.

**Citation**: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#handle-errors-and-unexpected-responses

**Action required**: Add a short "Error Response Shape" subsection in Section 8.

---

### 11. Polling cursor hazard under concurrent writes — not flagged

**Area**: Section 9, Incremental Sync

**Claim in doc**:
> For polling, use `GET /repos/{owner}/{repo}/issues?since=<ISO8601>&per_page=100` — returns issues updated since the given timestamp. Store `updated_at` of last processed item.

**Correct value**:
The `since` cursor strategy has a known hazard: if two items share the same `updated_at` timestamp and only the first was processed before the cursor advanced, the second is silently skipped. This is more likely under high-write conditions or when a bulk operation (e.g., a label update script) touches many issues simultaneously.

Mitigation: on each poll, fetch `since=<last_updated_at - 1s>` to overlap by one second, then deduplicate by issue `id` against the previously seen set. The doc should call this out.

**Action required**: Add a note about the overlap-by-1s deduplication pattern.

---

### 12. Concurrency recommendation absent

**Area**: Section 8

**Claim in doc**: No concurrency guidance.

**Correct value**:
Given the secondary rate limit of 100 concurrent REST requests and the 900 points/minute mutation budget, a reasonable implementation limit is:

- Max **10 concurrent REST requests** (well within 100 concurrent cap, leaves headroom for other processes).
- Serialize mutations per-issue (avoid sending multiple PATCH/POST for the same issue concurrently).
- Do not fan out bulk syncs across all repos simultaneously; process repos sequentially or in small batches of 3–5.

**Action required**: Add a "Concurrency Guidance" note in Section 8.

---

## Summary of Required Changes

| Priority | Finding | Section |
|---|---|---|
| High | GitHub App rate limit is 15,000/hr for org installs, not "5,000 + 0.5× bonus" | §8 table |
| High | Secondary rate limits (429) entirely absent | §8 |
| High | 403 vs 429 retry semantics conflated | §8 |
| High | Search rate limit unit is per-minute, not per-hour — table is misleading | §8 table, §9 |
| High | `per_page` max for search is 100 (not 1,000); total results capped at 1,000 | §9 |
| Medium | Link-header pagination vs page arithmetic — prefer following `rel="next"` | §9 |
| Medium | GraphQL cursor pagination not documented | §9 |
| Medium | Error response shape `{message, documentation_url, errors[]}` not documented | §8 |
| Medium | `onRateLimit`/`onAbuseLimit` callback guidance absent — risk of immediate retry | §8, §12 |
| Medium | Polling cursor overlap hazard not flagged | §9 |
| Low | `X-RateLimit-Resource` buckets not enumerated | §8 |
| Low | GraphQL batching not mentioned in bulk/batch section | §8 |
| Low | Concurrency guidance absent | §8 |
