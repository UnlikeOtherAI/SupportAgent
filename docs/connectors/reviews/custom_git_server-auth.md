# Custom Git Server Connector — Authentication & Credentials Review

## Verdict

**CONDITIONALLY ACCURATE — several field-level errors and notable gaps.** The doc correctly identifies the primary auth mechanisms (PAT, Basic, SSH, webhook HMAC) for most platforms. However, it contains incorrect header names, inaccurate scope listings, a deprecated OAuth claim for Azure DevOps, and missing coverage of OAuth scopes and modern Entra ID auth. Implementors should not rely on the header formats or scope tables without verification.

---

## 1. Auth Mechanism Inventory

### Missing: Gitea/Forgejo OAuth2 scopes

The doc briefly mentions OAuth2 for Gitea/Forgejo/GitLab in Section 2.4 but immediately dismisses it as irrelevant for server-side connectors. This is a defensible architectural decision, but the dismissal is incomplete — OAuth2 token format, scope names, and token lifetime are not documented at all. If any SupportAgent flow ever needs to support OAuth (e.g., a user-delegated scenario), there is no reference. Given that the doc explicitly defers OAuth to Phase 2, at minimum it should note the existence of OAuth2 as a supported-but-deferred path and list the scope shape.

**Why it matters:** The connector will eventually need to handle OAuth2 callbacks or token refresh if any tenant opts into the Phase 2 OAuth path. Without a scope reference, implementation will require independent research.

**Concrete correction:** In Section 2.4, add a note: "Gitea/Forgejo/GitLab support OAuth2 authorization code flow with scopes including `repo`, `read:user`, `write:repository`, `read:issue`, `write:misc`, `read:notification`. Exact scopes available depend on instance configuration. Token lifetimes are configurable by instance admin (default 30 days). If OAuth is needed in a future phase, consult the platform's swagger docs for the definitive scope list."

### Missing: Azure DevOps OAuth2 deprecation

The doc does not mention Azure DevOps OAuth at all in the auth section, which is a significant gap. Azure DevOps Services' OAuth 2.0 (the non-Entra variant) is deprecated and no longer accepts new registrations as of April 2025, with full deprecation in 2026. For Azure DevOps Server, OAuth2 is not available at all — only PATs, client libraries, and Windows Authentication work.

**Why it matters:** A tenant following this doc might attempt to implement Azure DevOps OAuth and discover it is no longer supported. For Azure DevOps Server specifically, they would never succeed.

**Concrete correction:** Add an Azure DevOps OAuth note to Section 2: "Azure DevOps Services' native OAuth2 is deprecated (no new registrations as of April 2025, full deprecation 2026). Microsoft Entra ID OAuth is the current recommendation. Azure DevOps Server does not support OAuth2 at all — use PAT instead."

---

## 2. Header Format Accuracy

### Bitbucket DC webhook header: wrong header name

Section 2.5 and Section 3.1.3 state Bitbucket DC v8.0+ uses `X-Hub-Signature` for HMAC webhook verification. The correct header per Atlassian's Bitbucket Server documentation is `X-Hub-Signature-256` (SHA-256 variant). Bitbucket DC does not use the GitHub-style `sha256=` prefix; it sends the raw HMAC hex digest directly as the header value, but the header name itself is `X-Hub-Signature-256`.

**Why it matters:** A connector built on the wrong header name will never read the signature and will fail to verify payloads. Unverified webhooks are a security risk.

**Concrete correction:** Change `X-Hub-Signature` to `X-Hub-Signature-256` in the webhook signature table and in the Bitbucket DC section. Also note: no `sha256=` prefix — the raw HMAC hex digest is sent as the header value.

### Azure DevOps webhook signature: format unverifiable and possibly wrong

Section 2.5 and Section 3.1.5 state the Azure DevOps HMAC webhook signature is sent as `Authorization: HmacSHA256={base64_hmac}`. The authoritative Microsoft docs page for secure Azure DevOps service hook webhooks returned a 404, and the general service hooks overview does not confirm this exact header format. The value may be base64-encoded HMAC-SHA256, but the header name and format should be verified against the actual `/service-hooks/secure-webhooks` reference.

**Why it matters:** If the header name is wrong, the connector cannot read the signature from inbound webhooks.

**Concrete correction:** Add a note: "Azure DevOps webhook signature header format (`Authorization: HmacSHA256=...`) should be verified against https://learn.microsoft.com/en-us/azure/devops/service-hooks/secure-webhooks before implementation. Do not assume the header format without confirming."

### Gitea/Forgejo PAT header: correct, but scopes are wrong

