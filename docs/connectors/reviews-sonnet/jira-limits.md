# Jira Connector — Rate Limits, Pagination, and Reliability Review

**Reviewed doc:** `docs/connectors/jira.md`
**Reviewer focus:** Rate limits, pagination, retries, error handling, bulk operations
**Date:** 2026-04-18

---

## Verdict

**Mostly sound, with three material inaccuracies and several gaps worth fixing before implementation.**

The rate-limit numbers are plausible but not fully verifiable against current Atlassian docs — the "65,000 points/hour" figure is widely cited but Atlassian has not publicly documented a fixed global hourly budget in their official rate-limiting page. The per-second burst figures are likely correct in direction but presented with false precision. The pagination section mixes two different schemes without clearly distinguishing where each applies. Retry advice is directionally correct but incomplete.

---

## Findings

### 1. Rate Limit — Hourly Points Budget

**Area:** Section 8.1 (Rate Limits)

**Claim in doc:** "Default: 65,000 points/hour globally"

**Assessment:** Inaccurate / unverifiable as stated.
Atlassian's official rate-limiting documentation (https://developer.atlassian.com/cloud/jira/platform/rate-limiting/) does not publish a fixed global hourly point budget of 65,000. The cost-based system is real and documented, but Atlassian explicitly states limits are dynamic and may vary by product tier (Free, Standard, Premium, Enterprise) and by tenant. The 65,000 figure appears in community posts and third-party articles but is not in official docs. The doc should not present this as a known constant.

**Correct behavior:** The doc should state that the hourly budget is tier-dependent and dynamically adjusted by Atlassian, and that the connector must rely entirely on the `X-RateLimit-Remaining` and `Retry-After` response headers rather than trying to track a known budget ceiling.

**Also flag:** The doc's Open Questions section (10, last item) correctly hedges "Free/standard Cloud tier: 65K points/hour" as a question, but section 8.1 presents it as a fact. These two sections are internally inconsistent.

---

### 2. Rate Limit — Per-Second Burst Numbers

**Area:** Section 8.1 (Rate Limits)

**Claim in doc:** "GET: 100 RPS, POST: 100 RPS, PUT: 50 RPS, DELETE: 50 RPS"

**Assessment:** Partially correct direction, but the specific numbers are not published in Atlassian's official docs.
Atlassian's rate-limit documentation describes a burst-based mechanism using response headers but does not publish method-level RPS figures as definitive constants. The "10–100 req/s burst" range cited in the review prompt template aligns with what Atlassian mentions informally, but the specific 100/100/50/50 breakdown is not from official sources.

**Correct behavior:** The doc should cite these as observed/reported figures from community testing rather than documented limits. The implementation must rely on headers, not hardcoded RPS assumptions.

---

### 3. Rate Limit Headers — Header Name Accuracy

**Area:** Section 8.2 (Response Headers)

