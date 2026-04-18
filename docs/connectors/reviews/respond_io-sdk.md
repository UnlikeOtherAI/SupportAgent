# Respond.io Connector — SDK & Implementation Review

## Verdict: APPROVED WITH CAVEATS

The doc is well-structured and the core implementation plan is sound. Two factual claims about the SDK need correction; everything else holds up.

---

## Findings

### 1. `@respond-io/typescript-sdk` — package existence

**What the doc assumes:** The package `@respond-io/typescript-sdk` exists on npm, is official, and is MIT-licensed.

**What is actually true:** CONFIRMED.

- Package: `https://registry.npmjs.org/@respond-io/typescript-sdk`
- Latest version: `1.2.0`
- Description: "Official TypeScript SDK for the respond.io Developer API v2"
- Publisher: `respond.io` (org: `rocketbots.io`)
- License: MIT
- Dependencies: `axios ^1.6.0` only — no heavy transitive deps

**Verdict: Correct.**

---

### 2. `@respond-io/mcp-server` — package existence

**What the doc assumes:** The package `@respond-io/mcp-server` exists and supports stdio and HTTP modes.

**What is actually true:** CONFIRMED.

- Package: `https://registry.npmjs.org/@respond-io/mcp-server`
- Latest version: `1.2.0`
- Dependencies: `@modelcontextprotocol/sdk`, `express`, `cors`, `zod`, `@respond-io/typescript-sdk`
- Transport modes: stdio (default) and HTTP (`/mcp` endpoint)
- Configuration: `RESPONDIO_API_KEY` env var, `MCP_SERVER_MODE`

The doc correctly notes this is "useful for Claude Desktop integration but not directly applicable to the SupportAgent connector." The MCP server is a separate integration path, not a production connector dependency.

**Verdict: Correct.**

---

### 3. SDK TypeScript types

**What the doc assumes:** The SDK provides "complete type safety for all endpoints."

**What is actually true:** CONFIRMED. The SDK README states it is "written in TypeScript and provides complete type definitions" with "fully typed" request/response shapes. The doc's appendices (Contact, Message, Channel, Filter types) align with the SDK's exported interfaces.

**Verdict: Correct.**

---

### 4. SDK retry / rate limit handling

**What the doc assumes:** The SDK "implements automatic retry with exponential backoff" on 429 and 5xx, uses `Retry-After` header, falls back to `min(1000 * 2^attempt, 10000ms)`, max 3 retries.

**What is actually true:** CONFIRMED in principle. The SDK README confirms "Automatic Retries — Built-in retry logic for failed requests with exponential backoff" and "Rate limit handling with retry-after headers." The error class `RespondIOError` exposes `isRateLimitError()` helper.

The specific numbers (10000ms cap, max 3 retries) are plausible given the SDK's documented behavior, but the doc should note these are implementation details that may change — they are not documented in the SDK README itself.

**Verdict: Correct, with minor caveat** that specific backoff constants should be verified by reading the SDK source before relying on them in production code.

---

### 5. SDK pagination helpers

**What the doc assumes:** The SDK has pagination helpers for `contacts.list()` and `messaging.list()` with `limit` and `cursorId` options.

**What is actually true:** CONFIRMED. The SDK supports cursor-based pagination. The doc's pagination response shape (`{ items: [...], pagination: { next, previous } }`) matches the SDK's documented return type.

**Verdict: Correct.**

---

### 6. SDK webhook helpers — **CLAIM IS INACCURATE**

**What the doc assumes:** The SDK provides "webhook helpers" and the rate limit section implies the SDK handles webhook verification.

**What is actually true:** The SDK is a REST API client only. It does **not** have webhook helpers, webhook verification utilities, or webhook event handling. Webhook handling — including signature verification, event parsing, and deduplication — must be built in the connector layer.

This is not a critical flaw since webhook handling is connector-specific infrastructure, but the doc should not imply the SDK covers it.

**Fix:** Remove any implication that the SDK handles webhooks. Add a note that webhook registration (via `POST /integration/{integration}/subscribe`) is a single SDK call, but webhook payload parsing, loop detection (`sender.source === "api"`), and retry/dead-letter logic are connector responsibilities.

**Verdict: MISLEADING — needs correction.**

---

### 7. Raw fetch vs SDK recommendation

**What the doc assumes:** The API is simple REST, but the SDK adds significant value through retry, type safety, and error handling. Recommendation: "Use the SDK for MVP."

**What is actually true:** REASONABLE. The SDK is official, lightweight (single axios dep), and covers all the endpoints listed in the MVP table. There is no mature third-party alternative competing with it.

One minor concern: the SDK is at v1.2.0, which is early-stage. If the API evolves quickly, the SDK could lag. The doc should note that if the SDK falls behind on new API features, falling back to raw `fetch` for those endpoints is acceptable.

**Verdict: Correct recommendation, minor caveat on SDK maturity.**

---

### 8. CLI option

**What the doc assumes:** No `gh`-equivalent CLI exists; all management is via dashboard, REST API, or SDK.

**What is actually true:** CONFIRMED. No CLI tool is documented or known for Respond.io. The MCP server is not a CLI management tool — it is an AI integration server.

**Verdict: Correct.**

---

### 9. MVP / Phase 2 / Phase 3 ordering

**What the doc assumes:** MVP uses API token auth, wraps ~13 endpoints, handles 6 webhook events. Phase 2 adds comment/lifecycle/outgoing sync. Phase 3 adds broadcasts and analytics.

**What is actually true:** SOUND.

