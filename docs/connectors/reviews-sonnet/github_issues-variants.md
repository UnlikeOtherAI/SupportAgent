# Hosting-Variants & Version-Drift Review — GitHub Issues Connector

**Source**: `docs/connectors/github_issues.md`
**Reviewer focus**: cloud vs self-hosted coverage, API versions, base URLs, feature matrix, deprecations, regional/data-residency, breaking changes

---

## Verdict

**Mostly sound, but incomplete on several variant-specific points.** The doc correctly distinguishes github.com from GHES and provides accurate base URLs. However, it omits GitHub Enterprise Cloud (GHEC) as a distinct hosting mode, understates the GHES version floor for several features, misrepresents the REST pagination model versus GraphQL cursor pagination, and makes no mention of data-residency options or known API deprecations/sunset dates.

---

## Findings

### 1. Missing hosting mode: GitHub Enterprise Cloud (GHEC)

- **Variant affected**: GitHub Enterprise Cloud
- **What the doc says**: Section 1 lists only "GitHub.com (cloud) + GitHub Enterprise Server (GHES)". The feature comparison table in section 1 has two columns: GitHub.com and GHES.
- **Correction**: GitHub ships three distinct hosting modes, not two:
  - **github.com** — standard SaaS
  - **GitHub Enterprise Cloud (GHEC)** — managed SaaS with org-level SAML SSO, audit log streaming, SCIM provisioning, IP allow-lists, and data-residency options (EU residency GA as of 2024). GHEC uses the same `https://api.github.com` base URL as github.com but behaves differently for auth (SAML SSO enforcement applies at org level, PATs require per-org authorization).
  - **GitHub Enterprise Server (GHES)** — self-hosted VM
  - The doc conflates github.com with GHEC. GHEC needs its own column in the feature matrix, particularly for SAML SSO PAT requirements, audit log API, SCIM endpoints, and EU data residency.

---

### 2. GHES minimum version floor understated for `state_reason`

- **Variant affected**: GHES
- **What the doc says**: Section 3 (payload fields) and section 4 (Change State) reference `state_reason` (`completed`, `not_planned`, `reopened`) without any GHES version caveat. Section 10 item 7 ("State reason") also documents the reopening behavior without version qualification.
- **Correction**: The `state_reason` field on issues was introduced in the GitHub REST API tied to the `2022-11-28` API version date header. On GHES, this field is only available on **GHES 3.7 and later**. Instances on GHES 3.6 or earlier will not return `state_reason` and the PATCH body field will be silently ignored or may return a 422. The doc should note a minimum GHES 3.7 requirement for this field.

---

### 3. GHES minimum version floor for Projects v2

- **Variant affected**: GHES
- **What the doc says**: Feature table in section 1 states "Projects v2: Yes (GHES 3.4+)". Section 5 and Phase 3 of section 11 document Projects v2 REST endpoints as generally available. The note "Yes (GHES 3.4+)" is present in the summary table but the detailed endpoint list in sections 5 and 11 carries no version caveat.
- **Correction**: Projects v2 GraphQL API reached feature parity on GHES 3.6; the REST API for Projects v2 (`/orgs/{org}/projectsV2`, `/repos/{owner}/{repo}/projectsV2`) is only available on **GHES 3.6+**. The 3.4 figure in the table appears to conflate early GraphQL Projects v2 preview availability with full REST support. The Phase 3 endpoint list should carry a "GHES 3.6+" note.

---

### 4. Fine-grained PATs minimum GHES version inconsistency

- **Variant affected**: GHES
- **What the doc says**: Section 1 feature table says "Fine-grained PATs: Yes (GHES 3.4+)". Section 13 open question 7 asks "Any tenants on GHES < 3.4?" Section 2 auth recommendation names fine-grained PATs as MVP-recommended without restating the GHES floor.
- **Correction**: The "GHES 3.4+" figure in the table is correct. However, fine-grained PATs on GHES require the GHES administrator to explicitly **enable** them under site admin settings — they are not on by default even on 3.4+. This is a common deployment gotcha: a connector configured with a fine-grained PAT may fail against GHES even on a qualifying version if the admin has not enabled the feature. This should be called out as a known self-hosted gotcha.

---

### 5. GraphQL availability GHES version floor

