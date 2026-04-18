# Confluence — Hosting Variants & Version-Drift Review

## Verdict

The connector doc correctly distinguishes Cloud v2 from Data Center/Server v1 at the API-path level and documents the webhooks availability threshold (v7.13+) accurately. However, it conflates Data Center and Server as a single entity, misrepresents their combined scope, omits both products' end-of-life timelines, ignores Confluence Cloud's regional data-residency variants, and contains one incorrect endpoint shape. Implementors will misconfigure Data Center tenants if they treat this as a binary cloud/self-hosted split.

---

## 1. Hosting Mode Coverage

### 1.1 — Confluence Cloud (covered)

Cloud is the primary mode in the doc — all examples, endpoints, and payloads use Cloud v2. Correct.

### 1.2 — Confluence Data Center (partially covered)

**What the doc says**: Merged with "Confluence Data Center / Server" throughout. Mentions v1 API, Basic Auth, no OAuth, webhooks from v7.13+, userKey vs accountId distinction.

**Correction**:
- Data Center and Server are separate downloadable products with separate version numbers. Confluence Server has not received new features since 2022. The doc should name them individually, not as a single "Data Center / Server" bucket.
- Confluence Server reached end of life on **February 15, 2023** (original date: February 2, 2022; Atlassian extended it once). Any new SupportAgent deployments targeting self-hosted Confluence should assume Data Center only, not Server.
- Confluence Data Center has an extended lifecycle; its current EOL is in **early 2027**. The doc should state this so implementors can advise tenants on migration planning.

**What the doc says** (line 7): "Both Confluence Cloud and Confluence Data Center/Server supported"
**Correction**: The doc should say "Confluence Cloud and Confluence Data Center supported" with a note that Server is EOL and connectors targeting self-hosted should treat Server as legacy.

**What the doc says** (line 404 in Quick Reference / line 510): `https://{server}/confluence/rest/api`
**Correction**: This is the correct v1 path for Data Center and legacy Server. Note that on Data Center the context path is configurable (`/confluence` is the default); the doc should note this is the default and may differ per deployment.

### 1.3 — Confluence Server (omitted)

**What the doc says**: Merged into Data Center section.
**Correction**: Server reached EOL 2023-02-15. Any reference to "Data Center / Server" should clarify that Server is EOL and no longer receiving security patches. New installations should use Data Center. This is important for SupportAgent tenants — a self-hosted customer still on Server needs to be flagged as a migration candidate, not a normal configuration.

---

## 2. API Version Coverage

### 2.1 — Confluence Cloud REST API v2 (covered)

**What the doc says**: All Cloud endpoints use `/wiki/api/v2`. Correct.

**What the doc says** (line 508–510): base URL table lists three entries — Cloud v2, Cloud v1 (legacy), Data Center v1.
**Correction**: Cloud v1 (`/wiki/rest/api`) should be labeled "legacy, sunset in progress." Atlassian has been deprecating v1 features incrementally. The doc should note that v1 support is reduced and v2 should be the default path for all new integrations.

### 2.2 — Confluence Data Center/Server REST API v1 (covered)

**What the doc says** (line 403–404): "No v2 API — Data Center uses v1 REST API (different endpoint structure)"
**Correction**: This is accurate. Data Center/Server use `/confluence/rest/api` (v1) with a different schema surface from Cloud v2. The doc correctly notes this, but should separate the path (`/confluence/rest/api`) from the misleading label "Data Center v1" — the underlying version is called "Confluence REST API v1" regardless of hosting mode.

### 2.3 — Missing: No v2 API on Data Center (correct but needs emphasis)

**What the doc says**: Implied throughout — all v2 endpoints are Cloud-only.
**Correction**: This should be stated as a hard constraint, not implied. Add a note: "REST API v2 (`/wiki/api/v2`) is Cloud-only. Data Center and Server expose only REST API v1 (`/confluence/rest/api`). The v2 body schemas (ADF, storage representations), the Users API, the Labels API, and the Search API have different shapes or different endpoint paths on v1. Connector logic must branch on API version, not just base URL."

---

## 3. Base URL Patterns

### 3.1 — Cloud URLs (correct)

`https://{tenant}.atlassian.net/wiki/api/v2` — correct.
`https://{tenant}.atlassian.net/wiki/rest/api` — correct (v1 legacy).

