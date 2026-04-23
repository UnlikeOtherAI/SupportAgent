# UOA SSO — Documentation Gaps Found During Integration

Report for the UOA team. Observed while integrating SupportAgent
(`api.appbuildbox.com` / `app.appbuildbox.com`) as a relying party on
2026-04-23.

## Symptom

End-to-end login reached `/auth/token`, the exchange returned HTTP 200 with a
valid body, but the RP treated the response as malformed and redirected back
to `/login?error=invalid_token`. Production log line:
`UOA token response missing user.id`.

## Root cause

The RP assumed `POST /auth/token` returns a top-level `user` object next to
`access_token`. The actual response has no `user` field — user identity
lives inside the `access_token` JWT. The RP was written against what the
`/llm` guide implied ("contains an access token, a refresh token, expiry
metadata, and the user profile"), not what the endpoint actually returns.

## Actual response (captured verbatim from production)

```json
{
  "access_token": "<HS256 JWT, aud=uoa:access-token>",
  "expires_in": 1800,
  "refresh_token": "<opaque>",
  "refresh_token_expires_in": 2592000,
  "token_type": "Bearer",
  "firstLogin": {
    "capabilities": { "can_accept_invite": false, "can_create_org": false },
    "memberships": { "orgs": [], "teams": [] },
    "pending_invites": []
  }
}
```

Access-token claims (decoded payload):

```json
{
  "email": "ondrej.rafaj@gmail.com",
  "domain": "api.appbuildbox.com",
  "client_id": "<sha256(domain+client_secret) hex>",
  "role": "superuser",
  "iss": "authentication.unlikeotherai.com",
  "aud": "uoa:access-token",
  "sub": "cmlushqjc0000s601ceym8wpn",
  "iat": 1776945390,
  "exp": 1776947190
}
```

## Documentation gaps (please fix)

1. **No complete response body example** on `/llm` or `/api`. The guide
   describes fields prosaically but shows only the `firstLogin` fragment.
   Publish a single canonical response example so RP authors don't have to
   guess.

2. **"User profile" phrasing is misleading.** `/llm` says the response
   "contains … the user profile". A naive read (and the one SupportAgent
   took) is that `user` is a sibling of `access_token`. In reality the
   profile is encoded as claims inside the JWT. State explicitly:
   *"User identity is carried in the `access_token` claims. The response
   body has no separate `user` field."*

3. **Access-token claim schema is undocumented.** Publish the full claim
   contract: `sub` (user id), `email`, `role`, `domain`, `client_id`,
   `iss`, `aud`, `iat`, `exp`. Note which are stable vs. advisory, and
   whether `role` is global or per-integration.

4. **`firstLogin` field-casing inconsistency.** The outer response is
   snake_case (`access_token`, `refresh_token`, `expires_in`,
   `pending_invites`). Inside `firstLogin.memberships.orgs[]` the fields
   are camelCase (`orgId`, `role`) and same for `teams[]` (`teamId`,
   `orgId`, `role`). That mismatch is a sharp edge. Either normalize or
   call it out prominently.

5. **Access tokens are HS256-signed.** RPs cannot verify them against the
   config JWKS (which is RS256 and relying-party-owned). Nothing in the
   docs says this. Either document explicitly that RPs must trust the
   token because it was delivered over the authenticated backend channel,
   or expose a UOA-side JWKS so RPs can validate `aud=uoa:access-token`
   cryptographically.

6. **No guidance on first-login tenant bootstrapping.** When
   `firstLogin.memberships.orgs` is empty (fresh user, no org yet), the
   docs do not say whether the RP should:
   - refuse the login,
   - let the user in under a synthetic tenant, or
   - hand control back to UOA via `firstLogin.capabilities.can_create_org`
     to create an org first.
   We currently fall back to a `'default'` tenant, which is almost
   certainly not what a multi-tenant RP should do.

7. **`role` ambiguity.** `role: "superuser"` in the JWT appears to be the
   UOA-platform role, not the RP-side authorization role. Inside
   `firstLogin.memberships.orgs[].role` a different role appears.
   Document which role an RP should honour for access decisions.

8. **The `/llm` guide should link to a minimal working reference
   implementation** that closes the auth code → session JWT loop end to
   end. The current `Runtime Contract` section in our own runbook
   `docs/sso-uoa-onboarding.md` would have passed review before this bug,
   yet still produced a broken integration.

## What the RP had to do to work around the gaps

- Parse `access_token` with `jose.decodeJwt` (no signature verification)
  to obtain `sub` and `email`.
- Pull tenant from `firstLogin.memberships.orgs[0].orgId` if present,
  otherwise fall back to `'default'`.
- Prefer `firstLogin.memberships.orgs[0].role` over the JWT `role` claim
  for authorization decisions.

See `apps/api/src/routes/auth.ts` callback handler for the implementation.
