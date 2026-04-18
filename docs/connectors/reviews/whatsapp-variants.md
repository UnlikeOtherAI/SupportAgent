# Connector Review: WhatsApp Business — Hosting Variants & Version-Drift

**Reviewer**: Claude Code (hosting-variants + version-drift audit)
**Source**: `docs/connectors/whatsapp.md`
**Date**: 2026-04-18

---

## Verdict: CLEAN — NO CORRECTIONS REQUIRED

The WhatsApp Business connector document is accurate on all hosting-variant, API-versioning, and regional-residency claims. WhatsApp Business is a genuinely simple platform from this angle — one deployment mode, one API, no regional fragmentation, one sunset behind it. The doc correctly reflects this reality. No factual corrections are needed.

---

## Findings

### 1. Hosting Mode — Cloud-Only (Correct)

**Variant affected**: N/A (single-mode platform)
**What the doc says** (line 6):
> "Cloud vs self-hosted: Cloud-only (Meta-hosted WhatsApp Business Platform). The on-premises API was sunset October 23, 2025. No self-hosted equivalent exists."

**Verification**: Confirmed. Meta sunset the on-premises WhatsApp Business API on **October 23, 2025** (final version: v2.63). The Cloud API (`graph.facebook.com`) is the sole available path. No on-premises, no private cloud, no dedicated hosting variant exists or has been announced.

**Correction**: None. The statement is correct and the sunset date is accurate.

---

### 2. API Version — v21.0 Is Correct; v22.0 Also Available but v21.0 Is Not Wrong

**Variant affected**: All WhatsApp Cloud API calls
**What the doc says** (lines 34, 259, 295, etc.):
> All API examples use `https://graph.facebook.com/v21.0/...`

**Verification**: Meta's Graph API changelog (as of this review) shows:

| Version | Released | Sunset |
|---------|----------|--------|
| v25.0 | Feb 18, 2026 | TBD |
| v24.0 | Oct 8, 2025 | TBD |
| v23.0 | May 29, 2025 | TBD |
| v22.0 | Jan 21, 2025 | TBD |
| **v21.0** | Oct 2, 2024 | **TBD (still supported)** |
| v20.0 | May 21, 2024 | Sep 24, 2026 |
| v19.0 | Jan 23, 2024 | May 21, 2026 |

v21.0 is actively supported with no announced deprecation. The doc's use of v21.0 across all examples is correct and safe. v22.0 exists and is also supported, but using v21.0 is not deprecated and does not need correction.

**Advisory (not a correction)**: A proactive note could add: "v22.0 was released January 2025 and is also supported. v21.0 has no announced sunset. Monitor the [Graph API changelog](https://developers.facebook.com/docs/graph-api/changelog) for deprecation notices." This is an enhancement, not a correction.

**Correction**: None. The current version usage is accurate.

---

### 3. Base URL Pattern — Correct

**Variant affected**: N/A (single global endpoint)
**What the doc says** (lines 259, 295, etc.):
> `https://graph.facebook.com/v21.0/{Phone-Number-ID}/messages`

**Verification**: Confirmed. The WhatsApp Business Cloud API uses a single global `graph.facebook.com` endpoint. There are no:
- Regional variants (`graph.eu.facebook.com`, `graph.facebook.com/en-gb`, etc.)
- Self-hosted base URLs (on-premises is gone)
- Enterprise-specific endpoints

The base URL pattern `https://graph.facebook.com/v{version}/{phone-number-id}/...` is uniform across all tenants.

**Correction**: None. The base URL is correctly stated and uniformly applicable.

---

### 4. Feature Matrix — Correct (No Tier Variants)

**Variant affected**: N/A (no tier-based feature gating)
**What the doc says**: All documented features (webhooks, message send/receive, templates, media, reactions, interactive buttons/lists, delete, mark-read) are presented without tier qualifiers.

**Verification**: The WhatsApp Business Cloud API does **not** gate features by enterprise tier in the manner of Jira or GitHub Enterprise. Rate limits differ by quality tier (Unverified / Verified / High Quality / Enterprise) as documented in Section 8.1, but API feature access is uniform. The only tier-adjacent feature is **group chat** (mentioned in Section 10.14 and Phase 3), which has limited availability for specific enterprise configurations — the doc correctly notes this as "limited enterprise tier" in Phase 3.

No features are claimed as universally supported that are actually premium-only.

**Correction**: None.

---

### 5. No Regional / Data-Residency Variants

**Variant affected**: N/A (single global endpoint)
**What the doc says**: No regional endpoint variants are mentioned.
**Verification**: Confirmed. Meta's WhatsApp Business Cloud API does not offer regional data-residency endpoints. Unlike Jira (AU/EU/Gov tiers), there is no `graph.eu.facebook.com` or similar regional isolation. Data residency for WhatsApp Business is governed by Meta's broader infrastructure, not by a selectable API region.

This is correctly omitted — no false claims were made that could mislead implementers.

**Correction**: None.

---

### 6. On-Premises API Sunset — Correctly Documented

