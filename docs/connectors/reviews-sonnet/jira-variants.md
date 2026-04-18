# Hosting-Variants & Version-Drift Review — Jira Connector

**Source:** `docs/connectors/jira.md`
**Reviewer scope:** Cloud vs self-hosted coverage, API versioning, deprecations, regional gotchas.

---

## Verdict

**Partially adequate.** The doc covers the two active Jira hosting modes (Cloud and Data Center) and correctly identifies key behavioural differences. However, it omits the third historical variant (Server), misstates the Data Center API version in the summary table, conflates API paths in ways that will cause runtime errors, has a wrong webhook registration path in the MVP endpoint list, and is silent on data-residency variants. Several features are implied as universal when they are Cloud-only or require a minimum DC version.

---

## Findings

### 1. Jira Server not mentioned as a distinct variant (all sections)

- **Variant affected:** Jira Server (self-managed, now EOL)
- **What the doc says:** Section 1 overview and section 10.1 acknowledge "Data Center / Server" as a combined item, but no separate entry is ever given. The EOL status is not stated.
- **Correction:** Jira Server reached end of life on 15 February 2024. Customers still running Server instances exist and will attempt to connect. The doc must call out Server as a distinct (EOL) variant with its own constraints: Server tops out at REST API v2 only (v3 was never backported to Server), base URL is a custom hostname without `.atlassian.net`, and PAT authentication was not available on Server — only Basic Auth and OAuth 1.0a were supported. The connector must reject or warn when a Server base URL is detected and a v3 path is requested.

---

### 2. Data Center API version stated as "v8+" in the summary table (Section 1)

- **Variant affected:** Jira Data Center
- **What the doc says:** Summary table lists Data Center API Version as "REST API v8+".
- **Correction:** Jira Data Center does not version its REST API with a major numeric scheme the same way. The REST API path on Data Center is `/rest/api/2` (not `/rest/api/8`). Atlassian added partial `/rest/api/3` support to Data Center starting with Data Center 9.x (released 2023), but coverage is incomplete compared to Cloud. "v8+" appears to conflate the Jira application version number (e.g. Jira Data Center 8.x, 9.x) with the REST API version. The correct statement is: Data Center exposes `/rest/api/2`; `/rest/api/3` is partially available on DC 9.x and later. For maximum compatibility with self-hosted installs, the connector should default to `/rest/api/2` on Data Center.

---

### 3. Section 2.2 Data Center example uses `/rest/api/3` path

- **Variant affected:** Jira Data Center
- **What the doc says:**
  ```
  curl -X GET "https://dc-server.com/rest/api/3/issue/PROJ-1"
  ```
- **Correction:** Data Center instances running version 8.x do not expose `/rest/api/3`. The example should use `/rest/api/2` for Data Center, or the doc must explicitly state the minimum DC version (9.x) required before `/rest/api/3` is usable, and recommend a runtime version check via `GET /rest/api/2/serverInfo`.

---

### 4. Webhook registration path inconsistency — admin webhooks vs MVP endpoint list

- **Variant affected:** Jira Cloud (and Data Center)
- **What the doc says:**
  - Section 3.1 correctly documents admin webhook registration at `POST /rest/webhooks/1.0/webhook`.
  - Section 11 (MVP endpoint list) includes `POST /rest/api/3/webhooks/1.0/webhook` and `DELETE /rest/api/3/webhooks/1.0/webhook/{id}`.
- **Correction:** The correct path for admin-configured webhooks is `/rest/webhooks/1.0/webhook` — it is not under `/rest/api/3/`. The MVP endpoint list in Section 11 has the path prefixed with `/rest/api/3/` which is wrong and will return 404. The path for OAuth/Connect dynamic webhooks is `/rest/api/2/webhook` (or `/rest/api/3/webhook`), which is a different endpoint with different capabilities and the 30-day expiry / 5-per-user limits. These two registration mechanisms must not be conflated.

---

### 5. `/rest/api/3/search` vs `/rest/api/3/search/jql` — endpoint divergence

- **Variant affected:** Jira Cloud
- **What the doc says:** Section 9.1 uses `GET /rest/api/3/search` for offset pagination, and Section 3.1 uses `GET /rest/api/3/search/jql` for polling. Section 11 MVP list references `GET /rest/api/3/search`.
- **Correction:** Atlassian introduced `/rest/api/3/search/jql` as the preferred cursor-based search endpoint in Cloud (available from approximately 2023). The older `/rest/api/3/search` endpoint still works on Cloud but does not support `nextPageToken` cursor pagination — that parameter only applies to the `/search/jql` variant. The doc mixes both in ways that imply they are equivalent. The doc must distinguish: use `/rest/api/3/search` for offset-based pagination (works on Cloud and DC v3+), use `/rest/api/3/search/jql` for cursor pagination (Cloud-only). Data Center does not support `/rest/api/3/search/jql`.

