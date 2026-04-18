# GitHub Connector — Operational Reliability Review

**Scope**: Rate limits, pagination, retry semantics, error handling, bulk operations
**Source**: `docs/connectors/github.md`
**Reviewer**: Claude Code
**Date**: 2026-04-18

---

## Verdict: Issues Found — 5 factual errors, 3 critical gaps

The document has material errors in rate limit numbers, pagination max values, and omits secondary rate limits entirely. Do not implement from this document without corrections below.

---

## Finding 1: GitHub App Rate Limit Calculation Is Wrong

**Section**: 8. Rate Limits — "GitHub App installation token" row

**Claim**:
> GitHub App installation token | 5,000 (base) + 0.5× installs bonus

**Actual**: The formula is not "0.5× installs". GitHub Apps have:
- Base: **5,000/hr**
- +50/hr per additional repository (when installation has **20+ repos**)
- +50/hr per additional user (when installation has **20+ users**)
- **Hard cap: 12,500/hr**

The document invents a "0.5× installs bonus" that does not exist in the GitHub API documentation.

**Citation**: [REST API Rate Limits — GitHub Docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

**Recommendation**: Replace the GitHub App row with:
| GitHub App (non-Enterprise) | 5,000 + 50/repo (20+ repos) + 50/user (20+ users), cap 12,500 |
| GitHub App (Enterprise Cloud) | 15,000/hr |

---

## Finding 2: Search API Rate Limit Is Partially Wrong

**Section**: 8. Rate Limits — "Search API" row

**Claim**:
> Search API | 30 (authenticated)

**Actual**: Correct for general search endpoints, but the Search API has **two tiers**:
- `GET /search/code` (code search): **10 requests/minute** (authenticated)
- All other `/search/*` endpoints: **30 requests/minute** (authenticated)
- Unauthenticated: **10 requests/minute** (all search endpoints)

**Citation**: [Search API Rate Limit — GitHub Docs](https://docs.github.com/en/rest/search/rate-limit)

**Severity**: Medium. The 30/min limit applies to issue/PR search, but if anyone uses code search they will hit a 10/min wall.

**Recommendation**: Split the row:
| Search (issues/PRs/code) | 30/min |
| Search (code only) | 10/min |
| Search (unauthenticated) | 10/min |

---

## Finding 3: Search Pagination Max per_page Is Wrong

**Section**: 9. Pagination & Search — "per_page max" description

**Claim**:
> `per_page` max: 100 (most endpoints), **1000 (search)**

**Actual**: Search API max per_page is **100**, not 1000. The document conflates this with a legacy or incorrect limit.

**Citation**: [Search API docs](https://docs.github.com/en/rest/search/rate-limit) — "Number of results per page. Default: 30. Maximum: 100."

**Recommendation**: Remove "(search)". Correct max is 100 for all endpoints including Search API.

---

## Finding 4: Secondary Rate Limits Are Entirely Absent

**Section**: 8. Rate Limits

**Claim**: Absent — no mention of secondary limits.

**Actual**: GitHub enforces **secondary/abuse rate limits** in addition to primary limits. These are not surfaced via `X-RateLimit-*` headers and will return `403` with `Retry-After` (if present) or a generic error body. Key secondary limits:

| Limit | Value |
|-------|-------|
| Concurrent requests (REST + GraphQL combined) | **100 max** |
| REST API points | **900 points/minute** |
| GraphQL points | **2,000 points/minute** |
| Content-creating requests | **80/minute, 500/hour** |
| OAuth token requests | **2,000/hour** |
| CPU time (REST) | 90s per 60s real time |
| CPU time (GraphQL) | 60s per 60s real time |

**Points system**: `GET/HEAD/OPTIONS` = 1 pt, `POST/PATCH/PUT/DELETE` = 5 pts, GraphQL reads = 1 pt, GraphQL mutations = 5 pts.

**Why this matters**: A sync worker doing concurrent `GET /issues` calls on many repos can easily hit the concurrent-request or per-minute points limit before exhausting the hourly primary limit. The document's retry advice (wait for `X-RateLimit-Remaining === 0`) will not handle these secondary limits.

**Citation**: [REST API Rate Limits — GitHub Docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

**Recommendation**: Add a "Secondary/Abuse Rate Limits" subsection to Section 8. Retry advice for secondary limits: if `Retry-After` header present, honor it; otherwise wait at least **60 seconds** and use exponential backoff.

---

## Finding 5: Retry Advice Is Incomplete for Secondary Limits

**Section**: 8. Rate Limits — "Retry Semantics"

**Claim**:
> When `X-RateLimit-Remaining === 0`: check `X-RateLimit-Reset` header. Wait until that Unix timestamp, then retry.
> GitHub returns `403 Forbidden` with `Retry-After: <seconds>` header when rate limited.

**Actual**: Partially correct. Primary rate limits return `403` (or `429`) with `X-RateLimit-Remaining: 0`. Secondary/abuse limits return `403` with or without `Retry-After`. The doc does not distinguish:
- Primary limit: wait until `x-ratelimit-reset` timestamp
- Secondary limit: use `Retry-After` if present; otherwise wait at least **1 minute** before retrying with exponential backoff

The `@octokit/rest` throttle plugin (`onRateLimit` + `onAbuseLimit` callbacks) handles both separately — the doc should recommend wiring both callbacks.

**Citation**: [REST API Rate Limits — GitHub Docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

**Recommendation**: Expand "Retry Semantics" to cover:
1. Primary rate limit: wait until `x-ratelimit-reset`
2. Secondary limit: honor `Retry-After` if present; else wait 60s+ with exponential backoff
3. Wire both `onRateLimit` and `onAbuseLimit` callbacks in Octokit

---

## Finding 6: Enterprise Cloud Org Limit Missing

**Section**: 8. Rate Limits

**Claim**: Absent.

**Actual**: Organizations on **Enterprise Cloud** get **15,000/hr** for GitHub Apps and OAuth apps (vs 5,000/hr for non-Enterprise). The document omits this entirely.

**Citation**: [REST API Rate Limits — GitHub Docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

**Recommendation**: Add to the rate limit table:
| GitHub App (Enterprise Cloud org) | 15,000/hr |

---

## Finding 7: `GET /rate_limit` Is Rate-Limit-Free — Missing

**Section**: 8. Rate Limits — "Check via API"

**Claim**: Documents `GET /rate_limit` endpoint.

**Actual**: Correct endpoint, but the document omits a critical detail: **accessing `GET /rate_limit` does not count against your REST API rate limit**. The doc should highlight this explicitly so implementers don't avoid calling it.

**Citation**: [Rate Limit API — GitHub Docs](https://docs.github.com/en/rest/rate-limit/rate-limit)

**Recommendation**: Add note: "Calling this endpoint is free — it does not consume the primary rate limit budget."

---

## Finding 8: GitHub Actions Token Budget Missing

**Section**: 8. Rate Limits

**Claim**: Absent.

**Actual**: If the connector runs inside GitHub Actions, the `GITHUB_TOKEN` has its own budget: **1,000 requests/hour per repository** (15,000 for Enterprise Cloud resources). This is a separate limit from PAT/GitHub App budgets and is easy to exhaust if polling.

**Citation**: [REST API Rate Limits — GitHub Docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

**Recommendation**: Add note under "Rate Limits" about GITHUB_TOKEN limits if Actions-based deployment is planned.

---

## What the Document Gets Right

- Unauthenticated (60/hr) and PAT (5,000/hr) primary limits are accurate
- Rate limit header names (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, etc.) are correct
- Link header pagination scheme (rel="next", rel="last") is correctly described
- Default `per_page=30` is correct
- `POST /repos/{owner}/{repo}/issues` etc. (max 100/page) is correct
- No batch mutation endpoint — correct
- `@octokit/rest` throttle plugin recommendation is sound
- `since=<ISO8601>` cursor strategy for polling is correctly described

---

## Summary Table

| # | Area | Claim | Correct Value | Severity |
|---|------|-------|---------------|----------|
| 1 | GitHub App rate limit | "5,000 + 0.5× installs bonus" | 5,000 + 50/repo (20+) + 50/user (20+), cap 12,500 | High |
| 2 | Search API rate | 30/min all search | 30/min general search, **10/min code search** | Medium |
| 3 | Search pagination max | per_page=1000 | **per_page=100** | Medium |
| 4 | Secondary rate limits | Not mentioned | 100 concurrent, 900 pts/min REST, 2,000 pts/min GraphQL | **Critical** |
| 5 | Retry for secondary | Only primary retry described | Secondary: honor Retry-After or wait 60s+ backoff | **Critical** |
| 6 | Enterprise Cloud limit | Not mentioned | GitHub Apps on Enterprise Cloud: 15,000/hr | Medium |
| 7 | GET /rate_limit free call | Not noted as free | Accessing it does not count against limits | Low |
| 8 | GITHUB_TOKEN budget | Not mentioned | 1,000/hr per repo | Low |
