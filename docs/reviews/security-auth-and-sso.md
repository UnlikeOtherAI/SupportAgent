# Security Review — Authentication, SSO, Identity, Sessions, Machine Identity

Worktree: `worktree-agent-a6ae522a`
Date: 2026-05-16
Scope: standalone SaaS login, standalone enterprise SSO (UOA), integrated-mode token exchange, bearer token validation, JWKS / key handling, `runtimeApiKey` lifecycle, `workerSharedSecret` per-dispatch handling, identity-provider facade & `federated_identity_links`, session lifetime / CSRF / PKCE, audit coverage, human vs machine identity separation.

---

## Executive summary

The UOA SSO relying-party flow is largely well-built at the protocol level — PKCE, state cookie, RS256-signed config JWT, JWKS exposure, and `acceptedDispatchAttempt` enforcement are all correctly implemented. However, the surrounding identity surface has multiple severe gaps:

- The freshly-generated per-dispatch worker shared secret is **persisted in plaintext** inside the `WorkerDispatch.jobPayload` JSON column alongside its hashed form, defeating the whole purpose of column-level hashing.
- Connector secrets are **stored in plaintext** despite the column being named `encryptedValue`; the documented "encryption at rest" invariant is unmet.
- A simple `x-tenant-id` request header silently **overrides the JWT tenant claim** for skill and executor routes, breaking tenant isolation.
- The session JWT is delivered to the browser via a **URL query string**, which lands in browser history, referers, and proxy logs.
- The UOA `access_token` is consumed via `jose.decodeJwt` with **no signature verification** and no claim audience/issuer check; while UOA hands it to us over an authenticated backend channel, no defense-in-depth check exists.
- There are **zero `prisma.auditEvent.create` calls** in the entire API source — login, key issuance, secret rotation, and federation events go unaudited despite a populated `AuditEvent` schema.
- Documented features have **no implementation**: no `runtimeApiKey` lifecycle routes, no integrated-mode session-exchange endpoint, no identity-provider settings routes, no user/tenant models.

Address the Critical issues before any production rollout outside of dev/onboarding.

---

## Critical / High findings

| # | Sev | Area | Finding |
|---|-----|------|---------|
| C1 | Critical | Machine identity | Plaintext `workerSharedSecret` persisted in `WorkerDispatch.jobPayload` JSON. `dispatcher-service.ts:354` assigns `rawSecret` to `job.workerSharedSecret`, then `dispatcher-service.ts:421-436` writes that same `job` object into `workerDispatch.create({ data: { jobPayload: job as any, workerSharedSecret: hashedSecret } })`. The DB row contains both the SHA-256 hash and the plaintext, so an attacker with read access to one column trivially has it from the other. The hash column becomes security theater. Fix: strip `workerSharedSecret` from `job` before persisting `jobPayload`, or store only the dispatch ID and have the worker fetch the secret out-of-band. |
| C2 | Critical | Connector secrets | `connection_secrets.encryptedValue` is plaintext. `connector-repository.ts:63-90` accepts a parameter named `encryptedValue` and writes it as-is; `connector-service.ts:159-168` passes the raw user-supplied `value` straight in (`setConnectorSecret`). No envelope encryption, no KMS, no symmetric cipher anywhere. Brief promises "encryption at rest" for connector credentials; the schema field name is actively misleading. |
| C3 | Critical | Tenant isolation | `x-tenant-id` header overrides the JWT tenant. `resolve-tenant-id.ts:3-10` returns the header value when present, otherwise the JWT claim. Used by `/v1/skills` and `/v1/executors` routes. Any authenticated user can read or mutate another tenant's skill/executor configuration by adding one header. This bypasses the entire tenant-scoping model. |
| H1 | High | Session delivery | Session JWT delivered via URL query string. `auth.ts:419-426` sets `redirectUrl.searchParams.set('token', jwt)`; `AuthCallbackPage.tsx` reads it from `window.location.search`. JWT lands in browser history, server access logs, and any downstream `Referer` headers. Use a one-time exchange code or set an `HttpOnly` session cookie at the callback. |
| H2 | High | Token trust | UOA `access_token` decoded without verification. `auth.ts:347-353` uses `jose.decodeJwt`; the documented rationale (`auth.ts:342-346`) is that UOA holds the HMAC secret. Even so: no `iss` / `aud` / `exp` validation, no JTI replay defence, no clock-skew bound. If UOA later publishes a JWKS (`sso-uoa-doc-gaps.md` §5 explicitly requests this), this code must be upgraded — leaving a TODO comment is not enough. At minimum check `iss === 'authentication.unlikeotherai.com'`, `aud === 'uoa:access-token'`, and `exp > now`. |
| H3 | High | Audit | Zero `prisma.auditEvent.create` calls across the entire repo (grep confirms). The `AuditEvent` and `RuntimeApiKeyAuditEvent` tables exist in `schema.prisma` but are never written. No record of: SSO login success/failure, runtime API key issuance/revocation, federated identity link create/update, connector secret rotation, dispatch issue. Trust-model doc lists audit as a primary control. |
| H4 | High | Tenant bootstrap | `'default'` tenant fallback. `auth.ts:368-369` sets `tenantId = firstOrg?.orgId ?? 'default'`. Every UOA user without an org membership lands on the same tenant, with the role taken from the JWT (`auth.ts:370`) which is the UOA-platform role (`superuser` for the integration owner). First user with no org gets superuser rights on the shared `default` tenant. Should refuse login or hand control back to UOA via `firstLogin.capabilities.can_create_org`. |
| H5 | High | Role mapping | Role trust path crosses authority boundaries. `auth.ts:370` chains `firstOrg?.role ?? claims.role ?? 'member'`. `claims.role` is the **UOA-platform** role (per `sso-uoa-doc-gaps.md` §7) — a UOA superuser becomes our local superuser by default. The RP must own its own role mapping, not inherit it from the IdP claim. |
| H6 | High | Missing surface | No `runtimeApiKey` lifecycle routes exist (grep: no `/v1/runtime-api-keys` registration in `app.ts`). `RuntimeApiKey` and `RuntimeApiKeyAuditEvent` tables are present but no issue/list/revoke/rotate endpoints. Brief & contracts doc require these. |
| H7 | High | Missing surface | No integrated-mode token-exchange endpoint. `deployment-modes.md` describes a docgen → SupportAgent session-mint exchange; no `/v1/integrations/*` route registered in `app.ts`. The mode is undeployable as documented. |

