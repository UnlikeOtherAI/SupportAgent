# Deployment Modes

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). A `worker` executes a job. A `gateway` routes jobs to one or more workers. This document defines product-facing deployment and authentication modes, not new runtime roles.

## Purpose

Support Agent needs one explicit model for how the product is deployed, how users authenticate, and how external products such as `docgen` integrate with it.

The product should support three modes:

1. standalone SaaS
2. standalone enterprise
3. integrated mode

These are product modes. They should all preserve the same core package boundaries:

- admin app
- API
- dispatcher
- worker and gateway runtime contract
- local orchestrator

Do not create a separate execution architecture for integrated mode.

## Mode 1: Standalone SaaS

This is the default self-serve or lower-friction hosted mode.

- Support Agent hosts the control plane
- Support Agent hosts the primary user authentication flow
- smaller customers may use SaaS-managed execution if they explicitly allow it
- customers that want stronger isolation may still register their own worker or gateway runtime

Auth expectations:

- Support Agent uses its own first-party auth surface
- default protocol should be OIDC
- Support Agent issues its own signed bearer token after successful login
- Support Agent remains the system of record for tenant membership, roles, audit history, and API authorization

## Mode 2: Standalone Enterprise

This is the enterprise deployment mode when Support Agent is used as its own product surface.

Two hosting variants are supported:

1. hosted control plane plus customer-executed workers or gateways
2. customer-hosted control plane plus customer-executed workers or gateways

Auth expectations:

- enterprise tenants must be able to use enterprise SSO
- preferred protocols are OIDC first, SAML where required by the customer's IdP
- auth configuration is tenant-scoped
- Support Agent still maps the authenticated identity to its own tenant, role, and policy model

Security expectations:

- repository and model-provider credentials stay in the customer environment by default
- the hosted control plane should not require direct repository access for enterprise tenants
- runtime registration still uses Support Agent runtime API keys, separate from human SSO

## Mode 3: Integrated Mode

Integrated mode means Support Agent is embedded inside another product rather than acting as the user's primary entry point.

The first supported integrated target should be `docgen`.

In this mode:

- `docgen` owns the primary user session
- Support Agent acts as an embedded capability surface
- Support Agent still owns its own authorization, audit trail, workflow state, runtime dispatch, and findings model
- the embedded experience should not require the user to sign in twice

Integrated mode is not a separate product architecture. It is the same Support Agent control plane with a different identity ingress path.

## Integrated Identity Model

Do not use a long-lived shared secret passed on every browser or API call.

Instead use a signed assertion plus token exchange flow.

Recommended flow:

1. user authenticates to `docgen`
2. `docgen` backend mints a short-lived signed integration assertion
3. assertion contains:
   - issuer = `docgen`
   - audience = `support-agent`
   - tenant or organisation id
   - user id
   - user email
   - display name
   - upstream session id
   - optional project or repository scope
   - optional role claims
   - nonce or `jti`
   - expiry measured in minutes, not hours
4. `docgen` frontend or backend sends the assertion to Support Agent token-exchange API
5. Support Agent validates signature, issuer, audience, expiry, and replay protection
6. Support Agent creates or refreshes a local federated auth context for that user and tenant
7. Support Agent returns its own signed bearer token
8. all later Support Agent API calls use Support Agent credentials, not the original `docgen` assertion

This keeps the trust boundary clear:

- `docgen` proves identity
- Support Agent issues its own local authorization context
- no raw upstream session secret is reused as the Support Agent API credential

## Why Token Exchange Instead Of Shared Secrets

The integrated requirement is really delegated identity, not secret sharing.

A shared secret between the two platforms is only appropriate for:

- signing the integration assertion
- mTLS or service authentication between backends
- webhook signing

It is not the right primitive for end-user API authorization.

The browser or plugin should never hold a tenant-global shared secret.

## Support Agent Integration API Shape

Support Agent should add explicit integration endpoints rather than overloading normal login routes.

Initial recommended endpoints:

- `POST /v1/integrations/docgen/session-exchange`
  - accepts the short-lived signed assertion from `docgen`
  - validates issuer, signature, expiry, replay, and allowed tenant mapping
  - returns Support Agent session credentials
