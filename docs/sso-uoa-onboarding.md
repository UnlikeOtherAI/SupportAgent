# UOA SSO — Onboarding Runbook

Relying-party setup for `authentication.unlikeotherai.com` (UOA). Protocol
reference lives at `https://authentication.unlikeotherai.com/llm`.

## Environment Variables

| Var | Required | Purpose |
| --- | --- | --- |
| `SSO_DOMAIN` | yes | Public hostname that serves `/.well-known/jwks.json` and `/v1/auth/sso-config`. Must match the `domain` claim byte-for-byte. Production: `api.appbuildbox.com`. |
| `UOA_CONFIG_SIGNING_PRIVATE_KEY_PEM` | yes (prod) | PKCS8 PEM of the RS256 private key. The matching public JWK is derived at startup and served at `/.well-known/jwks.json`. |
| `UOA_JWK_KID` | yes | `kid` written into the JWT header and the published JWK. Rotate by issuing a new `kid` and re-registering with the UOA superuser. |
| `UOA_CONTACT_EMAIL` | yes | Receives the Phase-1 claim link after a superuser approves the integration. |
| `UOA_CLIENT_SECRET` | after claim | `uoa_sec_...` value revealed by the claim flow. Runtime computes `client_hash = sha256(SSO_DOMAIN + UOA_CLIENT_SECRET)` and uses it as the `Authorization: Bearer` for `/auth/token` and `/auth/revoke`. |
| `SSO_BASE_URL` | defaulted | Base URL of UOA. Defaults to `https://authentication.unlikeotherai.com`. |

`JWT_SECRET` is still required — it now signs both our session token and the
short-lived `__Host-sso_state` cookie that carries PKCE state across the
`/auth` round-trip.

## Generate the RS256 Keypair

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
  -out config-signing.private.pem
```

Store the PEM as a Cloud Run secret (e.g. `supportagent-uoa-signing-key`) and
reference it from `.github/workflows/deploy.yml`. The public half is not
stored separately; the API derives it from the private PEM and publishes it
via JWKS.

Rotate by generating a new keypair, picking a new `UOA_JWK_KID`, and asking
the UOA superuser to register the new JWK under the same domain.

## Phase-1 Auto-Onboarding

1. Deploy with `UOA_CONFIG_SIGNING_PRIVATE_KEY_PEM`, `UOA_JWK_KID`,
   `UOA_CONTACT_EMAIL`, and `SSO_DOMAIN` set. `UOA_CLIENT_SECRET` is left
   unset.
2. Open the admin login page and click **Sign in with SSO**. This calls
   `/v1/auth/providers/unlikeotherai/start`, which redirects to
   `GET <SSO_BASE_URL>/auth?config_url=...&code_challenge=...`.
3. UOA fetches our config JWT, sees an unknown `kid`, pulls our JWKS, and
   creates a PENDING integration request. The browser lands on an
   "Integration pending review" page.
4. A UOA superuser approves the request in `/admin > New Integrations`. The
   `UOA_CONTACT_EMAIL` address receives a single-use claim link.
5. Open the claim link, click **Reveal secret**, and copy the shown
   `uoa_sec_...` value. Store it in Cloud Run Secret Manager (e.g.
   `supportagent-uoa-client-secret`) and redeploy with `UOA_CLIENT_SECRET`
   wired in. From this point the callback route can exchange auth codes
   end-to-end.

## Runtime Contract

- `/.well-known/jwks.json` — public JWK, `Cache-Control: public, max-age=300`.
- `/v1/auth/sso-config` — RS256-signed config JWT, `Content-Type: application/jwt`.
- `/v1/auth/providers/unlikeotherai/start` — creates PKCE verifier, stores it
  in the `__Secure-sso_state` cookie (Path `/v1/auth/providers`), redirects to
  UOA. No `state=` is appended to `redirect_url` — the allowlist match is
  byte-for-byte.
- `/v1/auth/providers/unlikeotherai/callback` — verifies the cookie, calls
  `POST <SSO_BASE_URL>/auth/token?config_url=...` with
  `Authorization: Bearer <client_hash>` and body
  `{ code, redirect_url, code_verifier }`. The response body carries
  `{ access_token, refresh_token, expires_in, refresh_token_expires_in,
  token_type, firstLogin }` — **no top-level `user` field**. User identity
  is decoded from `access_token` claims (`sub`, `email`, `role`). Tenant is
  read from `firstLogin.memberships.orgs[0].orgId` when present. The
  access token is HS256-signed by UOA and cannot be verified by the RP;
  trust is established by the authenticated backend channel. See
  `sso-uoa-doc-gaps.md` for the full shape and open questions reported
  back to UOA.

## Operational Notes

- The `domain` claim, `jwks_url` hostname, and `config_url` hostname must all
  resolve to `SSO_DOMAIN`. If the API moves hostnames, regenerate the
  keypair and re-run Phase-1.
- Forbidden payload fields in the config JWT (per UOA spec): any
  `client_secret`, `client_hash`, `SHARED_SECRET`, refresh tokens, or OAuth
  codes. The signed payload must stay public-safe.
- Dev: `/v1/auth/dev-login` is disabled in production and whenever
  `UOA_CLIENT_SECRET` is set. It remains available during local development
  and during the brief onboarding window before the secret is claimed.
