# Bitbucket Connector — Hosting Variants & Version Drift Review

**Reviewed**: 2026-04-18
**Reviewer model**: claude-sonnet-4-6
**Source doc**: `docs/connectors/bitbucket.md`
**Scope**: Cloud vs self-hosted variants, API versioning, deprecations, feature matrix, regional gotchas

---

## Verdict

**Mostly accurate with several significant gaps and one material error.** The doc correctly covers the two main variants (Cloud and Data Center/Server) at a high level and gets API base URLs right. However, it misses a critical in-progress authentication deprecation (App Passwords), contains a wrong webhook event name, omits important Data Center version-gated behavior changes (Basic Auth disabled by default in 10.0, OAuth 2.0 availability), understates the Server EOL date, and contains inaccurate rate-limit data.

---

## Findings

### 1. Server EOL — date not stated

- **Variant affected**: Bitbucket Server
- **What the doc says**: "Data Center/Server (note: Server EOL)" in the header table — no date given.
- **Correction**: Bitbucket Server reached end of support on **February 15, 2024**. Bitbucket Server 8.14 was the last feature release. Support continued until March 19, 2024 for customers with a Data Center license. The doc should state the concrete EOL date so implementers know they are dealing with a fully unsupported product and should plan accordingly. Data Center itself is _not_ EOL — individual DC versions have their own LTS support windows (e.g., 9.4 LTS supported until December 2026, 10.0 until September 2027).

---

### 2. App Passwords deprecated — doc recommends them as MVP preferred

- **Variant affected**: Bitbucket Cloud
- **What the doc says**: Section 2.1.1 marks App Passwords as "**MVP preferred**" and section 2.1.3 documents App Passwords without any deprecation warning.
- **Correction**: App Passwords are actively deprecated with hard sunset dates:
  - **Phase 2 — September 9, 2025**: New App Passwords can no longer be created. (Already passed.)
  - **Phase 3 — June 9, 2026**: All remaining App Passwords are permanently disabled.
  The correct replacement is **API tokens** (personal access tokens created via Atlassian account settings → Security → API tokens). API tokens require an expiry date at creation (maximum 1 year) and use Basic auth with the Atlassian account email as username. The doc must be updated to recommend API tokens as the MVP path and warn that App Passwords will stop working entirely before June 2026.

---

### 3. API tokens not documented at all

- **Variant affected**: Bitbucket Cloud
- **What the doc says**: No mention of API tokens as a distinct credential type anywhere in the document.
- **Correction**: API tokens are now the standard long-term personal access token for Cloud. Key differences from App Passwords:
  - Scopes use the same names as OAuth 2.0 scopes (e.g., `repository`, `pullrequest:write`).
  - Mandatory expiration (up to 1 year) — tokens are not non-expiring like App Passwords were.
  - Basic auth: username is the **Atlassian account email** (not Bitbucket username).
  - Cannot view or modify permissions after creation.
  The doc should add a section for API tokens and update the scope and auth header guidance accordingly.

---

### 4. Wrong webhook event name — `pullrequest:request_change`

- **Variant affected**: Bitbucket Cloud
- **What the doc says**: Section 3.1.2 lists `pullrequest:request_change` as a Cloud webhook event for "Changes requested", and section 11 includes it in the MVP webhook events list.
- **Correction**: This event key **does not exist** in Bitbucket Cloud. The correct event keys are:
  - `pullrequest:changes_request_created` — user requests changes on a PR
  - `pullrequest:changes_request_removed` — user removes a change request
  The doc is also missing two newly documented comment lifecycle events:
  - `pullrequest:comment_resolved` — user resolves a comment
  - `pullrequest:comment_reopened` — user reopens a comment
  Using `pullrequest:request_change` in a webhook registration call will silently fail or be rejected by the API.

---

### 5. `pullrequest:needs_review` event — not a Cloud event

- **Variant affected**: Bitbucket Cloud vs Data Center
- **What the doc says**: Section 3.1.2 lists `pullrequest:needs_review` as a Cloud event. Phase 2 scope (section 11) also lists it as an additional Cloud webhook event.
- **Correction**: `pullrequest:needs_review` does not appear in the official Bitbucket Cloud event payloads documentation. The equivalent on Data Center is `pr:reviewer:needs_work`. On Cloud there is no direct "needs review" event; the closest is the review state being reflected in `pullrequest:updated`. The doc should remove `pullrequest:needs_review` from the Cloud event list and note the Data Center equivalent.

---

### 6. Data Center OAuth 2.0 — understated and misclassified

- **Variant affected**: Bitbucket Data Center
- **What the doc says**: Section 2 lists auth methods for Data Center as "OAuth 1.0a + Basic Auth + PAT". Section 1 overview table confirms this. OAuth 2.0 is not mentioned for Data Center at all.
- **Correction**: Bitbucket Data Center has supported OAuth 2.0 since version 7.21. Key milestones:
  - **7.21+**: OAuth 2.0 via Application Links
  - **8.x+**: OAuth 2.0 token generation/refresh scripts
  - **10.0**: OAuth 2.0 Client Credentials (2LO) for REST endpoints
  - **10.1**: OAuth 2.0 for app links and Service Accounts
  OAuth 1.0a is legacy and should be flagged as such. The doc should add OAuth 2.0 as the modern option for Data Center (7.21+) and note OAuth 1.0a as legacy/available only on older instances.

---

### 7. Basic Auth disabled by default in Data Center 10.0 (new instances)

