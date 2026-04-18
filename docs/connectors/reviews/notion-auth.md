# Notion Connector — Auth & Credentials Review

**Reviewed file:** `docs/connectors/notion.md`
**Scope:** Authentication and credentials only
**Verdict:** REVISIONS NEEDED — 8 findings (2 critical, 4 moderate, 2 informational)

---

## Critical Findings

### 1. Missing `owner` Parameter in OAuth Authorization URL

**Issue:** The OAuth authorize URL parameters listed (§2) omit the required `owner: "user"` parameter. Without it, Notion's OAuth flow will reject the request or behave unexpectedly.

**Why it matters:** Any implementer following the documented parameters will get OAuth failures at the authorization step.

**Correction** in §2, OAuth section. Add `owner` to the parameter list:
```
- **Required parameters**: `client_id`, `redirect_uri`, `response_type: "code"`, `owner: "user"`, and optionally `state`
```
---

### 2. OAuth Refresh Token Rotation Not Documented

**Issue:** The doc says "exchange via same token endpoint" and "refresh_token provided" but does not mention that **refreshing invalidates the old refresh token** — Notion rotates the refresh token on every refresh, issuing a new pair of (access_token, refresh_token). Storing only the original refresh token and reusing it will break after the first refresh.

**Why it matters:** Implementers who store the refresh token once and reuse it naively will get auth failures after the first refresh attempt, requiring re-authorization.

