# Zendesk Connector — Rate Limits & Operational Reliability Review

**Reviewer**: Operational Reliability (rate limits, pagination, retries, bulk ops)
**Source**: `docs/connectors/zendesk.md` (last updated 2026-04-18)
**Verification**: Zendesk developer documentation (developer.zendesk.com/api-reference)

---

## Verdict: **Issues Found** — 4 findings, 1 critical

---

## Finding 1 — [CRITICAL] Incremental Export Rate Limits Incorrect

**Area**: Rate Limits — Incremental Export API

**Claim in doc** (Section 8, Table "Other API-Specific Limits"):
> Incremental User Export | 20 req/min (standard), 60 req/min (high-volume)

**Correct value** (Rate Limits page):
> Base limit: **10 requests per minute**
> With High Volume add-on: **30 requests per minute**

**Impact**: If SupportAgent polls the incremental tickets or ticket_events export endpoint at 20 req/min, it will hit 429s on a standard plan. At 60 req/min (doc value for high-volume), it would hit 429s even with the high-volume add-on.

**Fix**: Correct the table to:
| Endpoint | Limit |
|----------|-------|
| Incremental User Export (base) | 10 req/min |
| Incremental User Export (High Volume add-on) | 30 req/min |

Note: The doc also mentions "Incremental User Export" but the primary sync endpoints are `/incremental/tickets/cursor` and `/incremental/ticket_events/cursor`. The same limits likely apply; verify and document separately if they differ.

---

## Finding 2 — [MEDIUM] Missing Endpoint-Specific Write Limits

**Area**: Rate Limits — undocumented constraints

**Claim in doc**: Section 8 covers plan-level req/min limits and the job queue concurrency (30 inflight). No endpoint-specific write limits are mentioned.

**Correct behavior** (Rate Limits page):
- **Update Ticket**: 30 updates per 10 minutes per user per ticket
- **Update User**: 5 requests per minute per user
- **Execute Views**: 5 requests per minute per view per agent
- **Export Search Results**: 100 requests per minute per account

**Impact**:
- A workflow that rapidly changes the same ticket's status (e.g., during triage automation) will hit the 30/10min per-user-per-ticket limit. This is a write limit, not a read limit.
- The "Update User" limit is low — if SupportAgent resolves user identity and then updates user fields, 5 req/min per user is easy to exceed.
- The "Execute Views" limit applies if Phase 2 wraps the Views API.

**Fix**: Add an "Endpoint-Specific Write Limits" subsection to Section 8:

```
### Endpoint-Specific Write Limits

| Operation | Limit |
|-----------|-------|
| Update Ticket (same ticket, same user) | 30 per 10 minutes |
| Update User | 5 req/min per user |
| Execute Views | 5 req/min per view per agent |
| Export Search Results | 100 req/min per account |
```

---

## Finding 3 — [LOW] Header Name Discrepancy

**Area**: Rate Limits — response header naming

**Claim in doc** (Section 8, "Response Headers"):
```http
X-Rate-Limit: 400
X-Rate-Limit-Remaining: 387
```

**Correct value** (Rate Limits page):
```http
x-rate-limit: 700
```

**Issue**: The documented header `X-Rate-Limit-Remaining` is not confirmed in the official rate limits page. The official doc only shows `x-rate-limit`. The `X-Rate-Limit-Remaining` header may exist on some endpoints but is not documented as a standard header. `Retry-After` is correctly documented.

**Fix**: Change the example to:
```http
x-rate-limit: 700
```
And note that `Retry-After` appears on 429 responses. The `X-Rate-Limit-Remaining` header (if present) indicates remaining budget in the current window. Verify actual header presence before documenting.

---

## Finding 4 — [INFO] Bulk Endpoints Correctly Characterized; One Fake Endpoint Flagged

**Area**: Bulk/Batch Operations

**Claim in doc** (Section 8, "Bulk/Batch Endpoints"):
> Side-loading: `GET /api/v2/tickets.json?include=users,organizations` fetches related records in same request
> No true batch mutation endpoint; must send individual requests