### 3.2 — Data Center/Server URL (correct, needs caveats)

**What the doc says** (line 510): `https://{server}/confluence/rest/api`
**Correction**: The base URL is correct as the default context path, but:
1. Data Center allows custom context paths during install. Not all self-hosted instances use `/confluence`. A connector config for Data Center should accept the full base URL as a config field, not construct it from a hostname + fixed path.
2. Data Center v1 API uses a versioned path like `/rest/api/3/` where the number is the Confluence version. The doc does not mention this. Older versions (pre-5.x) use just `/rest/api` without a version suffix. For Confluence 8.x Data Center, the path is `/rest/api/3/`. The doc should note this or recommend probing the versioned endpoint first.

### 3.3 — Missing: Regional Cloud URLs

**What the doc says**: `https://{tenant}.atlassian.net/wiki/api/v2`
**Correction**: Confluence Cloud is deployed in multiple regions with different base domains:
- **US Cloud** (default): `{tenant}.atlassian.net` — correct
- **EU Cloud**: `{tenant}.eu.atlassian.net`
- **Australia**: `{tenant}.au.atlassian.net`
- **Government Cloud (FedRAMP)**: `{tenant}.gov.atlassian.net`

The doc does not mention regional variants. Tenants in EU data-residency environments will fail if the connector hardcodes the US domain. The admin panel config should accept a full base URL or the tenant subdomain, not assume the US pattern.

---

## 4. Feature Matrix

### 4.1 — Webhooks

**What the doc says** (line 51–65): Cloud supports webhooks; Data Center/Server supports them "from v7.13+."
**Correction**: Correct for the threshold, but the doc should clarify:
- Confluence Server and Data Center version numbers are independent. Data Center 7.13 was released in April 2021. Any Data Center version before 7.13 lacks webhooks.
- The webhook API surface is identical on Cloud and Data Center v7.13+ — the event types (`page_created`, etc.) listed in the doc apply to both, subject to the feature availability note that `comment_removed` exists but `comment_created`/`comment_updated` do not on Cloud.

### 4.2 — User Identity

**What the doc says** (lines 290–303): Cloud uses `accountId` (UUID); Data Center uses `userKey` (string).
**Correction**: Accurate. Note that the User Resolution endpoint (`GET /wiki/api/v2/users/{accountId}`) is Cloud v2 only. Data Center/Server v1 does not have an equivalent unified user endpoint — the doc should flag this as a missing feature on self-hosted or recommend the v1 person container API.

### 4.3 — Labels API

**What the doc says** (lines 240–246): Label operations on v2.
**Correction**: The Labels API (`POST /wiki/api/v2/pages/{pageId}/labels`) is Cloud v2 only. On Data Center/Server v1, label operations use a different endpoint: `POST /rest/api/content/{contentId}/property`. The doc does not note this difference. Any connector logic for Data Center must map label operations to the v1 property API.

### 4.4 — Spaces API

**What the doc says** (line 96): `GET /wiki/api/v2/spaces`
**Correction**: Cloud v2 only. Data Center v1 uses `GET /rest/api/space`. The doc should note the v1 equivalent.

### 4.5 — Search/CQL

**What the doc says** (lines 368–384): CQL search via `GET /wiki/api/v2/pages?cql=...`
**Correction**: CQL is available on both Cloud v2 and Data Center v1, but the endpoint paths differ:
- Cloud v2: `GET /wiki/api/v2/pages?cql=...` or `GET /wiki/api/v2/search?cql=...`
- Data Center v1: `GET /rest/api/search?cql=...`

The doc only shows the v2 path.

### 4.6 — Comments (endpoint inconsistency)

**What the doc says** (line 96): `GET /wiki/api/v2/pages/{pageId}/comments` — sub-resource on page
**What the doc says** (line 163): `POST /wiki/api/v2/comments` — top-level
**What the doc says** (table line 526): `GET /wiki/api/v2/comments?containerId={pageId}&containerType=page`
**Correction**: The Confluence Cloud v2 API has two comment endpoints:
- `GET /wiki/api/v2/pages/{pageId}/comments` — list comments as sub-resource (correct per docs)
- `GET /wiki/api/v2/comments?containerId={pageId}&containerType=page` — list comments as top-level resource