---

## Medium findings

| # | Area | Finding |
|---|------|---------|
| M1 | Key material | RS256 private key imported with `extractable: true`. `uoa.ts:37-39`. Allowing extractable keys lets any code path call `exportJWK` and recover the private material; the comment in the file claims this is needed only to derive the public JWK, which can be done once at boot. Import non-extractable, cache the derived public JWK, and never re-export. |
| M2 | Machine identity | `workerSharedSecret` has no TTL. `WorkerDispatch` schema has `createdAt` but no `expiresAt`; `worker-auth.ts:20-65` accepts any secret tied to a dispatch regardless of age. A leaked dispatch payload is reusable until the dispatch is deleted. Enforce a deadline tied to `timeoutSeconds` of the job, or `createdAt + 1h`. |
| M3 | Machine identity | Legacy plaintext fallback path in `worker-auth.ts:40-62`. The code looks up `{ workerSharedSecret: secret }` (plaintext) and silently migrates to hashed on first use. This is a permanent backdoor: any old row that was written plaintext can be replayed. Either confirm all rows are hashed via a migration and remove the fallback, or hard-fail after a cutover date. |
| M4 | OAuth | No PKCE on connector OAuth. `connector-oauth.ts` uses a state JWT but no `code_verifier` / `code_challenge`. Connector OAuth handles secrets equally sensitive to the SSO flow; PKCE should be on. |
| M5 | Session | No refresh-token usage. UOA returns `refresh_token` and `refresh_token_expires_in` (`auth.ts` callback `token` shape) but the RP discards them. Local JWT has a fixed 24h expiry (`auth.ts:416`), so users are silently logged out after a day with no re-auth path beyond a fresh SSO bounce. |
| M6 | Rate limiting | No rate limit on `/v1/auth/*`. `app.ts:40-79` does not register `@fastify/rate-limit`. Brute-force protection on `/dev-login` (dev only), `/providers/:key/callback`, and `/v1/auth/sso-config` is left to upstream Cloud Run, which only has per-instance limits. |
| M7 | Cookie hygiene | `@fastify/cookie` registered without a signing secret. `app.ts:58` is `app.register(cookie)` with no options. Cookies set via `reply.setCookie(..., { signed: true })` would error; the state cookie is JWT-signed at the application layer (`auth.ts:242`) so it works today, but anyone adding a signed cookie later will hit a footgun. Pass `{ secret: env.JWT_SECRET }` for defense in depth. |
| M8 | Input hygiene | Email used to derive `displayName` and `orgName` with no validation. `auth.ts:361-371`. UOA-supplied email of `<script>@x` becomes `<script>` as `displayName`. React escapes by default, but the value flows into the URL query string at `auth.ts:422` and could surprise downstream consumers. Validate format, length-cap, and strip control chars. |
| M9 | JWT plugin | `@fastify/jwt` registered with no `verify` claim validation. `plugins/auth.ts` accepts any token signed by `JWT_SECRET`; no `iss`, no `aud`, no `nbf`/`iat` checks. With a shared `JWT_SECRET` between session JWT and state-cookie JWT (`auth.ts:242` uses the same secret), a leaked session token can be replayed as a state cookie and vice versa. Use separate secrets, or tag tokens with `aud: 'session'` vs `aud: 'sso-state'` and verify on each side. |

