# Identity Providers

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). This document covers human authentication providers. Runtime API keys for `workers` and `gateways` are a separate concern and must not be mixed with human login.

## Purpose

Support Agent needs a single facade for human authentication so it can:

- render its own login screen
- show one button per enabled sign-in provider
- support multiple provider families at the same time
- stay SSO-agnostic at the product boundary
- keep one internal user, tenant, role, and session model

This is justified because there are already at least two real provider families:

- centralized auth brokers such as `authentication.unlikeotherai.com`
- future tenant-specific enterprise providers such as OIDC or SAML IdPs

Do not build a generic auth plugin marketplace. Build an explicit provider facade with a small set of adapter types.

Parent-product integration such as `docgen` session exchange is related, but it is not itself a login-button provider. Keep embedded product session exchange on a separate integration-auth path even if both flows normalize into the same local identity model.

## Product Rule

Support Agent owns the login screen.

The login screen should not hard-code provider-specific logic. It should render one button per enabled provider from backend metadata.

Examples:

- `Sign in with UnlikeOther AI`
- `Sign in with Mollotov`
- `Sign in with Acme SSO`

The number of buttons is the number of enabled providers for the current deployment or tenant scope.

This button model applies only to interactive human sign-in providers.

It does not apply to:

- runtime API key authentication
- backend-to-backend integration credentials
- embedded product session exchange such as `docgen`

## Architecture

Support Agent should expose four clear layers:

1. provider registry
2. provider adapters
3. normalized identity service
4. local stateless session issuer

### 1. Provider Registry

The registry answers:

- which providers are enabled
- which tenant or deployment they apply to
- how they should be presented in the UI
- which adapter implementation is responsible for them

### 2. Provider Adapters

Each provider adapter owns:

- auth start URL generation
- callback or assertion handling
- provider-specific token exchange
- provider-specific user or team lookup
- normalization into the internal identity contract

### 3. Normalized Identity Service

This layer maps external identities to:

- local tenant
- local user
- local role membership
- local identity link records

### 4. Local Stateless Session Issuer

Every successful login flow ends with Support Agent issuing its own local stateless session token.

Support Agent must not treat upstream provider tokens as native Support Agent sessions.

## Supported Adapter Families

Start with explicit adapter families:

- `oauth-broker`
  - provider runs its own auth UX and returns an auth code that Support Agent exchanges
- `oidc`
  - direct OIDC provider integration
- `saml`
  - direct SAML provider integration

Do not create more adapter families unless a real provider cannot fit one of these.

For embedded products such as `docgen`, use a separate integration-auth contract, not an interactive provider adapter family. That integration path may still normalize into the same identity contract and local stateless session issuer after exchange.

## Deployment Mode Mapping

Reference: [deployment-modes.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/deployment-modes.md).

The identity facade should state which auth patterns are expected per product mode.

Recommended defaults:

- standalone SaaS
  - one or more interactive human sign-in providers
  - typically `oauth-broker` first
  - may later include direct `oidc`
- standalone enterprise
  - one or more tenant-scoped enterprise providers
  - typically `oidc`
  - `saml` when required by the customer's IdP
- integrated mode
  - interactive provider buttons are optional
  - primary embedded login uses the separate integration-auth session-exchange path
  - if direct standalone admin access also exists for the same tenant, it may additionally expose interactive providers

This mapping should stay explicit so implementers do not mistake embedded product exchange for another login button.

## Stateless Session Rule

From the API perspective, the session must be stateless.

That means:

- authenticated API requests are validated from a signed Support Agent token
- the API should not require a database-backed session lookup on every request
- upstream provider tokens are exchanged into a Support Agent token before normal API access begins

Operational records such as login audit events, token issuance history, or explicit revocation metadata may still be persisted, but they are not the primary source of truth for authenticating every request.

## Normalized Provider Metadata

The frontend should fetch provider button data from the API.

Recommended endpoint:

- `GET /v1/auth/providers`

Response shape:

```json
{
  "providers": [
    {
      "key": "unlikeotherai",
      "label": "UnlikeOther AI",
      "buttonText": "Sign in with UnlikeOther AI",
      "kind": "oauth-broker",
      "iconUrl": "https://...",
      "startUrl": "/v1/auth/providers/unlikeotherai/start",
      "enabled": true
    }
  ]
}
```

The login screen should render buttons from this response only.

## Provider Adapter Interface

Each adapter should satisfy one explicit server-side contract.

