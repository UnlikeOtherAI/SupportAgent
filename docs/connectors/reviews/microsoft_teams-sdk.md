# Microsoft Teams Connector — SDK & Implementation Review

**Reviewer:** Claude Code (SDK/Implementation angle)
**Source:** `docs/connectors/microsoft_teams.md`
**Date:** 2026-04-18

---

## Verdict: Requires corrections before implementation

The doc is technically accurate on API surface and limitations, but has three blocking issues:
1. **Incorrect package name** for the Graph SDK
2. **MVP is blocked on Phase 3 functionality** (Bot Framework proactive messaging requires app distribution)
3. **Config field list is incomplete** for the multi-tenant consent flow described

---

## Findings

### 1. Package Name — `@microsoft/graph-sdk` is incorrect

**What the doc says (Section 12.1):**
> `@microsoft/graph-sdk` (GA, v5.x)
> `npm install @microsoft/graph @microsoft/msal-node`

**What is actually true:**

The package is **`@microsoft/graph`**, not `@microsoft/graph-sdk`. The doc's own npm install line has the right name but the header and repeated references use the wrong name. This will cause copy-paste errors during implementation.

```
# Wrong (doc header)
@microsoft/graph-sdk

# Correct (doc's install line)
@microsoft/graph
```

**Impact:** Medium — implementation will fail at `pnpm add @microsoft/graph-sdk`. Easy fix.

---

### 2. SDK Capabilities — Generally accurate

**Graph SDK (`@microsoft/graph`):**
- Supports TypeScript with strongly-typed models for `ChatMessage`, `Channel`, `Subscription`, etc. ✓
- Has built-in retry handling with Retry-After for 429 responses ✓
- Batch request builder is available ✓
- Token caching via `TokenCredentialAuthenticationProvider` or MSAL integration ✓

The doc correctly notes the SDK handles token acquisition and caching automatically (Section 12.2).

**Bot Framework SDK (`botbuilder`):**
- Bot webhook handling ✓
- Proactive messaging support ✓
- Adaptive Card templating ✓
- Conversation state management ✓

The `botbuilder` package name is correct and widely used.

**Adaptive Cards SDK (`@microsoft/adaptivecards-tools`):**
This is a newer package. The traditional package is `adaptivecards` (templating) and `adaptivecards-fabric` (React bindings). The doc's reference to `@microsoft/adaptivecards-tools` should be verified — `adaptivecards` alone may be sufficient for MVP card construction.

---

### 3. Raw-fetch vs SDK Recommendation — Coherent

The doc correctly recommends:
- **Graph SDK** for all Graph API operations (token caching, retry backoff, typed models)
- **Bot Framework SDK** for bot webhook handling and proactive messaging
- **Not TeamsFx** — correctly flagged as deprecated (community-only until Sep 2026)

This is the right call. Microsoft has two first-party SDKs (Graph and Bot Framework) and the deprecated TeamsFx bridge is no longer the path forward.

**Note:** For lightweight connectors, some teams use raw `fetch` + `msal` directly. The Graph SDK adds overhead but the doc's rationale (token caching + retry handling) justifies it for a multi-tenant server-side connector.

---

### 4. CLI Options — Mostly accurate, one correction

**The doc says:**
> **Microsoft 365 CLI** — `npm install -g @pnp/cli-microsoft365`

**Correct package name:** `@pnp/cli-microsoft365` is the old name. Current package is **`@microsoft365/cli`** or just **`m365`** (the package name changed around v4).

For shell-out parity with `gh`, this CLI is not a strong equivalent — it focuses on tenant management (creating teams, managing users, site permissions) rather than message sending. The doc correctly identifies that "there is no `gh`-equivalent CLI for Teams."

**Recommendation:** If CLI access is needed for connector operations, the doc should either:
- Drop the CLI option (cleaner)
- Recommend `@microsoft365/cli` and note it cannot send messages, only manage tenant config

---

### 5. Build Plan Ordering — MVP is blocked on Phase 3 item

**The doc says:**
- MVP uses **Bot Framework for outbound** (because app-only Graph API message sending is blocked)
- Bot Framework requires registering a **Bot Channels Registration** in Azure

**The critical gap:** Bot Framework proactive messaging in Teams requires the bot to be **installed in the tenant's Teams** — it must be sideloaded or distributed via the Teams Store. This is a distribution problem, not just a registration problem.

The doc's Phase 3 mentions "app distribution via App Studio / Developer Portal" but it's flagged as an open question (item 4). This means:

1. **MVP's outbound path requires bot installation in each tenant** — this is non-trivial
2. **The open question about app distribution should be a prerequisite for MVP, not an afterthought**
3. If bot installation is required, MVP is blocked until this is resolved

**Suggested fix:** Move the distribution strategy question to the top of "Open Questions" or document that MVP requires the customer to install a Teams app manifest. This significantly changes the deployment flow.

---

### 6. Admin Panel Config Fields — Incomplete for multi-tenant consent

**The doc lists:**
- `tenantId`, `clientId`, `clientSecret`
- `botId`, `botSecret`
- `webhookNotificationUrl`, `botWebhookUrl`
- `watchedTeamIds[]`, `watchedChannelIds[]`
- `botAadId`

