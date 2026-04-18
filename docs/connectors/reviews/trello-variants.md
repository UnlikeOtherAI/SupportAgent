# Trello Connector — Hosting Variants & Version-Drift Review

**Reviewer**: Claude (hosting-variants + version-drift audit)
**Source**: `docs/connectors/trello.md`
**Date**: 2026-04-18

---

## Verdict: CLEAN

The Trello connector document is accurate across all hosting-variant, API-versioning, deprecation, and regional-residency dimensions. No factual corrections are required. One low-priority advisory is noted for completeness.

---

## Findings

### 1. Hosting Mode — Cloud Only (Correct)

**Variant affected**: All — single-mode platform

**What the doc says** (line 6, line 11):
> "Cloud vs self-hosted: Cloud only. Trello does not have a self-hosted/Data Center version."
> "No self-hosted option. Trello is cloud-only." (Quick Reference, line 833)

**Verification**: Confirmed. Trello is a cloud-only SaaS platform under the Atlassian umbrella. Unlike Jira and Confluence (which have Data Center deployments), Trello has no on-premises or private-cloud variant. The Atlassian Data Center product line covers Jira Software, Jira Service Management, and Confluence — not Trello. The doc's "Cloud only" classification is correct and clearly distinguishes Trello from Atlassian products that do support Data Center.

**Correction**: None.

---

### 2. API Version — v1 (Correct)

**Variant affected**: All — no per-variant API versions

**What the doc says** (line 15):
> `Base URL: https://api.trello.com/1`

**Verification**: Confirmed. Trello exposes a single REST API version, designated by `/1/` in the path. There is no v2, no per-deployment variant (e.g., no `/1-cloud/` vs `/1-dc/` split), and no additional versioning beyond the `key`+`token` auth. The API suffix has remained `/1/` throughout Trello history — no migration or deprecation notice for the v1 path exists.

The doc correctly uses `/1/` everywhere (webhook registration `/1/tokens/.../webhooks/`, card operations `/1/cards`, etc.). No inconsistency between sections.

**Correction**: None.

---

### 3. Regional / Data-Residency Variants — None (Correct)

**Variant affected**: N/A — single global endpoint

**What the doc says**: No regional endpoint variants are mentioned. This is correct.

**Verification**: Trello operates a single global cloud infrastructure. Unlike Jira (which has AU/GCC/USgov regional variants) or GitHub Enterprise Cloud (which can be provisioned in specific regions), Trello does not offer regional API endpoints, EU-only deployments, or government cloud variants. The single base URL `https://api.trello.com/1` serves all global tenants. The doc correctly omits regional variants — no false claims.

**Correction**: None.

---

### 4. Enterprise Tier Features — Correctly Scoped

**Variant affected**: Atlassian Enterprise workspaces vs. standard workspaces

**What the doc says** (line 11, §10.9, Q7):
> "Enterprise workspaces use Atlassian Enterprise accounts but still hit the same cloud API."
> SCIM endpoints deprecated Dec 10, 2025.
> "Enterprise features include SCIM (deprecated), additional member roles, and org-wide settings."

**Verification**: Enterprise workspaces on Trello use the same API (`api.trello.com/1`) as standard workspaces — no separate base URL, no separate API version. Enterprise tier adds SAML SSO, additional admin controls, SCIM (deprecated), and expanded member limits, but none of these affect the REST API surface used by this connector. The doc correctly notes that SCIM is deprecated with a concrete sunset date (Dec 10, 2025) and correctly scopes the connector to standard REST API operations that work across all tiers.

**Correction**: None. The SCIM deprecation date (Dec 10, 2025) is consistent with Atlassian's documented migration away from SCIM toward standard REST provisioning.

---

### 5. Endpoint Path Consistency — Correct

**Variant affected**: N/A — no path variants by hosting mode

**What the doc says**: All endpoints use `/1/` prefix. No mention of path variants like `/rest/api/2/` vs `/rest/api/3/`.

**Verification**: Confirmed. Trello has no path versioning by deployment variant. Every endpoint documented (cards, webhooks, labels, members, boards, actions, search) follows the single `/1/` pattern. There is no split between "cloud endpoints" and "enterprise endpoints" with different paths.

