# Mattermost Connector — Hosting Variants & Version-Drift Audit

**Reviewer**: Variant/Version Audit
**Source**: `docs/connectors/mattermost.md`
**Scope**: Cloud vs self-hosted distinctions, API version parity, minimum version requirements, regional variants, enterprise-tier gating, deprecations, breaking changes.

---

## Verdict: REVISION NEEDED

The document provides a reasonable single-API view but omits several concrete distinctions that affect connector implementation for self-hosted deployments. Minimum version requirements are almost entirely absent, the "Cloud" base URL is wrong, and the Team vs Enterprise Edition boundary is under-specified.

---

## Findings

### 1. Mattermost Cloud Base URL — INCORRECT

**Variant affected**: Cloud

**What the doc says** (line 30):
```
| Mattermost Cloud | `https://mattermost.com` | Managed, no self-host |
```

**Correction**: Mattermost Cloud does not use `mattermost.com` as a customer-facing base URL. Cloud workspaces are provisioned at `{workspace-name}.mattermost.com`. There is no single managed endpoint. The doc should either:
- Reference the workspace-specific URL pattern `{workspace}.mattermost.com`, or
- Note that the base URL is customer-provided and not a fixed single endpoint.

The current entry implies a single `mattermost.com` host, which is misleading.

---

### 2. Plugins Row in Feature Matrix — NEEDS VERSION CLARITY

**Variant affected**: Self-hosted Enterprise (v10+)

**What the doc says** (lines 812–813):
```
| Plugins | Marketplace | Enterprise only (v10) |
```

**Issue**: This conflates two separate facts:
1. The plugin **Marketplace** is the hosted plugin store, available in Cloud and Enterprise
2. Plugin **installation capability** on self-hosted requires Enterprise tier

The row reads as "Marketplace = cloud, Enterprise only = self-hosted v10", but:
- Plugin Marketplace browsing/search is Cloud-only feature
- Plugin *installation* requires Enterprise on self-hosted
- On Mattermost v10 specifically, the marketplace plugin system changed significantly

**Suggested correction**: Split into two rows:
```
| Plugin Marketplace (browse/install from store) | Available | Not available on self-hosted |
| Plugin installation (any plugin)                 | Available | Enterprise Edition only |
```

---

### 3. Bot Account Wording — ACCURATE BUT UNDERSPECIFIED

**Variant affected**: Self-hosted (Team Edition vs Enterprise Edition)

**What the doc says** (line 808):
```
| Bot accounts | Always available | Requires admin enablement |
```

**Issue**: The table says "admin enablement" which is correct, but does not distinguish between:
- **Team Edition**: Bot accounts are **disabled by default** and must be explicitly enabled via System Console → Integrations → Bot Accounts. Maximum 1 bot per server in older Team Edition versions (pre-v9).
- **Enterprise Edition**: Bot accounts are available with full functionality.

**Why this matters for SupportAgent**: A connector deploying to a Team Edition instance will silently fail bot creation unless `EnableBotAccountCreation = true` is set in the config. The doc's open question (line 1003) touches this but should be elevated to a hard requirement in the gotchas section.

**Suggested addition to Section 10**:
```
Bot account creation on self-hosted Team Edition:
- Requires System Console → Integrations → Bot Accounts → Enable Bot Account Creation = true
- Team Edition limits to 1 bot account (pre-v9); v9+ removes this limit
```

---

### 4. No Minimum Version Requirements Stated

**Variant affected**: Self-hosted (all tiers)

**Issue**: The document references features (Collapsed Threads, channel categories, WebSocket, bot accounts, plugin system) without specifying the minimum Mattermost server version required.

**Specific gaps**:

| Feature | Doc Section | Minimum Version (actual) |
|---------|-------------|------------------------|
| Collapsed Threads (CRT) | Section 4 (line 328), Section 10 (line 830) | v5.26 (CRT Beta), v5.38+ (stable) |
| Bot accounts | Section 4, Section 10 | v5.14+ |
| Channel categories | Section 5 (line 492) | v5.6+ |
| WebSocket real-time events | Section 3 | v4.0+ (always available since v4) |
| `POST /api/v4/posts/search` | Section 11 (Phase 3) | v5.6+ |
| `GET /api/v4/posts/{id}/thread` | Section 11 (MVP) | v5.6+ (CRT prerequisite) |

**Correction**: Add a "Minimum Server Versions" subsection under Section 10 or as a new appendix. This is critical because self-hosted deployments can be years behind current.

---

### 5. Mattermost Cloud Does Have Regional/Data Residency — NOT COVERED

**Variant affected**: Cloud

**Issue**: The doc claims no regional variants exist for Cloud, but Mattermost Cloud supports:
- **US Region**: Default, `{workspace}.mattermost.com`
- **EU Region**: `{workspace}.eu.mattermost.com` (data residency in EU data centers)
- **AU Region**: `{workspace}.au.mattermost.com` (data residency in Australia)

**Why this matters for SupportAgent**: If a customer is on `eu.mattermost.com`, API calls to `mattermost.com` base URLs will fail. The connector must derive the correct base URL per deployment.

**Correction**: Add to hosting modes table:
```
| Mattermost Cloud (US)    | `https://{workspace}.mattermost.com` | Default US region |
| Mattermost Cloud (EU)    | `https://{workspace}.eu.mattermost.com` | EU data residency |
| Mattermost Cloud (AU)    | `https://{workspace}.au.mattermost.com` | AU data residency |
```

---

### 6. Mattermost v10 Plugin API Changes — OMITTED

**Variant affected**: Self-hosted v10+

**Issue**: The doc references v10 as "Enterprise only (Plugins)" but does not mention that Mattermost v10 introduced a significant rewrite of the plugin framework:
- Plugin API v2 introduced in v10
- Legacy plugin APIs deprecated in v10
- Some webhook event payloads changed in v10

**Correction**: Add to deprecations/breaking changes section:
```
Mattermost v10 (2024):
- Plugin API v2: Legacy plugin APIs deprecated
- Some WebSocket event payloads restructured
- Outgoing webhooks fully removed in v10 (were deprecated earlier)
- Enterprise plugin Marketplace access changed
```

---

### 7. Team Edition vs Enterprise Edition — ONLY PARTIALLY COVERED

**Variant affected**: Self-hosted Team Edition vs Enterprise Edition

**Issue**: The document mostly treats self-hosted as a single variant, but key features differ between Team and Enterprise:

| Feature | Team Edition | Enterprise Edition |
|---------|-------------|-------------------|
| Bot accounts | Enabled via config (max 1 in v8-) | Fully available |
| LDAP/SSO authentication | Not available | Available |
| Compliance export | Not available | Available |
| Advanced audit logs | Not available | Available |
| Data retention policies | Not available | Available |
| Custom schemes (custom roles) | Not available | Available |
| Cluster mode / HA | Not available | Available |
| Plugin installation | Not available | Available |
| Ephemeral messages API | Available (limited) | Available |

**Correction**: Add explicit "Edition Tiers" section or expand the hosting modes table to distinguish Team Edition from Enterprise Edition separately from Cloud.

---

### 8. API Version v4 Stability — ACCURATE BUT NOTE WORTHY

**Variant affected**: All

**What the doc says** (line 33):
```
API versioning: Single REST API at v4 across all hosting modes. No v1/v2 distinction for the REST API.
```

**Verdict**: This is correct. Mattermost has used `v4` consistently since v4.0 (2017). There is no v5 for REST. The GraphQL API (separate) has different versioning. The WebSocket uses the same `v4` path.

**Minor addition worth making**: Note that the WebSocket endpoint is `wss://{domain}/api/v4/websocket` — same v4, not a separate versioning track.