The doc correctly states Gitea uses `Authorization: token {token}` for PATs. However, the scopes listed in the table (`repo`, `read:user`, `write:repository`) do not match the actual Gitea scope model. Based on Gitea's API documentation, real scopes include `read:activitypub`, `read:issue`, `write:misc`, `read:notification`, `read:organization`, `read:package`, `read:repository`, `read:user` — and the naming convention is `read:X` and `write:X` (colon-separated), not dot-separated. The `repo` scope from GitHub does not exist in Gitea.

**Why it matters:** If the connector passes an unrecognized scope during an OAuth token request, the token will be issued without the expected permissions. This could lead to silent auth failures where API calls fail with 403 but the connector doesn't know why.

**Concrete correction:** Update the Gitea/Forgejo scopes in the table to reflect the actual Gitea scope naming: `read:repository`, `write:repository`, `read:user`, `read:issue`, etc. Add a note that the definitive scope list is available at the instance's swagger endpoint (`/api/swagger`).

### Gogs scope model: simplified but needs verification

The doc says Gogs has scopes `repo` and `user`. Gogs does have a simpler scope model, but whether it uses the same colon-separated naming as Gitea (`read:repository`, `write:repository`) or some other convention should be verified. Older Gogs versions may not have scopes at all.

**Why it matters:** Incorrect scope names will cause token issuance failures on Gogs instances.

**Concrete correction:** Add a note: "Gogs scope model should be verified per-instance. Older Gogs versions may not support token scopes. Use the instance's API docs or swagger endpoint to confirm available scopes."

---

## 3. Token Scope Requirements

### GitLab PAT scopes: incomplete listing

Section 2.2 lists GitLab PAT scopes as `api`, `read_api`, `admin_api`. GitLab actually supports many more scopes including `read_repository`, `write_repository`, `read_registry`, `write_registry`, `sudo`, `read_user`, `create_runner`, `manage_runner`. The `admin_api` scope requires the user to be a GitLab admin.

**Why it matters:** A connector requesting only `api` scope may get more permissions than needed (over-scoping), or may not have `read_repository` if that's all the tenant configured. More importantly, `sudo` scope allows bypassing permission checks — this is a high-privilege scope that should not be implicitly included.

**Concrete correction:** Expand the GitLab scopes table to include `read_repository`, `write_repository`, `read_user`. Note that `admin_api` requires admin status. Recommend `api` or `read_api` for MVP as they are the safest defaults.

### Azure DevOps PAT scopes: correctly named but incomplete

Section 2.2 lists Azure DevOps scopes as `vso.code`, `vso.work`, `vso.project`. The actual scope names use underscores, not dots — `vso.code`, `vso.work`, `vso.project` are actually correct in the abbreviated form shown, but the full namespaced scopes are broader: `vso.code_full`, `vso.work_full`. The scope inheritance table (e.g., `vso.code_manage` includes `vso.code_write` which includes `vso.code`) should be documented.

**Why it matters:** Without understanding scope inheritance, an implementor might request `vso.code` for read-only operations but implicitly get more than intended, or vice versa.

**Concrete correction:** Add scope inheritance information: `vso.code` (read) < `vso.code_write` (write) < `vso.code_manage` (manage) < `vso.code_full` (full). Same pattern for `vso.work`.

---

## 4. Token Lifetime and Refresh Semantics

### GitLab PAT expiry: partially wrong

Section 2.2 states GitLab SM PATs "can be never-expire." Regular GitLab personal access tokens **must** have an expiry date — the default is 365 days, and admins can configure the maximum lifetime, but "never-expire" is only available for service account tokens (special tokens for non-human accounts), not regular user PATs. This is a meaningful distinction.

**Why it matters:** A tenant following this guidance might expect to create a PAT without an expiry date and find that their GitLab instance enforces a maximum. Conversely, the connector might need to handle token expiry for normal user PATs and implement rotation.

**Concrete correction:** Clarify: "Regular GitLab PATs must have an expiry date (default 365 days, configurable by instance admin as maximum). Only service account tokens can be created without expiry. Implement token expiry handling for regular PATs."

### Azure DevOps PAT expiry: missing nuance

Section 2.2 says Azure DevOps PATs are "non-expiring unless revoked." This is outdated. Azure DevOps PATs can have expiry dates set during creation. More importantly, for Entra ID-backed organizations (common in enterprise), a PAT becomes inactive if the user doesn't sign in within 90 days. This is a subtle behavior that differs from self-hosted AD.

**Why it matters:** A connector using a PAT on an Entra ID-backed Azure DevOps organization may find the PAT stops working after 90 days of inactivity — even if it was created as non-expiring.