The MVP is correctly scoped:
- API token auth: correct, no OAuth required for MVP
- All wrapped endpoints are in the SDK (confirmed by checking SDK module list)
- Webhook events are correctly identified from the API docs
- No Phase 2/3 features are blocked on OAuth or workspace architecture

The Phase 2 "closing notes integration" maps to `GET /space/closing_notes` — a simple SDK call, appropriately placed in Phase 2 rather than MVP.

The Phase 3 broadcast API (`POST /contact/bulk_message`) is NOT confirmed in the doc's endpoint table and should be verified against the SDK before committing to it in Phase 3. If broadcasts work differently (e.g., require a campaign setup in the UI), Phase 3 scope may need adjustment.

**Verdict: Generally sound. Flag Phase 3 broadcast endpoint for verification.**

---

### 10. Admin panel config fields

**What the doc lists for MVP:**

| Field | Purpose |
|-------|---------|
| `apiToken` | Respond.io API token |
| `workspaceId` | Optional, multi-workspace support |
| `webhookUrl` | Our endpoint URL |
| `webhookSecret` | If needed for verification |
| `defaultChannelId` | Fallback channel for messages |

**What is actually required:**

- `apiToken`: REQUIRED. This is the only auth credential.
- `workspaceId`: OPTIONAL. Not strictly needed for MVP single-workspace, but harmless to include.
- `webhookUrl`: REQUIRED for webhook registration, but note the registration call requires specifying the integration type (`n8n-api`). Should the admin panel also have a `webhookIntegration` field? The doc only mentions `n8n-api` — confirm this is the right default or if other integrations are supported.
- `webhookSecret`: NOT REQUIRED. Respond.io uses the same API token for webhook verification (Bearer token in Authorization header). There is no separate webhook secret.
- `defaultChannelId`: OPTIONAL. Good for multi-channel contacts but not strictly MVP-required if the doc's "omit channelId = last interacted" behavior is reliable.

**Fix:** Remove `webhookSecret` from the config field list. Add `webhookIntegration` (string, default `"n8n-api"`) as an optional advanced field, or note that `n8n-api` is the only supported integration type for webhook subscriptions.

**Verdict: Minor — `webhookSecret` should be removed; otherwise fields are appropriate.**

---

### 11. Open Questions section

**What the doc raises:**

1. Multi-workspace architecture — correctly flagged as an architectural decision
2. Webhook reliability / polling fallback — correctly identified with concrete checkpoint strategy
3. Channel selection for multi-identity contacts — correctly scoped to MVP with admin-configurable default
4. WhatsApp template management — correctly deferred to Phase 2
5. Closing conversation flow — correctly scoped as optional per workflow
6. Contact merge handling — correctly flagged as an edge case

**What should be added:**

- **Webhook integration type:** The `n8n-api` integration type used for subscription — is this the only supported type? What happens with `zapier`? Does the webhook work without a specific integration type?
- **API token rotation:** If the token is compromised, it has workspace-level access. Is there a token rotation strategy? This affects security posture.
- **Multi-channel send ambiguity:** If a contact has WhatsApp, email, and SMS all active, what determines the default send channel? The doc says "last interacted" but this is implicit — explicit admin config is safer.

**Verdict: Open questions are well-chosen. Add 2–3 more items above.**

---

### 12. Cross-connector consistency

**What other connectors use:** All connectors implement the uniform delivery adapter with async message delivery, outbound webhook-style delivery to channels, and op kinds that map to REST resource operations.

**What this connector proposes:** SAME PATTERN.

- Inbound: webhook → normalize → delivery adapter — consistent
- Outbound: delivery adapter → REST API call (SDK) — consistent
- Operations: contact update, tag add/remove, conversation status, assignee — all map to standard op kinds
- No synchronous delivery, no wildly different abstraction

The `sender.source === "api"` loop detection strategy is a good connector-specific detail that fits within the standard "no self-retrigger" invariant.

**Verdict: No consistency issues.**

---

### 13. Dependency concerns

**Transitive deps of `@respond-io/typescript-sdk`:** Only `axios ^1.6.0`. MIT licensed. No concerns.

**Transitive deps of `@respond-io/mcp-server`:** `express`, `cors`, `zod`, `@modelcontextprotocol/sdk`. These are all standard, permissive-license packages. No licensing concerns.

**SDK maturity:** v1.2.0 is early-stage but the SDK is official and actively maintained (latest publish suggests recent updates). The single-dep footprint is a good signal.

**Verdict: No dependency or licensing concerns.**

---

## Summary of Required Changes

| # | Severity | Location | Change |
|---|----------|----------|--------|
| 1 | Medium | Section 12 / SDK description | Remove any implication that the SDK has webhook helpers. Add explicit note that webhook payload parsing, verification, and deduplication are connector-layer responsibilities. |
| 2 | Low | Section 11 (admin config) | Remove `webhookSecret` from the config field list. Respond.io uses Bearer token auth for webhooks, not a separate secret. |
| 3 | Low | Section 11 (admin config) | Consider adding `webhookIntegration` field with default `"n8n-api"`, or add a note confirming `n8n-api` is the only supported integration type. |
| 4 | Low | Section 11 (open questions) | Add open question about `n8n-api` vs other integration types for webhook subscriptions. |
| 5 | Low | Section 13 (Phase 3) | Verify `POST /contact/bulk_message` or equivalent broadcast endpoint exists before committing to Phase 3 broadcast scope. |
| 6 | Low | Section 9 (retry) | Note that specific backoff constants (10s cap, 3 retries) are implementation details not guaranteed by the SDK contract. |
