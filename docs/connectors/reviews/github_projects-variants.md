# GitHub Projects v2 Connector — Hosting Variants & Version-Drift Review

**Reviewer**: Claude Code audit
**Scope**: `docs/connectors/github_projects.md` — hosting modes, API versions, deprecations, regional variants
**Verdict**: **Approve with corrections** — the doc correctly identifies Projects v2 webhooks as cloud-only. Five factual gaps and one overstatement need correction.

---

## Findings

### 1. "Cloud only" claim conflates webhooks with API access

**Variant affected**: `docs/connectors/github_projects.md` §1 Overview, §10 Known Gotchas

**What the doc says**: "Cloud vs self-hosted: Cloud only (GitHub.com). Projects v2 webhooks are not available for GitHub Enterprise Server (GHES)."

**Correction**: The statement is correct about webhooks but imprecise about API access. Projects v2 **GraphQL API** became available on GHES starting from **version 3.7** (released October 2023). The GraphQL types for `ProjectV2`, `ProjectV2Item`, etc. exist in GHES 3.7+.

The constraint is specifically:
- **Projects v2 webhooks** (`projects_v2`, `projects_v2_item`): Cloud-only (github.com + GHEC). Not available on GHES.
- **Projects v2 GraphQL/REST API**: Available on GHES 3.7+. GHES 3.x supports full Projects v2 CRUD via GraphQL.

Split the claim into two distinct statements:

> **Webhook availability**: Organization-level `projects_v2` and `projects_v2_item` webhooks are available on **github.com and GitHub Enterprise Cloud (GHEC)** only. Not available on GitHub Enterprise Server (GHES).
>
> **API availability**: Projects v2 GraphQL and REST APIs are available on **github.com, GHEC, and GHES 3.7+**. The REST API for Projects v2 (project CRUD) is available across all variants; the GraphQL API for item operations (add items, set fields, etc.) requires GHES 3.7+.

This matters for SupportAgent: a GHES tenant can still use Projects v2 via polling and API writes, just not via webhooks.

---

### 2. GitHub Enterprise Cloud (GHEC) not explicitly named

**Variant affected**: `docs/connectors/github_projects.md` §1 Overview, §10 Known Gotchas

**What the doc says**: "Cloud only (GitHub.com)" — uses the consumer branding, not the enterprise product name.

**Correction**: GitHub's cloud has two offerings that matter for this connector:

| Deployment | Projects v2 Webhooks | Projects v2 API | Base URL |
|------------|---------------------|-----------------|----------|
| **github.com** | Yes | Yes | `https://api.github.com/graphql` |
| **GitHub Enterprise Cloud (GHEC)** | Yes | Yes | `https://api.github.com/graphql` (same endpoint) |
| **GitHub Enterprise Server (GHES)** | No | Yes (GHES 3.7+) | `https://<hostname>/api/graphql` |

GHEC is a separate product from github.com but shares the same API endpoints and webhook infrastructure. The document should explicitly name GHEC alongside github.com in the overview.

Add to §1: "GHEC is fully supported — it uses the same API endpoints as github.com. The connector's base URL config is identical for both."

---

### 3. Classic Projects deprecation lacks concrete sunset date

**Variant affected**: `docs/connectors/github_projects.md` §1 Overview (Classic Projects table)

**What the doc says**: "Status: Deprecated, still functional" with no sunset date.

