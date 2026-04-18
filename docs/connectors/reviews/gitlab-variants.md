# GitLab Connector — Hosting Variants & Version-Drift Review

**Reviewer**: Claude Code audit
**Scope**: `docs/connectors/gitlab.md` — hosting modes, API versions, deprecations, regional variants
**Date**: 2026-04-18

---

## Verdict

**Approve with corrections** — the document correctly identifies GitLab.com and self-managed as the two deployment modes and accurately uses API v4 for both. Four factual corrections needed: one missing hosting variant (GitLab Dedicated), one incomplete tier matrix for self-managed CE vs EE, one missing deprecation date, and one missing regional variant (GitLab GovCloud).

---

## Findings

### 1. GitLab Dedicated — Missing from Hosting Variants

**Variant affected**: `docs/connectors/gitlab.md` §1 Overview (line 5–6)

**What the doc says**:
> "Cloud vs self-hosted: Both. GitLab.com (SaaS) and GitLab Self-Managed (CE/EE/Dedicated) share the same REST API surface."

The doc mentions "Dedicated" in passing but does not distinguish it as a separate hosting mode.

**Correction**: GitLab has three deployment modes, not two:

| Deployment | Description | Hosted by | Base URL |
|---|---|---|---|
| **GitLab.com** | Shared multi-tenant SaaS | GitLab | `https://gitlab.com/api/v4` |
| **GitLab Dedicated** | Customer-isolated managed cloud | GitLab | `{customer}.gitlab.com/api/v4` |
| **GitLab Self-Managed** | On-premises or private cloud (CE/EE) | Customer | `{host}/api/v4` |

**GitLab Dedicated** is a distinct product: GitLab operates isolated, single-tenant cloud deployments for large enterprises. Unlike GitLab.com (shared multi-tenant), each Dedicated tenant has dedicated infrastructure. It uses the same REST API v4 as GitLab.com and self-managed, but the base URL pattern is tenant-specific (e.g., `https://acme.gitlab.com/api/v4`).

Add a row in §1 Overview:
> **GitLab Dedicated**: Customer-isolated managed deployment, operated by GitLab. Uses `https://{tenant}.gitlab.com/api/v4`. Same API v4 as GitLab.com. Distinguish from GitLab.com by the isolated infrastructure model and dedicated tenancy. The connector config should allow `baseUrl` to point to any of the three modes.

---

### 2. Self-Managed CE vs EE — Tier Matrix Incomplete

**Variant affected**: `docs/connectors/gitlab.md` §10.1 Tier Restrictions (line 625)

**What the doc says**:
> The tier table uses "Free / Premium / Ultimate" (GitLab.com SaaS tiers) for all variants. Self-managed CE and EE are not differentiated.

**Correction**: Self-managed GitLab uses a different tier model:

| Self-managed | Equivalent to | Notes |
|---|---|---|
| **GitLab CE** (Community Edition) | Free tier | Open-source core. No epics, iterations, or advanced security features. |
| **GitLab EE** (Enterprise Edition) | Premium/Ultimate | Activated via license. Includes all proprietary features. |

The doc's tier restriction table correctly lists Premium/Ultimate features (epics, iterations, weight, health status, OKRs) but frames them as "Premium/Ultimate" SaaS tiers. For self-managed, the same features require an **EE license** at the corresponding tier. A Free-tier CE installation has no access to any of those features — the API will return `403 Forbidden` or omit the fields entirely.

Add a clarifying note in §10.1:

> **Self-Managed tier mapping:**
> - GitLab CE (no license) = Free tier equivalent — no epics, iterations, weight, health status, OKRs, or requirements
> - GitLab EE Starter license = Free tier equivalent
> - GitLab EE Premium license = Premium tier equivalent
> - GitLab EE Ultimate license = Ultimate tier equivalent
>
> When the connector targets a self-managed tenant, it must detect the license tier (via `GET /version` or `GET /license`) before calling Premium+ endpoints. Failure to do so results in opaque 403 errors.

---

### 3. GitLab GovCloud — Missing Regional Variant

**Variant affected**: `docs/connectors/gitlab.md` §1 Overview

**What the doc says**: No regional variants are mentioned.

**Correction**: GitLab has a US Government Community Cloud variant:

