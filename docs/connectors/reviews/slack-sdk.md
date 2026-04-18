# Slack Connector — SDK & Implementation Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, build plan realism, config field alignment, cross-connector consistency.
**Source:** `docs/connectors/slack.md`
**Date:** 2026-04-18

---

## Verdict: APPROVED WITH CORRECTIONS

The document is technically accurate and the build plan is realistic. One critical gap: Slack is missing from `platform-registry.ts` — the admin panel has no registration for it. The config field list assumes a registry entry that does not exist. Additionally, the recommendation to "use raw `fetch` for outbound-only workers" is underspecified, and the `conversations.replies` rate limit severity needs explicit architectural guidance.

---

## Findings

### 1. npm Package Existence — ALL VERIFIED

| Package | Version | Status | Notes |
|---|---|---|---|
| `@slack/web-api` | 7.15.1 | ✅ Exists | Core REST client, confirmed via npm |
| `@slack/bolt` | 4.7.0 | ✅ Exists | Framework with Events API handling |
| `@slack/oauth` | 3.0.5 | ✅ Exists | OAuth installation helpers |

No phantom packages. All three SDK packages are maintained by `slackhq` on npm.

---

### 2. SDK Capabilities — VERIFIED

**TypeScript types:** `@slack/web-api` ships bundled types. No separate `@types` package needed. Correct.

**Webhook verification helpers:** `@slack/bolt`'s `App` class handles signature verification internally when `signingSecret` is provided to the constructor. The doc shows manual HMAC verification in Section 3 — this is correct for a lightweight webhook receiver that doesn't need the full Bolt framework. The manual snippet using `crypto.timingSafeEqual` is correct.

**Pagination helpers:** `@slack/web-api` includes built-in cursor-based pagination via `cursor`/`response_metadata.next_cursor`. The doc shows the correct pattern in Section 9. Confirmed.

**Retry handling:** `@slack/web-api` uses `p-retry` and `p-queue` internally. The SDK handles rate limit responses (`retry_after`) automatically for most methods. The doc correctly notes that the 1 req/min limit on `conversations.replies` is a special case that requires **explicit client-side throttling** — this is not handled by the SDK's default retry logic.

**Auth support:** Both `xoxb-` (bot token) and `xoxp-` (user token) are supported via the SDK's `token` constructor option. Correct.

---

### 3. Raw Fetch vs SDK Recommendation — INCOMPLETE

Section 12 states:

> Use raw `fetch` for outbound-only workers (smaller bundle).

This is the right instinct but underspecified. The doc should clarify:

```typescript
// When to use @slack/bolt (MVP):
// - Webhook receiver + Events API handling
// - Slash commands, interactive components
// - First-class TypeScript types for all event shapes

// When to use @slack/web-api only:
// - Outbound-only workers (postMessage, reactions)
// - No inbound event handling needed

// When to use raw fetch:
// - Bundle-sensitive contexts where @slack/web-api's 12 dep count is problematic
// - Simple outbound operations without retry/pagination needs
```

The current phrasing implies raw `fetch` is a universal alternative — it's not. `@slack/web-api` adds automatic retry, rate limit backoff, and pagination helpers that raw `fetch` lacks. The trade-off should be explicit: use raw `fetch` only when the bundle size constraint outweighs the reliability features.

---

### 4. No CLI — CORRECT

Section 12 says "Slack has no CLI equivalent to GitHub's `gh`." This is correct. Unlike GitHub (which has a mature `gh` CLI for polling fallbacks), Slack has no equivalent. The polling fallback path in Section 3 (using `conversations.history`) must be implemented entirely in code — no CLI shortcut.

---

### 5. Build Plan Phase Ordering — REALISTIC

| Phase | Blocking on OAuth? | Status |
|---|---|---|
| MVP: Bot token + webhook events | No — bot token is a single static token | ✅ Realistic |
| Phase 2: Views, search, Home tab | No — uses same auth, just more methods | ✅ Realistic |
| Phase 3: Slack Connect, workflows | Yes — but correctly deferred | ✅ Realistic |

