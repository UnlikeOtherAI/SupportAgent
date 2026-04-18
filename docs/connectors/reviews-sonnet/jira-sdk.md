# Jira Connector — SDK and Implementation Review

**Reviewer scope:** npm packages, SDK capabilities, build plan realism, admin config fields, cross-connector delivery abstraction, open questions quality.
**Source:** `docs/connectors/jira.md`
**Checked:** 2026-04-18

---

## Verdict

**Conditional pass with notable findings.** The overall build plan ordering is sound and the API coverage is thorough. However the primary recommended library has a wrong GitHub URL, its claimed capabilities (automatic retry and pagination helpers) do not exist in the actual package, and the MVP config field list is missing a required field. The Phase 2 delivery ops (assign, set priority, attach files, mention) are outside the shared `DeliveryOp` contract and will require contract changes — the doc does not flag this. The Open Questions section is strong on operational concerns but mixes in feature scoping items.

---

## Findings

### 1. npm Package — `jira.js` exists but wrong GitHub URL

**Claim (Section 12.2):** Community SDK `jira.js` at `https://github.com/MrBomberman/jira.js`.

**What is true:** The package `jira.js@5.3.1` exists on npm, is MIT-licensed, and is TypeScript-first. However the correct GitHub URL is `https://github.com/MrRefactoring/jira.js` — `MrBomberman` does not exist. The maintainer is `mrrefactoring`. This is a stale link; the doc needs updating.

**Other community packages listed:**
- `@x-ray/jira` — does **not** exist on npm (404). The doc must remove this entry.
- `node-jira` — exists at v0.2.0, legacy, last published years ago, v2 API only. Accurately characterized.

**Alternative worth noting:** `jira-client@8.2.2` (package `jira-client`, repo `jira-node/node-jira-client`) also exists, is more widely depended upon, and the doc does not mention it at all. Not a blocker but the alternatives section is incomplete.

---

### 2. SDK Capabilities — Overstated

**Claim (Section 12.3 Pros):**
- "Handles pagination utilities"
- "Automatic retry with backoff"

**What is true:** Inspecting `jira.js@5.3.1` `dist/esm/clients/baseClient.mjs`:

- **Pagination:** There is no auto-paginate helper. The package exposes paginated endpoint wrappers (e.g. `getDashboardsPaginated`) with `startAt`/`maxResults` parameters, but there is no `.paginate()` iterator or equivalent that fetches all pages automatically. The caller must loop manually.
- **Automatic retry with backoff:** The `baseClient` delegates to axios with no retry interceptor. There is no retry logic in the package. The caller is responsible for 429/5xx handling.
- **Webhook signature verification:** No helper exists in the package. The webhook module only wraps the registration/deletion/refresh API endpoints, not inbound signature verification.

**Impact:** MEDIUM. If the connector adopts `jira.js` expecting automatic pagination and retry, those must still be implemented by the connector author. The doc should either correct the SDK capability list or explicitly note these as connector-owned responsibilities.

**TypeScript types:** This claim is accurate. The package ships full `.d.ts` files for v2 and v3 API shapes, including request parameters and response models.

---

### 3. SDK Dependency Weight

`jira.js@5.3.1` has three runtime dependencies: `axios`, `mime-types`, and `zod`.

- `axios` unpacked size: ~2.4 MB. If the wider project already uses `axios`, this is free. If not, it is a heavy transitive dep to pull in for a connector.
- `zod` is already used in `packages/contracts`, so no new dep.
- `mime-types` is trivial.

**Assessment:** If the project already includes `axios` (check `package.json` at monorepo root), this is a non-issue. If not, a raw `fetch` implementation would be lighter. The doc's alternative "For MVP with minimal dependencies: use raw fetch" is the correct recommendation if `axios` is not already present.

---

### 4. Raw Fetch vs SDK Recommendation — Internally Contradictory

**Claim (Section 12.3):** The doc recommends `jira.js`, then immediately says "For MVP with minimal dependencies: use raw fetch."

**Problem:** The section presents both options as equivalent alternatives without resolving which one the connector should actually adopt. This leaves the implementation path ambiguous. One recommendation must be chosen as the default, with the other documented as a named trade-off.

**Suggested resolution:** Given that the SDK overstates its capabilities (no auto-retry, no auto-pagination), and Jira Cloud REST is well-documented with stable JSON shapes, a typed `fetch` client is the more honest MVP path. The doc should commit to that and note `jira.js` as a Phase 2 option if TypeScript coverage becomes a priority over bundle size.

---

### 5. Webhook Registration — Two Different APIs, Not Clearly Distinguished

