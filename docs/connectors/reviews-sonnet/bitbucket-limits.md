# Bitbucket Connector — Rate Limits, Pagination, Retries, Error Handling Review

**Reviewer**: claude-sonnet-4-6  
**Date**: 2026-04-18  
**Source doc**: `docs/connectors/bitbucket.md`  
**Scope**: Rate limits, pagination, retries, error handling, bulk operations

---

## Verdict

**Partially accurate with several significant errors.** The rate limit section contains wrong header names, a missing tier (scaled limits), and incorrect `Retry-After` semantics. The pagination section mislabels the scheme. The bulk/batch table is misleading. No critical showstoppers, but the rate-limit handling code in section 12.2 will behave incorrectly as written.

---

## Findings

### 1. Rate Limits — Authenticated Tiers

**Area**: Section 8.1, rate limit table

**Claim in doc**:
```
Authenticated (free)      60 requests/hour
Authenticated (paid workspace) 1000 requests/hour
```

**Correct value**:
- The "free / paid" split is the wrong axis. The real split is **unauthenticated vs. authenticated**. All authenticated requests (free or paid plan) receive the base limit of **1,000 requests/hour**.
- The doc's "60 req/hr for authenticated (free)" figure is wrong — 60 req/hr applies only to **unauthenticated** (anonymous) requests, measured per IP.
- Workspaces on the **Standard or Premium plan with 100+ paid seats** receive scaled limits: `1,000 + (seats − 100) × 10`, capped at **10,000 req/hr**. This applies specifically to workspace/project/repository access tokens and Forge `asApp` requests, not personal PATs or app passwords on small plans.
- The scaled limit tier is absent from the doc entirely.

**Citation**: https://support.atlassian.com/bitbucket-cloud/docs/api-request-limits/

---

### 2. Rate Limit Headers — Wrong Set

**Area**: Section 8.1, headers block

**Claim in doc**:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1609459200
```

**Correct value**:
Bitbucket Cloud does **not** return `X-RateLimit-Remaining` or `X-RateLimit-Reset`. The actual headers are:

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit` | Total requests permitted per hour (this one is correct) |
| `X-RateLimit-Resource` | Identifies the resource group (e.g. `"api"`) |
| `X-RateLimit-NearLimit` | Boolean; `true` when less than 20% of quota remains |

These three headers are only returned for requests subject to scaled rate limits (access tokens, Forge asApp). Personal PAT/app-password requests do not reliably receive any of them.

The doc's `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers are a GitHub-ism and will not be present on Bitbucket responses. Code that reads `response.headers.get('X-RateLimit-Remaining')` will always get `null`.

**Citation**: https://support.atlassian.com/bitbucket-cloud/docs/api-request-limits/ (section "Response headers")

---

### 3. Retry-After Header — Unconfirmed Claim

**Area**: Section 8.1, "When exceeded" block

**Claim in doc**:
```
Retry-After header present (seconds until reset)
Exponential backoff recommended
```

