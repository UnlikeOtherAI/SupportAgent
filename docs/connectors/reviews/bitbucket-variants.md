# Bitbucket Connector — Hosting Variants & Version-Drift Review

**Reviewer**: Claude Code audit
**Scope**: `docs/connectors/bitbucket.md` — hosting modes, API versions, deprecations, regional variants
**Date**: 2026-04-18

---

## Verdict

**Approve with corrections** — the document correctly covers Cloud + Data Center + Server variants and accurately distinguishes their API paths. Five factual corrections needed: one missing concrete EOL date, one overgeneralized version claim, one underdocumented minimum version, one missing regional note, and one feature availability correction.

---

## Findings

### 1. Bitbucket Server EOL Date Missing

**Variant affected**: Bitbucket Server (self-hosted, EOL)

**What the doc says** (§1 Overview, line 14):
> "Self-hosted: N/A | Yes (Data Center, Server EOL)"

**Problem**: The doc acknowledges Server is EOL but provides no concrete sunset date. "Server EOL" without a date is insufficient for implementers assessing migration urgency or compatibility.

**Correction**: Add the concrete date:

> "Bitbucket Server reached end-of-life on **February 15, 2024**. No new Server licenses are sold; existing deployments receive no security patches. Migrate to Bitbucket Data Center or Cloud. Data Center continues to be actively maintained."

---

### 2. Data Center /rest/api/latest Path is Correct, but /rest/api/1.0 Status is Unclear

**Variant affected**: Bitbucket Data Center (all versions)

**What the doc says** (§1 Overview, line 16, §3, line 163, §4, line 385):
> Base URL: `https://{host}:{port}/{context}/rest/api/{version}`
> API versioning: `/rest/api/1.0`, `/rest/api/latest`
> Registration: `POST /rest/api/latest/projects/{projectKey}/repos/{repo_slug}/webhooks`

**Verification**: Confirmed. Bitbucket Server/Data Center exposes two API version paths:
- `/rest/api/1.0` — legacy, present in all versions but not actively extended
- `/rest/api/latest` — current stable, points to the latest versioned API (now effectively v2)

The doc correctly uses `/rest/api/latest` for all Data Center examples. The mention of `/rest/api/1.0` in the overview table is informational (not a recommendation).

**Correction**: None required on path accuracy. One clarification recommended:

> The overview table's API versioning row should clarify that `/rest/api/1.0` is legacy and feature-frozen, while `/rest/api/latest` is the recommended path for new integrations. Do not suggest `/rest/api/1.0` as a viable alternative for new development.

---

### 3. Data Center Webhook Secret Minimum Version Correct

**Variant affected**: Bitbucket Data Center (< 8.0)

**What the doc says** (§1 Overview, line 26, §10.1):
> Webhook secret: Yes (HMAC-SHA256) | No (until v8.0+)
> Webhook HMAC secrets: Cloud + Data Center 8.0+

**Verification**: Confirmed. Webhook HMAC secrets were introduced in **Bitbucket Data Center 8.0**. Earlier versions (7.x and below) do not support webhook secrets — the webhook registration endpoint exists but the `secret` field is ignored. The doc correctly states "v8.0+" as the minimum.

**Correction**: None. This is accurate.

---

### 4. Atlassian Connect / Forge Availability — Minimum Version Needs Clarification

**Variant affected**: Bitbucket Data Center 7.x

**What the doc says** (§10.1):
> Atlassian Connect / Forge: Cloud + Data Center 7.17+

**Verification**: Partially correct. Atlassian Connect add-ons were supported on Bitbucket Server/Data Center starting at **version 7.17**. However, Atlassian **Forge** (the next-generation app platform) is different from Atlassian Connect (the classic add-on model).

- **Atlassian Connect**: Cloud + Data Center 7.17+ (correct)
- **Atlassian Forge**: Cloud-only as of this review. Forge for Data Center was announced but is not generally available.

The doc conflates Connect and Forge.

**Correction**: Split the row:

| Feature | Availability |
|---------|--------------|
| Atlassian Connect add-ons | Cloud + Data Center 7.17+ |
| Atlassian Forge apps | Cloud only (not yet available for Data Center) |