**Claim (Section 3.1):** Uses `POST /rest/webhooks/1.0/webhook` for "admin-configured webhooks" and `POST /rest/api/2/webhook` for "OAuth/Connect apps."

**What is true:** These are two genuinely different Jira webhook systems:
- `/rest/webhooks/1.0/webhook` — the older global webhook admin API, requires admin auth, webhooks do not expire. Supported in both Cloud and Data Center.
- `/rest/api/3/webhook` (not v2) — dynamic webhooks for OAuth and Connect apps, expire after 30 days, subject to the 5-per-user or 100-per-app quota limits.

**Issues:**
- The MVP endpoint list (Section 11) uses `POST /rest/api/3/webhooks/1.0/webhook` — this path does not exist. The correct admin path is `/rest/webhooks/1.0/webhook` (without the `/rest/api/3/` prefix). This is a copy-paste error that would produce a 404 at runtime.
- The doc recommends admin webhooks for MVP (no OAuth required) but mixes in the `/rest/api/2/webhook` path (which is the dynamic endpoint and requires OAuth scope `manage:webhook:jira`). The two systems have different auth requirements and are not interchangeable.

**Impact:** HIGH. The incorrect endpoint path in Section 11 will break webhook registration on first use.

---

### 6. Admin Config Fields — Missing `instanceType`

**Doc lists (Section 11 MVP config):**
```
baseUrl, email, apiToken, defaultProject, webhookSecret, jqlFilter
```

**Missing field:** The doc describes two distinct API surfaces (Cloud vs Data Center) with different auth methods, API paths, rate limits, and user identity shapes. There is no config field for the tenant to declare which variant they are running. Without an `instanceType` (or equivalent) field:
- The connector cannot know whether to use Basic Auth (API token) or PAT
- The connector cannot know which user identity field to use (`accountId` vs `key`)
- Rate limit handling cannot be toggled (Cloud-only)

**Recommendation:** Add `instanceType: 'cloud' | 'data-center'` to the MVP config field list. This is an operational decision made at setup time, not at runtime.

---

### 7. Phase 2 Delivery Ops — Outside Shared Contract, Not Flagged

**Doc proposes for Phase 2 (Section 11):**
- Mention users in comments
- Assign/unassign users
- Set priority
- Attach files
- Worklog (track time spent)

**What the shared contract actually supports** (`packages/contracts/src/skill-run-result.ts`):
```typescript
DeliveryOp =
  | { kind: 'comment'; body: string; visibility?: ... }
  | { kind: 'labels'; add?: string[]; remove?: string[]; visibility?: ... }
  | { kind: 'state'; change: 'close' | 'reopen' | ...; visibility?: ... }
  | { kind: 'pr'; spec: PrSpec; visibility?: ... }
```

**Problem:** Assign, set priority, attach files, and worklog are not in `DeliveryOpSchema`. Adding them requires a contract change — a zod union variant addition. The doc proposes these as straightforward Phase 2 connector-side additions, but they require coordinated changes across `packages/contracts`, the delivery worker, and possibly the admin panel LLM prompt that generates skill results. This is not a Jira-connector-only change.

**Impact:** MEDIUM. Not blocking MVP, but Phase 2 planning that assumes connector-only changes will be blocked by a cross-package contract change. Flag this in Open Questions.

---

### 8. ADF Handling — Not Addressed as an Implementation Burden

**What the doc says:** Good documentation of ADF format in Sections 4, 10.3, and Appendix C.

**What the doc does not say:** Building ADF output from plain text or markdown is non-trivial. If LLM-generated triage comments arrive as Markdown strings (which the existing skill result format implies — `CommentDeliveryOpSchema.body: z.string()`), the connector must convert Markdown to ADF before posting. Atlassian provides a reference library (`@atlaskit/adf-utils`, `@atlaskit/editor-json-transformer`) but these are heavy packages tied to the Atlassian design system. A minimal Markdown-to-ADF converter is approximately 100–200 lines of custom code.

**Impact:** MEDIUM. This is a required implementation task for the comment delivery op and is not called out anywhere in the doc. The risk is the connector posting raw Markdown strings that render as literal asterisks in Jira.

---

### 9. Build Plan Phasing — Mostly Realistic

**MVP:** API token auth, polling + webhooks, basic issue and comment ops. Unblocked by OAuth. Ordering is correct.

**Phase 2:** Bulk create, user search, priority/status lists, attachments, mention detection. Reasonable extensions.

**Phase 3:** Jira Expressions, Service Management portal, SLA, issue links. Appropriate deferral.