**Missing fields for multi-tenant admin consent flow:**
- **`adminConsentEndpoint`** — the URL to send customers to for granting admin consent. Without this, the connector cannot automate tenant onboarding.
- **`authorityUrl`** — for multi-tenant, the authority is `https://login.microsoftonline.com/common`; for single-tenant it's tenant-specific. This should be in config or derived.
- **`graphBaseUrl`** — for Government clouds (GCC/GCC-High/DoD), the base URL changes. Flagged as Phase 2 but should at least be a placeholder.

**Correction needed:** Add `adminConsentEndpoint` as a required or computed field in the config. The multi-tenant onboarding flow cannot work without it.

---

### 7. Open Questions — Correct blockers, wrong priority

**What the doc raises (good):**
1. App-only messaging feasibility ✓
2. GCC/GCC-High/DoD tenant support ✓
3. China sovereign cloud ✓
4. Bot distribution strategy ✓
5. Message deletion approach ✓
6. 1:1 chat discovery ✓
7. DLP compliance ✓
8. Webhook reliability / polling fallback ✓

**What should be higher priority:**
- **Bot distribution (#4)** is a blocker for MVP's outbound path — should be Q1, not Q7
- **Admin consent automation (#1 in Section 2.3)** — the doc recommends multi-tenant admin consent but never explains how to automate getting that consent. The onboarding flow requires a human to visit a URL and click "Accept." This should be documented or flagged.

**Missing open question:**
- **Webhook endpoint reachability** — Graph sends to your public URL. For local dev you need a tunnel (ngrok/cloudflared). For production you need a valid HTTPS cert. This is an ops concern but affects MVP.

---

### 8. Cross-Connector Consistency

**Delivery adapter uniform interface:**

Comparing to the Crashlytics connector (only other reviewed doc):
- Crashlytics is **inbound-only** (no write API)
- Teams connector is **bidirectional** (inbound via subscriptions, outbound via Graph + Bot)

**Potential abstraction mismatch:**

The doc describes:
- Graph subscription webhooks (POST to notification URL)
- Bot Framework incoming messages (separate webhook endpoint)

These are two distinct webhook endpoints:
- `webhookNotificationUrl` — Graph change notifications
- `botWebhookUrl` — Bot Framework real-time messages

If SupportAgent's delivery adapter expects a single uniform interface (like GitHub's webhook handler), Teams requires two separate handlers. This should be documented explicitly.

**Recommendation:** Document that Teams connector registers two webhook endpoints: one for Graph subscriptions (inbound events) and one for Bot Framework (proactive bot commands/@mentions). The delivery adapter should support multiple webhook paths per connector.

---

### 9. TypeScript Typings and Helpers

**Graph SDK:**
- Strongly typed models exist for all resources mentioned ✓
- `ChatMessage`, `Channel`, `Team`, `Subscription` types are available ✓

**Bot Framework SDK:**
- `Activity`, `TurnContext`, `MessageFactory` types available ✓
- No webhook signature verification helper — the doc correctly describes manual HMAC validation with the bot secret (Section 3.2)

**Subscription lifecycle helpers:**
- Graph SDK has `Subscription` model but no built-in subscription manager
- The doc correctly notes you must implement your own subscription renewal job (Section 3.1)
- No `@microsoft/graph-subscriptions` or similar helper package exists

**Adaptive Cards:**
- `adaptivecards` package has `AdaptiveCard` class + `CardElement` types ✓
- `@microsoft/adaptivecards-tools` is a newer authoring tool, not strictly required

---

### 10. Transitive Dependencies and Licensing

**Graph SDK (`@microsoft/graph`):**
- Depends on `fetch` (node built-in or polyfill), `msal-common`, `token-cache`
- No heavy transitive deps
- MIT licensed ✓

**Bot Framework SDK (`botbuilder`):**
- Depends on `adaptivecards`, `botbuilder-core`, `botbuilder-schema`
- Reasonable bundle size (~2MB)
- MIT licensed ✓

**MSAL Node (`@microsoft/msal-node`):**
- Required for token acquisition (Graph SDK uses it)
- Heavy-ish (~5MB) but standard for Azure AD
- MIT licensed ✓

**No licensing concerns identified.** All packages are MIT/Apache 2.0. No GPL or AGPL transitive dependencies.

**Transitive dep concern:**
- `botbuilder` pulls in `adaptivecards` which has its own templating model. Ensure the card version (1.4+) matches what the SDK generates — the doc correctly notes this (Section 10, item 11).

---

## Summary of Required Fixes

| # | Component | Issue | Severity |
|---|---|---|---|
| 1 | Package name | `@microsoft/graph-sdk` → `@microsoft/graph` in headings | Medium |
| 2 | CLI package | `@pnp/cli-microsoft365` may be outdated name | Low |
| 3 | MVP scope | Bot distribution (Phase 3) is prerequisite for MVP outbound | High |
| 4 | Config fields | Missing `adminConsentEndpoint` for multi-tenant flow | High |
| 5 | Open questions | Bot distribution should be Q1 blocker, not Q7 | Medium |
| 6 | Delivery adapter | Two webhook endpoints not one — document abstraction gap | Medium |

## Recommended Additional Open Question

Add to Section 13:
> **9. Bot installation flow.** For MVP to send messages, the customer must install the SupportAgent bot in their Teams tenant. Do we:
> - (a) Provide a sideloadable app manifest that customers upload manually?
> - (b) Publish to the Teams Store and require customers to find/search?
> - (c) Use Graph API to proactively message only after the bot is in the chat?
>
> Option (a) is likely the only viable MVP path, but requires UI in the admin panel to generate/download the app manifest.