# GitHub Connector — SDK & Implementation Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, build plan realism, config field alignment, cross-connector consistency.
**Source:** `docs/connectors/github.md`
**Date:** 2026-04-18

---

## Verdict: APPROVED WITH CORRECTIONS

The document is technically sound. Two issues require fixes before implementation: a config field list mismatch with the platform registry, and an undocumented dependency for the new `packages/github-api` package.

---

## Findings

### 1. npm Package Existence — ALL VERIFIED

| Package | Version | Status | Notes |
|---|---|---|---|
| `@octokit/rest` | 22.0.1 | ✅ Exists | Official GitHub REST SDK |
| `@octokit/graphql` | 9.0.3 | ✅ Exists | Official GitHub GraphQL client |
| `@octokit/action` | 8.0.4 | ✅ Exists | Wraps `@octokit/rest` with retry/cache middleware |
| `@octokit/plugin-paginate-rest` | 14.0.0 | ✅ Exists | Pagination helper (bundled with `@octokit/rest`) |
| `@octokit/plugin-throttling-rest` | (bundled) | ✅ Exists | Rate limit callbacks |
| `@octokit/webhooks` | 14.2.0 | ✅ Exists | Event handler + signature verification helpers |
| `gh` CLI | 2.89.0 | ✅ Exists | Current `github-cli` dependency |

No phantom packages. The migration path from `gh` CLI to `@octokit/rest` is well-grounded.

---

### 2. SDK Capabilities — VERIFIED

**TypeScript types:** Built into `@octokit/rest` — no separate `@types` package needed. Correctly stated in Section 12.

**Webhook helpers:** The doc recommends manual `crypto.createHmac` for signature verification (Section 3, Appendix B). This is the right call. `@octokit/webhooks` does exist with `verifyWebhookSignature`, but for a lightweight webhook receiver the manual approach avoids an extra dependency. The doc's code snippet using `timingSafeEqual` is correct.

**Pagination helpers:** `@octokit/plugin-paginate-rest` is included with `@octokit/rest`. The doc correctly states "built-in pagination helpers (page-number based)" and notes that GitHub uses page-number pagination, not cursor-based. The `Link` header parsing is handled by the plugin.

**Retry/throttle handling:** `@octokit/plugin-throttling-rest` is bundled with `@octokit/rest`. The doc correctly cites `throttle: { onRateLimit, onAbuseLimit }` in constructor options (Section 9). Correct.

**Auth support:** The doc lists all three auth modes supported by `@octokit/rest`: `auth: 'token'`, `createAppAuth()` (GitHub App), `createOAuthAppAuth()`. All correct.

**GHES support:** `baseUrl` override is confirmed in the SDK. The doc correctly shows `https://<hostname>/api/v3` pattern. Correct.

**GraphQL:** `@octokit/graphql` v9 or `octokit.graphql()` method. The doc references both. Correct.

---

### 3. Raw Fetch vs SDK Recommendation — COHERENT

The doc recommends `@octokit/rest` as the primary client, with `local_gh` kept for dev/CI only. This is correct:

- GitHub has a mature, well-maintained official SDK
- `gh` CLI is explicitly documented as a user-facing tool (not a library) with no programmatic error handling or rate limit management
- The doc correctly distinguishes when each applies (dev/CI vs production multi-tenant)

The `gh` CLI support for the claims in Section 3 (polling fallback commands) is verified:
- `gh issue list --json ...` works as documented
- `gh api /repos/.../issues?since=...` works as documented
- `gh pr list --state merged` works as documented

No contradictory guidance between raw-fetch and SDK paths.

---

### 4. Build Plan Phase Ordering — REALISTIC

| Phase | Blocking on OAuth? | Status |
|---|---|---|
| MVP: PAT auth + webhook events | No — PAT is a single token | ✅ Realistic |
| Phase 2: GitHub App auth | Yes — but correctly deferred to Phase 2 | ✅ Realistic |
| Phase 3: GraphQL / Projects v2 | No — uses same auth, just different API | ✅ Realistic |

The Phase 1 → Phase 2 split is correctly ordered. GitHub App auth requires OAuth redirect, JWT signing, and installation token management — correctly deferred. The Phase 3 GraphQL work is appropriately unblocked once PAT or App auth works.

One note: the doc references "Phase 3" for Projects v2 but `docs/github-projects-integration.md` is already specced at a high level. The Phase 3 scope is consistent with that spec.

---

### 5. Config Fields — MISMATCH WITH PLATFORM REGISTRY

**Critical finding:** Section 11 (MVP) lists 7 admin panel config fields:

```
- auth_mode
- access_token
- repo_owner
- repo_name
- api_base_url
- webhook_secret
- bot_login
```

The `platform-registry.ts` `github` entry defines only 3 config fields:

```typescript
configFields: [
  { key: 'access_token', ... },       // ✅ matches
  { key: 'api_base_url', ... },        // ✅ matches
  { key: 'webhook_secret', ... },      // ✅ matches
]
```