**Correct value**:
The `Retry-After` header is **not documented** by Atlassian as part of the Bitbucket Cloud rate-limit response and is not confirmed to be present. The official troubleshooting guide does not mention it. Community reports (e.g. Renovate #3024, SonarQube community thread) confirm that hitting the limit produces a bare `429` with body `"Rate limit for this resource has been exceeded."` and no `Retry-After`.

The exponential backoff recommendation is directionally correct, but the backoff must be implemented without relying on a `Retry-After` value. The official guidance is: add delays between calls, prefer sequential over concurrent requests, and maintain at least a 1-second gap between mutative requests (POST/PUT/DELETE). The connector's `BitbucketClient.request` in section 12.2 does `parseInt(retryAfter || '60')` — the fallback of 60 seconds is reasonable, but callers should understand this is always the fallback, not a server-supplied value.

**Citation**: https://support.atlassian.com/bitbucket-cloud/kb/bitbucket-cloud-rate-limit-troubleshooting/

---

### 4. Rate Limit — Per-Category Limits Not Documented

**Area**: Section 8.1 (missing)

**Claim in doc**: Only a single request-per-hour bucket is described.

**Correct value**:
Bitbucket Cloud enforces **separate rate limit buckets per resource category**. Authenticated limits by category:

| Category | Limit |
|---|---|
| Git operations (HTTPS/SSH) | 60,000 req/hr |
| Raw file downloads | 5,000 req/hr |
| Archive files (.zip, .gz) | 1,500 files/hr |
| Repository data access (REST API) | 1,000–10,000 req/hr (scaled) |
| Webhook data | 1,000 req/hr |
| Application properties | 2,000 req/hr |
| Sending invitations | 100 req/min |

The connector's polling and reconciliation loops (section 3.1.5) will hit the repository data bucket (1,000 req/hr base), not some shared pool. Concurrency guidance must account for these separate buckets.

**Citation**: https://support.atlassian.com/bitbucket-cloud/docs/api-request-limits/

---

### 5. Pagination — Scheme Mislabeled

**Area**: Section 9.1, heading and description

**Claim in doc**:
```
Cloud — Cursor-based with `page` parameter
```

**Correct value**:
This is wrong on both parts of the label. Bitbucket Cloud uses **two distinct pagination schemes** depending on the endpoint:

1. **List-based pagination** (most REST collection endpoints): navigates by integer `page` parameter, includes optional `size`, `page`, and `previous` in the response. URLs are predictable (`?page=4`). This is straightforward offset/page-number pagination, not cursor-based.

2. **Iterator-based pagination** (commits and some other endpoints): the `next` link contains an unpredictable hash instead of a page number, backward navigation is not available, and only `values` + `next` are guaranteed in the response.

The term "cursor-based" suggests a stable opaque token like Relay-style GraphQL cursors or Stripe's `starting_after`. That is not what Bitbucket does on most endpoints. The doc's example response showing `"next": "https://api.bitbucket.org/2.0/...?page=2"` is correct for list-based endpoints and is actually consistent with page-number pagination, contradicting the "cursor-based" label.

The correct implementation guidance: always follow the `next` link from the response and do not construct page URLs manually, because iterator-based endpoints use opaque hashes in the `next` link.

**Citation**: https://developer.atlassian.com/cloud/bitbucket/rest/intro/#pagination

---

### 6. Pagination — Max Page Size

**Area**: Section 9.2

**Claim in doc**:
```
Cloud: 100
Data Center: 1000 (configurable)
```

**Correct value**:
Cloud max `pagelen` of 100 is correct. The minimum is 10. The Data Center `limit` of 1,000 is plausible (DC defaults to 25, accepts higher values, admin-configurable) but should be verified against the specific DC version in use; treat it as approximate.

No issues with the Cloud figure.

---

### 7. Pagination — Item-Skip Risk Under Concurrent Writes

**Area**: Section 9.1 and 3.1.5 (missing warning)

**Claim in doc**: No mention of this risk.

**Correct value**:
List-based pagination (the type used for most Cloud endpoints) is susceptible to skipping items during concurrent writes. If a new PR or issue is created while paginating with `sort=-updated_on`, the offsets shift and items near a page boundary may be returned twice or skipped entirely. The doc uses `sort=-updated_on` for polling fallback (section 3.1.5) without acknowledging this hazard. For reliable reconciliation, the connector must either:

- Use the `updated_on` timestamp of the last seen item as a filter (`?q=updated_on > "2024-01-01T00:00:00"`) rather than page-walking, or
- Accept possible duplicates and use the resource `id` as a deduplication key.

**Citation**: Bitbucket Cloud pagination docs note that list-based pagination "assumes the collection is immutable" — that assumption breaks under concurrent writes.

---

### 8. Bulk/Batch Endpoints Table — Misleading Entry

**Area**: Section 8.3

**Claim in doc**:
```
POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments  — Batch comments
```

**Correct value**:
This endpoint creates a **single comment per call** and is not a batch endpoint. There is no bulk comment endpoint. The table note "No true batch API" at the bottom contradicts the "Batch comments" label in the same table. Remove the misleading label or remove the row entirely — it adds confusion rather than value.

---

### 9. Error Response Shape — Missing Details

**Area**: Section 8.1 and 12.2 (partial)

**Claim in doc**: Only the 429 case is handled in the code snippet. No description of the general error shape.

**Correct value**:
The Bitbucket Cloud REST API returns errors in this envelope:

```json
{
  "type": "error",
  "error": {
    "message": "Bad request",
    "detail": "Optional detailed explanation",
    "fields": { "fieldName": ["validation message"] },
    "id": "d23a1cc5178f7637f3d9bf2d13824258",
    "data": {}
  }
}
```

Key notes:
- Top-level key is `"type": "error"` + `"error"` object (not `{message, documentation_url}` like GitHub).
- `message` is always present but may be localized.
- `id` is a unique error identifier useful for Atlassian support.
- `fields` only appears on validation failures from POST/PUT.
- The connector code in 12.2 does `await response.json()` on error, which is correct, but does not destructure this shape — callers will receive a raw blob rather than a structured `BitbucketError`.

---

### 10. Concurrency Recommendation — Absent

**Area**: Section 8 (missing)

**Claim in doc**: No concurrency guidance.

**Correct value**:
Given the 1,000 req/hr base limit (≈16.7 req/min or ≈1 req/3.6s averaged) and Atlassian's explicit guidance to "maintain a minimum one-second interval between mutative requests" and prefer sequential over concurrent requests, the connector should document a concurrency limit. A reasonable starting default is **1 concurrent request** with a minimum 1-second inter-request gap, scaling up only for workspaces confirmed on scaled rate limits. Without this, parallel reconciliation across multiple repos will exhaust the budget quickly.

---

## Summary Table

| # | Area | Severity | Issue |
|---|------|----------|-------|
| 1 | Rate limit tiers | High | Authenticated free plan does not get 60 req/hr; all authenticated = 1,000 req/hr; scaled tier missing entirely |
| 2 | Rate limit headers | High | `X-RateLimit-Remaining` and `X-RateLimit-Reset` not returned by Bitbucket |
| 3 | Retry-After | Medium | Header not confirmed; connector code fallback of 60s is the only reliable value |
| 4 | Per-category limits | Medium | Separate buckets for raw files, git ops, etc. not documented |
| 5 | Pagination scheme label | Medium | Not cursor-based; list-based (page number) + iterator-based (opaque hash) |
| 6 | Max page size | OK | Cloud 100 is correct |
| 7 | Pagination under concurrent writes | Medium | Item-skip risk not flagged; polling strategy needs dedup |
| 8 | Batch comments entry | Low | Endpoint is single-item, not batch; misleading table label |
| 9 | Error response shape | Low | Shape not documented; code snippet doesn't destructure it |
| 10 | Concurrency limit | Low | No guidance; 1 req/s sequential is the safe default |