The table in the Quick Reference (line 526) shows the top-level form. The polling section (line 278) shows the sub-resource form. These are two different endpoints returning the same data. The doc should be consistent and recommend one form. Additionally, Data Center v1 uses `GET /rest/api/content/{id}/child/comment` — neither form works on Data Center.

---

## 5. Known Deprecations

### 5.1 — Cloud REST API v1

**What the doc says**: Cloud v1 listed as "legacy" but no sunset date.
**Correction**: Atlassian deprecated Confluence Cloud REST API v1 features on a rolling basis. No hard sunset date is published, but v1 is in maintenance mode — new integrations should not build on it. The doc's use of v1 as a fallback path (line 509) should warn against using it for new connectors.

### 5.2 — Confluence Server

**What the doc says**: Not mentioned.
**Correction**: Confluence Server EOL: **February 15, 2023**. Atlassian no longer provides patches or support for Server. Any tenant still on Server is outside normal support. This should be flagged explicitly in the connector's onboarding checklist — tenants on Server should be warned about EOL rather than treated as a normal self-hosted configuration.

### 5.3 — Confluence Data Center EOL

**What the doc says**: Not mentioned.
**Correction**: Confluence Data Center has an extended lifecycle through early 2027. The doc should note the approximate EOL window so SupportAgent operators can plan support timelines for self-hosted tenants. This is relevant for enterprise contracts.

### 5.4 — Basic Auth on Data Center

**What the doc says** (line 37): "Basic Auth only — username + password or API token (deprecated in newer versions)"
**Correction**: The deprecation of Basic Auth on Data Center is accurate in principle — Atlassian has moved toward requiring personal access tokens (PATs) over username+password in Data Center 9+. However, the doc does not specify the threshold version where Basic Auth username+password was deprecated. Data Center 9.0+ deprecated username+password Basic Auth and requires PATs. The connector's Data Center auth path should recommend PATs for Data Center 9+ and note the version threshold.

---

## 6. Regional / Data-Residency Variants

### 6.1 — Confluence Cloud regional domains

**What the doc says**: No mention.
**Correction**: Confluence Cloud is deployed in at least four regional instances:
- **US**: `{tenant}.atlassian.net` (default)
- **EU**: `{tenant}.eu.atlassian.net`
- **Australia**: `{tenant}.au.atlassian.net`
- **US Government / FedRAMP**: `{tenant}.gov.atlassian.net`

The doc hard-codes the US pattern throughout (`https://{tenant}.atlassian.net`). Any EU or AU tenant will have a different base domain. The admin panel config for Cloud instance URL must accept the full base URL, not construct it from a tenant ID. This is not a minor gotcha — EU data-residency compliance means the US domain will reject credentials or redirect to the EU instance.

### 6.2 — Jira-tied authentication domains

**What the doc says**: No mention of Atlassian Access or domain-verified accounts.
**Correction**: Confluence Cloud tenants using Atlassian Access (SSO/SCIM) may have additional auth requirements. The basic API token auth works for individual accounts, but if the tenant enforces Atlassian Access policies, the API token may be blocked or require separate provisioning. This is worth a note even if auth mechanism is scoped out of this review.

---

## 7. Breaking Changes Between API Versions

### 7.1 — v1 vs v2 schema differences

The doc does not document any v1-vs-v2 breaking changes because it treats them as separate products. The following differences should be noted for implementors branching on version:

| Feature | Cloud v2 path | Data Center/Server v1 path |
|--------|-------------|---------------------------|
| List pages | `GET /wiki/api/v2/pages` | `GET /rest/api/content?type=page` |
| Get page | `GET /wiki/api/v2/pages/{id}` | `GET /rest/api/content/{id}` |
| List comments | `GET /wiki/api/v2/pages/{id}/comments` | `GET /rest/api/content/{id}/child/comment` |
| Post comment | `POST /wiki/api/v2/comments` | `POST /rest/api/content` (with container ref) |
| List spaces | `GET /wiki/api/v2/spaces` | `GET /rest/api/space` |
| Labels | `POST /wiki/api/v2/pages/{id}/labels` | `POST /rest/api/content/{id}/property` |
| Search | `GET /wiki/api/v2/pages?cql=...` | `GET /rest/api/search?cql=...` |
| User lookup | `GET /wiki/api/v2/users/{accountId}` | No direct equivalent |
| Attachments | `POST /wiki/api/v2/attachments` | `POST /rest/api/content/{id}/child/attachment` |

