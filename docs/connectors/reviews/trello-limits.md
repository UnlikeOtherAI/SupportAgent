# Trello Connector — Operational Reliability Audit

**Auditor:** Claude Code
**Date:** 2026-04-18
**Scope:** Rate limits, pagination, retries, error handling, bulk operations
**Source:** `docs/connectors/trello.md`

---

## Verdict: Needs Corrections — 3 critical factual errors

The document has **material errors** in rate limit header presence, pagination style, and retry strategy. The connector implementation would be incorrect if built from this document as-is. The rate limit numbers themselves are mostly accurate but the absence of header documentation prevents adaptive throttling.

---

## Findings

### 1. Rate Limit Headers — CRITICAL ERROR

**Section 8, line 528:**
> "Headers: Trello does NOT return rate limit headers. There is no `X-RateLimit-*` header."

**Status: FACTUALLY WRONG**

Trello **does** return rate limit headers. The official docs confirm headers are included in every response:

```
x-rate-limit-api-token-interval-ms: 10000
x-rate-limit-api-token-max: 100
x-rate-limit-api-token-remaining: 99
x-rate-limit-api-key-interval-ms: 10000
x-rate-limit-api-key-max: 300
x-rate-limit-api-key-remaining: 299
```

**Impact:** HIGH. The document explicitly tells implementers there are no headers, which means:
- No adaptive throttling is possible
- Retry logic cannot be header-driven
- The connector will be unable to pause proactively before hitting limits

