# Bitbucket Connector — SDK and Implementation Review

**Reviewer scope:** npm packages, SDK capabilities, build plan realism, admin config fields, cross-connector delivery abstraction, trigger/action/output kinds.
**Source:** `docs/connectors/bitbucket.md`
**Checked:** 2026-04-18

---

## Verdict

**Conditional pass with caveats.** The npm packages, SDK recommendation, and build plan ordering are sound. The admin panel config field list in the doc diverges from what `platform-registry.ts` actually defines — this must be reconciled before implementation. The Open Questions section lists feature decisions rather than deployment/operational blockers, which is a structural gap. Cross-connector delivery abstraction is consistent.

---

## Findings

### 1. npm Package Verification — PARTIAL PASS

**Packages checked:**
- `@atlassian/bitbucket` — correctly identified as **NOT available** (E404). PASS.
- `bitbucket` (community by MunifTanjim) — **EXISTS**, v2.12.0, last published 2024-05-18. MIT licensed. Has TypeScript types (`lib/index.d.ts`). Dependencies: `before-after-hook`, `deepmerge`, `is-plain-object`, `node-fetch@^2.6.0`, `url-template`. No heavy transitive deps.
- `bitbucket-rest` — **EXISTS** but abandoned. v0.0.1 from 2013-12-18. Do not use.
- `bitbucket-cli` (NPM) — **EXISTS** but very minimal. v0.5.5 from 2023-12. No official CLI for Bitbucket Cloud.
- `@ganeshgaxy/bb-cli` — **EXISTS** but very new. v0.1.0 from 2026-03-24. Mirrors `glab` UX. Unproven at scale.

**Gap:** The doc mentions the community `bitbucket` SDK but dismisses it as "may be outdated." It is actively maintained (last update May 2024, ~2 years after the v2 beta cycle started). The doc should acknowledge it more precisely: "Community SDK exists with TypeScript types but lacks webhook helpers and pagination helpers, so raw fetch + typed contracts is still preferred for MVP control."

---

### 2. Raw Fetch vs SDK Recommendation — Coherent

**Claim:** Use raw `fetch` with typed wrappers for MVP. No official Atlassian SDK for Bitbucket.

**What is true:** Defensible. No official Atlassian SDK exists. The community `bitbucket` SDK is active but does not expose webhook helpers or pagination helpers — it wraps the REST API endpoints. The REST API is well-documented at developer.atlassian.com. Raw fetch + typed contracts is a reasonable MVP choice that avoids dependency risk.

**Bonus concern:** The `bitbucket` SDK uses `node-fetch@^2.6.0` as a dependency. If SupportAgent uses native `fetch` in the runtime, adding the SDK pulls in an older polyfill. Raw fetch avoids this.

**Pagination burden:** Bitbucket Cloud uses cursor-based pagination with `page` + `pagelen`. Data Center uses offset-based with `start` + `limit`. The doc correctly identifies both patterns. If raw fetch is used, manual pagination must be implemented — this is stated but not emphasized as a required MVP task.

---

### 3. CLI Parity — PASS

**Claimed:**
- `gh` — N/A for Bitbucket (GitHub only)
- `bb` (Bitbucket CLI) — Available, Server-side only, for Data Center
- No equivalent `bb` CLI for Cloud

**What is true:** Correct. Bitbucket Cloud has no CLI equivalent to `gh`. The `bb` CLI is for Data Center/Server only. The npm `bitbucket-cli` package is a minimal wrapper (v0.5.5) with no parity to `gh`. The recommendation to use REST API as single source of truth is correct.

**Gap:** The doc mentions "Consider wrapping `git` + API calls for operations" — this is vague but reasonable. No specific CLI tool exists to shell out to.

---

### 4. Admin Panel Config Fields — MISMATCH

**Doc lists (`BitbucketConfig` interface, Section 11):**
```typescript
interface BitbucketConfig {
  authType: 'pat' | 'oauth';          // MVP: PAT only
  accessToken: string;                  // Encrypted PAT
  workspaceSlug: string;               // Workspace or project key
  defaultRepoSlug?: string;            // Default repository
  webhookSecret?: string;              // HMAC secret for verification
  botUsername?: string;                // For no_self_retrigger
}
```

**Actual registry** (`packages/contracts/src/platform-registry.ts`, `bitbucket` entry):
```typescript
{
  key: 'app_password',    // name: 'App Password'
  key: 'username',        // name: 'Username'
  key: 'api_base_url',
  key: 'workspace',
  key: 'webhook_secret',
}
```

**Gaps:**

