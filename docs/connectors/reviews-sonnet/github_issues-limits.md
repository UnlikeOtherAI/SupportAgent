# Rate Limits & Reliability Review — GitHub Issues Connector

> Reviewer: claude-sonnet-4-6 | Date: 2026-04-18
> Source doc: docs/connectors/github_issues.md

---

## Verdict

**Mostly accurate with three significant gaps and two minor inaccuracies.** The primary rate limit numbers are correct for PAT and unauthenticated access but the doc omits the GitHub Apps elevated limit entirely. Secondary rate limit detail is too vague to drive safe implementation. Retry guidance is present but underspecified. Pagination is correctly described. Error shape is accurate.

---

## Findings

### 1. GitHub Apps rate limit missing

**Area**: Rate limits — Section 8

**Claim in doc**: Table lists only "Authenticated (core API): 5,000/hour" and "Unauthenticated: 60/hour".

**Correct value**: GitHub Apps (installation tokens) receive **15,000 requests/hour** for the core API, not 5,000. Since the doc recommends GitHub App for multi-tenant deployments (Section 2), this omission is operationally significant. A multi-tenant implementation sized against 5,000/hr would be under-provisioned by 3x.

**Citation**: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#primary-rate-limit-for-github-app-installations

**Fix**: Add a row to the rate limit table:

| GitHub App installation token (core API) | 15,000/hour |

---

### 2. Secondary rate limits insufficiently specified

**Area**: Rate limits — Section 8, "Secondary Rate Limits"

**Claim in doc**: Lists three vague bullets — "Concurrent requests: Limit on simultaneous API calls", "POST request volume: Limits on number of creates/updates per minute", "Search rate limits: Stricter limits on /search/* endpoints".

**Correct behavior**: GitHub's documented secondary rate limit thresholds are:
- No more than **100 concurrent requests** at one time.
- No more than **900 points per minute** across REST endpoints (each request costs 1 point; some mutating requests cost more).
- No more than **90 seconds of CPU time per 60 seconds** of real time per token.
- POST/PATCH/PUT/DELETE requests: GitHub signals a secondary limit hit with **HTTP 403** and a JSON body containing `"message": "You have exceeded a secondary rate limit"` (not a 429).

The doc says "GitHub may return `Retry-After` header on 403 responses" — this is correct but incomplete. GitHub also returns `x-ratelimit-reset` and, in some cases, `retry-after` in lowercase. The 403 + secondary-limit message must be distinguished from a 403 for insufficient permissions, which will not contain that message string.

**Citation**: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#about-secondary-rate-limits

**Fix**: Add a subsection with the concrete thresholds and the 403-disambiguation logic.

---

### 3. Retry advice underspecified — risk of worsening rate limiting

**Area**: Mitigation Strategies — Section 8

**Claim in doc**: "Exponential backoff: Implement 1s base delay with jitter on 403/429".

**Issues**:
1. GitHub REST API does not return 429 for rate limit violations. Primary limits return **403** with `X-RateLimit-Remaining: 0`. Secondary limits also return **403**. A generic 403 retry handler must first inspect the body to determine whether to retry at all (secondary limit) or wait until `X-RateLimit-Reset` (primary limit). Retrying a 403 that is a permission error is pointless and wastes quota.
2. For primary rate limits the correct behavior is to **wait until the `X-RateLimit-Reset` epoch**, not apply arbitrary exponential backoff from a 1s base. The reset time is given exactly; backoff introduces unnecessary delay.
3. For secondary limits, `Retry-After` (when present) gives the wait time. When absent, GitHub recommends waiting at least 60 seconds before retrying a mutating request.

**Citation**: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#handle-rate-limit-errors-appropriately

**Fix**: Split retry logic into two cases:
- Primary limit (403 + `X-RateLimit-Remaining: 0`): sleep until `X-RateLimit-Reset`.
- Secondary limit (403 + message contains "secondary rate limit"): respect `Retry-After` if present, otherwise back off for at least 60 seconds with jitter before retrying.

---

### 4. HTTP 429 referenced but GitHub does not send it

**Area**: Mitigation Strategies — Section 8; also implied in retry guidance

**Claim in doc**: "Exponential backoff: Implement 1s base delay with jitter on **403/429**".

**Correct value**: GitHub's REST API does not send 429 for rate limiting. Only 403 is used for both primary and secondary rate limits. Listing 429 as a retry trigger is not harmful (it will never fire) but it misleads implementers and could mask a genuine 429 coming from an intermediate proxy or GHES load balancer.

**Citation**: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

**Fix**: Remove 429 from the retry condition list or add a clarifying note that 429 is not issued by GitHub itself but may appear from upstream proxies.

---

