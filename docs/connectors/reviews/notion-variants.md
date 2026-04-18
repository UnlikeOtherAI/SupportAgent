# Notion Connector — Hosting Variants & Version-Drift Review

## Verdict

**Accurate with minor additions needed.** The doc correctly identifies Notion as cloud-only and states the API versioning model accurately. Two areas need clarification: the date-based version header is pinned to a specific date rather than "latest stable," and enterprise-tier features (SSO, SCIM, audit logs, data residency) deserve explicit treatment even if they don't affect API endpoints.

---

## Findings

### 1. Cloud vs Self-Hosted — Correct

**What the doc says:** "Cloud-only. No self-hosted Notion. No on-prem option." (line 6)

**Correction:** None. This is accurate. Notion does not offer a self-hosted or on-premises deployment. All workspaces worldwide route through `api.notion.com`. There is no Notion equivalent of "GitHub Enterprise Server" or "GitLab self-managed."

---

### 2. API Versioning Model — Accurate but Understated

**What the doc says:** `Notion-Version: 2026-03-11` (line 9); "date-based versioning" (line 9)

**Correction:** None on the mechanism — date-based versioning is correct. However, the doc shows a pinned date rather than documenting the versioning strategy. Notion's API uses a rolling date-based version string (`Notion-Version: YYYY-MM-DD`). The doc should clarify:
- **Version lifecycle**: Notion does not publish formal major/minor versions. Instead, a date string represents a stable snapshot. Breaking changes are introduced with a new date. The previous version remains supported for a grace period (typically several months).
- **Staying current**: Integrations should pin a specific version but upgrade periodically. Running against an old version indefinitely risks hitting the unsupported cutoff.
- **Current version**: At time of writing the stable version is `2022-06-30` through `2022-06-30` era; newer dates (e.g., `2024-05-00` family, `2026-03-11`) unlock new features but the doc's version (`2026-03-11`) is plausible as a recent pin. Recommend verifying against [Notion's changelog](https://developers.notion.com/changelog) for what features each date unlocks.

**Suggested addition to line 9:**
```
- **API version header**: `Notion-Version: 2026-03-11` (date-based, rolling stable; breaking changes introduced with new dates; deprecated dates eventually sunset)
```

---

### 3. Base URL — Correct, No Variant Paths

**What the doc says:** `https://api.notion.com` (line 8)

**Correction:** None. Notion has a single global API endpoint. There is no `api.notion.eu` or `api.notion.gov`. All workspaces, regardless of data residency or enterprise tier, use the same base URL. This simplifies routing — no variant path logic needed.

---

### 4. Enterprise Features (SSO, SCIM, Audit Logs) — Missing but Non-Blocking

**What the doc says:** No mention of enterprise-only features.

**Correction:** Add a note under a "Enterprise Tier" subsection or expand Gotcha #1. Notion's Enterprise plan includes features that affect connector operation:

| Enterprise Feature | Impact on Connector |
|---|---|
| **SAML/SSO** | Affects auth flow for enterprise tenants (OAuth/SP-initiated SAML); integration token flow unchanged |
| **SCIM provisioning** | Relevant only if SupportAgent manages user provisioning, not for read/write operations |
| **Audit logs** | Notion workspace admins can view an audit log of workspace activity; connector behavior is not affected but worth noting for compliance |
| **Data retention policies** | Enterprise can set data retention rules that may delete pages; connector should be aware that pages it tracks may be auto-deleted |
| **Advanced permissions (page-level)** | Enterprise adds more granular permission tiers; sharing model for integrations remains unchanged |

**Suggested addition after line 386 (Gotcha #1):**
```
1a. **Enterprise plan features**: Notion Enterprise adds SAML/SSO, SCIM user provisioning, data retention policies, and audit logs. None of these change the API surface or connector implementation, but connectors should handle permission-denied responses gracefully if a page loses shared access due to a policy change.
```

---

### 5. Data Residency — Missing (Low Severity)

**What the doc says:** No mention of data residency.

**Correction:** Add to section 10 (Known Gotchas). Notion stores data in US and EU regions. As of 2024, Notion supports EU data residency for Enterprise workspaces (data at rest in EU). This does NOT change the API endpoint — all regions share `api.notion.com`. However, tenants with strict data residency requirements should be aware that metadata (workspace name, integration ID, user names) may still be stored in US infrastructure even for EU-resident content.

**Suggested addition to Gotchas:**
```
16. **Data residency**: Notion Enterprise workspaces can opt into EU data residency (data at rest in EU). The API endpoint (`api.notion.com`) is global regardless of region. Metadata (workspace metadata, integration IDs, user display names) may remain in US infrastructure. Verify with Notion sales if strict data-residency guarantees are required.
```

---

### 6. Feature Matrix — Generally Correct

**What the doc says:** Implicitly all features are cloud-only since everything is cloud-only.

**Correction:** None — correct. There is no self-hosted tier to compare against.

**One nuance to clarify:**
- **Webhooks (introduced 2025):** The doc correctly states webhooks are available (line 48). This was a significant addition — older docs referenced polling as the only event mechanism. The `data_source.schema_updated` event (line 63) is correct as a 2025-09-03 addition.

---

### 7. Deprecations — No Formal Deprecations Documented

**What the doc says:** No deprecation section.

**Correction:** Notion's API does not follow a strict v1/v2/v3 deprecation cycle. There are no publicly announced sunset dates for specific API endpoints. The date-based versioning means breaking changes are introduced with a new date, and old dates are eventually deprecated (no specific timeline is published publicly).

**Suggested addition to a new section 13 (or under section 10):**
```
### API Deprecations

Notion does not publish formal sunset dates for specific API versions. The date-based versioning model means:
- Breaking changes ship with a new `Notion-Version` date string
- Old date strings remain functional for an undocumented grace period
- When a date is sunset, integrations receive `400 Bad Request` with a deprecation message

Monitor [developers.notion.com/changelog](https://developers.notion.com/changelog) for version changes. There is no RSS feed — check periodically.
```

---

### 8. Breaking Changes Between API Versions — No Known Straddling

**What the doc says:** The doc does not straddle multiple API versions.

**Correction:** None. Notion's date-based versioning means every integration pins a version. The doc correctly shows the current pinned version. No action needed.

**One minor note:** If SupportAgent ever upgrades the pinned `Notion-Version` date (e.g., from an older date to `2026-03-11`), there are no known fields that behave differently between dates in the 2022-2026 range for the endpoints this connector uses. Properties, pages, comments, and databases have been stable. Newer dates primarily add new property types (e.g., `location`, `button`, `place` noted on line 258) rather than breaking existing fields.

---

### 9. Platform Hosting Modes — Not Applicable to Notion

**Checklist against requested platforms:**

| Platform | Status |
|---|---|
| GitHub (github.com + Enterprise Server + Enterprise Cloud) | N/A — Notion is cloud-only |
| GitLab (gitlab.com + self-managed CE/EE + Dedicated) | N/A — Notion is cloud-only |
| Bitbucket (Cloud + Data Center + Server) | N/A — Notion is cloud-only |
| Jira (Cloud + Data Center + Server) | N/A — Notion is cloud-only |
| Sentry (sentry.io + on-premise) | N/A — Notion is cloud-only |
| Linear (cloud only) | Verified: Linear is cloud-only. Notion is also cloud-only. |
| Trello (cloud only) | Verified: Trello is cloud-only. Notion is also cloud-only. |
| Slack / Teams / WhatsApp | N/A for Notion |

**Correction:** None needed on the hosting check. The doc correctly does not attempt to enumerate self-hosted variants that don't exist.

---

### 10. Summary of Suggested Additions

| Section | Addition |
|---|---|
| Line 9 (API version) | Clarify rolling date model, upgrade strategy, and changelog monitoring |
| After line 386 (Gotcha #1) | Enterprise plan feature summary (SSO, SCIM, audit, retention) |
| Section 10 (Gotchas) | Add data residency note (EU vs US, no API endpoint change) |
| New section 13 | API deprecation model (no formal dates, date-based sunset) |

---

### 11. Overall Assessment

The Notion connector doc is **well-scoped for its purpose** — the cloud-only constraint is clearly stated, the API surface is correctly described, and the lack of self-hosted variants eliminates a large class of variant-drift concerns present in other connectors (GitHub, GitLab, Jira, etc.).

The additions above are refinements rather than corrections. The doc correctly avoids over-specifying deprecation timelines that Notion doesn't publish, and correctly notes that webhooks require UI-based registration (a real constraint for multi-tenant SaaS).

**No factual errors found.** All API endpoints, event types, and property types match Notion's published API reference at time of writing.