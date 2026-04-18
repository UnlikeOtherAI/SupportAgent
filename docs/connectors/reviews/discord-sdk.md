# Discord Connector — SDK & Implementation Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, build plan realism, config field alignment, cross-connector consistency.
**Source:** `docs/connectors/discord.md`
**Date:** 2026-04-18

---

## Verdict: APPROVED WITH CORRECTIONS

The document is technically accurate on SDK capabilities and the build plan ordering is sound. Two critical gaps: Discord is missing from `platform-registry.ts` (blocking admin panel setup), and the `communication` category does not exist in the registry type (blocking TypeScript compilation). The Gateway-vs-REST architectural difference from all other connectors is correctly identified but needs an explicit operational flag.

---

## Findings

### 1. npm Package Existence — VERIFIED

| Package | Version | Status | Notes |
|---|---|---|---|
| `discord.js` | 14.26.3 | ✅ Exists | Official library, maintained by discord.js org |
| `discord-api-types` | 0.38.47 | ✅ Exists | Bundled with discord.js, also independently available |

No phantom packages. The document references `discord.js` (Section 12) — this is the correct, real package name.

---

### 2. SDK Capabilities — VERIFIED

**TypeScript types:** `discord.js` ships bundled types at `./typings/index.d.ts`. No separate `@types/discord.js` needed. Correct.

**Gateway WebSocket handling:** The doc correctly identifies that discord.js handles Gateway connection lifecycle (heartbeat, resume, reconnect). Confirmed — the `WebSocketManager` class handles all of this internally.

**Rate limit handling:** `discord.js` includes automatic rate limit handling via its REST manager. The doc notes this. Confirmed.

**Object model:** discord.js provides full TypeScript types for all Discord objects (Guild, Channel, Message, etc.). Confirmed.

**Permission checking utilities:** The doc mentions "permission checking utilities." Confirmed — `GuildChannel#permissionsFor()` and `Guild#roles` provide this.

**Webhook signature verification (app lifecycle):** The doc correctly notes that app lifecycle webhooks (APPLICATION_AUTHORIZED, etc.) use Ed25519 signatures (`X-Signature-Ed25519` + `X-Signature-Timestamp`). discord.js does NOT provide a helper for this — it is for Gateway events only. The manual Ed25519 implementation shown is correct. No SDK helper exists for this, which the doc implies by showing manual code.

**No pagination helpers for REST:** discord.js REST methods do not expose built-in cursor pagination helpers for the general case. For message pagination, you use `Channel.messages.fetchMessages()` which is a high-level method, not a raw cursor-walking utility. The doc's snowflake-based pagination examples (Section 9) are correct descriptions of the API — discord.js wraps these in `Channel.messages.fetch()` with options. No correction needed.

---

### 3. Raw Fetch vs SDK Recommendation — UNDECIDED, NEEDS RESOLUTION

Section 12 states:

> "Use `discord.js` over raw fetch because: Handles Gateway connection lifecycle, automatic rate limit handling, type definitions, permission utilities."
>
> "However: For a lightweight connector, raw `fetch` with manual Gateway handling is viable. `discord.js` adds significant bundle size (~4MB minified)."

This is the most consequential architectural decision for the Discord connector. The doc leaves it as a toss-up without guidance.

**Bundle size context:**
```
discord.js: 14.x
  Core deps: @discordjs/collection, @discordjs/ws, @discordjs/builders, discord-api-types
  Transitive deps: undici (HTTP client), @sapphire/snowflake, tslib, lodash.snakecase, magic-bytes.js
  Total (pnpm): ~3-5MB installed
```

**Trade-off analysis:**

| Approach | Pros | Cons |
|---|---|---|
| `discord.js` | Gateway auto-reconnect, typed events, permission helpers | ~3-5MB bundle, opinionated class model, harder to unit test |
| Raw fetch + manual WS | ~0 deps, full control | Need to implement heartbeat, resume logic, reconnect backoff, rate limit parsing |

**The doc should take a position.** For a Gateway-based connector, the reconnection/resume logic is non-trivial. discord.js's `WebSocketManager` handles:
- Opcode 1 (Heartbeat) — send interval
- Opcode 6 (Resume) — reconnect with sequence + session_id
- Opcode 7 (Reconnect) — Discord-initiated reconnect
- Opcode 9 (Invalid Session) — clean resume failure
- Opcode 10 (Hello) — initial handshake with heartbeat interval
- Unhappy-path backoff with jitter

