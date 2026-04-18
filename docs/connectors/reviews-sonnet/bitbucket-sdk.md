# Bitbucket Connector — SDK & Implementation Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, build plan realism, config field alignment, open questions coverage, cross-connector consistency.
**Source:** `docs/connectors/bitbucket.md`
**Model:** claude-sonnet-4-6
**Date:** 2026-04-18

---

## Verdict: APPROVED WITH CORRECTIONS

The raw-fetch recommendation is the right call given the Bitbucket SDK landscape. Several factual errors need correction before implementation begins: two webhook event names are wrong, the issue `labels` field does not exist in the API, the rate limit table omits the modern scaled limits model, and — most urgently — the entire issue tracker scope is obsolete given Atlassian's August 2026 sunset announcement.

---

## Findings

### 1. npm Package Existence and SDK Landscape

**Affected:** Section 12.1 "Official SDK Availability"

**What the doc says:**

| Package | Status |
|---|---|
| `@atlassian/bitbucket` | Not available |
| `bitbucket` | Community (atlassian), partial coverage, may be outdated |
| `bitbucket-rest` | Community, basic REST wrapper |

**What is actually true:**

The table is partially correct but needs precision:

- `@atlassian/bitbucket` — confirmed non-existent on npm. Correct.
- `bitbucket` (v2.12.0, MIT) — exists, published by MunifTanjim, last published May 2024. There is an Atlassian-org fork at `github.com/atlassian/node-bitbucket` but it has no published releases and no official endorsement as an Atlassian product. The `bitbucket` npm package is community-maintained, infrequently updated (v2.11.0 → v2.12.0 gap was 14 months), and has ~75 downstream dependents. It ships auto-generated TypeScript types derived from the OpenAPI spec. It has no pagination helpers, no webhook verification helpers, and no retry handling. It does cover the full Cloud 2.0 namespace including `pullrequests`, `issue_tracker`, `webhooks`, `pipelines`, and `repositories`.
- `@atlassian/bitbucket-server` — exists on npm as a port of the above for Data Center/Server. Maintenance status is opaque; the npm page exists but publish cadence is unknown.
- `bitbucket-rest` — exists. Community. Not worth evaluating for production use.

The doc's description of `bitbucket` as "may be outdated" is accurate but understates the practical risk. The package's auto-generated types are a real value-add if the team wants typed request/response shapes without maintaining their own. The lack of pagination and retry helpers is the correct reason to avoid it as the primary client.

