# GitHub Wiki Connector — SDK & Implementation Review

**Reviewer scope:** npm packages, SDK capabilities, raw-fetch-vs-SDK coherence, CLI correctness, build plan realism, admin config fields, cross-connector delivery abstraction, open questions coverage.
**Source:** `docs/connectors/github_wiki.md`
**Date:** 2026-04-18

---

## Verdict

**CONDITIONAL PASS — DECISION REQUIRED BEFORE BUILD**

The technical content is accurate. All npm packages exist, the git-only access model is correctly characterized, and the phased build plan is realistic. The primary concern is architectural: this connector is fundamentally misaligned with SupportAgent's delivery adapter model. GitHub Wiki has no comments, labels, status, priority, or assignment — meaning SupportAgent's trigger-matching (`label_matches`, `status_transition`) and outbound delivery (`comment`, `labels`, `state`) have no target. The doc acknowledges this at the end but does not carry the implication through the rest of the document. Before any build begins, the team must decide whether a wiki-monitoring connector serves a real use case or whether the recommendation should be "do not build."

---

## Findings

### 1. npm Package Existence — PASS

| Package | Version | Status |
|---|---|---|
| `@octokit/rest` | 22.0.1 | Verified on npm registry |
| `simple-git` | 3.36.0 | Verified on npm registry |
| `isomorphic-git` | 1.37.5 | Verified on npm registry |

No phantom packages. All three are MIT-licensed with no transitive licensing concerns.

`simple-git` is the correct choice for server-side wiki operations — it wraps the `git` CLI or uses a Node.js git implementation and handles shallow clones cleanly. `isomorphic-git` targets browser environments and has harder credential handling, correctly deprioritized.

---

### 2. SDK Capabilities — PASS WITH ONE OMISSION

**`@octokit/rest`** — Correctly used for repo-level webhook verification and user lookup. No dedicated wiki SDK exists, which the doc states correctly.

**Git library for wiki access** — The doc recommends `simple-git` for server-side wiki operations. This is the correct choice:
- `simple-git` (v3.x) exposes a promise-based API: `git().clone(url, path)`, `git().fetch()`, `git().show(['<sha>:wiki/<page>.md'])`, `git().add()`, `git().commit()`, `git().push()`.
- Shallow fetch is supported via `.clone({ '--depth': 1 })` or `.fetch({ depth: 1 })`.
- Credential injection works via the URL pattern: `https://<token>@github.com/<owner>/<repo>.wiki.git`.
- TypeScript types: `simple-git` ships its own types (`index.d.ts`). No `@types/` package needed.

**Omission — `@octokit/webhooks` not mentioned.** The doc implements HMAC-SHA256 verification manually using `crypto.createHmac` and `timingSafeEqual`. This is correct and avoids an extra dep, but the doc should note that `@octokit/webhooks` (v14.x, MIT) provides typed webhook handlers and signature verification as an alternative. Given that the doc already references `@octokit/rest`, acknowledging `@octokit/webhooks` as the sibling package would reduce friction for developers who reach for an SDK-first approach.

**TypeScript for git operations** — `simple-git` ships bundled types. No gap.

---

### 3. Raw Fetch vs SDK Recommendation — PASS

The doc's split is correct:
- GitHub REST API calls (user lookup, repo metadata) → `raw fetch` or `@octokit/rest`
- Wiki content access → `simple-git` (no REST API exists for wiki content)

The rationale is sound: GitHub has no REST endpoint for wiki content. No SDK change fixes this — you must use git. The recommendation to use `simple-git` for server-side wiki ops and raw `fetch` for GitHub API calls is the only viable path.

**Note:** `simple-git` operations are synchronous in the sense that each call blocks until the git subprocess completes. The connector worker must handle this without blocking the event loop — `simple-git` returns Promises, so async/await works fine. No concern here.

---

### 4. CLI Shell-out — PASS

