# Hosting-Variants & Version-Drift Review — GitHub Connector

**Source**: `docs/connectors/github.md`
**Reviewer scope**: cloud vs self-hosted variants, API version accuracy, feature matrix, deprecations, regional/data-residency nuances, breaking changes between major API versions.

---

## Verdict

**Mostly accurate, with significant omissions.** The doc correctly identifies the two primary hosting modes (github.com and GHES) and states API base URLs correctly. However, it omits the third hosting mode (GitHub Enterprise Cloud), understates GHES minimum-version requirements for several features, contains one incorrect rate-limit claim for GitHub Apps, and is silent on API versioning headers, sunset dates, and data-residency variants. The feature-matrix differentiation between tiers is sparse.

---

## Findings

### 1. Missing hosting mode: GitHub Enterprise Cloud (GHEC)

- **Variant affected**: All
- **What the doc says**: Section 1 lists only two variants — `github.com` and GitHub Enterprise Server (GHES). The API Variants table has four rows covering github.com REST, github.com GraphQL, GHES REST, and GHES GraphQL.
- **Correction**: GitHub ships three distinct hosting modes, not two:
  1. **github.com** (multi-tenant SaaS)
  2. **GitHub Enterprise Cloud (GHEC)** — enterprise plan layered on top of github.com, same API base URL (`https://api.github.com`) but with enterprise-specific endpoints such as `GET /enterprises/{enterprise}/...` for audit logs, SAML SSO enforcement, SCIM provisioning, and enterprise-managed users (EMU).
  3. **GitHub Enterprise Server (GHES)** — self-hosted.
  GHEC is not self-hosted and does not use a custom `baseUrl`, which is why it is easy to conflate with github.com. However, connectors that need audit logs, SCIM, or EMU must use GHEC-specific endpoints. The doc should add a GHEC row to the variants table and note that GHEC shares the github.com base URL but requires enterprise slug access and different scopes.

---

### 2. GitHub REST API versioning header omitted

- **Variant affected**: github.com, GHEC, GHES 3.x+
- **What the doc says**: Section 1 references "REST API v3" throughout but never mentions the `X-GitHub-Api-Version` header introduced in late 2022.
- **Correction**: Since November 2022, GitHub REST supports explicit API version pinning via the request header `X-GitHub-Api-Version: YYYY-MM-DD` (e.g., `2022-11-28`). If the header is omitted, GitHub defaults to a compatibility version, but the behaviour of some endpoints can differ across dated versions. GitHub's versioning model uses calendar-based versions (not integer versions) and deprecations are announced per-version with specific sunset dates. The doc should state the current stable dated version and recommend pinning it in production. GHES 3.x also honours this header as of GHES 3.9.

---

### 3. GHES minimum version requirement for GitHub Apps is understated

- **Variant affected**: GHES
- **What the doc says**: Section 10 states "GHES 2.19+ supports GitHub Apps."
- **Correction**: While GHES 2.19 introduced GitHub Apps in a limited form, many features the doc describes as MVP or Phase 2 requirements have higher minimum GHES versions:
  - **Fine-grained PATs**: Not available on any GHES version at time of writing; they are github.com-only.
  - **GitHub Apps with webhook events for check runs / check suites**: GHES 3.x required; not available in GHES 2.x.
  - **GitHub Apps with `installation_repositories` events**: GHES 3.x.
  - **GitHub Apps with organisation-level installation**: GHES 2.22+.
  The doc should enumerate per-feature minimum GHES versions and flag fine-grained PATs as github.com-only.

---

### 4. Fine-grained PATs are github.com-only — not mentioned

- **Variant affected**: GHES, GHEC
- **What the doc says**: Section 2A says fine-grained PATs "support per-repo or per-org permission sets" without mentioning platform scope. Section 10 (Fine-Grained PATs) only discusses expiry and `read:org` scope.
- **Correction**: Fine-grained PATs are a github.com-only feature (as of GHES 3.12, fine-grained PATs are not available on GHES). GHEC inherits them from github.com. The doc must mark this clearly: any GHES tenant will need classic PATs or GitHub App tokens for production use.

---

### 5. GitHub App rate-limit formula is wrong

- **Variant affected**: github.com, GHEC
- **What the doc says**: Section 8 states the GitHub App installation token rate limit as "5,000 (base) + 0.5× installs bonus".
- **Correction**: The actual formula is **5,000 requests/hour base, plus 50 requests/hour per GitHub user in the organisation, up to a maximum of 15,000 per hour**. There is no "0.5× installs bonus". The bonus is tied to org size (users), not number of installations. For GHES, rate limits are configurable by the site admin and may differ from github.com defaults.

---

### 6. No mention of GHES version support lifecycle and API deprecations

- **Variant affected**: GHES
- **What the doc says**: Section 10 notes "API deprecation warnings appear 1 year before removal. GHES 3.x matches GitHub.com API v3 closely; GHES 2.x has more gaps."
- **Correction**: GHES follows a three-version support window (approximately 3 years). GHES 2.x is fully end-of-life — the last GHES 2.x release (2.22) reached end-of-life in April 2022. The doc should not present GHES 2.x as a current consideration. Active GHES versions as of early 2026 are in the 3.x series (3.9–3.14 range). The doc should specify which GHES 3.x minor versions are still supported and note that new API features (such as the `state_reason` field on issues, used in Section 4) were introduced in specific GHES 3.x releases (`state_reason` requires GHES 3.8+).

