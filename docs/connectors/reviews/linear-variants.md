# Connector Review: Linear — Hosting Variants & Version Drift

**Reviewer**: Claude (hosting-variants + version-drift audit)
**Source**: `docs/connectors/linear.md`
**Date**: 2026-04-18

## Verdict: CLEAN WITH ONE ADVISORY

The Linear connector document is accurate on all hosting-variant, API-versioning, and regional-residency claims. There are no factual errors to correct. One low-priority advisory is noted below.

---

## Findings

### 1. Hosting Mode — Cloud Only

- **Variant affected**: N/A (single-mode platform)
- **What the doc says** (line 6, line 502):
  > "Linear is cloud-only; no self-hosted variant exists"
  > "No self-hosted Linear. All tenants are on Linear's cloud"
- **Verification**: Confirmed. Linear's pricing page and developer docs list no self-hosted tier. Enterprise tier adds SAML/SCIM and advanced admin controls, but infrastructure remains Linear's cloud. No on-premise offering exists or has been announced.
- **Correction**: None. Statement is correct.

### 2. API Versioning — GraphQL v1

- **Variant affected**: N/A (single API version)
- **What the doc says** (line 10):
  > `https://api.linear.app/graphql/v1`
- **Verification**: Confirmed. Linear's GraphQL API uses a `/v1` path suffix. This is a versioned endpoint (unlike e.g., GitHub's single GraphQL endpoint). The doc correctly reflects the production URL. No `/v2` exists as of this review. Linear has not announced a v2 migration or deprecation of v1.
- **Correction**: None. The base URL pattern `https://api.linear.app/graphql/v1` is accurate for all Linear workspaces.

### 3. Regional / Data-Residency Variants

- **Variant affected**: N/A (single global deployment)
- **What the doc says**: No regional endpoint variants are mentioned, which is correct.
- **Verification**: Confirmed. Linear operates a single global cloud. No EU-specific, AU-specific, or US-gov endpoints exist. The doc correctly omits regional variants — no false claims were made that could mislead implementers.
- **Correction**: None.

### 4. Enterprise-Only Features — Advisory

- **Variant affected**: Linear Enterprise tier vs. Starter/Pro
- **What the doc says**: SAML and SCIM are not mentioned in the connector scope. OAuth app registration requiring admin is mentioned (line 528: "OAuth app setup requires admin").
- **Verification**: SAML SSO and SCIM provisioning are enterprise-tier features per Linear's pricing page. The connector document correctly scopes itself to PAT-based auth, which is available on all tiers. No feature claims in the connector doc are enterprise-only.
- **Advisory**: If SupportAgent's multi-tenant deployment grows to require SCIM user provisioning or SAML SSO for connector admins, those features are enterprise-only and should be documented as out-of-scope for the MVP. The current doc's MVP scope does not claim enterprise features. No correction needed.

### 5. API Breaking Changes / Deprecations

- **Variant affected**: N/A
- **What the doc says**: No deprecation warnings related to API versioning are present.
- **Verification**: No known Linear GraphQL API v1 deprecations or sunset dates exist as of this review. The `v1` suffix indicates a versioned API, but Linear has not announced breaking changes to v1. The SDK version cited (v82.0.0) is current as of the doc date.
- **Correction**: None. A proactive note could be added: "Linear's API uses a `/v1` suffix. Monitor the [changelog](https://linear.app/changelog) for v2 migration notices." This is an enhancement, not a correction.

### 6. Features Universally Claimed That Are Actually Tier-Restricted

- **What the doc says**: All documented features (webhooks, GraphQL queries/mutations, custom fields) are presented as universally available.
- **Verification**: Webhooks, GraphQL API access, custom fields, and all documented entity types (Issue, Comment, Cycle, Project, etc.) are available on all Linear plans including Starter. No premium-only gating on core API access exists. The enterprise-only features (SAML, SCIM, advanced audit, custom email domains for notifications) are outside the connector scope and correctly omitted.
- **Correction**: None.

### 7. Endpoint Path Consistency

- **Variant affected**: N/A — single endpoint
- **What the doc says**: All operations use the single GraphQL endpoint `https://api.linear.app/graphql/v1`.
- **Verification**: Confirmed. Linear has no path variants like `/rest/api/2/` vs `/rest/api/3/`. The GraphQL endpoint is uniform across all workspaces.
- **Correction**: None.

---

## Summary

| Area | Status |
|---|---|
| Hosting variants (cloud-only) | Correct |
| API version (GraphQL v1) | Correct |
| Base URL pattern | Correct |
| Feature matrix (cloud-only platform) | N/A — no self-hosted tier exists |
| Deprecations / sunset dates | None applicable |
| Regional / data-residency variants | None — single global cloud |
| Breaking changes between API versions | None — single API version in use |
| Enterprise-tier feature claims | Correctly scoped to non-enterprise |

**No corrections required. The document accurately reflects Linear's cloud-only, single-API-version architecture.**

---

## Optional Enhancements (Not Corrections)

1. Add a note that Linear's GraphQL API uses a `/v1` suffix, making future v2 migration a watch item.
2. If SCIM/SAML enterprise features become relevant for connector administration, document them as enterprise-only.
3. The doc mentions SDK version v82.0.0 (line 9, line 592). Consider adding a note that SDK version drift from the live API is expected and raw GraphQL is preferred for bleeding-edge features.
