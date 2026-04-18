# Operational-Reliability Review: custom_git_server.md

**Reviewer**: Operational-Reliability (rate limits, pagination, retries, error handling, bulk operations)
**Source**: `docs/connectors/custom_git_server.md` (last updated 2026-04-18)
**Verdict**: **CONDITIONAL PASS — Action Required**

The document correctly identifies that self-hosted platforms default to no enforced rate limits, which is the most important operational insight for this connector class. However, there are several factual inaccuracies and significant gaps that must be addressed before the document is considered accurate.

---

## Finding 1 — Azure DevOps Server: Pagination Mechanism Is Inaccurate

**Area**: Section 9.1 — Pagination Styles by Platform

**Claim**: Azure DevOps Server uses "Continuation token (OData `$skip`, `$top`) | Max 200 per page"

**Correct behavior**:
- Azure DevOps Server uses **`$skiptoken`** (opaque continuation token), not numeric `$skip`, for pagination.
- `$top` is supported but capped at 200. When more results exist, the response includes a `x-ms-continuation-token` response header containing the `$skiptoken` value for the next page.
- Using numeric `$skip` with work items is supported but inefficient for large datasets and not the recommended pattern.

**Impact**: Medium. The polling example using `$top=50` in Section 3.2 is valid, but the description of the continuation mechanism is wrong. A connector implementation following this doc would try to use `$skip` for cursor advancement, which works but misses the efficient `$skiptoken` pattern.

**Recommendation**: Update the pagination description:
```
Azure DevOps: OData continuation via $skiptoken (from x-ms-continuation-token header)
  Use $top=N (max 200) per page, advance via $skiptoken for next page
```

---

## Finding 2 — Azure DevOps Server: Rate Limit Headers Are Mischaracterized

**Area**: Section 8.2 — How Rate Limits Are Exposed

**Claim**: "Azure DevOps Server: No standard rate limit headers. Use `Retry-After` on 429."

**Correct behavior**:
- Azure DevOps Server has **no rate limiting enabled by default**. This is the same as all other self-hosted platforms in this document.
- When rate limiting IS configured (via IIS or the TF Server-level throttling settings), Azure DevOps Server does NOT use `Retry-After`. It uses **`X-RateLimit-*`** response headers (same as Azure DevOps Services).
- `Retry-After` on 429 is an Azure DevOps **Services** (cloud) behavior, not Server behavior.

**Impact**: Medium. The connector would look for `Retry-After` on Azure DevOps Server, which would never appear unless rate limiting is explicitly configured. This creates misleading implementation guidance.

**Recommendation**: Change Azure DevOps row in Section 8.2 to:
```
Azure DevOps Server | None (no rate limiting by default); X-RateLimit-* headers only if admin-configured
```

---

## Finding 3 — GitLab SM: Inconsistent Link to Connector Doc

**Area**: Section 8.1 — Overview

**Claim**: "GitLab SM | None | Admin-configurable per-user and global"

**Cross-reference finding**: The `gitlab.md` connector document (Section 8.1) documents GitLab **.com** rate limits (2,000 req/min authenticated API, 60 notes/min). GitLab **SM** defaults to no limits unless configured.

**Issue**: Section 8.1 of `custom_git_server.md` correctly identifies GitLab SM as having no default limits, but the section provides no actionable guidance on:
1. Whether the admin-configured limits are discoverable via API
2. What headers to expect when limits ARE configured (the `gitlab.md` doc says `RateLimit-*` headers, per-endpoint)
3. How the two-rate-limit-system issue (`Rack::Attack` vs application-level) affects self-managed

**Impact**: Low. The core claim ("None by default") is correct. However, implementers will need to handle rate limits if a tenant has configured them, and there's no guidance on detecting or respecting configured limits.

**Recommendation**: Add a note: "When GitLab SM admins configure rate limits, the same `RateLimit-*` headers documented in `gitlab.md` Section 8.2 apply. Note that GitLab has two independent throttle systems (Rack::Attack at network layer, application-level per-endpoint) that do not share budgets."

---

## Finding 4 — Error Response Shape: Not Documented

**Area**: Section 8 — Rate Limits