This is ~200 lines of non-obvious state machine code. Raw fetch advocates must acknowledge this cost.

**Recommendation:** State explicitly: "Use discord.js for the MVP Gateway client. If bundle size becomes a production constraint post-MVP, evaluate a lightweight WS client (`ws` + manual state machine) as an alternative."

---

### 4. No CLI — CORRECT

Section 12 says "No equivalent to `gh` CLI for Discord." This is accurate. Discord's bot management is entirely through the Developer Portal web UI. No correction needed.

---

### 5. Build Plan Phase Ordering — REALISTIC

| Phase | Feature | Blocking Dependencies |
|---|---|---|
| MVP: Gateway + MESSAGE_CREATE + outbound | Bot token is static, no OAuth needed | ✅ Correct |
| MVP: Config fields | Bot token, guild IDs, channel IDs, bot user ID | ✅ Correct |
| Phase 2: MESSAGE_DELETE, reactions, thread events | Same auth, additional intents | ✅ Correct |
| Phase 3: Multi-guild, forum tags as structured tracker | Requires more complex guild tracking | ✅ Correctly deferred |

The Phase ordering does not block MVP on OAuth — bot token setup is a single static credential. Correct.

**One concern:** Phase 3 mentions "Multi-guild support per tenant" but does not address the architectural complexity of maintaining multiple concurrent Gateway connections. Each guild requires its own Gateway session (though Discord supports "sharding" — one connection per guild). For multi-guild tenants, this means one WebSocket connection per guild. The doc should flag this operational concern.

---

### 6. Config Fields — CRITICAL GAP: DISCORD NOT IN PLATFORM REGISTRY

**`platform-registry.ts` has no `discord` entry.** The doc's MVP config fields (Section 11) assume a registry entry that does not exist:

```
Required fields (from doc Section 11):
- Bot token
- Guild ID(s) to monitor
- Channel ID(s) to watch
- Bot's own user ID (for no_self_retrigger)
```

Proposed registry config fields:

| Key | Label | Type | Required | Notes |
|---|---|---|---|---|
| `bot_token` | Bot Token | password | Yes | From Developer Portal → Bot → Token |
| `guild_ids` | Guild (Server) IDs | text | Yes | Comma-separated or JSON array |
| `channel_ids` | Channel IDs to Watch | text | Yes | Comma-separated or JSON array |
| `bot_user_id` | Bot User ID | text | Yes | Resolved at startup via `GET /users/@me` |
| `intents` | Gateway Intents | text | Yes | Default: `GUILDS\|GUILD_MESSAGES\|DIRECT_MESSAGES\|MESSAGE_CONTENT` |
| `dm_policy` | DM Policy | toggle | No | `allow` / `block` |

**Note on `bot_user_id`:** As with Slack's `bot_user_id`/`bot_id`, this should be resolved at startup via `auth.test` equivalent (`GET /users/@me`) and stored in connector state — not as an admin-panel config field. This matches the pattern recommended in the Slack SDK review.

---

### 7. Platform Category — MISSING `'communication'`

The `PlatformRegistryEntry` type allows:
```typescript
category: 'issue-tracker' | 'error-monitoring' | 'version-control' | 'project-management';
```

Discord does not fit any of these. A new category is required:
```typescript
category: 'issue-tracker' | 'error-monitoring' | 'version-control' | 'project-management' | 'communication';
```

Discord is listed as "Category: Communication / Messaging platform" in Section 1. The registry must be updated before Discord can be registered.

---

### 8. Cross-Connector Consistency — GATEWAY IS THE OUTLIER

Discord uses **Gateway WebSocket** for message intake. Every other connector in the registry uses **webhooks** (HTTP POST from the platform). This is a significant architectural difference:

| Connector | Intake Mode | Delivery |
|---|---|---|
| GitHub | webhook | REST POST |
| Linear | webhook | REST POST |
| Slack | webhook | REST POST |
| Jira | webhook | REST POST |
| Sentry | webhook | REST POST |
| **Discord** | **Gateway (WebSocket)** | **REST POST** |

**Implications:**

1. **Long-running connection:** Discord requires a persistent WebSocket connection. This is fundamentally different from webhook-based connectors which are stateless request/response. The worker model must accommodate long-running connections.

