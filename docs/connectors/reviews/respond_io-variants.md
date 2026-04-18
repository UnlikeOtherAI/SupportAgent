# Respond.io Connector Review — Hosting Variants & Version Drift

**Reviewer scope:** Cloud vs self-hosted distinction, API version variants, plan-gated features, regional gotchas, deprecations.
**Ignoring:** Auth mechanism details, endpoint shapes, rate-limit numbers.

---

## Verdict

**CORRECT overall** on cloud-only / no self-hosted variant. The `api.respond.io/v2` base URL is stated consistently. No deprecations detected for the v2 API.

**Two categories of findings:**

1. **Plan-gated features not flagged** — The doc presents several features as universally available that are actually restricted to paid tiers (Growth, Advanced, or Enterprise). A connector implementer relying on this doc would build features that only work on higher plans.
2. **No API version drift risk** — Respond.io appears to ship only one API version (v2) with no announced deprecation path. This is a clean area for the doc.

---

## Findings

### Finding 1 — Developer API is not on the Starter plan

**Variant affected:** Pricing tier gating
**What the doc says:** Section 1 lists `@respond-io/typescript-sdk` and the API base URL with no plan qualification. Section 12 references the SDK as the recommended approach "for MVP." The connector scope in Section 11 targets the Developer API endpoints without noting plan requirements.
**Correction:** The Developer API is **Growth plan and above only**. Starter plan ($79/mo) does not include API access. A connector that ships before the tenant has a Growth+ workspace will fail silently or return 403s. Add a note in Section 1 and in the connector scope section: "_Requires Growth plan or higher._"

---

### Finding 2 — Webhooks are Advanced plan only

**Variant affected:** Pricing tier gating
**What the doc says:** Section 3 presents webhook support as a first-class feature of the platform ("Webhook Support: YES") with no plan caveat. Section 11 lists webhook registration and event handling as part of the MVP scope.
**Correction:** Incoming and Outgoing Webhooks are **Advanced plan and above only**. Growth plan does not include webhooks. The doc should state this explicitly in Section 3 and in the MVP scope (Section 11). Relevant quote from pricing page: "Incoming & Outgoing Webhooks" is listed under Advanced.

---

### Finding 3 — SSO is Advanced plan only

**Variant affected:** Pricing tier gating
**What the doc says:** Not mentioned, which is acceptable for a connector-focused doc (SSO is an admin concern, not an API concern). However, the token security gotcha in Section 10 mentions "workspace settings" without flagging that SSO-only workspaces may have additional token provisioning requirements.
**Correction:** No change needed to the connector doc itself. For admin panel work, note that SSO-configured workspaces may restrict token provisioning to admins only.

---

### Finding 4 — Multiple Workspaces is Advanced plan only

**Variant affected:** Pricing tier gating
**What the doc says:** Section 11 MVP scope includes a `workspaceId` field as "(optional, for multi-workspace support)" without noting that multiple workspaces require Advanced or Enterprise.
**Correction:** Add a parenthetical: "_Multiple workspaces require Advanced plan or higher._"

---

### Finding 5 — Broadcast Campaigns (Phase 3) requires Growth plan

**Variant affected:** Pricing tier gating
**What the doc says:** Section 11 Phase 3 lists "Bulk message sending via broadcast campaigns" without plan qualification.
**Correction:** Add "_Requires Growth plan or higher._" to the Phase 3 broadcast item. Broadcasts are listed as a Growth-tier feature.

---

### Finding 6 — Enterprise tier has elevated API rate limits

**Variant affected:** Pricing tier gating
**What the doc says:** Section 8 Rate Limits states "The official rate limit values are not publicly documented" and recommends monitoring headers. This is accurate, but it does not flag that Enterprise workspaces get higher limits than Growth/Advanced.
**Correction:** Add a note: "_Enterprise plans include higher API rate limits. Connector should detect and handle 429s gracefully regardless of tier._"

---

### Finding 7 — No API version drift detected

**Variant affected:** API versioning
**What the doc says:** All endpoints use `https://api.respond.io/v2`. No mention of v1 or v3.
**Correction:** None. The doc is accurate. Only v2 is in active use; no v3 announced; no deprecation path documented.

---

### Finding 8 — No regional or data-residency variants

**Variant affected:** Regional hosting
**What the doc says:** No mention of regional variants.
**Correction:** None required. Respond.io does not appear to offer EU-region, AU-region, or US-government isolated deployments. The doc correctly does not invent regional variants. Confirm in vendor follow-up if regional data residency is ever requested by tenants.

---

### Finding 9 — No self-hosted variant

**Variant affected:** Hosting mode
**What the doc says:** Section 1 states "_Cloud vs self-hosted: Cloud-only. Respond.io is a SaaS platform with no self-hosted variant._" Section 10 "Known Gotchas" reproduces this: "_Respond.io is exclusively SaaS. No self-hosted option._"
**Correction:** None. This is correct.

---

### Finding 10 — No breaking changes between API versions

**Variant affected:** Version drift
**What the doc says:** The doc uses v2 consistently with no references to v1 or transitional behavior.
**Correction:** None. This is correct. Only v2 is documented; no migration path needed.

---

## Summary

| # | Area | Severity | Type |
|---|------|----------|------|
| 1 | Developer API gated on Growth+ | Medium | Missing plan qualifier |
| 2 | Webhooks gated on Advanced+ | Medium | Missing plan qualifier |
| 3 | SSO gated on Advanced+ | Low | N/A for connector doc |
| 4 | Multiple workspaces gated on Advanced+ | Low | Missing plan qualifier |
| 5 | Broadcasts gated on Growth+ | Low | Missing plan qualifier |
| 6 | Enterprise rate limits | Low | Missing context note |
| 7 | No API version drift | — | Confirmed clean |
| 8 | No regional variants | — | Confirmed absent |
| 9 | No self-hosted variant | — | Confirmed absent |
| 10 | No breaking v2→v3 migration | — | Confirmed absent |

**Priority fixes:** Findings 1 and 2 are the most likely to cause integration failures in production. A tenant on a Starter plan who configures the connector will get silent 403s on API calls and webhook registration failures. The doc should add plan requirements to Section 1 and to the MVP scope (Section 11).

---

## Additional Notes for Reviewers

- **Audit scope was correct** — The doc correctly scopes to cloud-only for hosting, uses `api.respond.io/v2` consistently for base URL, and does not invent regional or enterprise-only endpoint variants that don't exist.
- **For the admin panel** — When displaying plan-tier information or gating features by plan, the hierarchy is: Starter < Growth < Advanced < Enterprise. Developer API and Webhooks are the most consequential plan gates for this connector.
