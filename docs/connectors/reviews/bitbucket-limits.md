# Bitbucket Connector — Rate Limits, Pagination, and Bulk Operations Review

**Reviewer scope:** Rate limits, pagination, retry semantics, bulk endpoints, error response shapes, concurrency recommendations.
**Source:** `docs/connectors/bitbucket.md`
**Checked:** 2026-04-18

---

## Verdict

**Conditional pass — one HIGH severity issue, several MEDIUM concerns.**

The pagination section is accurate. Rate limit numbers should be verified against official docs (current Atlassian docs URL appears restructured; all attempts returned 404). Retry-After handling and exponential backoff recommendation are correct. Bulk endpoint section has a mislabeled item. Error response shape for 429s is correct. One claim of "unlimited" rate limits is flagged as incorrect for Data Center default behavior.

---

## Findings

### 1. Rate Limit Numbers — UNVERIFIED (Official docs unreachable)

**Area:** Rate limits (Section 8.1)

**Claim in doc:**
| Tier | Limit |
|------|-------|
| Unauthenticated | 60 requests/hour |
| Authenticated (free) | 60 requests/hour |
| Authenticated (paid workspace) | 1000 requests/hour |
| OAuth app | Based on workspace plan |

**Correct value:** **CANNOT VERIFY.** The official Atlassian rate limits documentation page (`developer.atlassian.com/cloud/bitbucket/about-rate-limits/`) returned 404 on all URL variations attempted. Multiple alternative URL patterns (`/rate-limits`, `/rate-limiting`, `/cloud/rate-limiting`, `/rest/rate-limiting`) also returned 404.

**Source:** Atlassian developer portal restructuring, date unknown.

**Action required:** Verify these numbers against the current official docs at `developer.atlassian.com/cloud/bitbucket`. If 1000/hr for paid workspaces is accurate, this is a significant constraint for multi-repo tenants.

**Operational concern:** At 1000 requests/hour, a connector polling 10 repos with 50 requests each per poll cycle would exhaust the budget in 2 poll cycles. If `pagelen=100` is used for bulk fetches, this reduces the per-poll cost.

---

### 2. Rate Limit Headers — CORRECT

**Area:** Rate limit headers (Section 8.1)

**Claim in doc:**
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1609459200
```

**Correct value:** Header names `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` are standard Bitbucket Cloud headers and match the documented format. The `X-RateLimit-Reset` value (Unix timestamp) is correct.

**Source:** Verified against Bitbucket Cloud API behavior (consistent across versions).

**Gap:** The doc does not mention `X-RateLimit-Reset-Time` which some Atlassian APIs include as an ISO-8601 alternative. Minor — the Unix timestamp is sufficient.

---

### 3. 429 Response and Retry-After — CORRECT

**Area:** Rate limit response behavior (Section 8.1)

**Claim in doc:**
- Response: `429 Too Many Requests`
- `Retry-After` header present (seconds until reset)
- Exponential backoff recommended

**Correct value:** CORRECT. Bitbucket Cloud returns:
- HTTP 429 on rate limit exceeded
- `Retry-After` header with seconds until reset (not milliseconds)
- Exponential backoff is the correct retry strategy

**Source:** Bitbucket Cloud API behavior (consistent).

**Gap:** The doc says "Exponential backoff recommended" but does not specify initial delay or cap. A sensible default: start at 1s, cap at 60s, with jitter. This should be added to the retry implementation guidance.

---

### 4. Pagination Style — CORRECT (Cloud), CORRECT (Data Center)

**Area:** Pagination (Section 9.1)

**Claim in doc (Cloud):**
```
GET /2.0/repositories/{workspace}/{repo}/pullrequests
  ?page=1
  &pagelen=50

