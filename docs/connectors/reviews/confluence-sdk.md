# Confluence Connector — SDK & Implementation Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, build plan realism, config field alignment, cross-connector consistency.
**Source:** `docs/connectors/confluence.md`
**Date:** 2026-04-18

---

## Verdict: APPROVED WITH CORRECTIONS

The document is technically accurate on the core API behavior and authentication approach. The raw-fetch recommendation is correct — there is no mature official Confluence SDK for Node.js. Three corrections required: a phantom package reference, a missing valid alternative, and a platform registry gap. The build plan phase ordering is realistic.

---

## Findings

### 1. npm Package Existence — ONE PHANTOM, ONE MISSING

| Package | Version | Status | Notes |
|---|---|---|---|
| `@atlassian/jira-work-management` | — | ✅ Correctly excluded | Not relevant to Confluence, not on npm |
| `confluence-api` | 1.4.0 | ✅ Exists (abandoned) | v1 API only, unmaintained since 2022-06 |
| `confluence-markup` | — | ❌ Phantom | Does not exist on npm (verified 404) |
| `marklassian` | 1.2.1 | ✅ Valid alternative | Active since Jan 2025, converts markdown → ADF |

**Section 12 (Dependencies) "Libraries to consider"** references `confluence-markup` for parsing/serializing Confluence storage format. This package does not exist. Replace with `marklassian` (v1.2.1), which is the actively maintained alternative for markdown-to-ADF conversion. The `confluence-api` package (v1.4.0) exists but covers only the legacy v1 API, was last updated in June 2022, and should not be recommended.

The doc's primary recommendation — raw `fetch` with typed interfaces — is correct and should remain the primary path.

---

### 2. SDK Capabilities — N/A (Raw Fetch Path)

There is no mature official Atlassian SDK for Confluence. The document correctly concludes raw `fetch` is the appropriate path. No SDK capability claims need verification since no SDK is being used.

**TypeScript types:** The doc recommends typed response interfaces. This is correct. There are no official Atlassian TypeScript types for the Confluence REST API on npm — `@types/atlassian-connect-js` is for Atlassian Connect add-on JS (browser context), not for REST API clients.

**Webhook helpers:** Confluence Cloud webhooks use JWT tokens from the Connect app framework (Section 3, Signature verification). The doc correctly identifies this is not HMAC-SHA256. The `@atlassian/atlassian-jwt` package (v2.2.0, MIT) exists and provides QSH claim verification — this can be used if webhook verification is implemented, but the doc's MVP plan wisely recommends polling as primary.

**Pagination helpers:** Confluence v2 API uses cursor-based pagination via `Link` header and `/_links/next`. No SDK helper needed — the doc correctly implements this with `limit` + `cursor` parameters. Correct.

---

### 3. Raw Fetch vs SDK Recommendation — COHERENT

The recommendation to use raw `fetch` is accurate and well-reasoned:

- No official Atlassian SDK for Confluence exists on npm
- `confluence-api` (v1.4.0) covers only the deprecated v1 API and is abandoned
- The Confluence v2 REST API is well-documented at developer.atlassian.com
- TypeScript interfaces can be hand-authored for the MVP endpoint surface

This is consistent with the project's preference for minimal dependencies. The `marklassian` package (v1.2.1) is a legitimate optional dependency for ADF construction if Phase 3 rich content is pursued.

---

### 4. CLI Parity — CORRECTLY FLAGGED

Section 12.1 states "Confluence has no equivalent to `gh` CLI. No shell-out option." This is accurate. There is no official Atlassian Confluence CLI for integration work. Correct.

---

### 5. Build Plan Phase Ordering — REALISTIC

| Phase | Blocking on OAuth? | Status |
|---|---|---|
| MVP: Basic Auth (API token) + polling | No — single static token, no callback | ✅ Realistic |
| Phase 2: Webhooks + blog posts + attachments | No — Connect app registration, same auth | ✅ Realistic |
| Phase 3: ADF construction + permissions + templates | No — same auth, additional API surface | ✅ Realistic |

The ordering is correctly staggered. API Token auth requires no OAuth redirect handling. Webhook registration is a separate API call (POST to Connect app endpoints) that does not require OAuth. Phase 3 ADF construction is additive.

**One gap in Phase ordering:** Phase 2 mentions "User mention parsing in body content" but does not address the ADF parsing challenge. Mentions in storage format use `<ac:mention>` tags; in ADF they use `type: "mention"` nodes. The doc should note that `marklassian` or custom ADF traversal will be needed for this, adding to Phase 2 scope.

---