**Concrete correction:** Add a note: "For Azure DevOps organizations backed by Microsoft Entra ID, PATs become inactive if the associated user does not sign in within 90 days. PATs created for service accounts or automation should have expiry dates set and rotation scheduled."

### Azure DevOps PAT format: missing critical detail

The doc correctly notes PATs are sent as Basic auth with `base64(user:PAT)` format. However, the actual format for curl/http usage is `Authorization: Basic base64(":PAT")` — the username portion is typically empty (colon only). The MS docs show `curl -u :{PAT}` as the recommended approach. This distinction matters for raw HTTP implementations.

**Why it matters:** If the connector constructs the Basic auth header with a literal username string, the request will fail authentication.

**Concrete correction:** In the Azure DevOps PAT header row, add a note: "Use empty username (colon only): `base64(':' + PAT)`. Equivalent curl: `curl -u :{PAT}`."

---

## 5. Webhook Signature Verification

### Azure DevOps HMAC: header format unconfirmed

The doc states Azure DevOps uses `Authorization: HmacSHA256={base64_hmac}`. This format was not confirmed against the authoritative Microsoft docs (the secure-webhooks page returned a 404). The MS overview page for service hooks does not document the HMAC header format.

**Why it matters:** Implementing against an unconfirmed header format means webhook signature verification will silently fail — every webhook would be treated as unverified.

**Concrete correction:** Mark this as unverified and add a verification task. Do not ship the Azure DevOps webhook signature implementation without confirming against the actual `/service-hooks/secure-webhooks` docs.

### GitLab webhook: correct (plain token, not HMAC)

The doc correctly states GitLab SM uses `X-Gitlab-Token` as a plain shared secret, not an HMAC. Section 10.3 also correctly documents this. This is accurate and well-documented.

### Gitea/Forgejo webhook: correct (HMAC-SHA256)

The doc correctly shows `X-Gitea-Signature` and `X-Forgejo-Signature` with `sha256={hmac_hex_digest}` format. This matches the actual Gitea implementation.

### Bitbucket DC v8.0+ HMAC: partially correct (wrong header name)

As noted in Section 2, the header is `X-Hub-Signature-256` (not `X-Hub-Signature`), and the value is the raw hex digest without the `sha256=` prefix. This needs correction.

### Missing: webhook replay protection

None of the webhook signature sections mention replay protection (e.g., timestamp validation, nonce tracking). For Gitea/Forgejo, Gogs, and GitLab, there is no built-in replay protection beyond the HMAC itself. For Azure DevOps, the security model depends on TLS + shared secret. The doc should warn that webhook endpoints must implement their own replay protection (e.g., a short TTL window for event timestamps) to prevent replay attacks.

**Why it matters:** An attacker who captures a valid webhook payload could replay it indefinitely. Without timestamp-based replay protection, the HMAC verification alone is insufficient.

**Concrete correction:** Add a note to each webhook signature section: "HMAC verification alone does not protect against replay attacks. The connector should implement replay protection by storing and comparing a recent event ID list, or by checking a timestamp within the payload and rejecting events older than a configurable TTL (e.g., 5 minutes)."

---

## 6. Multi-Tenant OAuth App Requirements

### Not applicable for this connector class

The doc correctly notes (Section 10.6) that self-managed platforms have per-instance isolation — there is no centralized OAuth app installation model like GitHub.com's. Each tenant registers their own OAuth app in their own instance. The doc does not need to cover multi-tenant OAuth app patterns.

However, the doc should note: if SupportAgent ever offers an OAuth-based setup flow for Gitea/Forgejo/GitLab SM, the connector code must handle per-tenant OAuth app registration and callback handling. This is deferred to Phase 2 but should be flagged.

**Why it matters:** Without this flag, a future implementor might attempt to implement a single shared OAuth app and hit the architectural mismatch with self-hosted instances.

**Concrete correction:** In Section 2.4, add: "For Phase 2 OAuth support: each tenant must register their own OAuth application in their self-hosted instance. SupportAgent would need to provide an OAuth callback endpoint and handle per-tenant token storage."

---

## 7. Secret Type Classification

### Not covered in scope of this review

The doc does not currently classify credentials into types (`api_key`, `webhook_secret`, `service_account`, etc.) in any structured way. The review criteria ask to verify this classification, but the document does not contain it, so this is N/A.

---

## 8. MVP Recommendation: PAT vs OAuth

### Justifiable, with one caveat