**Required fix:** Clarify that `bitbucket` v2.12.0 does ship TypeScript types (auto-generated from Bitbucket's OpenAPI spec) — this is the one meaningful thing it offers beyond raw fetch. The doc's dismissal is overly brief and misses that the types alone could be used as a type-import companion to a raw fetch client.

---

### 2. Raw Fetch vs SDK Recommendation — Coherent

**Affected:** Section 12.2

The recommendation to use raw `fetch` with typed wrappers is the right call for Bitbucket. The four stated reasons are all valid:

1. No official SDK
2. Community SDKs may be unmaintained
3. REST API is well-documented
4. Webhook handling is custom anyway

The example `BitbucketClient` class in the doc is minimal but workable as a starting skeleton. It handles 429 with `Retry-After` and throws typed errors. No cross-connector consistency issues — the pattern is the same fetch-wrapper approach used in connectors where no mature SDK exists.

One gap: the example class does not handle pagination. The Cloud API's `next` URL cursor pattern (in the paginated response envelope) should be addressed in the implementation, even if not in the design doc. A `paginate<T>()` helper that follows `response.next` is three lines of code and should be noted as a required utility, not a Phase 2 concern.

---

### 3. Webhook Event Names — Two Errors

**Affected:** Section 3.1.2 (Webhook Events), Section 11 (MVP scope)

**Finding A — `pullrequest:needs_review` does not exist**

The doc lists `pullrequest:needs_review` as a pull request webhook event in both Section 3.1.2 and Section 11 (Phase 2 additional events). This event name is not present in Atlassian's official event payloads documentation. It does not appear in any indexed Bitbucket webhook documentation as of 2024–2026. This is likely a fabricated or speculative event name.

**Finding B — `pullrequest:request_change` is wrong**

The doc lists `pullrequest:request_change` (Section 3.1.2) and refers to it in the MVP webhook handler list (Section 11). The correct event names per official Bitbucket Cloud documentation are:
- `pullrequest:changes_request_created` — changes requested on a PR
- `pullrequest:changes_request_removed` — changes request removed

`pullrequest:request_change` (singular, no `s`) is not a valid Bitbucket Cloud event key.

**Also missing from the event list:**
- `pullrequest:comment_resolved` — comment resolved
- `pullrequest:comment_reopened` — comment reopened

**Required fix (blocking):** Replace `pullrequest:request_change` with `pullrequest:changes_request_created` and `pullrequest:changes_request_removed` everywhere it appears. Remove `pullrequest:needs_review`. Add `pullrequest:comment_resolved` and `pullrequest:comment_reopened` to the complete event table.

---

### 4. Issue `labels` Field Does Not Exist

**Affected:** Section 3.2 (Issue Payload), Section 5.1 (Issue Labels), Section 6.2 (Triggers), Section 11 (MVP scope)

**What the doc says:**
```json
"labels": ["security", "authentication"]
```
The doc shows a `labels` array as a field on the issue object and lists label-add and label-remove as trigger matchers.

**What is actually true:**
The Bitbucket Cloud REST API 2.0 issue object does **not** have a `labels` field. The official schema fields are: `type`, `id`, `repository`, `title`, `reporter`, `assignee`, `created_on`, `updated_on`, `edited_on`, `state`, `kind`, `priority`, `milestone`, `version`, `component`, `votes`, `content`.

The closest equivalents to labeling in Bitbucket issues are `component` (a structured `{id, name}` object, not a string array), `kind` (bug / enhancement / proposal / task / question), and `priority`. There is no free-form label array on issues.

The `labels` add/remove operations described in Section 4.7 ("Add/Remove Label") also do not map to any real Bitbucket Cloud API behavior. The update body shown (`{"type": "update", "labels": [{"name": "support", "add": true}]}`) is not a valid Bitbucket Cloud API request.

**Required fix (blocking):** Remove `labels` from the issue payload example and from all trigger matcher tables. Replace with `component`, `kind`, and `priority` as the structured metadata fields available. Remove Section 4.7's label add/remove endpoint description for Cloud issues — there is no such endpoint. The trigger `label_added` / `label_removed` in Section 6.2 must be removed or replaced with `kind_changed` / `component_changed`.

---

### 5. Issue Tracker Sunset — Major Scope Risk

**Affected:** Section 11 (MVP scope), Section 6.2, Section 3.2, Section 4.6–4.8

**Critical finding:**
Atlassian announced the sunset of the Bitbucket Cloud issue tracker. From April 2026, the issue tracker cannot be enabled on repositories that do not already have it active. The feature is fully removed on **August 20, 2026** — four months from the date of this document.

This has a direct impact on the connector scope:
- All issue-related endpoints in Section 11 (MVP) are for a feature that will not exist in new Bitbucket workspaces from April 2026 and will be gone entirely by August 2026.
- Any tenant who migrates their workspace to `admin.atlassian.com` administration has already lost access to the issue tracker.
- The recommended migration path is Jira — which has a separate SupportAgent connector.

**Required fix (blocking design decision):** The MVP scope must be reconsidered. Options:
1. Drop all Bitbucket issue tracker scope from the connector entirely — focus on pull requests only.
2. Retain issue tracker scope with explicit "legacy only — sunset August 2026" warning and a plan to deprecate it.
3. Redirect issue use cases to the Jira connector.

This is not a minor documentation fix. It affects which endpoints to build, which webhook events to handle, and the admin panel config fields. A decision is needed before implementation starts.

---

### 6. Rate Limit Table Incomplete — Modern Scaled Limits Omitted

**Affected:** Section 8.1

**What the doc says:**

| Tier | Limit |
|---|---|
| Unauthenticated | 60 requests/hour |
| Authenticated (free) | 60 requests/hour |
| Authenticated (paid workspace) | 1000 requests/hour |
| OAuth app | Based on workspace plan |

**What is actually true:**
The unauthenticated limit (60/hour) and base authenticated limit (1,000/hour) are correct. However:

- Authenticated free accounts also get 1,000/hour, not 60/hour. The doc incorrectly lists 60/hour for authenticated free users — 60/hour is unauthenticated (IP-scoped) only.
- As of November 2024, Atlassian introduced **Scaled Rate Limits** for Standard and Premium workspaces. The formula is `1,000 + (paid_seats - 100) × 10`, capped at 10,000/hour. This applies when using workspace/project/repository access tokens or Forge app authentication (not user PATs).
- The rate limit window is a rolling hour, not a fixed clock hour.
- The `X-RateLimit-Resource` and `X-RateLimit-NearLimit` headers (added with scaled limits) are not mentioned in the doc.

**Required fix:** Correct the "Authenticated (free)" row to 1,000/hour. Add a row for scaled limits (up to 10,000/hour with access tokens, large paid workspaces). Update the rate limit headers table.

---

### 7. Webhook Signature Header — Minor Inaccuracy

**Affected:** Section 3.1.3

**What the doc says:**
```
X-Hub-Signature: sha256={hmac_hex_digest}
X-Hub-Signature-256: sha256={hmac_hex_digest}
```

**What is actually true:**
Both headers are sent by Bitbucket Cloud on verified deliveries. The doc is correct on this point. However, the verification section omits the `X-Event-Key` header (event type identifier, e.g., `pullrequest:created`), which is present on every webhook delivery and is the primary dispatch field for routing to the correct handler. This is not a signature concern but is relevant to the inbound implementation design.

**Recommended addition:** Document `X-Event-Key` as the dispatch header in Section 3.1.3 or add it to the inbound payload fields. The absence of this detail will likely cause a question during implementation.

---

### 8. CLI Parity Section — Minor but Misleading

**Affected:** Section 12.3

The doc mentions `bb` CLI as "Available — Server-side, for Data Center." This is inaccurate. There is no official Atlassian `bb` CLI equivalent to `gh` for GitHub. The Bitbucket community ecosystem has various CLI tools (none official, none production-ready for automation). The section correctly concludes "Use REST API as single source of truth" but the suggestion that `bb` is available creates a false lead.

**Required fix:** Remove the `bb` CLI row or annotate it as "no official equivalent to `gh` — community tools only, not recommended."

---

### 9. MVP Config Fields — Mostly Correct, One Gap

**Affected:** Section 11

```typescript
interface BitbucketConfig {
  authType: 'pat' | 'oauth';
  accessToken: string;
  workspaceSlug: string;
  defaultRepoSlug?: string;
  webhookSecret?: string;
  botUsername?: string;
}
```

This is a reasonable MVP config shape. Notes:

- `authType: 'pat' | 'oauth'` — the doc says "MVP: PAT only." If OAuth is not implemented at MVP, the union type should be `'pat'` only at MVP, with `'oauth'` added in Phase 2. Exposing `oauth` in the config type before it is implemented invites dead-code paths.
- `botUsername` — unlike the GitHub connector's `bot_login`, this is correctly labelled optional and described as "for no_self_retrigger." However, this field cannot be auto-resolved for Bitbucket because the API returns a UUID (`author.uuid`), not a username, on comments posted by the bot account. The connector needs `botUserUuid` (resolved at startup via `GET /2.0/user`), not `botUsername`. The display name or username is not a stable anti-self-trigger identifier.
- Data Center variant: if Data Center is supported at MVP, the config needs a `host` field and a `variant: 'cloud' | 'datacenter'` discriminator. The doc does not include these, which implies Data Center is deferred (not stated explicitly).

**Required fix:** Rename `botUsername` to `botUserUuid` (or document that it holds the UUID returned by `GET /2.0/user`, not the display name). Lock `authType` to `'pat'` at MVP type level. Add a note that `variant` and `host` fields are needed when Data Center support is added.

---

### 10. Build Plan Phase Ordering — Reasonable With One Concern

**Affected:** Section 11 (MVP, Phase 2, Phase 3)

| Phase | Blocking Concern | Assessment |
|---|---|---|
| MVP — PAT + webhook events + PR ops | No OAuth needed; PAT is a single stored token | Realistic |
| Phase 2 — Pipelines, repo activity, full user resolution | Builds on MVP auth | Realistic |
| Phase 3 — Branch restrictions, commit statuses, deployments | Advanced; correctly deferred | Realistic |

The ordering is sound. PAT-only MVP with webhook events is achievable without OAuth infrastructure.

The main concern: Phase 2 includes `GET /2.0/repositories/{workspace}/{repo}/pipelines` and deployment tracking. These require no additional auth beyond PAT, so they could move to MVP if pipeline status is a priority use case. The doc defers them appropriately if not needed for the initial tenant onboarding.

---

### 11. Cross-Connector Consistency

The Bitbucket connector doc follows the same inbound/outbound pattern as the GitHub and GitLab connectors: webhook intake → normalize → worker queue; write-back via typed client methods. The delivery model is async. The op kinds (`createComment`, `updateStatus`, `addLabel`, `mergePR`) map cleanly to the shared adapter interface.

One structural difference worth noting: unlike the GitHub connector, the Bitbucket connector has no SDK retry layer — retry on 429 with `Retry-After` must be built into the `BitbucketClient.request()` method. The example snippet in Section 12.2 throws `RateLimitError` but does not retry. The implementation should treat 429 as retryable (with delay) rather than a fatal error, consistent with how `@octokit/plugin-retry` handles GitHub rate limits.

---

### 12. Open Questions Coverage

The open questions in Section 13 cover the right tenant-specific and technical questions. The following deployment/operational blockers are correctly raised:
- Cloud vs Data Center variant (determines API URL and auth method)
- Workspace admin vs user PAT scope
- Multi-repo support per tenant
- On-prem Data Center webhook reachability

Missing question that other connector docs raise:
- **Webhook receiver URL reachability in development/staging.** Bitbucket Cloud cannot deliver webhooks to localhost. This is a concrete development blocker (requires ngrok, Cloudflare Tunnel, or a staging URL). Should be an open question for each tenant's onboarding environment.
- **Issue tracker availability.** Given the August 2026 sunset, the question "Does the tenant use Bitbucket issues?" is now more specifically: "Does the tenant's workspace still have the issue tracker enabled, and do they need it before August 2026?" This is a prerequisite for issuing any issue-related connector scope.

---

## Summary of Required Changes

| # | Location | Issue | Severity |
|---|---|---|---|
| 1 | Section 3.1.2, Section 11 | `pullrequest:request_change` → `pullrequest:changes_request_created` / `pullrequest:changes_request_removed`; remove `pullrequest:needs_review`; add `pullrequest:comment_resolved` and `pullrequest:comment_reopened` | Blocking |
| 2 | Section 3.2, 4.7, 5.1, 6.2, Section 11 | Issue `labels` field does not exist in Bitbucket Cloud API — remove from payload examples, trigger tables, and label add/remove ops | Blocking |
| 3 | Section 11 (scope decision) | Bitbucket issue tracker sunsets August 20, 2026 — all issue-scope endpoints/events in MVP must be reconsidered or explicitly scoped to legacy tenants only | Blocking (design decision) |
| 4 | Section 8.1 | Authenticated free tier rate limit is 1,000/hour not 60/hour; add Scaled Rate Limits (up to 10,000/hour) introduced Nov 2024 | Medium |
| 5 | Section 11 | `botUsername` should be `botUserUuid` (Cloud uses UUID for identity); `authType` should be `'pat'` only at MVP type level | Medium |
| 6 | Section 12.1 | Note that `bitbucket` v2.12.0 ships auto-generated TypeScript types that can be used as type companions to a raw fetch client | Low |
| 7 | Section 12.3 | Remove or annotate `bb` CLI row — no official equivalent to `gh` exists for Bitbucket | Low |
| 8 | Section 3.1.3 | Add `X-Event-Key` as the webhook dispatch header | Low |
| 9 | Section 12.2 | Note that pagination (`response.next` cursor) must be implemented as a utility in the client, not left for Phase 2 | Low |
| 10 | Section 13 | Add open question about webhook receiver URL reachability in dev/staging | Low |

Items 1, 2, and 3 are correctness or scope-blocking issues that will cause implementation failures or wasted effort if not resolved before building starts.
