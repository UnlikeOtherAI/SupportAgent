# Jira Connector — SDK & Implementation Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, build plan realism, config field alignment, cross-connector consistency.
**Source:** `docs/connectors/jira.md`
**Date:** 2026-04-18

---

## Verdict: APPROVED WITH CORRECTIONS

The document is technically sound. Two issues require fixes before implementation: a phantom package reference, a config field mismatch with the platform registry, and one missing field. No structural problems with the build plan.

---

## Findings

### 1. npm Package Existence — TWO PHANTOMS

| Package | Version | Status | Notes |
|---|---|---|---|
| `jira.js` | 5.3.1 | ✅ Exists | Recommended primary SDK |
| `jira-client` | 8.2.2 | ✅ Exists | Legacy, v2 API only, not recommended |
| `@atlassian/jira-api-client` | — | ❌ Phantom | No such package exists on npm (verified 404) |
| `@x-ray/jira` | — | ❌ Phantom | No such package on npm (verified 404) |

The doc references `@atlassian/jira-api-client` as a "for example" placeholder but never actually names it as a dependency — that's fine. However, `@x-ray/jira` is listed as a community SDK (Section 12.2) but does not exist on npm. Remove it or replace with a verified alternative.

The two real packages are `jira.js` and `jira-client`. The doc correctly recommends `jira.js` over `jira-client` due to v3 API support.

---

### 2. SDK Capabilities — VERIFIED

**TypeScript types:** `jira.js` ships its own TypeScript declarations (`./dist/esm/types/index.d.ts` confirmed via npm exports). No separate `@types` package needed. Correctly stated in Section 12.2.

**Webhook helpers:** `jira.js` does NOT include webhook signature verification or event parsing helpers. The doc does not claim it does. Correct — webhook verification must be implemented manually using `crypto.createHmac` with the Jira `X-Hub-Signature` header. The doc's HMAC-SHA256 + `timingSafeEqual` approach (Section 3, Signature Verification) is correct.

**Pagination utilities:** `jira.js` includes pagination helpers via `startAt`/`maxResults` offset pagination. Jira Cloud uses offset-based pagination (Section 9.1 confirms: `startAt`, `maxResults`, `isLast`). Cursor pagination via `nextPageToken` is also available. `jira.js` wraps both patterns correctly. The doc's polling fallback strategy (Section 3.1) correctly uses `updated` timestamp as cursor.

**Retry handling:** `jira.js` includes automatic retry with backoff (Section 12.2 "Automatic retry with backoff" — correctly stated). No need to implement manually.

**Sub-packages:** `jira.js` exports `./agile`, `./serviceDesk`, `./version2`, `./version3` sub-paths. The MVP only needs the core v3 endpoints, so `jira.js` alone is sufficient. The `serviceDesk` sub-package is relevant for Phase 3 Service Management integration.

---

### 3. Raw Fetch vs SDK Recommendation — COHERENT

The doc recommends `jira.js` as the primary client with a raw-fetch fallback for minimal dependencies. This is correct:

- Jira has no official Atlassian SDK for Node.js — the doc accurately states "No official Atlassian SDK for Node.js/TypeScript"
- `jira.js` is the best community alternative: TypeScript-first, v2 + v3 coverage, active maintenance
- The raw-fetch option in the doc (Appendix A) is appropriate for teams that want zero additional dependencies and don't need pagination helpers

The doc correctly notes that for MVP with minimal dependencies, raw `fetch` with typed response interfaces is acceptable. This is consistent with the project's preference for minimal complexity.

No contradictory guidance between raw-fetch and SDK paths.

---

### 4. CLI Parity — CORRECTLY FLAGGED

The doc notes "No official Jira CLI for integrations" (Section 12.4). This is accurate. The Atlassian CLI by Adaptavist is third-party and not recommended for production integrations. This matches the GitHub connector's approach where `gh` CLI exists but is not used as a library for production multi-tenant connectors.

---

### 5. Build Plan Phase Ordering — REALISTIC

| Phase | Blocking on OAuth? | Status |
|---|---|---|
| MVP: API Token auth + polling | No — single token, no callback | ✅ Realistic |
| Phase 2: Webhooks + bulk ops | No — uses same auth, adds webhook registration | ✅ Realistic |
| Phase 3: Service Management, SLA, workflow expressions | No — uses same auth, additional API surface | ✅ Realistic |