**One concern:** Section 11 MVP trigger matchers include "Priority change" and "Assignee change." Matching these from webhook payloads requires parsing the `changelog.items` array (field-level change log in `jira:issue_updated`). This is not mentioned as an implementation requirement. The `changelog` structure is shown in Appendix B but the trigger-matching logic that reads it is implied, not specified.

---

### 10. Open Questions — Mostly Correct, One Structural Gap

**Strong items:** Questions 1 (hosting model), 3 (webhook registration admin access), 7 (JSM vs Jira Software), and 9 (bot vs user identity for comment attribution) are genuine deployment and operational blockers.

**Structural gap:** Questions 5 (custom fields), 6 (workflow complexity), and 8 (multi-project) are feature scoping decisions, not deployment blockers. They should be moved to a "Scoping Decisions" subsection.

**Missing operational blocker:** Per-tenant webhook URL provisioning. Unlike GitHub where `gh` manages webhook lifecycle, Jira webhooks are registered via API and require a publicly accessible HTTPS endpoint. For self-hosted or private SupportAgent deployments, who owns and provisions the inbound URL? This is the same deployment question flagged in the GitHub Issues SDK review and needs to be raised here as well.

---

### 11. Cross-Connector Delivery Abstraction — Consistent for MVP

The MVP delivery ops (comment on issue, label add/remove via `update.labels`, state transition) map cleanly to the existing `comment`, `labels`, and `state` delivery op kinds. The ADF serialization burden is connector-internal and does not change the op contract shape.

No synchronous vs async delivery divergence. No proposed op that would require a new contract kind at MVP scope.

---

## Summary Table

| # | Area | Severity | Claim in Doc | Actual / Action |
|---|---|---|---|---|
| 1 | `jira.js` GitHub URL | LOW | `MrBomberman/jira.js` | Correct repo is `MrRefactoring/jira.js` — update link |
| 1a | `@x-ray/jira` listed | LOW | Exists as community SDK | 404 on npm — remove from doc |
| 2 | SDK auto-pagination | MEDIUM | "Handles pagination utilities" | No auto-paginate; caller must loop manually |
| 2a | SDK auto-retry | MEDIUM | "Automatic retry with backoff" | No retry logic in package |
| 2b | SDK webhook verification | MEDIUM | Implied by webhook module listing | Webhook module only covers registration API, not HMAC verification |
| 3 | SDK transitive deps | LOW | Not flagged | `axios` ~2.4 MB; check if already in monorepo |
| 4 | Raw fetch vs SDK | LOW | Both recommended equally | Commit to one path; raw fetch is more honest for MVP given SDK gaps |
| 5 | Webhook admin endpoint in MVP list | HIGH | `POST /rest/api/3/webhooks/1.0/webhook` | Invalid path — correct is `POST /rest/webhooks/1.0/webhook` (no `/rest/api/3/` prefix) |
| 6 | Config field `instanceType` | HIGH | Not listed | Required for Cloud vs Data Center branching in auth, identity, rate limits |
| 7 | Phase 2 delivery ops vs contract | MEDIUM | Assign, priority, attach as connector additions | Require `DeliveryOpSchema` changes in `packages/contracts` — cross-package work |
| 8 | ADF from Markdown | MEDIUM | Not mentioned | Required conversion step for comment delivery; no trivial solution |
| 9 | Changelog-based trigger matching | LOW | Triggered on priority/assignee change | Requires parsing `changelog.items` — implementation burden not specified |
| 10 | Open Questions structure | LOW | Mixes blockers and scoping decisions | Separate into operational blockers vs scoping decisions |
| 11 | Webhook URL provisioning | MEDIUM | Not raised | Add as operational blocker — how is inbound HTTPS endpoint provisioned? |
| 12 | Cross-connector delivery consistency | PASS | MVP ops match contract | No divergence at MVP scope |

---

## Priority Actions

1. **Fix webhook registration path** in Section 11 MVP endpoint list: `POST /rest/webhooks/1.0/webhook` (remove the `/rest/api/3/` prefix).
2. **Add `instanceType: 'cloud' | 'data-center'` to MVP config fields** — required before the connector can branch on auth method and identity shape.
3. **Correct `jira.js` GitHub URL** to `MrRefactoring/jira.js` and remove `@x-ray/jira` (does not exist on npm).
4. **Correct SDK capability claims**: remove "automatic retry" and "pagination utilities" — neither exists in v5.3.1. Add a note that the connector must implement retry and pagination manually regardless of which path is chosen.
5. **Flag ADF conversion as a required MVP implementation task** for the comment delivery op.
6. **Flag Phase 2 delivery op additions as requiring `packages/contracts` changes**, not connector-only work.
7. **Add webhook URL provisioning to Open Questions** as an operational blocker.
