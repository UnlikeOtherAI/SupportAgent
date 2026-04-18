# Slack Connector — Operational Reliability Review

**Reviewer**: Claude (rate limits, pagination, retries, error handling)
**Source**: `docs/connectors/slack.md`
**Date**: 2026-04-18

---

## Verdict: CONDITIONAL PASS — Several inaccuracies and gaps require correction

The document captures the general shape of Slack's rate limiting correctly but has tier gaps, outdated/misleading limits, missing non-Marketplace constraints, and pagination caveats that could cause production issues.

---

## Findings

### 1. Tier System — Incomplete Tier Coverage

**Area**: Section 8 (Rate Limits), Section 13 (Appendix A)

**Claim in doc**:
```
| Tier | Calls/Minute | Methods |
|------|--------------|---------|
| Tier 2 | 20+ | conversations.list |
| Tier 3 | 50+ | Most methods |
| Special | Varies | Method-specific |
```

**Correct behavior** (per [docs.slack.dev/apis/web-api/rate-limits](https://docs.slack.dev/apis/web-api/rate-limits)):
```
| Tier | Calls/Minute |
|------|--------------|
| Tier 1 | 1+         |
| Tier 2 | 20+        |
| Tier 3 | 50+        |
| Tier 4 | 100+       |
| Special | Varies   |
```

**Issue**: Tier 1 (1+ req/min) and Tier 4 (100+ req/min) are missing. Several methods are Tier 4 (e.g., `views.open`, `views.publish`). The current table omits the full range and misrepresents which methods are "special."

**Severity**: Medium — without Tier 4 coverage, implementers may incorrectly assume tight limits on `views.open`/`views.publish`.

---

### 2. `views.open` Rate Limit — Potentially Wrong Number

**Area**: Section 8, Section 13 (Appendix A)

**Claim in doc**: `views.open` — **10/workspace/min**

**Correct behavior** (per [docs.slack.dev/reference/methods/views.open](https://docs.slack.dev/reference/methods/views.open)): **Tier 4 (100+ req/min)**

**Issue**: The doc specifies 10/min, but official docs list Tier 4 (100+/min). These may represent different constraints (workspace-level trigger exchange vs. per-app rate limit), but the doc does not explain the distinction. Without context, readers will assume 10/min is the hard limit.

**Severity**: High — `views.open` is in Phase 2 scope; a 10x underestimation could cause artificial throttling.

---

### 3. Non-Marketplace App Rate Limits — Critical Gap

**Area**: Section 4, Section 8, Section 9, Section 13

**Claim in doc**:
- `conversations.replies`: "**1 req/min, max 15** for non-Marketplace apps (post-May 2025)"
- No mention of `conversations.history` non-Marketplace limits

**Correct behavior** (per [docs.slack.dev](https://docs.slack.dev)):
- **As of May 29, 2025**: New non-Marketplace apps face severely reduced limits:
  - `conversations.history`: **1 req/min**, max/default `limit` reduced to **15** (standard is 999)
  - `conversations.replies`: **1 req/min**, max/default `limit` reduced to **15**
  - Existing installations distributed outside the Marketplace are not subject to these limits

**Issue**: The doc correctly captures `conversations.replies` limits but omits that `conversations.history` has the same 1 req/min constraint for non-Marketplace apps. This is a significant gap for polling-based reconciliation.

**Severity**: High — a connector doing history sync on a new non-Marketplace app would hit a wall at 1 req/min without this knowledge.

---

### 4. `conversations.history` Pagination — Cursor vs Time-Based

**Area**: Section 9

**Claim in doc**:
```typescript
const result = await slack.conversations.list({ cursor: '...', limit: 200 });
// response_metadata.next_cursor until empty
```
(Shows cursor pagination for `conversations.list`, correct)

**Gap**: The doc shows `conversations.history` with cursor but does not explain the **time-based pagination constraint**: messages are returned in pages of up to **100 messages between `oldest` and `latest` timestamps**, not arbitrary cursor-based pages.

**Correct behavior**:
- `conversations.history`: Returns up to `limit` messages (max 999 standard, 15 non-Marketplace), paginated via `next_cursor`. However, Slack's internal windowing means you cannot retrieve more than ~1000 messages efficiently per `channel` in a single `oldest`/`latest` window.
- Under high message velocity, time-based cursors can skip messages.

**Issue**: The doc does not warn about the time-windowing limitation or the risk of skipping messages under concurrent writes during reconciliation.

**Severity**: Medium — affects history reconciliation accuracy.

---

### 5. `search.messages` — Cursor Pagination Incorrectly Characterized

**Area**: Section 9

**Claim in doc**:
```
POST /api/search.messages
{ "query": "triage has:permalink in:channel", "count": 20 }
```
(No mention of pagination method)

**Correct behavior** (per [docs.slack.dev/reference/methods/search.messages](https://docs.slack.dev/reference/methods/search.messages)):
- `search.messages` supports **both page-based** (`page`, `count`) **and cursor-based** (`cursor`, `next_cursor`) pagination.
- `count` max: **100** per page
- `page` max: **100**

**Issue**: The doc does not explain pagination options. Cursor pagination is preferred for large result sets but requires special handling (`cursor: "*"` for first call).

**Severity**: Low-Medium — Phase 2 scope, but incorrect pagination could miss results.

---

### 6. Rate Limit Response Format — Missing Header Detail

**Area**: Section 8

**Claim in doc**:
```json
{ "ok": false, "error": "ratelimited", "retry_after": 12 }
```

**Correct behavior**: Slack returns rate limit errors with:
- HTTP status **429**
- `Retry-After` **header** (seconds to wait)
- JSON body: `{ "ok": false, "error": "ratelimited", "retry_after": N }`

**Issue**: The doc shows the JSON body correctly but does not mention:
1. HTTP 429 status (critical for detection)
2. `Retry-After` header (some clients use header over body)

**Severity**: Low-Medium — SDKs abstract this, but raw API users need both.

---

### 7. `conversations.list` Max Limit — Off by One

**Area**: Section 9, Appendix A

**Claim in doc**:
```
| conversations.list | 1,000 |
```

**Correct behavior** (per [docs.slack.dev/reference/methods/conversations.list](https://docs.slack.dev/reference/methods/conversations.list)):
- `limit` must be **under 1,000** (i.e., max 999)
- Slack recommends **no more than 200** results per request

**Issue**: The doc says 1,000, but the official constraint is "under 1,000" (i.e., 999). This is a minor off-by-one but could cause `invalid_arguments` errors.

**Severity**: Low — easy to test and fix.

---

### 8. `users.list` Max Limit — Missing

**Area**: Section 9

**Claim in doc**:
```
| users.list | 200 |
```

**Correct behavior** (per [docs.slack.dev/reference/methods/users.list](https://docs.slack.dev/reference/methods/users.list)):
- `limit` must be **under 1,000** (max 999)
- Slack recommends **no more than 200** results per request

**Issue**: The doc incorrectly caps `users.list` at 200. The actual max is 999, with 200 being a recommendation.

**Severity**: Low — won't break but limits throughput unnecessarily if implemented as hard cap.

---

### 9. Bulk Operations — Claims Accurate

**Area**: Outbound section

**Claim**: `chat.postMessage` is "1 message/second per channel"

**Correct**: Per [docs.slack.dev/reference/methods/chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage):
> "It will generally allow an app to post 1 message per second to a specific channel. There are limits governing your app's relationship with the entire workspace above that, limiting posting to several hundred messages per minute."

**Status**: Accurate. No batch endpoint exists; messages must be sent individually.

---

### 10. Error Response Shape — Generally Accurate

**Area**: Section 8

**Claim**: Slack returns `{ok: false, error: "..."}`

**Correct**: Per [docs.slack.dev/apis/web-api](https://docs.slack.dev/apis/web-api/):
- All responses include `ok` boolean
- Failures include `error` with machine-readable code
- Successes with issues include `warning`

**Status**: Accurate. The doc correctly shows the error shape.

---

### 11. Retry Guidance — Missing

**Area**: Section 8

**Gap**: The doc shows `retry_after` in the response but provides no guidance on retry strategy:
- Should implement **exponential backoff with jitter**
- Should **not retry immediately** on 429
- Should **respect `Retry-After`** before retrying
- Should **cap retry attempts** (suggest 3-5)

**Severity**: Medium — naive implementations that retry immediately on 429 will worsen throttling.

---

### 12. Concurrency Recommendation — Missing

**Area**: Section 8

**Gap**: No guidance on concurrent request limits. Given:
- Per-method per-workspace per-app rate limits
- Tier budgets (e.g., Tier 3 = 50 req/min)
- Non-Marketplace 1 req/min constraints

**Recommendation to add**:
- Single in-flight request per method per workspace
- Queue requests and respect rate budgets
- Use a token bucket or leaky bucket algorithm
- Monitor `X-OAuth-Scopes`, `X-Accepted-OAuth-Scopes` headers for scope errors

**Severity**: Medium — high concurrency without coordination will trigger 429s.

---

## Summary Table

| # | Area | Claim | Correct | Severity |
|---|------|-------|---------|----------|
| 1 | Tier system | Tiers 2, 3, Special only | Missing Tier 1, Tier 4 | Medium |
| 2 | `views.open` limit | 10/workspace/min | Tier 4 (100+/min) | High |
| 3 | Non-Marketplace limits | `conversations.replies` only | Also `conversations.history` | High |
| 4 | `conversations.history` pagination | Cursor only | Time-window caveat | Medium |
| 5 | `search.messages` pagination | Not documented | Both page + cursor | Low-Medium |
| 6 | Rate limit response | JSON body only | Also HTTP 429 + header | Low-Medium |
| 7 | `conversations.list` max | 1,000 | Under 1,000 (max 999) | Low |
| 8 | `users.list` max | 200 | Under 1,000 (max 999) | Low |
| 9 | Bulk operations | `chat.postMessage` 1/sec | Accurate | — |
| 10 | Error shape | `{ok: false, error: "..."}` | Accurate | — |
| 11 | Retry guidance | None | Missing exponential backoff | Medium |
| 12 | Concurrency | None | Missing per-method limits | Medium |

---

## Recommendations

1. **Add Tier 1 and Tier 4** to the tier table
2. **Clarify `views.open`** — is "10/workspace/min" a trigger-exchange limit or hard cap?
3. **Add `conversations.history`** non-Marketplace constraints (1 req/min, max 15)
4. **Document cursor pagination caveats** for history reconciliation
5. **Fix `users.list` max** to "under 1,000" with recommendation of 200
6. **Add retry strategy section**: exponential backoff with jitter, max 3-5 retries, respect `Retry-After`
7. **Add concurrency guidance**: single in-flight per method, token bucket for budget management