**Correction** in §2, OAuth section. Replace the refresh line with:
```
- **Refresh**: `POST https://api.notion.com/v1/oauth/token` with `grant_type=refresh_token`. Notion issues a new `access_token` AND a new `refresh_token`. Store both — the old refresh token is invalidated after use. Repeat on each subsequent refresh.
```

---

## Moderate Findings

### 3. OAuth Access Token Lifetime Is Unknown and Undocumented

**Issue:** The doc says nothing about how long the OAuth access token is valid. Notion does not publicly document the lifetime. Without a refresh strategy, a long-running integration will silently start getting 401s.

**Why it matters:** Without an expected lifetime, implementers cannot set a refresh timer. A guessed lifetime could be wrong and cause premature auth failures.

**Correction** in §2, OAuth section. Add:
```
- **Access token lifetime**: Not publicly documented by Notion. Treat as short-lived and implement proactive refresh (e.g., refresh at 80% of an assumed 1-hour lifetime, or on first 401). Do not rely on the token remaining valid without refreshing.
```

---

### 4. "Manage Webhooks" Row in Capabilities Table Is Misleading

**Issue:** The capabilities table (§2, row "Manage webhooks") says "Integration-level, but subscription requires shared pages." This mixes two distinct things: webhook registration (integration-level, UI-only) and event filtering (page-scoped). The phrasing implies there's a "manage webhooks" permission analogous to "Comment" or "Read content," but there is no such Notion capability.

**Why it matters:** A reader might look for a "manage webhooks" scope or permission label that does not exist, or incorrectly assume webhook delivery works across unshared pages.

**Correction** — split this into two accurate statements:
```
| Register webhooks | Integration settings UI only (not API) |
| Receive webhook events | Pages/databases subscribed to must be shared with integration |
```

---

### 5. "Read Content" / "Comment" Are Not Capability Names

**Issue:** The capabilities table uses "Read content" and "Comment" as if they were capability strings that can be requested or granted. Notion does not use named capability strings — it uses a page-sharing model. A user grants access to specific pages; there are no discrete capability flags like `read:content` or `comment:write`.

**Why it matters:** This framing may confuse implementers who expect OAuth scope strings or who look for these labels in the Notion integration UI.

**Correction** in §2, capabilities table:
```
| Read pages | Page/database shared with integration |
| Read comments | Page shared (no separate capability) |
| Post comments | Page shared (no separate capability) |
| Create pages | Parent page/database shared |
| Update page properties | Page shared |
```
Remove "capability" from the column header.

---

### 6. Webhook Replay Protection Status Unknown

**Issue:** The doc says nothing about replay protection for webhooks (nonce, timestamp, or similar). Notion's webhook verification uses HMAC-SHA256 with the verification token, but does Notion also include a timestamp or nonce in the request to prevent replay? This is not documented in Notion's public webhook guide.

**Why it matters:** Without replay protection, an attacker who intercepts a valid webhook payload (including the HMAC) can replay it indefinitely. If Notion webhooks lack timestamps/nonces, the HMAC alone only verifies integrity, not freshness.

**Correction** in §2, webhook section. Add:
```
- **Replay protection**: Unknown. Notion's webhook documentation does not describe a timestamp or nonce mechanism. HMAC-SHA256 verifies payload integrity only. For defense-in-depth, consider checking for duplicate `id` (UUID) to deduplicate within a time window, or add a custom timestamp header from the receiving server.
```

---

## Informational Findings

### 7. Notion Missing from Platform Registry

**Issue:** Notion has no entry in `packages/contracts/src/platform-registry.ts`. The connector design doc (§11) lists config fields (`integration_token`, `workspace_id`, `bot_user_id`, `database_id`, `webhook_verification_token`, `webhook_secret`, `poll_interval_seconds`) but these are not registered. No `secretType` values (`api_key`, `webhook_secret`) are assigned.

**Why it matters:** Without registry entries, the admin panel cannot surface Notion credential fields, and the connector contract is not enforced. OAuth config fields (`oauth_client_id`, `oauth_client_secret`, `oauth_redirect_uri`) are also missing despite §2 documenting OAuth.

**Correction** — add a Notion entry to the platform registry. Minimum fields for MVP:

```typescript
notion: {
  key: 'notion',
  displayName: 'Notion',
  description: 'Connect Notion databases as a knowledge-base and ticket source.',
  category: 'project-management',
  iconSlug: 'notion',
  defaultDirection: 'both',
  defaultIntakeMode: 'webhook',
  supportsCustomServer: false,
  supportsOAuth: true,
  configFields: [
    {
      key: 'integration_token',
      label: 'Integration Token',
      type: 'password',
      placeholder: 'secret_...',
      helpText: 'Create a Notion integration at notion.so/profile/integrations. Share pages/databases with the integration.',
      required: true,
      secretType: 'api_key',
    },
    {
      key: 'workspace_id',
      label: 'Workspace ID',
      type: 'text',
      placeholder: 'abc123...',
      helpText: 'Found in Notion workspace settings or via GET /v1/users/me response.',
      required: true,
    },
    {
      key: 'database_id',
      label: 'Ticket Database ID',
      type: 'text',
      placeholder: 'abc123...',
      helpText: 'The Notion database ID to use for ticket pages. Copy from the database URL.',
      required: true,
    },
    {
      key: 'webhook_verification_token',
      label: 'Webhook Verification Token',
      type: 'password',
      placeholder: '...',
      helpText: 'One-time token received during webhook subscription setup. Paste it back in the Notion UI to verify.',
      required: false,
      secretType: 'webhook_secret',
    },
  ],
}
```

For OAuth variants: add `oauth_client_id`, `oauth_client_secret`, `oauth_redirect_uri`, `oauth_access_token`, `oauth_refresh_token`.

---

### 8. OAuth Multi-Tenant Per-User Install Burden Understated

**Issue:** The doc (§10 gotcha #7) says "Per-tenant OAuth requirement: each tenant to separately install the OAuth app. Notion does not support workspace-level authorization — only per-user installs." This is accurate but understated. The key implication for auth design is: **each human user in each tenant workspace must individually authorize and install the OAuth app** before the integration can access pages in that workspace. There is no service-account or workspace-admin-delegated install.

**Why it matters:** For a SaaS multi-tenant deployment, SupportAgent cannot give the connector access to a tenant's workspace without the tenant's end-users going through an OAuth install flow. This is significantly different from platforms like Linear where a workspace admin can pre-approve an app for all users.

**Correction** in §2, OAuth section. Add:
```
- **Multi-tenant limitation**: Each individual user in each tenant workspace must install the OAuth app separately. There is no workspace-level or admin-delegated install. For multi-tenant SupportAgent, either accept per-user OAuth installs, or default to integration tokens for single-workspace deployments and reserve OAuth for multi-tenant setups where each tenant explicitly onboards.
```

---

## Verified Correct

- Integration token header: `Authorization: Bearer {token}` — correct
- Integration token lifetime: static, no expiry, revocable — correct
- OAuth authorization URL: `https://api.notion.com/v1/oauth/authorize` — correct
- OAuth token exchange: `POST https://api.notion.com/v1/oauth/token` with HTTP Basic — correct
- OAuth token use header: `Authorization: Bearer {access_token}` — correct
- OAuth scope model: no granular scopes, page-sharing model — correct
- No cross-workspace tokens — correct
- Webhook signature algorithm: HMAC-SHA256 — correct
- Webhook header: `X-Notion-Signature: sha256={hex}` — correct (the `sha256=` prefix is present)
- Webhook message: minified JSON body — correct
- Webhook verification token used as HMAC key — correct
- Webhook registration: UI-only, no API — correct
- Public SSL URL required for webhooks — correct
- MVP recommendation (integration token vs OAuth) is justified — correct

---

## Summary of Changes Needed

| Priority | Section | Change |
|---|---|---|
| CRITICAL | §2 OAuth | Add required `owner: "user"` parameter |
| CRITICAL | §2 OAuth | Document refresh token rotation (new refresh token on every refresh) |
| MODERATE | §2 OAuth | Add note that access token lifetime is undocumented, proactive refresh needed |
| MODERATE | §2 capabilities | Split "Manage webhooks" into registration vs delivery, remove capability framing |
| MODERATE | §2 capabilities | Rename "Read content" / "Comment" columns; Notion uses page sharing, not capability strings |
| MODERATE | §2 webhook | Add note that replay protection mechanism is undocumented |
| INFO | platform-registry | Add Notion entry with config fields and secretType values |
| INFO | §2 OAuth | Add note about per-user install burden for multi-tenant |