**Claim in doc:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642533600
X-RateLimit-NearLimit: false
RateLimit-Reason: jira-burst-based
Retry-After: 30
```

**Assessment:** The header names partially match Atlassian's documented headers, but the mapping is imprecise.
Atlassian's official rate-limit docs reference these headers on 429 responses:
- `X-RateLimit-Limit` — documented
- `X-RateLimit-Remaining` — documented
- `X-RateLimit-Reset` — documented (Unix epoch seconds)
- `Retry-After` — documented

However, `X-RateLimit-NearLimit` and `RateLimit-Reason` are not listed in Atlassian's official documentation. `RateLimit-Reason` in particular appears to be a fabrication or a header observed only in specific internal Atlassian testing environments. The implementation should not depend on these two headers being present.

**Correct behavior:** Treat `X-RateLimit-NearLimit` and `RateLimit-Reason` as non-authoritative. Only rely on the four documented headers listed above. If `X-RateLimit-Remaining` drops below a safe threshold (e.g. 10% of limit), throttle proactively rather than waiting for a 429.

---

### 4. Retry Semantics — Incomplete Guidance

**Area:** Section 8.3 (Retry Semantics)

**Claim in doc:** "On 429: Honor `Retry-After` header. Use exponential backoff with jitter."

**Assessment:** Correct as far as it goes, but incomplete.

Issues:
- The doc does not specify what to do if `Retry-After` is absent. Atlassian does not guarantee this header is always present on 429 responses; the connector needs a fallback delay (e.g. 60 seconds minimum).
- The doc does not distinguish between burst-limit 429s (short wait, likely seconds) and hourly quota 429s (potentially minute-scale waits). The `Retry-After` value will differ significantly between the two.
- "Exponential backoff with jitter" is correct advice, but the doc does not specify a cap. Without a cap, retries can grow to impractically long intervals. Recommended: cap at 5 minutes per retry, max 5 attempts before surfacing a permanent error.
- The doc states "scope awareness: quota errors block all calls; burst errors block that endpoint only" — this is useful but should be implemented explicitly in the client, not just stated in docs.

**Correct behavior:** Add a fallback delay when `Retry-After` is absent, cap backoff at a known maximum, and implement per-scope throttling state to avoid blocking all requests on endpoint-specific burst limits.

---

### 5. Pagination — Mixed Schemes Without Clear Scoping

**Area:** Section 9.1 (Pagination Style)

**Claim in doc:** The doc describes both offset-based (`startAt`) pagination and cursor-based (`nextPageToken`) pagination, with an example that combines them in a single request URL.

**Assessment:** Misleading / incorrect as presented.

The `GET /rest/api/3/search` and `GET /rest/api/3/search/jql` endpoints use offset-based pagination with `startAt` and `maxResults`. The `nextPageToken` cursor mechanism is available on some newer endpoints (e.g. `/rest/api/3/search/jql` in its newer form) but is not available on all endpoints and cannot be mixed with `startAt` arbitrarily.

The example in section 9.1:
```
GET /rest/api/3/search?jql=project=SUPPORT&startAt=0&maxResults=50&nextPageToken=eyJz...
```
is incorrect — you would not send both `startAt=0` and a `nextPageToken` simultaneously. The `nextPageToken` approach replaces `startAt`, it does not supplement it.

Also note: The polling fallback in section 3.1 states "Pagination: `nextPageToken` for forward-only cursor pagination" without clarifying that this only applies if using the cursor-based variant of the search endpoint.

**Correct behavior:** Clearly separate which endpoints use which pagination scheme. For the primary `GET /rest/api/3/search` endpoint, use `startAt` offset pagination only. For endpoints that support `nextPageToken`, use that exclusively and do not mix with `startAt`.

---

### 6. Pagination — Offset Instability Under Concurrent Writes

**Area:** Section 9.1 / Section 3.1 Polling Fallback

**Claim in doc:** The polling fallback uses `updated >= lastSyncTimestamp ORDER BY updated ASC` with `startAt` offset pagination.

**Assessment:** Correct approach, but a critical operational caveat is missing.

Offset-based pagination on a sorted result set is unstable when new items are being written concurrently. If issues are updated while the connector is paginating through `ORDER BY updated ASC`, earlier pages may shift forward, causing items to be skipped on the next page. This is a well-known issue with offset pagination on live data.

**Correct behavior:** The doc should warn explicitly: if two pages of a poll overlap in their `updated` timestamp range, re-fetch the overlapping boundary using a small lookback window (e.g. subtract 30 seconds from the cursor before each poll cycle) to avoid missed items. Alternatively, accept occasional duplicates and use `issue.key` as an idempotency key on the consumer side.

---

### 7. Max Page Size — Correct but Context Missing

**Area:** Section 9.2 (Max Page Size)

**Claim in doc:** "Default: 50, Maximum: 100"

**Assessment:** Correct for the JQL search endpoint. However, this is not universal across all endpoints. Comment listing, changelog, and label endpoints may have different maxima. The doc should note that 100 is the max specifically for JQL search and that per-endpoint limits should be verified.

---

### 8. Bulk Operations — Bulk Issue Endpoint Accuracy

**Area:** Section 10.5 (API Quirks)

**Claim in doc:** "`POST /rest/api/3/issue/bulk` accepts max 50 issues"

**Assessment:** The endpoint exists and the 50-issue limit is consistent with Atlassian's documented maximum. This is accurate.

**Gap:** The doc mentions `POST /rest/api/3/comment/list` in the search endpoints table (section 9.3) as "Get comments by IDs". This endpoint does exist but is worth noting it is for retrieving comments by a list of IDs, not for bulk-creating comments. No bulk comment creation endpoint exists in Jira Cloud REST API v3 — each comment must be posted individually. The doc should make this explicit to avoid the connector author looking for a bulk-post-comment endpoint that does not exist.

---

### 9. Error Response Shape — Not Documented

**Area:** No dedicated section exists.

**Assessment:** The doc has no section describing Jira's error response body format. This is a significant gap for implementation.

**Correct behavior:** Jira Cloud REST API v3 returns errors in this shape on 4xx/5xx responses:
```json
{
  "errorMessages": ["Issue does not exist or you do not have permission to see it."],
  "errors": {
    "fieldName": "Field-specific error message"
  }
}
```
For validation errors on create/update, field-level errors appear in `errors` (keyed by field name). For entity-not-found or permission errors, the message appears in `errorMessages`. A 403 may be returned instead of a 404 for permission-denied scenarios (Jira intentionally does not distinguish between "not found" and "forbidden" in some endpoints to avoid information leakage).

The connector must handle both `errorMessages` and `errors` keys and must not assume a 403 means authentication failure — it may mean the resource exists but the caller lacks access.

---

### 10. HTTP 403 vs 429 Ambiguity

**Area:** Section 8 / Error handling (no dedicated section)

**Assessment:** The doc does not address the distinction between 403 (permission denied) and 429 (rate limited). Atlassian can return a 403 in some rate-limit scenarios in older API versions. More importantly, a 403 on a write operation may mean the OAuth token has expired (access tokens last 1 hour — see section 2.1) rather than a permanent permission failure.

**Correct behavior:** Add guidance: on a 403, distinguish between token expiry (check `error: "unauthorized_access"` in response body) and genuine ACL denial. Expired OAuth tokens require a token refresh, not a retry.

---

### 11. Concurrency Recommendation — Missing

**Area:** Section 8 (Rate Limits)

**Assessment:** The doc describes rate limit mechanisms but makes no concrete recommendation on safe request concurrency for the connector.

Given the described burst limits (~100 GET RPS, ~50 write RPS per the doc's own numbers), a safe concurrency recommendation would be:
- Maximum 5 concurrent GET requests at any time
- Maximum 2 concurrent write requests at any time
- Per-issue write constraint (20 writes/2s, 100 writes/30s per issue) means the connector must serialize all writes to the same issue key, regardless of global concurrency

The doc should add an explicit concurrency guideline. Without it, implementers will default to Node's default concurrency behavior (effectively unbounded async), which will trigger burst limits immediately.

---

### 12. Webhook Expiration — Renewal Not Automated in Recommended Scope

**Area:** Section 3.1 / Section 11

**Claim in doc:** "30-day expiration requires renewal via API" (section 10.4)

**Assessment:** Correct, but the MVP endpoint list in section 11 does not include a webhook-renewal endpoint. This means a connector built to MVP spec will have its webhooks silently expire after 30 days with no events delivered and no error surfaced.

**Correct behavior:** Add `PUT /rest/webhooks/1.0/webhook/{id}` (extend expiry) or `GET /rest/webhooks/1.0/webhook` (list and check remaining lifetime) to the MVP endpoint list, plus a background renewal job that fires before the 30-day window expires (suggested: renew at 25 days).

---

## Summary Table

| # | Area | Severity | Issue |
|---|------|----------|-------|
| 1 | Rate limit — hourly budget | High | 65,000 pt/hr presented as fact; not in official docs |
| 2 | Rate limit — per-method RPS | Medium | Specific numbers not officially documented |
| 3 | Rate limit headers | Medium | Two headers (`X-RateLimit-NearLimit`, `RateLimit-Reason`) not in official docs |
| 4 | Retry semantics | Medium | Missing fallback when `Retry-After` absent; no backoff cap |
| 5 | Pagination scheme | High | `startAt` and `nextPageToken` incorrectly shown as combinable |
| 6 | Offset pagination instability | Medium | No warning about missed items under concurrent writes |
| 7 | Max page size scope | Low | Only stated for JQL search, not qualified as endpoint-specific |
| 8 | Bulk operations gap | Low | No bulk comment creation endpoint; should be made explicit |
| 9 | Error response shape | High | No section documenting error body format |
| 10 | 403 vs 429 ambiguity | Medium | 403 may mean expired OAuth token, not permanent ACL denial |
| 11 | Concurrency recommendation | Medium | No guidance on safe request concurrency |
| 12 | Webhook renewal in MVP scope | Medium | Webhooks expire in 30 days; renewal not in MVP endpoint list |
