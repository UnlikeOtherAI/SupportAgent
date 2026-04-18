# Linear Connector — SDK Audit Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, build plan realism, config field alignment, cross-connector consistency.

---

## Verdict: APPROVED WITH CORRECTIONS

The document is well-researched and technically accurate. One config field mismatch, one SDK export name discrepancy, and one incomplete polling fallback detail need correction before implementation.

---

## Findings

### 1. npm Package Existence — VERIFIED

| Package | Status | Notes |
|---|---|---|
| `@linear/sdk` | ✅ Exists (v82.0.0) | Main SDK, confirmed via npm |
| `@linear/sdk/webhooks` | ✅ Exists as sub-export | Confirmed via `exports` map in npm package |
| `@linear/cli` | ⚠️ Exists (v0.0.5) but unmaintained | The doc correctly dismisses CLI parity. Correct. |

No phantom packages detected.

---

### 2. SDK Sub-Export `@linear/sdk/webhooks` — VERIFIED

The doc references `LinearWebhookClient` from `@linear/sdk/webhooks`. This export exists:
- Path: `@linear/sdk/webhooks`
- Maps to: `./dist/webhooks/index.mjs` / `./dist/webhooks/index.cjs`
- Confirmed via `npm view @linear/sdk exports`

**Correct export in doc**:
```typescript
import { LinearWebhookClient } from "@linear/sdk/webhooks";
```

---

### 3. Webhook SDK Export Names — DISCREPANCY

The doc references:

```
LINEAR_WEBHOOK_SIGNATURE_HEADER = "linear-signature"
LINEAR_WEBHOOK_TS_HEADER = "linear-timestamp"
```

The Linear developer docs mention `LINEAR_WEBHOOK_TS_FIELD` (not `HEADER`). The actual constants exported from `@linear/sdk/webhooks` may differ from what the doc assumes. The doc should be explicit:

**Recommendation**: Add a note that the constant names should be verified against the installed SDK version, or define the literal string values directly rather than importing magic constants that may change between SDK versions. The literal header names `linear-signature` and `linear-timestamp` are stable Linear API contracts and safe to hardcode.

---

### 4. SDK Pagination Helpers — MISSING

The doc describes cursor-based pagination using Relay Connections fields (`first`, `after`, `pageInfo`) and shows the query pattern. It does **not** claim the SDK has pagination helper utilities — this is accurate. The `@linear/sdk` exposes typed query/mutation classes but does not provide a `paginate()` helper or similar utility.

**This is correct**: connector code must implement cursor iteration manually:
```typescript
async function* paginateIssues(linear, filter) {
  let cursor: string | undefined;
  do {
    const { data } = await linear.query(QUERY, { first: 50, after: cursor, filter });
    yield* data.issues.nodes;
    cursor = data.issues.pageInfo.hasNextPage
      ? data.issues.pageInfo.endCursor
      : undefined;
  } while (cursor);
}
```

No correction needed; the doc correctly implies manual pagination.

---

### 5. SDK Retry Handling — CORRECTLY ABSENT

The doc references `LinearErrorType.Ratelimited` from `@linear/sdk` for catching rate-limit errors. This is accurate — the SDK surfaces GraphQL errors with typed `type` fields but does **not** have built-in automatic retry with backoff.

The doc correctly shows the pattern for manual retry:
```typescript
if (error.type === LinearErrorType.Ratelimited) {
  // wait and retry
}
```