The Phase 1 → Phase 2 split is correctly ordered. Bot token setup requires no OAuth redirect. Multi-workspace (Phase 3) correctly requires the OAuth installation flow and is deferred appropriately.

---

### 6. Config Fields — CRITICAL GAP: SLACK NOT IN PLATFORM REGISTRY

**The `platform-registry.ts` (`packages/contracts/src/platform-registry.ts`) has no `slack` entry.** The doc's MVP config field list (Section 11) assumes a registry entry that does not exist:

```typescript
interface SlackConnectorConfig {
  botToken: string;           // needs: bot_token, type: password
  signingSecret: string;       // needs: signing_secret, type: password
  botUserId: string;           // needs: bot_user_id, type: text — resolved at startup
  botId: string;               // needs: bot_id, type: text — resolved at startup
  teamId: string;              // needs: team_id, type: text
  defaultChannel: string;     // needs: default_channel, type: text
  monitoredChannels: string[];// needs: monitored_channels, type: text (array)
  dmPolicy: 'allow' | 'block';// needs: dm_policy, type: toggle
  mentionStyle: 'require' | 'allow'; // needs: mention_style, type: toggle
}
```

**Required additions to `platform-registry.ts`**:

| Key | Label | Type | Required | Notes |
|---|---|---|---|---|
| `bot_token` | Bot Token | password | Yes | `xoxb-` prefix |
| `signing_secret` | Signing Secret | password | Yes | From Basic Information |
| `team_id` | Team / Workspace ID | text | Yes | From `auth.test` |
| `default_channel` | Default Channel | text | No | For notifications |
| `monitored_channels` | Monitored Channels | text | No | Comma-separated or JSON array |
| `dm_policy` | DM Policy | toggle | No | `allow` / `block` |
| `mention_style` | Mention Style | toggle | No | `require` / `allow` |

**Note on `bot_user_id` and `bot_id`**: The doc correctly marks these as "resolved at startup" via `auth.test` and `bots.info`. These should **not** be admin-panel config fields — they are runtime-discovered values stored in the connector state. This is a good pattern consistent with other connectors (GitHub stores `bot_login` similarly).

**Cross-reference with existing connectors**: GitHub has 3 config fields, Linear has 4, Jira has 5, Trello has 4. Slack needs 7 — this is reasonable given Slack's multi-channel architecture.

---

### 7. Cross-Connector Consistency — CONSISTENT

Slack connector follows the same pattern as GitHub, Linear, Jira, and others:

| Aspect | GitHub | Linear | Slack | Consistent? |
|---|---|---|---|---|
| Direction | `both` | `both` | `both` (implied) | ✅ |
| Intake mode | webhook | webhook | webhook | ✅ |
| Auth for MVP | Fine-grained PAT | PAT | Bot token | ✅ — equivalent simplicity |
| Outbound ops | REST mutations | GraphQL mutations | REST methods | ✅ |
| Delivery adapter | POST JSON | POST JSON | POST JSON | ✅ |

The doc correctly identifies Slack as `defaultDirection: 'both'` in the implied registry entry. Outbound operations (`chat.postMessage`, `chat.update`, `reactions.add`) map to the delivery adapter's write-back capability. No conflicting abstraction detected.

---

### 8. `@slack/bolt` App-level Token Handling — NOT ADDRESSED

The doc lists App-Level Tokens (`xapp-*`) in Section 2 but the MVP build plan (Section 11) does not use them. This is fine for Phase 1 (bot token is simpler), but the doc should explicitly note that App-Level Tokens are **Phase 3 territory** (for multi-workspace org-level operations). Leaving this in the token types table without context implies it belongs in MVP scope — it does not.

**Recommendation**: Add a note after the token types table:
> **App-Level Token (`xapp-*`)**: Reserved for Phase 3 multi-workspace operations. Not required for MVP.

