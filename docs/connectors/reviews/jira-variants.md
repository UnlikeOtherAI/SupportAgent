# Jira Connector — Hosting Variants & Version Drift Review

**Reviewer:** Claude Code audit
**Source:** `docs/connectors/jira.md`
**Date:** 2026-04-18

---

## Verdict

**RED — Significant gaps.** The document conflates Data Center and Server, omits the Server EOL, misrepresents Data Center API versioning, does not address regional cloud deployments, and lacks a version-requirement matrix for key API features. These are not minor omissions; they affect correctness of integration scope, support timeline, and API feature availability.

---

## Findings

### 1. Jira Software Server EOL — Not Mentioned

**Variant affected:** Jira Software Server
**Severity:** Critical

**What the doc says:**
> Self-Hosted Availability: Yes (Jira Data Center / Server)

Both Data Center and Server are listed as "self-hosted availability: Yes" with no distinction. The summary table on line 13 has the same issue.

**Correction:**
Jira Software Server reached **end of life on February 15, 2024**. Atlassian stopped issuing new Server licenses and no longer provides security updates. Existing Server customers should migrate to Data Center or Cloud. The connector **must not target Server** — it should explicitly state this.

Action: Update the overview and all references to "Data Center / Server" to read "Data Center only" and add a deprecation notice box.

---

### 2. Data Center REST API Version — Incorrect

**Variant affected:** Jira Data Center
**Severity:** High

**What the doc says:**
> | Feature | Jira Cloud | Jira Data Center |
> |---------|------------|------------------|
> | API Version | REST API v3 | REST API v8+ |

The doc implies that Data Center's REST API version maps to the software version number (v8+). This is wrong.

**Correction:**
Jira Data Center does not use the same API version numbering as its software version. The Data Center REST API:
- Historically exposed the same API as Server, with REST API v2 being the standard
- REST API v3 became available on Data Center 8.13+
- Data Center 9.x and 10.x support REST API v3
- The version number in the URL (`/rest/api/2/` or `/rest/api/3/`) is independent from the software version

The connector must determine the Data Center software version to know which API endpoints are available. A minimum version check is needed for any v3-only features.

Action: Replace "REST API v8+" with a version matrix:
| Data Center Version | REST API Version | Notes |
|--------------------|-----------------|-------|
| 8.13 – 8.20 | v2, partial v3 | v3 features vary |
| 9.x | v2, v3 | Full v3 supported |
| 10.x | v2, v3 | Current stable |

---

### 3. Atlassian Connect Apps — Incorrectly Marked Cloud-Only

**Variant affected:** Jira Data Center
**Severity:** High

**What the doc says:**
> | Feature | Jira Cloud | Jira Data Center |
> |---------|------------|------------------|
> | Connect Apps | Yes | No |

**Correction:**
Atlassian Connect apps **do run on Data Center**, starting from Data Center 7.13+. The restriction is that Connect apps require an accessible HTTPS endpoint and Atlassian's infrastructure to reach the app. Data Center deployments behind a VPN are not compatible with Connect unless exposed via a proxy.

Additionally, the webhook endpoint `/rest/api/2/webhook` mentioned in the OAuth apps section is misleading — OAuth apps on Data Center use the same webhook API as other apps.

Action: Update the feature matrix to:
- Connect Apps: Cloud (native), Data Center (requires Data Center 7.13+, HTTPS exposure)
- Forge: Cloud only (correct — this is serverless, no Data Center support)

---

### 4. Regional Cloud Deployments — Not Documented

**Variant affected:** Jira Cloud (multiple regions)
**Severity:** Medium

**What the doc says:**
The doc uses `*.atlassian.net` as the base URL pattern throughout, implying a single global cloud.

**Correction:**
Jira Cloud has multiple regional deployments with distinct URL patterns:

| Region | Base URL Pattern | Notes |
|--------|-----------------|-------|
| US (default) | `https://{org}.atlassian.net` | Most common |
| EU | `https://{org}.jira.atlassian.net` | European data residency |
| AU | `https://{org}.jira.atlassian.net` | Australia region |
| Gov (US) | `https://{org}.jira.us` | Government Community Cloud |
| China | `https://{org}.jira.cn` | China region |

The connector config should document that the `baseUrl` field must match the tenant's actual region. While API endpoints are the same, network routing, token validation, and privacy settings may differ per region.

---

### 5. API v2 Deprecation — Not Mentioned

**Variant affected:** Jira Cloud (historical)
**Severity:** Medium

**What the doc says:**
The doc exclusively uses `/rest/api/3/` throughout. No mention of v2.

**Correction:**
Jira Cloud REST API v2 was deprecated on **September 30, 2019** and reached end of life on **September 30, 2022**. All v2 endpoints are gone. The doc should add a note in Section 10 (Known Gotchas) confirming that v2 is EOL and the connector must use v3 exclusively. This is already implicitly correct in the code examples but should be explicit.

---

### 6. Basic Auth on Cloud — Incorrectly Presented

**Variant affected:** Jira Cloud
**Severity:** Medium

**What the doc says:**
The overview table lists "Basic Auth" under Data Center authentication. Section 2.2 shows `username:password` format for Data Center. However, Basic Auth for Cloud was deprecated.

