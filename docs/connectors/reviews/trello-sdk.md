# Trello Connector — SDK and Implementation Review

**Reviewer scope:** npm packages, SDK capabilities, build plan realism, admin config fields, cross-connector delivery abstraction, trigger/action/output kinds.
**Source:** `docs/connectors/trello.md`
**Checked:** 2026-04-18

---

## Verdict

**Conditional pass.** The npm package reality, raw-fetch recommendation, and build plan phasing are all sound. The admin panel config list diverges significantly from `platform-registry.ts` — the doc proposes rich per-board config that the registry doesn't yet expose. The Open Questions section lists feature decisions rather than deployment/operational blockers. Cross-connector delivery ops are structurally consistent, but the current `delivery-resolver-service.ts` only dispatches to GitHub platforms — Trello needs a new code path.

---

## Findings

### 1. npm Package Verification — PASS WITH CLARIFICATION

**Packages checked:**

- `trello` — **EXISTS**, v0.11.0, last published ~2016. MIT licensed. Dependencies: `restler@~3.3.0`, `es6-promise@~3.0.2`, `object-assign@~4.1.0`. **No TypeScript types.** Engine spec `>= 0.10.x` signals the package has been unmaintained for years. `restler` itself is deprecated. This is abandonware.
- `trello-api-client` — **DOES NOT EXIST** on npm. The doc mentions it as a third-party option but it has never been published. The only real package is `trello` (v0.11.0).

**What the doc assumes:** Two third-party packages exist as options. No official Atlassian SDK.

**What is actually true:** Only one package (`trello`) exists, and it's abandonware. No official Atlassian Trello SDK. Raw fetch is the correct default.

