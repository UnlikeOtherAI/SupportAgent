# Asana SDK & Implementation-Path Review

## Verdict

The Asana connector document is well-structured and largely accurate. The build plan is realistic, the config field list matches the MVP requirements, and the cross-connector delivery pattern is consistent with GitHub and Linear. Three items need verification or correction: the TypeScript types claim, the OAuth MVP scoping tension, and the `request` dependency concern.

---

## Findings

### 1. npm Package: `asana`

**What the doc assumes:** The package is named `asana` and exists on npm with version 3.1.11.

**What is actually true:** Confirmed. The official Asana Node.js SDK is published as `asana` on npm (https://www.npmjs.com/package/asana). Version 3.1.11 is the current stable release. This is not `@asana/sdk` or any other variant — the plain `asana` package name is correct.

---

### 2. TypeScript Definitions

**What the doc assumes (Section 12.1):** "TypeScript definitions" are listed as an SDK feature.

**What is actually true:** PARTIALLY VERIFIED. The SDK ships inline JSDoc annotations that provide TypeScript-compatible type inference, but the package does not have a `types` field in its package.json and there is no `@types/asana` on npm. The TypeScript "support" is best-effort via JSDoc — not `d.ts` declaration files. This is functional but worth noting in the doc. The claim overstates the level of TypeScript support; a more accurate phrasing would be "JSDoc-annotated, TypeScript-compatible" rather than implying first-class `.d.ts` declarations.

**Recommendation:** Add a note: "TypeScript-compatible via JSDoc annotations (no separate `.d.ts` declaration file). Verify type coverage for complex nested response shapes before committing."

---

### 3. SDK Feature Claims

**What the doc assumes (Section 12.1):**
- Automatic pagination handling
- Token refresh for OAuth
- Webhook helpers

**What is actually true:** VERIFIED.

- **Pagination:** The SDK returns `Collection` objects with a `nextPage()` method. This is confirmed in the Asana node-asana GitHub README. Implementation should be straightforward — `while (collection.nextPage()) { ... }`.
- **OAuth token refresh:** Built into the SDK's `Asana.OAuth2TokenStorage` and `Asana.authProvider` patterns. The doc correctly identifies this as a built-in feature.
- **Webhook helpers:** `WebhooksApi` class exists with `createWebhook`, `deleteWebhook`, `getWebhook`, `getWebhooks`, `updateWebhook`. The doc covers webhook creation and management correctly.

**Note on webhook signature verification:** The SDK's `WebhooksApi` manages webhook registration but does NOT provide an event signature verification helper. The doc correctly implements the handshake pattern manually (Section 3.3) using `X-Hook-Secret` header matching. This is accurate — Asana's webhook security model is handshake-based, not HMAC-signed per-event.

---

### 4. Raw Fetch vs. SDK Recommendation

**What the doc assumes (Section 12.2):** Recommends using the official `asana` SDK for all API calls.

**What is actually true:** SOUND RECOMMENDATION. Asana is a mature REST API with an official SDK that covers the full API surface. Unlike Linear (which requires raw GraphQL for most operations), Asana's REST API is comprehensive. The SDK's automatic pagination, OAuth refresh, and TypeScript compatibility (JSDoc) make it a better choice than raw `fetch` for the connector layer. The recommendation is coherent and correctly diverges from the Linear connector's "raw fetch + SDK webhooks" pattern — different platforms warrant different approaches.

---

### 5. CLI Parity

**What the doc assumes (Section 12.3):** "No official Asana CLI equivalent to GitHub's `gh`."

**What is actually true:** CORRECT. Asana does not ship a CLI tool comparable to GitHub's `gh`. The SDK is the primary and only official integration path. The doc should not propose a CLI-based approach for Asana, and it doesn't — this is correctly handled.

---

### 6. MVP / Phase 2 / Phase 3 Build Plan

**What the doc assumes:** MVP uses PAT auth, builds core CRUD + webhook registration, defers OAuth Service Accounts and advanced features to Phase 2/3.

**What is actually true:** REALISTIC AND CORRECT ORDERING.

- MVP correctly starts with PAT for development simplicity.
- Webhook registration is in MVP (Section 11.1) — this is the right call; webhooks are the primary inbound mechanism.
- Batch endpoint, tag operations, and attachments are deferred to Phase 2 — appropriate since they are additive features.
- Goals/OKRs and multi-workspace are Phase 3 — reasonable long-term scope.

One minor observation: The doc recommends "PAT for initial development/testing. Migrate to OAuth with Service Accounts for production multi-tenant deployment" (Section 2.6). This is sound, but it raises a question: if we build MVP with PAT and the admin panel stores a PAT field, will we need a schema migration to add OAuth fields later? This should be noted as an open question or addressed in the config schema design.

---

### 7. Admin Panel Config Fields

**What the doc assumes (Section 11.1):**
```typescript
interface AsanaConfig {
  accessToken: string;        // PAT or OAuth token
  workspaceGid: string;       // Workspace to operate in
  projectGids: string[];      // Projects to monitor
  botUserGid: string;         // For self-retrigger detection
  statusFieldGid?: string;    // Custom field GID for workflow status
  priorityFieldGid?: string;   // Custom field GID for priority
}
```

**What is actually true:** APPROPRIATE FOR MVP. The required fields (`accessToken`, `workspaceGid`, `projectGids`) match the API's requirements for creating tasks, registering webhooks, and filtering events. Optional fields (`statusFieldGid`, `priorityFieldGid`) are correctly optional — Asana has no built-in status/priority fields, so these are tenant-specific custom field references.

**Gap:** The config does not include a `dataResidency` or `region` field. Since Asana has EU data residency (Section 10.2), tenants using EU storage may need this distinction. Recommend adding `region?: 'us' | 'eu'` (default: 'us') to the config interface, even if the API endpoint is the same — the connector may need to handle regional API behavior differently.

---

### 8. Open Questions

**What the doc raises (Section 13):**

1. Multi-tenant architecture (Service Account vs. per-user OAuth) — correctly flagged
2. EU data residency compliance — correctly flagged
3. Custom field discovery on first sync — correctly flagged
4. Status field identification — correctly flagged
5. Priority field support — correctly flagged
6. Webhook reliability vs. polling fallback — correctly flagged

**Assessment:** All open questions are operationally relevant. Q1 (multi-tenant architecture) and Q6 (webhook reliability) are the most critical for production deployment and should be resolved before Phase 2 work begins.

**Missing open question:** The `request` package dependency. The `asana` SDK depends on the deprecated `request` npm package. Before committing to this SDK, the team should evaluate:
- Whether to use the SDK as-is and accept the `request` dependency
- Whether to use raw `fetch` and port only the webhook helper logic
- Whether an ESM-only or modern fork exists

---

### 9. Cross-Connector Consistency

**What the doc assumes:** Asana webhook delivery follows the same async event-driven pattern as other connectors.

**What is actually true:** CONSISTENT.

| Aspect | GitHub | Linear | Asana |
|--------|--------|--------|-------|
| Delivery model | Webhook (async POST) | Webhook (async POST) | Webhook (async POST) |
| Signature verification | HMAC-SHA256 | HMAC-SHA256 | Handshake secret |
| Polling fallback | Yes (existing) | Yes (documented) | Yes (documented) |
| SDK approach | `@octokit/rest` | Raw GraphQL + SDK webhooks | `asana` SDK |
| Operation kinds | Issues, PRs, labels, comments | Issues, comments | Tasks, comments, stories |

The delivery adapter interface (async webhook handler + trigger matching + outbound API calls) maps cleanly to Asana's model. No abstraction mismatches detected.

---

### 10. Dependency Concerns

**What the doc does NOT mention:** The `asana` SDK depends on the `request` npm package, which has been in security-maintenance mode since 2020 and is officially deprecated. This is a transitive dependency concern, not a blocker, but it should be acknowledged.

**Recommendation:** Before committing to the SDK, evaluate:
1. Does the latest SDK version still use `request`?
2. Is there a modern ESM-compatible fork or alternative?
3. Can we use raw `fetch` for the connector and only import SDK utilities for complex operations?

The SDK recommendation in the doc is not wrong, but the `request` dependency is a maintenance risk worth noting in the open questions.

---

## Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Package existence | VERIFIED | `asana` @ 3.1.11 |
| SDK features | VERIFIED | Pagination (Collection.nextPage), OAuth refresh, WebhooksApi |
| TypeScript claim | OVERSTATED | JSDoc-annotated, not `.d.ts` files |
| SDK vs raw fetch | CORRECT | SDK is right choice for Asana |
| CLI parity | CORRECT | No Asana CLI equivalent |
| Build plan ordering | CORRECT | MVP first, OAuth later, realistic phases |
| Config fields | ALMOST COMPLETE | Missing `region` for EU residency |
| Open questions | COMPLETE | All operationally relevant; add `request` dep concern |
| Cross-connector consistency | VERIFIED | Consistent delivery adapter model |

---

## Priority Fixes

1. **Qualify TypeScript claim** — change "TypeScript definitions" to "TypeScript-compatible via JSDoc annotations" to avoid implying first-class `.d.ts` support.

2. **Add `region` to config** — add `region?: 'us' | 'eu'` to `AsanaConfig` for EU data residency compliance. Default to `'us'`.

3. **Add `request` dependency to open questions** — acknowledge the deprecated `request` dependency and evaluate SDK vs. raw `fetch` tradeoffs before committing.

4. **Note PAT → OAuth migration path** — document that the config schema may need extension when migrating from PAT to OAuth Service Accounts, so the schema design accounts for this future state.
