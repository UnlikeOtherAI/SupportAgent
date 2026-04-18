# Asana Connector — Hosted Variants & Version-Drift Audit

**Reviewer:** Claude Code (hosting-variants + version-drift angle)
**Source:** `docs/connectors/asana.md`

---

## Verdict: ACCURATE WITH MINOR COMPLETENESS GAPS

The Asana connector doc is largely correct on hosting modes and API versioning. Asana's unified cloud-only SaaS model with regional data residency makes this a simpler audit than GitHub/GitLab/Jira variants. No significant errors found, but a few enhancements would improve accuracy.

---

## Findings

### 1. Hosting Modes — ACCURATE

**Variant:** Asana cloud (all tiers)

**What the doc says (Section 1):**
> Cloud vs Self-Hosted: Cloud-only. Asana does not offer a self-hosted deployment option. There are two data residency regions: US (default) and EU.

**Correction:** None required. This is correct.

**Verification:**
- Asana has never offered a self-hosted version.
- No Asana "Enterprise Server" equivalent exists.
- The only deployment variants are US-cloud and EU-cloud (data residency), both using identical API endpoints.

---

### 2. API Versioning — ACCURATE

**Variant:** All Asana (US/EU)

**What the doc says (Section 1):**
> API Versioning: URL path versioning (`/1.0/`). Current stable is 1.0.

**Correction:** None required.

**Verification:**
- Asana API has been versioned at `1.0` since ~2012.
- No v2, v3, or other API major versions exist or are announced.
- All endpoints consistently use `/api/1.0/` path prefix.
- No "straddling" between API versions is possible — there is only one.

---

### 3. Base URL Pattern — ACCURATE

**Variant:** US (default) and EU data residency

**What the doc says (Section 1):**
> - US: `https://app.asana.com/api/1.0`
> - EU: `https://app.asana.com/api/1.0` (same path; data residency configured at workspace level)

**Correction:** None required.

**Verification:**
- Both US and EU use `app.asana.com/api/1.0`.
- Data residency is configured at the workspace/organization level, not the URL.
- No regional subdomain variants (e.g., no `eu.app.asana.com`).

**Enhancement opportunity:** Could clarify that Asana recently introduced an optional `domain` parameter for certain enterprise features, but this doesn't change API base URLs.

---

### 4. Feature Matrix — ACCURATE WITH ONE GAP

**Variant:** Enterprise vs other tiers

**What the doc says:**

| Claim | Section | Accuracy |
|-------|---------|----------|
| Service Accounts are Enterprise-only | 2.5, 11.1 | Correct |
| All webhook endpoints work universally | 3.1 | Correct |
| All task CRUD works universally | 4.x | Correct |
| Goals/OKR as Phase 3 feature | 11.3 | Accurate |

**Correction needed:** None — but add this nuance:

**Section 11.3 Enhancement:**
> Goals/OKR integration uses a separate API resource (`/goals`) and may have different availability timing than core task APIs. Verify Goals API availability at time of implementation — it launched Enterprise-limited but may have expanded to other tiers.

---

### 5. Deprecations — MINOR GAP

**Variant:** All Asana

**What the doc says (Section 9.2):**
> Without pagination (legacy): ~1,000 items (deprecated behavior)

**Correction:** None required, but could add context:

**Suggested addition to Section 10 or 9.2:**
> Asana deprecated non-paginated bulk responses in 2019. Clients that request >100 items without pagination may receive truncated results with a warning. Always use explicit `limit` and `offset`/`next_page` tokens.

**No concrete sunset dates** exist in the doc because Asana hasn't announced formal sunset dates for legacy pagination behavior — it's deprecated in behavior only, not formally removed.

---

### 6. Regional/Data-Residency — COMPLETE

**Variant:** US (default) vs EU

**What the doc says (Section 1, 10.2):**
> There are two data residency regions: US (default) and EU.
> The API endpoint is the same (`app.asana.com/api/1.0`), but workspace data stays in EU.

**Correction:** None required.

**Verification:**
- Asana officially launched EU data residency in 2021.
- Both regions use identical API endpoints.
- The only observable difference is data-at-rest location.
- No other regional variants (AU, APAC-specific API endpoints, etc.) exist.

**Minor gap:** No mention of whether EU data residency has any functional limitations (e.g., third-party integrations, compliance certifications). This is a documentation gap, not an API variant issue.

---

### 7. Breaking Changes — NOT APPLICABLE

**Variant:** N/A (single API version)

Asana has not had breaking changes between major API versions because there is only one API version (1.0). Any breaking changes are communicated as:
- Field deprecations with `warn_if_unsupported` responses
- `400` errors with descriptive messages

The doc doesn't need to address this section.

---

### 8. Self-Hosted Minimum Version — NOT APPLICABLE

**Variant:** N/A

Asana has no self-hosted option, so there are no server version requirements to track.

---

### 9. Enterprise-Only Features — ACCURATE

**Feature:** Service Accounts

**What the doc says (Section 2.5):**
> Service Account — Enterprise-only feature

**Correction:** None required.

**Verification:**
- Service Accounts launched as Enterprise-only.
- No announced plans to extend to lower tiers.
- PATs and OAuth work on all tiers.
- SCIM provisioning for user management is Enterprise-only but outside connector scope.

---

### 10. Endpoints with Variant Paths — NOT APPLICABLE

Unlike Jira (v2 vs v3) or GitHub (REST vs GraphQL), Asana has:
- No API version differences between tiers.
- No v2/v3 endpoint path differences.
- All documented endpoints (`/tasks`, `/stories`, `/webhooks`, `/batch`, etc.) work identically across all tiers.

---

## Summary of Corrections

| # | Severity | Location | Issue | Fix |
|---|----------|----------|-------|-----|
| 1 | Enhancement | Section 11.3 | Goals/OKR tier availability unclear | Add note about Enterprise-first rollout |
| 2 | Enhancement | Section 9.2 | Legacy pagination lacks context | Add note about 2019 deprecation and truncation behavior |

**No blocking issues found.** The doc correctly identifies Asana as cloud-only with US/EU data residency as the only variant axes.

---

## Comparison to Audit Criteria

| Criteria | Status |
|----------|--------|
| Cloud vs self-hosted distinction | Correct — cloud-only |
| All hosting modes covered | Correct — US + EU only |
| API version per variant | Correct — v1.0 only |
| Base URL pattern per variant | Correct — identical |
| Feature matrix (tier differences) | Correct — Service Accounts Enterprise-only |
| Deprecations with sunset dates | Partial — no formal sunset dates exist |
| Regional/data-residency variants | Complete — US + EU |
| Breaking changes between versions | N/A — single version |
| Cloud-only features flagged | Correct — all features universal |
| Endpoints with variant paths | N/A — no path differences |

---

*Last verified against Asana API documentation: 2026-04-18*