2. **Delivery adapter mismatch:** All other connectors receive events via HTTP and write back via REST. Discord receives via WebSocket (not HTTP). The delivery adapter (outbound REST POST) is the same, but the inbound path is completely different. The doc should explicitly note this architectural divergence.

3. **Operational concerns:** WebSocket connections require:
   - Keepalive/heartbeat management
   - Reconnect logic with backoff
   - Session state persistence (sequence number, session_id for resume)
   - Connection health monitoring

   Webhook-based connectors have no equivalent concerns.

4. **Scaling:** A single Discord bot connection handles all guilds (up to the bot's guild limit). Webhook receivers scale horizontally with HTTP load. The Gateway connection is a single point of failure unless the bot implements multiple connections (sharding).

**Recommendation:** Add an explicit section under Architecture notes:

> **Intake Architecture Divergence**
>
> Unlike all other SupportAgent connectors (which use HTTP webhooks for inbound), Discord uses a persistent WebSocket Gateway connection. This requires:
> - A long-running process or worker that maintains the connection
> - State persistence (sequence number, session_id) for resume capability
> - Health monitoring for the connection
> - Reconnect logic separate from the standard webhook receiver pattern
>
> The outbound delivery adapter (POST to Discord REST API) follows the same pattern as other connectors.

---

### 9. `defaultIntakeMode` — GATEWAY IS NOT `'webhook'`

The `PlatformRegistryEntry` interface uses:
```typescript
defaultIntakeMode: 'webhook' | 'polling' | 'manual';
```

Discord's Gateway intake does not fit any of these. It is a persistent WebSocket connection — closer to `'manual'` (ongoing connection) but semantically distinct. The doc's Section 1 overview correctly identifies Gateway as the primary intake mechanism, but the registry type does not accommodate it.

**Recommendation:** Extend the type:
```typescript
defaultIntakeMode: 'webhook' | 'polling' | 'manual' | 'gateway';
```

Or document that for Discord, `defaultIntakeMode` should be `'manual'` with a note that the "manual" means "persistent connection requiring dedicated worker process."

---

### 10. MESSAGE_CONTENT Intent — Correctly Flagged as MVP Blocker

The doc correctly identifies (Section 4, 10, 11) that without `MESSAGE_CONTENT` intent, message content is empty and content-based triggers fail. This is not a documentation error — it is a critical operational constraint.

The open question (#1 in Section 13) asks whether target tenants have large Discord servers (>100 members). This is the right question. Without knowing this, the connector's MVP scope cannot be finalized.

**Recommendation:** The build plan should include a decision gate: "If MESSAGE_CONTENT intent is not available, implement content-independent triggers only (channel routing, attachment detection, role matching) and defer content-based matching to Phase 2."

---

### 11. Open Questions — Correctly Covers Operational Blockers

| Question | Status |
|---|---|
| MESSAGE_CONTENT Intent Verification | ✅ Critical — gates MVP scope |
| Multi-guild vs single-guild | ✅ Correctly deferred — affects config schema |
| DM Support | ✅ Correctly deferred |
| Forum as Issue Tracker | ✅ Correctly deferred |
| Role-based Routing | ✅ Correctly deferred — requires GUILD_MEMBERS intent |
| Bot Verification Level | ✅ Correctly flagged |

**Missing open question:** How does the Gateway connection fit into the worker model? Webhook-based connectors receive events as HTTP requests. The Gateway requires a persistent outbound connection. This is an infrastructure question: does the connector run as a long-lived worker process, or does it use a "polling Gateway" pattern with short-lived connections?

---

### 12. Transitive Dependencies and Licensing

**discord.js:**
- License: Apache-2.0 ✅
- Key deps: `@discordjs/collection` (Map with utility methods), `@discordjs/ws` (WebSocket framework), `@discordjs/builders` (builder pattern for API payloads), `discord-api-types` (TypeScript definitions), `undici` (HTTP client), `@sapphire/snowflake` (ID generation)
- No GPL or copyleft dependencies
- No known licensing concerns

**Bundle size:** ~3-5MB installed (pnpm). The doc's "~4MB minified" estimate is in the right ballpark. For a server-side connector worker, bundle size is less critical than for client-side code. For edge functions or serverless, this is a legitimate concern.

**No heavy transitive dependencies or licensing concerns identified.**

---

## Summary

| # | Component | Issue | Severity | Status |
|---|---|---|---|---|
| 1 | npm packages | All verified | — | No action |
| 2 | SDK capabilities | discord.js correctly described | — | No action |
| 3 | Raw fetch vs SDK | Doc leaves decision open | High | **Recommendation needed** — take a position |
| 4 | CLI option | No CLI exists | — | No action |
| 5 | Build plan ordering | Correct, Phase 3 multi-guild gap noted | Medium | Add Gateway connection count note |
| 6 | `platform-registry.ts` | No `discord` entry | **Critical** | Add entry with 5 config fields |
| 7 | Platform category | No `'communication'` category | **Critical** | Add to type + PLATFORM_CATEGORIES |
| 8 | Cross-connector consistency | Gateway divergence from webhook model | High | Add explicit "Architecture Divergence" section |
| 9 | `defaultIntakeMode` | Gateway doesn't fit existing types | High | Add `'gateway'` to type or document workaround |
| 10 | MESSAGE_CONTENT intent | Correctly flagged | — | No action (add decision gate to plan) |
| 11 | Open questions | Missing Gateway worker model question | Medium | Add question on connection persistence |
| 12 | Licensing/deps | No concerns | — | No action |

**Critical blockers for implementation (must fix before coding):**
- Finding #6: Add `discord` to `platform-registry.ts`
- Finding #7: Add `'communication'` to `PlatformRegistryEntry.category` type
- Finding #9: Extend `defaultIntakeMode` type to include `'gateway'`

**High-priority before Phase 1 coding:**
- Finding #3: Decide raw-fetch vs discord.js and document the decision
- Finding #8: Add "Architecture Divergence" section explicitly calling out Gateway vs webhook difference

---

## Recommended Changes (diff-style)

```diff
--- a/packages/contracts/src/platform-registry.ts
+PLATFORM_CATEGORIES = [
+  { key: 'error-monitoring', label: 'Error Monitoring' },
+  { key: 'issue-tracker', label: 'Issue Trackers' },
+  { key: 'version-control', label: 'Version Control' },
+  { key: 'project-management', label: 'Project Management' },
+  { key: 'communication', label: 'Communication' },  // ADD THIS
+]

+discord: {
+  key: 'discord',
+  displayName: 'Discord',
+  description: 'Connect Discord servers and channels for real-time message intake and outbound replies.',
+  category: 'communication',  // NEEDS TYPE ADDITION
+  iconSlug: 'discord',
+  defaultDirection: 'both',
+  defaultIntakeMode: 'gateway',  // NEEDS TYPE ADDITION
+  supportsCustomServer: false,
+  supportsOAuth: false,
+  configFields: [
+    { key: 'bot_token', label: 'Bot Token', type: 'password', required: true, secretType: 'api_key' },
+    { key: 'guild_ids', label: 'Guild IDs', type: 'text', required: true },
+    { key: 'channel_ids', label: 'Channel IDs', type: 'text', required: true },
+    { key: 'dm_policy', label: 'Allow DMs', type: 'toggle', required: false },
+    { key: 'intents', label: 'Gateway Intents', type: 'text', required: true },
+  ],
+}

--- a/docs/connectors/discord.md Section 12
- However: For a lightweight connector, raw `fetch` with manual Gateway handling is viable.
- `discord.js` adds significant bundle size (~4MB minified).

+ **Recommendation for MVP:** Use `discord.js` for Gateway handling. The WebSocket state machine
+ (heartbeat, resume, reconnect, invalid session) is non-trivial to implement correctly. The bundle
+ size (~3-5MB installed) is acceptable for server-side workers.
+
+ **Post-MVP evaluation:** If bundle size becomes a constraint (e.g., edge functions), consider a
+ lightweight approach using `ws` + manual Gateway state machine. Do not start with raw fetch
+ for MVP — the reconnection logic is a distraction from connector logic.

--- a docs/connectors/discord.md Section 13 (add)
+ **7. Gateway Connection Persistence:** How does the Gateway WebSocket fit into the SupportAgent
+ worker model? Discord requires a persistent outbound connection. Options:
+   (a) Long-running dedicated worker process with health monitoring
+   (b) Short-lived connections with session persistence (sequence, session_id) stored in DB
+   (c) Use Discord's recommended "comet" or sharding approach for multi-guild scale
+
+ **8. Multi-guild Gateway Scaling:** If a tenant monitors N guilds, Discord requires N separate
+ Gateway connections (one per guild, unless using sharding). How does the connector architecture
+ handle multiple concurrent WebSocket connections per tenant?
```
