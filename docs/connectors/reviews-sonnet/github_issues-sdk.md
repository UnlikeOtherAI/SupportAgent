# GitHub Issues Connector — SDK and Implementation Review

**Reviewer scope:** npm packages, SDK capabilities, build plan realism, admin config fields, cross-connector delivery abstraction, TypeScript typings, webhook verification helpers, pagination helpers, CLI correctness.
**Source:** `docs/connectors/github_issues.md`
**Checked:** 2026-04-18

---

## Verdict

**Conditional pass.** The packages referenced exist, the auth and delivery abstractions are cross-connector consistent, and the phasing is realistic. Two issues need resolution before coding starts: `bot_login` is documented as a config field but is absent from the actual connector config in platform-registry; and the raw-fetch recommendation undersells the pagination implementation burden. Open questions lean toward feature decisions rather than deployment blockers — three operational blockers are unraised.

---

## Findings

### 1. npm Package Verification — PASS

**`@octokit/rest`**
- Exists: `https://www.npmjs.com/package/@octokit/rest`
- Current stable: v22 (v22.0.x). The doc does not pin a version, which is fine for a design doc.
- MIT license, zero non-optional peer deps.
- Ships its own TypeScript declarations (`@octokit/openapi-types` bundled).

**`@octokit/action`**
- Exists: `https://www.npmjs.com/package/@octokit/action`
- The doc describes it as "adds throttling and retry via `@octokit/plugin-throttling`" — accurate. The package is a GitHub Actions-oriented wrapper; using it outside GitHub Actions is unusual but not broken. For a connector that runs inside a SupportAgent worker (not inside GitHub Actions), `@octokit/rest` with `@octokit/plugin-throttling` composed manually is the cleaner choice. The doc should clarify this.

No phantom packages. No packages with heavy transitive deps or license issues.

---

### 2. SDK Capabilities vs What the Doc Assumes — MOSTLY PASS

**TypeScript types:** `@octokit/rest` ships `@octokit/openapi-types` which covers all REST response shapes. The doc defines its own `GitHubIssue` and `GitHubIssueComment` interfaces. These are fine for raw-fetch mode and are type-compatible with `@octokit/openapi-types` shapes. No conflict.

**Webhook helpers:** `@octokit/rest` does not include webhook verification helpers. Webhook signature verification requires `@octokit/webhooks` (separate package). The doc implements HMAC-SHA256 verification with Node's `crypto` module directly — this is correct and does not require `@octokit/webhooks`. The raw-crypto approach is fine for MVP.

**Pagination helpers:** `@octokit/rest` exposes `octokit.paginate(endpoint, params)` which auto-follows Link headers. The doc proposes raw `fetch` and shows the Link header format without specifying how `rel="next"` is parsed. Manual Link-header parsing is a non-trivial implementation task (the header is a comma-separated, semicolon-delimited RFC 5988 format). If raw `fetch` is chosen, this must be built explicitly — the doc does not call it out as required MVP work.

**Retry handling:** `@octokit/rest` does not include retry by default. `@octokit/plugin-retry` provides it. The doc mentions exponential backoff as a mitigation strategy but does not specify where it lives (connector vs shared HTTP utility). This is a cross-connector concern — the recommendation should reference the project's shared fetch wrapper.

---

### 3. Raw Fetch vs SDK Recommendation — COHERENT BUT INCOMPLETE

The recommendation to use raw `fetch` for MVP is defensible. GitHub REST is stable and well-documented. The reasons given (bundle size, explicit control, native types) are valid.

**Gap 1 — Link-header pagination is not a trivial day-one task.** The doc notes the format but doesn't flag it as required MVP scope. Failing to implement it means polling fetches only page 1 of issues. This must be explicit.

**Gap 2 — The doc does not mention `@octokit/webhooks`.** If the connector ever moves to SDK-based webhook handling, the correct package is `@octokit/webhooks` (not `@octokit/rest` or `@octokit/action`). Should be noted for future reference.