---

### 6. `GET /rest/api/3/issue/createmeta` is deprecated on Cloud

- **Variant affected:** Jira Cloud
- **What the doc says:** Sections 5.2 and 11 recommend `GET /rest/api/3/issue/createmeta` to discover available fields.
- **Correction:** Atlassian deprecated `createmeta` in Cloud REST API v3 and announced its removal. The replacement is `GET /rest/api/3/issue/createmeta/{projectKeyOrId}/issuetypes` and `GET /rest/api/3/issue/createmeta/{projectKeyOrId}/issuetypes/{issueTypeId}`. The old flat `createmeta` endpoint still responds on most Cloud tenants as of early 2026, but Atlassian has been progressively enforcing the deprecation. On Data Center, the old path still works. The doc should call out the deprecation, give the sunset timeline (Atlassian has not published a hard date but has been warning since 2022), and use the new paginated form.

---

### 7. No data-residency / regional variants documented

- **Variant affected:** Jira Cloud (EU, AU, US data residency)
- **What the doc says:** Section 1 lists the Cloud API reference URL as `https://developer.atlassian.com/cloud/jira/platform/rest/v3/` with no mention of regional variants.
- **Correction:** Atlassian offers data residency pinning for Cloud customers (EU, US, Australia). When data residency is configured, the base URL for API calls remains `https://<site>.atlassian.net` — it does not change. However, data-resident tenants may restrict which IP ranges or app types can access them. More importantly, Atlassian's "Forge" and "Connect" features have their own regional infrastructure requirements, and some Connect app callbacks may be blocked from non-approved IPs for EU data-resident tenants. The doc should note: (a) the base URL does not change per region, (b) data-residency does not affect the REST API path, but (c) Connect/Forge egress and GDPR-sensitive fields (email) may behave differently.

---

### 8. Forge apps listed as a supported authentication/integration path without Cloud-only caveat

- **Variant affected:** Jira Data Center / Server
- **What the doc says:** Section 1 feature matrix marks Forge Apps as "Yes" for Cloud and "No" for Data Center. Section 2.1 describes Forge. This is correct in the table, but the doc does not flag that Forge is a hard Cloud-only constraint with no future path to Data Center.
- **Correction:** This is technically correct but needs clearer language. Forge will never be available on Data Center or Server. Any tenant on Data Center who is building a marketplace app must use Connect, not Forge. The doc should state this explicitly in Section 2.1 rather than just in the matrix, because the narrative sections (Sections 2.1 and 11 Phase 3) discuss Forge features without repeatedly reaffirming the Cloud-only constraint.

---

### 9. Connect Apps marked "No" for Data Center — partially incorrect

- **Variant affected:** Jira Data Center
- **What the doc says:** Summary table in Section 1 marks Connect Apps as "No" for Data Center.
- **Correction:** Atlassian Connect does work with Jira Data Center, but it requires the DC instance to have the Atlassian Connect framework enabled (it is a separate plugin that must be installed). Connect on DC is not as feature-complete as on Cloud, and some Connect module types are unavailable. The table entry of "No" is misleading — it should read "Limited (requires Connect plugin; reduced module support)" or similar. This matters because a customer on DC who wants to register dynamic webhooks via the `/rest/api/2/webhook` Connect endpoint will not be able to do so if Connect is not installed.

---

### 10. User identity — `username` vs `key` vs `accountId` on Data Center

- **Variant affected:** Jira Data Center / Server
- **What the doc says:** Section 7.1 mentions Data Center may use `key` (e.g., `jira-username`) or `accountId` if migrated. Section 7 otherwise uses `accountId` throughout.
- **Correction:** On Jira Data Center (and Server before EOL), the canonical user identifier is `name` (username) for older versions and `key` for versions that introduced the key concept. `accountId` only appears on DC instances that have been through the Atlassian Account migration process, which is not universal — many on-premise installations are not linked to Atlassian Account and never will be. The connector must handle both identifier schemes: use `accountId` if present, fall back to `key`, and be prepared for `name` on very old DC instances. The `User` TypeScript interface in Section 3.2 only declares `accountId`, which will be undefined for non-migrated DC users.