**Finding**: The document does not describe error response shapes for rate-limit-hit scenarios (429 vs 403 vs 5xx), nor does it document the standard error body format for each platform.

**What is missing**:
- Gitea/Forgejo: When rate limiting is enabled and hit, returns `429 Too Many Requests` with `X-RateLimit-*` headers. No standard problem+json body; just a plain text or JSON error message.
- GitLab SM: When rate limits are configured and hit, returns `429` with `Retry-After` header and body `Retry later` (plain text). Silent 429s exist on some endpoints (Projects, Groups, Users APIs) — documented in `gitlab.md` Section 8.3.
- Azure DevOps Server: Not applicable by default (no rate limiting). If configured, behavior mirrors Azure DevOps Services.

**Impact**: Medium. Implementers won't know how to distinguish rate-limit errors from other 4xx/5xx errors without this guidance.

**Recommendation**: Add an error response table to Section 8:
```
| Platform | Rate-limit status code | Response body | Headers |
|---|---|---|---|
| Gitea/Forgejo (when enabled) | 429 | JSON: {"message": "..."} | X-RateLimit-* + Retry-After |
| GitLab SM (when configured) | 429 | Plain text: "Retry later" | RateLimit-* + Retry-After |
| Azure DevOps Server (when configured) | 429 | JSON error | X-RateLimit-* |
| All platforms | 5xx | Platform-specific | Usually none |
```

---

## Finding 5 — Retry Semantics: Underspecified

**Area**: Section 8 — Rate Limits

**Finding**: The document states "When they don't [exist], use conservative backoff for repeated errors" but provides no specific guidance on:
1. What "conservative backoff" means (exponential, fixed, jitter)
2. What initial delay to use
3. What maximum delay to cap at
4. How many retries before giving up

**Impact**: Low-Medium. This is guidance that could apply to any HTTP client, but for a self-hosted connector where servers may be underpowered or misconfigured, explicit retry guidance prevents implementers from making dangerous choices (e.g., tight retry loops that amplify load).

**Recommendation**: Add to Section 8:
```
**Retry guidance (when rate limits are hit or server is slow):**
- Use exponential backoff with jitter: delay = min(base * 2^attempt + random_jitter, max_delay)
- Suggested base delay: 1 second
- Suggested max delay: 60 seconds
- Suggested max retries: 3
- On 429 with Retry-After header: wait the full Retry-After value before retrying
- On 429 without Retry-After (GitLab SM silent 429s): use exponential backoff
- On connection errors/timeouts: retry with backoff
- Do NOT retry on 4xx client errors (except 429)
```

---

## Finding 6 — Concurrency Limits: No Guidance

**Area**: Section 8 — Rate Limits

**Finding**: The document does not provide any recommendation on concurrent request limits, which is critical for multi-tenant connectors that may serve multiple tenants from the same HTTP client.

**Context**: For self-hosted platforms with no rate limits, a naive connector could fire dozens of concurrent requests and overwhelm a small internal Git server. This is especially risky for Gitea/Forgejo on resource-constrained VMs.

**Impact**: Low. This is general HTTP client guidance, but given that self-hosted platforms are often running on modest hardware, explicit concurrency limits would prevent support incidents.

**Recommendation**: Add to Section 8:
```
**Concurrency guidance:**
- Limit concurrent requests to the same host: max 5-10 concurrent
- Use a per-host request queue rather than unbounded parallelism
- For Gitea/Forgejo on resource-constrained instances: 2-3 concurrent may be safer
- Per-tenant concurrency: if one tenant's integration misbehaves, it shouldn't affect others
```

---

## Finding 7 — Gogs: Rate Limit Header Claim Is Correct

**Area**: Section 8.2 — How Rate Limits Are Exposed

**Claim**: "Gogs: None" (no rate limit headers)

**Verification**: Confirmed. Gogs does not implement rate limiting. This is accurate.

---

## Finding 8 — Bitbucket DC: Header Claim Is Partially Accurate

**Area**: Section 8.2 — How Rate Limits Are Exposed

**Claim**: "Bitbucket DC: `X-RateLimit-Limit`, `X-RateLimit-Remaining` (if configured)"

