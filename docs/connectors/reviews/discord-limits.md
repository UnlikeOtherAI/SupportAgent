# Discord Connector: Operational Reliability Review

**Reviewer**: Rate Limits, Pagination, Bulk Operations, Error Handling
**Source**: `docs/connectors/discord.md`
**Focus**: Global/per-route rate limits, retry semantics, pagination correctness, bulk endpoints, error response shapes

---

## Verdict: **CONDITIONAL PASS** — Several inaccuracies and gaps require correction before production use.

---

## Findings

### 1. Global Rate Limit — CORRECT

**Claim in doc** (Section 8):
> 50 requests/second — Global bot limit

**Verdict**: Correct.

**Evidence**: Discord's official documentation states the global rate limit is **50 requests per second** for authenticated (bot) requests. The doc correctly identifies this.

**Note**: The doc correctly distinguishes bot requests (per-second limit) from unauthenticated/IP-based limits. No change needed here.

---

### 2. Cloudflare Ban Threshold — MOSTLY CORRECT with Important Caveat

**Claim in doc** (Section 8):
> "Invalid requests (401, 403, 429) exceeding 10,000 per 10 minutes trigger Cloudflare IP bans."

**Verdict**: Mostly correct, but incomplete.

**Correct value**: The 10,000 invalid requests per 10 minutes threshold is documented by Discord. However, the doc fails to mention:

1. **429s with `X-RateLimit-Scope: shared` are excluded** from the invalid request count. These are legitimate rate limits hit by multiple applications sharing a bucket and should not contribute to the ban counter.

2. The ban is a **temporary IP restriction**, not necessarily a permanent ban. Discord's documentation refers to it as "Cloudflare's DDoS protection."

**Required fix**: Update Section 8 to clarify that shared-scope 429s do not count toward the Cloudflare ban threshold.

---

### 3. Per-Route Bucket Limits — VAGUE and POSSIBLY INCORRECT

**Claim in doc** (Section 8):
| Route Prefix | Limit | Window |
|--------------|-------|--------|
| `POST /channels/{id}/messages` | 50 | 0.33s? (varies) |
| `GET /channels/{id}/messages` | 120 | 60s? (varies) |
| General (most routes) | ~300 | varies |

**Verdict**: Too vague to be useful; `0.33s` notation is misleading.

**Issues**:
- The notation "50 per 0.33s" implies a 3-per-second rate, which contradicts the stated 50/second global limit. Discord uses **bucket-based rate limiting** where the bucket determines how many requests can be made in a rolling window. The specific bucket values vary by route and are determined at runtime from the `X-RateLimit-Bucket` header.

- The `?` and "(varies)" notations indicate the author was uncertain. This is acceptable because Discord does not publish exact bucket limits, but the doc should not present guesses as facts.

**Correct approach**: Remove specific numbers from the per-route table. Instead, document that:
1. Discord uses bucket-based rate limiting (determined at runtime)
2. `X-RateLimit-Bucket` header identifies the bucket
3. `X-RateLimit-Limit` shows the bucket capacity
4. `X-RateLimit-Remaining` shows current capacity
5. Bots should use the `X-RateLimit-Reset` or `X-RateLimit-Reset-After` headers to schedule retries

**Recommendation**: Replace the per-route table with guidance on how to discover and respect bucket limits dynamically.

---

### 4. Retry Strategy — MISSING EXPONENTIAL BACKOFF

**Claim in doc** (Section 8):
1. Read `Retry-After` header
2. Wait specified seconds
3. Retry request
4. If global limit hit, respect even if bucket differs

**Verdict**: Incomplete for production use.

**Issue**: The strategy lacks **exponential backoff with jitter** for failed retries. If a request fails for reasons other than rate limiting (network error, 5xx), immediate retry can cause thundering herd problems and worsen congestion.

**Correct approach**: After the initial `Retry-After` wait:
1. On success: reset backoff to base
2. On 429 or 5xx: exponential backoff with jitter (e.g., `min(base * 2^attempt + random_jitter, 60s)`)
3. Include a maximum retry count (e.g., 5 attempts)
4. Distinguish between `global: true` and `global: false` 429s — global limits affect all endpoints; per-route limits only affect that bucket

**Recommendation**: Add exponential backoff with jitter to the retry strategy section.

---

### 5. Pagination — MOSTLY CORRECT

**Claim in doc** (Section 9):
```
GET /channels/{channel.id}/messages?limit=100
GET /channels/{channel.id}/messages?before={snowflake}
GET /channels/{channel.id}/messages?after={snowflake}
GET /channels/{channel.id}/messages?around={snowflake}
```

