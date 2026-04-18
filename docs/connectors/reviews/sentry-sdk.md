# Sentry Connector — SDK & Implementation Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, build plan realism, config field alignment, cross-connector consistency.
**Source:** `docs/connectors/sentry.md`
**Date:** 2026-04-18

---

## Verdict: APPROVED WITH CORRECTIONS

The document is technically sound. No phantom packages, no false SDK capability claims, build plan phase ordering is correct. One config field is missing from the doc (compared to the registry), and two doc fields have no registry counterpart. These gaps need resolution before implementation.

---

## Findings

### 1. npm Package Existence — ALL VERIFIED

| Package | Version | Status | Notes |
|---|---|---|---|
| `@sentry/api` | 0.113.0 | ✅ Exists | Official REST client; zero dependencies; TypeScript included |

The doc mentions `@sentry/api` in Section 12 as the official SDK. Verified via npm — the package exists, has zero runtime dependencies, exports TypeScript types, and includes pagination helpers (`parseSentryLinkHeader`, `paginateAll`). No phantom references found.

---

### 2. SDK Capabilities — VERIFIED

**TypeScript types:** `@sentry/api` ships its own TypeScript declarations (`./dist/index.d.ts`). No separate `@types` package needed. Exports all endpoint functions and response types (confirmed via `npm pack` inspection of v0.113.0).

**Webhook helpers:** The doc correctly notes that `@sentry/api` "does not include webhook handling." Verified — the SDK is purely REST API wrappers. Webhook signature verification must be implemented manually using `crypto.createHmac` with the `Sentry-Hook-Signature` header. The doc's HMAC-SHA256 + freshness check approach (Section 3a) is correct.

**Pagination helpers:** `@sentry/api` includes `parseSentryLinkHeader` and `paginateAll`. The cursor format (`{timestamp},{shard},{shardNumber}`) is encapsulated in the SDK. The doc's polling fallback strategy correctly describes cursor-based pagination via the `Link` header.

**Retry handling:** Not built into `@sentry/api`. The doc correctly describes manual retry with backoff on 429 responses (Section 8: "respect `Retry-After` header, otherwise back off exponentially starting at 1s, max 5 retries").

---

### 3. Raw Fetch vs SDK Recommendation — COHERENT

The doc recommends raw `fetch` / `undici` over `@sentry/api`, citing "straightforward REST surface" and "~50KB" overhead. The reasoning is valid:

- Sentry's API is simple CRUD with Bearer token auth — no complex session management
- `@sentry/api` is primarily used internally by the Sentry SDK (source map uploads, session tracking) — the mental model doesn't match an external connector
- The package has zero dependencies so "~50KB" likely refers to bundle size, not transitive dep risk

The recommendation to use raw fetch is defensible. Both paths work. The doc should note that `@sentry/api` is a valid alternative if type-safety is prioritized over bundle size.

---

### 4. CLI Parity — CORRECTLY FLAGGED

Section 12.3 states "No CLI Equivalent." Accurate — Sentry has no `sentry` CLI for external integrations. The Integration Platform is webhooks + REST only. No CLI tool to shell out to.

---

### 5. Build Plan Phase Ordering — REALISTIC

| Phase | Blocking on OAuth? | Status |
|---|---|---|
| MVP: API token + webhooks | No — Internal Integration token is static | ✅ Realistic |
| Phase 2: Tags, assignee lookup, polling reconciliation | No — same auth, additional API surface | ✅ Realistic |
| Phase 3: Rate limit advisory, Release tracking, multi-org | No — same auth, expanded scope | ✅ Realistic |

No phase is blocked on OAuth setup. Internal Integration tokens are non-expiring and don't require redirect/callback flows. Webhook registration is a single API call. Phase 3 multi-org support uses additional tokens per org, not new auth flows.

---

### 6. Config Fields — INCOMPLETE

**Doc (Section 11) lists 6 config fields:**
```
sentry.organizationSlug     # maps to org_slug ✅
sentry.authToken             # maps to auth_token ✅
sentry.clientSecret          # → no direct registry match ⚠️
sentry.region                # → no registry field ⚠️
sentry.selfHostedUrl         # → partial match to api_base_url ⚠️
```

**Registry (platform-registry.ts, sentry entry) defines 5 config fields:**
```
auth_token        ✅ (matches authToken)
api_base_url      ✅ (matches selfHostedUrl use case)
org_slug          ✅ (matches organizationSlug)
webhook_secret    ✅ (matches clientSecret intent — both for HMAC verification)
integration_id    ✅ (mentioned as optional in helpText)
```

**Discrepancies:**

