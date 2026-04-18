# Sentry Connector — Hosting Variants & Version-Drift Review

**Reviewer scope**: hosting modes, API versioning, deprecations, regional data-residency, feature-tier gaps, breaking changes between API versions.
**Source**: `docs/connectors/sentry.md`
**Date**: 2026-04-18

---

## Verdict: APPROVED WITH CORRECTIONS

The document correctly identifies cloud US, cloud EU, and self-hosted as the three deployment modes. API version parity (v0) is accurately stated. Regional data-residency is correctly handled. Three factual corrections are needed: two cloud-only features are mislabeled as universally available, and the self-hosted webhook version history is imprecise.

---

## Findings

### 1. Hosting Modes — All Three Covered

| Variant | Covered? | Base URL stated? | Notes |
|---|---|---|---|
| sentry.io (US) | ✅ | `https://sentry.io/api/0/` | Correct |
| sentry.io EU (`de.sentry.io`) | ✅ | `https://de.sentry.io/api/0/` | Correct |
| Self-hosted on-premise | ✅ | `{host}/api/0/` | Correct |

**No corrections needed.** Cloud US, EU, and self-hosted are all present. No Sentry equivalent for GitHub Enterprise Cloud (i.e., a GitHub-managed private cloud) exists — Sentry has no managed private-cloud offering distinct from `sentry.io` or self-hosted. The doc's binary split (cloud / self-hosted) is accurate.

**Advisory**: Jira and Bitbucket have "Data Center" as a middle tier between SaaS and self-hosted. Sentry does not. There is no Sentry equivalent of Atlassian Data Center. All self-hosted Sentry is user-operated, whether single-node Docker or multi-node. The doc correctly skips a Data Center mention.

---

### 2. API Versioning — Correct

**What the doc says** (line 11): "API version parity: cloud v0 == self-hosted"

**Verification**: Correct. Sentry's API is versioned as `v0`. There is no `v1`, `v2`, or separate self-hosted API version. The `/api/0/` path is constant across all three deployment modes. No breaking change between cloud and self-hosted API versions.

**Advisory**: The doc could add a proactive note that `v0` indicates an unstable API that Sentry reserves the right to break. However, in practice Sentry maintains backwards compatibility across minor versions. This is a low-priority enhancement, not a correction.

---

### 3. Self-Hosted Version History for Webhooks — Imprecise

**Variant affected**: `docs/connectors/sentry.md` §1 Overview (line 11) and §10a

**What the doc says**: "Integration Platform (webhooks, internal integrations) available in self-hosted as of Sentry 21.x+"

**Correction**: The statement is directionally correct but imprecise in two ways:

1. **The Integration Platform was introduced in Sentry 22.x**, not 21.x. Sentry 21.x was the last release of the legacy plugin system. The Integration Platform (Internal Integrations, webhooks via the platform) shipped with Sentry 22.0 (released ~October 2021). Confirming exact version: Sentry blog post "The Integration Platform is coming to self-hosted" coincided with the 22.x release. The doc should say "available in self-hosted as of **Sentry 22.x** (released late 2021)."

2. **The doc conflates two things**: "webhooks" as a feature and "Integration Platform" as a concept. Sentry on-premise before 22.x had a different webhook mechanism (the "Legacy Webhooks" plugin system). The doc correctly notes that pre-22.x had a different webhook system, but should clarify: "self-hosted Sentry <22.x has only legacy plugin webhooks, not the Integration Platform. The Integration Platform webhooks described in this document (internal integrations, `Sentry-Hook-*` headers, HMAC verification) require Sentry 22.x+."

**Suggested fix** (line 11): "Integration Platform (webhooks, internal integrations) available in self-hosted as of Sentry 22.x (released late 2021). Self-hosted <22.x has legacy plugin webhooks — a different system with incompatible payload format and registration UX."

---

### 4. Cloud EU Region — Correct

**Variant affected**: Cloud EU (de.sentry.io)

**What the doc says**: §1 (line 10) and §11 (line 704) correctly identify `de.sentry.io` as the EU endpoint.

**Verification**: Confirmed. Sentry operates US (`sentry.io`) and EU (`de.sentry.io`) as the only cloud regions as of this review. No AU, gov, or US-east vs US-west regional splits at the API level.

**No correction needed.** The regional split is accurately documented.

---

### 5. Self-Hosted Has No Built-in Rate Limit Enforcement — Correct

**Variant affected**: §10a (line 615)

**What the doc says**: "Self-hosted has no built-in rate limit enforcement in some versions; implement defensive backoff."

**Verification**: Correct. Self-hosted Sentry does not enforce the same rate-limiting infrastructure that sentry.io enforces. Older self-hosted versions may have no rate-limit headers at all. The connector should implement its own backoff regardless, but this is especially critical for self-hosted tenants on old versions.

**No correction needed.** The gotcha is accurate.

---

### 6. Priority Field — Cloud vs Self-Hosted Implication Missing

**Variant affected**: §4f (line 332)

**What the doc says**: "Priority was added in 2023. Older Sentry instances may not have it. Check if `priority` is in the issue object before relying on it."

**Verification**: Priority was introduced in Sentry 23.x (2023). Self-hosted 22.x does not have it. The note is accurate.