| Doc Field | Registry Field | Status |
|----------|----------------|--------|
| `authType` | Not exposed | OK — MVP = PAT only, authType is implicit |
| `accessToken` | `app_password` | MISMATCH — naming differs; semantics align |
| `workspaceSlug` | `workspace` | MISMATCH — naming differs; semantics align |
| `defaultRepoSlug` | **MISSING** | HIGH — needed for single-repo scoping |
| `webhookSecret` | `webhook_secret` | Naming convention only |
| `botUsername` | **MISSING** | HIGH — needed for no-self-retrigger |

**Impact:** HIGH. The doc's `BitbucketConfig` interface is aspirational — it does not match the current registry. Implementation must reconcile:
1. Add `defaultRepoSlug` to `platform-registry.ts` config fields
2. Add `botUsername` to `platform-registry.ts` config fields (or document alternative)
3. Align field naming (`accessToken` → `app_password`, `workspaceSlug` → `workspace`)

---

### 5. Trigger Kinds — No Existing Cross-Connector Contracts Yet

**Doc proposes for MVP:** `pullrequest:created`, `pullrequest:updated`, `pullrequest:fulfilled`, `pullrequest:rejected`, `pullrequest:comment_created`, `pullrequest:comment_updated`, `pullrequest:comment_deleted`, `pullrequest:approved`, `pullrequest:request_change`, `issue:created`, `issue:updated`, `issue:comment_created`.

**Current in contracts** (`packages/contracts/src/scenario.ts`):
```typescript
export type TriggerKind =
  | 'github.issue.opened'
  | 'github.issue.labeled'
  | 'github.issue.closed_comment'
  | 'github.pull_request.opened'
  | 'github.pull_request.comment'
  | 'github.pull_request.merged'
  | 'schedule.interval';
```

**Assessment:** Only GitHub-style trigger kinds exist. Bitbucket trigger kinds will require new entries. The doc correctly proposes platform-prefixed naming (e.g., `bitbucket.pullrequest.created`, `bitbucket.issue.created`). This is coherent.

**Note:** The doc correctly identifies that Bitbucket uses colon-separated event names (e.g., `pullrequest:created`) which differ from GitHub's dot-separated naming (e.g., `pull_request.opened`). The trigger registry must accommodate both naming conventions.

---

### 6. Delivery Ops — Consistent

**Doc proposes:** `comment` on PRs/issues, merge/decline PRs, change issue status, add/remove labels.

**Actual in contracts** (`docs/llm/skills-and-executors.md`):
```typescript
type DeliveryOp =
  | { kind: 'comment'; body: string; visibility?: 'public' | 'internal' }
  | { kind: 'labels'; add?: string[]; remove?: string[]; visibility?: 'public' | 'internal' }
  | { kind: 'state'; change: 'close' | 'reopen' | 'merge' | 'request_changes' | 'approve'; visibility?: 'public' | 'internal' }
  | { kind: 'pr'; spec: PrSpec; visibility?: 'public' | 'internal' };
```

**Assessment:** PASS. Bitbucket's outbound ops map to the existing DeliveryOp contract:
- PR comments → `comment`
- Issue comments → `comment`
- Merge/decline → `state` with `merge`/`decline`
- Approve → `state` with `approve`
- Change issue status → `state` with `close`/`reopen`
- Add labels to issues → `labels`
- Resolve/unresolve thread → `comment` + internal marker (Bitbucket-specific)

No wild divergence from cross-connector patterns.

---

### 7. Build Plan Phasing — Realistic

**MVP:** PAT auth (App Password), 12 webhook events (10 PR + 2 issue), basic polling fallback, HMAC-SHA256 verification.

**Phase 2:** Activity feeds, branch pattern matching, reviewer detection, priority/label changes on issues.

**Phase 3:** Branch restrictions, CI/CD status reporting, deployment tracking, multi-repo scanning.

**Assessment:** PASS. MVP uses PAT (no OAuth callback complexity), webhook-first with polling fallback. No MVP features blocked on Phase 2/3 deps. AuthType is documented as `pat | oauth` but the registry only supports PAT for MVP — this is internally consistent.

---

### 8. Open Questions — Wrong Category

**Current Open Questions (Section 13):**
1. Does tenant use Cloud or Data Center/Server?
2. Workspace admin PAT or user PAT?
3. Issues or PRs only?
4. Free or paid Bitbucket plan?
5. Multi-repo support?
6. Inline code comments?
7. Sync reactions?
8. Retry failed webhooks?
9. Store raw markdown or rendered HTML?
10. Support private repos?
11. Branch restrictions?
12. Bitbucket Data Center on-prem?