**Correction:**
Basic Auth (username + password) for Jira Cloud was deprecated. API Token + Basic Auth header (`base64(email:token)`) is still supported for Cloud, but raw username:password Basic Auth is not. For Data Center, raw Basic Auth (`username:password` base64) remains valid.

Add a clarification:
- Cloud: `Authorization: Basic base64(email:apiToken)` — supported
- Cloud: `Authorization: Basic base64(username:password)` — **deprecated**, avoid
- Data Center: `Authorization: Basic base64(username:password)` — still valid

---

### 7. API Feature Minimum Version — Not Specified

**Variant affected:** Jira Data Center
**Severity:** Medium

**What the doc says:**
The doc uses `/rest/api/3/` endpoints for Data Center examples (lines 90, 252, 281, etc.) without noting that v3 endpoints require Data Center 8.13+.

**Correction:**
Document the minimum Data Center version for each v3 endpoint. Key v3-only features include:
- `/rest/api/3/issue/{key}/transitions` (enhanced)
- `/rest/api/3/search` (improved pagination with `nextPageToken`)
- `/rest/api/3/user` (modern user APIs)
- `/rest/api/3/field` (field search)
- Advanced roadmaps and sprints (if applicable)

If the connector supports Data Center 8.13–8.20, it must handle both v2 and v3 endpoints. If it targets 9.x+, v3 is safe to assume.

---

### 8. Jira Service Management — Not Distinguished

**Variant affected:** Jira Cloud, Jira Data Center
**Severity:** Low (informational)

**What the doc says:**
The doc focuses on Jira Software. Section 13 (Open Questions) briefly mentions Service Management in passing.

**Correction:**
Add a note that the connector design covers Jira Software. Jira Service Management (JSM) has:
- Additional user type: `customer` (portal users)
- Different API rate limits for portal operations
- SLA APIs available in Cloud and Data Center 9.7+
- Different webhook event types (e.g., `jsm.request.created`)

If the connector will eventually support JSM, note this in the Phase 3 scope.

---

### 9. Webhook Endpoint — Inconsistent

**Variant affected:** Jira Cloud
**Severity:** Low

**What the doc says:**
Section 3.1 shows two webhook registration endpoints:
- `/rest/webhooks/1.0/webhook` — for admin-configured webhooks (correct)
- `/rest/api/2/webhook` — for OAuth apps (this looks wrong for v3 context)

**Correction:**
The `/rest/api/2/webhook` endpoint is the v2 endpoint. In v3 context, OAuth apps should use `/rest/webhooks/1.0/webhook` as well, or the documentation should clarify that the webhook registration API did not fully migrate to v3. Verify with current API docs whether `/rest/api/3/webhook` exists.

---

### 10. Data Center Feature Matrix — Incomplete

**Variant affected:** Jira Data Center
**Severity:** Medium

**What the doc says:**
The summary table in Section 1 has only Cloud vs. Data Center without nuance. The "No" entries for rate limits and Connect apps on Data Center are partially incorrect.

**Correction:**
Update the feature matrix:

| Feature | Jira Cloud | Jira Data Center |
|---------|------------|------------------|
| REST API v3 | Yes | Yes (8.13+) |
| REST API v2 | EOL (2022) | Yes (legacy) |
| Rate Limits | Yes (points-based) | No |
| Forge Apps | Yes | No |
| Connect Apps | Yes | Yes (7.13+) |
| Webhooks | Yes | Yes |
| OAuth 2.0 | Yes | Yes |
| PAT | Yes | Yes |
| Basic Auth | Deprecated | Yes |
| Audit Log API | Yes (Cloud Premium) | Yes (9.6+) |
| SAML SSO | Via Atlassian Access | Yes |
| SCIM | Via Atlassian Access | Via Atlassian Access |

---

## Summary of Required Changes

| Priority | Finding | Action |
|----------|---------|--------|
| Critical | Server EOL missing | Add EOL notice; remove Server from supported variants |
| High | Data Center API versioning wrong | Replace with version matrix; add min-version requirements |
| High | Connect apps on Data Center missing | Update feature matrix; clarify HTTPS requirement |
| Medium | Regional deployments missing | Document EU/AU/Gov/China URL patterns |
| Medium | v2 deprecation not noted | Add deprecation notice in Section 10 |
| Medium | Basic Auth deprecation on Cloud | Clarify which Basic Auth forms are valid |
| Medium | v3 min-version not specified | Document which v3 features need Data Center 8.13+/9.x |
| Low | JSM not distinguished | Add scope note for future JSM support |
| Low | Webhook endpoint inconsistency | Verify and clarify /rest/api/3/webhook availability |
| Medium | Data Center feature matrix incomplete | Expand matrix with version requirements |

---

## References

- [Jira Software End of Life (Atlassian Community)](https://community.atlassian.com/t5/Jira-articles/Jira-Software-end-of-life-EOL-archive/ba-p/1641003)
- [Atlassian Enterprise Lifecycle](https://confluence.atlassian.com/enterprise/atlassian-enterprise-data-center-and-server-lifecycle-1007077666.html)
- [Jira Cloud REST API v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
- [Jira Data Center REST API](https://docs.atlassian.com/jira-software/REST/latest/)
- [Atlassian Connect Apps on Data Center](https://developer.atlassian.com/cloud/jira/software/connect/what-is-connect/)
