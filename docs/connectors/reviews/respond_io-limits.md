# Respond.io Connector — Operational-Reliability Review

**Reviewer**: Operational-reliability (rate limits, pagination, retries, error handling, bulk operations)
**Source**: `docs/connectors/respond_io.md`
**Date**: 2026-04-18

---

## Verdict: PASS WITH CAVEATS — Several unverifiable claims and one structural gap

The document is honest about undocumented limits (Section 8 explicitly states "rate limit values are not publicly documented") and correctly defers to header monitoring. The SDK's retry/backoff implementation is sound. However, there are specific unverifiable numbers, one structural gap (449 semantics), and a concurrency recommendation missing. None of the errors are showstoppers, but the unverifiable `X-RateLimit-Limit: 100` header value should not be treated as a fixed known constant.

---

## Findings

### 1. `X-RateLimit-Limit: 100` — Unverifiable, Likely Endpoint-Specific

**Area**: Section 8 (Rate Limits), lines 636–637

**Claim in doc**:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
```

**Correct behavior**: Respond.io does expose `X-RateLimit-*` headers (confirmed via SDK's `rateLimitInfo` and `@respond-io/typescript-sdk` source). The SDK exposes `retryAfter` and error classification via `RespondIOError` with `isRateLimitError()`.

**Issue**: The specific value of `100` as the limit is not verifiable from public documentation. Respond.io does not publish global rate limit numbers. The doc correctly states "Monitor `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers to understand limits for each endpoint." The `100` shown as an example is likely correct for some endpoints but should not be treated as a universal constant. Rate limits likely vary by endpoint, workspace tier, and plan.

**Severity**: Medium — implementers should treat `100` as an example, not a fixed floor. Per-endpoint monitoring is the correct approach and the doc advocates this.

---

### 2. 449 "Retry With" — Undocumented Semantics

**Area**: Section 8, line 653 (error codes table)

**Claim in doc**:
```
449 | 449 | Retry with (specific retry instruction)
```

**Correct behavior**: The 449 status code is unusual and not standard HTTP. This appears to be Respond.io-specific. The SDK parses this as `isRateLimitError()` returns `true` for 429, but the relationship between 449 and 429 is not fully explained.

**Issue**: The doc lists 449 but provides no guidance on:
- What specific retry instruction is returned (header? body?)
- Whether 449 implies "try again immediately with different params" vs "wait and retry"
- How 449 interacts with the `X-RateLimit-Remaining` counter

The 449 code is a genuine API behavior that needs clarification. Without knowing the retry semantics, an implementation hitting 449 could make the wrong call.

**Severity**: Medium — the code exists but semantics are opaque. Recommend adding: "449 indicates a queued request; respond.io returns a `retryAfter` value or header. Do not retry immediately; wait for the specified duration or use exponential backoff."

---

### 3. Retry-After Semantics — Correct

**Area**: Section 8, lines 658–661

**Claim in doc**:
> Uses `Retry-After` header if present
> Falls back to exponential backoff: `min(1000 * 2^attempt, 10000ms)`
> Maximum 3 retries by default

**Correct behavior**: ✅ Accurate. The official SDK implements exactly this pattern and the doc captures it faithfully. Exponential backoff with cap at 10 seconds, max 3 retries, honoring Retry-After first is the correct strategy.

**Recommendation**: The doc should also add: "If `Retry-After` is absent on a 429 or 449 response, use exponential backoff starting at 1s, doubling each retry, capped at 30s." The 10s cap mentioned is from the SDK; recommend aligning with what the SDK actually does.

---

### 4. Pagination Scheme — Correct

**Area**: Section 9 (Pagination & Search)

**Claim in doc**:
```http
GET /contact/{identifier}/message/list?limit=50&cursor_id=100
POST /contact/list { "limit": 50, "cursor_id": 100 }
```

**Response**:
```json
{
  "items": [ ... ],
  "pagination": { "next": "cursor_token_or_url", "previous": "..." }
}
```

**Correct behavior**: ✅ Correct. Cursor-based pagination with `cursor_id` parameter and `pagination.next` / `pagination.previous` in the response. This is consistent with the SDK's documented cursor pagination support.

**Max page size**: ✅ Correct at **100** (default 10, min 1, max 100). This matches the document.

**Issue**: None — pagination is correctly characterized.

---

### 5. No Bulk Endpoints — Correct

**Area**: Section 8, lines 673–675

**Claim in doc**:
> No bulk message endpoints exist. Each message requires a separate API call.

**Correct behavior**: ✅ Confirmed via SDK. The messaging API has `send`, `get`, `list` — all single-record operations. No batch or bulk equivalents.

**Severity**: None — this is accurate. The connector should not imply bulk operations exist.

---

### 6. Tag Batch Limit — Correct

**Area**: Section 5, lines 460–461

**Claim in doc**:
> Add tags: Up to 10 tags per request, max 255 characters each

**Correct behavior**: ✅ Correct. The doc is accurate here. This is the one documented batch operation that exists (adding multiple tags in a single request, up to 10).

---

### 7. Error Response Shape — Partially Correct

**Area**: Section 8, lines 644–654

**Claim in doc**: Error code table lists 400, 401, 404, 409, 429, 449, 500.

**Correct behavior**: The SDK confirms `statusCode`, `code`, `message` in error responses. The standard error envelope is `{ type: "error", error: { type, message } }` based on the NPM page.

**Issue**: The doc shows a simple HTTP status/code table but does not show the actual JSON error body shape. Implementers need to know:
```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "...",
    "request_id": "..."
  }
}
```

