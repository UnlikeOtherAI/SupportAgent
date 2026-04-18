# GitHub Issues Connector — Operational Reliability Audit

**Auditor:** Claude Code
**Date:** 2026-04-18
**Scope:** Rate limits, pagination, retries, error handling, bulk operations
**Source:** `docs/connectors/github_issues.md`

---

## Verdict: Needs Corrections (2 accuracy issues, 1 missing clarification)

The document is mostly accurate on the primary rate limit numbers and pagination scheme. Two areas require corrections: the secondary rate limit section is vague and missing critical specific values, and the retry guidance is too simplistic. One silent gap in polling design is flagged.

---

## Findings

### 1. Primary Rate Limits — ACCURATE ✅

**Claim (lines 628-632):**
```
Authenticated (core API): 5,000/hour
Authenticated (Search API): 30/min
Unauthenticated: 60/hour
```

**Status: ACCURATE**

Verified against [GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api):
- Unauthenticated: 60/hr ✅
- Authenticated (PAT): 5,000/hr ✅
- GitHub Apps / OAuth apps: 15,000/hr ✅ (not mentioned but accurate)
- Search API: 30/min ✅

---

### 2. GitHub App Rate Limit — NOT MENTIONED ⚠️

**Gap**: The document only mentions "5,000/hour authenticated" in the primary rate limit table. It does not separately note that **GitHub Apps get 15,000/hr**, which is critical for multi-tenant connectors.

**Correct value**: 15,000 requests/hour for GitHub Apps authenticated via installation tokens. This is 3x the PAT limit and the primary reason to recommend GitHub App over PAT for multi-repo connectors.

**Recommendation**: Add a row to the rate limit table:
```
| GitHub App (installation token) | 15,000/hour |
```

---

### 3. Secondary Rate Limits — VAGUE, MISSING KEY VALUES ❌