The ordering is correctly staggered. API Token auth requires no OAuth redirect or callback setup — it's a single static token. Webhook registration is a separate API call that doesn't require OAuth. Phase 3 features all use the same auth mechanism. No blocking dependencies between phases.

---

### 6. Config Fields — MISMATCH WITH PLATFORM REGISTRY

**Section 11 (MVP) lists 6 config fields:**

```
- baseUrl
- email
- apiToken
- defaultProject
- webhookSecret
- jqlFilter
```

**The `jira` entry in `platform-registry.ts` defines 5 config fields:**

```
- api_token         ✅ (matches email+apiToken auth pair)
- user_email        ✅ (matches email field)
- api_base_url      ✅ (matches baseUrl field)
- project_key       ✅ (matches defaultProject — different name)
- webhook_secret    ✅ (matches webhookSecret)
```

**Discrepancies:**

| Doc Field | Registry Field | Status |
|---|---|---|
| `baseUrl` | `api_base_url` | ✅ Named differently but equivalent |
| `email` | `user_email` | ✅ Named differently but equivalent |
| `apiToken` | `api_token` | ✅ Named differently but equivalent |
| `defaultProject` | `project_key` | ⚠️ Different names, same purpose — needs alignment |
| `webhookSecret` | `webhook_secret` | ✅ Named differently but equivalent |
| `jqlFilter` | _(absent)_ | ❌ **Missing from registry — needed for webhook filtering** |

**Action required:**

1. **Rename `project_key` → `default_project`** in the registry for consistency with `api_base_url` naming pattern (kebab-case compound fields). The doc uses `defaultProject` (camelCase but that's the internal type — the registry key should be `default_project`).
2. **Add `jql_filter`** to the registry — the doc correctly identifies this as a required MVP config field for filtering webhook events. Without it in the registry, the admin panel can't store it.

The doc uses camelCase for internal type fields which is fine for TypeScript interfaces, but registry keys must use kebab-case. The mismatch is primarily a naming convention issue (camelCase doc vs kebab-case registry), not a functional gap — except for the missing `jql_filter`.

---

### 7. Cross-Connector Consistency — ACCEPTABLE

The `jira` connector has `defaultDirection: 'both'` (inbound + outbound) in the platform registry. The document correctly covers both:

- **Inbound**: webhook event handling + JQL polling fallback
- **Outbound**: create issue, post/edit/delete comment, transition status, add/remove labels, set priority, assign user, attach files

The outbound operations map to a delivery adapter's write-back capability. ADF (Atlassian Document Format) body construction is the only unique concern — comments and descriptions use ADF, not plain text. The doc correctly shows ADF construction in Section 4 and Appendix C.

No conflicting abstraction detected. The async delivery model is consistent with other connectors.

---

### 8. Open Questions — APPROPRIATE

| Question | Status |
|---|---|
| Cloud vs Data Center hosting | ✅ Correctly flagged — affects API version and auth |
| API Token vs OAuth 2.0 | ✅ Correctly deferred — MVP uses Token |
| Webhook registration permission | ✅ Correctly flagged — admin access needed |
| User email privacy | ✅ Correctly flagged — email may be hidden |
| Custom fields | ✅ Correctly flagged — dynamic via `createmeta` |
| Workflow complexity | ✅ Correctly flagged — affects transition handling |
| Service Management vs Software | ✅ Correctly flagged — Phase 3 scope |
| Outbound identity (bot vs user) | ✅ Correctly flagged — affects comment attribution |
| Rate limit tier | ✅ Correctly flagged — affects polling frequency |

All open questions raise legitimate deployment/operational blockers. None are design-level flaws.

---

## Summary of Required Changes

| # | Location | Issue | Severity |
|---|---|---|---|
| 1 | Section 12.2 | Remove `@x-ray/jira` — package does not exist | Medium |
| 2 | `platform-registry.ts` (jira entry) | Rename `project_key` → `default_project` for kebab-case consistency | Medium |
| 3 | `platform-registry.ts` (jira entry) | Add `jql_filter` config field | Medium |
| 4 | Section 11 config list | Align field names to registry kebab-case keys | Low |

Items 1–3 must be resolved before implementation. Item 4 is a doc alignment note — the internal TypeScript interfaces can keep camelCase, but the admin panel field keys must match the registry.

None of these are blockers for the design document — the technical foundation is sound, the SDK assessment is accurate, and the build plan is realistic.
