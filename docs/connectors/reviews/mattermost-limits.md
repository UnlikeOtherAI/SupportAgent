# Mattermost Connector — Operational Reliability Review

**Reviewer**: limits / rate-limit / pagination / retry / error-handling
**Source**: `docs/connectors/mattermost.md` (lines 662–799, plus appendix)
**Verified against**: Mattermost server source (`server/public/model/config.go`, `server/public/model/search_params.go`, `server/channels/app/ratelimit.go`) and [docs.mattermost.com](https://docs.mattermost.com/administration-guide/configure/rate-limiting-configuration-settings.html)

---

## Verdict: ISSUES FOUND

The document has one **critical accuracy error** (rate limit defaults off by 10×), two **minor accuracy errors** (max per_page and MemoryStoreSize), and one **gap** (Mattermost Cloud is an undisclosed-limit environment).

---

## Findings

### Finding 1 — Rate limit defaults: critical error (10× inflation)

**Area**: Section 8, Rate Limits — Configuration (lines 668–676)

**Claim in doc**:
```go
RateLimitSettings.PerSec = 100           // Requests per second
RateLimitSettings.MaxBurst = 100         // Burst capacity
RateSettings.MemoryStoreSize = 15000    // In-memory store size
RateLimitSettings.VaryByUser = true      // Rate limit by auth token
RateLimitSettings.VaryByRemoteAddr = false
```

**Correct values** (from `server/public/model/config.go`, `SetDefaults()` method):

| Field | Doc value | Source-of-truth value |
|---|---|---|
| `Enable` | _(not shown)_ | `false` (disabled by default) |
| `PerSec` | **100** | **10** |
| `MaxBurst` | 100 | 100 ✓ |
| `MemoryStoreSize` | **15000** | **10000** |
| `VaryByUser` | **true** | **false** |
| `VaryByRemoteAddr` | **false** | **true** |

`PerSec` is 10× too high. `VaryByUser` and `VaryByRemoteAddr` are swapped. `MemoryStoreSize` is 50% too high.

**Impact**: A connector built to these wrong numbers would burst at 100 req/s assuming 10 req/s is conservative — actually it would be capped at 10 req/s on default self-hosted, and if targeting Mattermost Cloud (where limits are opaque), it would be operating blind. The false sense of headroom is dangerous.

**Fix**: Replace the Go snippet with the correct defaults.

---

### Finding 2 — Max per_page: overstated

**Area**: Section 9, Pagination & Search — Max Page Size (lines 751–755)

**Claim in doc**:
> Max: Varies by endpoint (typically 100-1000)
> Reporting API: Max 1000 posts per page (`MaxReportingPerPage`)

**Correct value** (from `server/public/model/search_params.go`):

```go
const (
    PageDefault        = 0
    PerPageDefault    = 60
    PerPageMaximum    = 200
    LimitDefault      = 60
    LimitMaximum      = 200
)
```

`PerPageMaximum = 200` is the server-enforced cap for the standard API. The doc's "100-1000" range has no basis in the source. `MaxReportingPerPage` was not found in the codebase.

**Impact**: Minor. A connector using `per_page=200` works; one using `per_page=500` would get silently truncated or rejected at the server layer.

**Fix**: Change to `Max: 200 (PerPageMaximum from search_params.go)`.

---

### Finding 3 — Retry-After units: correct

**Area**: Section 8, Rate Limit Response + Appendix (lines 691, 1070)

**Claim**: `Retry-After` is in seconds.

**Correct**: Confirmed. The server's throttled library returns seconds. The code example at line 701 correctly multiplies by 1000.

---

### Finding 4 — Retry strategy: partially adequate, not ideal

**Area**: Section 8, Retry-After Semantics (lines 695–711)

**Claim in doc** (retry function):
```typescript
const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 1000;
// then: await new Promise(resolve => setTimeout(resolve, waitMs));
// then recursive call with maxRetries - 1
```

**Assessment**: The function reads `Retry-After` correctly and uses it on the first 429. However:

- It uses a **fixed 1-second wait** when `Retry-After` is absent, not an exponential backoff.
- The recursive call does not apply backoff on subsequent retries (same `waitMs` each time).
- `Retry-After` may be absent on self-hosted if the server admin disables detailed headers.

**Better pattern**: Exponential backoff with jitter, respecting `Retry-After` as a floor, with a max backoff ceiling (~30s). E.g.:

```typescript
async function apiRequestWithRetry(url: string, options: RequestInit, attempt = 0, maxAttempts = 4): Promise<Response> {
  const response = await fetch(url, options);

  if (response.status === 429) {
    const retryAfterSec = parseInt(response.headers.get('Retry-After') ?? '1');
    const backoffMs = Math.min(
      (retryAfterSec * 1000) + (Math.random() * 1000),  // cap + jitter
      30_000                                              // ceiling
    );
    if (attempt < maxAttempts) {
      await sleep(backoffMs);
      return apiRequestWithRetry(url, options, attempt + 1, maxAttempts);
    }
  }
  return response;
}
```

**Fix**: Update the retry example to use exponential backoff with jitter. Add a note that `Retry-After` may be absent on some self-hosted configs.

---

### Finding 5 — Pagination scheme: mostly accurate, one caveat

**Area**: Section 9, Pagination Style (lines 734–743)

**Claim**: "Page-based with cursor support (hybrid model)" for posts endpoint.

**Assessment**: Accurate with nuance.

| Endpoint | Pagination style |
|---|---|
| `/channels/{id}/posts` | Offset (`page` + `per_page`) + `before`/`after` cursor params |
| `/posts/ids` | No pagination (batch) |
| `/users`, `/teams/{id}/channels` | Offset (`page` + `per_page`) |

The `getPostThread` endpoint uses directional pagination (`fromPost`, `direction: "up"|"down"`), not simple page offsets. The doc doesn't cover this for Phase 1 but it matters for Phase 3.

**The important reconciliation caveat not mentioned**: The `/channels/{id}/posts` response returns posts as a `Record<id, Post>` map with an `order: string[]` array (most recent first). Under concurrent writes, using `page` offsets can skip or duplicate posts. The doc recommends `?since={timestamp}` for polling (correct), but does not warn that offset pagination is unsafe for full reconciliation.

**Fix**: Add a note under pagination that `page`-based offsets are not safe for reconciliation under concurrent writes; use `?since=` filtering or the `before`/`after` cursor parameters instead.

---

### Finding 6 — Mattermost Cloud rate limits: undisclosed, not mentioned

**Area**: Section 8, Rate Limits (line 810); Section 10 Cloud vs Self-Hosted (lines 804–813)

**Claim**: "API rate limits — Configurable per instance — Server-admin controlled"

**Reality**: Rate limiting configuration (the `RateLimitSettings` block) is **self-hosted only**. The docs explicitly state this setting is "intended for small deployments of Mattermost up to a few hundred users" and is not exposed in Mattermost Cloud administration.

Mattermost Cloud has **no publicly documented API rate limits**. The limits exist (managed by Mattermost's infrastructure), but are opaque to customers.

**Impact**: A connector targeting Mattermost Cloud tenants operates under undisclosed limits. Any assumption about request throughput is unverified. The doc does not flag this as an unknown.

**Fix**: Add a prominent note that for Mattermost Cloud, rate limits are not customer-configurable and are not publicly documented. Recommend probing with backoff or contacting Mattermost support for enterprise Cloud tenants.

---

### Finding 7 — Error response shape: partially documented

**Area**: Section 8, Response on Rate Limit Exceeded (lines 678–689)

**Claim**: 429 with headers listed; body is `text/plain`.

**Correct**: The rate limit response is 429 with `X-RateLimit-*` headers and a plain-text body.

**Gap**: The doc does not document the shape of non-rate-limit API errors. Mattermost returns `problem+json` for some error classes but plain `{"message": "...", "status_code": N}` for others. A connector needs to handle both gracefully.

**Fix**: Add a brief error shape note:
```typescript
// Mattermost API error body
{ "message": "Error description", "status_code": 403, "id": "api.context.session_expired.app_error" }
```

---

### Finding 8 — Bulk endpoints: accurate

**Area**: Section 8, Bulk/Batch Endpoints (lines 713–728)

**Claim**: Lists `/posts/ids`, `/users/ids`, `/channels/{id}/posts/ids`, `/posts/{id}/thread`.

**Assessment**: Accurate. All four exist. No missing bulk endpoints of concern for the MVP scope.

---

## Summary Table

| Area | Claim | Correct? | Fix Priority |
|---|---|---|---|
| Default `PerSec` | 100 | **No — actual is 10** | Critical |
| Default `VaryByUser` | true | **No — actual is false** | Critical |
| Default `VaryByRemoteAddr` | false | **No — actual is true** | Critical |
| Default `MemoryStoreSize` | 15000 | **No — actual is 10000** | Medium |
| Rate limit enabled by default | _(implied yes)_ | **No — disabled by default** | Medium |
| Max `per_page` | 100–1000 | **No — actual is 200** | Low |
| `PerPageDefault` | 60 | Yes | — |
| `Retry-After` units | seconds | Yes | — |
| Retry strategy | fixed backoff | Partially | Low |
| Pagination scheme | offset + cursor | Mostly | Low |
| Bulk endpoints | 4 listed | Accurate | — |
| Error body shape | partial | Gap | Low |
| Mattermost Cloud limits | configurable | **Wrong — undisclosed** | Medium |

---

## Recommendations

1. **Fix Finding 1 immediately** — the inflated `PerSec=100` will cause real production issues. Correct defaults should guide connector capacity planning.
2. **Add Cloud disclaimer** — Mattermost Cloud customers have no control over and no visibility into rate limits. The connector should probe and adapt.
3. **Upgrade retry logic** — exponential backoff with jitter prevents thundering-herd on 429.
4. **Warn about offset pagination for reconciliation** — concurrent writes make page offsets unsafe.