**Claim:** `gh` CLI has no wiki-specific subcommand. Wiki access requires standard `git`.

**Verification:** `gh` (v2.x) has no `gh wiki` subcommand. The `gh` CLI exposes `gh repo`, `gh issue`, `gh pr`, `gh api`, etc., but no wiki operations. This is accurate.

The doc correctly recommends standard `git` for wiki clone/push and correctly does not propose using `gh` for wiki work. The existing `packages/github-cli` wrapper in this project is for GitHub API and GitHub Issues workflows — it is not relevant for wiki access.

---

### 5. Build Plan Phase Ordering — PASS

| Phase | Content | Assessment |
|---|---|---|
| MVP | `gollum` webhook handler + git content fetch via `simple-git` | No OAuth needed. PAT with `repo:wiki` scope is a single stored token. Realistic. |
| Phase 2 | Poll-and-diff, content-trigger matching, outbound wiki page writes via git | Requires git diffing logic and file-format parsing. Additive to MVP. |
| Phase 3 | Full wiki clone + index for semantic search | Requires substantial infra. Correctly deferred. |

No MVP feature is blocked on Phase 2 or 3. The git-based content fetch is the correct MVP priority — it is also the hardest part (no REST API means no `fetch` shortcut for page content).

**One note:** The doc recommends "Poll only if webhook delivery fails." This is a reasonable fallback, but it conflates two distinct failure modes: (a) the webhook endpoint is unreachable (network issue) and (b) the webhook event lacks page body (design constraint). The doc correctly identifies (b) — you must git-fetch content after every `gollum` event regardless of webhook delivery success. The polling fallback in Phase 2 is for catching events missed when the webhook was unreachable, not for compensating for missing body content.

---

### 6. Admin Panel Config Fields — PASS WITH ONE GAP

**Listed MVP fields:**
```
wiki_url, auth_token, webhook_secret, default_branch
```

These are all necessary and sufficient for the MVP path:

- `wiki_url` — Derived from `owner/repo`, or custom for enterprise. Required.
- `auth_token` — PAT with `repo:wiki` scope. Required.
- `webhook_secret` — For HMAC-SHA256 verification of `gollum` events. Required.
- `default_branch` — Usually `master`; wikis using `main` need this configurable. Sensible.

**No `bot_login` field** — Unlike the github_issues connector (which needs bot identity for self-retrigger suppression), the wiki connector's `gollum` payload uses `sender.login` directly. No bot-login resolution is needed. This is correctly omitted.

**Gap — `webhook_secret` provisioning UX is unsolved.** The doc correctly notes in Gotcha #7 that webhook secret provisioning must be done manually in repo settings — there is no API to register webhooks for wikis. This means `webhook_secret` is not a true "admin panel config field" in the usual sense — the tenant configures it in GitHub's UI and copies it into SupportAgent. The field belongs in the config, but the admin panel UX must guide tenants through the GitHub settings UI. This should be noted explicitly in the connector's admin panel spec.

---

### 7. Cross-Connector Delivery Abstraction — FUNDAMENTAL MISMATCH

**This is the most significant finding.**

SupportAgent's `DeliveryOp` contract supports:
- `comment` — post a comment
- `labels` — add/remove labels
- `state` — close/reopen
- `pr` — create/review/merge PR

GitHub Wiki supports **none of these**. Wiki pages are flat documents with no comment thread, no labels, no status, no priority, no assignees, no mentions, and no close/resolve concept. The only write operation is creating or editing a wiki page via git commit.

The doc correctly identifies this in Section 5 and in the "Cannot do" table (Section 4), but does not flag it as a cross-connector abstraction problem. Specifically:

- The connector cannot use `DeliveryOp` as defined in `packages/contracts/src/skill-run-result.ts` — there is no meaningful op kind that maps to wiki behavior.
- The connector cannot participate in SupportAgent's trigger model: `label_matches`, `status_transition`, `comment_body_regex` (without Phase 2 git-fetch), and `mention` all have no target.
- The doc proposes "outbound write: create/edit wiki pages via git commit" for Phase 2 — this is a git write operation, not a `DeliveryOp`. The connector would need a new op kind or a non-standard delivery path.

