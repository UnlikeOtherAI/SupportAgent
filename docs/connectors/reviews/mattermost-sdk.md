# Mattermost Connector — SDK & Implementation Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, build plan realism, config field alignment, cross-connector consistency.
**Source:** `docs/connectors/mattermost.md`
**Date:** 2026-04-18

---

## Verdict: APPROVED WITH CORRECTIONS

The document's build plan is realistic and the SDK guidance is mostly sound. However, it references a phantom npm package (`@mattermost/server-sdk`) that does not exist, materially overstates the SDK gap ("No official TypeScript/JavaScript SDK" is incorrect), and fails to register Mattermost in `platform-registry.ts`. These are the two highest-severity issues. All other findings are minor.

---

## Findings

### 1. npm Package Existence — CRITICAL ERROR

| Package Referenced | Version | Status | Actual Package |
|---|---|---|---|
| `@mattermost/server-sdk` | Any | **❌ DOES NOT EXIST** | Not on npm — 404 |
| `github.com/mattermost/mattermost/server/public/model` | N/A | ✅ Exists | Go SDK — correct |
| `mattermost-client` | community | ✅ Exists | `loafoe/mattermost-client`, v6.5.0, 2022 |
| `@mattermost/client` | (unreferenced) | ✅ Exists, official | v11.6.0, published 2026-04-17 |
| `@mattermost/types` | (unreferenced) | ✅ Exists, official | v11.6.0, published 2026-04-17 |
| `mattermost-redux` | (unreferenced) | ✅ Exists, official | v11.6.0, published 2026-04-17 |

**Finding:** The document's Section 12 claims:

> **Alternative**: `@mattermost/server-sdk` (community)
> - npm: `npm install @mattermost/server-sdk`

This package does not exist on npm. It returns a 404. The document should be corrected immediately. Remove this entry or replace it with a reference to an actually-existing package.

**Impact:** Low operational risk (the package was only mentioned as an "Alternative" and the recommendation was raw fetch), but the reference is factually wrong.

---

### 2. SDK Gap Is Materially Overstated

**The document claims (Section 12):**

> **Official SDK**: None for TypeScript/Node.js; Go SDK in `github.com/mattermost/mattermost/server/public/model`
>
> **No official TypeScript/JavaScript SDK**

This is **incorrect** as of 2026. Mattermost publishes an official JavaScript/TypeScript SDK:

| Package | Description | npm | Official? |
|---|---|---|---|
| `@mattermost/client` | REST API client | ✅ | ✅ Yes — maintained by Mattermost team |
| `@mattermost/types` | Shared TypeScript type definitions | ✅ | ✅ Yes |
| `mattermost-redux` | Redux store + client (includes types) | ✅ | ✅ Yes (webapp platform) |
| `mattermost-client` | Community REST client | ✅ | ❌ Community, unmaintained since 2022 |

The official `@mattermost/client` is published by `mattermost-user` (Mattermost team accounts) on npm. It has zero runtime dependencies, ships bundled TypeScript types (`lib/index.d.ts`), and covers the REST API. The `mattermost-redux` package (v11.6.0) depends on `@mattermost/client` and `@mattermost/types`.

**What the SDK provides** (verified via npm package metadata):

- `@mattermost/client` v11.6.0: Zero runtime deps, TypeScript types bundled, covers the REST API
- `@mattermost/types` v11.6.0: Shared type definitions (Post, Channel, User, WebSocket events, etc.)
- `mattermost-redux` v11.6.0: Redux integration, Redux Thunk, depends on above two

**What the SDK does NOT provide** (per Mattermost platform architecture):

- No webhook verification helpers
- No built-in WebSocket client (the Go SDK has `WebSocketClient`; the JS SDK relies on native `WebSocket` or a third-party library)
- No automatic retry or rate limit backoff
- No pagination helpers beyond raw API shapes

**Recommendation for the document:** Revise Section 12 to accurately reflect the SDK situation:

```typescript
// Official Mattermost SDK (recommended):
import { Client4 } from '@mattermost/client';
import type { Post, Channel, User } from '@mattermost/types';

// Note: @mattermost/client has zero runtime dependencies and ships TypeScript types.
// It does NOT include webhook verification or WebSocket helpers — those must be built.
```

The Go SDK reference (`github.com/mattermost/mattermost/server/public/model`) is still useful as a canonical reference for exact field names, types, and API shapes — this part of the doc is correct.

---

