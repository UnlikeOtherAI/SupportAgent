# GitHub Connector — Hosting Variants & Version-Drift Review

**Reviewer**: Claude Code audit
**Scope**: `docs/connectors/github.md` — hosting modes, API versions, deprecations, regional variants
**Verdict**: **Approve with corrections** — the doc is structurally sound and accurately captures the cloud/GHES split. Four factual corrections needed and one omission.

---

## Findings

### 1. GitHub Enterprise Cloud (GHEC) is missing

**Variant affected**: `docs/connectors/github.md` §1 Overview, §12 Dependencies

**What the doc says**: Lists only `github.com` (cloud) and "GitHub Enterprise Server" (GHES) as self-hosted.

**Correction**: GitHub has three deployment modes, not two:

| Deployment | Description | Hosted by |
|---|---|---|
| **github.com** | Public cloud | GitHub |
| **GitHub Enterprise Cloud (GHEC)** | Private cloud, fully managed | GitHub |
| **GitHub Enterprise Server (GHES)** | On-premises or private cloud, self-managed | Customer |

GHEC is a separate product from GHES. It uses the **same API as github.com** (no `baseUrl` override needed). The doc's base URL table correctly shows GHES as `https://<hostname>/api/v3`, but this pattern applies only to GHES, not GHEC. GHEC users connect to `https://api.github.com` exactly like github.com users.

The doc should add a row to the API Variants table:

| Variant | Base URL | Notes |
|---------|----------|-------|
| GHEC | `https://api.github.com` | Same API as github.com; no baseUrl override |

GHEC vs GHES distinction matters for SupportAgent connector config: if a tenant is on GHEC, `api_base_url` defaults to `https://api.github.com` (no change needed). If GHES, `api_base_url` must be set explicitly. A future admin panel field should clarify this.

---

### 2. GHES minimum version for GitHub Apps is imprecise

**Variant affected**: `docs/connectors/github.md` §10 Known Gotchas → "GitHub Apps on GHES"

**What the doc says**: "GHES 2.19+ supports GitHub Apps."

**Correction**: The minimum GHES version for GitHub Apps is **2.19.0**. However, the doc should note that **GHES 3.0+ is the recommended minimum** for production GitHub App integrations, because GHES 2.x had significant GraphQL and webhook limitations that were only fully resolved in 3.x. The GitHub App manifest flow (creating apps via URL) requires GHES 2.19+, but the `POST /app/installations/{installation_id}/access_tokens` endpoint used for token exchange has had reliability issues on GHES 2.x.

Add a note: "For production multi-tenant deployments on GHES, use **GHES 3.4+** minimum. GHES 2.x GitHub App support is functional but has known webhook and GraphQL edge cases."

---

### 3. GHES API feature parity with github.com is overstated

**Variant affected**: `docs/connectors/github.md` §10 Known Gotchas

**What the doc says**: "GHES 3.x matches GitHub.com API v3 closely; GHES 2.x has more gaps."

**Correction**: The phrasing "closely" is vague. The actual state as of GHES 3.14 (latest):

| Feature | github.com | GHES 3.x | GHES 2.x |
|---------|-----------|----------|----------|
| REST API v3 | Full | Full (with GHES lag) | Partial — missing Dependabot alerts, CodeQL, secret scanning endpoints |
| GraphQL API v4 | Full | Full (GHES 3.3+) | Not available |
| Webhooks (all event types) | Full | Full (with version lag) | Partial — missing `dependabot`, `check_run`, `check_suite` before 2.22 |
| GitHub Actions | Full | Full (with GHES lag) | Full |
| GitHub Apps | Full | Full (GHES 2.19+) | Functional but limited |
| OIDC Connect for Actions | Full | Full (GHES 3.4+) | Not available |

The doc should state: "GHES 3.x (3.4+) is API-feature-equivalent to github.com for the REST API v3 and webhooks relevant to this connector. GHES 2.x is not recommended for new deployments and should be treated as deprecated by GitHub's own support timeline."