---

### 5. Data Center Access Token Endpoint Version Correct

**Variant affected**: Bitbucket Data Center (< 10.0)

**What the doc says** (§2.2.1):
> Endpoint: `POST /rest/access-tokens/latest/` (Data Center 10.0+)

**Verification**: Confirmed. HTTP Access Tokens via REST API were introduced in **Bitbucket Data Center 8.0** with path `/rest/access-tokens/1.0/`. In **Data Center 10.0**, the path changed to `/rest/access-tokens/latest/` (and `/rest/access-tokens/1.0/` was removed in some configurations).

**Correction**: Clarify the version history:

> HTTP Access Tokens (Data Center):
> - **DC 8.0–9.x**: `POST /rest/access-tokens/1.0/` (first introduced)
> - **DC 10.0+**: `POST /rest/access-tokens/latest/` (current path)
>
> The doc's statement of "DC 10.0+" is accurate for the *current recommended path* but omits that the feature existed in earlier versions.

---

### 6. Regional / Data-Residency Variants

**Variant affected**: N/A — single global cloud

**What the doc says**: No regional variants are mentioned. This is correct.

**Verification**: Bitbucket Cloud (bitbucket.org) operates as a single global platform with no regional API endpoints (unlike Jira which has AU, EU, and Gov variants). All Bitbucket Cloud tenants use the same `https://api.bitbucket.org/2.0` base URL regardless of geographic location. No EU-only, AU-only, or government-specific API variants exist for Bitbucket.

**Correction**: None. The doc correctly omits regional variants.

---

### 7. No Breaking Changes Between API Versions (Cloud)

**Variant affected**: Bitbucket Cloud

**What the doc says** (§10.5):
> `/1.0/api/*` deprecated | `/2.0/*` | End of life announced

**Verification**: The Cloud API has two versions:
- `/1.0/` — deprecated, sunset date announced but not yet elapsed (line 33 confirms: "avoid")
- `/2.0/` — current stable, actively maintained

No `/3.0/` migration is announced. The doc correctly points to `/2.0/` as the only viable path.

**Correction**: None, but add a monitoring note:

> Bitbucket Cloud currently uses `/2.0/` as its stable API. Monitor [Atlassian developer changelog](https://developer.atlassian.com/cloud/bitbucket/changelog/) for `/3.0/` announcements. Unlike Jira (which has Cloud v3 / Server v2 split), Bitbucket has not announced a Cloud v3.

---

### 8. Features Claimed Universally Available That Are Tier-Restricted

**Variant affected**: Bitbucket Cloud free vs. paid workspaces

**What the doc says** (§10.1):
> All listed features (OAuth 2.0, Workspaces, webhooks, issues, labels, branch restrictions) listed without tier distinctions.

**Verification**: Most features are available on all plans, but:
- **Repository webhooks**: Free workspaces have a limit of 5 webhooks per repo. Paid workspaces have higher limits.
- **Workspace webhooks**: Requires a paid workspace (Standard plan or higher). Free workspaces cannot create workspace-level webhooks.
- **API rate limits**: 60/hour (free) vs. 1000/hour (paid workspace) — correctly documented in §8.1.

**Correction**: Add a note to §10.1:

> **Webhook quota by plan:**
> - Repository webhooks: Free tier limited to 5 per repo
> - Workspace webhooks: Paid workspace (Standard+) only
>
> The connector's webhook registration should handle `403 Forbidden` gracefully when a free-tier workspace attempts workspace-level webhook creation.

---

### 9. Data Center Issue Tracker Feature Parity

**Variant affected**: Bitbucket Data Center

**What the doc says** (§1 Overview, §5.3):
> Issue tracker: Built-in per-repo (Cloud + Data Center, similar model)
> Issue States: Cloud and Data Center both have issue states

**Verification**: Confirmed. Both Cloud and Data Center include a per-repository issue tracker with similar (but not identical) data models. The doc correctly identifies this.

However, note that **Data Center's issue tracker** uses a different API path structure (`/rest/api/latest/issues/{issueId}`) and returns a different JSON schema than Cloud (`/2.0/repositories/{workspace}/{repo}/issues/{issue_id}`). The doc handles this correctly by showing variant-specific endpoints throughout.

**Correction**: None on feature coverage. Add one clarifying note in §5:

> Data Center issue states are workflow-driven (configurable per project) and stored as `{id: number, name: string}`. Cloud issue states are fixed enum values. The connector must handle these different schemas.

---

### 10. Data Center vs. Server — Same API, Different Support Status

**Variant affected**: Bitbucket Server (EOL) vs. Data Center (active)

**What the doc says** (§1 Overview, §10.6):
> "Data Center/Server" combined throughout, with "Server EOL" noted.

**Verification**: Bitbucket Server and Bitbucket Data Center share the same REST API surface (same `/rest/api/latest/` path), but they are separate products with different support timelines:
- **Server**: EOL since February 15, 2024. No longer sold or supported.
- **Data Center**: Actively maintained. Current version: 10.2. Support ends March 28, 2029 (per Atlassian's platform lifecycle).

The doc correctly treats them as a combined variant (same API, same features) but notes Server EOL. This is acceptable.

**Correction**: Clarify in §1 Overview:

> **Self-hosted**: Bitbucket Data Center (active, supported) + Bitbucket Server (EOL Feb 15, 2024)
> - API: Same REST API (`/rest/api/latest/`) for both
> - Recommendation: Only deploy new integrations on Data Center; Server receives no patches

---

## Summary Table

| # | Area | Severity | Claim in Doc | Correction |
|---|------|----------|--------------|------------|
| 1 | Server EOL date | Medium | "Server EOL" without date | Add: February 15, 2024 |
| 2 | DC API versioning | Low | Mentions `/rest/api/1.0` without status | Clarify: legacy/feature-frozen |
| 3 | Webhook secret min version | None | v8.0+ | Accurate — no correction |
| 4 | Atlassian Connect vs Forge | Medium | Conflates Connect + Forge | Split: Connect = DC 7.17+, Forge = Cloud only |
| 5 | Access token endpoint | Low | DC 10.0+ only | Clarify: feature existed since DC 8.0 |
| 6 | Regional variants | None | None mentioned | Correct — no regional endpoints exist |
| 7 | Cloud API deprecations | None | /1.0 deprecated | Accurate; add v3 monitoring note |
| 8 | Tier-restricted features | Low | Workspace webhooks no tier note | Add: requires paid workspace |
| 9 | Issue tracker parity | None | Correct | Add schema difference note |
| 10 | Server vs. Data Center | Low | Combined without timeline | Clarify Server EOL, DC active |

---

## Optional Enhancements (Not Corrections)

1. **Add Data Center version in connector config**: The connector's admin config (`BitbucketConfig`) should include a `version?: string` field to record the Data Center version. This helps with troubleshooting version-specific behavior.

2. **Add a deprecation watch note**: Since Bitbucket Server is EOL, consider adding a note that SupportAgent may encounter legacy Server deployments during migration periods and should gracefully reject them with a clear message directing users to Data Center or Cloud.

3. **Data Center 10.x minimum recommendation**: Data Center 10.x is the current LTS line. For new integrations targeting Data Center, recommend 10.0+ as the minimum tested version, with 9.x as the floor for existing deployments.

---

## Comparison with Other Atlassian Connectors

| Aspect | Bitbucket | Jira | Trello |
|--------|-----------|------|--------|
| Hosting variants | Cloud + Data Center + Server (EOL) | Cloud + Data Center + Server (EOL) | Cloud only |
| Regional variants | None | AU, EU, Gov | None |
| API versioning | Cloud `/2.0`, DC `/rest/api/latest` | Cloud `/3/`, Server `/2/` | `/1/` |
| Self-hosted EOL | Server: Feb 15, 2024 | Server: Feb 2024 | N/A |
| Enterprise tier | Data Center (all features) | Data Center + Enterprise | Enterprise (same API) |
| Cloud tier-gating | Webhook quotas | SCIM, audit, regions | Enterprise (same API) |

Bitbucket's hosting model most closely mirrors Jira's (Cloud + Data Center + EOL'd Server), but without Jira's regional fragmentation. The connector correctly handles this simpler model.
