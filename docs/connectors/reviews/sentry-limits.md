# Sentry Connector — Operational Reliability Review

**Reviewer**: Claude Opus 4.7
**Date**: 2026-04-18
**Source**: [`docs/connectors/sentry.md`](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md)
**Verification sources**: [Sentry API Rate Limits (develop.sentry.dev)](https://develop.sentry.dev/api/rate-limits/), [Sentry API Pagination (develop.sentry.dev)](https://develop.sentry.dev/api/pagination/), [Sentry Webhooks (docs.sentry.io)](https://docs.sentry.io/organization/integrations/integration-platform/webhooks.md)

---

## Verdict: Issues Found — Significant

The document has material inaccuracies in rate-limit numbers, cursor format, and plan-tier model. Several claims are undocumented or unverifiable from current official sources. The core structure (headers, pagination style, webhook retry) is broadly correct but needs targeted corrections.

---

## Finding 1 — Rate-Limit Numbers Are Undocumented and Likely Incorrect

**Area**: §8 Rate Limits
**Claim**: The document provides a table of specific numeric limits per endpoint:
- Issues (GET list): 1000/min
- Issues (POST/PUT): 100/min
- Events (GET): 500/min
- Comments (POST): 60/min
- Comments (PUT/DELETE): 30/min
- Projects (GET): 100/min

**Correct behavior**: The official Sentry API rate limits documentation explicitly states:

> "Specific numeric limits (e.g., requests per minute) aren't provided in this documentation."

The rate limiter uses "a fixed time window approach — requests are counted into time buckets, determined by the window size. Each endpoint has its own maximum requests and window size." The exact numbers are undocumented and **vary by plan and endpoint**. The numbers in the table are not sourced and may be stale, plan-specific, or derived from third-party observations.

**Severity**: High. Connector code that relies on these specific numbers to set concurrency budgets will be either overly conservative (missing throughput) or too aggressive (hitting unexpected 429s). The document should remove these numbers entirely and instead say: "Sentry does not publish exact per-endpoint limits. Use the response headers to self-throttle."

**Recommendation**: Delete the numeric rate-limit table from §8. Replace with guidance that the connector must read `X-Sentry-Rate-Limit-Remaining` and `X-Sentry-Rate-Limit-Reset` from every response and implement adaptive throttling. Add a conservative default of e.g., 1 req/s per token as a starting point, noting it will be adjusted per-tenant based on observed headers.

---

## Finding 2 — Rate-Limit Identity: Token vs. Caller

**Area**: §8, line 553
**Claim**: "Sentry rate limits by token identity, not by endpoint."
**Correct behavior**: The official docs state:

> "The rate limiter looks at the caller's identity instead of the bearer token or cookie."

This means a user with two tokens shares one rate-limit budget. The implication in the doc (isolating by token doesn't help) is **correct**, but the framing is slightly off. The rate limit is per-authenticated-caller identity, not per-token. If a user has multiple tokens, they all share the same budget.

**Severity**: Low (implication is right, phrasing is imprecise).

---

## Finding 3 — Cursor Format Is Incorrect

**Area**: §9 Pagination, line 183 and line 564
**Claim**: Cursor format is `{timestamp},{shard},{shardIndex}` / `{timestamp},{shard},{shardNumber}`
**Correct behavior**: The official Sentry pagination docs state:

> "The three values from cursor are: cursor identifier (integer, usually 0), row offset, and is_prev (1 or 0)."

The cursor is an opaque string from the `Link` header. It is **not** a `{timestamp},{shard},{shardIndex}` format — that appears to be stale information from an older Sentry API version or a mischaracterization. The cursor format is not guaranteed to be human-readable and should be treated as opaque.

**Severity**: Medium. Connector code that parses cursors will break. The document should state: "Cursors are opaque strings. Pass the full cursor value from the `Link` header directly as the `cursor` query parameter. Do not attempt to construct or parse cursors."

---

## Finding 4 — Plan Tier Model Is Stale

**Area**: §8, lines 545–549
**Claim**: Sentry has plan tiers Developer (50k events/mo, limited API rate), Team (500k), Business (5M), Enterprise (negotiated)
**Correct behavior**: Sentry's current (2026) pricing model is based on **reserved volume** (errors, logs, spans, replays, monitors) with PAYG billing on top. The old Developer/Team/Business/Enterprise tier naming with fixed event counts does not match the current pricing page. The API rate limits are not directly tied to these volume plans — rate limits are a function of the API infrastructure, not billing volume.

**Severity**: Medium. While the intent (higher plans = higher rate limits) is plausible, the specific tier names and event counts are not verified against current pricing. This section should either be removed or reworded to say: "Rate limits scale with plan tier. The exact mapping is not publicly documented — monitor `X-Sentry-Rate-Limit-*` headers and back off accordingly."

---

## Finding 5 — Webhook Timeout Not Documented

**Area**: Missing from §3a
**Claim**: (No mention of timeout)
**Correct behavior**: The official Sentry webhook documentation states:

> "Webhooks should respond within 1 second. Otherwise, the response is considered a timeout."

Sentry will mark a webhook delivery as failed if the endpoint doesn't respond within 1 second. This is critical for the webhook endpoint implementation — SupportAgent must acknowledge quickly and process asynchronously.

**Severity**: Medium. A webhook handler that does synchronous processing (e.g., fetching issue details before returning) will consistently time out and cause Sentry to mark deliveries as failed.

---

## Finding 6 — Retry-After Header: Claimed But Not Verified

**Area**: §8, line 551
**Claim**: "Sentry does include [Retry-After] on 429"
**Correct behavior**: The official rate-limits page does not document the presence of a `Retry-After` header on 429 responses. The header may be present, but it is not officially guaranteed. The safe fallback (exponential backoff) is correct regardless, but the claim should be softened to: "Sentry may include a `Retry-After` header. If absent, fall back to exponential backoff starting at 1s."

**Severity**: Low (fallback behavior is correct, claim is unverified).

---

## Finding 7 — Bulk/Batch Endpoint Claimed But Not Verified

**Area**: §11 Phase 2, line 713 and §11 bullet list
**Claim**: `PUT /api/0/organizations/{org}/issues/` supports bulk issue operations (batch)
**Correct behavior**: I could not verify from the official API reference that this endpoint supports batch operations (updating multiple issues in one request). The standard Sentry issue update endpoint is for single-issue updates. If batch operations exist, they are not prominently documented.

**Severity**: Medium. If the endpoint doesn't support batching, Phase 2 planning should not reference it. Either verify this endpoint supports a comma-separated list of issue IDs or remove the batch claim.

---

## Finding 8 — Webhook Retry Sequence: Stale or Unverified

**Area**: §3a, line 112
**Claim**: "Sentry retries with exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s (up to 6 retries)"
**Correct behavior**: I could not verify this from current official documentation. The Integration Platform webhook docs page returned 404 for the retry section. The retry sequence (1-2-4-8-16-32s, 6 retries) may be from older Sentry docs or third-party observation. This is plausible behavior but not confirmed.

**Severity**: Low. The behavior is plausible and the claim is reasonable, but it should be sourced or marked as "based on observed behavior, not documented."

---

## Finding 9 — Pagination: Link Header and Max Page Size Are Correct

**Area**: §9 Pagination
**Claim**: Link header (RFC 5988) with `rel="next"/"previous"` and `results="true/false"`, max `limit` of 100 on most endpoints.
**Verification**: Confirmed correct from [develop.sentry.dev/api/pagination](https://develop.sentry.dev/api/pagination/). The `results` indicator, default page size of 100, and Link header format are all accurate.

**Severity**: None. This is correct.

---

## Finding 10 — Rate-Limit Headers Are Correct

**Area**: §8
**Claim**: `X-Sentry-Rate-Limit-Limit`, `X-Sentry-Rate-Limit-Remaining`, `X-Sentry-Rate-Limit-Reset`, `X-Sentry-Rate-Limit-ConcurrentLimit`, `X-Sentry-Rate-Limit-ConcurrentRemaining`.
**Verification**: Confirmed correct from [develop.sentry.dev/api/rate-limits](https://develop.sentry.dev/api/rate-limits/). All five headers are accurately described.

**Severity**: None. Correct.

---

## Finding 11 — Self-Hosted Rate Limit Enforcement

**Area**: §10a, line 615
**Claim**: "Self-hosted has no built-in rate limit enforcement in some versions"
**Verification**: Not confirmed from current official docs (self-hosted vs. cloud parity is not documented in the rate-limits page). This is plausible — Sentry's self-hosted uses the same API code but allows operators to configure or disable rate limiting. Worth flagging as "unverified" but reasonable.

**Severity**: Low. Keep the note but mark as "unverified from current docs."

---

## Summary of Required Changes

| # | Severity | Area | Fix |
|---|---|---|---|
| 1 | High | §8 Rate limit table | Delete the numeric table. Use headers + adaptive throttling guidance. |
| 2 | Low | §8 "token identity" phrasing | Clarify: per caller identity, not per token. |
| 3 | Medium | §9 cursor format | State cursors are opaque. Remove the `{timestamp},{shard}` format claim. |
| 4 | Medium | §8 plan tiers | Update to reflect current Sentry pricing model or remove specific tier names. |
| 5 | Medium | §3a webhook timeout | Add webhook timeout of 1 second. Acknowledge fast, process async. |
| 6 | Low | §8 Retry-After claim | Soften: "Sentry may include Retry-After." |
| 7 | Medium | §11 Phase 2 batch | Verify or remove the batch endpoint claim. |
| 8 | Low | §3a retry sequence | Mark as "observed" rather than documented. |
| 9 | — | Pagination headers/max page | No change needed. Correct. |
| 10 | — | Rate limit headers | No change needed. Correct. |

---

## Recommendations

1. **Remove all undocumented numeric rate limits** from §8. The connector must be header-driven.
2. **Treat cursors as opaque** — no parsing, no construction.
3. **Add webhook timeout handling**: acknowledge within 1s, defer processing.
4. **Update plan-tier section** to reflect current Sentry pricing (reserved volume model).
5. **Verify the batch issue endpoint** before committing to it in Phase 2.
6. **Add concurrency guidance**: given Sentry's concurrent rate limit, cap in-flight requests at a conservative level (e.g., 5 concurrent) until the `ConcurrentRemaining` header indicates headroom.