Recommended interface:

```ts
type AuthProviderAdapter = {
  getMetadata(): Promise<AuthProviderMetadata>;
  buildStartRequest(input: AuthStartInput): Promise<AuthStartResult>;
  handleCallback(input: AuthCallbackInput): Promise<NormalizedIdentity>;
};
```

Definitions:

- `getMetadata()`
  - returns UI label, button text, icon reference, provider kind, and availability
- `buildStartRequest()`
  - prepares redirect URL, popup URL, signed config reference, PKCE state, or relay state
- `handleCallback()`
  - consumes provider callback data or exchanged tokens and returns one normalized identity result

Keep the interface narrow. Do not push database writes or local stateless session issuance into provider adapters.

## Normalized Identity Contract

Every provider must normalize into the same identity payload.

Required fields:

- `providerKey`
- `providerUserId`
- `providerTenantId`
- `displayName`

Recommended fields:

- `email`
- `avatarUrl`
- `groups`
- `roles`
- `upstreamSessionId`
- `rawProfileRef`

Notes:

- `providerUserId` must be stable across sessions
- `providerTenantId` must be a stable external tenant, organisation, team, or workspace id
- `email` is profile data, not the canonical identity key
- `upstreamSessionId` is correlation data only

Example:

```json
{
  "providerKey": "unlikeotherai",
  "providerUserId": "usr_123",
  "providerTenantId": "team_456",
  "displayName": "Jane Smith",
  "email": "jane@example.com",
  "avatarUrl": "https://example.com/avatar.jpg",
  "roles": ["member"],
  "upstreamSessionId": "sess_789"
}
```

## Login Flow

Recommended generic flow:

1. frontend calls `GET /v1/auth/providers`
2. frontend renders one button per provider
3. user clicks a provider button
4. frontend navigates to or opens the provider start URL from backend metadata
5. provider adapter completes its provider-specific flow
6. adapter returns a normalized identity result
7. Support Agent resolves local tenant and user links
8. Support Agent issues its own signed bearer token
9. frontend stores the token in client-side auth state and uses it for later API calls

## Core API Shape

Recommended endpoints:

- `GET /v1/auth/providers`
  - list enabled providers for the current deployment or tenant context
- `GET /v1/auth/providers/:providerKey/start`
  - begin an interactive login flow
- `GET /v1/auth/providers/:providerKey/callback`
  - receive provider callback when the provider uses browser redirects
- `POST /v1/admin/identity-providers`
  - create a provider configuration
- `PATCH /v1/admin/identity-providers/:providerKey`
  - update label, enabled state, ordering, and config refs
- `POST /v1/admin/identity-providers/:providerKey/disable`
  - disable a provider
- `POST /v1/admin/identity-providers/:providerKey/enable`
  - enable a provider
- `DELETE /v1/admin/identity-providers/:providerKey`
  - remove a provider configuration when policy allows it

The callback routes should stay generic at the API boundary and route internally to the correct adapter.

Embedded product exchange should stay separate, for example:

- `POST /v1/integrations/:integrationKey/session-exchange`

Do not model embedded product exchange as a login-button provider route.

The same provider-management model must also be exposed through MCP so auth configuration is not admin-UI only.

## Assertion Exchange Validation

For providers or integrations that send Support Agent a signed JWT or similar assertion, validation must be strict and explicit.

At minimum, Support Agent must validate:

- token is present
- token has exactly the expected serialization format
- supported signing algorithm
- signature validity
- issuer
- audience
- expiry
- issued-at if required by policy
- replay identifier such as `jti`
- required claims for the configured provider

For redirect-based OAuth and OIDC providers, the adapter must also validate:

- `state` as a mandatory CSRF defense
- PKCE verifier when the provider flow uses PKCE
- callback route and redirect URI match against provider configuration

For the first assertion-based integrations, define required claims explicitly per provider or integration instead of guessing from whatever the token happens to contain.

## Assertion Exchange Error Reporting

If a token is malformed or incomplete, the caller must get a precise machine-readable error.

Do not collapse all failures into `invalid token`.

Use one standard error envelope with a stable code, clear title, human-readable detail, and optional structured field errors.

Recommended error shape:

```json
{
  "type": "https://supportagent/errors/auth-provider-token-invalid",
  "title": "Provider token validation failed",
  "status": 401,
  "detail": "The UnlikeOther AI assertion is missing the required claim `providerTenantId`.",
  "errorCode": "provider_token_missing_claim",
  "providerKey": "unlikeotherai",
  "traceId": "01HXYZ...",
  "errors": [
    {
      "field": "providerTenantId",
      "code": "required",
      "message": "A stable external tenant identifier is required."
    }
  ]
}
```