**Citation:** [Trello API Rate Limits — Atlassian Developer](https://developer.atlassian.com/cloud/trello/guides/rest-api/rate-limits/)

**Recommendation:** Remove the "Trello does NOT return rate limit headers" claim entirely. Replace with:
```
Rate limit headers (in every response):
- x-rate-limit-api-token-interval-ms: 10000
- x-rate-limit-api-token-max: 100
- x-rate-limit-api-token-remaining: N
- x-rate-limit-api-key-interval-ms: 10000
- x-rate-limit-api-key-max: 300
- x-rate-limit-api-key-remaining: N
```

---

### 2. Pagination Style — CRITICAL ERROR

**Section 9.1, line 544:**
> "Offset-based (page + limit)"
> "page — 0-indexed page number"

**Status: MISLEADING**

The official docs explicitly state: **"No traditional page numbers exist."** The Trello API uses **date-based cursors** with `before` and `since` parameters. The `page` parameter exists for some endpoints but is not the primary pagination mechanism.

The doc's own polling section (line 178-181) contradicts itself:
```
GET /1/boards/{boardId}/actions?limit=100&page=0&filter=...
```
...while the Quick Reference says "Pagination: `page` + `limit` (offset-based, 0-indexed)."

**Correct pagination approach:**
```
GET /1/boards/{boardId}/actions?limit=100&before={lastActionId}
GET /1/boards/{boardId}/actions?limit=100&since={iso8601Timestamp}
```

**Why cursors matter:** Because Trello uses MongoDB-style IDs derived from timestamps, and lists can change between requests, date-based cursors are more stable than page numbers for concurrent-write scenarios.

**Citation:** [Trello API Pagination — Atlassian Developer](https://developer.atlassian.com/cloud/trello/rest/api-introduction/)

**Recommendation:** Update Section 9.1 to clarify:
- Primary pagination: `before`/`since` date cursors
- `page` parameter: secondary/offline pagination for some endpoints, but less stable
- Max limit: 1000 for actions

---

### 3. Retry Strategy — INCOMPLETE

**Section 8, line 530:**
> "Retry strategy: No headers means no adaptive throttling. Use fixed conservative delays (100ms between writes, 50ms between reads)."

**Status: INCOMPLETE AND WRONG PREMISE**

Since headers DO exist, adaptive throttling IS possible. The retry strategy should use headers, not fixed delays.

**Rate limit errors return HTTP 429 with JSON body:**
```json
{"error": "API_TOKEN_LIMIT_EXCEEDED", "message": "Rate limit exceeded"}
{"error": "API_KEY_LIMIT_EXCEEDED", "message": "Rate limit exceeded"}
```

**Correct retry strategy:**
1. Check `x-rate-limit-api-token-remaining` before each request
2. When remaining approaches 0, pause until the interval resets
3. On 429 response, extract error code from body
4. Wait for `x-rate-limit-api-token-interval-ms` window to reset before retrying
5. Fixed delays (100ms writes, 50ms reads) are a fallback when headers are unavailable, not the primary strategy

**Additional limit: Key blocking**
If a key receives 200+ 429 errors within a 10s window, Trello blocks that key for the **rest of the 10s window**. Implementers must respect headers to avoid this.

**Citation:** [Trello API Rate Limits — Atlassian Developer](https://developer.atlassian.com/cloud/trello/guides/rest-api/rate-limits/)

**Recommendation:** Rewrite the retry strategy section entirely:
```
Retry strategy:
- Check x-rate-limit-api-token-remaining before high-volume operations
- On 429: parse {"error": "API_TOKEN_LIMIT_EXCEEDED"|"API_KEY_LIMIT_EXCEEDED"}
- Wait for interval reset; do NOT retry immediately
- If 200+ 429s received: key is blocked for current 10s window
- Fallback: conservative fixed delays (100ms writes, 50ms reads)
```

---

### 4. Rate Limit Numbers — MOSTLY ACCURATE

**Section 8, line 521-525:**
> | Requests per second | 200 |
> | Requests per token per 10 seconds | 100 |
> | Requests per API key per 10 seconds | 300 |
> | Batch requests per call | 10 |

**Status: ACCURATE**

The numbers match the official documentation:
| Limit type | Value |
|------------|-------|
| Requests per token | 100 per 10 seconds |
| Requests per API key | 300 per 10 seconds |
| Batch URLs | 10 per request |
| Burst capacity | 200 req/s (short burst) |

**Sustained rate:** The doc correctly notes 100/token/10s = 10/s sustained. The "200 req/s burst" is a brief ceiling, not a sustained limit.

**Special endpoint:** The `/1/members/`, `/1/membersSearch/`, `/1/search` endpoints have stricter limits (100 requests per 900 seconds for members search).

**Citation:** [Trello API Rate Limits — Atlassian Developer](https://developer.atlassian.com/cloud/trello/guides/rest-api/rate-limits/)

**Recommendation:** Add note about special endpoints:
```
Special limits:
- /1/members, /1/membersSearch: 100 per 900 seconds
- /1/search: stricter limits; check headers
- Database time limits: API_TOKEN_DB_LIMIT_EXCEEDED
- Response size: API_TOO_MANY_CARDS_REQUESTED
```

---

### 5. Concurrency Recommendation — MISSING

**Section 8**

**Status: ABSENT**

The document does not provide concurrency guidance. Given:
- 100 req/10s per token (10 req/s sustained)
- 300 req/10s per API key (30 req/s sustained across all tokens)
- 200 req/s burst ceiling

**Recommended concurrency:**
- Per-token workers: max ~5 concurrent requests before rate pressure
- Per-key workers: max ~15 concurrent requests across all tokens
- Use token-level headers for per-tenant adaptive throttling
- Multi-tenant: each tenant gets their own token, no cross-tenant sharing

**Citation:** Derived from rate limit numbers in official docs.

**Recommendation:** Add a concurrency subsection:
```
Concurrency guidance:
- Per-token: max ~5 concurrent requests (respect 100/10s budget)
- Per-API-key: aggregate across all tokens, max ~15 concurrent
- Each tenant's token is independent — no cross-tenant rate limit sharing
- Use x-rate-limit headers to dynamically adjust concurrency
```

---

### 6. Batch Endpoint Limitations — NEEDS CLARIFICATION

**Section 9.4, line 588-592:**
> GET /1/batch?urls={url1},{url2},...

**Status: ACCURATE BUT INCOMPLETE**

The document correctly notes:
- Max 10 URLs per batch
- Counts as N requests toward limit
- Forge/OAuth2 apps CANNOT access this endpoint

**Missing detail:** The document doesn't clarify the rate limit accounting:
- Each URL in the batch counts as **1 request** against your token limit
- Batch requests are useful for reducing HTTP overhead, not for circumventing limits

**Recommendation:** Add clarifying note:
```
Batch endpoint rate accounting:
- Each URL in batch = 1 request toward your 100/10s token limit
- Batch is for reducing HTTP overhead, not for rate limit bypass
- Cannot be used for bulk data export — still limited by individual endpoint limits
```

---

### 7. Pagination Max Size — ACCURATE

**Section 9.2, line 558:**
> Actions: 1000 (with `limit=1000`)
> Cards on board: varies (no pagination param — returns all open cards)

**Status: ACCURATE**

The max of 1000 for actions is correct. The note about "Cards on board: varies (no pagination param)" is correct — `GET /1/boards/{boardId}/cards` returns all open cards without pagination parameters.

**Citation:** [Trello API — Pagination](https://developer.atlassian.com/cloud/trello/rest/api-introduction/)

**Recommendation:** None — this section is accurate.

---

## Summary Table

| # | Area | Claim in Doc | Correct Value | Severity |
|---|------|--------------|---------------|----------|
| 1 | Rate limit headers | "No X-RateLimit-* headers" | **Headers exist**: x-rate-limit-api-token-* and x-rate-limit-api-key-* | **Critical** |
| 2 | Pagination style | "Offset-based (page + limit)" | **Date-based cursors**: before/since primary; page secondary | **Critical** |
| 3 | Retry strategy | "No headers = fixed delays" | **Use headers**: adaptive throttling possible; 429 body parsing | **Critical** |
| 4 | Rate limit numbers | 100/token, 300/key, 10/batch | ✅ Accurate | — |
| 5 | Concurrency guidance | Absent | Max ~5/token, ~15/key across tokens | Medium |
| 6 | Batch endpoint | 10 URLs max | ✅ Accurate; add note about rate accounting | Low |
| 7 | Pagination max size | 1000 actions | ✅ Accurate | — |

---

## Recommended Changes (Priority Order)

1. **Remove "Trello does NOT return rate limit headers"** (Section 8, line 528) — add header documentation instead
2. **Rewrite retry strategy** (Section 8, line 530) — use headers for adaptive throttling, not fixed delays
3. **Clarify pagination** (Section 9.1) — date-based cursors (`before`/`since`) are primary; `page` is secondary
4. **Add concurrency guidance** (Section 8) — ~5 concurrent per token, ~15 per API key
5. **Add special endpoint limits** (Section 8) — `/1/members`, `/1/search` have stricter limits
6. **Add batch rate accounting note** (Section 9.4) — each URL = 1 request toward limit

---

## Sources

- [Trello API Rate Limits — Atlassian Developer](https://developer.atlassian.com/cloud/trello/guides/rest-api/rate-limits/)
- [Trello API Pagination — Atlassian Developer](https://developer.atlassian.com/cloud/trello/rest/api-introduction/)