The doc recommends PAT as MVP over OAuth, citing setup complexity without benefit for server-side connectors. This is reasonable. However, the Azure DevOps OAuth deprecation adds a secondary justification that should be included: Azure DevOps's native OAuth2 is deprecated and will stop working in 2026, making PAT the only viable option for Azure DevOps Server and the recommended fallback for Azure DevOps Services.

**Why it matters:** The recommendation is correct but the reasoning is incomplete. A future reader might wonder why OAuth isn't considered for Azure DevOps and investigate it, only to find it is deprecated.

**Concrete correction:** Add to the MVP recommendation in Section 2.6: "Azure DevOps native OAuth2 is deprecated (no new registrations as of April 2025, full deprecation 2026), making PAT the only viable long-term option for Azure DevOps."

---

## 9. Security Advice Gaps

### No mention of secret rotation or leaked PAT detection

The doc does not advise on PAT rotation frequency or how to handle leaked tokens. For Azure DevOps, the platform has automatic leaked PAT revocation (scans public GitHub repos). For other platforms, there is no such protection.

**Why it matters:** A tenant following this doc might use a PAT indefinitely without rotation. If the PAT is ever leaked (e.g., committed to a repo), the platform may or may not have automatic protection.

**Concrete correction:** Add a security note to Section 2: "PAT rotation: recommend 90-day rotation for production use. Store PATs in a secrets manager (not environment variables or config files). For Azure DevOps, note that leaked PATs in public GitHub repos are automatically revoked. For self-hosted Gitea/Forgejo/Gogs/GitLab, there is no automatic revocation — rotate manually if the token is exposed."

### No mention of TLS certificate validation

Section 10.5 mentions `skipTlsVerification` for self-signed certs, which is correct. However, the auth section does not address that PATs and tokens sent over HTTPS are protected in transit, but raw git SSH keys require host key verification. This is partially covered in the config interface (`sshKnownHosts`) but should be explicitly called out as a security consideration.

**Why it matters:** A tenant who skips SSH host key verification (`sshKnownHosts` not set) is vulnerable to MITM attacks on git operations.

**Concrete correction:** In the SSH key section (2.3), add: "SSH host key verification must be configured via `sshKnownHosts` to prevent MITM attacks. Never accept the first connection without verification."

---

## 10. Contradictions and Internal Consistency

### No major contradictions found

The auth sections are internally consistent. However, Section 2.5 says GitLab uses "plain shared secret (not HMAC)" for webhook signatures, and Section 10.3 repeats this. This is correct and consistent throughout.

### One inconsistency: Bitbucket DC header

The webhook header table (Section 2.5) and the Bitbucket DC section (Section 3.1.3) both say `X-Hub-Signature`, which as noted is wrong — it should be `X-Hub-Signature-256`. This is a consistent error but still an error.

---

## Summary of Required Corrections

| # | Finding | Severity | Section |
|---|---|---|---|
| 1 | Bitbucket DC webhook header is `X-Hub-Signature-256` (not `X-Hub-Signature`); value is raw hex without `sha256=` prefix | High | 2.5, 3.1.3 |
| 2 | Azure DevOps OAuth2 is deprecated (no new registrations April 2025, full deprecation 2026) — not mentioned | Medium | 2.4, 2 |
| 3 | Gitea scope names wrong (`repo` → `read:repository`, `write:repository` etc.) | Medium | 2.2 |
| 4 | GitLab PAT scopes incomplete — missing `read_repository`, `write_repository`, `sudo`, `read_user` | Low | 2.2 |
| 5 | GitLab PAT "never-expire" claim wrong — only service account tokens can be no-expiry | Medium | 2.2 |
| 6 | Azure DevOps PAT inactive after 90 days sign-in requirement for Entra ID-backed orgs not mentioned | Medium | 2.2 |
| 7 | Azure DevOps PAT Basic auth format needs clarification (`base64(':' + PAT)`) | Low | 2.2 |
| 8 | Azure DevOps webhook HMAC header format unverified (docs returned 404) | High | 2.5, 3.1.5 |
| 9 | No webhook replay protection documented | Medium | 2.5, all webhook sections |
| 10 | No secret rotation guidance | Low | 2 |
| 11 | SSH host key verification security note missing | Low | 2.3 |
| 12 | Gogs scope model unverified (may not exist on older versions) | Low | 2.2 |
| 13 | Azure DevOps PAT 84-char format with `AZDO` signature not documented | Low | 2.2 |
| 14 | Multi-tenant OAuth note for Phase 2 missing | Low | 2.4 |

---

*Review scope: Authentication and credentials only. Endpoint coverage, rate limits, and other non-auth topics are excluded.*