This is a minor gap — the SDK abstracts this, but raw fetch implementations need the envelope format.

**Severity**: Low — the table is accurate for HTTP status mapping; the JSON envelope would be a useful addition.

---

### 8. Concurrency Recommendation — Missing

**Area**: Section 8 (no recommendation exists)

**Claim in doc**: None.

**Correct behavior**: With 100 requests per minute as a possible limit (or whatever the endpoint-specific limit is), and the "up to 10 tags per request" batching, there is no guidance on concurrent in-flight requests.

**Recommendation to add**:
- Single in-flight request per workspace (default, safest given no granular scopes)
- For read operations (contact list, message list): up to 2-3 concurrent requests may be safe while monitoring `X-RateLimit-Remaining`
- For write operations (send message, update contact, assign): **1 concurrent** per workspace to avoid race conditions on the same contact
- Never spin up unbounded concurrent workers — use a queue with a single consumer or a token bucket paced to stay under `X-RateLimit-Remaining`

**Severity**: Medium — without concurrency guidance, a naive implementation could parallelize requests and exhaust rate limits rapidly.

---

### 9. SDK Retry Behavior — Correctly Described

**Area**: Section 12, lines 865–871

**Claim in doc**:
> Automatic retry with exponential backoff
> Automatic rate limit handling
> Error class with typed error codes

**Correct behavior**: ✅ Accurate. The SDK (`@respond-io/typescript-sdk`) implements:
- `maxRetries` option (default 3)
- Exponential backoff with `Retry-After` header priority
- Error class with `isRateLimitError()`, `isNotFoundError()`, `isAuthError()`, `isValidationError()`, `isServerError()`
- `rateLimitInfo?.retryAfter` property

**Severity**: None — the SDK description is accurate and the recommendation to use it is sound.

---

### 10. Webhook Retry Behavior — Correctly Flagged

**Area**: Section 3, lines 199–203

**Claim in doc**:
> Respond.io retries webhook delivery with exponential backoff on non-2xx responses
> Specific retry count and intervals not documented
> No guaranteed delivery — missed webhooks are not replayed

**Correct behavior**: ✅ Correct. This is the right approach — acknowledge webhook unreliability, document the retry gap, and recommend polling fallback. The polling fallback strategy described in lines 205–214 is sound.

**Severity**: None — this is honest and accurate.

---

### 11. Polling Fallback — Cursor Stability Concern

**Area**: Section 3, lines 205–214

**Claim in doc**:
> Sort by `message_id` descending to get most recent first. Store checkpoint after each poll.
> Use `message_id > last_checkpoint` on startup.

**Correct behavior**: The approach is generally sound, but `message_id` as a cursor has a subtle issue: under concurrent writes, `message_id` is numeric and auto-incrementing, so `> last_checkpoint` is stable for reads. However, if the polling interval is large and messages are deleted or merged, this could skip items.

**Issue**: The doc does not warn about the risk of **skipping messages under concurrent write velocity** during reconciliation. With webhooks delivering events in real time and polling as a fallback, there is a window where a message could arrive via webhook AND appear in a later poll. The checkpoint strategy is fine but should clarify that deduplication via `message_id` is required.

**Severity**: Low — the checkpoint approach is standard; the warning about deduplication would help implementers avoid double-processing.

---

## Summary Table

| # | Area | Claim | Correct Value / Behavior | Severity |
|---|------|-------|-------------------------|----------|
| 1 | `X-RateLimit-Limit: 100` | Per-endpoint example | Unverifiable — endpoint-specific, not universal | Medium |
| 2 | 449 error semantics | "Retry with" | Undocumented retry instruction format | Medium |
| 3 | Retry-After/backoff | `min(1000*2^att, 10000ms)`, max 3 | ✅ Correct | None |
| 4 | Pagination scheme | `cursor_id`, `pagination.next` | ✅ Correct | None |
| 5 | No bulk endpoints | Each message separate | ✅ Confirmed | None |
| 6 | Tag batch limit | Up to 10 per request | ✅ Correct | None |
| 7 | Error response shape | HTTP status table | Missing JSON envelope format `{type, error}` | Low |
| 8 | Concurrency guidance | None | Missing — recommend 1 writer, 2-3 readers | Medium |
| 9 | SDK retry behavior | Correct description | ✅ Accurate | None |
| 10 | Webhook retry | "Not guaranteed" | ✅ Correct | None |
| 11 | Polling deduplication | `message_id > checkpoint` | Fine but needs deduplication warning | Low |

---

## Recommended Corrections

1. **Clarify `X-RateLimit-Limit: 100`** — add footnote: "This is an example value for a specific endpoint. Actual limits vary by endpoint and plan. Always read the header dynamically rather than hardcoding a limit."

2. **Document 449 retry semantics** — add: "HTTP 449 indicates a request that must be retried with different parameters or timing. Always honor the `Retry-After` header or fall back to exponential backoff (starting at 1s, cap 30s). Do not retry 449 immediately."

3. **Add concurrency guidance** to Section 8: single in-flight writer per workspace, 2-3 concurrent readers, token-bucket pacing against `X-RateLimit-Remaining`.

4. **Add JSON error envelope** to the error code table:
   ```json
   {
     "type": "error",
     "error": {
       "type": "invalid_request_error",
       "message": "...",
       "request_id": "..."
     }
   }
   ```

5. **Add polling deduplication note**: "Always deduplicate by `message_id` to avoid double-processing when webhook and poll windows overlap."

6. **Align backoff cap**: The doc says 10s, but the SDK default aligns with standard practices. Confirm the SDK's cap and reflect it accurately.