---

### 9. `conversations.replies` Rate Limit — CRITICAL ARCHITECTURAL FLAG

The doc correctly flags this gotcha (#6 in Section 10) and in the rate limits table:

> `conversations.replies` (non-Marketplace): **1 req/min, max 15**

This is a hard constraint that affects thread reply operations. The doc does not provide an architectural workaround beyond "cache aggressively." The open questions (#5) mention this but the answer is underspecified.

**Recommended guidance** (should appear in Section 11 or a new "Architecture Decisions" subsection):

> **Thread reply fallback**: If the connector needs to fetch thread replies and `conversations.replies` is rate-limited:
> 1. Use `conversations.history` with `thread_ts` filter — this is Tier 3 (50 req/min) and does not have the 1/min cap
> 2. Fall back to `search.messages` with `in:channel thread:YES` for historical thread search
> 3. Do not use `conversations.replies` in the hot path — reserve it for one-time audit operations only

The polling fallback section (Section 3) also uses `conversations.history` correctly but should reference this workaround.

---

### 10. Open Questions — APPROPRIATE

| Question | Status |
|---|---|
| Single vs multi-workspace | ✅ Correctly deferred — MVP: single workspace |
| DM policy | ✅ Correctly flagged — recommendation: `@mention` required |
| Threading strategy | ✅ Correctly flagged — recommendation: reply in thread |
| Reaction signals | ✅ Correctly deferred to Phase 2 |
| `conversations.replies` limit | ✅ Flagged but needs architectural guidance (see #9) |
| Interactive vs slash commands | ✅ Correctly deferred to Phase 2 |
| Token rotation | ✅ Correctly deferred — adds complexity |
| Per-tenant webhook URL | ✅ Correctly recommended — single endpoint, fan out by `team_id` |

The open questions cover the right deployment/operational blockers. The `conversations.replies` question needs a more concrete architectural answer.

---

### 11. Platform Category — COMMUNICATION CHANNEL

The `PlatformRegistryEntry` interface in `platform-registry.ts` uses:

```typescript
category: 'issue-tracker' | 'error-monitoring' | 'version-control' | 'project-management';
```

Slack does not fit any of these categories. A new category is needed:

```typescript
category: 'issue-tracker' | 'error-monitoring' | 'version-control' | 'project-management' | 'communication';
```

This is consistent with the doc's Section 1 overview: "Category: Communication channel." The `PlatformRegistryEntry` type needs updating before Slack can be registered.

---

## Summary of Required Changes

| # | Location | Issue | Severity |
|---|---|---|---|
| 1 | `packages/contracts/src/platform-registry.ts` | Add `slack` entry with 7 config fields | **Critical** — admin panel cannot configure Slack without this |
| 2 | `packages/contracts/src/platform-registry.ts` | Add `'communication'` to `PlatformRegistryEntry.category` type | **Critical** — TypeScript error without this |
| 3 | Section 12 (Dependencies) | Clarify raw-fetch vs SDK recommendation: `@slack/web-api` for reliability, raw `fetch` only for bundle-sensitive contexts | Medium |
| 4 | Section 2 or 11 | Explicitly mark `xapp-*` App-Level Tokens as Phase 3 — not MVP scope | Low |
| 5 | Section 11 or new architecture section | Add explicit `conversations.replies` fallback guidance using `conversations.history` with `thread_ts` filter | Medium |
| 6 | Section 3 (Polling Fallback) | Reference the `conversations.replies` workaround from #5 | Low |

Items 1 and 2 are prerequisites for implementation. Item 3 is a documentation improvement. Items 5 and 6 prevent architectural mistakes in the polling fallback path.

None of these are blockers for the design document — the technical foundation is sound, the SDKs exist and are correctly described, and the build plan ordering is realistic. The Phase 1 → Phase 3 split correctly defers OAuth complexity.