- **Variant affected**: GHES
- **What the doc says**: Feature table says "GraphQL: Yes (GHES 3.0+)".
- **Correction**: The GraphQL API was introduced in GHES **2.14** (not 3.0). GHES 3.0+ is accurate for a useful subset of GraphQL schema that matches github.com, but the floor for basic GraphQL availability is lower. More practically, the Projects v2 GraphQL schema only fully landed at **GHES 3.5+**. The table entry should clarify: GraphQL core from GHES 2.14, Projects v2 GraphQL from GHES 3.5.

---

### 6. No mention of GHES base URL for OAuth / GitHub App flows

- **Variant affected**: GHES
- **What the doc says**: Section 2 OAuth App lists authorization URL as `https://github.com/login/oauth/authorize` and token URL as `https://github.com/login/oauth/access_token`. GitHub App JWT exchange is not given a URL.
- **Correction**: On GHES, these OAuth URLs are different:
  - Authorization URL: `https://<host>/login/oauth/authorize`
  - Token URL: `https://<host>/login/oauth/access_token`
  - GitHub App installation token exchange: `https://<host>/api/v3/app/installations/{id}/access_tokens`
  The doc covers the REST base URL difference (`/api/v3`) in the feature table but does not propagate this to the auth section. An implementer following only section 2 for GHES would use the wrong OAuth endpoints.

---

### 7. No data-residency / regional coverage

- **Variant affected**: GitHub Enterprise Cloud (GHEC) — EU data residency
- **What the doc says**: No mention of data residency anywhere.
- **Correction**: GitHub Enterprise Cloud offers **EU data residency** (generally available since mid-2024). For GHEC tenants with EU residency enabled, the API base URL changes to `https://api.github.com` but data is stored in EU region — no URL difference, but compliance requirements may mandate that the connector's own data handling (webhook ingestion, issue body storage) also be EU-resident. This is a data-residency consideration for enterprise tenants and should be flagged in section 1 and the gotchas section.

---

### 8. Pagination model mischaracterized

- **Variant affected**: All (github.com, GHEC, GHES)
- **What the doc says**: Section 9 states "Page-based (not cursor-based)" as the pagination style for REST. Section 10 gotcha 5 states "Timeline uses cursor-based pagination internally but exposes page-based API."
- **Correction**: The characterization of REST pagination as page-number-based (`?page=N`) is correct for list endpoints. However, the `Link` header–driven navigation (following `rel="next"`) is the **recommended** approach and is effectively link-based, not random-access page-number-based. More importantly, the statement in gotcha 5 that the timeline endpoint "exposes page-based API" is incorrect: `GET /repos/{owner}/{repo}/issues/{issue_number}/timeline` uses **cursor-based pagination** via `Link` headers and the `?cursor=` parameter — it does not support arbitrary `?page=N` access. This distinction matters for reliable sync because page-number-based polling can miss items on page boundaries during active writes; cursor-based links do not have this problem.

---

### 9. `issue_dependencies` event does not exist in the standard GitHub webhook catalog

- **Variant affected**: github.com, GHEC, GHES
- **What the doc says**: Section 3 event table lists an `issue_dependencies` event with actions `blocking_added`, `blocking_removed`, `blocked_by_added`, `blocked_by_removed`.
- **Correction**: As of the current GitHub REST/webhook API, there is **no `issue_dependencies` webhook event**. Issue dependencies (sub-issues and issue references) are tracked via the GraphQL API and the issue timeline feed, but there is no outbound webhook event for dependency graph changes on standard GitHub Issues. This appears to be either a hallucinated entry or a confusion with a third-party GitHub app event. The row should be removed or clearly marked as "not currently available via native GitHub webhooks."

---

### 10. Events API endpoint described as deprecated

- **Variant affected**: All
- **What the doc says**: Section 10 API gotcha 3 notes `GET /repos/{owner}/{repo}/issues/{issue_number}/events` as "limited, deprecated" in contrast to the timeline endpoint.
- **Correction**: The issue events endpoint is **not officially deprecated by GitHub** as of 2026. It is limited in scope compared to the timeline endpoint (it covers issue-specific events like label, milestone, assignment changes, but not all timeline entries), but it has not been given a sunset date. Calling it deprecated without a citation or sunset date is misleading. The correct characterization is: "narrower scope than timeline; prefer timeline for comprehensive history."