**Correction**: The doc should include a version-branching note and the v1 endpoint equivalents. Implementors who only see the v2 examples will have no path to building the Data Center connector.

---

## 8. Feature Claims That Are Actually Cloud-Only or Tiered

### 8.1 — REST API v2 is Cloud-only (should be explicit)

**What the doc says**: Implicit throughout by showing only v2 paths.
**Correction**: A hard statement is needed: "REST API v2 is Confluence Cloud-only. Confluence Data Center and Server expose only REST API v1. All endpoint examples in this document use Cloud v2; see Section X for Data Center/Server v1 equivalents."

### 8.2 — `atlas_doc_format` (ADF) body support

**What the doc says** (lines 145–157): ADF is presented as a general option.
**Correction**: ADF is fully supported on Cloud v2. On Data Center v1, the body format uses the Confluence Storage Format (XHTML-based) — ADF is not a native v1 body representation. The doc's ADF examples (listing `atlas_doc_format` in body) are valid for Cloud v2 but will not work on Data Center v1. The connector must normalize to storage format for Data Center.

### 8.3 — SAML/SSO mention (needs specificity)

**What the doc says** (line 404): "SAML/SSO — authentication may require special handling."
**Correction**: SAML/SSO is available on Confluence Cloud (via Atlassian Access) and Data Center (native SAML plugin in Enterprise tier). The doc does not distinguish which tier. On Data Center, SAML is an Enterprise-only feature. On Cloud, Atlassian Access is a paid add-on. The note should clarify: "SAML/SSO on Data Center requires Enterprise tier. On Cloud, Atlassian Access must be provisioned. Basic API token auth may be blocked if the tenant enforces Atlassian Access policies."

---

## 9. Summary of Corrections

| # | Variant affected | What the doc says | Correction |
|---|-----------------|-------------------|-------------|
| 1 | Data Center/Server | Treated as a single "Data Center/Server" entity | Split: Server is EOL (2023-02-15); Data Center is active with EOL ~early 2027 |
| 2 | Confluence Server | Not mentioned | Add explicit EOL date. New installations should target Data Center only |
| 3 | Data Center EOL | Not mentioned | Add approximate EOL window for planning |
| 4 | Cloud regional | Hard-codes `{tenant}.atlassian.net` | EU: `{tenant}.eu.atlassian.net`, AU: `{tenant}.au.atlassian.net`, Gov: `{tenant}.gov.atlassian.net` — admin config must accept full base URL |
| 5 | Cloud v2 vs DC v1 | Only shows v2; v1 equivalents omitted | Add v1 endpoint equivalents for all major operations |
| 6 | Labels API (DC) | Label operations on v2 only | Data Center v1 uses `/rest/api/content/{id}/property` |
| 7 | Comments endpoint | Inconsistent: sub-resource vs top-level | Pick one form; note both exist in v2 |
| 8 | ADF body format | Presented as general | ADF is Cloud v2 only; Data Center v1 uses storage format |
| 9 | Basic Auth deprecation | "Deprecated in newer versions" | Data Center 9.0+ deprecated username+password; PATs required |
| 10 | SAML/SSO | Generic note | Requires Enterprise tier on Data Center; Atlassian Access on Cloud (paid add-on) |
| 11 | Cloud v1 | Shown as fallback with no warning | Cloud v1 is in maintenance mode — new connectors should not target it |

---

## 10. Open Questions for the Connector Team

1. **Does SupportAgent need to support Data Center v1 at MVP?** If only Cloud is in scope initially, the Data Center sections can be marked "future" and the above corrections become lower priority.
2. **What is the minimum Confluence version for Data Center support?** If Data Center is in scope, what is the minimum supported version? Webhooks require 7.13+, which is 2021+. Older Data Center tenants would need polling only.
3. **Regional domain validation**: Should the admin panel validate that the tenant URL matches an expected regional domain pattern, or just accept any URL?
4. **Data Center context path**: Does the admin panel config expose a full base URL field for Data Center, or construct it? Configurable context paths make construction error-prone.