**No SDK retry helper exists**. The doc is accurate. The Phase 2 open question (#6: retry strategy) is the correct place for this decision.

---

### 6. Raw Fetch vs SDK Recommendation — COHERENT

Section 12 states:
- **Prefer raw `fetch`** for connector GraphQL operations — correct
- **Use `@linear/sdk/webhooks`** for signature verification — correct

**Rationale is sound**: `@linear/sdk` is auto-generated from the GraphQL schema and ships 1054+ exported classes. Using raw `fetch` with typed query strings is lighter and more controllable. The webhook verification is a narrow, well-tested surface area where the SDK is worth using.

**Cross-reference with GitHub connector**: The `github_issues.md` doc uses the same pattern — raw `fetch` for API operations, no SDK for webhook verification (they reimplement HMAC verification manually, which is fine for the simple `sha256=` pattern). The Linear doc's approach of using `@linear/sdk/webhooks` is actually **more correct** than GitHub's manual HMAC reimplementation.

**No contradiction** detected between connectors.

---

### 7. CLI Parity Claim — ACCURATE

Section 12 states "Linear does not have a CLI equivalent to `gh`." There IS a `@linear/cli` on npm (v0.0.5), but:

- It is essentially unmaintained (v0.0.5, last publish years ago)
- It does not expose issue/comment CRUD equivalent to what the connector needs
- It cannot replace programmatic API access for connector operations

**The doc is correct in spirit**. If the review process demands precision: note that `@linear/cli` exists but is not a viable equivalent to `gh` for connector operations.

---

### 8. Build Plan Phase Ordering — REALISTIC

| Phase | Blocking on OAuth? | Notes |
|---|---|---|
| MVP (PAT + webhooks) | No — uses PAT | Correct |
| Phase 2 (OAuth, custom fields, polling) | OAuth added later | Correct — OAuth is additive |
| Phase 3 (AI integration, GitHub sync, SLA) | No | Correct |

**MVP does not block on OAuth**. PAT is sufficient. OAuth is correctly deferred to Phase 2. Phase 3 features (Linear AI, GitHub PR sync) are correctly marked advanced.

---

### 9. Config Fields — PARTIAL MISMATCH

**Platform registry defines 4 fields for Linear**:

| Registry key | Label | Type |
|---|---|---|
| `api_key` | API Key | password |
| `team_id` | Team ID | text |
| `project_id` | Project ID | text (optional) |
| `webhook_secret` | Webhook Secret | password (optional) |

**Doc MVP config lists 5 fields**:

| Doc field | In registry? |
|---|---|
| `LINEAR_API_KEY` | ✅ (`api_key`) |
| `LINEAR_TEAM_ID` | ✅ (`team_id`) |
| `LINEAR_PROJECT_ID` | ✅ (`project_id`) — implied by "project" in `issueCreate` input |
| `LINEAR_WEBHOOK_SECRET` | ✅ (`webhook_secret`) |
| `LINEAR_WORKSPACE_URL` | ❌ Missing from registry |
| `LINEAR_APP_USER_ID` | ❌ Missing from registry |

**Action required**: Add `LINEAR_WORKSPACE_URL` and `LINEAR_APP_USER_ID` to `platform-registry.ts` Linear entry before implementation, or remove them from the doc's MVP scope. Both are operationally necessary:
- `LINEAR_WORKSPACE_URL` is used to construct issue URLs in webhook payloads
- `LINEAR_APP_USER_ID` is required for `no_self_retrigger` via `botActor.id` comparison

---

### 10. Polling Fallback — INCOMPLETE

Section 3 (Polling Fallback) describes the `updatedAt`-based query pattern correctly:

```graphql
filter: { updatedAt: { gte: "<ISO timestamp>" } }
```

However, Gotcha #4 in Section 10 mentions a "-5m lookback" solution for clock skew, but this window is never explained in the polling section. The doc should explicitly state:

> **Recommended lookback window**: When polling, set `updatedAt` filter to `now() - 5 minutes` to account for clock skew between our system and Linear. Events may arrive slightly out of order.

This ensures the polling fallback is actually usable without silent event loss.

---

### 11. Cross-Connector Consistency — CONSISTENT

Linear connector follows the same structural pattern as GitHub connector:

| Aspect | GitHub | Linear | Consistent? |
|---|---|---|---|
| Direction | `both` | `both` | ✅ |
| Intake mode | webhook | webhook | ✅ |
| Auth for MVP | Fine-grained PAT | PAT | ✅ |
| Outbound ops | GraphQL mutations | GraphQL mutations | ✅ |
| Delivery adapter | POST JSON | POST JSON | ✅ |

**No abstract conflict**. Both connectors use a webhook receiver → normalize → delivery adapter pattern. The delivery adapter abstraction is not violated.

---

### 12. Open Questions — APPROPRIATE

| Question | Status |
|---|---|
| OAuth vs PAT for MVP | ✅ Correctly deferred to product decision |
| Custom field schema | ✅ Correctly flagged as tenant-dependent |
| Webhook endpoint availability | ✅ Correctly flagged (per-tenant vs shared) |
| Workspace vs team scoping | ✅ Correctly scoped to single team for MVP |
| Rate limit retry strategy | ✅ Correctly deferred to implementation |
| Comment threading depth | ✅ Correctly flagged |

**Notable absence**: The doc does not flag `LINEAR_WORKSPACE_URL` and `LINEAR_APP_USER_ID` as registry gaps — these should be added to the open questions or treated as MVP requirements that need registry updates.

---

## Summary of Required Changes

| # | Location | Issue | Severity |
|---|---|---|---|
| 1 | Section 12 (Dependencies) | `LINEAR_WORKSPACE_URL` and `LINEAR_APP_USER_ID` missing from platform-registry | Medium |
| 2 | Section 12 (Dependencies) | Webhook export constants may differ from `LINEAR_WEBHOOK_TS_HEADER` naming | Low |
| 3 | Section 3 (Polling Fallback) | "-5m lookback" mentioned in gotcha but not explained in polling section | Low |
| 4 | Section 12 (Dependencies) | `@linear/cli` exists (v0.0.5) but is correctly dismissed — add footnote for precision | Very Low |

Items 1 and 3 should be resolved before implementation. Items 2 and 4 are minor.
