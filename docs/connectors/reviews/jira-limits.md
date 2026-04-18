# Jira Connector — Operational Reliability Review

**Reviewed:** `docs/connectors/jira.md` (Section 8 Rate Limits, Section 9 Pagination)
**Reviewer:** Operational-Reliability Audit
**Verdict:** Mostly sound — 4 findings, 2 material

---

## Finding 1 — Rate Limit Numbers (Material)

**Section 8.1, "Hourly Points" row**

**Claim:**
> Default: 65,000 points/hour globally

**Correct behavior:**
Jira Cloud has two independent limit tiers:

| Tier | Scope | Free | Standard | Premium | Enterprise |
|------|-------|------|----------|---------|------------|
| Tier 1 — Global Pool | Shared across all tenants | 65,000 pts/hr | 65,000 pts/hr | 65,000 pts/hr | 65,000 pts/hr |
| Tier 2 — Per-Tenant Pool | Per-site | 65,000 pts/hr | 100,000 + 10×users (cap 500K) | 130,000 + 20×users (cap 500K) | 150,000 + 30×users (cap 500K) |

**Citation:** [Atlassian — Jira Platform Rate Limiting](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)

**Impact:** The doc implies a flat 65K/hr for all, but Standard/Premium/Enterprise tenants have significantly higher per-tenant quotas. Under-polling is wasteful; over-polling hits the global pool first. The connector should detect which tier the tenant is on and adjust polling cadence accordingly.

**Fix:** Replace "Default: 65,000 points/hour globally" with a two-tier explanation covering the global pool and per-tenant pool with tier-specific values.

---

## Finding 2 — Point Costs (Material)

**Section 8.1, "Point costs (examples)" table**

**Claim:**
> GET requests: ~1 point  
> POST/PUT requests: ~10 points  
> Bulk operations: ~10 points per item

**Correct behavior:**

| Operation | Points |
|-----------|--------|
| GET — core domain objects | 1 |
| GET — identity & access | 2 |
| POST/PUT/PATCH/DELETE | 1 |
| Bulk | 1 per item |

**Citation:** [Atlassian — Jira Platform Rate Limiting](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)

**Impact:** Writes do NOT cost 10x. A 50-issue bulk create costs ~50 points, not ~500. This is a significant undercount — the connector could set overly conservative concurrency limits based on a 10-point write assumption. Conversely, listing users via identity endpoints (2 pts vs 1 pt) is undercounted.

**Fix:** Correct the table to 1 pt for writes, 2 pts for identity GETs. Remove "10 points" from write operations entirely.

---

## Finding 3 — Pagination: Response Field Name (Minor)

**Section 9.1, "Response" snippet**

**Claim:**
```json
{
  "startAt": 0,
  "maxResults": 50,
  "total": 1234,
  "isLast": false,
  "values": [...]
}
```

**Correct behavior:**
The search endpoint returns `issues`, not `values`:

```json
{
  "startAt": 0,
  "maxResults": 50,
  "total": 1234,
  "isLast": false,
  "issues": [...]
}
```

**Citation:** [Atlassian — Jira Platform REST API v3 Issue Search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/)

**Impact:** Low — the code sample in Appendix A uses `issues` correctly. The example in Section 9.1 is misleading.

**Fix:** Change `"values": [...]` to `"issues": [...]` in the example.

---

## Finding 4 — Pagination: `nextPageToken` Is a Request Parameter, Not a Response Field (Minor)

**Section 9.1**

**Claim:**
> Cursor pagination (nextPageToken):  
> `GET /rest/api/3/search?jql=...&nextPageToken=eyJz...`

**Correct behavior:**
`nextPageToken` is accepted as a **request parameter** (for server-side cursor iteration), not returned as a **response field**. The response signals pagination completion via `isLast: true`. The actual cursor value must come from the first request's response — the mechanism does not return `nextPageToken` in the response body.

**Citation:** [Atlassian — Jira Platform REST API v3 Issue Search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/)

**Impact:** Low — the connector should use offset pagination (`startAt`) for reconciliation polling anyway (since `updated` timestamp cursors are more stable for incremental sync), which is already the recommended approach in Section 3.2. But the framing is technically inaccurate.

**Fix:** Clarify that `nextPageToken` is a request parameter for server-side pagination, not a response cursor. Recommend `startAt` offset pagination for webhook-reconciliation hybrid mode.

---

## Finding 5 — Rate Limit Response Header Format (Minor)

**Section 8.2**

**Claim:**
```
X-RateLimit-Reset: 1642533600
```

**Correct behavior:**
`X-RateLimit-Reset` uses **ISO 8601** format, not Unix timestamp:
```
X-RateLimit-Reset: 2025-10-08T15:00:00Z
```

Also: `RateLimit-Reason` is present **only on 429 responses**, not on every response as the example suggests. `X-RateLimit-NearLimit` appears on all responses.

**Citation:** [Atlassian — Jira Platform Rate Limiting](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)

**Impact:** Low — a client parsing this incorrectly will parse a Unix timestamp if the ISO 8601 format is misread as a large number, or fail to handle the format entirely. Minor production issue.

**Fix:** Use ISO 8601 in the example header. Note that `RateLimit-Reason` only appears on 429 responses.

---

## Finding 6 — Concurrency Recommendation (Advisory)

**Section 8.3 and overall rate limit guidance**

The document does not provide a concrete concurrency recommendation for API clients.

**Guidance:**

Given the burst limits (GET: 100/s, POST: 100/s, PUT: 50/s, DELETE: 50/s) and the per-tenant quota (Free: 65K/hr, Standard+: 100K-500K/hr), a sensible default is:

- **Polling reads:** 10 concurrent GET requests — stays well under 100 RPS burst, consumes ~360K points/hr at max
- **Write operations:** 5 concurrent POST/PUT requests — stays under 50 RPS burst limit
- **Per-issue writes:** Max 20 writes per 2s per issue — enforce this per-issue write queue in addition to global concurrency
- **Global point budget:** 80% of hourly quota as safety margin; pause polling if `X-RateLimit-Remaining` hits 0

**Impact:** Without explicit guidance, the connector may be too aggressive (hitting burst limits) or too conservative (under-polling for real-time use cases).

**Fix:** Add a "Recommended Concurrency" subsection under Section 8 with the above numbers.

---

## Summary

| # | Area | Severity | Claim | Correct Value |
|---|------|----------|-------|---------------|
| 1 | Hourly quota | **Material** | 65K pts/hr globally | 65K global + 65K-500K per-tenant depending on tier |
| 2 | Point costs | **Material** | POST/PUT ~10 pts | 1 pt per write; 2 pts per identity GET |
| 3 | Response field | Minor | `"values": [...]` | `"issues": [...]` |
| 4 | nextPageToken | Minor | Response cursor | Request parameter, not returned in response |
| 5 | Header format | Minor | Unix timestamp | ISO 8601; RateLimit-Reason only on 429 |
| 6 | Concurrency | Advisory | None | Recommend 10 GET / 5 POST concurrent, 80% quota safety margin |

No "unlimited" or undocumented-rate-limit claims were found. No retry-advice that would worsen rate limiting was identified. The webhook retry semantics (5 retries, 5-15 min backoff, 20+10 concurrency) are accurate. The bulk endpoint limit (50 items) is correct.

**Sources:**
- [Atlassian — Jira Platform Rate Limiting](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)
- [Atlassian — Jira Platform REST API v3 Issue Search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/)
- [Atlassian — Jira Platform Webhooks](https://developer.atlassian.com/cloud/jira/platform/webhooks/)