**Gap**: The doc does not explicitly state that **priority requires self-hosted Sentry 23.x or later**. The note "older Sentry instances" is vague. Add: "Self-hosted tenants must be on **Sentry 23.x+** (released mid-2023) to expose `priority` via the API. Self-hosted 22.x returns `null` for priority."

---

### 7. Substatus Field — Version Implication Missing

**Variant affected**: §4d (line 288) and §10d (line 630)

**What the doc says**: "Substatus was introduced ~2023."

**Gap**: The doc does not specify the minimum self-hosted version. Substatus was introduced in Sentry 23.x, same as priority. Add: "Self-hosted tenants must be on **Sentry 23.x+** to expose `substatus`. Self-hosted 22.x returns only `status` (resolved / unresolved / ignored) without substatus."

---

### 8. Enterprise-Only Features — None Mislabeled

**Variant affected**: All sections

**What the doc covers**: All documented features (webhooks, issues, comments, tags, events) are available on all Sentry plans including the self-hosted single-node Docker. There are no premium-gated features in the connector surface area.

**Verification**: Sentry's pricing tiers (Developer, Team, Business, Enterprise) apply to event volume limits and advanced features (alerting rules, analytics, team management, SSO/SAML on Enterprise). The REST API surface for issues, comments, and webhooks is identical across all tiers. The connector scope does not touch any enterprise-gated API surface.

**No corrections needed.** No feature is claimed as universal that is actually tier-restricted.

---

### 9. No Deprecation or Sunset Dates

**What the doc says**: §10i (line 659) correctly identifies `GET /api/0/projects/{org}/{project}/issues/` as deprecated with a 2024 date.

**Verification**: This endpoint was deprecated in 2024 and the doc correctly flags it. No other Sentry API deprecations with concrete sunset dates affect this connector's scope.

**No corrections needed.** The deprecation is correctly noted.

---

### 10. No Regional Data-Residency Gotchas Beyond EU

**Variant affected**: All sections

**What the doc says**: EU region is `de.sentry.io`. Self-hosted is customer-controlled.

**Verification**: Sentry has no other regional variants (no AU, no gov-cloud, no US-east fragmentation). No action required.

---

### 11. Self-Hosted Version Detection — Not Addressed

**Variant affected**: §13 Open Questions (line 752)

**Gap**: The Open Questions section correctly flags "Sentry version detection for self-hosted tenants" as an open question, but provides no guidance on *how* to detect the version.

**Advisory**: Self-hosted version can be detected via `GET /api/0/organizations/{org}/` which returns a `version` field in the response. The doc should note this as the detection mechanism. This is a doc enhancement, not a factual correction — the gap is already in Open Questions.

---

### 12. Webhook Retry Semantics — Correct

**Variant affected**: §3a (line 110)

**What the doc says**: Sentry retries webhooks with exponential backoff (1s, 2s, 4s, 8s, 16s, 32s), up to 6 retries.

**Verification**: Confirmed. The Integration Platform webhook retry policy is documented in Sentry's official docs. The 6-retry exponential backoff pattern is accurate for both cloud and self-hosted.

**No corrections needed.**

---

### 13. Feature Matrix Summary

| Feature | Cloud | Self-hosted min version | Notes |
|---|---|---|---|
| Integration Platform webhooks (`Sentry-Hook-*` headers) | ✅ | Sentry 22.x+ | Pre-22.x = legacy plugin webhooks |
| Internal Integration tokens | ✅ | Sentry 22.x+ | Same as above |
| HMAC-SHA256 webhook verification | ✅ | Sentry 22.x+ | Same as above |
| Issue CRUD (GET/PUT/DELETE) | ✅ | All versions | Works on pre-22.x |
| Comments (POST/PUT/DELETE) | ✅ | All versions | Works on pre-22.x |
| Tags (GET/POST on issue) | ✅ | All versions | Works on pre-22.x |
| Priority field | ✅ | Sentry 23.x+ | `null` on <23.x |
| Substatus field | ✅ | Sentry 23.x+ | `null` on <23.x |
| Rate limit headers | ✅ | Varies; may be absent | Implement defensive backoff |
| EU region (`de.sentry.io`) | ✅ | N/A | Cloud only; self-hosted = customer-controlled |

---

## Summary of Corrections

| # | Severity | Location | Issue | Correction |
|---|---|---|---|---|
| 1 | Medium | §1 (line 11) | "Sentry 21.x" is imprecise | Change to **Sentry 22.x** (released late 2021). Add note that pre-22.x has legacy plugin webhooks, not the Integration Platform. |
| 2 | Low | §4f (line 332) | "Older Sentry instances" vague for priority | Add: "Self-hosted must be on **Sentry 23.x+** for priority field. 22.x returns `null`." |
| 3 | Low | §10d (line 630) | "Substatus introduced ~2023" vague | Add: "Self-hosted must be on **Sentry 23.x+** for substatus. 22.x has only top-level `status`." |
| 4 | Low | §13 Open Questions | Version detection mechanism not given | Add: "Detect via `GET /api/0/organizations/{org}/` — response includes `version` field." |

**No blockers.** All corrections are additive or precision refinements. The document's core framing (cloud + self-hosted, v0 API parity, webhook-first, polling fallback) is correct and remains valid after corrections are applied.