# Zendesk Connector — Hosting Variants & Version-Drift Review

**Reviewer**: variant auditor
**Source**: `docs/connectors/zendesk.md`
**Date**: 2026-04-18
**Scope**: hosting modes, API version parity, regional endpoints, enterprise/premium feature gating, deprecation timelines

---

## Verdict

**Conditionally accurate.** The doc correctly identifies Zendesk as cloud-only with no self-hosted product. Most stated facts about API surface, deprecation dates, and plan-gating are accurate. Two substantive gaps exist: (1) regional data-residency variants are acknowledged but not enumerated with base URL patterns, and (2) one plan-tier name in the rate-limit table is inconsistent with current Zendesk naming.

---

## Findings

### 1. Regional Data-Residency Subdomain Patterns — NOT ENUMERATED

**Variant affected**: EU, AU, Government Cloud (US Federal)
**What the doc says** (Section 10, "Cloud-Only Product"):
> Organizations with data residency requirements must use Zendesk's regional cloud endpoints (`{subdomain}.zendesk.com` vs regional variants).

**Correction needed**: The doc acknowledges regional variants exist but gives zero concrete subdomain patterns. Zendesk ships four distinct regional base URLs:

| Region | Base URL pattern |
|--------|-----------------|
| United States (default) | `https://{subdomain}.zendesk.com` |
| European Union | `https://{subdomain}.zendesk.eu` |
| Australia | `https://{subdomain}.zendesk.com.au` |
| US Government / Federal | `https://{subdomain}.zendesk.gov` |

**Impact**: A connector that hard-codes `.zendesk.com` will fail silently for EU, AU, or Government Cloud tenants — the API call will route to US infrastructure regardless of the tenant's configured region. The connector must accept a configurable base URL or at minimum document the regional variants in the config fields.

**Recommended fix**: Add `base_url` as an explicit connector config field with default `https://{subdomain}.zendesk.com`. Document the regional variants in Section 10 and the connector scope (Section 11).

---

### 2. High Volume Rate-Limit Tier — Naming Inconsistency

**Variant affected**: Enterprise Plus / High Volume API Add-on
**What the doc says** (Section 8, "Rate Limits"):
```
Enterprise Plus: 2,500
High Volume Add-on: 2,500
```

**Correction needed**: "High Volume Add-on" is the colloquial name. The Zendesk official API documentation calls it the **High Volume API Add-on**. More importantly, the two entries in the table are redundant — both map to 2,500 req/min on the Support/Help Center API. The doc should clarify:

- **Enterprise Plus** is a Zendesk Suite plan tier (distinct from standard Enterprise)
- **High Volume API Add-on** is an add-on purchasable on Growth+ and Professional+ plans
- Both yield 2,500 req/min but are different purchase vehicles

The doc's Essential plan (10 req/min) also warrants scrutiny: this is a legacy plan no longer sold and should be labeled "(legacy)" explicitly, which it already is — no change needed.

---

### 3. Enterprise-Only Features — Incomplete Enumeration

**Variant affected**: Team vs Professional vs Enterprise vs Enterprise Plus
**What the doc says**:

The doc correctly flags custom ticket statuses as Enterprise (Section 5). It does not flag these Enterprise/premium-only features that appear in the connector scope:

| Feature | Required Tier | Location in Doc |
|---------|--------------|----------------|
| Custom ticket statuses (`/api/v2/ticket_statuses.json`) | Enterprise | Correctly noted |
| SLA fields (`ticket.sla.status_changed` webhook) | Enterprise (SLA add-on) | Not flagged |
| Multi-brand (`brand_id` config field) | Enterprise | Not flagged |
| Custom objects (`/api/v2/custom_objects/*`) | Professional+ (Legacy Custom Objects being sunset Jan/Jul 2026) | Not flagged |
| AI Agents API (Phase 3 scope) | AI Agents add-on | Not flagged |
| Omnichannel Routing APIs (Phase 3 scope) | Enterprise | Not flagged |

**Correction needed**: The Phase 2 and Phase 3 connector scope sections should include tier annotations so implementers know which features require upsell conversations with prospective tenants.

---

### 4. Legacy Custom Objects — Active Deprecation Not Prominently Flagged

**Variant affected**: Professional+ / Enterprise
**What the doc says** (Phase 3, "Custom Objects API"):
> Custom Objects API: Define relationships between tickets and business-specific data

**Correction needed**: The Zendesk changelog specifies:
- **Jan 15, 2026**: No new legacy custom objects can be created
- **July 2026**: Legacy custom objects fully removed

The doc should not list Custom Objects as Phase 3 scope without a deprecation warning. If the connector wraps this API, it will break for new object creation by mid-2026 and completely by July 2026. Recommend either removing from scope or flagging as "deprecated — do not implement."

---

### 5. Sunshine Conversations — Incorrectly Described as "Being Sunset"

**Variant affected**: Messaging integrations
**What the doc says** (Section 10, "Multiple Zendesk Products"):
> Do not conflate with Sunshine Conversations (messaging layer) — being sunset.