---

## Low / hygiene findings

| # | Area | Finding |
|---|------|---------|
| L1 | Info leak | `maskedHint` leaks secret length. `connector-service.ts:166` masks via `'*'.repeat(value.length - 4) + last4`. For short API keys, byte length is sensitive. Use a fixed-width mask. |
| L2 | Frontend storage | Session JWT persisted to `localStorage` via zustand `persist` (`apps/admin/src/lib/auth.ts`). XSS-readable. With an `HttpOnly` cookie + CSRF token it would be safer; out of scope for SSO but recorded for trust-model alignment. |
| L3 | Logging | `auth.ts:351` logs the full UOA token object on decode failure (`{ err, token }`). At minimum redact `access_token` and `refresh_token` before logging. |
| L4 | Misc | `IdentityProvider` row is reused as a per-tenant settings store in `routes/settings.ts`. Mixing identity-provider config with tenant settings will cause schema drift; add a `TenantSettings` model. |
| L5 | Admin surface | Admin app references routes that the API does not register (`/v1/runtime-api-keys`, `/v1/users`, `/v1/audit-events`, `/v1/settings/identity-providers`). User will see 404s. Either ship the routes or hide the pages. |
| L6 | Dev login | `/v1/auth/dev-login` issues a token for fixed UUIDs `00000000-...-001` / `...-002` with `role: 'admin'` (`auth.ts:165-171`). Gated by `NODE_ENV !== 'production' && !UOA_CLIENT_SECRET`, which is correct, but document the fact that a production deployment without `UOA_CLIENT_SECRET` (the documented Phase-1 onboarding window) is wide open to anyone who hits `/dev-login` — even with `NODE_ENV=production` set the guard rejects it, but a misconfigured deploy with `NODE_ENV=development` would not. Worth a deployment-checklist note. |

---

## Verified-good practices

- **PKCE on UOA flow.** `auth.ts:240-265` generates a fresh verifier/challenge per start, stores the verifier in a signed state cookie, sends only the challenge to UOA, and includes the verifier on token exchange. `uoa.ts:88-106` uses crypto-strong `randomBytes(32)` + SHA-256. Within UOA's documented bounds (43-128 chars).
- **State cookie hardened.** `auth.ts:250-256`: `__Secure-` prefix, `HttpOnly`, `Secure`, `SameSite=lax`, scoped to `Path=/v1/auth/providers`, 5-minute TTL, JWT-signed body. Cleared on every callback branch (`auth.ts:282,287,306`).
- **`acceptedDispatchAttempt` enforcement.** `worker-auth.ts:67-73` rejects a stale dispatch even with a valid secret, preventing replay of a superseded dispatch.
- **Per-dispatch shared secret.** `dispatcher-service.ts:334-335` generates a fresh 32-byte secret per dispatch and stores the SHA-256 hash on the column (issue C1 above describes how the plaintext leaks via `jobPayload`; the hashing intent itself is correct).
- **JWKS exposure strips private components.** `uoa.ts:43-52` builds the public JWK by hand from `kty`/`n`/`e` only, defending against accidentally exposing `d`/`p`/`q` even if `exportJWK` returns them.
- **`client_hash` binds secret to domain.** `uoa.ts:82-84` computes `sha256(domain + secret)`; a leaked client secret cannot be replayed from a different host.
- **Tenant scoping enforced on most repositories.** Connector, runtime-api-key, executor, and skill repositories all filter `where: { ..., tenantId }`. The header bypass (C3) is the one breach.
- **Webhook signature verification.** `intake-service.ts` validates per-connector HMAC signatures before persisting inbound events.
- **No client-secret leakage in config JWT.** `uoa.ts` `signConfigJwt` payload schema (`ConfigJwtPayload`) only contains `domain`, `jwks_url`, `contact_email`, `redirect_urls`, `enabled_auth_methods`, `ui_theme`, `language_config`. Matches the "public-safe" invariant in `sso-uoa-onboarding.md`.
- **Phase-1 onboarding boundary.** `auth.ts:291-298` rejects `/callback` cleanly when `UOA_CLIENT_SECRET` is missing or malformed, redirecting to `/login?error=integration_pending` rather than leaking upstream 401s.

---

## Recommended remediation order