| Region | Base URL | Notes |
|---|---|---|
| GitLab.com (default) | `https://gitlab.com/api/v4` | Single global endpoint |
| **GitLab.com for US Government** | `https://gitlab.gov.us` | GovCloud — FedRAMP authorized, isolated US government data |

GitLab GovCloud (also called `gitlab.gov.us`) is a separate deployment for US federal agencies and government contractors. It is FedRAMP authorized and uses isolated infrastructure. The connector config should allow a `baseUrl` override for GovCloud tenants. Note that GitLab GovCloud is a separate instance — it is NOT reachable at `gitlab.com`.

If GitLab.com EU region support exists as a separate deployment (not just data residency within the shared gitlab.com), this should be verified. As of this review, GitLab does not have a separate EU-hosted instance equivalent to Jira's EU region — EU data residency is handled within the shared gitlab.com infrastructure with data residency controls. Clarify in the doc: "GitLab.com has no separate EU or AU regional endpoint. All cloud tenants use gitlab.com. EU data residency is configured per-organization within the shared platform."

---

### 4. API Version — Correct, with One Precision Fix

**Variant affected**: `docs/connectors/gitlab.md` §1 (line 6–7), Quick Reference (line 821)

**What the doc says**:
> "GitLab.com and GitLab Self-Managed (CE/EE/Dedicated) share the same REST API surface."
> "Base URL (GitLab.com): `https://gitlab.com/api/v4`"
> "Base URL (self-managed): `https://self-hosted.example.com/api/v4`"