**Correct**: Both statements are accurate. Side-loading is a read-time optimization, not a batch write mechanism. Zendesk has no bulk create/update endpoint equivalent to GitHub's `POST /markdown` or Linear's batch mutations.

**Claim in doc** (Phase 2, additional endpoints):
```http
PUT /api/v2/tickets/{id}/tags.json  # (no such endpoint; implement tag merge)
```

**Note**: The doc itself flags this as "(no such endpoint)". Good. This is not a bug — it's a correctly self-noted gotcha. Keep it flagged as such.

---

## Findings Not Applicable

The following were scoped out but noted for completeness:

- **Auth details**: Skipped per review scope.
- **Webhook content**: Skipped per review scope.
- **Endpoint CRUD**: Skipped per review scope.

---

## Additional Verified Correct Claims

| Claim | Status |
|-------|--------|
| Plan rate limits: Essential 10, Team 200, Pro 400, Enterprise 700, High Vol 2,500 req/min | **Correct** |
| Job queue concurrency: max 30 inflight jobs | **Correct** (matches `zendesk-ratelimit-inflight-jobs: total=30`) |
| Retry-After on 429 | **Correct** — seconds-based, apply wait before retry |
| Exponential backoff for transient overload | **Correct recommendation** |
| Cursor pagination: max 100 items, no depth limit | **Correct** |
| Offset pagination: max 100 per page, hard cap 10,000 records / 100 pages | **Correct** |
| Optimistic locking: 409 Conflict introduced May 15, 2025 | **Correct** (confirmed via changelog) |
| Tag replace semantics (no add/remove endpoint) | **Correct** |
| No self-retrigger: compare `comment.author_id` to bot user ID | **Correct** |
| Webhook at-least-once delivery, no ordering guarantee | **Correct** |

---

## Recommended Connector Concurrency Guidance

Current guidance (Section 10, "Rate Limit Burst Handling"):
> Rate limits are per-minute windows. Distribute requests evenly; burst at end of window causes 429s.

This is correct. Additional guidance for the connector implementation:

1. **Stick to ~80% of plan limit** to avoid hitting 429s during spikes. For Enterprise (700 req/min): target ~560 concurrent requests spread over the window.
2. **Do not retry immediately on 429** — read `Retry-After`, wait the specified seconds, then retry with backoff (base 1s, max 60s, up to 3 retries).
3. **Respect job queue limit (30 inflight)** for any async operations (e.g., bulk status updates queued as jobs). Check `zendesk-ratelimit-inflight-jobs` header on job submission responses.
4. **Monitor 409s** for ticket update conflicts — the May 2025 optimistic locking means concurrent writes return 409, not 200. Implement fetch-fresh-then-retry for 409s, with a max of 2 retries.
5. **Polling cadence**: 30-60 seconds for incremental exports is appropriate given the 10 req/min base limit. At 10 req/min, you can safely poll once every 6 seconds; 30-60s is conservative and correct.

---

## Summary

| # | Severity | Area | Finding |
|---|----------|------|---------|
| 1 | **Critical** | Incremental export rate limits | Doc says 20/60 req/min; correct is 10/30 req/min |
| 2 | **Medium** | Missing endpoint-specific limits | 30/10min per-user-per-ticket write limit and others not documented |
| 3 | **Low** | Header name | `X-Rate-Limit-Remaining` not confirmed in official docs; only `x-rate-limit` is documented |
| 4 | **Info** | Bulk endpoints | Correctly characterized; fake endpoint already self-flagged |

**Action items**:
1. Fix incremental export rate limits in Section 8 and the Quick Reference table.
2. Add endpoint-specific write limits subsection.
3. Verify `X-Rate-Limit-Remaining` header presence before documenting.
4. Keep the fake `tags.json` endpoint notation in Phase 2.

---

*Sources:*
- *https://developer.zendesk.com/api-reference/introduction/rate-limits/*
- *https://developer.zendesk.com/api-reference/introduction/pagination/*
- *https://developer.zendesk.com/api-reference/introduction/requests/*
- *https://developer.zendesk.com/api-reference/changelog/changelog/*