# Notion Connector — Rate Limits & Pagination Review

**Reviewed file**: `docs/connectors/notion.md`
**Review date**: 2026-04-18
**Focus**: Rate limits, pagination, retries, error handling, bulk operations

---

## Verdict: Mostly accurate, one significant finding

The document accurately captures Notion's rate limits, pagination model, and bulk operation absence. One claim about retry behavior is incorrect and would lead to suboptimal client design.

---

## Findings

### 1. Rate Limit Numbers — ACCURATE

**Area**: Section 8, "Rate Limits"

**Claim in doc**:
- "Global limit: 3 requests per second average per integration"
- "Bursts beyond average are permitted"

**Correct value** (per [developers.notion.com/reference/request-rate-limit](https://developers.notion.com/reference/request-rate-limit)):
- "The Notion API allows an average of **3 requests per second** per integration."
- "Some bursts beyond the average rate are permitted."

**Assessment**: Rate limit numbers are current and accurate. No discrepancy.

---

### 2. Retry-After Header — ACCURATE

**Area**: Section 8, "Rate Limits"

**Claim in doc**:
- "Rate limit headers: `Retry-After: {seconds}` (integer, seconds to wait)"

**Correct behavior** (per official docs):
- HTTP 429 response includes `Retry-After` header with integer seconds.

**Assessment**: Header format correctly stated.

---

### 3. Retry Behavior — INCORRECT

**Area**: Section 8, "Rate Limits"

**Claim in doc**:
- "**Retry-After semantics**: Wait the indicated time, then retry **without exponential backoff**"

**Correct behavior** (per [official SDK README](https://www.npmjs.com/package/@notionhq/client)):
- "Uses **exponential back-off**: delays increase with each retry attempt"
- "Respects the `Retry-After` header when present (both delta-seconds and HTTP-date formats)"
- Default: up to 2 retries, initial delay 1000ms, max delay 60,000ms
- `Retry-After` provides a **floor**, not a ceiling — the client applies backoff on top of the server's minimum wait

**Implication**: The doc's recommendation "wait the indicated time, then retry without exponential backoff" would:
1. Undermine the SDK's built-in retry mechanism (which uses exponential backoff by default)
2. Potentially exceed the intended retry delay if `Retry-After` is smaller than the client's backoff schedule
3. Result in slower recovery than necessary since the client could retry sooner after the minimum wait

**Recommendation**: Update to: "Retry-After provides a minimum wait. The official SDK uses exponential backoff on top of this — use the SDK's retry logic rather than hand-rolling."

---

### 4. SDK Retry Capability — UNDERSTATED

**Area**: Section 12, "Dependencies"

**Claim in doc**:
- "built-in retry with `Retry-After` handling"

**Correct behavior** (per official SDK):
- Built-in retry uses **exponential backoff with jitter**, not just `Retry-After` handling
- Retryable: `rate_limited` (429, all methods), `internal_server_error` (500, GET/DELETE only), `service_unavailable` (503, GET/DELETE only)
- Configurable: `maxRetries` (default 2), `initialRetryDelayMs` (default 1000), `maxRetryDelayMs` (default 60000)

**Assessment**: The doc correctly recommends using the SDK but undersells the retry sophistication. Clients using the SDK get proper backoff automatically; clients rolling their own should implement exponential backoff with `Retry-After` as the minimum delay.

---

### 5. Pagination — ACCURATE

**Area**: Section 9, "Pagination & Search"

**Claim in doc**:
- "Cursor-based: `start_cursor` (string UUID) + `page_size` (max 100, default 100)"
- "Response shape: `{ "object": "list", "has_more": true, "next_cursor": "uuid", "results": [...] }`"
- "100 items per page across all paginated endpoints"

**Correct behavior** (per [developers.notion.com/reference/pagination](https://developers.notion.com/reference/pagination)):
- `page_size` default: 100, maximum: 100
- Cursor: `start_cursor` (request) → `next_cursor` (response), `has_more` boolean
- GET params as query string, POST params in body

**Assessment**: Accurate. Note: responses may contain fewer than the requested `page_size` — not a bug, just expected behavior under load or near list end.

---

### 6. Bulk Endpoints — ACCURATE

**Area**: Section 8, "Rate Limits"

**Claim in doc**:
- "Bulk endpoints: None available. No batch operations."

**Assessment**: Correct. Notion API has no bulk create/update endpoints. Every page or block operation is individual.

---

### 7. Error Response Shape — ACCURATE

**Area**: Implicit (Section 8 references HTTP 429)

**Claim in doc**: Implicit — only references HTTP 429 and `Retry-After` header

**Correct error shapes** (per [developers.notion.com/reference/conventions](https://developers.notion.com/reference/conventions)):
- Rate limit (429): `{ "code": "rate_limited", "message": "This request exceeds the number of requests allowed. Slow down and try again." }`
- Validation error (400): `{ "code": "validation_error", "message": "..." }`
- Unauthorized (401): `{ "code": "unauthorized", "message": "The bearer token is not valid." }`
- Forbidden (403): `{ "code": "restricted_resource", "message": "Given the bearer token used, the client doesn't have permission to perform this operation." }`

**Assessment**: The doc does not explicitly describe error body shapes, which is fine — rate limit handling is the focus. The implicit characterization (429 response) is consistent with actual behavior.

---

### 8. Concurrency Recommendation — REASONABLE

**Area**: Section 8, "Rate Limits"

**Claim in doc**:
- "Not explicitly limited; safe to run concurrent requests within burst allowance"
- "Recommendation: Implement token-bucket at 2.8 req/s (10% headroom). Respect `Retry-After` header."

**Assessment**: Reasonable. 2.8 req/s leaves headroom on the 3 req/s average limit. Concurrent requests are fine within the burst window — the SDK's built-in retry handles 429s.

**Note**: The token-bucket at 2.8 req/s is conservative and appropriate. It does not account for the fact that Notion's 429 responses indicate you've exceeded the average — a burst above 2.8 won't trigger a 429 unless you're sustained above 3 req/s. The recommendation is sound for sustained-rate protection.

---

## Summary of Corrections

| # | Area | Severity | Current doc | Correction |
|---|---|---|---|---|
| 1 | Retry-After semantics | **Medium** | "Wait indicated time, then retry without exponential backoff" | "Retry-After is a floor; SDK uses exponential backoff on top of it" |
| 2 | SDK retry description | Low | "built-in retry with Retry-After handling" | Add: "Uses exponential backoff with jitter, retries up to 2 times by default" |

No other corrections needed. Rate limit numbers, pagination model, bulk endpoint absence, and error handling are all accurately characterized.

---

## Low-Risk Items (Not Flagged as Errors)

- **Pagination under concurrent writes**: Notion's cursor pagination is stable within a session but no guarantee of consistency under concurrent source writes. For reconciliation, prefer `last_edited_time` sort + filter rather than cursor traversal, which the doc already recommends in Section 3 (polling fallback).
- **`page_size` may return fewer than requested**: Already consistent with doc ("100 items per page" — stated as max, not guaranteed).
- **No per-endpoint rate limits documented**: Notion has a single global limit (3 req/s average). No per-endpoint or per-method differentiation. The doc is correct in using a single limit.
- **Rate limits may vary by pricing plan**: Official docs note "Rate limits may change in the future, with potential distinct limits for different pricing plans." Not reflected in doc; worth adding a caveat.