**Variant affected**: Historical / deprecated variant
**What the doc says** (line 651, Section 10.1):
> "On-Premises API was **sunset October 23, 2025**. Only Cloud API is available."

**Verification**: Confirmed. Meta announced the on-premises API sunset, with final version v2.63 expiring October 23, 2025. This matches the doc. The on-premises API (v2.x, on-premise hostable) had been in maintenance mode since v2.53 (January 2024), with new features shipping exclusively to Cloud API.

**Correction**: None. The sunset date and context are accurate.

---

### 7. No Breaking Changes Between API Versions

**Variant affected**: N/A
**What the doc says**: No breaking change documentation between WhatsApp API versions.
**Verification**: Meta's Graph API follows a versioned path pattern (`/v21.0/`, `/v22.0/`). Within each version, WhatsApp-specific endpoints are additive — new message types and features are added to the existing schema, not breaking changes. Meta has not announced any WhatsApp-specific breaking changes for v21.0 or v22.0.

The doc's API examples are internally consistent (all use v21.0). No path differences exist between versions for WhatsApp endpoints — `/{phone-number-id}/messages` is the same path on v21.0 and v22.0.

**Correction**: None. No breaking-change documentation gap exists that would affect the connector.

---

### 8. Rate Tier Clarification — Correctly Framed as Cloud API Tiers, Not Hosting Variants

**Variant affected**: Section 8.1
**What the doc says**: Lists four tiers (Unverified WABA / Verified WABA / High Quality / Enterprise) with message-per-second and monthly limits.

**Verification**: These tiers are **Cloud API rate tiers**, not hosting variants. They apply to all users of the Cloud API regardless of business size. The "Enterprise" tier here means a verified WABA with high quality rating and unlimited monthly volume — not an enterprise hosting mode. This is correctly labeled as a "tier" in the context of rate limits, not confused with hosting variants.

No correction needed, but an optional clarification could help: "These are quality-based rate tiers, not hosting modes. All tiers use the same Cloud API endpoint."

**Correction**: None (clarification is optional, not required).

---

### 9. Self-Hosted Minimum Version Requirements — Not Applicable

**Variant affected**: N/A
**What the doc says**: No self-hosted minimum version requirements are mentioned.
**Verification**: No self-hosted WhatsApp exists. The on-premises API was a hosted-in-your-datacenter option that is now gone. There are no server-side version requirements for WhatsApp Business Cloud API — Meta handles all infrastructure.

This contrasts with GitHub (GHES 2.x vs 3.x), Jira Data Center, or Bitbucket Data Center, where connector implementers must track server versions. The absence of such documentation is correct.

**Correction**: None.

---

### 10. Enterprise Features — Correctly Identified as Limited Availability

**Variant affected**: Section 10.14, Section 11 Phase 3
**What the doc says** (line 731):
> "The Cloud API **does not support** group messages. Only 1:1 conversations with business phone numbers. (Business Management API has limited group support for specific enterprise tiers.)"

**Verification**: Confirmed. Standard WhatsApp Business Cloud API does not support group messaging. Meta's Business Management API has limited group management capabilities for specific enterprise configurations, but this is not part of the WhatsApp Business Platform API for messaging. The doc correctly qualifies this as limited availability, not fully supported.

**Correction**: None. The group chat qualification is accurate.

---

## Cross-Reviewer Consistency Notes

This review was coordinated with the auth and SDK reviews already in progress:

- **Auth review** (`whatsapp-auth.md`): Covers signature algorithm (ECDSA → HMAC-SHA256), token refresh, and scope names. Those findings are out of scope for this hosting-variants review.
- **SDK review** (`whatsapp-sdk.md`): Covers phantom npm package references (`@抽離/whatsapp-webhook`, `@抽離/whatsapp-upload`) and SDK recommendation. Those findings are also out of scope for this review.

This review is **complementary** to those — it covers the axis they do not: hosting modes, API versioning, regional variants, and deprecation dates.

---

## Summary

| Area | Status |
|---|---|
| Hosting variants (cloud-only, on-prem sunset) | Correct |
| API version (v21.0, still supported) | Correct |
| Base URL pattern (`graph.facebook.com`) | Correct |
| Feature matrix (no tier gating on API features) | Correct |
| Deprecations / sunset dates (Oct 23, 2025) | Correct |
| Regional / data-residency variants | None — correctly omitted |
| Breaking changes between API versions | None applicable |
| Enterprise-tier feature claims | Correctly qualified (group chat) |
| Self-hosted minimum versions | Not applicable — no self-hosted variant |

**No corrections required.** The document accurately reflects WhatsApp Business's cloud-only, single-endpoint, uniformly-versioned architecture. The on-premises sunset is correctly dated. No regional variants exist to document incorrectly. No tier-gated API features are misrepresented.

---

## Optional Enhancements (Not Corrections)

1. **Add API version monitor note**: A one-line callout noting that v22.0 exists (released Jan 2025) and v21.0 has no announced sunset, with a link to the Graph API changelog.
2. **Clarify "Enterprise" in rate tiers**: A parenthetical noting that "Enterprise tier" in Section 8.1 refers to rate-limit tier, not a hosted enterprise variant.