**Correction needed**: This is vague. Zendesk's position is more nuanced — Sunshine Conversations (the standalone product) was sunset in 2024. However, Sunshine Conversations *capabilities* were integrated into Zendesk's native messaging product. The doc should clarify that the standalone Sunshine Conversations platform is already gone, not "being sunset." Including it in a 2026 connector doc as a caveat is misleading.

---

### 6. Global OAuth Token Expiration — Sunset Date Missing

**Variant affected**: All non-global OAuth clients (current) / all OAuth clients (future)
**What the doc says** (Section 10, "Global OAuth Token Expiration"):
> Global (external) OAuth clients now require refresh token flow. Non-global tokens can still be long-lived.

**Correction needed**: The Zendesk changelog specifies **Apr 1, 2027** as the deadline for **Local OAuth clients** to adopt refresh token flow. The doc should add this date:

> Local (non-global) OAuth clients must adopt refresh token flow by **Apr 1, 2027**. After this date, long-lived non-global tokens will be revoked.

This is a breaking change for any connector that currently relies on long-lived non-global OAuth tokens.

---

### 7. API Version — Accurate

**Variant affected**: None — confirmed accurate
**Finding**: The Support API is `/api/v2/` exclusively. There is no v1 (sunset long ago) and no v3 for the Support/Ticketing API. Other Zendesk products (Chat, Talk, Sell) have different API versioning, but for the Support connector target, v2 is correct and singular. No correction needed.

---

### 8. Webhook Event Catalog — Feature-Gate Flags Missing

**Variant affected**: SLA events, agent availability events
**What the doc says** (Section 3, webhook events):
```
ticket.sla.status_changed | SLA breach/fulfillment
```

**Correction needed**: SLA events require the **SLA add-on**, which is an Enterprise-tier add-on. The webhook table should annotate `ticket.sla.status_changed` as Enterprise-only.

Similarly, the rate-limit table references the "Agent Availability API" (300 req/min) — this is an Enterprise-only API and should be flagged as such.

---

### 9. Incremental Export API — Rate Limit Discrepancy

**Variant affected**: All plans using incremental export for sync
**What the doc says** (Section 3, polling fallback):
> Cursor-based pagination has no resource limits (unlike offset pagination)
> Recommended: poll every 30-60 seconds for new events

**Correction needed**: The Zendesk rate-limit documentation (updated Jun 27, 2025) now applies rate limits to Incremental User Export: **20 req/min standard, 60 req/min with High Volume add-on**. The doc's blanket "no resource limits" claim is outdated. The connector's polling loop should respect these limits and back off accordingly.

Note: Incremental Ticket Export appears to have a separate limit of 10 req/min (30 with High Volume add-on) — this should also be documented.

---

### 10. Hosted-Mode Summary — Accurate with Gap

**Variant affected**: N/A (Zendesk is single-mode)
**Finding**: The doc correctly states Zendesk is cloud-only with no self-hosted equivalent. This is accurate as of 2026. The legacy Zenoss product (unrelated) and any historical on-prem Zendesk products are correctly excluded. No correction needed on this point.

---

## Summary Table

| # | Variant / Topic | Severity | Type |
|---|-----------------|----------|------|
| 1 | Regional subdomains not enumerated | **High** | Missing information |
| 2 | High Volume Add-on vs Enterprise Plus naming | Low | Naming inconsistency |
| 3 | Enterprise-only features incompletely flagged | **Medium** | Incomplete gating |
| 4 | Legacy Custom Objects deprecation (Jan/Jul 2026) | **Medium** | Missing deprecation |
| 5 | Sunshine Conversations "being sunset" description | Low | Inaccurate framing |
| 6 | Global OAuth future sunset (Apr 2027) missing | **Medium** | Missing deprecation |
| 7 | API version `/api/v2/` — accurate | None | Verified correct |
| 8 | SLA webhook and Agent Availability — tier not flagged | Low | Incomplete gating |
| 9 | Incremental Export rate limits ("no limits" is stale) | **Medium** | Outdated claim |
| 10 | Cloud-only status — accurate | None | Verified correct |

---

## Recommended Actions

1. **Add regional base URL config field** (`base_url`) with default `.zendesk.com` and documented fallbacks for `.zendesk.eu`, `.zendesk.com.au`, `.zendesk.gov`.
2. **Add tier annotations** to Phase 2/3 scope: mark SLA events, custom statuses, multi-brand, omnichannel routing, AI Agents as Enterprise/add-on.
3. **Remove Custom Objects** from Phase 3 scope or add explicit "legacy API, being removed July 2026" warning.
4. **Add Apr 1, 2027** deadline for local OAuth refresh token migration.
5. **Fix Incremental Export section**: replace "no resource limits" with the actual per-minute limits.
6. **Clarify Sunshine Conversations**: remove "being sunset" — the standalone product is already gone.
7. **Deduplicate rate-limit table**: collapse the two 2,500 entries into a single row with a note explaining Enterprise Plus vs High Volume Add-on.
