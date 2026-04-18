# GitHub Wiki Connector — Operational Reliability Review

**Reviewer:** rate limits & pagination  
**Source:** `docs/connectors/github_wiki.md`  
**Scope:** Rate limit accuracy, retry semantics, pagination correctness, bulk endpoint claims, error shapes, concurrency recommendations

---

## Verdict

**Conditionally accurate.** The document correctly identifies that no REST API applies to wiki operations and accurately characterizes the gollum webhook delivery semantics. However, two significant issues were found: (1) rate limit numbers for GitHub App are understated (the doc says 5,000/hr but Enterprise Cloud installations get 15,000/hr, and non-Enterprise installations can scale up to 12,500/hr with repo/user growth), and (2) the claim that git protocol limits are "undocumented but reasonable" is technically honest but incomplete — git operations share secondary rate limits (100 concurrent, 900 points/min) that are not listed. Secondary rate limits for content creation and OAuth token requests are also omitted.

---

## Findings

### 1. GitHub App rate limit — understated

**Area affected:** Section 8 (Rate Limits)

**Claim in doc:**
> GitHub App: 5,000 req/hr per installation

**Correct value / behavior:**
The GitHub App installation rate limit is tiered:

| Installation type | Limit |
|---|---|
| Default (non-Enterprise) | 5,000/hr |
| Non-Enterprise — scaled by activity | +50/hr per repo (above 20) + +50/hr per user (above 20), capped at **12,500/hr** |
| Enterprise Cloud org | **15,000/hr** |

The doc correctly states 5,000/hr for the default case but omits the Enterprise Cloud 15,000/hr figure and the auto-scaling cap at 12,500/hr. A connector targeting multi-tenant SaaS (likely on GitHub.com with diverse tenant org types) needs to know these tiers to avoid unnecessary 429s during high-volume operations.