**Verdict**: Correct for message pagination.

**Evidence**: Discord message pagination uses **snowflake-based cursors** with `before`, `after`, and `around` parameters. Results are returned newest-first by default.

**Max page sizes** (Section 9):
| Endpoint | Max |
|----------|-----|
| Messages | 100 | ✓ Correct |
| Guild Members | 1000 | ✓ Correct |
| Threads/Channels | unspecified, typically 100 | ⚠️ Vague |

**Guild members pagination**: The doc correctly shows `limit=1000&after={snowflake}`. This is accurate.

**Issue**: For thread members, Discord API v11+ returns `has_more: boolean` for pagination, not cursor-based pagination. The doc does not mention this.

**Issue**: The doc states "Threads/Channels: unspecified, typically 100" but archived thread listing uses `before` (timestamp) not cursor-based pagination. This should be clarified.

---

### 6. Reconciliation Gap — NOT DOCUMENTED

**Issue**: Discord's snowflake-based pagination can **skip items under concurrent writes**.

**Scenario**: When paginating backward through messages (`before={snowflake}`), if a new message is posted during pagination:
1. Client fetches page 1 (messages 100-199)
2. New message arrives and is inserted at position 101
3. Client fetches page 2 (`before=99`) — misses the new message

**Recommendation**: Add a section on reconciliation strategy:
- Use `around={snowflake}` for targeted re-sync
- Store the timestamp of the last processed message and periodically scan for newer messages
- For gateway-connected real-time ingestion, use sequence numbers (`s` field in gateway events) to detect gaps

---

### 7. 429 Response Format — CORRECT

**Claim in doc** (Section 8):
```json
HTTP 429
Retry-After: <seconds>
X-RateLimit-Scope: user | global | shared
```

**Verdict**: Correct structure, but the JSON body was not documented.

**Correct 429 response body**:
```json
{
  "message": "You are being rate limited.",
  "retry_after": 45.32,
  "global": false,
  "code": 0
}
```

**Note**: The `Retry-After` header value is in **seconds** (decimal), while the `retry_after` in the JSON body is also in **seconds** (decimal, not milliseconds).

**Recommendation**: Add the JSON body format to Section 8.

---

### 8. Interaction Endpoints — NOT DOCUMENTED

**Gap**: The doc does not mention that **interaction endpoints** (slash commands, button clicks, modal submissions) are exempt from the global 50 req/s limit and have their own separate rate limits.

**Recommendation**: Add a note in Section 8 that interaction-related endpoints may have different rate limit behavior if the connector plans to handle slash commands.

---

### 9. Emoji/Reaction Rate Limits — NOT DOCUMENTED

**Gap**: The doc mentions adding/removing reactions but does not note that **emoji endpoints** are rate-limited per-guild, not per-route. Hitting the emoji limit in one channel can affect emoji operations across the entire guild.

**Recommendation**: Add a note about guild-scoped emoji limits if reaction functionality is used.

---

### 10. Slowmode vs API Rate Limits — CORRECTLY NOTED

**Claim in doc** (Section 10):
> Channels can have slowmode (0-21600 seconds). Applies to messages and thread creation.

**Verdict**: Correct. This is separate from API rate limiting (slowmode is a per-channel user-facing feature, not an API limit). The doc correctly identifies this as a "known gotcha."

---

## Summary of Required Changes

| Priority | Section | Issue | Action |
|----------|---------|-------|--------|
| HIGH | 8 | Cloudflare ban excludes shared-scope 429s | Clarify |
| HIGH | 8 | Retry strategy lacks exponential backoff | Add backoff+jitter |
| HIGH | 8 | Per-route bucket numbers are guesses with `?` | Remove guesses, document dynamic discovery |
| MEDIUM | 8 | 429 JSON body not documented | Add `retry_after`, `global`, `code` fields |
| MEDIUM | 9 | Reconciliation gap (concurrent writes) not noted | Add reconciliation strategy section |
| LOW | 8 | Interaction endpoint exemptions not documented | Add note if slash commands planned |
| LOW | 9 | Thread member pagination (has_more) not documented | Clarify pagination differences |

---

## References

- [Discord Rate Limits (docs.discord.com)](https://docs.discord.com/developers/topics/rate-limits) — Global limits, bucket-based system, Cloudflare thresholds
- [Discord Pagination (docs.discord.com)](https://docs.discord.com/developers/topics/pagination) — Snowflake-based cursor pagination
- [Discord Message Resource](https://docs.discord.com/developers/resources/message) — Message pagination endpoints
- [Discord Channel Resource](https://docs.discord.com/developers/resources/channel) — Thread member pagination