**Gap 3 — `@octokit/action` recommendation is misapplied.** This package is designed for GitHub Actions runners and reads credentials from `GITHUB_TOKEN` environment. It is not the right choice for a long-running connector service. The correct alternative for throttling is `@octokit/rest` + `@octokit/plugin-throttling`.

---

### 4. CLI Shell-out — PASS

All claimed `gh` capabilities are valid:
- `gh issue view <number>` — works, supports `--json`
- `gh issue list` — works, supports `--repo`, `--state`, `--label`
- `gh issue close` / `gh issue reopen` — both valid subcommands
- `gh api repos/{owner}/{repo}/issues/{number}/comments` — works via `gh api`
- `gh label create` — works

The recommendation to keep `packages/github-cli` as a shell-out path for admin/CLI workflows is consistent with the project's existing approach. The connector layer using native `fetch` for programmatic access is correct separation.

---

### 5. Admin Panel Config Fields — MISSING FIELD

**Doc lists these fields in Section 11:**
```
access_token, api_base_url, webhook_secret, repo_owner, repo_name, bot_login
```

`bot_login` is described as "Username of the bot account for no_self_retrigger filtering."

This field is not present in the platform registry's github_issues connector config. Users cannot set it through the admin panel today. The doc references it in Section 7 (Identity Mapping) as the primary mechanism for self-trigger suppression.

**Options:**
1. Add `bot_login` to platform-registry config fields.
2. Resolve bot identity at runtime via `GET /user` using the connector token, and drop the config field — valid if the token always belongs to the bot account.

The doc should commit to one of these paths. Currently it documents a field that doesn't exist in the config schema.

**Severity: HIGH.** Without this resolved, the no-self-retrigger invariant is either broken or depends on undocumented runtime inference.

---

### 6. Build Plan Phasing — PASS

**MVP:** PAT auth, 8 webhook events, polling fallback with `since` parameter, HMAC-SHA256 verification, basic comment/label/state delivery ops. Nothing here requires Phase 2 features.

**Phase 2:** Assignee management, Projects v2 items, lock/unlock, search API, additional webhook events. These are additive and cleanly separated from MVP.

**Phase 3:** GraphQL bulk fetch, sub-issues (beta), dependency tracking. Correctly deferred — GraphQL adds auth surface area (same token, different endpoint) that can be layered on without breaking Phase 1/2.

No MVP feature is blocked on Phase 2/3. Ordering is correct.

---

### 7. Cross-Connector Delivery Abstraction — PASS

The doc proposes delivery ops: `comment`, `labels` (add/remove), `state` (close/reopen).

These map directly to the shared `DeliveryOp` contract:
```typescript
{ kind: 'comment'; body: string }
{ kind: 'labels'; add?: string[]; remove?: string[] }
{ kind: 'state'; change: 'close' | 'reopen' }
```

No divergence from the cross-connector pattern. The connector does not propose synchronous delivery, a different abstraction layer, or connector-specific op kinds that would break uniformity.

---

### 8. Trigger Kinds — PASS WITH NOTE

The MVP trigger set (`issues.opened`, `issues.closed`, `issues.labeled`, `issue_comment.created`) aligns with existing `github.issue.*` trigger kinds in contracts.

Phase 2 additions (`assigned`, `mention`, `comment_matches`, `creator`, title/body regex) are described with a `{ trigger, value }` shape that is consistent with existing trigger patterns.

**Note:** `label_matches` with a regex value (e.g., `/^severity-.*/`) in the trigger shape is documented but the connector normalization layer must handle regex compilation from a string. This is an implementation detail that should be noted — the contracts package likely stores trigger values as strings.

---

### 9. Open Questions — WRONG FRAME FOR THREE ITEMS

The section lists eight questions. Items 1 (multi-repo scope), 3 (Projects v2), 4 (search vs paginate), 5 (comment sync direction), and 6 (rate limit monitoring) are **feature scoping decisions**, not deployment/operational blockers.