**Recommendation:** Remove `trello-api-client` from the doc entirely (it doesn't exist). Acknowledge the `trello` package as unmaintained abandonware (last update ~2016, `restler` dep, no TS types). Raw fetch is still the right call.

---

### 2. Raw Fetch vs SDK Recommendation — COHERENT

**Claim:** Use raw `fetch` with typed helpers. No official Atlassian Trello SDK.

**What is true:** Correct. No official Atlassian SDK exists for Trello. The only npm package (`trello` v0.11.0) is abandonware with deprecated deps. The API is simple REST with query params — straightforward to wrap manually.

**SDK helpers check:**
| Helper | Exists in `trello` pkg | Needed for MVP |
|--------|------------------------|----------------|
| TypeScript types | No | Yes — must define manually |
| Webhook verification | No | Yes — must implement HMAC-SHA1 |
| Pagination helpers | No | Yes — offset-based `page` + `limit` |
| Retry handling | No | Yes — no rate limit headers, fixed delay |

**Assessment:** PASS. The doc correctly identifies the gap and recommends raw fetch. Manual implementation of all helpers is required — this should be scoped as explicit MVP tasks, not assumed.

---

### 3. CLI Parity — PASS

**Claimed:**
- No `trello` CLI equivalent to `gh` (GitHub CLI)
- Trello has no server-side CLI for webhook management
- Our connector must manage webhooks via API

**What is true:** Correct. Trello has no CLI tool for API operations or webhook management. No package on npm provides CLI-level access. The doc is accurate.

---

### 4. Admin Panel Config Fields — HIGH MISMATCH

**Doc lists (Section 11.1, Minimum admin panel config):**
```typescript
{
  apiKey: string;
  apiToken: string;
  boardIds: string[];           // boards to monitor (string array)
  listNameToStatus: map;        // list name → canonical status
  labelNameToPriority: map;     // label name → canonical priority
  botUsername: string;           // for no_self_retrigger
  webhookCallbackUrl: string;   // your endpoint
  enabled: boolean;
}
```

**Actual registry** (`packages/contracts/src/platform-registry.ts`, `trello` entry):
```typescript
configFields: [
  { key: 'api_key',        type: 'password', required: true,  secretType: 'api_key' },
  { key: 'api_token',      type: 'password', required: true,  secretType: 'api_token' },
  { key: 'board_id',       type: 'text',     required: false },  // single board, not array
  { key: 'webhook_secret', type: 'password', required: false,  secretType: 'webhook_secret' },
]
```

**Gaps:**

| Doc Field | Registry Field | Status |
|-----------|---------------|--------|
| `apiKey` | `api_key` | Naming only (semantics align) |
| `apiToken` | `api_token` | Naming only (semantics align) |
| `boardIds` | `board_id` | **MEDIUM** — doc has array, registry has single value |
| `listNameToStatus` | **MISSING** | HIGH — required for status normalization |
| `labelNameToPriority` | **MISSING** | HIGH — required for priority mapping |
| `botUsername` | **MISSING** | HIGH — needed for no_self_retrigger |
| `webhookCallbackUrl` | **MISSING** | MEDIUM — connector-level, not admin-config |
| `enabled` | **MISSING** | LOW — likely connector-level toggle |

**Impact:** HIGH. The registry has a minimal config. The doc proposes rich per-board normalization. Implementation must reconcile:

1. `board_id` → change to `board_ids` (string array) in registry
2. Add `list_name_to_status` and `label_name_to_priority` config fields (or document them as tenant-level routing config outside the connector setup)
3. Add `bot_username` for no_self_retrigger
4. `webhook_callback_url` is deployment-level (owned by the platform), not per-tenant config — clarify this

---

### 5. Trigger Kinds — No Existing Contracts Yet

**Doc proposes for MVP:** `createCard`, `commentCard`, `updateCard`, `addLabelToCard`, `removeLabelFromCard`, `addMemberToCard`, `removeMemberFromCard`, `moveCardToList`.

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

**Assessment:** PASS. Trello trigger kinds will require new entries. The doc correctly proposes platform-prefixed naming (e.g., `trello.card.created`, `trello.card.comment`). No naming conflict with GitHub triggers (different platform prefix). New `TriggerKind` entries are needed — plan this in the trigger registry before implementation.

---

### 6. Delivery Ops — Consistent Structure, GitHub-Only Dispatch

**Doc proposes:** `comment` (post comment), `labels` (add/remove labels), `state` (close/archive card, move to list).

**Contract in `scenario.ts`:**
```typescript
export type OutputKind =
  | 'github.issue.comment'
  | 'github.pr.comment'
  | 'github.issue.label'
  | 'linear.issue.create'
  | 'slack.notify';
```

**Delivery ops from `delivery-resolver-service.ts`:**
```typescript
type DeliveryOp =
  | { kind: 'comment'; body: string; visibility?: 'public' | 'internal' }
  | { kind: 'labels'; add?: string[]; remove?: string[]; visibility?: 'public' | 'internal' }
  | { kind: 'state'; change: 'close' | 'reopen' | 'merge' | 'request_changes' | 'approve'; visibility?: 'public' | 'internal' }
  | { kind: 'pr'; spec: PrSpec; visibility?: 'public' | 'internal' };
```

**Structural assessment:** PASS. Trello's outbound ops (`comment`, `labels`, `state: close/reopen`, `state: merge` for PR counterparts) map cleanly to the existing `DeliveryOp` contract.

**However:** `delivery-resolver-service.ts:466` hard-codes GitHub:
```typescript
if (connectorTarget.platformKey !== 'github' && connectorTarget.platformKey !== 'github_issues') {
  await prisma.actionDeliveryAttempt.update({ where: { id: attempt.id }, data: { status: 'failed', error: `Unsupported connector platform: ${connectorTarget.platformKey}`, ... } });
}
```

**Gap:** HIGH. Trello delivery ops would fail immediately against this guard. A Trello-specific dispatch branch (or generalized connector dispatch) is required before Trello outbound ops can work. This is not a doc deficiency — it's an architectural gap the implementation must address.

---

### 7. Build Plan Phasing — Realistic

**MVP:** API key + long-lived token (`never` expiry), per-board webhook registration on 7 event types, polling fallback, HMAC-SHA1 verification.

**Phase 2:** OAuth2 3LO flow, custom fields, checklists, attachments, batch/search endpoints, organizations.

**Phase 3:** Board templates, Butler automation, card covers.

**Assessment:** PASS. MVP uses the simplest auth (API key + token, no OAuth callback), webhook-first with polling fallback. No MVP features blocked on Phase 2/3. OAuth2 3LO in Phase 2 is correctly deferred — it requires Atlassian OAuth app registration per tenant.

**Note:** Webhook registration is per-board (not per-org). If a tenant has 10+ boards, this is a scaling concern. The doc mentions this in Gotcha 10.12 and Open Question Q2, but doesn't propose a solution. This is acceptable for an MVP spec but the implementation should design for webhook lifecycle management (create on board add, delete on board remove).

---

### 8. Open Questions — Wrong Category

**Current Open Questions (Section 13):**
1. Power-Up custom fields?
2. How many boards per tenant?
3. Multi-workspace support?
4. Label color vs name for matching?
5. Token provisioning UX?
6. Comment edit support?
7. Atlassian Enterprise?

**Problem:** All items are **feature scoping decisions** or **tenant configuration questions**. No operational blockers are raised.

**What's missing (operational blockers):**
- **Per-tenant API key + token provisioning**: Each tenant needs their own Trello API key (per workspace) + long-lived token. Is this provisioned manually by the tenant, or do we walk them through `trello.com/app-key`? Is there an Atlassian Connect / OAuth2 flow that automates this in Phase 2?
- **Webhook URL ownership**: The callback URL must be public HTTPS. For self-hosted SupportAgent deployments, who owns the public endpoint? For cloud-hosted, is there a shared webhook ingestion URL or per-tenant subdomains?
- **Multi-board webhook management**: Webhooks are per-board. Tenants with 20+ boards need automated webhook lifecycle (create when board added, prune when board removed). No org-level webhook exists.
- **IP allowlisting**: Trello webhooks originate from `104.192.142.240/28`. Tenants who self-host need to whitelist this range on their edge.
- **Atlassian OAuth2 app registration for Phase 2**: OAuth2 3LO requires each tenant to register an Atlassian app under their Atlassian account. What's the onboarding UX? Who owns the app registration — SupportAgent as a platform, or each tenant?

---

### 9. Cross-Connector Delivery Abstraction — Structural Gap

The doc correctly maps Trello ops to the `DeliveryOp` contract. However:

1. `delivery-resolver-service.ts` only dispatches to GitHub. Trello needs a new dispatch branch.
2. The `OutputKind` enum (`github.issue.comment`, `github.pr.comment`, etc.) has no Trello equivalents. Should Trello have `trello.card.comment`? Or does all Trello output use the generic `DeliveryOp` interface without a new `OutputKind` entry?
3. The `ConnectorTarget` resolution uses `parseGitHubRef` for `owner`/`repo` — these fields are Trello-specific (`boardId`/`cardId`).

**This is not a doc bug.** The doc correctly follows the contract. The gap is in the delivery service, which needs a Trello code path before outbound ops can work.

---

### 10. No Licensing or Transitive Dep Concerns

Raw fetch has no dependency risk. No Atlassian Forge SDK is used. No heavy transitive deps. No concerns.

---

## Summary Table

| # | Area | Severity | Claim in Doc | Correct Value / Action |
|---|---|---|---|---|
| 1 | npm packages | LOW | `trello-api-client` as option | E404 — does not exist. `trello` v0.11.0 is abandonware. Remove `trello-api-client`. |
| 2 | Raw fetch vs SDK | PASS | Use raw fetch | Correct — no compelling SDK exists |
| 3 | CLI parity | PASS | No Trello CLI | Correct |
| 4 | Admin config fields | HIGH | Rich per-board config | Add `board_ids` (array), `list_name_to_status`, `label_name_to_priority`, `bot_username` to registry |
| 5 | Trigger kinds | OK | Platform-prefixed naming | New `TriggerKind` entries needed (`trello.card.*`) |
| 6 | Delivery ops | PASS | `comment`, `labels`, `state` | Matches contract structure |
| 6b | Delivery dispatch | HIGH | — | `delivery-resolver-service.ts` hard-codes GitHub; Trello dispatch path required |
| 7 | Build phasing | PASS | MVP → Phase 2 → Phase 3 | Realistic ordering, MVP unblocked |
| 8 | Open questions | MEDIUM | Feature scoping questions | Re-categorize: add operational blockers (per-tenant API key provisioning, webhook URL ownership, multi-board webhook management, IP allowlisting, Atlassian OAuth2 app registration) |
| 9 | Cross-connector delivery | MEDIUM | Structurally consistent | Delivery service needs Trello code path; `ConnectorTarget` resolution uses GitHub-ref fields |
| 10 | Licensing/transitive deps | PASS | Raw fetch only | No concerns |

---

## Priority Actions

1. **Remove `trello-api-client`** from Section 12.1. The package doesn't exist. Acknowledge `trello` v0.11.0 as abandonware but confirm raw fetch is preferred.
2. **Reconcile Trello config fields with `platform-registry.ts`**: Add `board_ids` (string array, replaces `board_id`), `list_name_to_status`, `label_name_to_priority`, `bot_username`. `webhook_callback_url` should be clarified as a platform/deployment config, not per-tenant connector config.
3. **Add Trello dispatch path to `delivery-resolver-service.ts`**: The service currently guards on `platformKey !== 'github'`. Trello needs its own `dispatchTrelloOp` branch. Until then, all Trello outbound ops fail with "Unsupported connector platform."
4. **Define `OutputKind` entries for Trello** (or confirm generic `DeliveryOp` is sufficient without new enum entries).
5. **Update Open Questions**: Lead with operational blockers: per-tenant API key provisioning UX, webhook URL ownership (who owns the public HTTPS endpoint), multi-board webhook lifecycle management, IP allowlist (`104.192.142.240/28`), Atlassian OAuth2 app registration for Phase 2.
6. **Document pagination burden**: Offset-based `page` + `limit` must be implemented manually. Actions default 50/page, max 1000. Board cards have no pagination param (returns all open cards). Emphasize this as required MVP work.
7. **Plan webhook lifecycle management**: MVP registers webhooks per-board. For tenants with many boards, plan: webhook creation on board add, webhook deletion on board remove, webhook listing to detect drift.