- `POST /v1/integrations/docgen/runtime-token`
  - optional backend-only endpoint for `docgen` server jobs that need to trigger Support Agent actions without a browser session
- `GET /v1/integrations/docgen/capabilities`
  - exposes which Support Agent features the current embedded tenant can use

This should remain separate from:

- human standalone login routes
- runtime CLI registration routes
- admin API key management

## Assertion Verification Model

Use asymmetric signing, not a shared symmetric secret, for the primary integration assertion whenever possible.

Preferred verification options:

1. `docgen` publishes a JWKS endpoint and Support Agent validates a JWT assertion against it
2. Support Agent calls a `docgen` introspection endpoint for one-time assertions if the integration requires server-side confirmation

Recommendation:

- use signed JWT assertions with JWKS for the normal launch and embedded-session path
- optionally add introspection for higher-assurance enterprise integrations or one-time-use assertions

This is the same pattern `docgen` already uses for short-lived WebSocket token issuance and verification: a short-lived signed token is exchanged for a narrower local auth token.

## Session And Scope Rules In Integrated Mode

The upstream `docgen` session id should be carried as correlation metadata, not treated as the Support Agent session key.

Support Agent should create:

- its own local token claims and any issuance identifier needed for audit
- its own audit event stream
- a stored link to the upstream `docgen` session id

That linked session record should let us answer:

- which `docgen` session launched this Support Agent session
- which user and tenant were asserted
- which scopes were granted
- whether the assertion was refreshed or revoked

## Enterprise SSO In Integrated Mode

When `docgen` itself is using enterprise SSO, Support Agent should trust the identity that `docgen` has already established and then perform local token exchange.

That means:

- enterprise SSO is handled once, at the parent product boundary
- Support Agent does not show a second enterprise login screen for the embedded flow
- Support Agent still evaluates its own tenant mapping, role mapping, and policy checks after exchange

If an enterprise customer wants direct standalone Support Agent access as well, that tenant may also configure enterprise SSO directly in Support Agent. The standalone and integrated paths should land on the same internal identity record when they refer to the same user.

## Shared Build Infrastructure With `docgen`

Do not build a second orchestration stack inside `docgen`.

The first implementation should treat Support Agent as the owner of:

- build workflow orchestration
- worker and gateway registration
- runtime CLI
- reverse-connected session handling
- execution profile matching
- artifact upload and final result contracts
- review loop execution policy

`docgen` should integrate as a client of that infrastructure.

Recommended first step:

- `docgen` plugin asks Support Agent to create `triage`, `build`, or `merge` work through the integration API
- Support Agent dispatches that work through the same runtime CLI, gateway, dispatcher, and worker contracts used for standalone mode
- Support Agent returns status, findings, artifacts, and outbound events back to `docgen`

This avoids copying the most complex part of the system.

## Shared Package Boundary

If the `docgen` integration later needs deeper embedding than API calls, extract only the already-proven execution substrate into shared packages.

The likely shared packages are:

- runtime registration schema
- reverse-session protocol
- dispatch contract
- artifact upload client
- orchestration manifest schema
- execution profile schema

Do not extract the admin surface, connector model, or Support Agent business workflows into generic packages unless both products truly need them.

## Source Of Truth For Credentials

Human identity and machine identity must stay separate:

- human access:
  - standalone SaaS auth
  - enterprise SSO
  - integrated token exchange from `docgen`
- machine access:
  - runtime API keys
  - service-to-service integration credentials
  - webhook signatures
  - customer-managed model-provider credentials where allowed

Support Agent should never treat runtime API keys, upstream `docgen` assertions, and human admin sessions as interchangeable credentials.

## Initial Recommendation

Build the product around one control plane and three explicit ingress modes:

1. standalone SaaS with Support Agent-managed OIDC login
2. standalone enterprise with tenant-scoped enterprise SSO and customer-executed runtimes by default
3. integrated `docgen` mode with short-lived signed assertion exchange into a local Support Agent session

For build infrastructure, keep Support Agent as the orchestration owner and let `docgen` consume it through the integration API before extracting any shared runtime packages.
