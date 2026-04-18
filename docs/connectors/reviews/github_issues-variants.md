# GitHub Issues Connector — Hosting Variants & Version-Drift Review

> Audited against: `docs/connectors/github_issues.md` (v1.0, 2026-04-18)
> Reviewer scope: hosting-mode variants, API version correctness, base URL accuracy, feature tiers,
> deprecations, regional gotchas, and breaking-change straddling.

---

## Verdict

**Conditionally approved.** The document is accurate for the scope it covers (github.com + GHES), but
has two factual correctness issues, one omission of a distinct hosting variant, and several
precision gaps around GHES minimum-version claims. None are blocking for an MVP but all should be
corrected before the doc is treated as authoritative.

---

## Findings

### 1. `[CORRECTION — Factual]` Webhook support predates GHES 2.20

- **Affected variant**: GitHub Enterprise Server
- **What the doc says** (Section 1, Table): "Webhooks: Full support | Full support (since GHES 2.20)"
- **Correction**: Webhooks existed on GHES well before 2.20. GHES 2.20 introduced repository
  webhooks with full payload delivery. Earlier versions had org-level webhooks only. The claim
  "since GHES 2.20" is ambiguous — if the intent is "full webhook feature parity with github.com",
  that milestone is approximately correct. If the intent is "webhooks first appeared", it is wrong.
  **Change to**: "Full support (GHES 2.20+ for repository-scoped webhooks; org-level webhooks existed
  earlier.)"

### 2. `[CORRECTION — Factual]` GHES versioning is decoupled from API versioning

- **Affected variant**: GitHub Enterprise Server
- **What the doc says** (Section 1, Table): GHES column header implies feature availability by GHES
  version numbers (2.20, 3.4, 3.0)
- **Correction**: GitHub explicitly states that GHES releases are decoupled from REST API versions.
  `X-GitHub-Api-Version: 2022-11-28` is supported on all currently-supported GHES versions regardless
  of the GHES release number. The version numbers in the table (3.0, 3.4, 2.20) refer to GHES release
  trains, not API versions. **Add a note**: "GHES release version and REST API version are
  independent. All currently-supported GHES releases use `X-GitHub-Api-Version: 2022-11-28`."

### 3. `[OMISSION — Scope Gap]` GitHub Enterprise Cloud (GHEC) not named

- **Affected variant**: GitHub Enterprise Cloud (GHEC)
- **What the doc says** (Section 1, Overview): "GitHub.com (cloud)" — treats github.com and GHEC
  as one
- **Correction**: GHEC (`github.com/enterprise`) is a distinct hosted enterprise product from
  plain github.com. It shares the same API endpoints and base URL as github.com, but ships
  enterprise-only admin features (audit log streaming, IP allowlists, SAML, SCIM, Enterprise
  Managed Users). For the Issues API specifically, the endpoint surface is identical. **Add GHEC as a
  row in the hosting table**: `| GitHub Enterprise Cloud | `https://api.github.com` | Same as
  github.com |`. The implication for this connector is nil (same base URL, same endpoints), but
  naming it signals awareness of the product hierarchy.

### 4. `[PRECISION — Minor]` Fine-grained PAT minimum version may be higher than 3.4 on older GHES trains

- **Affected variant**: GitHub Enterprise Server (older patch releases)
- **What the doc says** (Section 1, Table): "Fine-grained PATs: Yes (GHES 3.4+)"
- **Correction**: Fine-grained PATs shipped in GHES 3.4.0. Patch releases (e.g. 3.4.1, 3.4.2)
  also include them. If a tenant is on GHES 3.4.0 exactly, fine-grained PATs are available. If
  they are on GHES 3.3.x or below, they are not. The `(GHES 3.4+)` notation is correct. **No
  change needed**, but clarify: "+ means 3.4.0 and all subsequent 3.4.x patch releases."

### 5. `[PRECISION — Minor]` Projects v2 availability on GHES

- **Affected variant**: GitHub Enterprise Server
- **What the doc says** (Section 1, Table): "Projects v2: Yes (GHES 3.4+)"
- **Correction**: Projects (the v2/item-based Projects, distinct from legacy Projects v1) became
  generally available on github.com in 2022. GHES support landed in GHES 3.4. This is accurate.
  However, Projects is an opt-in beta on GHES in 3.4 and became stable in GHES 3.5+. **Change to**:
  "Projects (v2): Yes (GHES 3.4+; stable in GHES 3.5+)".

### 6. `[ACCURATE — No Change]` Base URL for GHES

- **Affected variant**: GitHub Enterprise Server
- **What the doc says**: `https://<host>/api/v3`
- **Verdict**: Accurate. GHES uses `/api/v3` as the versioned prefix. Older GHES pre-2.x used
  `/api/v2`, but no supported GHES version uses that now. Current supported GHES releases all use
  `/api/v3`. No change needed.

