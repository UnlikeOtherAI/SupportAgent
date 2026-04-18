# GitLab Connector — Rate Limits, Pagination, Retry, Error Handling Review

**Reviewer scope:** operational reliability — rate limits, pagination, retries, error handling, bulk operations.
**Source doc:** `docs/connectors/gitlab.md`
**Verdict:** Mostly accurate with a few corrections needed. One significant inaccuracy on GraphQL complexity limits, one omission on keyset pagination link headers, and two minor clarifications on retry backoff and error response shape.

---

## Findings

### 1. GraphQL Complexity Limit — INCORRECT

**Area:** Section 8.7 (Bulk / Batch Endpoints)

**Claim in doc:**
> Query complexity limit: 200 (unauthenticated), 250 (authenticated).

**Correct value:**
GitLab's GraphQL API complexity limits are significantly higher than stated. As of GitLab 16+, the documented limits are:
- Unauthenticated: **200 complexity points**
- Authenticated (PAT / OAuth): **200 complexity points** (same as unauthenticated for standard requests)
- The practical per-field complexity scoring means most queries are well under 200 unless they deeply nest large collections.

However, the stated "250 authenticated" figure is not confirmed in current GitLab documentation. The official docs state complexity is calculated per-query and authenticated users receive the same limit as unauthenticated. The rate limit for GraphQL requests is governed by the same `throttle_authenticated_api` bucket (2,000 req/min) as REST — there is no separate GraphQL req/min rate limit bucket.

**Citation:** https://docs.gitlab.com/ee/api/graphql/index.html#limits

**Action required:** Remove or correct the 200/250 split claim. State that complexity calculation applies per-query; authenticated and unauthenticated share the same complexity cap. The more actionable constraint for this connector is request throughput (2,000 req/min shared bucket), not per-query complexity.

---

### 2. Authenticated API Rate Limit — ACCURATE WITH IMPORTANT NUANCE

**Area:** Section 8.1 (GitLab.com Limits)

**Claim in doc:**
> Authenticated API requests: **2,000 req/min**

**Assessment:** This is correct for GitLab.com as of current documentation. The limit applies per authenticated user (per token), not per IP.

**Nuance not mentioned:** GitLab.com rate limits scale with the GitLab tier for paid namespaces. Ultimate namespaces can have elevated limits. The doc correctly notes self-managed instances can configure their own ceilings (section 10.2), but does not mention the tier-based scaling on GitLab.com itself. This is relevant if SupportAgent targets enterprise GitLab.com customers who may have higher limits.

**Citation:** https://docs.gitlab.com/ee/user/gitlab_com/index.html#gitlabcom-specific-rate-limits

**Action:** Add a note that GitLab.com rate limits may be higher for Ultimate tier namespaces; do not hard-code 2,000/min as an absolute ceiling in connector logic.

---

### 3. Notes Rate Limit — ACCURATE, CRITICAL CALL-OUT PRESENT

**Area:** Section 8.5 (Gotcha: Notes Rate Limit is Very Low)

**Claim in doc:**
> **60 notes/min** is the per-user limit.

**Assessment:** This figure matches the documented GitLab.com limit for the notes creation endpoint. The doc correctly flags this as a critical bottleneck for multi-tenant deployments. The recommendation to use one PAT per tenant is sound.

**Additional concern not flagged:** The 60/min limit is for the notes creation endpoint specifically. There is no documented bulk notes endpoint — each comment post is one API call. This means at scale (e.g., 60+ active issues being processed simultaneously from one token), the connector will hit this limit immediately. The doc mentions this implicitly but does not recommend a queue-depth limit or token-bucket implementation at the connector layer. Worth adding an explicit implementation note.

---

### 4. Retry-After Semantics — PARTIALLY CORRECT, MISSING BACKOFF DETAIL

**Area:** Section 8.2 (Rate Limit Headers) and Section 12.1 (SDK note on retry)

**Claim in doc (section 8.2):**
> `Retry-After`: Seconds to wait (only on 429)

**Claim in doc (section 12.1):**
> Rate limit header reading and automatic retry with `Retry-After`

**Assessment:** The `Retry-After` header is present on 429 responses. The doc correctly notes this. However:

1. The doc does not explicitly state that the connector implementation should use exponential backoff in addition to `Retry-After`. If `Retry-After` is absent (which happens for Projects/Groups/Users APIs — see section 8.3), the doc does not specify what backoff strategy to use. An immediate retry without backoff on 429 is the failure mode the template specifically warns about.

2. Section 8.3 notes that Projects, Groups, and Users endpoints do not return rate limit headers. The connector must implement a fallback backoff strategy (exponential with jitter, minimum 1s initial delay) for these endpoints. This fallback is not described anywhere in the doc.

**Action required:** Add a subsection or implementation note specifying:
- Honor `Retry-After` when present on 429.
- When `Retry-After` is absent (Projects/Groups/Users APIs), use exponential backoff with jitter: initial delay 1s, multiplier 2, max 60s.
- Never retry immediately on 429.

---

### 5. Pagination — Link Header Presence Not Confirmed for All Endpoints

**Area:** Section 9.1 (Pagination Styles)

**Claim in doc:**
> Offset (default): `page`, `per_page`
> Keyset (recommended): `pagination=keyset`, `order_by`, `sort`

**Assessment:** The doc describes the two pagination modes but does not confirm that GitLab returns `Link` headers with `rel="next"` / `rel="prev"` / `rel="first"` / `rel="last"` for offset pagination. GitLab does return these headers. This matters because the prompt template asks to verify the pagination scheme matches reality for link-header platforms.

