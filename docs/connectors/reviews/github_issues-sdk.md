# GitHub Issues Connector — SDK and Implementation Review

**Reviewer scope:** npm packages, SDK capabilities, build plan realism, admin config fields, cross-connector delivery abstraction, trigger/action/output kinds.
**Source:** `docs/connectors/github_issues.md`
**Checked:** 2026-04-18

---

## Verdict

**Conditional pass with caveats.** The npm packages, SDK recommendation, and build plan ordering are sound. The admin panel config field list is missing `bot_login` which the doc references for no-self-retrigger filtering — this must be resolved before Phase 1 is complete. The Open Questions section lists feature decisions rather than deployment/operational blockers, which is a structural gap. Cross-connector delivery abstraction is consistent.

---

## Findings

### 1. npm Package Verification — PASS

**Packages checked:**
- `@octokit/rest@22.0.1` — exists, latest is v22
- `@octokit/action@8.0.4` — exists, adds throttling via `@octokit/plugin-throttling`

The doc correctly references both packages. No phantom dependencies.

---

### 2. Raw Fetch vs SDK Recommendation — Coherent but Incomplete

**Claim:** Use raw `fetch` for MVP. Consider `@octokit/rest` if complex OAuth or GraphQL is needed.

**What is true:** The recommendation is defensible. GitHub REST is well-documented and stable; native `fetch` plus typed contracts is a reasonable MVP choice that avoids a transitive dep.

**Gap:** The doc undervalues `@octokit/rest`'s built-in pagination helpers. GitHub's page-based API with Link headers is non-trivial to implement correctly (parsing `rel="next"`, handling `per_page`, detecting last page). `@octokit/rest` handles this via `paginate()` which abstracts the Link header parsing. If the connector uses raw `fetch`, manual pagination must be implemented correctly — the doc mentions the Link header format but doesn't spell out the implementation burden.

**Recommendation:** If raw `fetch` is chosen, document that manual pagination via Link header parsing is a required implementation task for MVP, not deferred to Phase 2. Alternatively, mention that `@octokit/rest`'s `paginate()` could be adopted later without architectural change.

---

### 3. CLI Parity — PASS

**Claimed capabilities:**
- `gh issue view <number>` — works
- `gh issue list` — works
- `gh issue close` / `gh issue reopen` — both exist
- `gh api repos/.../comments` — works via `gh api`
- `gh label create` — works

All claimed commands are valid in `gh` v2.89.0. The doc's recommendation to keep `packages/github-cli` for admin/CLI workflows is consistent with how the project currently uses `gh` shell-out.

---

### 4. Admin Panel Config Fields — MISSING FIELD

**Doc lists:**
```
access_token, api_base_url, webhook_secret, repo_owner, repo_name, bot_login
```

**Actual registry** (`packages/contracts/src/platform-registry.ts`, `github_issues` entry):
```
access_token, api_base_url, webhook_secret, repo_owner, repo_name
```

**Missing:** `bot_login` (the bot account username for no-self-retrigger filtering).

**Impact:** MEDIUM. The doc references `bot_login` in Section 7 (Identity Mapping) and in the no-self-retrigger flow. The `dispatcher-service.ts` resolves bot identity for self-retrigger filtering, but if the field isn't in the connector config, users have no way to set it. The field either needs to be added to `platform-registry.ts` config fields, or the doc needs to acknowledge an alternative (e.g., inferring from the token user via `GET /user` at runtime).

---

### 5. Trigger Kinds — Expandable but Out of Scope for MVP

**Existing in contracts** (`packages/contracts/src/scenario.ts`):
```
github.issue.opened, github.issue.labeled, github.issue.closed_comment,
github.pull_request.opened, github.pull_request.comment, github.pull_request.merged
```

**Doc proposes for Phase 2+:** `assigned`, `unassigned`, `edited`, `transferred`, `mention`, `comment_matches`, `creator`, title/body regex triggers.

**Assessment:** The proposed trigger kinds are reasonable extensions. Phase 2 additions are fine as described — they're additive to the contracts. The doc's proposed trigger syntax (e.g., `{ trigger: 'assigned', value: 'username' }`) is coherent with the existing trigger pattern.

---

### 6. Delivery Ops — Consistent

**Doc proposes:** `comment`, `labels`, `state` ops (add/remove labels, close/reopen).

**Actual in contracts** (`docs/llm/skills-and-executors.md`):
```typescript
type DeliveryOp =
  | { kind: 'comment'; body: string; visibility?: 'public' | 'internal' }
  | { kind: 'labels'; add?: string[]; remove?: string[]; visibility?: 'public' | 'internal' }
  | { kind: 'state'; change: 'close' | 'reopen' | 'merge' | 'request_changes' | 'approve'; visibility?: 'public' | 'internal' }
  | { kind: 'pr'; spec: PrSpec; visibility?: 'public' | 'internal' }
```

