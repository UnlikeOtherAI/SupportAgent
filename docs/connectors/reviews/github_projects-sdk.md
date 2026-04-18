# GitHub Projects v2 Connector — SDK & Implementation Audit Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, build plan realism, config field alignment, cross-connector consistency.
**Source:** `docs/connectors/github_projects.md`
**Date:** 2026-04-18

---

## Verdict: APPROVED WITH REQUIRED ADDITIONS

The document is technically accurate and the build plan is realistic. One critical registry gap must be resolved: `github_projects` does not exist as a platform registry entry, and the MVP config fields for `owner` and `projectId` are not in any existing entry. Beyond that, all npm packages are verified real, SDK capability claims are correct, and the build plan ordering is sound.

---

## Findings

### 1. npm Package Existence — ALL VERIFIED

| Package | npm | Version | Status |
|---------|-----|---------|--------|
| `@octokit/graphql` | https://www.npmjs.com/package/@octokit/graphql | 9.0.3 | ✅ Exists |
| `@octokit/graphql-schema` | https://www.npmjs.com/package/@octokit/graphql-schema | 15.26.1 | ✅ Exists |
| `@octokit/rest` | https://www.npmjs.com/package/@octokit/rest | 22.0.1 | ✅ Exists |
| `@octokit/app` | https://www.npmjs.com/package/@octokit/app | 16.1.2 | ✅ Exists |

No phantom packages. All four packages are confirmed via `npm view`.

---

### 2. SDK Capabilities — VERIFIED

**TypeScript types:** `@octokit/graphql` ships generated types in the package. For full schema coverage, `@octokit/graphql-schema` (v15.26.1) is available. The doc recommends `@octokit/graphql` as primary client — correct.

**Webhook helpers:** The doc recommends manual HMAC-SHA256 verification with `crypto.createHmac` and `timingSafeEqual`. This is the same pattern used by the main `github` connector. `@octokit/webhooks` exists as a package (v14.x) with an event handler class, but the doc correctly opts for the manual approach to keep the webhook receiver lightweight. No phantom helper assumed.

**Pagination helpers:** `@octokit/graphql` does not include automatic pagination. The doc correctly shows cursor-based pagination with `first: 100` and `pageInfo.endCursor` — no pagination helper is assumed that doesn't exist. This matches what the Linear SDK review found (`@linear/sdk` has no paginate helper either).

**Retry handling:** `@octokit/graphql` has no built-in automatic retry with backoff. The doc correctly shows manual retry with `X-RateLimit-Reset` epoch wait and `Retry-After` header reading. No phantom SDK retry logic assumed.

**Rate limit headers:** `X-RateLimit-*` headers are correctly described. `Retry-After` header for secondary limits (CPU/timeout) is correctly noted. The doc's rate limit header table (Section 8) is accurate.

---

### 3. Raw Fetch vs SDK Recommendation — COHERENT

Section 12 recommends `@octokit/graphql` over raw `fetch` with this rationale:

> GraphQL bodies are verbose; SDK handles serialization, headers, and errors.

This is correct and consistent with the main `github` connector, which uses `@octokit/rest` for REST operations. For GraphQL specifically, the `@octokit/graphql` client:
- Handles `Authorization: Bearer <token>` header
- Maps `X-RateLimit-*` headers to the response
- Supports `baseUrl` override for GHES
- Provides typed variable injection (safer than template literals)

The doc explicitly recommends **against** raw `fetch` for GraphQL. Given that Projects v2 requires GraphQL exclusively for item operations, this is the right call. The alternative (raw `fetch` for all GitHub APIs) is appropriate for the main `github` connector where REST dominates — the doc doesn't contradict that pattern.

---

### 4. CLI Parity — CORRECTLY ABSENT

Section 12 states:

> GitHub CLI (`gh`) does **not** have native Projects v2 commands. The `gh project` CLI is limited to Projects (classic). No parity needed with `@support-agent/github-cli`.