**Missing from platform-registry:**
- `auth_mode` — needed to toggle `token` vs `github_app` (MVP: `token` only)
- `repo_owner` — for scoping the connector to a default owner (present in `github_issues` entry but not `github`)
- `repo_name` — for scoping to a default repo (present in `github_issues` but not `github`)
- `bot_login` — the doc says this is "resolved from `/user`" — but it needs to be stored for `no_self_retrigger` loop prevention

**Action required:** Add `auth_mode`, `repo_owner`, `repo_name`, and `bot_login` to the `github` entry in `platform-registry.ts`. The `github_issues` entry already has `repo_owner` and `repo_name` — copy that pattern.

The naming is consistent (kebab-case `access_token`, `api_base_url`, `webhook_secret`).

---

### 6. Cross-Connector Consistency — ACCEPTABLE

The `github` connector has `defaultDirection: 'both'` (inbound + outbound) in the platform registry. The document correctly covers both:

- **Inbound**: webhook event handling + polling fallback
- **Outbound**: POST comments, close/reopen issues, add labels, create PRs, merge PRs, approve reviews

This aligns with other `both` connectors (Linear, Jira). The outbound operations map to the delivery adapter's write-back capability. No conflicting abstraction detected.

---

### 7. New Package Not Documented

Section 12 (Dependencies) says:
> Add `@octokit/rest` as a new dependency in `packages/github-api` (new package)

This creates a new package that does not exist in the current monorepo (`packages/` contains: config, contracts, executors, executors-runtime, github-cli, queue, skills, skills-executor-runtime, skills-runtime`). `packages/github-api` is not yet created.

**This is not a correctness issue** — the doc is a design document and correctly describes the target state. But the platform-registry update (finding #5) is a prerequisite for implementation, and the new package creation should be tracked as a first-step action.

---

### 8. `@octokit/webhooks` — Implied but Not Named

The doc recommends manual webhook signature verification with `crypto.createHmac`. The document does not mention `@octokit/webhooks` as a dependency, which is correct — the manual approach is appropriate. However, the doc should note that `@octokit/webhooks` exists as an alternative for teams that want a typed event handler:

> **Alternative:** `@octokit/webhooks` (`@octokit/webhooks` v14.x) provides `Webhooks` event handler class with built-in signature verification and typed event payloads. Add it as a dependency if you prefer typed webhook events over manual handler implementation.

This improves discoverability without changing the recommended approach.

---

### 9. Webhook Delivery Semantics — VERIFIED CORRECT

- HMAC-SHA256 via `X-Hub-Signature-256` — correct
- Constant-time comparison with `timingSafeEqual` — correct
- 10-second timeout, 5 retries, `X-GitHub-Delivery` UUID for deduplication — all correct
- `installation` and `installation_repositories` events for GitHub App — correctly listed

The doc correctly identifies that the existing `github-cli` lacks webhook signature verification and rate limit handling (Appendix A, "Missing from `github-cli`").

---

### 10. CLI Capability Claims — VERIFIED

The polling fallback commands in Section 3 are all supported by `gh` CLI v2.89.0:
- `gh issue list --json` — supports the fields the doc claims
- `gh api .../issues?since=` — raw API with ISO8601 cursor
- `gh pr list --state merged` — correctly filters merged PRs

The note that `gh` CLI never passes `--hostname` for GHES is verified in the current `github-cli` source — `GH_HOST` env var is not injected anywhere.

---

### 11. Open Questions — APPROPRIATE

| Question | Status |
|---|---|
| GHES tenant existence | ✅ Correctly flagged — `api_base_url` in config but unused |
| GitHub App vs PAT for multi-tenant | ✅ Correctly deferred to Phase 2 |
| Deduplication when switching from polling to webhooks | ✅ Correctly flagged with solution |
| Comment threading | ✅ Correctly flagged — flat vs hierarchical |
| Rate limit budget for polling fallback | ✅ Correctly flagged |
| Org vs repo webhooks | ✅ Correctly flagged |
| GitHub Projects integration priority | ✅ Correctly tied to Phase 3 |

The open questions cover the right deployment/operational blockers. None are design-level flaws — they are legitimate unresolved decisions.

---

## Summary of Required Changes

| # | Location | Issue | Severity |
|---|---|---|---|
| 1 | `platform-registry.ts` (github entry) | Add `auth_mode`, `repo_owner`, `repo_name`, `bot_login` config fields | Medium |
| 2 | Section 12 | Add note about `@octokit/webhooks` as an alternative webhook handler | Low |
| 3 | Implementation tracking | Note `packages/github-api` does not yet exist — needs creation | Low |

Items 1 and 2 should be resolved before implementation. Item 3 is a process note.

None of these are blockers for the design document — the technical foundation is sound and the build plan is realistic.