Recommended `errorCode` values for assertion exchange:

- `provider_token_missing`
- `provider_token_malformed`
- `provider_token_unsupported_alg`
- `provider_token_invalid_signature`
- `provider_token_expired`
- `provider_token_invalid_issuer`
- `provider_token_invalid_audience`
- `provider_token_replayed`
- `provider_token_missing_claim`
- `provider_token_invalid_claim`
- `provider_token_mapping_failed`

Rules:

- use `400` when the request body or token format is structurally invalid
- use `401` when the token is present but fails authentication or trust validation
- use `403` when the token is valid but the asserted identity is not allowed into the target tenant or provider scope
- always include `providerKey` and `traceId` in server logs
- include field-level details when the token is well-formed enough to inspect claims safely

## Provider Claim Schemas

Each provider adapter must publish a claim schema for the tokens or assertion payloads it accepts.

That schema should define:

- required claims
- optional claims
- claim types
- allowed algorithms
- issuer rules
- audience rules
- tenant-id source
- user-id source

This is required so bad tokens fail with deterministic validation messages rather than ad hoc parsing errors.

## Provisioning And Tenant Mapping Policy

The normalized identity contract is not enough by itself. Support Agent must also define the policy for how first login maps into a local tenant and role set.

Required policy questions:

- is the provider deployment-scoped or tenant-scoped
- does first login auto-provision a local user
- does first login auto-provision tenant membership
- which provider tenant ids are allowed to map into which local tenants
- what default role is granted on first successful login
- when does login succeed but access is denied

Recommended rule:

- identity normalization happens before authorization
- tenant mapping must be explicit and deterministic
- if the provider user is valid but no tenant mapping rule matches, return `403` with a specific mapping error

Do not let first-login provisioning or tenant assignment depend on ambiguous profile fields such as email domain alone when a stable external tenant id exists.

Recommended defaults by product mode:

- standalone SaaS
  - local user auto-provisioning allowed by default
  - tenant membership auto-provisioning allowed only when the provider itself is tenant-scoped or an explicit invite/mapping exists
- standalone enterprise
  - local user auto-provisioning allowed only when tenant policy explicitly enables it
  - tenant membership should default to preconfigured mapping or invite-only
- integrated mode
  - local user creation may be automatic
  - tenant mapping should derive from the configured integration plus asserted external tenant id
  - if the asserted tenant cannot be mapped deterministically, fail closed

## Multi-Tenant Access And Switching

One local user may have federated identities or memberships that permit access to multiple local tenants.

Support Agent should support:

- post-login tenant selection when more than one tenant is available
- a tenant-switch endpoint for already authenticated users
- session re-issuance scoped to the selected tenant

Recommended rule:

- one local stateless session token is active in exactly one tenant context at a time
- switching tenants does not require upstream re-login if the existing authenticated identity is authorized for both tenants
- tenant switching must create an audit event

## Account Linking And Identity Merging

A person may sign in through more than one provider over time.

Examples:

- UnlikeOther AI first, enterprise OIDC later
- enterprise OIDC first, integrated `docgen` later

Support Agent must define account-linking policy explicitly.

Recommended default:

- never auto-link purely by email match
- allow automatic linking only when a trusted provider mapping policy explicitly says two identities refer to the same person
- otherwise require an authenticated local stateless session token plus explicit linking flow or admin action

This avoids silent account takeover through recycled or reassigned email addresses.

## Logout And Session Termination

The login architecture is incomplete without logout rules.

Support Agent should support:

- local logout
  - expire or invalidate the Support Agent token lifecycle for future requests
- upstream logout when supported
  - redirect to or call the provider logout endpoint when the provider supports coordinated logout
- admin session revocation
  - force-expire local token validity for a user or tenant

The minimum guarantee is local logout. Coordinated upstream logout is provider-specific and should be implemented per adapter where the provider supports it cleanly.

## Session Model

For browser-based human login and tool-driven API use, the default should be:

- a signed stateless Support Agent bearer token
- transport in the `Authorization: Bearer <token>` header

Recommended policy:

- the admin web app holds the current auth token in frontend state
- other tools also call the API with the same bearer-token model
- do not rely on cookie-backed auth for the API
- normal API authentication should validate token signature and claims without a session table lookup