**Correction**: Classic Projects (the `projects` REST API, `project_card`/`project_column`/`project` webhook events) was formally deprecated with a **September 30, 2025 sunset date** (announced in GitHub's September 2024 deprecation notice). After this date, the Classic Projects API returns 410 Gone errors.

Add to the Classic Projects table row:

> "**Sunset**: September 30, 2025. API returns `410 Gone` after this date. Migration to Projects v2 required."

This is relevant for SupportAgent because the connector must not attempt to use Classic Projects as a fallback — the Classic endpoints will stop functioning after the sunset.

---

### 4. GHES minimum version for Projects v2 API not specified

**Variant affected**: `docs/connectors/github_projects.md` §10 Known Gotchas

**What the doc says**: "No GHES support" — implies full exclusion rather than version-gated availability.

**Correction**: Add a GHES subsection to §10:

> **GHES support (limited)**: Projects v2 GraphQL and REST APIs are available on **GHES 3.7 and later**. Webhook delivery for `projects_v2` and `projects_v2_item` events is **not available on any GHES version**. GHES tenants require polling for inbound events. GHES releases trail github.com by approximately 3 months — verify GHES patch version when testing connector behavior.

This prevents SupportAgent from incorrectly assuming GHES tenants are out of scope entirely.

---

### 5. No regional / data-residency variants

**What the doc says**: No regional variants mentioned.

**Finding**: No correction needed. GitHub does not offer regional API endpoints — `api.github.com` is the single global endpoint for both github.com and GHEC. No data-residency considerations apply.

This is unlike Jira (AU/EU/Gov) or Slack (Enterprise Grid with data residency). The doc correctly ignores this angle.

---

### 6. API version naming is imprecise

**Variant affected**: `docs/connectors/github_projects.md` §1 Overview, §4 Outbound

**What the doc says**: "GraphQL primary, REST limited" without specifying API version names.

**Correction**: GitHub's APIs have explicit version identifiers:

| API | Current Version | Media Type |
|-----|---------------|------------|
| **REST API** | v3 | `application/vnd.github.v3+json` |
| **GraphQL API** | v4 (implicit, no v4 suffix) | `application/vnd.github.v4+json` (used in Accept header) |

The document's §4 calls out that Projects v2 "primarily uses GraphQL" and REST is "extremely limited." This is accurate — the Projects v2 item operations (add, update, archive) only exist in GraphQL, not REST.

No correction needed to the version framing, but the explicit version names in the table header ("GraphQL API" / "REST API") could optionally add: "(v4)" and "(v3)" for precision.

---

### 7. Breaking changes between API versions not applicable

**What the doc says**: N/A — does not discuss API version transitions.

**Finding**: No correction needed. GitHub's REST API is stable at v3 with no v4 announced. GraphQL API is stable at v4. There are no pending breaking changes that affect Projects v2 operations.

---

### 8. Rate limit table conflates Enterprise with standard tier

**Variant affected**: `docs/connectors/github_projects.md` §8 Rate Limits

**What the doc says**:

| Limit Type | Standard | Enterprise |
|------------|----------|------------|
| Points per hour | 5,000 | 10,000 |

**Correction**: The 10,000 points/hour Enterprise rate limit applies to **github.com Enterprise accounts** and **GHEC organizations**, not to GHES (which has no per-org rate limit equivalent). On GHES, rate limiting is configured per-instance by the admin and defaults vary.

Add clarification:

> "**Enterprise rate limits** (10,000 points/hour): Apply to github.com Enterprise accounts and GHEC organizations. On **GHES**, rate limits are instance-configurable and typically set lower. Query the `X-RateLimit-*` headers to determine actual limits dynamically."

---

### 9. Webhook header `X-GitHub-Enterprise-Host` noted but misframed

**Variant affected**: `docs/connectors/github_projects.md` Appendix → Webhook Headers

**What the doc says**: `# if GHES` — implies GHES is a relevant context for the connector.

**Correction**: Since Projects v2 webhooks are not available on GHES, the `X-GitHub-Enterprise-Host` header is not relevant to this connector. It can be removed from the webhook headers reference, or moved to a GHES note section explaining it would appear on GHES-hosted webhooks for other event types.

---

## Summary

| # | Severity | Issue | Fix |
|---|---------|-------|-----|
| 1 | High | "Cloud only" conflates webhooks with API | Distinguish webhook-only constraint from API availability |
| 2 | Low | GHEC not explicitly named | Add GHEC row to hosting variants; clarify same API as github.com |
| 3 | Medium | Classic Projects sunset date missing | Add September 30, 2025 sunset date |
| 4 | Medium | GHES version requirement unclear | Specify GHES 3.7+ for API; note webhook limitation persists |
| 5 | None | Regional variants | No correction needed — GitHub has none |
| 6 | Low | API version names imprecise | Optionally add v3/v4 suffixes to API names |
| 7 | None | Breaking changes | No correction needed |
| 8 | Medium | Rate limit table misattributes Enterprise limits to GHES | Clarify Enterprise limits apply to github.com/GHEC, not GHES |
| 9 | Low | `X-GitHub-Enterprise-Host` header irrelevant to this connector | Remove or add GHES scope note |

**Recommendation**: Approve with corrections. Items 1, 3, 4, and 8 are factual corrections that affect connector behavior — these must be addressed before the doc is used for implementation. Items 2, 6, and 9 are editorial improvements. Item 5 is informational confirmation.

The core architectural claim (webhooks are cloud-only, API is GraphQL-primary) is correct and should be preserved in the rephrased text.