### 5. Pagination — "page-based not cursor-based" is partially misleading

**Area**: Pagination — Section 9, "Known Gotchas" item 5

**Claim in doc**: Section 9 correctly describes page-based pagination with Link headers for the REST API. However, item 5 in section 10 says "Timeline uses cursor-based pagination internally but exposes page-based API. Be aware of potential duplicates."

**Correct value**: The timeline endpoint (`GET /repos/{owner}/{repo}/issues/{issue_number}/timeline`) is paginated with the same Link-header page-based scheme as other REST endpoints. The "cursor-based internally" claim is unverifiable and the "potential duplicates" warning is technically applicable to any page-based API under concurrent writes — it is not specific to timeline. Under concurrent writes (new comments arriving while paginating), page-based pagination can skip or duplicate items because offset-based page numbers shift as rows are inserted. This risk applies equally to `GET /repos/{owner}/{repo}/issues` with `page=N` and is not called out there.

**Fix**: Remove the unsourced "cursor-based internally" claim. Add a general note under pagination that page-based offset pagination across all list endpoints is susceptible to missed or duplicated items when new events arrive during reconciliation; the `since` parameter on issues/comments endpoints mitigates this for incremental sync.

---

### 6. Conditional request / ETag caching understated

**Area**: Mitigation Strategies — Section 8

**Claim in doc**: "Conditional requests: Use `If-None-Match` / `ETag` headers for caching".

**Correct behavior**: This is accurate but the doc does not mention that GitHub's conditional requests **do not count against the rate limit** when the server returns 304 Not Modified. This is an important operational detail — for polling-heavy connectors, sending `If-None-Match` on every poll can keep the effective quota consumption near zero for unchanged resources.

**Citation**: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate

**Fix**: Add a note: "304 responses do not consume a rate limit point; always cache and send ETags on repeated GET requests to the same resource."

---

### 7. GraphQL rate limit model not documented

**Area**: Bulk/Batch Endpoints — Section 8

**Claim in doc**: "Batch via GraphQL: Single GraphQL query can replace multiple REST calls" — presented purely as a REST call-count optimization.

**Correct value**: The GraphQL API has its own rate limit model independent of the REST core limit. GitHub GraphQL is limited by a **point budget of 5,000 points per hour** (for PAT) or **15,000 points per hour** (for GitHub Apps). Each GraphQL request costs points based on the number of nodes requested. A query fetching 100 comments costs significantly more points than a simple field fetch. Using GraphQL for bulk fetches does reduce REST quota consumption but introduces GraphQL-specific quota concerns that must be tracked separately.

The doc's example query (`comments(first: 100)`) could consume a large fraction of the hourly GraphQL budget if called frequently across many issues.

**Citation**: https://docs.github.com/en/graphql/overview/resource-limitations

**Fix**: Add a subsection in Section 8 documenting the GraphQL point budget, the `x-ratelimit-*` headers on GraphQL responses, and the node-cost model. Recommend checking `rateLimit { cost remaining resetAt }` in every GraphQL query response.

---

### 8. Error response shape — 403 rate limit body not documented

**Area**: Appendix C

**Claim in doc**: Documents `{message, documentation_url, errors[], status}` shape for validation errors (422).

**Missing**: The rate limit 403 body shape is different and not shown:

```json
{
  "message": "API rate limit exceeded for ...",
  "documentation_url": "https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting"
}
```

And for secondary limits:
```json
{
  "message": "You have exceeded a secondary rate limit and have been temporarily blocked from content creation. Please retry your request again later.",
  "documentation_url": "https://docs.github.com/rest/overview/resources-in-the-rest-api#secondary-rate-limits"
}
```

These two must be distinguishable from a genuine 403 permission error to implement correct retry behavior (see Finding 3).

**Fix**: Add a rate-limit error subsection to Appendix C showing both body shapes and the distinguishing `message` strings.

---

## Summary Table

| # | Area | Severity | Action |
|---|------|----------|--------|
| 1 | GitHub Apps rate limit omitted | High | Add 15,000/hr row to table |
| 2 | Secondary rate limits vague | High | Add concrete thresholds and 403-disambiguation |
| 3 | Retry logic mixes primary/secondary cases | High | Split into two retry paths |
| 4 | 429 listed but GitHub does not send it | Medium | Remove or annotate |
| 5 | Timeline "cursor-based internally" unsourced | Low | Remove claim; generalize pagination risk note |
| 6 | ETag 304 does not consume quota — not mentioned | Medium | Add note |
| 7 | GraphQL point budget not documented | Medium | Add GraphQL rate limit subsection |
| 8 | Rate-limit 403 body shape missing from Appendix C | Medium | Add to error shape appendix |