| Doc Field | Registry Field | Status |
|---|---|---|
| `organizationSlug` | `org_slug` | ✅ Equivalent; different naming convention |
| `authToken` | `auth_token` | ✅ Equivalent; different naming convention |
| `clientSecret` | `webhook_secret` | ⚠️ Same purpose (HMAC verification), different key name — needs alignment |
| `region` | _(absent)_ | ❌ **Missing from registry — cloud US vs EU requires this** |
| `selfHostedUrl` | `api_base_url` | ⚠️ Same purpose (custom base URL), different key name — needs alignment |
| _(integration_id)_ | `integration_id` | ❌ **Registry has it; doc doesn't list it** |

**Critical gap:** The `region` field (`"us" | "de"`) is needed to route to the correct cloud endpoint. The doc correctly describes this at the URL level (`https://sentry.io` vs `https://de.sentry.io`), but the registry has no corresponding config field. The `api_base_url` field can serve as a workaround (user provides the full base URL), but `region` as a dropdown (`us`/`de`) is cleaner UX.

**Action required:**
1. Add `region` to the registry as a `text` or `toggle` field, or document that `api_base_url` should be set to the full custom URL for non-default regions.
2. Rename `clientSecret` → `webhook_secret` in doc to match registry, or update the registry key for consistency.
3. Rename `selfHostedUrl` → `custom_api_url` or align to `api_base_url` naming.
4. Add `integration_id` to the doc's config list (it appears in the registry helpText but not in Section 11).

---

### 7. Cross-Connector Consistency — ACCEPTABLE

The `sentry` entry in the registry has `defaultDirection: 'inbound'`. The doc correctly maps to this:

- **Inbound**: webhook event handling (issue.created, issue.resolved, etc.) + polling fallback
- **Outbound**: posting comments back to Sentry (Section 4a), updating status/assignee/priority

The delivery adapter pattern is consistent with other connectors. Async webhook processing is standard. No conflicting abstractions detected.

**One open question flagged in the doc (Section 13, #8):** "Outbound-only flow: Per prior decision, Sentry is inbound-only for SupportAgent — confirm: do we need to post comments back to Sentry?" This question is appropriately raised. If SupportAgent is purely inbound (Sentry → Linear/GitHub), then Section 4 outbound operations are unnecessary for MVP. If comments need to be posted back to Sentry (e.g., bot responses to users), the `defaultDirection` would need to change to `'both'`.

---

### 8. Open Questions — APPROPRIATE

| Question | Status |
|---|---|
| Cloud vs self-hosted per tenant + version detection | ✅ Correctly flagged — webhooks require Sentry 21.x+ on self-hosted |
| Multi-org tenants | ✅ Correctly flagged — one connector instance per org |
| Priority field availability | ✅ Correctly flagged — priority introduced in Sentry 23.x |
| Comment threading | ✅ Correctly flagged — Sentry is flat; no reply threads |
| Rate limit monitoring | ✅ Correctly flagged — token exhaustion affects all operations |
| Tenant user provisioning | ✅ Correctly flagged — read-only vs read-write scope |
| Outbound-only flow (no_self_retrigger) | ✅ Correctly flagged — determines if comments post back |
| Webhook dedup idempotency key | ✅ Correctly noted in Section 10c — `(issue_id, action, timestamp)` |

All open questions are legitimate deployment/operational blockers. None are design-level flaws.

---

### 9. Transitive Dependencies / Licensing — CLEAN

- `@sentry/api` has zero runtime dependencies (verified via npm view).
- No external packages required for webhook signature verification — uses Node.js built-in `crypto.createHmac`.
- No heavy SDKs proposed (no Graph SDK, no Bot Framework).
- Sentry is Apache 2.0 licensed.

---

## Summary of Required Changes

| # | Location | Issue | Severity |
|---|---|---|---|
| 1 | Section 11 (config fields) | Add `region` field or document that `api_base_url` handles non-default regions | High |
| 2 | Section 11 (config fields) | Add `integration_id` to match registry | Medium |
| 3 | Section 11 (config fields) | Rename `clientSecret` → `webhook_secret` to match registry | Medium |
| 4 | Section 11 (config fields) | Rename `selfHostedUrl` → `api_base_url` for registry consistency | Low |
| 5 | Section 12.1 | Mention `@sentry/api` as a valid alternative to raw fetch for better type-safety | Low |
| 6 | Section 13, #8 | Resolve outbound-only question before Phase 1 — affects `defaultDirection` in registry | High |

Items 1, 2, and 6 must be resolved before implementation. Items 3-5 are alignment fixes.

The document's technical foundation is sound — no phantom packages, no inflated SDK claims, build plan phase ordering is realistic, and no cross-connector abstraction conflicts.