**Assessment:** PASS. The doc's proposed ops align with the existing contracts. No wild divergence from cross-connector patterns.

---

### 7. Build Plan Phasing — Realistic

**MVP:** PAT auth, 8 webhook events, basic polling fallback, HMAC-SHA256 verification.

**Phase 2:** Projects v2, assignee management, lock/unlock, search API.

**Phase 3:** GraphQL bulk fetches, sub-issues, dependency tracking.

**Assessment:** PASS. The ordering is sensible — MVP uses PAT (no OAuth callback complexity), webhook-first with polling fallback, no GraphQL until bulk fetches are needed. No MVP features blocked on Phase 2/3 deps.

---

### 8. Open Questions — Wrong Category

**Current Open Questions:**
1. Single vs multi-repo scope
2. GitHub App vs PAT for multi-tenant (flags SAML SSO concern — good)
3. Projects v2 scope
4. Search API usage for reconciliation
5. Comment sync direction
6. Rate limit monitoring in admin panel
7. GHES compatibility
8. Webhook URL provisioning

**Problem:** Items 1, 3, 4, 5, 6 are **feature scoping decisions**, not deployment/operational blockers. The audit instructions ask for "right deployment/operational blockers (e.g. per-tenant OAuth app, Meta business verification, Azure AD consent)."

**What's missing (operational blockers):**
- **Webhook URL provisioning**: Item 8 touches this but doesn't frame it as a deployment question. For self-hosted deployments, who owns the public webhook endpoint URL? The tenant? The platform? This affects self-service setup UX.
- **Per-tenant OAuth app**: If `supportsOAuth: true` means we must support OAuth app registration, what does that flow look like for GitHub? GitHub requires the OAuth app to be registered under a GitHub account/org — does the platform register one OAuth app per tenant, or one shared app with per-tenant token storage?
- **GHES certificate validation**: For GHES on self-signed certs, does the connector need a `ca_bundle` or `tls_verify` config field?

---

### 9. Webhook Event Assumptions — Correct

**Doc claims:** `issues.opened` fires for both issues and PRs (PRs are issues under the hood). Check `issue.pull_request` to distinguish.

**What is true:** Correct. GitHub's API returns PRs via the Issues endpoint; `pull_request` is `null` for actual issues. The gotcha is accurate.

**Doc claims:** `issue_comment` fires for both issue comments and PR review comments. Check `issue.pull_request` presence.

**What is true:** Correct. PR review comments use a different API endpoint (`/pulls/{number}/comments`) but arrive via the same `issue_comment` webhook event. The distinction via `pull_request` presence is correct.

---

### 10. No Licensing or Transitive Dep Concerns

The doc does not propose heavy SDKs like Azure Bot Framework or Meta Graph SDK. `@octokit/rest` is MIT-licensed with no known licensing concerns. No transitive dep issues.

---

## Summary Table

| # | Area | Severity | Claim in Doc | Correct Value / Action |
|---|---|---|---|---|
| 1 | npm packages | PASS | `@octokit/rest`, `@octokit/action` | Both exist |
| 2 | Raw fetch vs SDK | MEDIUM | MVP uses raw fetch | OK but document manual Link-header pagination as required work |
| 3 | CLI parity | PASS | `gh` commands listed | All valid in gh v2.89.0 |
| 4 | Admin config fields | HIGH | Lists `bot_login` | Missing from `platform-registry.ts` — add it or explain alternative |
| 5 | Trigger kinds | LOW | Phase 2+ additions | Coherent with existing trigger pattern |
| 6 | Delivery ops | PASS | `comment`, `labels`, `state` | Matches contracts |
| 7 | Build phasing | PASS | MVP → Phase 2 → Phase 3 | Realistic ordering, MVP unblocked |
| 8 | Open questions | MEDIUM | Lists feature decisions | Re-categorize as operational blockers; add webhook URL ownership, per-tenant OAuth app, GHES cert validation |
| 9 | Webhook event disambiguation | PASS | PRs fire `issues.opened` | Correct, `pull_request` check is the right approach |
| 10 | Licensing/transitive deps | PASS | No heavy SDKs | No concerns |

---

## Priority Actions

1. **Add `bot_login` to `platform-registry.ts` config fields** (or document an alternative for no-self-retrigger config).
2. **Frame Open Questions 1, 3, 4, 5, 6 as feature scoping**; move operational blockers (webhook URL ownership, per-tenant OAuth, GHES cert validation) to the top.
3. **If raw fetch is used**, document that manual pagination via Link header parsing is a required MVP implementation task, or wire `@octokit/rest` pagination helpers without adopting the full SDK.