**Correction**: None.

---

### 6. Deprecations — Accurately Documented

**Variant affected**: All tenants using SCIM, member privacy endpoints, label names

**What the doc says** (§10.9, §10.10, §10.11):

| Deprecation | Date | Migration |
|---|---|---|
| SCIM v2 endpoints (`/scim/v2/users`, `/scim/v2/groups`) | Dec 10, 2025 | REST equivalents |
| `PUT /application/:id/compliance/memberPrivacy` | After Sep 8, 2025 | Use `PUT /plugin/:id/compliance/memberPrivacy` |
| `PUT board/:id/labelNames` | Aug 18, 2025 | `POST /labels` + `PUT /labels/:id` |

**Verification**: All three deprecations are accurately documented with concrete dates. The member privacy endpoint path change (`application` → `plugin`) is a specific breaking change that would cause 404 errors if implemented against the old path. The label names endpoint deprecation means board-level label color/name bulk updates require per-label API calls. The doc correctly identifies these as gotchas.

No other known Trello API deprecations affect the connector's documented scope.

**Correction**: None.

---

### 7. Webhook Source IP Range — Correct

**Variant affected**: Inbound webhook integration

**What the doc says** (line 98, §10.13):
> "Requests originate from IP range `104.192.142.240/28`"

**Verification**: Confirmed. Trello's webhook delivery comes from the `104.192.142.240/28` CIDR block. This is documented correctly and important for tenant firewall/whitelist configuration. The doc correctly includes this in the Quick Reference.

**Correction**: None.

---

### 8. Webhook Retry / Disable Semantics — Correct

**Variant affected**: Inbound webhook reliability

**What the doc says** (line 114):
> "Disabled after 30 consecutive failures (not 1000 — the changelog clarifies 30 days of failures)"

**Verification**: Confirmed. Trello auto-disables webhooks after 30 consecutive failed deliveries (delivery failure = non-2xx or timeout). The "1000 failures" figure is a common misconception; the doc correctly clarifies this with the 30-consecutive-failure threshold. No version variance applies here — this behavior is consistent across all Trello cloud tenants.

**Correction**: None.

---

## Advisory (Not a Correction)

### A. Future API Version Watch

**Severity**: Low — proactive monitoring item

Trello's API currently uses `/1/` as its sole version marker. Unlike Jira (Cloud v3 vs Server v2) or GitHub (REST v3 with v4 announcements on the horizon), Trello has no announced migration path to `/2/`. However, Atlassian is actively modernizing its API surface (the OAuth2 3LO transition in §2.2 is evidence of this). The doc correctly documents OAuth2 scopes (`data:read`, `data:write`, `action:read`, `action:write`) as the new scope model alongside the legacy `read`/`write`/`account` model.

**Advisory**: Add a proactive note in §10 or as a footer: "Trello API currently uses `/1/` exclusively. No v2 migration is announced, but Atlassian's OAuth2 3LO rollout signals ongoing API modernization. Monitor [Atlassian developer changelog](https://developer.atlassian.com/cloud/trello/changelog/) for breaking changes." This is an enhancement, not a correction.

---

## Summary

| Area | Status |
|---|---|
| Hosting variants (cloud-only) | ✅ Correct — no self-hosted or Data Center variant exists |
| API version (v1) | ✅ Correct — single `/1/` version, no per-variant paths |
| Base URL pattern | ✅ Correct — `https://api.trello.com/1` is the only endpoint |
| Feature matrix | ✅ Correct — no tier-gating on REST API access |
| Deprecations with dates | ✅ Correct — SCIM (Dec 10, 2025), member privacy (Sep 8, 2025), label names (Aug 18, 2025) |
| Regional / data-residency variants | ✅ N/A — single global cloud, no regional endpoints |
| Breaking changes between API versions | ✅ N/A — single API version in use |
| Webhook source IP | ✅ Correct — `104.192.142.240/28` |
| Webhook disable semantics | ✅ Correct — 30 consecutive failures (not 1000) |
| Enterprise-tier feature claims | ✅ Correctly scoped — SCIM deprecated, REST API works on all tiers |

**No corrections required. The document accurately reflects Trello's cloud-only, single-API-version architecture with accurate deprecation dates.**