### 6. Config Fields — PLATFORM REGISTRY ENTRY MISSING

**Critical:** Confluence has no entry in `packages/contracts/src/platform-registry.ts`. No other connector review has surfaced this because all prior connectors already existed. This is a new connector — the registry entry must be created alongside implementation.

**Section 11 (MVP) lists 4 config fields:**
```
- Cloud instance URL (https://{tenant}.atlassian.net)
- API token (Basic Auth email:token)
- Space keys to monitor (comma-separated)
- Bot user accountId (for no_self_retrigger)
```

**Suggested registry fields for Confluence:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `api_token` | password | Yes | Atlassian API token |
| `user_email` | text | Yes | Account email for Basic Auth |
| `api_base_url` | url | Yes | Cloud: `https://{tenant}.atlassian.net` |
| `space_keys` | text | Yes | Comma-separated space keys to monitor |
| `bot_account_id` | text | No | accountId for no_self_retrigger |

**Naming inconsistency:** The doc uses `accountId` (camelCase) for the bot user field. The registry uses kebab-case keys. The doc should align to `bot_account_id` for the registry.

---

### 7. Cross-Connector Consistency — CATEGORY GAP

**Issue:** `PlatformRegistryEntry.category` uses `'issue-tracker' | 'error-monitoring' | 'version-control' | 'project-management'`. Confluence is a documentation/knowledge-base platform — none of these categories fit.

**Recommendation:** Either add a `'documentation'` category to the registry, or use `'project-management'` as the closest approximation (Confluence is often bundled with Jira in Atlassian projects).

The `defaultDirection` for Confluence should be `'both'` — inbound (monitoring pages, comments, labels) and outbound (posting comments, creating pages).

The `defaultIntakeMode` should be `'polling'` — the doc correctly identifies webhooks as best-effort only with no retry. Polling is the reliable primary intake path.

`supportsCustomServer` should be `true` — Confluence Data Center/self-hosted is a real deployment variant.

`supportsOAuth` should be `false` for MVP — Basic Auth (API token) is the recommended path. OAuth 2.0 (3LO) can be added later.

---

### 8. Open Questions — APPROPRIATE

| Question | Status |
|---|---|
| Cloud vs Data Center | ✅ Correctly flagged — affects API version (v2 vs v1) and auth |
| Webhook vs Polling primary | ✅ Correctly recommended polling — webhooks are best-effort |
| Page vs Blog post handling | ✅ Correctly deferred to Phase 2 |
| Storage format vs ADF | ✅ Correctly flagged — ADF is complex, storage is simpler |
| User email resolution | ✅ Correctly flagged — privacy settings can block it |
| Data Center version (webhooks need v7.13+) | ✅ Correctly flagged |
| Space permission filtering | ✅ Correctly flagged — scope by allowed spaces |

All open questions are legitimate deployment/operational blockers. No design-level flaws.

---

### 9. Webhook Delivery Model — CORRECTLY DOCUMENTED

The doc accurately identifies two critical limitations:

1. **Best-effort delivery only** — Confluence does not guarantee webhook delivery. No retry queue exists. The polling fallback is not optional — it is required for reliability.

2. **Missing comment events** — No `comment_created` or `comment_updated` webhooks exist. Only `comment_removed` is available. The doc correctly flags this means two-way comment sync requires polling.

These are not SDK issues — they are platform constraints. The polling-as-primary approach is the correct architectural decision.

---

## Summary of Required Changes

| # | Location | Issue | Severity |
|---|---|---|---|
| 1 | Section 12 (Libraries) | Remove `confluence-markup` — package does not exist | Medium |
| 2 | Section 12 (Libraries) | Add `marklassian` (v1.2.1) as ADF construction alternative | Medium |
| 3 | Section 12 (Libraries) | Note that `confluence-api` is abandoned and v1-only | Low |
| 4 | `packages/contracts/src/platform-registry.ts` | Create Confluence registry entry (no existing entry) | High |
| 5 | Section 11 (Admin config) | Rename `accountId` → `bot_account_id` for registry alignment | Low |
| 6 | Platform registry `category` | Add `'documentation'` category, or document why `'project-management'` is used | Medium |
| 7 | Phase 2 | Add note about ADF traversal needed for mention parsing | Low |

Items 1–4 must be resolved before implementation. Items 5–7 are alignment notes.

The document's core technical assessment is sound: no mature Confluence SDK exists, raw `fetch` is correct, Basic Auth (API token) is the right MVP path, polling must be the primary intake mechanism, and webhooks are unreliable enhancement-only features. The build plan ordering is realistic.