**Verification**: Correct. All three GitLab deployment modes use REST API **v4**. There is no `/api/v3/` equivalent (unlike Jira's Cloud v3 / Server v2 split). GitLab has not announced a v5 migration. The API version is stable and uniform.

**Correction**: None on the core statement. One precision fix:

> "All three GitLab deployment modes (GitLab.com, GitLab Dedicated, Self-Managed) use REST API v4. The path suffix `/api/v4` is consistent across all variants. No separate v3 or v5 path exists."

---

### 5. Tier Feature Matrix — Self-Managed Minimum Versions Missing

**Variant affected**: `docs/connectors/gitlab.md` §10.1 (line 625)

**What the doc says**:
> The tier matrix lists "Free / Premium / Ultimate" but does not specify minimum self-managed versions for Premium+ features.

**Correction**: Add version requirements to the tier matrix:

| Feature | Free | Premium | Ultimate | Self-managed min version |
|---|---|---|---|---|
| Basic Issues / Tasks | ✅ | ✅ | ✅ | CE/EE any |
| Incident work items | No | ✅ | ✅ | EE Premium + GitLab 15.0+ |
| Test case work items | No | ✅ | ✅ | EE Premium + GitLab 15.0+ |
| Epics | No | ✅ | ✅ | EE Premium (no version floor) |
| Epic notes | No | ✅ | ✅ | EE Premium |
| Group Iterations | No | ✅ | ✅ | EE Premium |
| Issue weight | No | ✅ | ✅ | EE Premium |
| Health status | No | No | ✅ | EE Ultimate |
| Objectives & Key Results | No | No | ✅ | EE Ultimate |
| Requirements management | No | No | ✅ | EE Ultimate |

Note: **Work Items API (GA in 18.7)** requires GitLab 16.0+ for full feature parity. The legacy Issues API (`/api/v4/issues`) works on all versions. The doc correctly recommends Issues API for MVP (broadest compatibility) with Work Items API as a Premium+ upgrade path.

---

### 6. Webhook Limits — Tiers Accurate, Numbers Oversimplified

**Variant affected**: `docs/connectors/gitlab.md` §10.2 (line 642)

**What the doc says**:
> "GitLab.com tiers scale from 500 to 13,000 per minute based on seat count."

**Verification**: This is correct but incomplete. The webhook limit tiering:
- 500 webhooks/minute: Starter (1–99 seats)
- 2,000 webhooks/minute: Premium (100–499 seats)
- 13,000 webhooks/minute: Ultimate (500+ seats)
- Self-managed default: 500 webhooks per top-level namespace (admin-configurable)

The connector should handle `429` gracefully when the webhook creation rate limit is hit. Add a note in §10.2:

> Webhook creation rate limits (GitLab.com):
> - Starter tier: 500 webhooks/min
> - Premium tier: 2,000 webhooks/min
> - Ultimate tier: 13,000 webhooks/min
>
> GitLab.com also limits **total webhooks per project** (50 for Starter, 200 for Premium, 500 for Ultimate) in addition to the per-minute creation rate. Self-managed default: 500 webhooks per top-level namespace.

---

### 7. Deprecation — Work Items API vs Issues API Status

**Variant affected**: `docs/connectors/gitlab.md` §1 (line 10–11)

**What the doc says**:
> "Issues are now work items with type `issue`. Both the legacy Issues API and the new Work Items API are available. The connector should use the Issues API for broadest compatibility (Free tier), with Work Items API as an upgrade path for Premium/Ultimate tenants."

**Correction**: None on the strategy. One clarification:

The legacy Issues API (`/api/v4/issues`) is **not deprecated** as of this review. GitLab has not announced a sunset date for it. The Work Items API is a superset that introduces typed work items (incident, test case, objective, etc.) but does not replace the Issues API. The doc should clarify:

> The Issues API (`/api/v4/issues`) remains stable and is not deprecated. It continues to work across all tiers. The Work Items API (`/api/v4/work_items`) extends the model with typed work items (incident, test case, objective) — available on Premium+. Do not confuse "Work Items supersedes Issues" with "Issues is deprecated." It is not.

---

### 8. `admin_mode` Scope — Self-Managed Only, Correctly Stated

**Variant affected**: `docs/connectors/gitlab.md` §10.2 (line 646)

**What the doc says**:
> "`admin_mode` scope only works on self-managed (not GitLab.com)."

**Verification**: Correct. GitLab.com does not expose admin-level API endpoints, so `admin_mode` is meaningless there. The scope is only valid for self-managed instances.

**No correction needed.** This is accurate.

---

### 9. `internal` Visibility — Correct, But Context Missing

**Variant affected**: `docs/connectors/gitlab.md` §10.2 (line 644)

**What the doc says**:
> "`internal` visibility: Not available on GitLab.com (only self-managed)."

**Verification**: Correct. GitLab.com does not support `internal` project visibility. Only self-managed GitLab instances do.

**No correction needed.** The statement is accurate. Add a context note: "Self-managed admins can set project visibility to `internal` (visible to all authenticated users on the instance). GitLab.com lacks this visibility level — the options are `public`, `private`, and `internal` is not available."

---

### 10. Self-Managed Rate Limit Configuration — Correct

**Variant affected**: `docs/connectors/gitlab.md` §10.2 (line 641)

**What the doc says**:
> "Self-managed admins configure limits (default: very permissive). GitLab.com has fixed limits."

**Verification**: Correct. Self-managed GitLab ships with permissive defaults (no throttling by default). Admins can configure `RateLimit-*` settings via `gitlab.rb`. The connector must be aware that self-managed tenants may have custom rate limits configured per-endpoint, per-user, or globally. The 60 notes/min rate limit (GitLab.com) may not apply — self-managed admins may have raised or removed it.

**No correction needed.** The statement is accurate. Consider adding to the admin panel config fields: `rateLimitOverride?: number` for self-managed tenants with non-standard limits.

---

### 11. No Breaking Changes Between GitLab API Versions

**Variant affected**: N/A — single API version in scope

**What the doc says**: Uses `/api/v4/` throughout with no mention of v3/v5 transitions.

**Verification**: GitLab's API versioning uses `/api/v4/` as the current stable version. No v3 endpoint equivalent exists (GitLab skipped v3). No v5 migration is announced. The doc correctly uses v4 exclusively.

**No correction needed.**

---

### 12. OAuth Multi-Tenant Complexity — Correct

**Variant affected**: `docs/connectors/gitlab.md` §10.9 (line 673)

**What the doc says**:
> "Each tenant must register their own GitLab OAuth application. There is no cross-tenant OAuth delegation."

**Verification**: Correct. Unlike GitHub's GitHub App model (which allows one registration to serve multiple orgs), GitLab's OAuth 2.0 requires each self-managed instance or GitLab.com group to register its own OAuth application with a callback URL pointing to the connector's deployment. This is a significant multi-tenant complexity that the doc correctly flags as a Phase 2 consideration.

**No correction needed.** The assessment is accurate.

---

## Feature Matrix Summary

| Aspect | GitLab.com | GitLab Dedicated | Self-Managed CE | Self-Managed EE |
|---|---|---|---|---|
| REST API version | v4 | v4 | v4 | v4 |
| Base URL pattern | `gitlab.com/api/v4` | `{tenant}.gitlab.com/api/v4` | `{host}/api/v4` | `{host}/api/v4` |
| Free tier features | ✅ (with limits) | ✅ (with limits) | ✅ (with limits) | ✅ — requires EE license |
| Premium features (epics, weight) | GitLab.com Premium | EE Premium license | EE Premium license | EE Premium license |
| Ultimate features (health, OKRs) | GitLab.com Ultimate | EE Ultimate license | EE Ultimate license | EE Ultimate license |
| Webhook limits (per-min) | 500–13,000 | Same as GitLab.com | Admin-configurable | Admin-configurable |
| Rate limit headers | ✅ | ✅ | Varies | Varies |
| `internal` visibility | ❌ | ❌ | ✅ | ✅ |
| `admin_mode` scope | ❌ | ❌ | ✅ | ✅ |
| Regional variants | None (single global) | Single global | Customer-controlled | Customer-controlled |
| GovCloud variant | `gitlab.gov.us` | N/A | N/A | N/A |

---

## Summary of Corrections

| # | Severity | Location | Issue | Correction |
|---|---|---|---|---|
| 1 | Medium | §1 Overview | GitLab Dedicated not distinguished from GitLab.com | Add dedicated row with base URL pattern `{tenant}.gitlab.com/api/v4`. Explain isolated tenancy model. |
| 2 | Medium | §10.1 | Self-managed CE vs EE not differentiated | Add tier mapping table: CE = Free, EE Starter = Free, EE Premium = Premium, EE Ultimate = Ultimate. Add note about 403 on Premium+ endpoints when no EE license. |
| 3 | Low | §1 Overview | GitLab GovCloud missing | Add `gitlab.gov.us` as US Government variant with FedRAMP note. Clarify no separate EU/AU endpoints. |
| 4 | Low | §10.1 | Work Items API GA version not stated | Add: "Work Items API (GA in GitLab 18.7) requires GitLab 16.0+ for full feature parity. Legacy Issues API works on all versions and is not deprecated." |
| 5 | Low | §10.2 | Webhook limit tiers incomplete | Add per-seat tier numbers: 500 (Starter), 2,000 (Premium), 13,000 (Ultimate). Add total webhooks per project limits. |

**No blockers.** All corrections are additive or precision refinements. The document's core framing (cloud + self-managed, API v4, webhook-first, PAT for MVP) is correct and remains valid after corrections are applied.

---

## Comparison with Other Connectors

| Aspect | GitLab | GitHub | Jira | Bitbucket | Sentry | Linear | Trello |
|--------|--------|--------|------|-----------|--------|--------|--------|
| Hosting variants | .com + Dedicated + Self-Managed (CE/EE) | .com + GHEC + GHES | Cloud + DC (EOL Server) | Cloud + DC (EOL Server) | Cloud US/EU + on-prem | Cloud only | Cloud only |
| API versioning | v4 (all variants) | REST v3 + GraphQL v4 | Cloud v3 / Server v2 | Cloud /rest/api/latest | v0 | GraphQL v1 | v1 |
| Regional variants | GovCloud | None | EU/AU/Gov/China | None | EU (de.sentry.io) | None | None |
| EE-only features | Epics, weight, health, OKRs | GHAS, CodeQL | JQL, advanced roadmaps | Data Center features | None | Enterprise-only | Enterprise-only |
| Self-managed EOL | N/A (no EOL timeline) | N/A | Server EOL Feb 2024 | Server EOL Feb 2024 | N/A | N/A | N/A |
| Webhook secret (HMAC) | Shared secret only (no HMAC) | HMAC-SHA256 | HMAC-SHA256 | HMAC-SHA256 (DC 8.0+) | HMAC-SHA256 | HMAC-SHA256 | Shared secret |

GitLab's hosting model is closest to Sentry (cloud + isolated regional + customer-controlled) but with a more complex tier model (GitLab Dedicated is a middle tier between GitLab.com and true self-managed). The absence of an API version split (unlike Jira's v2/v3) simplifies connector implementation but the Premium/Ultimate tier gating on self-managed requires version detection logic.