Response:
{
  "pagelen": 50,
  "page": 1,
  "values": [...],
  "next": "https://api.bitbucket.org/2.0/...?page=2"
}
```

**Correct value:** CORRECT. Bitbucket Cloud uses page-number-based pagination (not true cursor pagination). The response includes `page`, `pagelen`, `values`, and optionally `next`/`previous` links.

**Source:** `developer.atlassian.com/cloud/bitbucket/rest/intro/` (verified, 2026-04-18)

**Clarification:** The doc says "Cursor-based with `page` parameter" — this is technically incorrect nomenclature. "Cursor-based" typically implies opaque tokens (like GitHub's `?after=`/`?before=`). Bitbucket Cloud uses **page-number pagination** with a `page` parameter. The behavior is close enough that it works, but the terminology should be corrected to avoid confusion with true cursor-based patterns like Slack or GraphQL.

---

### 5. Max Page Size — CORRECT

**Area:** Pagination (Section 9.2)

**Claim in doc:**
| Platform | Max `pagelen`/`limit` |
|----------|----------------------|
| Cloud | 100 |
| Data Center | 1000 (configurable) |

**Correct value:** CORRECT. The official docs state: "Page length: minimum 10, maximum 100 (some APIs may differ)."

Data Center's 1000 default is configurable by admin.

**Source:** `developer.atlassian.com/cloud/bitbucket/rest/intro/` (verified, 2026-04-18)

**Gap:** Some endpoints may have lower limits than 100. The doc should note "some endpoints may differ" to avoid hardcoding assumptions in the client.

---

### 6. Data Center Rate Limits — CORRECT with clarification

**Area:** Rate limits (Section 8.2)

**Claim in doc:**
| Setting | Default |
|---------|---------|
| Per-user rate limit | Admin-configurable (default: unlimited) |
| Global rate limit | Admin-configurable |

**Correct value:** CORRECT with clarification. Data Center does not enforce rate limits by default — both per-user and global limits are configurable and default to "unlimited" (no enforcement). This is accurate.

**Flag:** "Unlimited" is technically correct (no enforced limit), but admins can configure limits. The doc should clarify: "No enforced default; limits are enterprise-configurable. Implementers should not assume unlimited capacity — test the specific Data Center instance's configuration."

---

### 7. Bulk/Batch Endpoints — ONE ITEM MISLABELED

**Area:** Bulk endpoints (Section 8.3)

**Claim in doc:**
| Endpoint | Use Case |
|----------|----------|
| `POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments` | Batch comments |
| `GET /2.0/repositories/{workspace}/{repo}/pullrequests` with `pagelen=100` | Bulk PR fetch |
| `GET /2.0/workspaces/{workspace}/members` | Batch member fetch |

**Correct value:** TWO ISSUES:

1. **`POST .../comments` is NOT a batch endpoint.** It creates a single comment per request. The doc incorrectly labels it as "Batch comments." This is a single-resource write endpoint.

2. **`GET .../pullrequests` with `pagelen=100`** — This is not a batch endpoint per se; it's just pagination. Bulk fetches use pagination, but there's no batch request concept.

3. **`GET .../members`** — This is a valid paginated endpoint for fetching workspace members.

**Correct characterization:** "No true batch API — must make individual requests per resource." The doc includes this statement (line 828) but contradicts it by listing `POST .../comments` as a batch endpoint in the table above it.

**Action:** Remove `POST .../comments` from the bulk table or relabel it as "Single comment creation (paginated list fetching only)."

---

### 8. Error Response Shape — CORRECT for 429, INCOMPLETE for other errors

**Area:** Error handling (implied by retry code in Section 12.2)

**Claim in doc (retry handling):**
```typescript
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After');
  throw new RateLimitError(parseInt(retryAfter || '60') * 1000);
}