### 3. Raw Fetch vs SDK Recommendation — PARTIALLY VALID

The document recommends raw `fetch` over a non-existent SDK. With the actual official SDK available, the recommendation should be inverted for TypeScript projects:

**When to use `@mattermost/client`:**
- All TypeScript/Node.js projects (MVP and beyond)
- Provides type safety for all API shapes (Post, Channel, User, etc.)
- Zero runtime dependencies — same bundle cost as raw `fetch`
- Version tracks the Mattermost server version (v11.6.0 matches current server)

**When to use raw `fetch`:**
- Only if `@mattermost/client` does not yet support a specific new endpoint
- When the team wants minimal abstraction

**Finding:** The document correctly identifies that Mattermost has no webhook verification helpers or pagination helpers in the JS SDK. This is accurate — the SDK is a thin REST client, not a full framework like `@slack/bolt`. The Go SDK's `WebSocketClient` has no JS equivalent. The document should add a note that WebSocket reconnection logic must be implemented manually.

---

### 4. No CLI — CORRECT

Section 12 correctly identifies that no CLI equivalent to `gh` exists. The `mmctl` CLI is server-administration only (requires SSH access to the Mattermost server host) and is not useful for connector development. This is accurate.

---

### 5. Build Plan Phase Ordering — REALISTIC

| Phase | Blocking on OAuth? | Status |
|---|---|---|
| MVP: Bot account + WebSocket | No — bot token is static, WebSocket is just a persistent connection | ✅ Realistic |
| Phase 2: Post edits, reactions, channel management | No — same auth, just more API calls | ✅ Realistic |
| Phase 3: Slash commands, advanced search, bot provisioning | No — but bot account creation requires System Admin on self-hosted | ✅ Realistic |

The phase ordering is sound. Bot account setup requires no OAuth redirect flow — this is correctly noted in the doc. Bot provisioning (Phase 3) is appropriately deferred since creating bot accounts via API requires System Admin privileges, which may not be available to tenant admins.

**One gap in Phase ordering:** The doc recommends WebSocket for MVP. WebSocket is correct for real-time intake, but the polling fallback (Section 3) is also needed for reconnect scenarios. The MVP endpoint list correctly includes both the WebSocket endpoint and the polling fallback (`GET /api/v4/channels/{id}/posts`), which is appropriate.

---

### 6. Config Fields — CRITICAL GAP: MATTERMOST NOT IN PLATFORM REGISTRY

The `platform-registry.ts` has no `mattermost` entry. The doc's MVP config (Section 11) assumes a registry entry that does not exist.

**Recommended registry entry** for `platform-registry.ts`:

| Key | Label | Type | Required | Notes |
|---|---|---|---|---|
| `base_url` | Server URL | url | Yes | `https://mattermost.example.com` |
| `bot_token` | Bot Access Token | password | Yes | User access token for bot user |
| `bot_user_id` | Bot User ID | text | Yes | For no-self-retrigger detection |
| `team_id` | Primary Team ID | text | Yes | Bot must be member of team |
| `monitored_channels` | Monitored Channel IDs | text | Yes | Array of channel IDs to watch |

**Note on `bot_user_id`:** The doc correctly recommends runtime discovery via `GET /api/v4/users/me`. This should be stored in connector state at startup, not entered manually. Consistent with how GitHub and Linear store runtime-discovered values.

**Missing from the doc's config:** The doc's `MattermostConfig` interface also lists `monitoredChannels` but does not specify the format. For consistency with other connectors (Linear uses a single `team_id`, GitHub uses `repo_owner`/`repo_name`), this should be a text field that accepts a JSON array or comma-separated string of channel IDs.

---

### 7. Cross-Connector Consistency — NEEDS 'COMMUNICATION' CATEGORY

The `PlatformRegistryEntry` interface uses:

```typescript
category: 'issue-tracker' | 'error-monitoring' | 'version-control' | 'project-management';
```

Mattermost (like Slack) is a communication channel and does not fit any existing category. The `slack-sdk.md` review also flagged this. The category type needs to be extended:

```typescript
category: 'issue-tracker' | 'error-monitoring' | 'version-control' | 'project-management' | 'communication';
```

**Direction:** Mattermost is `both` (inbound via WebSocket, outbound via REST API) — consistent with GitHub, Linear, Slack.

**Intake mode:** `webhook` is not quite right for Mattermost MVP. The doc recommends **WebSocket** as the primary intake mechanism, with outgoing webhook as a fallback. Neither is pure polling. The registry entry should use:

```typescript
defaultIntakeMode: 'websocket', // or 'webhook' as closest match
```

`websocket` is not currently a valid value in the registry type. Either add `websocket` to the union, or document that Mattermost uses `webhook` as the closest match (outgoing webhook is the closest registry analog).

---

### 8. Open Questions — APPROPRIATE

| Question | Status |
|---|---|
| Hosting mode (Cloud vs self-hosted) | ✅ Correct — affects bot account availability |
| CRT (Collapsed Threads) | ✅ Correct — affects thread reply handling |
| Team isolation | ✅ Correct — multi-team = multi-auth-tokens problem |
| Bot provisioning permissions | ✅ Correct — System Admin required on self-hosted |
| Channel structure | ✅ Correct — affects monitoredChannels config |
| Authentication method | ✅ Correct — bot account is right but needs admin enablement |
| Webhook vs WebSocket | ✅ Correct — WebSocket is preferred but webhook is fallback |
| Message limits | ✅ Correct — `PostMessageMaxRunes` can vary |

All open questions correctly surface deployment/operational blockers. The question about "Webhook vs WebSocket" is the most critical for MVP — the doc recommends WebSocket but notes that some self-hosted instances disable the WebSocket endpoint. A clear answer on whether WebSocket is always available (vs outgoing webhook as fallback) would strengthen the MVP feasibility assessment.

---

### 9. WebSocket Implementation Correctness

The WebSocket implementation in the Appendix is structurally correct:

- Correct URL transformation: `https://` → `wss://` + `/api/v4/websocket`
- Correct auth challenge format: `seq: 1, action: 'authentication_challenge', data: { token }`
- Correct event types match the documented WebSocket event table

**One issue:** The doc mentions `SocketMaxMessageSizeKb` as an 8KB limit (Section 10, WebSocket Gotchas). This is a server-configurable setting that defaults to 8KB but can be changed. The doc should note this is configurable rather than a hard constraint.

**WebSocket reconnection:** The doc mentions "auto-reconnect with exponential backoff" for WebSocket in Section 4. This is the desired behavior but no code is shown. The Appendix `MattermostWebSocket` class has no reconnection logic — `connect()` is called once and no error recovery is implemented. For an MVP, this needs to be built. Consider recommending a library like `reconnecting-websocket` or implementing a backoff loop.

---

### 10. Mattermost Go SDK Reference — CORRECT

The Go SDK reference (`github.com/mattermost/mattermost/server/public/model`) is accurate:

- `Client4` is the canonical REST client in the Go SDK
- `WebSocketClient` exists in the Go SDK
- Field names, types, and API shapes in the Go SDK are the best reference for TypeScript type definitions

The recommendation to "port Go SDK types to TypeScript interfaces" is sound and matches what `@mattermost/types` already does (those types are ported from the Go SDK).

---

## Summary of Required Changes

| # | Location | Issue | Severity |
|---|---|---|---|
| 1 | Section 12 | Remove reference to non-existent `@mattermost/server-sdk` | **Critical** — phantom package |
| 2 | Section 12 | Revise "No official TypeScript/JavaScript SDK" — `@mattermost/client` exists | **Critical** — factually incorrect |
| 3 | `packages/contracts/src/platform-registry.ts` | Add `mattermost` entry with 5 config fields | **Critical** — admin panel cannot configure without this |
| 4 | `packages/contracts/src/platform-registry.ts` | Add `'communication'` to `PlatformRegistryEntry.category` type | **Critical** — TypeScript error without this |
| 5 | `packages/contracts/src/platform-registry.ts` | Add `'websocket'` to `defaultIntakeMode` union (or document use of `'webhook'` as closest match) | Medium |
| 6 | Section 12 | Clarify WebSocket reconnection must be implemented manually; no official JS WebSocket helper | Low |
| 7 | Section 12 | Recommend `@mattermost/client` as the primary SDK for TypeScript projects | Low — updates the recommendation |
| 8 | Section 4 (WebSocket Gotchas) | Note `SocketMaxMessageSizeKb` is server-configurable, not a hard constraint | Low |
| 9 | Appendix | Add reconnection logic to `MattermostWebSocket` class or reference a library | Medium — MVP reliability |

Items 1–5 are prerequisites for implementation. Items 6–9 are documentation improvements that prevent implementation mistakes. The build plan itself is realistic — the main gap is that the SDK section is out of date and the platform registry is missing entirely.