1. **C1, C2, C3** before any production rollout. These break the trust model.
2. **H1, H3** next sprint. URL-borne JWTs and missing audit are both visible and high-impact.
3. **H2, H4, H5** alongside the documented gaps reply to UOA (`docs/sso-uoa-doc-gaps.md` items 5–7).
4. **H6, H7** are net-new feature work; track against `deployment-modes.md` and `contracts.md` as gaps to close before the documented modes are "real."
5. Medium and Low items can be batched into hardening passes.

---

## Resolution notes (2026-05-16, branch `sec/auth-sso-uoa-hardening`)

| ID | File:Line of fix | Approach |
|----|------------------|----------|
| C3 | `apps/api/src/lib/resolve-tenant-id.ts:14` | `resolveTenantId` now returns `request.user.tenantId` unconditionally. The `x-tenant-id` header is no longer read. Unit-covered by `apps/api/src/lib/resolve-tenant-id.test.ts`. Service-to-service callers must mint a JWT whose `tenantId` claim already targets the tenant. |
| H1 | `apps/api/src/routes/auth-callback.ts:281-289`, `apps/api/src/lib/session-cookie.ts:1-37`, `apps/admin/src/pages/AuthCallbackPage.tsx`, `apps/admin/src/lib/api-client.ts`, `apps/admin/src/lib/auth.ts` | Session JWT now travels in an HttpOnly `__Host-abb_session` cookie set by the callback. The admin callback page is a clean URL (`/auth/callback` with no query). Identity is fetched via the new `/v1/auth/me` route. Admin requests use `credentials: 'include'`; the API plugin reads JWT from either bearer or cookie. |
| H2 | `apps/api/src/lib/uoa-token.ts:25-77`, `apps/api/src/routes/auth-callback.ts:138-156` | Replaced `decodeJwt` with `jwtVerify` against UOA's JWKS (`createRemoteJWKSet`), enforcing `iss`, `aud` (= `SSO_DOMAIN`), `exp`, and `nbf`. Production never falls back to decode; non-prod has a dev-only fallback for a UOA stub without JWKS. Unit-covered by `apps/api/src/lib/uoa-token.test.ts`. |
| H4 | `apps/api/src/routes/auth-callback.ts:185-195` | Removed the `'default'` tenant fallback. A federated identity with no `firstLogin.memberships.orgs[0].orgId` is refused with `error=no_tenant`; the admin callback page renders a "no tenant assigned" path. UOA-platform `claims.role` is no longer inherited — local role is taken only from the org-membership entry (defaults to `member`). |
| H3 (login subset) | `apps/api/src/services/audit-service.ts:1-42`, `apps/api/src/routes/auth-callback.ts:31-50` and at the success path | New thin `recordAuditEvent` helper writes `AuditEvent`. SSO records `login_succeeded`, `login_failed`, `identity_attached`, `account_created`. The `AuditAction` enum was extended via `prisma/migrations/20260516120000_auth_audit_actions_and_refresh_tokens/migration.sql` (drafted, not applied). |

### Refactor — splitting `auth.ts`

The original `apps/api/src/routes/auth.ts` was 431 LOC. Extracted along cohesive seams to keep all files under the 500-LOC project ceiling:

- `apps/api/src/lib/sso-state-cookie.ts` — PKCE state cookie sign/verify/clear.
- `apps/api/src/lib/session-cookie.ts` — HttpOnly session cookie helpers.
- `apps/api/src/lib/uoa-token.ts` — UOA token verification, decode-for-dev fallback, `redactUoaToken`.
- `apps/api/src/routes/auth-callback.ts` — `GET /providers/:key/callback` (was 100+ LOC inside `auth.ts`).
- `apps/api/src/routes/auth.ts` — provider list, sso-config, start, `/me`, `/logout`, plus dev-login (now cookie-setting).

### Drafted but not applied

`apps/api/prisma/migrations/20260516120000_auth_audit_actions_and_refresh_tokens/migration.sql` adds five `AuditAction` enum values and the new `federated_identity_refresh_tokens` table. Apply with `pnpm -F api prisma migrate deploy` in the integration DB once the schema is reviewed.

### Deferred / open

- **H3 (full coverage)** — login paths now write audit events; operator-mutating routes (connector CRUD, OAuth completion, run cancel, settings) are NOT yet wired. Track in a follow-up.
- **H5 (full role mapping)** — partial: we no longer inherit `claims.role`. A proper local role table is a follow-up.
- **H6, H7, M-series** — out of scope for this PR.
- **Refresh-token encryption-at-rest** — `FederatedIdentityRefreshToken.ciphertext` currently holds the raw refresh token. Wrap reads/writes through the secrets-encryption sibling's cipher primitive before any production rollout. TODO in `auth-callback.ts`.