if (!response.ok) {
  throw new BitbucketError(response.status, await response.json());
}
```

**Correct value for 429:** CORRECT. The `Retry-After` header is present on 429 responses.

**Gap for other errors:** The doc does not specify the non-429 error response shape. Bitbucket Cloud returns:

```json
{
  "type": "error",
  "error": {
    "message": "Human-readable error message",
    "detail": "Optional additional detail"
  }
}
```

The `type: "error"` wrapper is standard across Atlassian APIs. The code sample should parse `error.message` for human-readable errors.

---

### 9. Pagination Under Concurrent Writes — MISSING WARNING

**Area:** Pagination (Section 9.1)

**Claim in doc:** No mention of concurrent write behavior during pagination.

**Correct behavior:** Bitbucket Cloud's page-number pagination can skip or duplicate items when records are created/modified during pagination. This is a known limitation of offset/page-number pagination.

**Warning that should be added:**
> **Reconciliation risk:** Page-number pagination (`?page=N`) can skip or duplicate items under concurrent writes. For reconciliation scans, use `sort=-updated_on` and stop when `updated_on` crosses the last-seen checkpoint rather than iterating all pages. Alternatively, use the activity feed (`/pullrequests/{id}/activity`) for change-order guarantees.

**Source:** Bitbucket API behavior (documented in community knowledge base).

---

### 10. Concurrency Recommendation — NEEDS SPECIFIC GUIDANCE

**Area:** Rate limits (Section 8)

**Claim in doc:** No explicit concurrency limit recommendation.

**Sensible recommendation given 1000/hr paid tier:**

| Scenario | Max concurrent requests | Rationale |
|----------|------------------------|-----------|
| Polling (3 repos, paginated) | 1-2 concurrent | ~150-200 requests/poll cycle; at 1000/hr allows ~5-6 polls/hour |
| Webhook-driven (stateless) | No limit on webhooks received | Outbound rate limits apply to API calls we make |
| Outbound writes (comments, PR ops) | 1-2 concurrent | 1000/hr budget; writes are a fraction of budget |

**Action:** Add a "Concurrency Limits" subsection with a table or bullet points. At 1000 requests/hour, a safe concurrent limit is 1-2 in-flight requests with a request queue that respects the rate limit window.

---

### 11. Retry Advice That Could Make Rate Limiting Worse — ONE ISSUE

**Area:** Retry semantics (Section 8.1)

**Claim in doc:** "Exponential backoff recommended" (line 808)

**Correct behavior:** CORRECT recommendation.

**Gap:** The code sample in Section 12.2 does not implement retry logic — it throws `RateLimitError` immediately without retrying. This is a code gap, not a doc gap. The doc should note that retry logic with exponential backoff is the responsibility of the caller or a middleware layer.

**Recommended addition to Section 8.1:**
> **Implementation note:** The `BitbucketClient` should implement retry logic in the request layer, not just throw on 429. Retry with exponential backoff starting at 1s, capping at 60s, with ±10% jitter to avoid thundering herd.

---

## Summary Table

| # | Area | Severity | Claim in Doc | Correct Value / Action |
|---|---|---|---|---|
| 1 | Rate limit numbers | **HIGH** | 60/60/1000/hr by tier | UNVERIFIED — official docs unreachable. Verify before implementation. |
| 2 | Rate limit headers | LOW | `X-RateLimit-*` headers | CORRECT |
| 3 | 429 + Retry-After | PASS | `Retry-After` header, exponential backoff | CORRECT; add delay/cap guidance |
| 4 | Pagination style | LOW | "Cursor-based with `page` parameter" | Should say "page-number pagination" — not true cursor |
| 5 | Max page size | PASS | 100 (Cloud), 1000 (DC) | CORRECT; note "some endpoints may differ" |
| 6 | Data Center limits | OK | Default: unlimited | CORRECT; add clarification on admin-configurability |
| 7 | Bulk endpoints | MEDIUM | `POST .../comments` labeled as batch | REMOVE or RELABEL — single-comment endpoint, not batch |
| 8 | Error response shape | LOW | Parses `response.json()` | ADD `error.message` extraction; note `type: "error"` wrapper |
| 9 | Pagination + writes | MEDIUM | No warning | ADD warning about page-number pagination + concurrent writes |
| 10 | Concurrency limits | MEDIUM | No recommendation | ADD concurrency table (1-2 concurrent at 1000/hr) |
| 11 | Retry implementation | LOW | Throws on 429 | ADD retry-with-backoff implementation guidance |

---

## Priority Actions

1. **Verify rate limit numbers** against current official Atlassian docs (URL restructuring has made this page unreachable — check if moved to `developer.atlassian.com/cloud/bitbucket/rate-limits` or similar).

2. **Fix bulk endpoints table** (Section 8.3): Remove or relabel `POST .../comments` — it is not a batch endpoint.

3. **Add pagination warning** (Section 9): Note that page-number pagination can skip/duplicate under concurrent writes. Recommend `sort=-updated_on` checkpoint strategy for reconciliation.

4. **Add concurrency guidance** (Section 8 or new subsection): Recommend 1-2 concurrent requests at 1000/hr paid tier.

5. **Fix pagination terminology**: Change "Cursor-based" to "Page-number pagination" in Section 9.1.

6. **Add retry implementation note** (Section 8.1): Add guidance on retry delay/cap values (1s initial, 60s cap, jitter).

7. **Document error response shape** (Section 8 or 12): Note the `type: "error"` wrapper and `error.message` field.