**Citation:** [GitHub REST API rate limits — GitHub App installations](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

---

### 2. Secondary rate limits — not mentioned at all

**Area affected:** Section 8 (Rate Limits)

**Claim in doc:**
> No REST API means no REST rate limits apply to wiki git operations.

This is true for primary rate limit budgets, but git operations via HTTPS are subject to **secondary rate limits** that are not called out:

| Secondary limit | Value |
|---|---|
| Concurrent requests | 100 (shared between REST and GraphQL) |
| REST points per minute | 900 |
| CPU time per minute | 90 seconds (wall time) |
| Content creation requests | 80/min, 500/hr |
| OAuth token creation | 2,000/hr |

A connector doing git clone/push at high volume (e.g., a wiki with high activity generating multiple `gollum` events per minute) could hit the concurrent request limit or the content-creation limit. The 500/hr cap on content-creation requests is especially relevant for the outbound write path (creating/editing wiki pages via git commits). The document claims outbound writes are possible but does not flag this ceiling.

**Recommendation:** Surface secondary limits in the rate limits section. Specifically flag the 80/min content-creation cap as the effective ceiling for outbound wiki page writes.

---

### 3. Git protocol limits — "undocumented" is honest but not actionable

**Area affected:** Section 8 (Rate Limits)

**Claim in doc:**
> Git clone/push: Constrained by GitHub's git protocol limits. Undocumented but reasonable for normal use.

The "undocumented" framing is accurate — GitHub does not publish per-operation git limits. However:

- Git operations over HTTPS share the secondary rate limits above (concurrent, points/min). A connector doing shallow fetches for every `gollum` event could approach the concurrent request ceiling if the tenant's wiki is highly active.
- The 900 points/minute secondary limit for REST calls may also apply to git operations that make authenticated requests to GitHub endpoints (e.g., fetching repo metadata to derive the wiki URL).
- The document acknowledges git clones are "heavyweight" and recommends shallow fetch, but does not mention that high-frequency shallow fetches could trigger secondary limits.

**Recommendation:** Replace the vague "undocumented but reasonable" statement with a note that git HTTPS operations are subject to secondary rate limits (100 concurrent, 900 points/min) and that shallow fetches should be preferred to stay under the concurrent limit.

---

### 4. 429 / 403 error shape for REST API — partially stated

**Area affected:** Section 8 (Rate Limits)

**Claim in doc:**
No mention of how rate limit errors are surfaced.

**Correct behavior:**
GitHub surfaces rate limit errors in two ways:

| Condition | Response |
|---|---|
| Rate limited (primary or secondary) | HTTP `429 Too Many Requests`; header `Retry-After: <seconds>` |
| Abuse threshold (abuse detection) | HTTP `403 Forbidden`; header `Retry-After: <seconds>` |

The `Retry-After` header is present in both 429 and 403 abuse cases. The document should note that 403 with `Retry-After` is an abuse secondary limit (not an auth failure), and that git operations could trigger this before the primary rate limit is exhausted.

---

### 5. Retry-After semantics — correct but not documented

**Area affected:** Section 8 (Rate Limits), Section 3 (Webhooks)

**Claim in doc:**
(Webhooks section) "GitHub retries 5 times with exponential backoff over ~25 minutes" — this is correct for webhook delivery.

**Claim in doc:**
(Rate Limits section) No mention of `Retry-After` handling.

**Correct behavior:**
For REST API rate limits (including secondary limits that affect git operations):
- `Retry-After: <seconds>` header is present on 429 and 403 abuse responses.
- GitHub recommends respecting `Retry-After`. If absent, the standard strategy is exponential backoff starting at 1 second, capped at 5 minutes.

The document mentions webhook retry semantics correctly but does not document the `Retry-After` header behavior for the API calls used for user lookup and repo metadata (the only REST API path the connector uses). The current doc is silent on retry backoff for the API calls made in the identity mapping and webhook verification path.

---

### 6. Git log pagination — correctly described

**Area affected:** Section 9 (Pagination & Search)

**Claim in doc:**
> Git log pagination: Use `--skip` and `--max-count` flags for manual cursor pagination.

**Correct value:** This is accurate. `git log` supports `--skip` and `--max-count` (equivalent to `--max-log-entries`). GitHub's git protocol does not expose a cursor-based API — `git log` with SHA-based cursors is the correct approach.

**Caveat not flagged:** Under concurrent writes, `--skip`/`--max-count` pagination can skip or duplicate entries if commits are being added during the paginated read. This is a known limitation of offset-based git log pagination. For reconciliation with a wiki under active editing, SHA-cursor pagination (fetch commits newer than stored SHA) is more reliable than offset-based pagination. The document recommends SHA-based cursors but does not explain why.

---

### 7. No pagination API — correctly stated

**Area affected:** Section 9 (Pagination & Search)

**Claim in doc:**
> No REST API pagination applies to wiki content. Git clones are heavyweight. Wikis are bare git repos; there's no pagination API.

**Correct value:** Correct. There is no REST API for wiki content, no GraphQL endpoint for wiki content, and no pagination API for git operations beyond `git log` flags.

---

### 8. Bulk / batch endpoints — correctly absent

**Area affected:** Section 8 (Rate Limits), Section 4 (Outbound Writing)

**Claim in doc:**
No bulk endpoints are claimed for wikis.

**Correct value:** Accurate. GitHub Wiki has no bulk REST endpoints. The only bulk-capable operation is `git commit` (atomic multi-page writes in a single commit), but there is no API to construct that commit without a local git clone. The document correctly identifies this constraint.

---

### 9. Error response shapes — correctly scoped to "N/A"

**Area affected:** Throughout

**Claim in doc:**
No `problem+json`, no Slack-style `{ok: false}`, no GitHub `{message, documentation_url}` in the context of wiki operations.

**Correct value:** Accurate. GitHub's `problem+json` error shape (`{message, documentation_url}`) applies only to the REST API. Wiki operations via git do not return structured API error responses. The document is correct to treat error shapes as N/A for wiki operations and to limit error shape discussion to the user-lookup API path (which is the only REST call the connector makes).

---

### 10. Concurrency recommendation — absent

**Area affected:** Section 8 (Rate Limits)

**Claim in doc:**
No concurrency guidance given.

**Correct behavior:**
Given the secondary rate limit of 100 concurrent requests (shared across REST and GraphQL), a reasonable recommendation for a connector that makes git operations and occasional REST API calls:

- Maximum **20 concurrent git operations** per installation to leave headroom for GraphQL and REST calls.
- Maximum **10 concurrent REST API calls** for user lookups and repo metadata.
- Use a semaphore or token-bucket with a burst limit of ~20 and a refill rate that respects the 900 points/min secondary limit.

The document gives no such guidance. A naive implementation could saturate concurrent connections under high-volume wiki activity, triggering 403 abuse responses before hitting the primary rate limit.

---

### 11. "Unlimited" claims — none present

**Area affected:** Section 8 (Rate Limits)

**Claim in doc:**
No claims of unlimited capacity.

**Correct value:** No false "unlimited" claims were found. The document correctly avoids asserting unlimited bandwidth for git operations.

---

## Summary of Corrections

| # | Area | Current doc | Recommended correction |
|---|---|---|---|
| 1 | GitHub App rate limit | 5,000/hr | Note Enterprise Cloud = 15,000/hr; non-Enterprise auto-scales to 12,500/hr |
| 2 | Secondary rate limits | Not mentioned | Add concurrent (100), REST points/min (900), content creation (80/min, 500/hr), CPU time (90s/min) |
| 3 | Git protocol limits | "Undocumented but reasonable" | Add note that git HTTPS ops are subject to secondary limits; recommend shallow fetch |
| 4 | 429 vs 403 surfacing | Not documented | Note 429 for primary/secondary limits; 403 for abuse detection; `Retry-After` on both |
| 5 | Retry-After / backoff | Not documented | Document `Retry-After` header behavior; recommend exponential backoff capped at 5 min |
| 6 | Git log under concurrent writes | Not flagged | Add note that offset pagination can skip/duplicate under active editing; SHA-cursor is safer |
| 7 | Concurrency guidance | Absent | Add recommendation: max 20 concurrent git ops, 10 concurrent REST calls |