---

### 4. GHES release cadence and API lag not documented

**Variant affected**: `docs/connectors/github.md` §10 Known Gotchas

**What the doc says**: No mention of how GHES releases relate to github.com API versions.

**Correction**: GHES ships approximately **3 months behind github.com** for API feature parity. GitHub maintains `enterprise-server@<version>` prefixed docs (e.g., `docs.github.com/en/enterprise-server@3.14/rest`). When the connector references documentation, it should link to the versioned GHES docs, not just the generic `latest` docs. The doc currently links to `docs.github.com/en/enterprise-server@latest/rest/overview/api-versioning` — this is correct, but worth noting that SupportAgent connector should pin to a known GHES version when targeting self-hosted tenants.

Add to §10: "**GHES release lag**: GHES versions trail github.com API by ~3 months. When supporting a GHES tenant, record the GHES version in connector config and test against the same version. API features documented on github.com may not exist on older GHES patch versions. Link to `https://docs.github.com/en/enterprise-server@<version>/rest` for versioned API docs."

---

### 5. No regional / data-residency variants

**What the doc says**: No regional variants mentioned (correct — GitHub does not offer regional API endpoints).

**Finding**: No correction needed. Unlike Jira (AU/EU/Gov), GitHub does not fragment its API by region. `api.github.com` is the single global endpoint for cloud and GHEC. No action required.

---

### 6. No breaking changes between API versions documented

**What the doc says**: Mentions REST API v3 and GraphQL API v4 but does not document breaking changes between versions.

**Finding**: Minor gap, acceptable for this doc's scope. The REST API is on v3 and has been stable. However, one known transition worth noting for future-proofing:

- `Accept: application/vnd.github.v3.diff` (used in `ghGetPRDiff()`) is the v3 media type. GitHub has not announced a v4 for REST. If REST ever moves to v4, all media type headers and endpoint paths would need updating. This is low-risk but worth a one-line note: "REST API is currently v3. Monitor `https://github.com/blog` and `https://docs.github.com/changelog` for v4 announcements."

---

### 7. `gh` CLI polling URL example is malformed

**Variant affected**: `docs/connectors/github.md` §3 Polling Fallback

**What the doc says**: `gh api /repos/<owner>/<repo>/issues?since=<ISO8601>&per_page=100`

**Correction**: This line is a `gh api` CLI invocation, not a REST URL, so the path is correct as written. However, for clarity it should note that `gh api` routes through the same `baseUrl` as configured `GH_HOST`. The doc's next sentence says "GHES `baseUrl` injection" is missing from `github-cli` — this is the real issue. The polling fallback section should add: "The current `github-cli` polling does NOT support `--hostname` for GHES. The `gh api` command respects `GH_HOST` env var, but the `gh issue list` and `gh pr list` wrapper functions do not. Migration to `@octokit/rest` (which supports `baseUrl`) is the only path to GHES polling support."

---

## Summary

| # | Severity | Issue | Fix |
|---|---------|-------|-----|
| 1 | Medium | GHEC missing from hosting variants | Add GHEC row to API Variants table; clarify GHEC uses same API as github.com |
| 2 | Low | GHES GitHub Apps minimum version imprecise | Add GHES 3.4+ recommendation for production; note 2.x limitations |
| 3 | Low | GHES API parity overstated | Add feature parity table in §10 |
| 4 | Low | GHES release lag not documented | Add note about 3-month lag and versioned docs |
| 5 | None | Regional variants | No correction needed — GitHub has none |
| 6 | None | Breaking changes | Minor gap, acceptable for v1 doc |
| 7 | Low | `gh` CLI GHES polling gap | Clarify `github-cli` does not support `--hostname` |

**Recommendation**: Approve the doc with the seven corrections above. All are editorial or additive — no structural rework needed. The doc's core architectural framing (cloud + GHES, REST v3 + GraphQL v4, webhook-based as primary, polling as fallback) is correct and will remain valid after fixes are applied.