**Missing operational blockers:**

**a. Webhook URL ownership for self-hosted deployments.** Item 8 touches this but does not frame the deployment question: does the SupportAgent platform expose one shared webhook endpoint per connector type, or per-tenant? The answer determines whether webhook registration can be automated or must be manual. This affects the admin panel UX and the deployment topology.

**b. Per-tenant GitHub App vs shared OAuth App.** The platform registry shows `supportsOAuth: true` for github_issues. If the platform registers one OAuth App per GitHub organization, each tenant must authorize it. If it's a shared app, GitHub requires all tenant-generated tokens to be scoped to the app. The doc acknowledges GitHub App vs PAT but does not frame it as a deployment blocker for the OAuth flow that is already marked supported.

**c. GHES TLS configuration.** For tenants on GHES with self-signed certificates, the connector's fetch client must accept a custom CA bundle. There is no `ca_bundle` or `tls_verify` config field in the MVP config list. Item 7 mentions GHES compatibility but only asks about PAT availability — it does not raise the TLS concern.

---

### 10. Transitive Dependencies and Licensing — PASS

`@octokit/rest` is MIT-licensed. Its transitive graph is small and MIT/ISC throughout. No concerns.

The doc does not propose any heavy SDKs (no Azure Bot Framework, no Meta Graph SDK). The raw-fetch path adds no dependencies at all.

---

## Summary Table

| # | Area | Severity | Doc Claim | Finding |
|---|------|----------|-----------|---------|
| 1 | npm packages | PASS | `@octokit/rest`, `@octokit/action` | Both exist; `@octokit/action` misapplied outside GH Actions context |
| 2 | TypeScript types | PASS | Defines own interfaces | Compatible with SDK types; no conflict |
| 3 | Webhook helpers | PASS | Uses Node `crypto` directly | Correct; `@octokit/webhooks` not mentioned but not required |
| 4 | Pagination helpers | MEDIUM | Shows Link header format | Manual Link-header parsing is required MVP work; not flagged |
| 5 | Retry handling | LOW | "Exponential backoff" mentioned | Does not specify owner (connector vs shared util); cross-connector concern |
| 6 | Raw fetch recommendation | MEDIUM | Prefer raw fetch for MVP | Coherent but gap 3 (`@octokit/action` misuse) should be corrected |
| 7 | CLI correctness | PASS | `gh` commands listed | All valid |
| 8 | Admin config fields | HIGH | Lists `bot_login` | Field absent from platform-registry; must add or document runtime inference |
| 9 | Build phasing | PASS | MVP → Phase 2 → Phase 3 | Realistic, MVP unblocked |
| 10 | Delivery abstraction | PASS | `comment`, `labels`, `state` | Matches shared DeliveryOp contract |
| 11 | Trigger kinds | PASS | MVP + Phase 2 extensions | Consistent with existing trigger pattern |
| 12 | Open questions | MEDIUM | Eight items | Three operational blockers unraised; five items are feature decisions |
| 13 | Licensing/transitive deps | PASS | No heavy SDKs | No concerns |

---

## Priority Actions

1. **Resolve `bot_login` config field gap.** Either add the field to platform-registry config, or document that bot identity is resolved at runtime via `GET /user` and remove the field from the design doc.

2. **Flag Link-header pagination as required MVP implementation work.** The doc shows the format; it must also say "the connector must implement Link-header parsing to iterate pages" — or recommend wiring `@octokit/rest`'s `paginate()` for this specific function.

3. **Replace `@octokit/action` reference with `@octokit/rest` + `@octokit/plugin-throttling`.** `@octokit/action` is GitHub Actions-specific and not appropriate for a long-running service.

4. **Add three operational blockers to Open Questions:** webhook URL ownership (per-tenant vs shared endpoint), per-tenant GitHub App registration for the existing `supportsOAuth: true` flag, and GHES TLS / `ca_bundle` config for self-signed certs.