**Claim (lines 646-651):**
```
GitHub enforces additional limits:
- Concurrent requests: Limit on simultaneous API calls
- POST request volume: Limits on number of creates/updates per minute
- Search rate limits: Stricter limits on `/search/*` endpoints
```

**Status: INCOMPLETE AND TOO VAGUE**

GitHub's secondary rate limits are well-documented and include specific values:

| Secondary limit | Actual value | Doc claim |
|---|---|---|
| Concurrent requests (REST + GraphQL combined) | 100 max | "Limit on simultaneous API calls" (no number) |
| REST API points per minute | 900 points/min | "Limits on POST per minute" (no number) |
| GraphQL API points per minute | 2,000 points/min | Not mentioned |
| Point value: GET/HEAD/OPTIONS | 1 point | Not mentioned |
| Point value: POST/PATCH/PUT/DELETE | 5 points | Not mentioned |
| Content creation (POST/PATCH) | 80 requests/min, 500/hour | Not mentioned |
| OAuth token requests | 2,000/hour | Not mentioned |

**Concrete correction** — replace lines 646-651 with:
```
### Secondary Rate Limits

GitHub enforces additional limits that are enforced independently of the primary hourly limit:

| Limit | Value | Notes |
|---|---|---|
| Concurrent requests | 100 (REST + GraphQL combined) | Enforced in real-time, not per-window |
| REST API | 900 points/min | GET/HEAD/OPTIONS = 1pt; POST/PATCH/PUT/DELETE = 5pt |
| GraphQL API | 2,000 points/min | Reads = 1pt; mutations = 5pt |
| Content creation | 80 requests/min, 500/hour | Applies to POST/PATCH on issues, comments, labels |
| OAuth token exchange | 2,000/hour | Applies to GitHub App JWT → token exchange |

**Impact**: A connector doing 100 concurrent requests (even simple reads) can hit the concurrent limit before the 5,000/hr primary limit. Similarly, bulk label assignments on 100 issues = 100 POSTs = 500 points in ~2 minutes.

**Detection**: Secondary limits return HTTP 403 with `Retry-After` header (or at minimum 1 minute wait). Primary limits return 429.
```

---

### 4. Rate Limit Headers — ACCURATE ✅

**Claim (lines 634-641):**
```
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4999
X-RateLimit-Reset: 1672531200
X-RateLimit-Used: 1
X-RateLimit-Resource: core
```

**Status: ACCURATE**

GitHub returns these headers on all authenticated requests. `X-RateLimit-Resource: core` confirms which limit pool is being tracked. The example values (5,000 limit) match the authenticated PAT limit.

---

### 5. Retry-After on 403 — PARTIALLY CORRECT ⚠️

**Claim (line 644):**
> "Retry-After: GitHub may return `Retry-After` header on 403 responses when secondary limits hit"

**Status: PARTIALLY CORRECT — the guidance is incomplete**

GitHub does return `Retry-After` on secondary limit 403s. However:

1. **Primary rate limit (429)**: Use `X-RateLimit-Reset` header (Unix epoch seconds), not `Retry-After`. GitHub does not send `Retry-After` on primary limit 429s.

2. **Secondary rate limit (403)**: `Retry-After` header is sent, but if absent, "wait for at least one minute before retrying" (not the 1s base recommended in line 658).

**Concrete correction** — lines 656-658:
```
1. **Conditional requests**: Use `If-None-Match` / `ETag` headers for caching
2. **Batch via GraphQL**: Single GraphQL query can replace multiple REST calls
3. **Search API separate limit**: Track separately from core API
4. **Exponential backoff**: Implement correct retry behavior:
   - Primary limit (HTTP 429): Wait until `X-RateLimit-Reset` epoch time
   - Secondary limit (HTTP 403): Respect `Retry-After` header if present; if absent, wait minimum 60s before retry
   - Base delay: 2s with jitter (0.7–1.3 multiplier), double on each retry, max 4 attempts
```

---

### 6. Pagination — ACCURATE ✅

**Claim (lines 689-705):**
- Style: Page-based (`per_page` + `page`)
- Max page size: 100
- Default: 30
- Link header with `rel="next"`, `rel="prev"`, `rel="first"`, `rel="last"`

**Status: ACCURATE**

All verified against [GitHub REST API pagination](https://docs.github.com/en/rest/guides/using-pagination-in-the-rest-api):
- `per_page` max is 100 ✅
- Default is 30 ✅
- Link header format with `rel="next"` is the standard iteration pattern ✅
- Page numbers start at 1 ✅

---

### 7. Search API Pagination — ACCURATE ✅

**Claim (lines 713-742):**
- Search endpoint: `GET /search/issues`
- Search rate limit: 30 requests/minute (authenticated)
- Pagination: page-based with `per_page` (max 100)

**Status: ACCURATE**

Search API has its own limit pool:
- 30/min authenticated (independent from the 5,000/hr core limit)
- Uses same Link header pagination as REST API ✅
- `per_page` max 100 ✅

---

### 8. Bulk/Batch Endpoints — PARTIALLY COVERED ⚠️

**Claim (lines 660-683):**
The document mentions GraphQL for batching but does not discuss whether GitHub has any REST bulk endpoints that are relevant.

**Status: PARTIALLY ACCURATE**

GraphQL (`POST /graphql`) is correctly identified as a batch mechanism. The example query (lines 667-683) correctly fetches issue + labels + comments + assignees in one query.

**Missing note**: GitHub does not have REST bulk endpoints for multi-issue create/update. Each operation must be done per-issue. This is a genuine limitation — the document correctly implies this by not listing any bulk REST endpoints, but a brief statement would be helpful:

> **No REST bulk endpoints**: GitHub REST API does not support bulk issue creation, bulk update, or batch assignment. Each operation is per-resource. Use GraphQL for fetching multiple related resources in one request, but mutations remain per-item.

---

### 9. Error Response Shape — ACCURATE ✅

**Claim (Appendix C, lines 1110-1133):**
```json
{
  "message": "Validation Failed",
  "documentation_url": "https://docs.github.com/...",
  "errors": [{ "resource", "field", "code", "message" }],
  "status": "422"
}
```

**Status: ACCURATE**

GitHub's error response shape is correctly characterized:
- `message` field ✅
- `documentation_url` with link to relevant docs ✅
- `errors` array with per-field detail ✅
- `status` code as string (e.g., "422") ✅

Common error codes listed (401, 403, 404, 410, 422, 503) are accurate.

---

### 10. Concurrency Limits — NO ACTUAL NUMBER ❌

**Claim (lines 648-649):**
> "Concurrent requests: Limit on simultaneous API calls"

**Status: INCOMPLETE**

The document correctly identifies that there IS a concurrent request limit but never specifies the value. The actual limit is **100 concurrent requests** (REST + GraphQL combined). Without a specific number, implementers cannot set sensible concurrency limits.

**Concrete correction**: Change "Limit on simultaneous API calls" to "100 concurrent requests (REST + GraphQL combined)".

---

### 11. Polling + Concurrent Writes — SILENT GAP ⚠️

**Claim (lines 146-165):**
The polling section describes page-based pagination with `since` timestamp filtering.

**Status: ACCURATE BUT INCOMPLETE**

Page-based pagination with `since` filter is the correct fallback for webhook gaps. However, there is a silent risk during reconciliation:

- If an issue is **created while iterating pages**, the new issue may appear in a later page (not yet reached) but also not pass the `since` filter (already created before our cursor). This causes item skip.

- GitHub's `updated_at` changes on edits, but creation time is fixed. A newly created issue with `created_at < since` would be missed if it doesn't appear on the already-fetched pages.

**Recommendation**: Add a gotcha under polling:
```
**Reconciliation gap risk**: When using `since=<timestamp>` pagination under concurrent writes, newly created issues may be missed if:
1. The issue is created before `since` timestamp (e.g., created by another process between sync runs)
2. The issue appears in a page already visited during iteration

Mitigation: Use the Events API (`/issues/{number}/timeline`) or compare against a full repo listing for delta reconciliation, not just `since`-based polling.
```

---

### 12. Timeline API Pagination — CORRECTLY FLAGGED ✅

**Claim (line 788):**
> "Pagination on timeline: Timeline uses cursor-based pagination internally but exposes page-based API. Be aware of potential duplicates."

**Status: ACCURATE**

The GitHub Timeline API is documented to use page-based pagination internally while returning different data than the issues list. The duplicate warning is appropriate.

---

## Summary Table

| Area | Claim | Status | Correct Value/Behavior |
|---|---|---|---|
| Primary rate limit (PAT) | 5,000/hr | ✅ Accurate | Correct |
| Primary rate limit (GitHub App) | Not mentioned | ⚠️ Missing | 15,000/hr for GitHub App installation tokens |
| Search API rate limit | 30/min | ✅ Accurate | Correct |
| Unauthenticated limit | 60/hr | ✅ Accurate | Correct |
| Rate limit headers | X-RateLimit-* | ✅ Accurate | All headers correctly shown |
| Retry-After on 403 | "may return" | ⚠️ Incomplete | Secondary limits always return Retry-After; primary uses X-RateLimit-Reset |
| Retry advice | 1s base + jitter | ⚠️ Needs update | 2s base; 60s minimum for secondary limits; primary uses reset time |
| Pagination style | Page-based | ✅ Accurate | Correct |
| Max page size | 100 | ✅ Accurate | Correct |
| Default page size | 30 | ✅ Accurate | Correct |
| Link header format | rel="next", etc. | ✅ Accurate | Correct |
| Search pagination | Page-based max 100 | ✅ Accurate | Correct |
| Secondary limit (concurrent) | "Limit" (no number) | ❌ Incomplete | 100 concurrent (REST + GraphQL combined) |
| Secondary limit (REST points) | Not mentioned | ❌ Missing | 900 points/min; GET=1pt, POST/PATCH/PUT/DELETE=5pt |
| Secondary limit (GraphQL points) | Not mentioned | ❌ Missing | 2,000 points/min |
| Secondary limit (content creation) | "POST per minute" | ❌ Missing | 80 requests/min, 500 requests/hour |
| Bulk/batch endpoints | GraphQL only | ✅ Partially | No REST bulk endpoints for issue CRUD; GraphQL is correct batch mechanism |
| Error response shape | message + docs + errors + status | ✅ Accurate | Correct |
| Timeline pagination gotcha | Duplicates possible | ✅ Accurate | Correct |
| Polling reconciliation | `since` timestamp | ⚠️ Silent gap | Needs note about concurrent-create gap risk |

---

## Recommended Changes

1. **Add GitHub App rate limit** (15,000/hr) to the rate limit table
2. **Expand secondary rate limits section** — replace vague descriptions with specific numbers (100 concurrent, 900 REST pts/min, 80 content ops/min, etc.)
3. **Fix retry guidance** — distinguish primary (429 → use reset time) vs secondary (403 → use Retry-After or 60s min); update base delay to 2s
4. **Add concurrency recommendation** — "max 10 concurrent workers to stay under 100 concurrent limit"
5. **Add no-REST-bulk note** — GitHub REST has no bulk create/update; GraphQL only
6. **Add polling reconciliation gotcha** — concurrent writes can cause item skip; mitigation suggestion

---

## Sources

- [GitHub REST API Rate Limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) (verified 2026-04-18)
- [GitHub REST API Pagination](https://docs.github.com/en/rest/guides/using-pagination-in-the-rest-api) (verified 2026-04-18)
- [GitLab.com API Rate Limits](https://docs.gitlab.com/ee/user/gitlab_com/index.html) (reference only, not primary connector)