---

### 11. No known deprecation / sunset dates documented

- **Variant affected**: All
- **What the doc says**: The doc does not list any deprecation notices or sunset dates.
- **Correction**: The following known deprecations are relevant:
  - **`X-GitHub-Api-Version` header**: The `2022-11-28` version is the stable current version. GitHub has not yet announced a sunset for this version, but the header-based versioning system means implementers should monitor GitHub's API changelog for future `BREAKING CHANGE` notices on this date string.
  - **Classic PATs (non-fine-grained)**: GitHub is progressively restricting classic PATs for organizations (orgs can require fine-grained PATs). No hard sunset date has been announced, but GitHub has signalled intent to eventually remove them. The doc recommends fine-grained PATs, which is correct, but should note that classic PATs face increasing org-level restrictions.
  - **Projects v1 (classic)**: The doc's feature matrix lists "Projects v1: Yes" across all tiers. GitHub deprecated Projects v1 (classic projects) in 2024 and began redirecting users to Projects v2. The REST endpoints for classic projects (`/repos/{owner}/{repo}/projects`, `/orgs/{org}/projects`) were slated for removal. The doc should flag Projects v1 as deprecated/removed and replace the feature matrix entry accordingly.

---

### 12. SSO / SCIM / audit-log features not mentioned as enterprise-only

- **Variant affected**: GHEC
- **What the doc says**: Section 2 mentions "SAML SSO orgs" as a reason to graduate from PAT to GitHub App, but does not enumerate what SAML SSO, SCIM, or audit-log features exist and which hosting tier they require.
- **Correction**: The following features are **GHEC / GHES Enterprise-only** and should be noted in a feature matrix or gotchas:
  - **SAML SSO enforcement** — GHEC and GHES (Enterprise-licensed) only
  - **SCIM provisioning** — GHEC only (not available on GHES as of 2026)
  - **Audit log streaming** — GHEC only
  - **IP allow-lists** — GHEC and GHES 3.x Enterprise
  - **Required two-factor authentication** — GHEC org policy
  These affect connector behavior: a SAML SSO org will reject PATs that haven't been authorized via SAML SSO dance, regardless of scopes.

---

### 13. Projects v2 REST endpoint paths are non-standard / likely incorrect

- **Variant affected**: All
- **What the doc says**: Section 5 and Phase 3 of section 11 list endpoints such as `POST /projects/{project_id}/items`, `PATCH /projects/items/{item_id}`, `DELETE /projects/items/{item_id}`, `GET /projects/{project_id}/fields`.
- **Correction**: The Projects v2 **REST API** is not currently publicly available at these paths. Projects v2 is managed entirely through the **GraphQL API** (mutations: `addProjectV2ItemById`, `updateProjectV2ItemFieldValue`, etc.). The REST paths listed do not exist in the GitHub REST API as of 2026 — they appear to be fabricated. Any Projects v2 integration must go through `POST /graphql`. The doc should replace these REST path references with the correct GraphQL mutations and note the GraphQL-only requirement.

---

## Summary of High-Priority Corrections

| # | Issue | Severity |
|---|-------|----------|
| 1 | GHEC missing as distinct hosting mode | High |
| 6 | OAuth / GitHub App URLs wrong for GHES | High |
| 9 | `issue_dependencies` webhook event does not exist | High |
| 13 | Projects v2 REST endpoint paths are fabricated; API is GraphQL-only | High |
| 11 | Projects v1 deprecated/removed; classic PATs org-restricted | Medium |
| 2 | `state_reason` requires GHES 3.7+, not covered | Medium |
| 3 | Projects v2 REST requires GHES 3.6+, not 3.4+ | Medium |
| 4 | Fine-grained PATs require explicit GHES admin enablement | Medium |
| 7 | No data-residency coverage for GHEC EU | Medium |
| 12 | SAML SSO / SCIM / audit features not flagged as enterprise-only | Medium |
| 5 | GraphQL GHES floor is 2.14, not 3.0 | Low |
| 8 | Timeline endpoint uses cursor pagination, not page-number | Low |
| 10 | Issue events endpoint is not deprecated | Low |
