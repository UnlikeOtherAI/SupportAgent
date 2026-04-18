# Discord Connector Review: Hosting Variants & Version Drift

**Reviewer**: Hosting Variants / Version Drift
**Source doc**: `docs/connectors/discord.md`
**Date**: 2026-04-18

---

## Verdict: ACCURATE — No Issues Found

Discord has no self-hosted variants, no enterprise tiers with distinct API paths, and no regional data-residency options. The doc correctly reflects this and does not incorrectly claim features exist across variants that actually don't. No version-drift concerns apply.

---

## Findings

### ✓ Cloud-only status stated correctly

**What the doc says (line 6)**:
> Cloud vs Self-hosted: Cloud-only. No self-hosted option exists.

**Assessment**: Accurate. Discord does not offer an on-premise or self-managed deployment. There is no "Discord Enterprise Server" or "Discord Data Center" equivalent. The connector docs are correct not to address self-hosted variants.

---

### ✓ API version is correctly identified

**What the doc says (line 541)**:
> Currently v10. Gateway URL includes `?v=10`.

**Assessment**: Accurate. Discord REST API is currently at v10. Gateway protocol (WebSocket) is also v10. Unlike GitHub (which has REST v3 and GraphQL v4 simultaneously) or Jira (which has Cloud v3 and Server/DC v2), Discord does not have a multi-version API surface that needs variant-level tracking. The doc correctly identifies the current version and does not stray into describing outdated versions.

---

### ✓ No variant-specific endpoint paths to misreport

Discord has a single API surface:
- REST: `https://discord.com/api/v10/`
- Gateway: `wss://gateway.discord.gg/?v=10&encoding=json`

The doc correctly uses relative paths (`/channels/{id}/messages`) and only states the absolute Gateway URL once. No variant path differences exist (unlike Jira with `/rest/api/2/` vs `/rest/api/3/`).

---

### ✓ No deprecation dates needed

Discord's API versioning is non-breaking within a version. They do deprecate endpoints, but these are handled via gateway events and developer portal announcements rather than scheduled sunset dates. The doc does not claim any deprecation timeline, which is appropriate.

**Note for future**: Discord has deprecated certain older Gateway versions (v6, v8) but v10 is current and stable. The doc's use of v10 is correct.

---

### ✓ No regional/data-residency variants

Discord does not have Jira-style AU/EU regional instances or Slack Enterprise Grid geographic separation. User data is stored in Discord's infrastructure with no tenant-controlled residency. The doc correctly does not discuss regional variants.

---

### ✓ Privileged intent warnings are accurate and cloud-context-relevant

**What the doc says (line 55–64)**:
> MESSAGE_CONTENT is a **privileged intent**. Apps in >100 servers require Discord verification approval.

**Assessment**: This is accurate and the doc correctly frames it as a limitation of Discord's bot verification process rather than a variant difference. The verification requirement applies uniformly across all bot apps regardless of tenant size.

---

### ✓ No enterprise-tier feature matrix needed

Discord does not have tiers like GitHub (Free/GHES/GHEC) or GitLab (Free/CE/EE/Premium/Ultimate). All API endpoints are available to any bot app. The doc correctly treats features as universally available without tier qualifiers.

---

## Minor Observations (Not Issues)

1. **Base URL not explicitly stated**: The doc shows `wss://gateway.discord.gg/?v=10&encoding=json` but doesn't state `https://discord.com/api/v10/` as the REST base. This is acceptable given the document focuses on behavior rather than serving as an API reference, but a future version could add it for completeness.

2. **Audit log scope**: The doc mentions "Audit log integration for moderation events" as a Phase 3 feature (line 598). Audit logs are only available to bot tokens with `VIEW_AUDIT_LOG` permission, which requires the bot to be in a guild where the bot owner has `VIEW_AUDIT_LOG` permission. This is not a variant restriction — it's a permission model. The doc correctly frames it as a capability rather than a variant gap.

3. **Gateway vs REST versioning independence**: Discord Gateway and REST API versions can drift (e.g., REST was at v9 while Gateway was also evolving). The doc correctly handles this by stating Gateway v10 explicitly.

---

## Summary

| Check | Result |
|-------|--------|
| All hosting modes covered | ✓ N/A — Discord cloud-only |
| API version per variant | ✓ Accurate (v10 for both Gateway and REST) |
| Base URL per variant | ✓ Accurate (single base, not misrepresented) |
| Feature matrix (cloud vs EE vs self-hosted) | ✓ N/A — no tiers |
| Deprecations with sunset dates | ✓ N/A — current version stable |
| Regional/data-residency variants | ✓ N/A — no regional instances |
| Breaking changes between versions | ✓ N/A — doc uses current version only |

No corrections needed. The document correctly handles Discord's cloud-only, single-version API surface without inventing variant distinctions that don't exist.