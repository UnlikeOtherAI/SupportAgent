# GitHub Projects v2 Connector — Operational Reliability Review

**Reviewer**: limits (rate limits, pagination, retries, error handling, bulk ops)
**Source document**: `docs/connectors/github_projects.md`
**Review date**: 2026-04-18
**Verdict**: CONDITIONAL PASS — 4 factual corrections needed; otherwise the operational sections are sound.

---

## Finding 1 — GitHub App GraphQL Points Ceiling (HIGH)

**Area**: Section 8, Rate Limits table, "GitHub Apps" column
**Claim in doc**: GitHub App GraphQL limit is 5,000 points/hr (same as PAT)
**Correct value**: GitHub App installations (non-Enterprise) receive 5,000 base points/hr, **plus +50/hr per additional repository (beyond 20)** and **+50/hr per additional user (beyond 20)**, capped at a maximum of **12,500 points/hr**. Enterprise Cloud GitHub App installations receive 10,000 points/hr.
**Citation**: [GitHub GraphQL API Rate Limits (via WebFetch)](https://docs.github.com/graphql/overview/rate-limit-and-node-limits-for-the-graphql-api)

**Impact**: The doc understates the ceiling for GitHub App installations by 7,500 points/hr. Any concurrency or throughput recommendation based on this number will be unnecessarily conservative for multi-repo/multi-user installations. Correct the table to show base + per-repo/user scaling, and note the 12,500 non-Enterprise maximum and 10,000 Enterprise Cloud maximum.

---

## Finding 2 — GraphQL CPU Time Limit (MEDIUM)

**Area**: Section 8, Rate Limits table, "CPU time" row
**Claim in doc**: `90s per 60s`
**Correct value**: GraphQL queries have a **maximum of 60 seconds of CPU time** per 60-second real-time window. The 90s figure applies to the REST API, not GraphQL.
**Citation**: [GitHub GraphQL API Rate Limits](https://docs.github.com/graphql/overview/rate-limit-and-node-limits-for-the-graphql-api)

**Impact**: The wrong CPU time limit could cause misconfigured monitors or early termination of legitimate queries. Fix to 60s for GraphQL. If the doc wants to mention the 90s REST limit, add it as a separate row under the REST section.

---

## Finding 3 — GraphQL Points Per Minute Not Stated (LOW)

**Area**: Section 8, Rate Limits table
**Claim in doc**: Only one "Points per minute" entry, not attributed to a specific API
**Correct value**: GraphQL has a **2,000 points/minute** secondary limit. REST has a separate **900 requests/minute** secondary limit. Both APIs share a **100 concurrent requests** ceiling (REST + GraphQL combined).
**Citation**: [GitHub REST & GraphQL Rate Limits](https://docs.github.com/rest/overview/rate-limits-for-the-rest-api)

**Impact**: A single "Points per minute" value without API attribution is ambiguous. Split into two rows to make it clear that GraphQL and REST have different per-minute secondary limits. The shared 100 concurrent request limit is correctly noted.

---

## Finding 4 — REST API Rate Limit Header Name Case (LOW)

**Area**: Section 8, Headers example and Appendix
**Claim in doc**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, etc.
**Correct value**: GitHub uses **lowercase** header names: `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, `x-ratelimit-used`, `x-ratelimit-resource`
**Citation**: [GitHub REST API Rate Limits](https://docs.github.com/rest/overview/rate-limits-for-the-rest-api)

**Impact**: Case-sensitive header comparison in code will silently fail to detect rate limit state if the code looks for `X-RateLimit-*` (mixed case). Every header example in the doc (Sections 8, Appendix) uses incorrect casing. Fix throughout.

---

## Finding 5 — 429 vs 403 Response Code on Primary Limit (MEDIUM)

**Area**: Section 8, Retry Semantics
**Claim in doc**: Does not specify HTTP status codes; implies primary limit uses `X-RateLimit-Remaining: 0` without a 4xx status change
**Correct value**: Primary rate limit exhaustion returns **HTTP 403 or 429** (not 200) with `x-ratelimit-remaining: 0`. The doc's earlier fetch used `200 OK` as a shorthand but the official docs confirm the primary limit can return 403/429.
**Citation**: [GitHub REST & GraphQL Rate Limits](https://docs.github.com/rest/overview/rate-limits-for-the-rest-api)

**Impact**: The retry logic in the connector should treat **both 403 and 429** as rate limit signals, not only 429. The doc correctly notes `Retry-After` for secondary limits but does not note it may appear on 403/429 for primary limits. Clarify that `Retry-After` header takes precedence when present, otherwise wait until `x-ratelimit-reset`.

---

## Finding 6 — Retry-After Semantics (MEDIUM)

**Area**: Section 8, Retry Semantics
**Claim in doc**: "On secondary limit: check `Retry-After` header; exponential backoff"
**Correct value**: The official guidance is: when `Retry-After` header is present, wait **that many seconds** before retrying. For subsequent retries without a `Retry-After` header, use **exponential backoff with at least a 1-minute minimum**.
**Citation**: [GitHub REST & GraphQL Rate Limits](https://docs.github.com/rest/overview/rate-limits-for-the-rest-api)

**Impact**: The doc is directionally correct but missing the explicit minimum: "wait at least one minute" on retries without `Retry-After`. Without this, a naive implementation could hammer the API with sub-minute retries and trigger abuse controls. Add the 60-second minimum to the retry guidance.

---

## Finding 7 — No Bulk Endpoints (INFO)

**Area**: Section 10, "No bulk mutations" in API Quirks
**Claim in doc**: "No bulk mutations: Each item operation is a separate mutation"
**Verdict**: This is correct. GitHub Projects v2 GraphQL does not expose bulk item operations (no batch add, no batch field update). The doc correctly identifies this as a gotcha. No corrective action needed.

**Additional note**: The GraphQL API does allow **query batching** within a single request (multiple operations in one body), but this is limited by the points budget, not a per-query rate limit. The doc mentions batching in Section 8 but could clarify that batching helps points economy, not request-count economy.

---

## Finding 8 — Pagination (ACCURATE)

**Area**: Section 9, Pagination & Search
**Claim in doc**: `first: 100` max; cursor-based with `pageInfo.endCursor`; `last` supported for backward pagination
**Correct value**: All correct. `first`/`last` must be between **1 and 100** per GitHub's node limit. Cursor pagination via `pageInfo.endCursor` is the standard pattern. The 500,000 total node query limit is a separate constraint not mentioned in the doc — consider adding it.
**Citation**: [GitHub GraphQL Overview](https://docs.github.com/graphql/overview/rate-limit-and-node-limits-for-the-graphql-api)

**Concurrency-write skew note** (flagged for documentation): Cursor pagination over connections with concurrent writes is subject to item drift. The doc correctly uses `updatedAt` filtering for reconciliation but does not explicitly call out that cursor pagination can miss or duplicate items during high-write reconciliation passes. Recommend adding a note: "Cursor pagination is stable-order only; concurrent writes to a project may cause items to be skipped or duplicated during full syncs. Use `updatedAt` filtering to limit exposure."

---

## Finding 9 — Error Response Shape (ACCURATE)

**Area**: Throughout, referenced via SDK
**Claim in doc**: Relies on `@octokit/graphql` for error handling; no explicit error shape documented
**Correct value**: GitHub GraphQL returns errors in the standard GraphQL `errors` array with `{"message": "...", "locations": [...], "path": [...]}`. The `data` object may still be present alongside errors for partial success. REST returns `{"message": "...", "documentation_url": "..."}` with 403/429 status.
**Citation**: GitHub GraphQL spec + REST API

**Gap**: The doc should explicitly note that:
1. GraphQL responses with errors may still contain partial `data` — do not treat `errors` presence as a complete failure without checking `data` first
2. REST errors follow `{"message": "...", "documentation_url": "..."}` shape

---

## Finding 10 — GITHUB_TOKEN (Actions) Limits (MISSING)

**Area**: Section 8, Rate Limits table
**Claim in doc**: No mention of GITHUB_TOKEN (GitHub Actions) limits
**Correct value**: `GITHUB_TOKEN` in Actions has **1,000 requests/hr per repository**. Enterprise Cloud accounts get **15,000 requests/hr**. The doc should note that the `GITHUB_TOKEN` budget is separate and much lower, relevant only if the connector runs inside GitHub Actions.
**Citation**: [GitHub REST API Rate Limits](https://docs.github.com/rest/overview/rate-limits-for-the-rest-api)

**Impact**: Low for this connector (PAT/GitHub App are recommended auth methods), but missing from the table creates a false impression that all auth methods have the same 5,000/hr budget.

---

## Summary

| # | Severity | Area | Issue |
|---|----------|------|-------|
| 1 | HIGH | Rate limits table | GitHub App ceiling understated (5k → 12.5k max) |
| 2 | MEDIUM | Rate limits table | GraphQL CPU time wrong (90s → 60s) |
| 3 | LOW | Rate limits table | Per-minute limits not API-attributed (900 REST / 2000 GraphQL) |
| 4 | LOW | Headers throughout | Wrong header casing (X-RateLimit-* → x-ratelimit-*) |
| 5 | MEDIUM | Retry semantics | 403 not included as rate limit status code |
| 6 | MEDIUM | Retry semantics | Missing 60-second minimum retry interval |
| 7 | INFO | Bulk ops | Correctly identifies no bulk mutations |
| 8 | ACCURATE | Pagination | Correct; add 500k node limit and concurrency-write note |
| 9 | INFO | Error shape | Missing partial-success guidance |
| 10 | LOW | Rate limits table | GITHUB_TOKEN limits missing (low priority) |

**Priority fix order**: 1 → 2 → 5 → 6 → 4 → 3 → 8 → 9 → 10 → 7.

**Verdict**: With items 1 and 2 fixed, the operational reliability section is accurate enough to base implementation decisions on. Items 5 and 6 are important for correctness of the retry layer. The remaining items are low-priority corrections.