This is correct. The `gh project` command group (added in 2023) only supports the deprecated Classic Projects API — it has no `projects_v2` or `projects_v2_item` equivalents. The doc does not claim CLI support for this connector, which is accurate.

---

### 5. Build Plan Phase Ordering — REALISTIC

| Phase | Auth | Blocking on OAuth? | Status |
|-------|------|--------------------|--------|
| MVP | Fine-grained PAT (`organization_projects: write`) | No — PAT is a single token | ✅ Sound |
| Phase 2 | GitHub App added | Yes — but correctly deferred | ✅ Sound |
| Phase 3 | Same auth | No — only adds more GraphQL mutations | ✅ Sound |

**MVP does not block on OAuth.** The PAT-only path for MVP is explicitly justified in Section 2. The rationale (GitHub App complexity: JWT exchange, installation tokens) is correct and consistent with how the main `github` connector defers App auth to Phase 2.

**GraphQL-only constraint for MVP is correct.** The doc repeatedly notes that the REST API does not support item operations (add items, set field values, create draft issues). The MVP mutation list in Section 11 is all GraphQL — this is the only option.

**Webhook-only for MVP is correct for org projects.** The doc's polling fallback section covers user-level projects, but explicitly notes that org-level projects can rely on `projects_v2_item` webhooks. The Phase 2 additions (polling, GitHub App) are additive, not blocking.

---

### 6. Config Fields — CRITICAL GAP: `github_projects` Not in Registry

The doc lists 5 MVP config fields in Section 11:

| Doc field | Maps to registry field? | Status |
|-----------|------------------------|--------|
| `owner` (org login) | Not in any entry | ❌ Missing |
| `projectId` (ProjectV2 GID) | Not in any entry | ❌ Missing |
| `githubToken` (PAT) | `github.access_token` | ✅ Exists |
| `webhookSecret` | `github.webhook_secret` | ✅ Exists |
| `fieldMappings` | Runtime config, not registry | ✅ Fine |

**Two issues:**

1. **`github_projects` entry does not exist in `platform-registry.ts`.** The connector is referenced in `scenario-catalog.md` as `github_projects.item.update` but has no registry entry. This must be added.

2. **`owner` and `projectId` are not registry fields anywhere.** The `github` entry has `access_token`, `api_base_url`, `webhook_secret` only. The `github_issues` entry adds `repo_owner` and `repo_name`. For `github_projects`, the required fields are `owner` (org or user login) and `projectId` (ProjectV2 GID) — neither exists in the registry.

**Action required:**
- Add `github_projects` entry to `platform-registry.ts`
- Include `access_token`, `api_base_url` (for GHES), `webhook_secret` matching the `github` entry pattern
- Add `owner` (text, required for org-level scoping)
- Add `projectId` (text, required — this is a ProjectV2 GID, not numeric)
- Consider `fieldMappings` as a runtime config JSON field (not a registry-level field)

Suggested registry entry for `github_projects`:
```typescript
github_projects: {
  key: 'github_projects',
  displayName: 'GitHub Projects v2',
  description: 'Connect GitHub Projects v2 for board-based intake, field-driven triggers, and project item updates.',
  category: 'project-management',
  iconSlug: 'github-projects',
  defaultDirection: 'both',
  defaultIntakeMode: 'webhook',
  supportsCustomServer: true,
  supportsOAuth: false, // PAT only for MVP; GitHub App in Phase 2
  configFields: [
    { key: 'access_token', ... },      // PAT with org_projects:write
    { key: 'api_base_url', ... },       // GHES base URL
    { key: 'webhook_secret', ... },     // HMAC verification
    { key: 'owner', ... },              // org or user login (required)
    { key: 'project_id', ... },         // ProjectV2 GID (required)
  ],
}
```

---

### 7. Cross-Connector Consistency — CONSISTENT

The `github_projects` connector pattern matches other `both` connectors:

| Aspect | GitHub | GitHub Issues | GitHub Projects v2 | Consistent? |
|--------|--------|--------------|--------------------|-------------|
| Direction | both | both | both | ✅ |
| Intake mode | webhook | webhook | webhook | ✅ |
| Auth for MVP | PAT | PAT | PAT | ✅ |
| Outbound ops | REST mutations | REST mutations | GraphQL mutations | ✅ (different transport, same semantics) |
| Delivery adapter | POST JSON | POST JSON | POST JSON | ✅ |
| Multi-tenant path | GitHub App (Phase 2) | GitHub App (Phase 2) | GitHub App (Phase 2) | ✅ |

No abstract conflict with the delivery adapter pattern. The outbound `github_projects.item.update` operations (set field values, archive/restore) are correctly async POSTs against the GitHub GraphQL API — the same delivery adapter surface used by other connectors.

**One nuance:** The doc defines `addProjectV2DraftIssue` and `addProjectV2ItemById` as outbound operations, but these map to different item types (draft vs existing). The delivery adapter should handle this via a discriminated `operation` union. This is an implementation detail that should be captured in the connector spec, not a doc error.

---

### 8. TypeScript Types — CONFIRMED

`@octokit/graphql` ships TypeScript types in the package — no separate `@types` package needed. The `decodeGid` / `encodeGid` utility in the Appendix uses `Buffer` which is available in Node.js. The type assertions for `ProjectV2ItemType` and `ProjectV2FieldType` enums match the actual schema. No phantom types assumed.

---

### 9. Open Questions — APPROPRIATE BLOCKERS

| Question | Correctly flags blocker? |
|----------|--------------------------|
| Cloud vs Enterprise (GHES lacks Projects v2 webhooks) | ✅ Valid operational blocker |
| Org vs user projects (webhook vs polling) | ✅ Correctly tied to intake mode |
| GitHub App vs PAT for multi-tenant | ✅ Correctly deferred to Phase 2 |
| Field name vs ID stability | ✅ Correctly flags stability issue |
| Status field auto-detection | ✅ Correctly flags need for convention or config |
| Webhook reliability / idempotency | ✅ Correctly flags at-least-once delivery |
| Multi-project in same org | ✅ Correctly flags scoping question |
| Issue vs draft creation scope | ✅ Correctly scopes MVP to specific creation path |

All open questions are deployment or operational blockers, not design flaws. The idempotency question for `edited` events (webhook may fire multiple times for the same field change) is correctly raised and unresolved — this should result in a concrete decision before MVP ships.

---

### 10. Polling Fallback — VERIFIED

The cursor strategy in Section 3 (store `pageInfo.endCursor`, poll with `after: <last_cursor>`, `first: 100`) is correctly described. Filtering by `updatedAt` in application code is the right approach since Projects v2 doesn't support server-side time filtering. This matches the Linear SDK review finding that the polling pattern is correctly scoped.

The GraphQL query for recent items (Section 3, polling subsection) correctly uses `first: 100` max and shows the `fieldValues(first: 10)` inline fragment pattern. No pagination helper assumed — manual cursor iteration is implied and correct.

---

## Summary of Required Changes

| # | Location | Issue | Severity |
|---|----------|-------|----------|
| 1 | `platform-registry.ts` | `github_projects` entry does not exist — must add | **Critical** |
| 2 | `platform-registry.ts` | `owner` (org/user login) and `project_id` (ProjectV2 GID) not registry fields — add to new entry | **Critical** |
| 3 | Section 11 (MVP config) | Consider adding `fieldMappings` as a registry JSON field for field-name-to-ID resolution | Medium |

Items 1 and 2 must be resolved before implementation. Item 3 is a design decision (field mappings could also be stored at the scenario/rule level rather than connector level — the doc should clarify this in the Open Questions).

None of these are correctness errors in the design document itself. The technical foundation is sound: npm packages verified, SDK capability claims accurate, build plan realistic, delivery adapter pattern respected, and open questions cover the right blockers.