**Problem:** Most items are **feature scoping decisions** (items 3, 6, 7, 9, 10, 11) or **tenant configuration questions** (items 1, 2, 4, 5, 12). Only item 12 touches deployment concerns.

**What's missing (operational blockers):**
- **Webhook URL provisioning**: For self-hosted deployments, who owns the public webhook endpoint URL? For Data Center, can it be internal? Does the platform provide a webhook ingestion endpoint, or must tenants self-host?
- **Per-tenant OAuth app**: If `supportsOAuth: false` now but `authType: 'pat' | 'oauth'` is in the config interface, when does OAuth become relevant? If Bitbucket Cloud requires each tenant to register their own OAuth app under their Atlassian account, what's the onboarding UX?
- **Data Center connectivity**: Data Center webhooks require v8.0+ for HMAC secrets. Earlier versions (v7.x) have no webhook signing. How does the connector handle mixed-version Data Center deployments?
- **Rate limit planning**: Free tier = 60 requests/hour. Paid workspace = 1000 requests/hour. For multi-repo tenants, is 1000/hour sufficient? This is an operational concern that affects webhook vs polling trade-offs.

---

### 9. Cloud vs Data Center Duality — Well Documented

The doc correctly identifies:
- Cloud uses UUID-based identity; Data Center uses integer IDs
- Cloud uses workspaces; Data Center uses projects/repos hierarchy
- Cloud uses OAuth 2.0; Data Center uses OAuth 1.0a + Basic Auth
- Cloud has HMAC webhook secrets; Data Center only from v8.0+
- Different API base URLs and pagination styles

This duality is a real implementation burden. The doc acknowledges it but defers the multi-tenant routing decision. This is acceptable for an SDK review but the implementation must handle it from day one.

---

### 10. No Licensing or Transitive Dep Concerns

The doc does not propose heavy SDKs. Raw fetch has no dependency risk. The `bitbucket` community SDK (if used) has MIT license with lightweight deps. No concerns.

---

## Summary Table

| # | Area | Severity | Claim in Doc | Correct Value / Action |
|---|---|---|---|---|
| 1 | npm packages | PASS | `@atlassian/bitbucket` not available | Correct — E404 |
| 1b | npm packages | LOW | `bitbucket` community SDK dismissed as "may be outdated" | Active (v2.12.0, May 2024), but raw fetch still preferred |
| 2 | Raw fetch vs SDK | PASS | Use raw fetch | Coherent; document pagination burden |
| 3 | CLI parity | PASS | No `gh` equivalent for Cloud | Correct; `bb` CLI for Data Center only |
| 4 | Admin config fields | HIGH | `BitbucketConfig` interface | Add `defaultRepoSlug`, `botUsername`; align field names |
| 5 | Trigger kinds | OK | Platform-prefixed naming | New entries needed in `TriggerKind`; colon vs dot naming |
| 6 | Delivery ops | PASS | `comment`, `labels`, `state` | Matches contracts |
| 7 | Build phasing | PASS | MVP → Phase 2 → Phase 3 | Realistic ordering, MVP unblocked |
| 8 | Open questions | MEDIUM | Feature scoping + config questions | Re-categorize operational blockers (webhook URL ownership, per-tenant OAuth, Data Center HMAC versioning) |
| 9 | Cloud/DC duality | OK | Well documented | Acknowledged as implementation burden |
| 10 | Licensing/transitive deps | PASS | Raw fetch, no heavy SDKs | No concerns |

---

## Priority Actions

1. **Reconcile `BitbucketConfig` with `platform-registry.ts`**: Add `defaultRepoSlug` and `botUsername` config fields. Align field naming (`accessToken` → `app_password`, `workspaceSlug` → `workspace`).
2. **Update Open Questions**: Move operational blockers to the top. Add: webhook URL ownership, per-tenant OAuth app registration, Data Center HMAC versioning (v7.x vs v8.0+), rate limit planning for free-tier tenants.
3. **Clarify `bitbucket` SDK status**: Acknowledge the community SDK is actively maintained but still prefer raw fetch for MVP control. Mention the `node-fetch@^2` dep concern if SDK adoption is ever reconsidered.
4. **Document pagination as required MVP work**: Both cursor-based (Cloud) and offset-based (DC) pagination must be implemented manually if raw fetch is used.
5. **Define `TriggerKind` entries for Bitbucket**: The connector implementation will need new trigger type definitions (`bitbucket.pullrequest.*`, `bitbucket.issue.*`). Plan this in the trigger registry.
