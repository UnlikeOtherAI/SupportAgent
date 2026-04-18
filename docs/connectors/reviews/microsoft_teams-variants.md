# Microsoft Teams Connector — Hosting Variants & Version Drift Review

**Reviewed file:** `docs/connectors/microsoft_teams.md`
**Date:** 2026-04-18
**Reviewer scope:** hosting modes, API versions, base URLs, feature availability by tier, deprecations, regional gotchas. Auth mechanisms, endpoint shapes, and rate-limit numbers are out of scope.

---

## Verdict: MOSTLY ACCURATE — minor gaps on sovereign clouds and GCC nuance

The doc correctly identifies Teams as cloud-only with no on-premises equivalent. It accurately covers the two API surfaces (Graph API + Bot Framework), the Graph API v1.0 surface, and the TeamsFx deprecation. The main gaps are: (1) GCC (L3) vs GCC-High/DoD behavior is conflated in a single open question, when they have meaningfully different endpoint requirements; (2) China sovereign base URL is mentioned only as an open question with no endpoint detail; (3) Bot Framework sovereign-cloud variants are not covered.

---

## Findings

### 1. Cloud Classification — CORRECT

**What the doc says:** Teams is cloud-only. No on-premises equivalent. Teams connects via Microsoft Graph API — there is no "Teams Server" API.

**Correction:** No correction needed. This is accurate. There is no on-premises "Microsoft Teams Server" with a parallel API surface. All Teams workloads — commercial, GCC, GCC-High, DoD, and China sovereign — are SaaS-only.

---

### 2. Government Cloud Endpoint Requirements — INCOMPLETE

**What the doc says:** Section 13 (Open Questions), item 2 states: "Do we need to support GCC/GCC-High/DoD tenants? These have separate Graph endpoints (`graph.microsoft.us`, `dod.graph.microsoft.com`) and different app registration flows. Flag this as a Phase 2 consideration."

**Correction:** The endpoints are stated correctly but the GCC/GCC-High/DoD distinction is muddled. Microsoft 365 operates across five tiers:

| Tier | Name | Graph Base URL | Azure Portal |
|------|------|----------------|--------------|
| L1 | Commercial (worldwide) | `graph.microsoft.com` | `portal.azure.com` |
| L2 | GCC (US Government Commercial) | `graph.microsoft.com` (worldwide endpoints) | `portal.azure.com` |
| L4 | GCC High | `graph.microsoft.us` | `portal.azure.us` |
| L5 | DoD | `dod-graph.microsoft.us` | `portal.azure.us` |

**Key nuance the doc misses:** GCC (L3) is often confused with GCC High (L4) but they are distinct. GCC (L3) tenants use the same worldwide Graph endpoints as commercial — only GCC High and DoD require separate sovereign endpoints. This means a connector that hardcodes `graph.microsoft.com` will actually work for GCC tenants today, but may silently fail for GCC High/DoD tenants without warning. The open question should separate "GCC tenants" from "GCC High / DoD tenants" since only the latter two require different base URLs and app registration flows.

**Recommendation:** Add a note in Section 1 or 13 clarifying that GCC (L3) uses commercial endpoints, while GCC High (L4) and DoD (L5) require `graph.microsoft.us` and `dod-graph.microsoft.us` respectively.

---

### 3. China Sovereign Cloud — CORRECTLY FLAGGED, endpoint missing

**What the doc says:** Section 13, item 3: "Teams operated by 21Vianet uses a separate sovereign cloud endpoint. Only include if customers require it."

**Correction:** No error, but incomplete. The China sovereign endpoint is:
- Graph: `https://microsoftgraph.chinacloudapi.cn`
- Entra ID (token): `https://login.chinacloudapi.cn`
- Azure Portal: `https://portal.azure.cn`

The open question should include these base URLs so a future implementer can act on them. Additionally, Bot Framework also has China-specific endpoints — the Bot Framework token endpoint for China sovereign is `https://login.microsoftonline.com/botframework.com` (same domain, but tokens are tenant-scoped to the China cloud). This is worth noting.

**Recommendation:** Expand the China open question in Section 13 with the sovereign base URLs for Graph, Entra ID, and Bot Framework token endpoints.

---

### 4. API Version — CORRECT

**What the doc says:** The connector uses Graph API v1.0 (`graph.microsoft.com/v1.0`) and Bot Framework for proactive messaging.

**Correction:** No correction needed. Graph API v1.0 is the stable surface for all Teams operations documented. Beta (`graph.microsoft.com/beta`) is not used. Bot Framework REST API is separate and correctly identified.

---

### 5. Bot Framework Webhook — CORRECT, but sovereign variants missing

**What the doc says:** Bot Framework webhook for real-time bot messages, with bot token endpoint `https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token`.

**Correction:** No error for commercial/GCC. For GCC High and DoD, Bot Framework uses different token and webhook endpoints. For China sovereign, the Bot Framework registration flow goes through `portal.azure.cn` rather than the standard Azure portal. The doc does not cover these variants.

**Recommendation:** Add a note in Section 2 or 10 that Bot Framework sovereign-cloud variants exist and may require separate bot registrations in sovereign Azure portals.

---

### 6. TeamsFx SDK Deprecation — CORRECT

**What the doc says:** Section 10, item 9: "TeamsFx SDK is deprecated. The previous recommended SDK (TeamsFx) is in community-only support until September 2026. Use raw `fetch` or `@microsoft/graph-sdk` instead."

