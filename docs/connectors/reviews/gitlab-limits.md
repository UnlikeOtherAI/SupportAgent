# GitLab Connector — Operational Reliability Review

**Reviewer:** operational-reliability (rate limits, pagination, retries, error handling)
**Source document:** `docs/connectors/gitlab.md`
**Reviewed against:** [GitLab.com rate limits](https://docs.gitlab.com/ee/user/gitlab_com/index.html), [Rate limits (security)](https://docs.gitlab.com/ee/security/rate_limits.html), [REST pagination](https://docs.gitlab.com/ee/api/rest/pagination.html), [GraphQL API](https://docs.gitlab.com/ee/api/graphql/index.html), [Webhooks](https://docs.gitlab.com/ee/user/project/integrations/webhooks.html)

**Scope:** rate limit numbers, header semantics, retry-After behavior, pagination correctness, bulk endpoints, error shapes, concurrency recommendations. Auth, endpoint CRUD, and webhook content are out of scope.

---

## Verdict: **Conditions Met, Minor Corrections Needed**

The document is broadly accurate and well-structured. Rate limit numbers match current official values. Pagination coverage is correct. Two factual errors and several undocumented limits warrant fixes.

---

## Findings

### 1. Rate Limit Numbers — All Verified Accurate

| Claim in doc | Verified value | Status |
|---|---|---|
| Authenticated API: 2,000 req/min | 2,000 requests each minute | ✓ |
| Non-API HTTP: 1,000 req/min | 1,000 requests each minute | ✓ |
| IP aggregate: 2,000 req/min | 2,000 requests each minute | ✓ |
| Issue creation: 200 req/min | 200 requests each minute | ✓ |
| Notes on issues/MRs: 60 req/min | 60 requests each minute | ✓ |
| Pipeline creation: 25 req/min | 25 requests each minute | ✓ |
| Project Jobs API: 600 req/min/user | 600 calls per authenticated user | ✓ |
| Groups list: 200 req/min | 200 requests each minute | ✓ |
| Search API: 10 req/min per IP | 10 requests each minute | ✓ |
| Package registry: 3,000 req/min per IP | 3,000 requests each minute | ✓ |
| Alert integration: 3,600 req/hour per project | 3,600 requests every hour | ✓ |
| Protected paths: 10 req/min per IP | 10 requests each minute | ✓ |

**Source:** [GitLab.com rate limits](https://docs.gitlab.com/ee/user/gitlab_com/index.html)

---

### 2. Missing Rate Limits — Several Endpoint-Specific Limits Omitted

The document omits several endpoint-specific limits that are documented in official sources.

**Missing from doc:**

| Endpoint / Scope | Limit | Source |
|---|---|---|
| Unauthenticated raw endpoint traffic | 800 req/min per IP | GitLab.com rate limits |
| Repository files API | 500 req/min | GitLab.com rate limits |
| Single project requests (`/projects/:id`) | 400 req/min | GitLab.com rate limits |
| Groups list — pagination note | >10,000 records skips total headers | [REST pagination](https://docs.gitlab.com/ee/api/rest/pagination.html) |
| Runner jobs via runner token (`/api/v4/jobs/request`) | 2,000 req/min | GitLab.com rate limits |
| Runner job trace patch (`/api/v4/jobs/trace`) | 200 req/min | GitLab.com rate limits |
| `/api/v4/users/:id` endpoint | 300 req/10 min per user | GitLab.com rate limits |
| User status (`/api/v4/users/:user_id/status`) | 240 req/min | GitLab.com rate limits |
| User followers/following | 100 req/min each | GitLab.com rate limits |
| User GPG keys, SSH keys | 120 req/min each | GitLab.com rate limits |
| User projects (`/api/v4/users/:id/projects`) | 300 req/min | GitLab.com rate limits |
| User contributed/starred projects | 100 req/min each | GitLab.com rate limits |
| Project members list | 200 req/min | GitLab.com rate limits |

**Severity:** Low. Most are non-critical endpoints not used by the MVP scope. However, missing the `/api/v4/users/:id` limit (300 per 10 minutes) could affect user resolution during identity mapping if the connector processes many users from a single token.

---

### 3. Rate Limit Headers — Correct

| Claim in doc | Verified | Source |
|---|---|---|
| Header prefix is `RateLimit-*`, not `XRateLimit-*` | ✓ Correct | [Rate limits (security)](https://docs.gitlab.com/ee/security/rate_limits.html) |
| Projects/Groups/Users APIs silently return 429 without headers | ✓ Correct | [GitLab.com rate limits](https://docs.gitlab.com/ee/user/gitlab_com/index.html) |
| `Retry-After` present on 429 | ✓ Correct | [GitLab.com rate limits](https://docs.gitlab.com/ee/user/gitlab_com/index.html) |
| 429 response body is plain text `Retry later` | ✓ Correct | [GitLab.com rate limits](https://docs.gitlab.com/ee/user/gitlab_com/index.html) |

No changes needed.

---

### 4. Retry-After and Backoff Recommendation — Missing Detail

**Claim in doc:** Section 8.2 shows `Retry-After` header is present on 429 responses. Section 12.1 notes `@gitbeaker/rest` "handles rate limit header reading and automatic retry with Retry-After."

**Gap:** The document does not specify the recommended backoff behavior for callers who do not use `@gitbeaker/rest`. Specifically:
- Whether to use a fixed wait vs. exponential backoff
- How to handle the case where `Retry-After` is absent (which happens on Projects/Groups/Users API 429s — see finding 3 above)

**Recommendation:** Add a short section noting:
- Always read `Retry-After` when present
- When absent (e.g., Projects/Groups/Users APIs), fall back to `RateLimit-Reset` (Unix timestamp in `RateLimit-Reset` header)
- Apply jittered exponential backoff if neither is available
- Do not retry immediately on 429 — that worsens the limit

**Severity:** Low. SDK users (recommended: `@gitbeaker/rest`) get this behavior automatically.

---

### 5. Webhook Retry Behavior — Correct Overall, Minor Gaps

**Claim in doc (Section 3.3):** "GitLab retries with exponential backoff on non-2xx responses. After 40 consecutive failures, the webhook is permanently disabled."

**Verification:**
- 40 consecutive failures → permanently disabled: ✓ Correct
- 4 consecutive failures → temporarily disabled: ✓ Correct (source: [Webhooks](https://docs.gitlab.com/ee/user/project/integrations/webhooks.html))
- Temporary disable starts at 1 minute, extends on subsequent failures up to 24 hours: ✓ Correct (source: [Webhooks](https://docs.gitlab.com/ee/user/project/integrations/webhooks.html))
- 2xx response re-enables webhook: ✓ Correct

**Gap:** The doc does not mention the temporary disable phase (4 failures → 1 minute disable, escalating to 24 hours). It only mentions the permanent disable at 40. Operators should know about the temporary phase since it affects recovery planning.

**Severity:** Low. The permanent disable threshold is the most operationally critical detail.

---

### 6. Pagination — Correct

| Claim in doc | Verified | Source |
|---|---|---|
| Offset pagination: `page`, `per_page` | ✓ Default 20, max 100 | [REST pagination](https://docs.gitlab.com/ee/api/rest/pagination.html) |
| Keyset pagination: `pagination=keyset`, `order_by`, `sort` | ✓ Required params are correct | [REST pagination](https://docs.gitlab.com/ee/api/rest/pagination.html) |
| Max page size: 100 | ✓ Correct | [REST pagination](https://docs.gitlab.com/ee/api/rest/pagination.html) |
| >10,000 records → no `x-total`, `x-total-pages`, `rel="last"` | ✓ Correct | [REST pagination](https://docs.gitlab.com/ee/api/rest/pagination.html) |
| GraphQL: max query complexity 200 unauth / 250 auth | ✓ Correct | [GraphQL API](https://docs.gitlab.com/ee/api/graphql/index.html) |
| GraphQL: max query size 10,000 chars | ✓ Correct | [GraphQL API](https://docs.gitlab.com/ee/api/graphql/index.html) |
| GraphQL: request timeout 30s | ✓ Correct | [GraphQL API](https://docs.gitlab.com/ee/api/graphql/index.html) |

**Missing:** GraphQL max page size is 100 nodes per page (confirmed in GraphQL API docs). The doc mentions "max page size: 100" for REST but does not address GraphQL pagination size. Not critical since the connector is REST-first.

No changes needed.

---

### 7. Bulk / Batch Endpoints — Correct

| Claim in doc | Verified | Source |
|---|---|---|
| GraphQL multiplex: complexity 200/250, max 10,000 chars, 30s timeout | ✓ Correct | [GraphQL API](https://docs.gitlab.com/ee/api/graphql/index.html) |
| REST `per_page=100` for list endpoints | ✓ Correct | [REST pagination](https://docs.gitlab.com/ee/api/rest/pagination.html) |
| `statistics=true`, `simple=true` to reduce payload | ✓ Valid query params | API surface |
| Keyset pagination for commits, container registry | ✓ Supported | API surface |

**Note on GraphQL scope claim:** The doc says "Query complexity limit: 200 (unauthenticated), 250 (authenticated)." This is correct. No missing bulk endpoints flagged.

---

### 8. Error Response Shape — Adequate, Could Be More Specific

**Claim in doc:** Section 8.2 shows `Retry-After` header behavior. 429 response body is plain text `Retry later`.

**Gap:** The document does not characterize the general API error shape (non-429 errors). GitLab REST returns:
- Content-Type: `application/json`
- Body: `{"message": "...", "documentation_url": "..."}` for most errors
- `{"error": "..."}` format for OAuth token errors

This is worth documenting since it affects error parsing in the connector.

**Severity:** Low. The connector should handle 429 specifically and can use generic JSON parsing for other errors.

---

### 9. Failed Auth Ban — Incorrect Duration

**Claim in doc (Section 10.12):** "300 failed authentication attempts in 1 minute triggers a 15-minute ban for Git and container registry operations."

**Correct value:** 15 minutes is correct, but the source doc says **15 minutes**, not 1 hour. The 1-hour figure appears to be from a different GitLab version or is simply incorrect.

**Additional detail from official docs:** The ban is triggered by **30 failed auth requests in 3 minutes** (not 300 in 1 minute), and the response code is **403** (not documented by the doc — it says "banned" without specifying the response code).

**Severity:** Low. This only applies to Git/registry auth, not API token auth. Relevant for debugging but not for the API-only connector scope.

---

### 10. Concurrency Recommendations — Sensible

**Claim in doc (Section 8.5):** Suggests one PAT per tenant to avoid notes bottleneck (60/min limit).

**Assessment:** Correct recommendation. The notes limit is the tightest constraint for the connector's primary use case. Multi-tenant tokens would exhaust the notes limit quickly.

**Missing:** No explicit recommendation on concurrent requests to avoid hitting the 2,000/min API limit. A rough guide would help: at `per_page=100`, each list request counts as 1 against the limit. A safe concurrent write ceiling for sustained activity is ~10-20 concurrent requests with jittered backoff.

**Severity:** Low. The SDK recommendation (`@gitbeaker/rest`) handles this automatically.

---

### 11. Two Independent Rate Limit Systems — Correct

**Claim in doc (Section 8.4):** "GitLab has two independent systems: Rack::Attack (network-layer) and application-level throttles. Hitting one does not consume from the other."

**Verification:** Confirmed. Rack::Attack is the network-layer IP-based throttling. Application-level throttles are per-user/per-endpoint. Hitting one does not consume from the other.

No changes needed.

---

## Summary of Changes Recommended

| # | Area | Change |
|---|---|---|
| 1 | Rate limits | Add missing endpoint-specific limits (single project 400/min, runner jobs 2,000/min, user endpoint limits). Not critical for MVP but improves accuracy. |
| 2 | Retry-After | Add backoff recommendation for non-SDK users: use `Retry-After` → `RateLimit-Reset` → jittered exponential fallback. |
| 3 | Webhook retry | Add note about temporary disable at 4 consecutive failures (before permanent at 40). Helps operators plan recovery. |
| 4 | Error shape | Add brief note on `{"message": "...", "documentation_url": "..."}` error format for non-429 errors. |
| 5 | Failed auth ban | Fix duration: "300 failed attempts in 1 minute" → "30 failed attempts in 3 minutes" triggers 15-minute 403 ban. Clarify this is Git/registry only, not API. |

**No critical issues.** The document is operationally sound as-is. All rate limit numbers are accurate. Pagination is correct. The changes above improve completeness but are not blockers for implementation.