The API contract should assume only an incoming bearer token, regardless of whether the caller is:

- the Support Agent frontend
- an embedded product
- an internal tool
- an external automation client

## Session Refresh, Renewal, And Expiry

The session model must define both idle and absolute expiry.

Recommended default:

- idle timeout
  - sliding renewal while the session is actively used
- absolute max lifetime
  - hard re-authentication required after the limit is reached

Recommended rules:

- local renewal should not require upstream re-authentication until hard expiry is reached or policy demands it
- session renewal must rotate the local token or renewal secret
- renewal failures must return a standard auth error, not a generic 500

If bearer tokens are issued for a separate API client use case, keep them short-lived and backed by the same stateless token policy rather than inventing a second long-lived auth model.

Recommended stateless interpretation:

- the API trusts the signed token for normal request authentication
- renewal issues a fresh signed token with a new expiry window
- revocation or disablement mechanisms should be exceptional and policy-driven rather than required for every authenticated request

If a refresh mechanism exists, it must also stay stateless from the API perspective and must not depend on a server-side session store.

## Concurrent Sessions

Support Agent should allow multiple active sessions by default unless tenant policy restricts it.

Required controls:

- list active sessions for the current user
- revoke one session
- revoke all sessions for the current user
- tenant-admin revocation for a target user when policy allows

Optional policy controls:

- max concurrent sessions per user
- max session age by tenant
- step-up auth for sensitive actions

Frontend state may hold:

- the current auth token
- the current selected tenant context
- non-secret UX state such as which provider button was chosen

The frontend must not become the source of truth for API authentication. API authentication still comes from the stateless Support Agent token.

## Rate Limiting

Public auth and exchange endpoints must be rate-limited.

At minimum, apply rate limits to:

- `GET /v1/auth/providers/:providerKey/start`
- `GET /v1/auth/providers/:providerKey/callback`
- `POST /v1/integrations/:integrationKey/session-exchange`

Rate limits should be keyed by a combination of:

- IP address
- provider or integration key
- tenant or deployment scope where known
- replay identifier for assertion-exchange flows where useful

Rate limiting failures should return the standard API error envelope with a distinct rate-limit error code.

## Provider Signing Material And Rotation

OIDC, SAML, and assertion-based providers depend on external signing material.

Required rules:

- OIDC adapters must support JWKS retrieval and key rotation
- SAML adapters must support certificate rollover
- cached signing material must expire and refresh predictably
- verification failures during key rollover must be distinguishable from malformed tokens

Do not pin long-lived keys manually unless a specific enterprise deployment requires it and the operational burden is accepted.

## Data Model

Add explicit identity-provider records rather than burying auth configuration inside tenant settings blobs.

Recommended records:

- `identity_providers`
  - provider key
  - adapter kind
  - label
  - enabled state
  - tenant scope or deployment scope
  - login-order weight
  - UI icon metadata
  - config reference
- `identity_provider_secrets`
  - secret refs only, never plaintext in normal reads
- `federated_identity_links`
  - local user id
  - local tenant id
  - provider key
  - provider user id
  - provider tenant id
  - last login at
  - last profile snapshot ref
- `identity_sessions`
  - token issuance record id
  - local user id
  - local tenant id
  - provider key
  - upstream session id if present
  - auth time
  - token expiry

Existing platform-wide `audit_events` should record auth and provider-management activity. Do not invent a second incompatible audit model for identity flows unless the general audit model proves insufficient.

If `identity_sessions` exists, treat it as issuance history, audit support, and optional revocation support. Do not require it for normal stateless request authentication.

## UI Rules

The login screen should:

- show only enabled providers
- keep provider order server-driven
- use backend-provided labels and button text
- avoid baking provider assumptions into frontend code
- support at least redirect flow and popup flow

If only one provider is enabled, Support Agent may auto-forward after a short delay, but the normal state should still render the provider button for clarity.

If a provider is temporarily unavailable:

- fail the selected provider cleanly with a user-facing error state
- do not hide other still-healthy providers
- log timeout or upstream-unavailable details in audit and operational logs

Recommended UX:

- clear provider-specific failure message
- retry action
- choose another provider action when another provider exists

## UnlikeOther AI Adapter

`authentication.unlikeotherai.com` should be handled as an `oauth-broker` adapter.

The adapter owns:

- creation or lookup of the `config_url`
- generation of the signed config JWT reference
- redirect to `/auth?config_url=...&redirect_url=...`
- backend exchange at `POST /auth/token`
- provider-side org or team context lookup such as `/org/me` if needed
- normalization into Support Agent identity fields

The current auth service already exposes:

- an interactive `/auth` entrypoint
- auth code exchange via `POST /auth/token`
- a current-user org context endpoint
- org and team concepts that can supply the external tenant id

The provider-specific RS256-signed config JWT (with published JWKS) and `client_hash` bearer token logic must live only inside this adapter. See [`sso-uoa-onboarding.md`](./sso-uoa-onboarding.md) for the keypair, claim, and env-var runbook.

The adapter should also define:

- callback URL registration expectations
- whether local Support Agent must host one callback URL per deployment or per tenant
- provider timeout and retry posture

## Mollotov Adapter

If Mollotov SSO behaves differently, implement it as another adapter behind the same facade.

The login screen should still only care about:

- label
- button text
- icon
- start URL

The rest stays in the adapter.

## Enterprise SSO Rule

Support Agent should be SSO-agnostic at the facade boundary, not at the raw wire-protocol layer.

That means:

- any provider may have its own protocol details
- every provider must normalize into the same identity contract
- the rest of Support Agent must never branch on provider-specific response shapes

This is the only sane way to support:

- direct enterprise OIDC
- direct enterprise SAML
- centralized auth brokers
- product-to-product token exchange

## Provider Lifecycle Management

Disabling or removing a provider is a first-class operational event.

Support Agent should define:

- whether disabling a provider blocks new logins immediately
- whether existing local stateless tokens created from that provider remain valid until expiry or are invalidated immediately
- whether federated identity links are soft-disabled or deleted
- what happens to users who only have that provider linked

Recommended default:

- disable blocks new logins immediately
- existing stateless tokens remain valid until expiry unless a security event or admin action requires immediate invalidation
- links are soft-disabled, not deleted

## Upstream Deactivation And SCIM

Enterprise deployments commonly need upstream deprovisioning.

Support Agent should support:

- provider-driven user deactivation handling where the provider exposes it
- periodic revalidation of upstream entitlement for enterprise providers where needed
- future SCIM ingestion or equivalent deprovisioning events without changing the local auth model

The minimum safe rule is that a deactivated upstream user must not be able to create new local stateless session tokens.

## MFA Posture

Support Agent should rely on provider-side MFA for federated login.

Recommended rule:

- the provider is responsible for MFA enforcement
- Support Agent records provider assurance level when the provider exposes it
- Support Agent does not run its own first-line MFA flow for human login
- any future step-up checks for especially sensitive admin actions should be treated as separate authorization controls, not as a replacement or duplicate of provider MFA

## Callback URL Management

Every redirect-based provider must define its callback URL model.

Required rules:

- callback URLs must be deterministic and documented during setup
- callback URLs must be validated against provider configuration
- tenant-scoped providers must make clear whether callback URLs vary by tenant or only by deployment

Operators need this documented in both admin setup and MCP configuration because callback registration is a common integration failure point.

## Audit Logging

Identity flows must emit normal platform audit events.

At minimum, audit:

- provider created
- provider updated
- provider enabled
- provider disabled
- login started
- login succeeded
- login failed with error code
- local stateless session token issued
- local stateless session token renewed
- local stateless session token invalidated
- tenant switch
- tenant mapping failure
- explicit account link
- explicit account unlink

## Security Rules

- provider-specific secrets must be stored as secret refs, not plaintext config
- upstream provider tokens must not become long-lived Support Agent API tokens
- every successful login must end in a Support Agent-issued local stateless session token
- email must not be the canonical external identity key
- tenant mapping must require a stable external tenant identifier
- replay-sensitive assertion flows must validate `exp`, `iat`, and `jti`

## What Not To Do

- do not hard-code provider buttons in the frontend
- do not scatter provider logic across routes, controllers, and UI components
- do not let provider tokens become native Support Agent sessions forever
- do not build an auth plugin marketplace before the explicit adapter model is proven
- do not use one-off per-provider downstream authorization logic

## Initial Recommendation

Build one `identity provider facade` with:

- server-driven provider button metadata
- a small explicit set of adapter families
- one normalized identity contract
- one local stateless session issuer

Implement `authentication.unlikeotherai.com` first as an `oauth-broker` adapter. Add future providers such as Mollotov behind the same interface without changing the login screen or the rest of the Support Agent authorization model.