### 7. `[ACCURATE — No Change]` REST API version header

- **Affected variant**: All
- **What the doc says**: `X-GitHub-Api-Version: 2022-11-28`
- **Verdict**: Correct and current as of 2026-04. This is the only supported API version for all
  GitHub products (github.com, GHEC, GHES). No change needed.

### 8. `[ACCURATE — No Change]` GraphQL v4 on GHES

- **Affected variant**: GitHub Enterprise Server
- **What the doc says**: "GraphQL: Yes (GHES 3.0+)"
- **Verdict**: GraphQL API on GHES requires GHES 3.0+. Accurate. No change needed.

### 9. `[ACCURATE — No Change]` No regional/data-residency variants for GitHub

- **Affected variant**: All
- **Verdict**: GitHub does not have region-specific API endpoints (unlike Jira EU/AU). There is no
  `api.eu.github.com` or equivalent. GitHub Enterprise Cloud offers data residency commitments via
  the Business SKU but the API remains at `api.github.com`. The doc correctly does not mention
  regional variants. No change needed.

### 10. `[ACCURATE — No Change]` No breaking-change straddling detected

- **Affected variant**: All
- **Verdict**: The document uses only the current API version (2022-11-28). There are no references
  to deprecated API versions being actively straddled (e.g., no mention of `2012-10-10` or earlier
  versions). The deprecation of the Events API (`/events`) in favor of the Timeline API is
  mentioned in the gotchas. No straddling issues found.

### 11. `[ACCURATE — No Change]` Rate limit cloud vs GHES

- **Affected variant**: GitHub.com vs GHEC vs GHES
- **Verdict**: github.com and GHEC have 5,000 req/hour for authenticated requests. GHES default is
  also 5,000 req/hour but is configurable by the instance admin. The doc states "5,000/hour
  authenticated" which is accurate for github.com and GHEC defaults, and conservative/acceptable
  for GHES. No change needed, but consider a footnote: "GHES rate limits are admin-configurable."

### 12. `[PRECISION — Minor]` `issue_dependencies` webhook event

- **Affected variant**: GitHub Enterprise Server
- **What the doc says** (Section 3, Event Types): Lists `issue_dependencies` event with actions
- **Correction**: The `issue_dependencies` event is part of the Dependency Graph feature, which
  requires the repository to have dependency graph enabled. On GHES, the Dependency Graph is
  available from GHES 3.0+. The event should not be assumed universally available. **Add note**:
  "`issue_dependencies` requires dependency graph to be enabled (GHES 3.0+)."

### 13. `[ACCURATE — No Change]` Enterprise plan feature matrix

- **Affected variant**: GitHub.com (per-user plan tiers)
- **What the doc says** (Section 10, Features by Plan): Free/Pro/Team/Enterprise table
- **Verdict**: The table correctly shows that basic issue features (assignees, labels, milestones,
  webhooks) are available on all plans. Fine-grained PATs row notes GHES 3.4+ correctly. No
  issues found.

---

## Summary Table

| # | Severity | Type | Variant | Status |
|---|----------|------|---------|--------|
| 1 | Medium | Factual correction | GHES | Needs fix |
| 2 | Low | Precision | GHES | Needs fix |
| 3 | Low | Omission | GHEC | Needs fix |
| 4 | Low | Precision | GHES | Clarify |
| 5 | Low | Precision | GHES | Needs fix |
| 6 | — | Verified accurate | GHES | No change |
| 7 | — | Verified accurate | All | No change |
| 8 | — | Verified accurate | GHES | No change |
| 9 | — | Verified accurate | All | No change |
| 10 | — | Verified accurate | All | No change |
| 11 | — | Verified accurate | All | Footnote suggested |
| 12 | Low | Precision | GHES | Needs fix |
| 13 | — | Verified accurate | github.com | No change |

---

## Out of Scope (Confirmed Not Covered)

The following were requested in the original audit template but are correctly absent from this doc
because the connector is GitHub-specific:

- GitLab variants (gitlab.com, self-managed CE/EE, Dedicated) — not relevant
- Bitbucket variants (Cloud, Data Center, Server) — not relevant
- Jira variants (Cloud, Data Center, Server) — not relevant
- Sentry variants (sentry.io, on-premise) — not relevant
- Linear, Trello, Slack, Teams, WhatsApp — not relevant

If a future connector audit covers these platforms, the template criteria should be applied
separately.