**Correction:** No correction needed. This is accurate and aligns with Microsoft's official documentation (TeamsFx SDK page confirms: "currently in deprecation mode and will receive community-only support on GitHub until September 2026"). The recommended replacements (`@microsoft/graph-sdk` and `botbuilder`) are correct.

---

### 7. Feature Availability by Cloud Tier — NOT COVERED

**What the doc says:** No explicit claim about which features are universally available vs. cloud/premium-only.

**Correction:** No overclaim to correct, but the doc should explicitly state that all documented Graph API v1.0 endpoints are available across commercial and GCC tiers. The following features may have tier restrictions that should be verified before claiming universal availability:

- `teams/getAllMessages` (org-wide message subscription): Requires specific admin roles that vary by tenant plan.
- Adaptive Cards rendering: Supported in all Teams clients but card feature-set may vary by Teams client version.
- Tags/tagging: Available only on Teams with specific licenses (E3/E5/A1/A3/A5). Not available in all GCC tenants.
- `ChannelMessage.Send` app-only restriction: This restriction applies across all tiers (commercial, GCC, GCC-High, DoD, China) — not a tier-specific limitation.

**Recommendation:** Add a brief note in Section 1 or a dedicated subsection clarifying that all documented v1.0 endpoints are available across commercial and GCC, but GCC High/DoD/China require separate sovereign app registrations. Tag-based notifications may require specific E3/E5 licenses.

---

### 8. App Registration Requirement — ACCURATE

**What the doc says:** Multi-tenant with admin consent is recommended. Single-tenant and multi-tenant manifest settings are covered.

**Correction:** No correction needed. App registration requirement applies universally across all Teams cloud tiers. The distinction between single-tenant and multi-tenant is accurate.

---

### 9. No Version Drift Between Hosting Modes

**What the doc says:** The doc uses Graph API v1.0 exclusively and Bot Framework REST. No mention of API version differences between hosting modes.

**Correction:** No correction needed. Microsoft Graph v1.0 is consistent across commercial, GCC, GCC High, DoD, and China sovereign clouds. The only differences are the base URL and app registration portal. There is no scenario where a feature exists in commercial Graph v1.0 but is absent from GCC-High Graph v1.0 — the API surface is the same; only the endpoint differs.

---

### 10. Open Questions Completeness — SUGGESTED ADDITIONS

**Suggested additions to Section 13 (Open Questions):**

- **Item 2 (GCC/GCC-High/DoD):** Should separate into two questions: (a) Do we need GCC (L3) support? (Answer: Likely yes — uses worldwide endpoints, just needs separate tenant registration.) (b) Do we need GCC High (L4) or DoD (L5) support? (Answer: Only if government customers require it — requires sovereign endpoints and separate Azure portal registration.)
- **Item 3 (China sovereign):** Should include the sovereign base URLs for Graph, Entra ID, and Bot Framework, and frame this as a "support only if China-region customers require it" question.

---

### 11. Adaptive Card Version — CORRECT

**What the doc says:** Section 10, item 11: "Adaptive Card version must be 1.4+ for Teams."

**Correction:** No correction needed. Teams renders Adaptive Cards natively. Version 1.4+ is the current recommendation. Earlier versions will still render but may have inconsistent behavior in Teams.

---

## Summary Table

| Topic | Status | Notes |
|-------|--------|-------|
| Cloud-only classification | ✅ Correct | No on-premises equivalent |
| Commercial base URL | ✅ Correct | `graph.microsoft.com/v1.0` |
| GCC (L3) behavior | ⚠️ Missing nuance | Uses worldwide endpoints (not a separate URL) |
| GCC High (L4) base URL | ✅ Correct | `graph.microsoft.us` (flagged as open question) |
| DoD (L5) base URL | ✅ Correct | `dod-graph.microsoft.us` (flagged as open question) |
| China sovereign Graph URL | ⚠️ Missing detail | `microsoftgraph.chinacloudapi.cn` not shown |
| China sovereign Entra URL | ⚠️ Missing detail | `login.chinacloudapi.cn` not shown |
| Bot Framework sovereign variants | ⚠️ Missing | Not covered at all |
| API version consistency | ✅ Correct | v1.0 across all tiers |
| TeamsFx deprecation date | ✅ Correct | September 2026 |
| App-only messaging restriction | ✅ Correct | Universal, not tier-specific |
| Tag-based notifications | ⚠️ Unverified | License dependency not documented |

---

## Recommendations

1. **Split the GCC open question** in Section 13 into two parts: GCC (L3, uses worldwide endpoints) vs GCC High/DoD (L4/L5, requires sovereign endpoints). This is the most impactful fix.

2. **Add China sovereign base URLs** to Section 13 with the three affected endpoints (Graph, Entra ID, Bot Framework token).

3. **Add a Tier/Country note** in Section 1 or 10 explaining that Teams connects via Microsoft Graph and Bot Framework, and that GCC High, DoD, and China sovereign require separate sovereign cloud registrations and endpoints — while GCC (L3) uses commercial endpoints.

4. **Verify tag licensing** before claiming tag-based notifications work universally. If tags require E5/A5 licenses, note that as a premium-only feature.

5. **Bot Framework sovereign variants** deserve a one-line note: separate bot registration required in sovereign Azure portals (portal.azure.us for GCC High, portal.azure.cn for China).

---

*Sources:*
- *[Microsoft Graph national cloud deployments](https://learn.microsoft.com/en-us/graph/deployments)*
- *[TeamsFx SDK — Teams | Microsoft Learn](https://learn.microsoft.com/en-us/microsoftteams/platform/toolkit/teamsfx-sdk)*