---

### 11. Audit log access listed as Phase 3 feature without Cloud/DC/tier qualification

- **Variant affected:** Jira Cloud vs Data Center, premium tier
- **What the doc says:** Section 11 Phase 3 lists "Audit log access for compliance" as a planned feature.
- **Correction:** Audit log access differs significantly by variant and tier. On Jira Cloud, audit logs are available via `GET /rest/api/3/auditing/record` but access requires the site to be on Premium or Enterprise plan; Standard-tier Cloud tenants do not have API-accessible audit logs. On Data Center, audit logs are available via `GET /rest/api/2/auditing/record` and are included in the DC license with no tier restriction. This distinction must be in the doc before implementing, as the implementation path and required permissions differ.

---

### 12. SLA endpoints not mentioned as Jira Service Management-specific

- **Variant affected:** Jira Service Management (Cloud and DC) only
- **What the doc says:** Section 11 Phase 3 lists "SLA calculation and tracking" as a planned feature without a variant or product qualification.
- **Correction:** SLA features are part of Jira Service Management (JSM), not Jira Software or Jira Work Management. The API endpoints for SLAs (`/rest/servicedeskapi/...`) are only present on instances where JSM is licensed and enabled. On Cloud, JSM is a separate product with its own API namespace. On DC, JSM (formerly Service Desk) is a plugin. The doc should flag this as JSM-only and note the separate API namespace (`/rest/servicedeskapi/v1/`) rather than implying it lives under the standard REST API.

---

### 13. Minimum Data Center version for Personal Access Tokens not stated

- **Variant affected:** Jira Data Center
- **What the doc says:** Section 2.2 recommends PAT as the recommended auth method for Data Center scripts/bots.
- **Correction:** Personal Access Tokens on Data Center were introduced in Jira Data Center 8.14 (released September 2021). DC instances older than 8.14 do not support PAT and must use Basic Auth or OAuth 1.0a. The doc should state the minimum DC version (8.14) required for PAT. Given that Jira DC 8.x is still in extended support and many organisations lag on upgrades, this is a realistic concern.

---

### 14. OAuth 1.0a described only as "Deprecated" with no sunset or DC-version context

- **Variant affected:** Jira Data Center / Server
- **What the doc says:** Section 2.2 lists "OAuth 1.0a: Deprecated" with no further detail.
- **Correction:** OAuth 1.0a was removed from Jira Cloud entirely (no longer supported). On Data Center, it is still present but listed as deprecated in DC 9.x release notes, with removal expected in a future major version. On Server (EOL), OAuth 1.0a was the primary OAuth mechanism. The doc should clarify: Cloud — removed (do not use), DC — present but deprecated (sunset in future DC major), Server — was primary OAuth mechanism (moot given EOL). This is relevant because older DC-to-Server migration customers may have existing OAuth 1.0a app registrations.

---

## Summary Table

| # | Variant | Severity | Issue |
|---|---------|----------|-------|
| 1 | Server (EOL) | High | No coverage; EOL not stated; v3 API never shipped on Server |
| 2 | Data Center | High | API version "v8+" is wrong; correct is `/rest/api/2` |
| 3 | Data Center | High | Section 2.2 example uses `/rest/api/3` which fails on DC 8.x |
| 4 | Cloud + DC | High | MVP webhook path `/rest/api/3/webhooks/1.0/webhook` is invalid |
| 5 | Cloud | Medium | `/rest/api/3/search/jql` cursor pagination is Cloud-only; mixed with DC-compatible path |
| 6 | Cloud | Medium | `createmeta` endpoint is deprecated; replacement endpoint not given |
| 7 | Cloud | Low | No data-residency / regional variant documentation |
| 8 | Cloud only | Low | Forge Cloud-only constraint not repeated in narrative sections |
| 9 | Data Center | Medium | Connect Apps marked "No" for DC; should be "Limited" |
| 10 | Data Center | Medium | User identity missing fallback for non-migrated DC users (`name`/`key`) |
| 11 | Cloud (Premium) / DC | Low | Audit log tier requirement not documented |
| 12 | JSM only | Medium | SLA endpoints implied as standard Jira; are JSM-only with separate API namespace |
| 13 | Data Center | Medium | PAT requires DC 8.14+; minimum version not stated |
| 14 | Cloud + DC | Low | OAuth 1.0a removal/deprecation timeline not distinguished by variant |