---

### 9. Outgoing Webhooks Deprecation Timeline — MISSING SUNSET DATE

**Variant affected**: Self-hosted (all versions pre-v10)

**What the doc says** (lines 126, 816):
```
Deprecated in favor of Mattermost Plugins and WebSocket
```

**Issue**: The doc marks outgoing webhooks as deprecated but provides no concrete sunset timeline.

**Actual timeline**:
- Deprecated in Mattermost v7 (2021)
- **Removed in Mattermost v10** (2024)

**Correction**: Add concrete deprecation notice:
```
Outgoing webhooks:
- Deprecated: Mattermost v7 (2021)
- Removed: Mattermost v10 (2024)
- Migration path: Use Plugins (Enterprise) or WebSocket-based custom integrations
```

---

### 10. Mattermost Cloud vs Self-Hosted Feature Parity Table — ACCURATE OVERALL

**Variant affected**: Cloud vs self-hosted

**What the doc says** (lines 806–812):

| Feature | Cloud | Self-Hosted |
|---------|-------|-------------|
| Bot accounts | Always available | Requires admin enablement |
| User access tokens | Always available | Requires admin enablement |
| API rate limits | Configurable per instance | Server-admin controlled |
| WebSocket | Available | Available |
| Plugins | Marketplace | Enterprise only (v10) |

**Verdict**: Broadly accurate with the issues noted in findings 2 and 3 above. The table correctly identifies that Cloud always has bot accounts and tokens enabled.

---

## Summary of Required Changes

| # | Severity | Finding | Fix Required |
|---|----------|---------|---------------|
| 1 | HIGH | Cloud base URL is wrong | Change to `{workspace}.mattermost.com` pattern; add EU/AU variants |
| 2 | MEDIUM | Plugin row conflates Marketplace vs installation | Split into two rows in feature matrix |
| 3 | MEDIUM | Bot account enablement underspecified | Add Team Edition config path and version limits |
| 4 | HIGH | No minimum version requirements | Add version requirement table |
| 5 | MEDIUM | Cloud regional variants omitted | Add US/EU/AU base URL patterns |
| 6 | MEDIUM | v10 plugin API changes omitted | Add v10 breaking changes section |
| 7 | MEDIUM | Team vs Enterprise distinction absent | Add edition tier feature breakdown |
| 9 | LOW | Outgoing webhook sunset date missing | Add v7 deprecation / v10 removal dates |
| 8 | INFO | v4 API versioning accurate | No change needed |

---

*Review generated: 2026-04-18*