- **Variant affected**: Bitbucket Data Center
- **What the doc says**: Section 2.2.2 presents Basic Authentication as a normal option with no version caveats. Section 10.6 notes the concern but does not mention the version.
- **Correction**: Starting with **Bitbucket Data Center 10.0**, Basic Auth is **disabled by default for REST API calls on new instances**. Upgraded instances keep it enabled for backward compatibility. Administrators can toggle it in Authentication Methods settings. This is a significant behavioral difference: connectors targeting fresh DC 10.x installs will fail with Basic Auth unless the admin explicitly re-enables it. The doc should flag `>= 10.0 (new instances)` as requiring PAT or OAuth 2.0 instead of Basic Auth.

---

### 8. Rate limits — free tier figure is wrong, scaled limits not mentioned

- **Variant affected**: Bitbucket Cloud
- **What the doc says**: Section 8.1 shows two tiers: "Authenticated (free): 60 requests/hour" and "Authenticated (paid workspace): 1000 requests/hour".
- **Correction**: The actual Cloud rate limits are:
  - **Unauthenticated**: 60 requests/hour (correct).
  - **All authenticated requests**: 1,000 requests/hour base — this applies to all authenticated users, not just paid workspaces. The "authenticated (free) = 60" row is **wrong**.
  - **Scaled limits**: Standard/Premium workspaces with >100 paid users receive `1,000 + (paid_users - 100) × 10` requests/hour, capped at **10,000/hour**. This requires workspace/project/repository access tokens (not user tokens) to qualify.
  - **Per-token isolation**: Each access token has its own rate limit bucket. OAuth calls are measured against the OAuth consumer.
  - **`X-RateLimit-NearLimit`** header (not `X-RateLimit-Reset`) signals when remaining falls below 20% — the header name in section 8.1 is approximately correct but the near-limit behavior is undocumented.

---

### 9. Webhook signature header — `X-Hub-Signature-256` secondary header note is correct but incomplete

- **Variant affected**: Bitbucket Cloud
- **What the doc says**: Section 3.1.3 lists both `X-Hub-Signature` and `X-Hub-Signature-256` — this is accurate. Appendix B mentions `sha256` preference over `sha1`.
- **Correction**: Minor clarification needed — Bitbucket's official docs warn that the hash algorithm **may change in future**, so hardcoding `sha256` comparison logic could break. The doc should note this caveat. Additionally, the `X-Hub-Signature` header is **not sent when using the UI Test button** — only actual event deliveries include it — which is relevant to connector testing logic.

---

### 10. Feature matrix gaps — Atlassian Connect / Forge version minimum

- **Variant affected**: Data Center
- **What the doc says**: Section 10.1 states "Atlassian Connect / Forge: Cloud + Data Center 7.17+".
- **Correction**: Atlassian Forge on Data Center has a higher minimum version requirement than 7.17 and requires the Forge remote feature to be enabled. The 7.17 figure may apply to Connect (older framework) but not to Forge. This should be verified against the Atlassian developer docs before implementation, as Forge vs Connect are distinct extension frameworks with separate version gates.

---

### 11. `project:write` scope deprecation not noted

- **Variant affected**: Bitbucket Cloud
- **What the doc says**: Section 2.1.2 and 2.1.1 do not mention `project:write` scope.
- **Correction**: The `project:write` scope has been deprecated and replaced by `project:admin` on Bitbucket Cloud. Any scope lists that include `project:write` will receive deprecation warnings. The doc's current scope lists do not include this scope, so the impact is low, but it should be noted for completeness if project-level webhook registration is added.

---

### 12. No regional / data-residency variants documented

- **Variant affected**: Bitbucket Cloud
- **What the doc says**: No mention of regional variants or data residency options.
- **Correction**: Bitbucket Cloud itself does not offer tenant-selectable regional deployment the way Jira Cloud does (Jira has AU/EU regions). The `api.bitbucket.org` base URL is global. However, as of May 4, 2026, all OAuth 2.0 authenticated API requests must go to `https://api.bitbucket.org` (the doc already has the correct base URL). No regional gotchas are applicable here beyond noting the absence of residency options — the doc should explicitly note that Cloud is single-region global with no data-residency variant, to set implementer expectations.

---

## Summary Table

| # | Severity | Area | Issue |
|---|----------|------|-------|
| 1 | Medium | Server EOL | EOL date (Feb 15, 2024) not stated |
| 2 | **High** | Cloud auth | App Passwords recommended as MVP; already in phase 2 of deprecation, fully dead June 2026 |
| 3 | **High** | Cloud auth | API tokens not documented at all |
| 4 | **High** | Cloud webhooks | `pullrequest:request_change` is an incorrect event name; correct names are `pullrequest:changes_request_created` / `pullrequest:changes_request_removed` |
| 5 | Medium | Cloud webhooks | `pullrequest:needs_review` is not a Cloud event |
| 6 | Medium | Data Center auth | OAuth 2.0 available since DC 7.21, not mentioned |
| 7 | **High** | Data Center auth | Basic Auth disabled by default on new DC 10.0+ instances — not documented |
| 8 | Medium | Cloud rate limits | Free-tier "60/hr authenticated" figure is wrong; scaled limits undocumented |
| 9 | Low | Cloud webhooks | Missing caveat that hash algorithm may change; Test button doesn't send signature |
| 10 | Low | Feature matrix | Forge DC minimum version claim needs verification |
| 11 | Low | Cloud scopes | `project:write` deprecation not noted |
| 12 | Low | Regional | Absence of regional variants not explicitly stated |
