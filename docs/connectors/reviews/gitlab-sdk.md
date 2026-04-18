# GitLab Connector — SDK & Implementation Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, CLI tool claims, build plan realism, config field alignment, cross-connector consistency.
**Source:** `docs/connectors/gitlab.md`
**Date:** 2026-04-18

---

## Verdict: APPROVED WITH CORRECTIONS

The document's technical foundation is sound. One critical correction required: the `glab` CLI section references an unmaintained npm package that is not the GitLab CLI. Two medium-severity issues: a config field mismatch with the platform registry, and an unsubstantiated claim about automatic retry handling in `@gitbeaker/rest`. The overall build plan is realistic.

---

## Findings

### 1. npm Package Existence

| Package | Version | Status | Notes |
|---|---|---|---|
| `@gitbeaker/rest` | 43.8.0 | ✅ Exists | Main JS/TS GitLab SDK |
| `@gitbeaker/core` | 43.8.0 | ✅ Exists | Internal dependency of `@gitbeaker/rest` |
| `gitlab` (legacy) | 14.2.2 | ✅ Exists | Older JS SDK, still maintained |
| `graphql-request` | 7.4.0 | ✅ Exists | Lightweight GraphQL client |
| `glab` (npm) | 1.0.2 | ⚠️ **WRONG PACKAGE** | Unmaintained since 2017 (see finding #2) |

No phantom packages. The `@gitbeaker/rest` recommendation is correct and the package is actively maintained.

---

### 2. `glab` CLI — Critical: Wrong Distribution Channel

**Affected section:** §12.2 CLI Tool (line 780)

**What the doc says:**
> "GitLab CLI (`glab`) is the equivalent of `gh`. Available at https://github.com/cli/gitlab"
> "Shell out to `glab` for initial setup (auth flow, webhook registration) and ad-hoc debugging."

**What is actually true:**

The official GitLab CLI (`glab`) is a **Go binary** distributed via:
- GitHub releases: https://github.com/cli/gitlab/releases
- Homebrew: `brew install glab`
- Linux packages (apt, yum, etc.)
- Chocolatey, Snap, winget

The npm package `glab@1.0.2` is a completely different, abandoned project (last published 2017) with a different author and purpose. It has no relation to the official GitLab CLI.

**Correction required:**

Section 12.2 must distinguish between:
1. The **official GitLab CLI** (`glab`) — a Go binary, shelled out via `exec` just like `gh`
2. The **npm package `glab`** — unrelated, must not be used

The recommendation to "shell out to `glab`" is correct in principle. The installation instructions in `packages/github-cli/` use `gh` via the system `PATH`. The GitLab connector would follow the same pattern for `glab` — detect it in `PATH`, shell out for auth and webhook registration, use the REST API directly for runtime operations.

**Revised §12.2:**
> GitLab CLI (`glab`) is the equivalent of `gh`. It is a Go binary installed separately — NOT an npm package. Install via Homebrew (`brew install glab`), GitHub releases, or system package manager.
>
> **Do not confuse with `npm install glab`** — the npm package `glab@1.0.2` is an unrelated, abandoned project.
>
> Shell out to `glab` for initial setup (auth flow, webhook registration via `glab webhook create`) and ad-hoc debugging. Core connector runtime uses the REST API directly.

---

### 3. SDK Capabilities — Partially Verified

**TypeScript types:** ✅ Confirmed. `@gitbeaker/rest` ships TypeScript declarations (`dist/types/index.d.ts`). No separate `@types` package needed.

**Pagination helpers:** ✅ Confirmed. SDK supports both keyset and offset pagination with typed options. The README shows `pagination: 'keyset'` mode with `orderBy` and `sort` parameters. This matches the doc's §9 recommendation.

**Rate limit handling:** ⚠️ Partially verified. The SDK has configurable per-endpoint rate limits with glob patterns. The README confirms built-in request throttling between consecutive API calls using the `RateLimit-*` headers. Default note creation rate limit is set to **300 req/s** (not 60/min — see finding #4).

**Webhook helpers:** N/A. GitLab uses a shared secret, not HMAC. The SDK does not include webhook helpers. The doc correctly uses manual string comparison.

**Retry handling:** ⚠️ Claimed but unsubstantiated. Section 12.2 says `@gitbeaker/rest` provides "automatic retry with `Retry-After`." The SDK README does not document automatic retry behavior. The SDK throttles outgoing requests but does not appear to retry on 429 responses automatically. **This claim needs verification or removal.**

**Corrected §12.2 (SDK benefits):**
> `@gitbeaker/rest` handles:
> - Automatic pagination (with `pagination: 'keyset'` mode)
> - Token management (passed via constructor)
> - Rate limit throttling (respects `RateLimit-*` headers by delaying between requests)
> - Consistent error shape (`GitbeakerError`)
>
> **Note:** The SDK throttles but does not automatically retry on 429 responses. Retry logic with `Retry-After` parsing should be implemented as a wrapper or middleware if required.

---

### 4. Rate Limit Numbers — Precision Fix

**Affected section:** §8.1 (line 537) and §12.2

**What the doc says:**
> "Notes (comments) on issues/MRs: **60 req/min**"

**What `@gitbeaker/rest` defaults to:**
> `'projects/*/issues/*/notes': { method: 'post', limit: 300 }` — 300 req/s

These are measuring different things. The GitLab.com **enforcement** limit is 60/min per user. `@gitbeaker/rest`'s built-in throttling is a **request-rate limiter** (req/s), not the GitLab API's enforcement cap. The SDK's default of 300 req/s for note creation is an internal throttle to avoid hitting GitLab's limit — it is not GitLab's limit itself.

**Correction:** Clarify in §8.1 and §12.2:

> **60 notes/min** is GitLab.com's enforcement limit (per user, per IP). `@gitbeaker/rest` defaults to an internal throttle of 300 req/s on note creation endpoints — this is conservative and well below the API limit. The connector should still implement its own `Retry-After` handling and per-tenant rate tracking to avoid hitting GitLab's 60/min ceiling when multiple operations are queued.

---

### 5. Raw Fetch vs SDK Recommendation — Coherent

The doc recommends `@gitbeaker/rest` as the primary SDK, noting raw `fetch` is viable for minimal overhead. This is correct:

- GitLab's REST API is well-documented and straightforward
- `@gitbeaker/rest` covers the full API surface (up to GitLab 16.5 per README)
- The SDK handles pagination boilerplate and rate-limit throttling
- For a production multi-tenant connector, the SDK's consistency benefits outweigh the bundle-size cost

**No inconsistency** between the SDK recommendation and the per-endpoint documentation throughout §4.

---

### 6. Build Plan Phase Ordering — Realistic

| Phase | Blocking on OAuth? | Blocking on Discussions? | Status |
|---|---|---|---|
| MVP: PAT + webhooks | No | No — Notes API only | ✅ Realistic |
| Phase 2: OAuth + Discussions + group webhooks | Yes (correctly deferred) | No — could be earlier | ✅ Realistic |
| Phase 3: Work Items + GraphQL | No | No — new API surface | ✅ Realistic |

The ordering is correct. MVP uses PAT (single token, no OAuth redirect) and Notes API (flat comments). Phase 2 adds OAuth multi-tenant complexity and Discussions API. Phase 3 adds Work Items API and GraphQL.

**One refinement:** Discussions API (§4.15) could be moved to Phase 1.5 or late MVP if threaded comments are confirmed as a tenant requirement. The Notes API vs Discussions API distinction is critical (§10.3) but the Discussions endpoints (`POST /discussions`, `PUT /discussions/:id/resolve`) are simple REST calls. Not a blocker, just an efficiency observation.

---

### 7. Config Fields — Mismatch with Platform Registry

**Affected section:** §11 MVP (line 725–731)

**What the doc specifies for MVP admin panel:**
```
apiUrl        — base GitLab URL
projectId     — numeric project ID or URL-encoded path
botToken      — PAT with `api` scope
webhookSecret — shared secret for X-Gitlab-Token verification
botUserId     — bot's global user ID (no-self-retrigger)
botUsername   — bot's username (no-self-retrigger)
```

**What the platform registry `gitlab` entry actually has:**
```
access_token  — PAT
api_base_url  — base URL
webhook_secret — shared secret
```

**Missing from platform registry:**
- `project_id` or `project_path` — needed to scope the connector to a specific project (MVP core)
- `bot_user_id` — for no-self-retrigger (MVP core)
- `bot_username` — for no-self-retrigger (MVP core)

**Also:** The doc specifies `apiUrl` with value `https://gitlab.com/api/v4`, but the platform registry field is `api_base_url` with placeholder `https://gitlab.com`. The admin panel must construct the API path from the base URL. Clarify whether the connector appends `/api/v4` automatically or if the stored value should include it.

**Action required:** Add `project_id`, `bot_user_id`, `bot_username` to the `gitlab` entry in `platform-registry.ts`. The naming should follow the registry's pattern: `project_id` (text), `bot_user_id` (text), `bot_username` (text). `bot_user_id` can be optional in the registry schema but recommended at setup time.

---

### 8. Cross-Connector Consistency — Acceptable

The `gitlab` platform registry entry has `defaultDirection: 'both'` (same as `github`, `linear`, `jira`, `trello`). The document covers inbound (webhook events, polling fallback) and outbound (POST comments, update issues/MRs, change labels). This aligns with the uniform delivery adapter model.

**No conflicting abstraction detected.** The connector follows the same pattern as `github` and `linear`:
- Webhook-first intake with polling fallback
- Outbound write-back via REST API
- Shared secret webhook verification
- PAT for MVP, OAuth for Phase 2

The bot identity pattern (`botUserId` + `botUsername` for no-self-retrigger) mirrors GitHub's `bot_login` and `author.id` checks. Consistent with the rest of the codebase.

---

### 9. Dependency Analysis

**`@gitbeaker/rest` transitive deps:**
- `@gitbeaker/core` — the actual API implementation
- `@gitbeaker/requester-utils` — HTTP request handling

**Bundle size:** Per `packagephobia.com`, `@gitbeaker/rest` is lightweight. No heavy transitive deps (no `axios`, no large GraphQL libraries).

**`graphql-request` (Phase 3):** Lightweight, framework-agnostic, MIT licensed. No concerns.

**`glab` CLI (Go binary):** If shelled out via `exec`, it adds a system dependency. Installation must be documented (Homebrew, apt, GitHub releases). This is the same pattern as `gh` in `github-cli`.

---

### 10. Open Questions — Appropriate

| Question | Status |
|---|---|
| SaaS vs self-managed (rate limit strategy) | ✅ Correctly flagged — `api_base_url` covers both |
| GitLab tier (Premium+ features) | ✅ Correctly flagged — affects epics, weight, health_status |
| Per-tenant or shared bot account | ✅ Correctly flagged |
| OAuth2 required from day one? | ✅ Correctly deferred to Phase 2 |
| MR support in MVP? | ✅ Correctly flagged — MRs double the event surface |
| Custom fields (Jira-style)? | ✅ Correctly flagged — GitLab has no custom field API |
| Comments vs Discussions? | ✅ Correctly flagged — Notes API ≠ Discussions API |
| Webhook or polling? | ✅ Correctly flagged — affects public endpoint requirement |
| Multi-project support? | ✅ Correctly flagged — group-level webhooks Premium+ |
| Webhook reliability (40-failure disable)? | ✅ Correctly flagged — operational concern |

All questions target real deployment/operational blockers. None are design-level flaws. The note about "Webhook reliability" is the most operationally critical — the 40-failure permanent disable behavior should have a mitigation plan (auto-disable monitoring, alerting, or API-based re-enable).

---

## Summary of Required Changes

| # | Location | Issue | Severity |
|---|---|---|---|
| 1 | §12.2 | `glab` npm package is unrelated/obsolete — official CLI is a Go binary | **Critical** |
| 2 | §12.2 | "Automatic retry with Retry-After" claim unsubstantiated in SDK README | **Medium** |
| 3 | §8.1 + §12.2 | SDK throttle (300/s) vs GitLab enforcement (60/min) conflation | Low |
| 4 | `platform-registry.ts` | Missing `project_id`, `bot_user_id`, `bot_username` config fields | **Medium** |
| 5 | §11 | `apiUrl` field name vs registry's `api_base_url` — clarify API path construction | Low |
| 6 | §4.15 | Discussions API could be Phase 1.5, not blocked on Phase 2 | Low |

**Items 1 and 4 must be resolved before implementation.** Items 2, 3, 5, and 6 are precision fixes.

---

## Comparison with GitHub Connector (Reference)

| Aspect | GitLab | GitHub |
|---|---|---|
| SDK | `@gitbeaker/rest` (community) | `@octokit/rest` (official) |
| CLI | `glab` (Go binary, not npm) | `gh` (Go binary, pre-installed) |
| Webhook secret | Shared secret (no HMAC) | HMAC-SHA256 |
| Pagination | Keyset + offset (up to 100/page) | Offset only (up to 100/page) |
| Rate limit enforcement | 2000 req/min (notes: 60/min) | 5000 req/hr authenticated |
| OAuth model | Per-tenant OAuth app required | GitHub App (multi-org) |
| Config fields (MVP) | 6 fields (incl. bot identity) | 3 fields (per registry) |
| Cross-connector adapter | `defaultDirection: both` ✅ | `defaultDirection: both` ✅ |