---

### 7. `state_reason` field requires minimum GHES version — not noted

- **Variant affected**: GHES
- **What the doc says**: Section 4 (Close/Reopen Issue) shows `{ "state": "closed", "state_reason": "completed" | "not_planned" | "duplicate" }` with no version caveat.
- **Correction**: The `state_reason` field was added to github.com in February 2023 and to GHES starting from GHES 3.8. Connectors targeting GHES 3.7 or earlier must omit this field or handle a graceful fallback. The outbound section should note the minimum GHES version.

---

### 8. No data-residency or regional variant coverage

- **Variant affected**: GHEC
- **What the doc says**: No mention of regional variants anywhere.
- **Correction**: GitHub Enterprise Cloud offers a **data-residency** option (announced 2024, GA for select regions) that places customer data in a specific geography (e.g., EU). GHEC data-residency tenants use a custom base URL of the form `https://api.<subdomain>.ghe.com` rather than `https://api.github.com`. This is a breaking difference for the connector's `api_base_url` logic. Connectors treating all GHEC tenants as `https://api.github.com` will fail for data-residency customers. The admin panel config field `api_base_url` is already present in the MVP scope (Section 11), which is correct, but the doc should explain why — GHEC data-residency is one key reason alongside GHES.

---

### 9. SCIM / audit log / SSO as enterprise-only features not called out

- **Variant affected**: GHEC, GHES EE
- **What the doc says**: Section 7 mentions `read:org` scope for listing org memberships. There is no mention of SCIM, SAML SSO, or audit logs.
- **Correction**: If the connector ever needs to enumerate organisation members for identity mapping, the behaviour differs significantly by tier:
  - **github.com free/team**: REST `GET /orgs/{org}/members` works with `read:org`.
  - **GHEC with SAML SSO enforced**: The same endpoint still works, but users who have not linked their SAML identity may be excluded from results. Accessing SCIM-provisioned identity data requires `admin:org` and GHEC-specific `/scim/v2/organizations/{org}/Users` endpoints.
  - **GHES**: SCIM is supported from GHES 3.x with LDAP or SAML integrations; API shape is the same SCIM v2 path.
  The doc should flag that `ghGetOrganizations()` and any future member-resolution logic behaves differently under SAML-enforced orgs.

---

### 10. GraphQL API versioning not addressed

- **Variant affected**: github.com, GHEC, GHES
- **What the doc says**: Section 1 calls it "GraphQL API v4" and the GHES row lists `https://<hostname>/api/graphql` with "Same pattern".
- **Correction**: The GitHub GraphQL API has no integer "v4" version — that label is informal and used only to distinguish it from the REST "v3" brand. The GraphQL schema evolves without versioning; breaking changes are announced and removed on a deprecation schedule. GHES GraphQL support exists from GHES 2.14 but the schema lags behind github.com (new fields and types may not be present on older GHES versions). This matters for Projects v2 (Phase 3 in the doc): `ProjectV2` types were added to github.com in 2022 but may not be present on GHES < 3.5. The doc should remove the "v4" label from GraphQL and note that GHES GraphQL schema version lags.

---

### 11. Webhook event availability on older GHES not documented

- **Variant affected**: GHES
- **What the doc says**: Section 10 says "GHES supports the same event types but may lag in new additions" without specifics.
- **Correction**: Several webhook events used in the MVP scope were added after GHES 3.0:
  - `pull_request_review_comment.deleted`: Added to github.com in 2021; GHES support from 3.3+.
  - `check_run` events: Available on GHES from 3.0+ but with differences in payload fields.
  The doc should either enumerate the minimum GHES version per event used in MVP/Phase 2, or state a blanket minimum (e.g., "GHES 3.6+ required for all event types used in this connector").

---

### 12. GitHub Apps on GHES: `X-GitHub-Hook-Installation-Target-Type` header availability

- **Variant affected**: GHES
- **What the doc says**: Section 3 lists `X-GitHub-Hook-Installation-Target-Type` as a delivery header with no platform caveat.
- **Correction**: This header was added to GHES starting from GHES 3.4. Connectors using this header for routing on earlier GHES versions will silently fail to identify the installation target. The doc should note the GHES minimum version for this header.

---

## Summary Table

| Finding | Severity | Variant |
|---------|----------|---------|
| GitHub Enterprise Cloud (GHEC) hosting mode absent | High | GHEC |
| REST API versioning header (`X-GitHub-Api-Version`) not documented | Medium | All |
| Fine-grained PATs are github.com-only | High | GHES |
| GHES minimum version for GitHub Apps understated (2.19 is EOL) | High | GHES |
| `state_reason` field requires GHES 3.8+ | Medium | GHES |
| GitHub App rate-limit formula incorrect | Medium | github.com, GHEC |
| GHES 2.x presented as current — it is fully EOL | Medium | GHES |
| GHEC data-residency custom base URL not mentioned | High | GHEC |
| SCIM/SAML SSO affects member enumeration — not noted | Low | GHEC, GHES |
| GraphQL "v4" label is informal; GHES schema lags | Low | GHES |
| Webhook event GHES minimum versions not specified | Medium | GHES |
| `X-GitHub-Hook-Installation-Target-Type` requires GHES 3.4+ | Low | GHES |