**Verification**: Accurate. Bitbucket DC supports per-user configurable rate limits via `/rest/api/1.0/admin/rate-limit/settings`. When enabled, `X-RateLimit-*` headers are returned. When disabled (default), no headers are present.

**Minor note**: The header format matches Bitbucket Cloud (`X-RateLimit-*`), not Atlassian's newer convention. This is correct.

---

## Finding 9 — Bulk/Batch Endpoints: Correctly Documented

**Area**: Section 8.3 — Bulk/Batch Endpoints

**Claim**: "None of the self-hosted platforms have batch APIs."

**Verification**: Confirmed for all listed platforms. The document correctly recommends `per_page`/`limit` params as the optimization strategy. Bitbucket Cloud (not covered here) does have some batch capabilities, but the claim is scoped to self-hosted platforms.

---

## Finding 10 — Pagination: Gitea Max Page Size Needs Clarification

**Area**: Section 9.1 — Pagination Styles by Platform

**Claim**: "Gitea: Offset: `page`, `limit` | Default 20, max 100"

**Verification**: Partially accurate. Gitea's default limit is 20, and a max of 100 is a reasonable common configuration. However, Gitea's actual maximum depends on the ` DEFAULT_PAGING_NUM` configuration value. Some Gitea installations may have a lower max (e.g., 50).

**Impact**: Low. The connector should discover the actual max via the `X-RateLimit-Limit` header or a config probe, rather than hardcoding 100.

**Recommendation**: Change to "Default 20, max varies by instance config (commonly 50-100)"

---

## Finding 11 — Pagination: GitLab SM Keyset Pagination Mischaracterized

**Area**: Section 9.1 — Pagination Styles by Platform

**Claim**: GitLab SM supports "Keyset: `order_by`, `sort`"

**Verification**: Misleading. GitLab's keyset pagination requires the additional parameter `pagination=keyset`. Without this parameter, all requests use offset pagination regardless of `order_by`/`sort`. The keyset pagination is also only available for specific `order_by` values (`updated_at`, `id`, `created_at`).

**Impact**: Low. A connector implementation would work with offset pagination, but miss the more efficient keyset pattern for large datasets.

**Recommendation**: Change to: "Keyset (requires `pagination=keyset`): `order_by` (updated_at/id/created_at), `sort` | Max 100"

---

## Finding 12 — Reconciliation: Pagination Gap

**Area**: Section 9.3 — Reconciliation Strategy

**Claim**: Uses `since={lastSyncTimestamp}&limit=100` pattern for reconciliation

**Finding**: The example in Section 9.3 uses `limit` but Gitea/Forgejo's parameter is `limit`, while GitLab SM uses `per_page`. This inconsistency should be called out.

**Impact**: Low. Implementers will need to know platform-specific parameter names.

---

## Summary of Required Changes

| Priority | Finding | Change Required |
|---|---|---|
| **High** | #1 | Fix Azure DevOps pagination: `$skiptoken` not `$skip` |
| **High** | #2 | Fix Azure DevOps rate limit headers: `X-RateLimit-*` not `Retry-After` |
| **High** | #4 | Add error response shape table to Section 8 |
| **Medium** | #5 | Add retry semantics guidance |
| **Medium** | #6 | Add concurrency limits guidance |
| **Low** | #3 | Clarify GitLab SM vs GitLab.com rate limits |
| **Low** | #10 | Clarify Gitea max page size is instance-configurable |
| **Low** | #11 | Fix GitLab SM keyset pagination parameter (`pagination=keyset` required) |
| **Low** | #12 | Clarify reconciliation pagination parameter names per platform |

---

## What the Document Gets Right

1. **Core claim is correct**: All self-hosted platforms default to no rate limits.
2. **Adapter pattern recommendation** is sound — different platforms genuinely have different capabilities.
3. **Gogs: no rate limiting** — correctly identified.
4. **Bitbucket DC: configurable** — correctly identified.
5. **Bulk/batch endpoints: none** — correctly identified for self-hosted platforms.
6. **No premature assumption of rate limit headers** — correctly advised as "when they do exist."