**GitLab's actual behavior:**
- Offset pagination: returns `Link` header with `rel="first"`, `rel="last"`, `rel="next"`, `rel="prev"` (where applicable), plus `X-Page`, `X-Per-Page`, `X-Total`, `X-Total-Pages` headers.
- `X-Total` and `X-Total-Pages` are omitted when result set exceeds 10,000 records (correctly noted in section 9.4).
- Keyset pagination: returns `Link` header with `rel="next"` only (no `rel="last"`, no total counts). This is a meaningful behavioral difference.

**Action:** Add a note that offset pagination includes `Link` headers and `X-Total*` headers (suppressed beyond 10,000 records), while keyset pagination only includes `Link: rel="next"` — implementors must treat absence of `rel="next"` as end-of-results rather than checking a total count.

---

### 6. Max Page Size — ACCURATE

**Area:** Section 9.2

**Claim in doc:**
> 100 records per page (enforced). Default is 20.

**Assessment:** Correct. GitLab enforces a hard maximum of 100 for `per_page`. Some endpoints (container registry, package registry) may have different maximums, but for issues, MRs, and notes, 100 is correct.

---

### 7. Error Response Shape — INCOMPLETE

**Area:** Section 8.2 mentions 429 response body only; error shapes not systematically covered.

**Claim in doc:**
> 429 response body: Plain text `Retry later`

**Assessment:** Correct for 429. However the doc does not characterize GitLab's general REST error response shape, which the review template requires.

**Actual GitLab error response shape:**
- Most 4xx/5xx errors return JSON: `{"message": "...", "error": "..."}` or just `{"message": "..."}`
- Validation errors return: `{"message": {"field_name": ["error message"]}}`  (field-keyed hash under `message`)
- 404 returns: `{"message": "404 Not Found"}`
- 403 returns: `{"message": "403 Forbidden"}` or `{"error": "insufficient_scope", "error_description": "..."}`
- Rate limit 429 returns: plain text `Retry later` (not JSON — confirmed correct in doc)
- GitLab does NOT use `problem+json` (`application/problem+json`) for errors
- GitLab does NOT use the GitHub `{message, documentation_url}` shape

**Action:** Add a subsection on error response shapes. The connector error handler must check `Content-Type` before attempting JSON parse on 4xx responses, because 429 is plain text while other errors are JSON.

---

### 8. Bulk / Batch Operations — NO MISSING ENDPOINTS, ONE CLARIFICATION

**Area:** Section 8.7 (Bulk / Batch Endpoints)

**Assessment:** GitLab does not expose bulk REST endpoints for issue or note creation in the way GitHub does not either. The doc's recommendations (GraphQL multiplexing for Phase 3, `per_page=100` for reads) are correct and complete.

The `statistics=true` and `simple=true` hints are accurate. `simple=true` on `/projects` returns a lightweight project list (id, name, path, web_url only) — useful for project enumeration.

**No missing bulk endpoints to flag.**

---

### 9. Concurrency Recommendation — NOT STATED, SHOULD BE DERIVED

**Area:** Section 8 overall

**The doc does not provide an explicit concurrency recommendation.** Given the constraints:
- 2,000 req/min total authenticated API budget
- 60 notes/min for comment creation
- No parallel-write protection at the GitLab level

**Derived recommendation (should be added to doc):**
- For read operations: up to 10 concurrent requests per tenant token is safe within the 2,000 req/min budget.
- For note/comment writes: serialize all note creation requests per tenant token; maintain a per-token token bucket with a ceiling of 55 notes/min (5 req margin).
- Never share a PAT across tenants if comment throughput is required — the 60/min limit is per token, not per tenant.

---

### 10. Webhook Idempotency Key — ACCURATE WITH CORRECT UNCERTAINTY FLAG

**Area:** Section 10.10

**Claim in doc:**
> GitLab sends an `Idempotency-Key` header but the value format and semantics are not clearly documented.

**Assessment:** This is an accurate characterization of the current state of GitLab webhook documentation. The `Idempotency-Key` on webhook deliveries is not the same as an HTTP `Idempotency-Key` for outbound requests. The recommendation to use it alongside `updated_at` for deduplication is sensible.

---

### 11. Webhook Pagination Under Concurrent Writes — NOT ADDRESSED

**Area:** Section 3.4 (Polling Fallback)

**The doc does not flag the risk of missing items under concurrent writes when using offset pagination for polling fallback.**

When polling with `updated_after` + offset pagination, if issues are updated during iteration (between page 1 and page 2 fetch), the offset shifts and items can be skipped. This is a well-known issue with offset-based cursor polling.

**Mitigation (should be documented):**
- Always sort by `updated_at ASC` when polling with a cursor.
- Record the `updated_at` of the last item on each page, not the page number.
- On the next poll cycle, set `updated_after` to the recorded `updated_at` minus a short overlap window (e.g., 5 seconds) to catch in-flight updates.
- When using keyset pagination for polling, this problem is mitigated but not eliminated.

---

## Summary Table

| Area | Status | Severity |
|---|---|---|
| Authenticated API rate limit (2,000/min) | Correct | — |
| Notes rate limit (60/min) | Correct | — |
| GraphQL complexity limits (200/250 split) | Incorrect | Medium |
| Retry-After + fallback backoff strategy | Incomplete | High |
| Link header / pagination header behavior | Incomplete | Medium |
| Error response shape characterization | Incomplete | Medium |
| Concurrency recommendation | Missing | Medium |
| Keyset pagination end-of-results detection | Missing | Medium |
| Offset polling under concurrent writes | Missing | Medium |
| GitLab.com tier-based rate limit scaling | Missing | Low |
| Bulk endpoints coverage | Accurate | — |
| 429 plain-text body | Accurate | — |
| Rate limit header names (`RateLimit-*`) | Accurate | — |
| Missing headers for Projects/Groups/Users | Accurate | — |
| Max page size (100) | Accurate | — |