**Required action:** The connector design must either (a) introduce a new `DeliveryOp` variant (e.g., `wiki_page_create`, `wiki_page_edit`) with a non-standard delivery path, or (b) acknowledge that GitHub Wiki is a read-only feed and the connector does not use the standard delivery adapter at all. The doc should make this explicit rather than implying the standard model applies.

---

### 8. Open Questions — GOOD COVERAGE, ONE MISSING ITEM

| Question | Assessment |
|---|---|
| Use case validation | Correctly flagged as the primary decision gate — confirm wiki monitoring need before building |
| Enterprise wikis | Correctly flagged — GHES wiki URLs may differ |
| Content format (Markdown vs AsciiDoc) | Correctly flagged — affects parsing logic |
| Webhook provisioning UX | Correctly flagged — no API to register webhooks; must be manual |
| Rate limit for content fetch | Correctly flagged — git clone per event could be rate-limited |
| GHES version parity | Correctly flagged — older GHES may lack `wiki.git` URL pattern |

**One missing item:** The doc does not raise the question of **how the `simple-git` operations run in a multi-tenant environment**. Wikis are bare git repos; each tenant's wiki requires a separate clone directory, separate auth token, and separate credential configuration. Concurrent git operations on the same repo (e.g., from multiple workers processing events for the same tenant) need git lock handling. This is an operational concern that should be in the open questions.

---

### 9. Transitive Dependencies and Licensing — PASS

`simple-git` is MIT-licensed. Its only runtime dep is `execa` (MIT) for spawning git subprocesses. No heavy SDKs proposed. No licensing concerns.

---

## Summary

| # | Area | Severity | Finding |
|---|---|---|---|
| 1 | npm packages | PASS | `@octokit/rest`, `simple-git`, `isomorphic-git` all verified |
| 2 | SDK capabilities | PASS | `simple-git` is correct choice; `@octokit/webhooks` omission noted |
| 3 | Raw fetch vs SDK | PASS | Correct split — git ops via `simple-git`, API via `fetch` |
| 4 | CLI correctness | PASS | `gh` has no wiki subcommands; doc correctly recommends `git` |
| 5 | Build phasing | PASS | MVP unblocked; Phase 2/3 correctly deferred |
| 6 | Config fields | PASS | Correct fields; `webhook_secret` UX gap noted |
| 7 | Delivery abstraction | **HIGH** | Wiki has no `comment`/`labels`/`state` ops — `DeliveryOp` contract does not apply |
| 8 | Open questions | LOW | One operational concern missing (multi-tenant git clone isolation) |
| 9 | Licensing/transitive deps | PASS | No concerns |

---

## Priority Actions Before Build

1. **Resolve the delivery abstraction mismatch.** Decide whether this connector introduces a new `DeliveryOp` variant (`wiki_page_create`, `wiki_page_edit`) or is designed as a read-only feed with no standard delivery path. Document the decision in the connector spec, not just in the review.

2. **Confirm the use case.** The doc's closing recommendation ("do not build as a first-class platform connector") should be escalated to a product decision, not left as an aside. If wiki monitoring is a real customer need, build it as a lightweight integration with a clear scope. If not, close the design doc.

3. **Add `@octokit/webhooks` as a note** in Section 12. The manual HMAC approach is correct, but developers should know the typed SDK alternative exists.

4. **Add open question: multi-tenant git clone isolation.** How does the worker handle concurrent git operations on the same wiki repo? Git lock files, clone directory management, and credential refresh all need a strategy before Phase 1.

5. **Clarify webhook_secret UX in admin panel.** The field belongs in config, but the tenant experience must guide them to GitHub repo settings to provision it. Document the admin UX flow explicitly.
