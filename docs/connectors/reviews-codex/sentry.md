# Sentry combined review

## Verdict
The source doc is directionally useful, but it overstates certainty in several places and currently treats a mix of documented, undocumented, and inferred behavior as if all of it were stable public API. The biggest gaps are comment write support, tag mutation support, priority handling, webhook action names, rate-limit numbers, and auth scope mapping. Confidence is medium: the official Sentry API and webhook docs are clear on the core issue/event surface, but some behaviors the source doc relies on are either undocumented in the current public reference or only implied by Sentry’s example integration materials.

## Authentication
- Source doc says cloud uses `sentry.io` for US and `de.sentry.io` for EU, and uses `https://sentry.io/api/0/` as the default cloud base. Official API docs now say region-specific API hosts are `us.sentry.io` and `de.sentry.io`; `sentry.io` still appears in examples, but the doc explicitly recommends region-specific domains when you want a specific data-storage location.
  Source: https://docs.sentry.io/api/
- Source doc treats organization auth token, internal integration token, and member user token as the supported mechanisms. The current auth docs also document public-integration OAuth2, refresh tokens, PKCE, and device authorization flow. Those are missing from the source even though the review brief asked for every auth mechanism.
  Source: https://docs.sentry.io/api/auth/
- Source doc recommends internal integrations for multi-tenant SupportAgent. That is viable for tenant-admin-driven installs, but it is not the only first-class path. Sentry’s integration platform explicitly distinguishes public integrations, which are installable by any Sentry user and use OAuth, from internal integrations, which are org-local. If SupportAgent wants a standardized SaaS install flow, public integration OAuth belongs in the auth section as a real option.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/
- Source doc says internal integration tokens are non-expiring. Official docs say internal integrations automatically generate tokens after installation, but they do not document token expiry or rotation semantics the way they do for OAuth access tokens. This should be phrased as “no documented expiry in the current docs” rather than as a hard guarantee.
  Sources: https://docs.sentry.io/organization/integrations/integration-platform/
  and https://docs.sentry.io/api/auth/
- Source doc says user tokens deactivate if the user leaves the org. That is a plausible operational consequence, but the official auth docs phrase personal tokens as user-associated tokens and do not state this lifecycle rule directly. It should be marked as an operational inference unless independently verified.
  Source: https://docs.sentry.io/api/auth/
- Source doc omits the official OAuth token lifetime details. Public-integration OAuth access tokens expire after 30 days and are refreshed via `POST /oauth/token/` with `grant_type=refresh_token`.
  Source: https://docs.sentry.io/api/auth/
- Source doc omits the device authorization flow, which matters if SupportAgent ever wants a CLI or headless install path for public integrations. Official docs document `POST /oauth/device/code/` and polling `POST /oauth/token/` with the device grant.
  Source: https://docs.sentry.io/api/auth/
- Source doc omits DSN authentication. DSN auth is intentionally limited, but it is still a supported authentication mechanism for some endpoints and should be flagged as “not relevant for the connector except on explicitly DSN-enabled endpoints.” Source: https://docs.sentry.io/api/auth/
- Source doc omits API keys from the main auth matrix. Official docs still support API keys as a legacy auth mechanism, but explicitly say they are disabled for new accounts and should be avoided in favor of auth tokens.
  Source: https://docs.sentry.io/api/auth/
- Source doc uses “service account user” language for Sentry. The official docs do not describe a native Sentry service-account principal for the web API. If SupportAgent wants a non-human identity, the documented constructs are internal integrations, public integrations, personal tokens, OAuth apps, DSN auth on limited endpoints, legacy API keys, and SCIM tokens for SCIM only.
  Source: https://docs.sentry.io/api/auth/
  and https://docs.sentry.io/api/scim/
- Source doc says “List projects, list org members” only needs `org:read`. Project listing via `GET /api/0/organizations/{org}/projects/` does accept `org:read`, but member listing is a different endpoint and requires `member:read`, `member:write`, or `member:admin`.
  Source: https://docs.sentry.io/api/organizations/list-an-organizations-projects/
  and https://docs.sentry.io/api/organizations/list-an-organizations-members/
- Source doc says “List teams” requires `team:read`. If the implementation uses `GET /api/0/organizations/{org}/teams/`, the documented scope is `org:read`, `org:write`, or `org:admin`, not `team:read`. `team:read` is used on team-scoped endpoints like `GET /api/0/teams/{org}/{team}/projects/`.
  Sources: https://docs.sentry.io/api/teams/list-an-organizations-teams/
  and https://docs.sentry.io/api/teams/list-a-teams-projects/
- Source doc says “Manage webhooks” requires `org:write`. The current public docs describe webhook configuration as part of creating/configuring an integration in the Sentry UI and do not document a simple “manage webhook” REST permission for internal integrations in the way the source implies. This should be described as an integration-admin action, not as a generic connector runtime scope.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/
- Source doc’s MVP scope recommendation of `event:read` + `event:write`, plus `org:read` for onboarding, is incomplete if the connector needs member resolution for assignee mapping. That path needs `member:read`.
  Sources: https://docs.sentry.io/api/organizations/list-an-organizations-members/
  and https://docs.sentry.io/api/events/update-an-issue/
- Source doc stores `organizationSlug` and `region`, but does not distinguish auth mode. If public integration OAuth is in scope, the config should carry `authMode`, OAuth client credentials, token expiry metadata, and refresh token storage.
  Source: https://docs.sentry.io/api/auth/
- Source doc does correctly note that internal integrations are org-scoped and that their permissions are org-wide, not project-specific. That aligns with the integration platform docs.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/

## Endpoints
- Source doc correctly centers `GET /api/0/organizations/{organization_slug}/issues/` as the main list/search endpoint. That is the current documented organization-wide issue list endpoint, with default `is:unresolved` behavior and project filtering via query parameters.
  Source: https://docs.sentry.io/api/events/list-an-organizations-issues/
- Source doc should explicitly call out that `GET /api/0/projects/{org}/{project}/issues/` is deprecated. The current docs label it deprecated and direct users to the organization issues endpoint.
  Source: https://docs.sentry.io/api/events/list-a-projects-issues/
- Source doc repeatedly uses issue-scoped paths without the organization prefix, for example `POST /api/0/issues/{issue_id}/comments/`, `GET /api/0/issues/{issue_id}/events/`, and `GET /api/0/issues/{issue_id}/tags/`. The current public issue and event APIs are documented under `/api/0/organizations/{organization_id_or_slug}/issues/{issue_id}/...`.
  Sources: https://docs.sentry.io/api/events/retrieve-an-issue/ , https://docs.sentry.io/api/events/list-an-issues-events/ ,
  and https://docs.sentry.io/api/events/retrieve-tag-details/
- Source doc says SupportAgent needs and has a documented endpoint to “get one” issue. The correct documented endpoint is `GET /api/0/organizations/{organization_id_or_slug}/issues/{issue_id}/`, scope `event:read`.
  Source: https://docs.sentry.io/api/events/retrieve-an-issue/
- Source doc says SupportAgent can delete an issue via `event:admin`. That is correct, but the canonical documented endpoint is `DELETE /api/0/organizations/{organization_id_or_slug}/issues/{issue_id}/`, which returns `202`, not `204`.
  Source: https://docs.sentry.io/api/events/remove-an-issue/
- Source doc says SupportAgent can “create, edit, delete comment” via `/api/0/issues/{issue_id}/comments/...`. The current public API reference does not expose issue comment CRUD endpoints anywhere under Events & Issues, and the published `@sentry/api` schema package likewise does not surface issue-comment API methods. This is the single biggest endpoint-risk in the document.
  Source: https://docs.sentry.io/api/events/ and package evidence from `@sentry/api` on npm, repo https://github.com/getsentry/sentry-api-schema
- Source doc gives concrete request and response shapes for comment CRUD, including `body`, `dateModified`, and `issue`. Those shapes should be treated as undocumented and removed or explicitly labeled “not in current public API reference” unless the team independently verifies them against a live tenant and is willing to depend on an undocumented surface.
  Source: https://docs.sentry.io/api/events/
- Source doc says issue status changes are done with `PUT /api/0/organizations/{organization_slug}/issues/{issue_id}/`. That is correct.
  Source: https://docs.sentry.io/api/events/update-an-issue/
- Source doc says valid status values are only `resolved`, `unresolved`, and `ignored`. The single-issue update endpoint also documents `resolvedInNextRelease`.
  Source: https://docs.sentry.io/api/events/update-an-issue/
- Source doc shows `statusDetails: {}` as a “resolve with substatus” example. The docs do not describe `statusDetails` that way for single-issue update. They document status details keys like `inRelease`, `inNextRelease`, `inCommit`, and ignore-window fields.
  Source: https://docs.sentry.io/api/events/update-an-issue/
- Source doc says assignment is done via single-issue `PUT` with `assignedTo`. That is correct in principle.
  Source: https://docs.sentry.io/api/events/update-an-issue/
- Source doc’s accepted `assignedTo` formats do not match the documented wording exactly. The bulk org mutate docs say values take the form `<user_id>`, `user:<user_id>`, `<username>`, `<user_primary_email>`, or `team:<team_id>`. The source doc says `team:{team_slug}` and adds `user:{email}` and `user:{username}` formats, which are not what the current docs say.
  Source: https://docs.sentry.io/api/events/bulk-mutate-an-organizations-issues/
- Source doc says unassign is done with `assignedTo: ""`. The current public docs do not document the empty-string clear behavior on either single-issue or bulk endpoints. That may work in practice, but it is not documented and should be labeled uncertain.
  Sources: https://docs.sentry.io/api/events/update-an-issue/
  and https://docs.sentry.io/api/events/bulk-mutate-an-organizations-issues/
- Source doc says “Set Priority” is a single-issue `PUT /organizations/{org}/issues/{issue_id}/` with `{"priority":"high"}`. The current single-issue update docs do not document a `priority` field at all.
  Source: https://docs.sentry.io/api/events/update-an-issue/
- Source doc says priority values are `None`, `low`, `medium`, `high`, `critical`. The current documented priority mutation surface is the bulk organization mutate endpoint, and it documents only `low`, `medium`, and `high`.
  Source: https://docs.sentry.io/api/events/bulk-mutate-an-organizations-issues/
- Source doc says priority is available on the issue object and suggests checking whether `priority` is present. The current retrieve-issue and list-issues schemas shown in the public docs do not include a `priority` field. That does not prove the field never appears in production, but it does mean the source doc should not treat it as a stable documented field on the main issue schema.
  Sources: https://docs.sentry.io/api/events/retrieve-an-issue/
  and https://docs.sentry.io/api/events/list-an-organizations-issues/
- Source doc says add/remove tags is done by `GET /api/0/issues/{issue_id}/tags/` and `POST /api/0/issues/{issue_id}/tags/{tag_key}/`. The current public API reference documents only read-side tag endpoints for issues: `GET /api/0/organizations/{org}/issues/{issue_id}/tags/{key}/` and `GET /api/0/organizations/{org}/issues/{issue_id}/tags/{key}/values/`. It does not document issue-tag write endpoints.
  Sources: https://docs.sentry.io/api/events/retrieve-tag-details/
  and https://docs.sentry.io/api/events/list-a-tags-values-for-an-issue/
- Source doc says “Sentry tags are immutable once set — you can add a new `key:value`.” The public API docs do not document any issue-tag mutation endpoint, so “immutable but appendable” is not supported by current official docs.
  Source: https://docs.sentry.io/api/events/
- Source doc says “How to list available tags on an Issue” is `GET /api/0/issues/{issue_id}/tags/`. The closest current documented read endpoints are `GET /api/0/organizations/{org}/issues/{issue_id}/tags/{key}/` for a single tag’s details and `GET /api/0/organizations/{org}/issues/{issue_id}/tags/{key}/values/` for values. The source doc should be corrected to the documented issue-tag endpoints or marked as relying on an undocumented aggregate-tag endpoint.
  Sources: https://docs.sentry.io/api/events/retrieve-tag-details/
  and https://docs.sentry.io/api/events/list-a-tags-values-for-an-issue/
- Source doc says “How to list all tag keys for a project” is `GET /api/0/projects/{org}/{project}/tags/`. The current Projects API TOC exposes “List a Tag’s Values” at `GET /api/0/projects/{organization_id_or_slug}/{project_id_or_slug}/tags/{key}/values/`; the aggregate project-tag list endpoint is not surfaced in the snippets collected here and should be re-verified before being kept.
  Source: https://docs.sentry.io/api/projects/
- Source doc says `GET /api/0/issues/{issue_id}/events/` lists issue events. The documented endpoint is `GET /api/0/organizations/{organization_id_or_slug}/issues/{issue_id}/events/`.
  Source: https://docs.sentry.io/api/events/list-an-issues-events/
- Source doc is right that there is no separate close endpoint and that resolve or ignore happens through issue update semantics.
  Source: https://docs.sentry.io/api/events/update-an-issue/
- Source doc says “Attach File / Screenshot” is not supported via API and references separate upload mechanisms. That is directionally correct for the public web API surface used by a connector: there is no documented issue-attachment endpoint under Events & Issues, and the ingest/DSN upload surfaces are not a substitute for “attach file to issue comment.” Sources: https://docs.sentry.io/api/events/
  and https://docs.sentry.io/api/auth/
- Source doc says “Severity Model” is only the `level` tag. The documented issue schema includes top-level `level` on issue retrieval, so calling it only a tag is incomplete.
  Source: https://docs.sentry.io/api/events/retrieve-an-issue/
- Source doc says “Priority: `GET /api/0/ organization’s/{org}/issues/` returns `priority` field.” There is also a typo in the path, and the current list-issues schema example shown in the public docs does not include `priority`.
  Source: https://docs.sentry.io/api/events/list-an-organizations-issues/
- Source doc says resolving users is `GET /api/0/organizations/{org}/users/`. The current public docs expose member listing at `GET /api/0/organizations/{organization_id_or_slug}/members/`, not `/users/`, and the response includes both member and nested user objects.
  Source: https://docs.sentry.io/api/organizations/list-an-organizations-members/
- Source doc says that endpoint needs `org:read`. The documented member list endpoint needs `member:read`, `member:write`, or `member:admin`.
  Source: https://docs.sentry.io/api/organizations/list-an-organizations-members/
- Source doc says project listing uses `GET /api/0/organizations/{org}/projects/` with `org:read`. That is correct.
  Source: https://docs.sentry.io/api/organizations/list-an-organizations-projects/
- Source doc does not spell out one useful response-shape detail on project listing: the documented project objects include both `slug` and `platform`, which are valuable for connector-side filtering, display, and routing without extra lookup calls.
  Source: https://docs.sentry.io/api/organizations/list-an-organizations-projects/
- Source doc also omits that project objects surface a `features` array in the documented response examples, which can help explain tenant-level capability drift without extra feature-probing endpoints.
  Source: https://docs.sentry.io/api/organizations/list-an-organizations-projects/
- Source doc omits the documented bulk mutation endpoint even though several behaviors it wants are better represented there. `PUT /api/0/organizations/{organization_id_or_slug}/issues/` supports `assignedTo`, `priority`, `status`, `substatus`, and other batch-safe changes on up to 1000 issues.
  Source: https://docs.sentry.io/api/events/bulk-mutate-an-organizations-issues/
- Source doc omits the documented bulk-delete endpoint at the organization level, which may be more practical than single-issue delete for cleanup/admin tooling.
  Source: https://docs.sentry.io/api/events/bulk-remove-an-organizations-issues/
- Source doc does not distinguish “documented stable endpoint” from “capability SupportAgent wants but Sentry does not currently document.” The missing/undocumented ones are most notably comment CRUD, issue-tag mutation, comment list for polling fallback, and single-issue priority update.
  Sources: https://docs.sentry.io/api/events/
  and https://docs.sentry.io/api/projects/

## Inbound events
- Source doc is correct that Sentry integration webhooks use the `Sentry-Hook-Resource` header and a JSON body with `action`, `installation`, `data`, and `actor`.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc is correct that the webhook headers include `Sentry-Hook-Resource`, `Sentry-Hook-Timestamp`, `Sentry-Hook-Signature`, `Request-ID`, and `Content-Type`.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc is correct that signature verification uses HMAC-SHA256 and that Sentry’s own example signs `JSON.stringify(request.body)` against the client secret.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc says the signed bytes are the “raw request body as UTF-8 JSON string (no parsing/canonicalization),” but the official webhook docs show `JSON.stringify(request.body)` in the verifier example, not raw-body byte verification. Those are not the same thing in every framework. The review doc should flag this as “follow Sentry’s documented verification sample for now; raw-body byte guarantees are not explicitly specified.” Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc says replay protection should reject timestamps older than 5 minutes. The webhook docs include `Sentry-Hook-Timestamp` in the headers list, but the current verification section does not document a freshness window or a replay-prevention algorithm. That recommendation is reasonable, but it is inference, not current Sentry spec.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc omits one operational requirement that the webhook docs do state explicitly: “Webhooks should respond within 1 second. Otherwise, the response is considered a timeout.” Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc says issue webhook actions are `created`, `resolved`, `assigned`, `archived`, and `unresolved`. Sentry’s official example integration materials use `issue.created`, `issue.resolved`, `issue.assigned`, and `issue.ignored`, not `archived`. The source doc should stop mapping webhook action names to UI vocabulary.
  Sources: https://github.com/getsentry/integration-platform-example
  and https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc says comment webhook actions are `created`, `updated`, and `deleted`. Sentry’s official example integration materials use `comment.created`, `comment.edited`, and `comment.deleted`.
  Source: https://github.com/getsentry/integration-platform-example
- Source doc correctly includes `installation.created` and `installation.deleted` as webhook actions. Sentry’s example integration materials explicitly call those out.
  Source: https://github.com/getsentry/integration-platform-example
- Source doc omits `seer` from the relevance discussion even though `seer` is now a first-class webhook resource in the current webhook docs. Even if SupportAgent ignores it, the doc should list it in the resource matrix and say why it is out of scope.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc marks `event_alert` and `metric_alert` as low priority. That is a product choice, not a docs problem, but it should distinguish resource names from action names. The generic webhook docs list the resources; the example app lists concrete alert actions like `event_alert.triggered` and `metric_alert.critical|warning|resolved`.
  Sources: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/ and https://github.com/getsentry/integration-platform-example
- Source doc provides issue and comment webhook payload examples that broadly match the documented common structure, but it should explicitly say they are examples, not exhaustive schemas. The generic webhook docs state that the contents of `data` differ by webhook type and may be customizable via UI components.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc says the issue webhook payload includes `substatus`. That is plausible and aligns with how the source wants to route escalations, but the generic webhook docs do not publish a full issue payload schema on the page we collected. Keep it only if independently re-verified against the specific issue webhook page or live traffic.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc says the issue webhook payload does not include title, culprit, shortId, assignee, tags, priority, annotations, count, or user. That is a good design warning, and it matches the general need to re-fetch issue details after webhooks. The generic webhook docs support the “slim webhook, fetch full record” pattern, though not field-by-field.
  Sources: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
  and https://docs.sentry.io/api/events/retrieve-an-issue/
- Source doc says polling fallback should use `cursor` from the previous poll to page efficiently. The pagination docs say cursors live in the `Link` header, always include previous and next, and use `results="true|false"` to indicate whether pagination is needed. The source doc should describe a Link-header-driven cursor walker, not a homegrown cursor format.
  Source: https://docs.sentry.io/api/pagination/
- Source doc says the cursor format is `{timestamp},{shard},{shardNumber}`. The pagination docs show cursors like `0:100:0`, and treat the cursor as opaque. The current doc should not prescribe a structural parse.
  Source: https://docs.sentry.io/api/pagination/
- Source doc says ongoing polling can use `statsPeriod=1h`. The organization issues endpoint docs accept generic duration strings like `24h`, `14d`, `30m`, etc., so `1h` is probably fine, but that value is not given in the source doc’s official-query table and should be grounded in the endpoint’s generic duration syntax instead of as a Sentry-specific recommendation.
  Source: https://docs.sentry.io/api/events/list-an-organizations-issues/
- Source doc has no solid polling fallback for comments. That is a major gap relative to the brief. The current public API reference gives `numComments` inside issue retrieval, but it does not document a public “list issue comments” endpoint. The review should state that new-comment polling detection is a gap unless the team accepts relying on undocumented comment endpoints.
  Sources: https://docs.sentry.io/api/events/retrieve-an-issue/
  and https://docs.sentry.io/api/events/
- Source doc says “Sentry does not have @mentions in the same way GitHub does.” That is directionally right. For SupportAgent, mention detection is plain-text detection in comment bodies, not a native mention object from the webhook payload.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc says “Contains @-mention of bot” can be detected from `data.comment`. That is the correct design for Sentry because the webhook docs expose comment text in `data` and do not define a separate mention object.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc’s loop-prevention guidance on issue events is good: webhook actor identity distinguishes user-triggered actions from integration-triggered actions, and the webhook docs explicitly show `actor.type: application` for app-driven actions.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc’s loop-prevention guidance on comments depends on undocumented comment post responses and undocumented comment CRUD endpoints. The durable part is “use webhook actor identity and integration identity to suppress self-loops”; the risky part is “persist bot user ID from comment POST response.” Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc says Sentry retries webhooks with a fixed exponential schedule and “up to 6 retries.” The current public webhook docs do not document retry count or schedule. That needs to be downgraded to unknown/needs live verification.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc says Sentry does not deduplicate webhook deliveries. The current public docs do not say either way. Keeping idempotency is still correct engineering practice, but the statement should be rephrased as a defensive recommendation rather than a documented guarantee.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/

## Hosting variants
- Source doc says cloud is “sentry.io (US region: `sentry.io`, EU region: `de.sentry.io`)”. Official API docs now say region-specific API hosts are `us.sentry.io` and `de.sentry.io`.
  Source: https://docs.sentry.io/api/
- Source doc says API base URL is `https://sentry.io/api/0/` for cloud. The official docs still use `sentry.io` in many examples, but also explicitly recommend region-specific domains when the storage region matters. The source doc should say “use the tenant’s region host when known.” Source: https://docs.sentry.io/api/
- Source doc says self-hosted has API version parity with cloud and that integration-platform features are available in self-hosted as of `21.x+`. The current official docs confirm that internal integrations are available for self-hosted, but they do not document the `21.x+` minimum on the pages collected here. That version floor should be treated as unverified unless backed by self-hosted docs or release notes.
  Sources: https://docs.sentry.io/api/auth/
  and https://docs.sentry.io/organization/integrations/integration-platform/
- Source doc does not cover public integration behavior on self-hosted clearly. The integration platform page is written in product docs centered on sentry.io, and self-hosted references are sparse. The document should explicitly separate “documented for sentry.io” from “available in self-hosted per current docs” rather than asserting parity.
  Sources: https://docs.sentry.io/organization/integrations/integration-platform/
  and https://docs.sentry.io/api/auth/
- Source doc does not cover dedicated/enterprise-hosted Sentry variants at all. If SupportAgent cares about enterprise networking or policy differences, that absence should be flagged as a gap rather than silently assuming SaaS behavior.
  Source: docs are silent in the collected official pages.
- Source doc does not turn regional hosting into a feature matrix. The API docs explicitly tie base-domain choice to data storage location. That matters for connector configuration because host selection is not cosmetic.
  Source: https://docs.sentry.io/api/
- Source doc does not explain that some resources may or may not be region-based and points nowhere to the “what types of data are stored where” matrix. That should be linked in the hosting-variants section.
  Source: https://docs.sentry.io/api/
- Source doc says “priority was added in 2023” and “older instances may not have it.” The current public docs do not give that version statement on the issue endpoints we collected. What is safe to say is that single-issue update docs do not currently expose priority, while the bulk org mutate docs do.
  Sources: https://docs.sentry.io/api/events/update-an-issue/
  and https://docs.sentry.io/api/events/bulk-mutate-an-organizations-issues/
- Source doc says “older instances use only status; substatus was introduced ~2023.” The current official API docs do not include that date/version note, so it should be marked as inference unless backed by release notes.
  Sources: current API docs are not version-specific here.
- Source doc does correctly capture one current deprecation: project issues listing is deprecated in favor of organization issues. It should move that from “known gotcha” into a dedicated hosting/version-drift subsection with the official deprecation wording.
  Source: https://docs.sentry.io/api/events/list-a-projects-issues/
- Source doc says “cloud v0 == self-hosted” as if there are breaking major API versions to compare. The public API docs say the current web API is version `v0` and that public endpoints are generally stable, with beta endpoints subject to change. There is no documented major-version comparison matrix to support the source doc’s “between major API versions” framing.
  Source: https://docs.sentry.io/api/
- Source doc should also note that the API auth docs explicitly split guidance between SaaS (`sentry.io`, `us.sentry.io`, `de.sentry.io`) and self-hosted instances. Even where endpoint shapes match, connector onboarding and support playbooks should treat those as separate hosting tracks.
  Source: https://docs.sentry.io/api/auth/
- Source doc does not mention that self-hosted feature availability can vary independently of SaaS docs. The fact that the user-feedback docs explicitly gate some self-hosted functionality on `24.4.2+` is a reminder that self-hosted version drift is real and should be called out more generally in this connector doc.
  Source: https://docs.sentry.io/platforms/apple/user-feedback
- Source doc does not say whether SupportAgent should store a full base URL instead of a `region` enum. Because self-hosted exists and cloud region hosts differ, a normalized `baseUrl` plus validated region metadata would be safer than a `region` field alone.
  Sources: https://docs.sentry.io/api/
  and https://docs.sentry.io/api/auth/

## Rate limits & pagination
- Source doc correctly says Sentry rate limits by caller and endpoint and includes both request-rate and concurrent-request controls. That matches the official rate-limit docs.
  Source: https://docs.sentry.io/api/ratelimits/
- Source doc correctly lists the five `X-Sentry-Rate-Limit-*` headers documented today.
  Source: https://docs.sentry.io/api/ratelimits/
- Source doc says “Representative limits” such as `1000/min`, `100/min`, `500/min`, and comment-specific ceilings. The official docs do not publish endpoint-specific numeric ceilings on the page we collected. Those numbers should be removed unless sourced from plan-specific commercial docs or tenant measurements.
  Source: https://docs.sentry.io/api/ratelimits/
- Source doc ties plan tiers to API rate. The official rate-limit docs do not provide plan-tier API numbers. The event-volume plan tiers also do not prove REST API ceilings.
  Source: https://docs.sentry.io/api/ratelimits/
- Source doc says “Retry-After” is present on `429`. The official rate-limit docs mention only the `X-Sentry-Rate-Limit-*` headers and do not document `Retry-After`. The source doc should stop stating that as a documented guarantee.
  Source: https://docs.sentry.io/api/ratelimits/
- Source doc says rate limiting is by token identity. The official docs say the rate limiter looks at the caller’s identity instead of the bearer token or cookie, and specifically say multiple tokens cannot bypass it. That is an important correction.
  Source: https://docs.sentry.io/api/ratelimits/
- Source doc should recommend per-tenant backoff and bounded concurrency, but those are implementation recommendations, not documented numeric limits. Official docs do not provide a concurrency recommendation; they only expose current concurrent allowance in headers.
  Source: https://docs.sentry.io/api/ratelimits/
- Source doc says pagination is cursor-based on all list endpoints. That is directionally right for the endpoints in scope, and the docs explain pagination via RFC 5988 `Link` headers.
  Source: https://docs.sentry.io/api/pagination/
- Source doc says the cursor format is `{timestamp},{shard},{shardIndex}`. The docs treat the cursor as opaque and show example cursors like `0:0:1` and `0:100:0`. The source doc should not commit to parsing semantics.
  Source: https://docs.sentry.io/api/pagination/
- Source doc says `limit` controls page size on “most endpoints,” including issue events. That is true for organization issues, which document `limit` with max `100`, but the issue-events endpoint docs shown here do not document a `limit` query parameter at all.
  Source: https://docs.sentry.io/api/events/list-an-organizations-issues/
  and https://docs.sentry.io/api/events/list-an-issues-events/
- Source doc is correct that organization issues max `limit` is `100`.
  Source: https://docs.sentry.io/api/events/list-an-organizations-issues/
- Source doc says issue-events max page size is `100`. The pagination docs use issue events as the example and show 100 events returned, so that is a reasonable inference, but the issue-events endpoint page itself does not document `limit`. It should be phrased as “pagination examples show pages of 100” instead of “documented max page size is 100.” Source: https://docs.sentry.io/api/pagination/
- Source doc correctly points to Link-header walking with `rel="next"` and `results="true"`, but it should make that the primary pagination algorithm instead of the cursor-format discussion.
  Source: https://docs.sentry.io/api/pagination/
- Source doc says “Boolean operators: `AND`, `OR`, parentheses” for issue search. The search examples are broadly plausible, but the collected organization-issues docs only say an optional search query can be passed; they do not enumerate the full search grammar on that page. If that grammar remains, it should cite Sentry Search docs directly, not just the issue-list endpoint.
  Source: https://docs.sentry.io/api/events/list-an-organizations-issues/
- Source doc says `tag:level:error` and later uses `(level:error OR level:fatal)`. The doc should normalize to whatever Sentry Search actually documents for issue search fields. The current review evidence is not strong enough to bless both syntaxes simultaneously.
  Source: the source doc is internally inconsistent here.
- Source doc omits one important pagination nuance from the official docs: Sentry returns both previous and next cursors even when those pages may have no results, specifically so you can poll for yet-undiscovered results. That matters for SupportAgent’s polling fallback design.
  Source: https://docs.sentry.io/api/pagination/
- Source doc omits error-response characterization beyond scattered endpoint status codes. At minimum it should note that endpoint docs enumerate common `400/401/403/404` status codes, but the generic requests page does not give a unified error envelope schema on the evidence collected here.
  Sources: https://docs.sentry.io/api/requests/ and individual endpoint docs
- Source doc omits bulk endpoints from the rate-limit and pagination discussion. `PUT /api/0/organizations/{org}/issues/` and `DELETE /api/0/organizations/{org}/issues/` are the current documented bulk issue mutation and bulk remove surfaces and should be explicitly evaluated as preferable to high-volume per-issue writes.
  Sources: https://docs.sentry.io/api/events/bulk-mutate-an-organizations-issues/
  and https://docs.sentry.io/api/events/bulk-remove-an-organizations-issues/

## SDK & implementation path
- Source doc says the official npm package is `@sentry/api`. That package does exist today.
  Source: npm package metadata and repository https://github.com/getsentry/sentry-api-schema
- Source doc says `@sentry/api` is “the official REST API client for Node.js/browser.” The npm package description says it is an “Auto-generated TypeScript client for the Sentry API,” which is broadly consistent, but the source doc should cite the actual package repository now that it lives under `getsentry/sentry-api-schema`, not under `sentry-javascript/tree/develop/packages/api`.
  Source: npm metadata for `@sentry/api`
- Source doc says `@sentry/api` “wraps all `/api/0/` endpoints with typed interfaces.” That is too strong. The current published schema package does not surface the issue-comment endpoints the source doc relies on, which is evidence that not every assumed endpoint is represented in the public schema.
  Source: `@sentry/api` package contents plus https://docs.sentry.io/api/events/
- Source doc says `@sentry/api` does not include webhook handling. That is fair; webhook verification remains a separate concern and the official webhook docs just use standard crypto primitives.
  Source: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc should also point implementers at Sentry’s official integration-platform example repository. That repository is currently one of the clearest public references for webhook resource and action naming, and it is more useful for webhook semantics than the generated REST client package.
  Source: https://github.com/getsentry/integration-platform-example
- Source doc recommends raw `fetch` over SDK for a thin connector. That is a coherent recommendation, especially because the connector needs careful handling around undocumented surfaces and webhook processing anyway. The document should sharpen this to “use raw HTTP for the documented issue/event/member/project endpoints; avoid undocumented comment/tag write paths until verified.” Sources: https://docs.sentry.io/api/
  and https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Source doc says “No CLI Equivalent.” That is false. Sentry has an official `sentry-cli`, documented by Sentry and published as `@sentry/cli` on npm.
  Source: `@sentry/cli` npm metadata and Sentry CLI docs references such as https://docs.sentry.io/cli/installation/ cited from platform docs
- Source doc’s broader point that there is no `gh`-style issue-management CLI for the connector use case is still reasonable. `sentry-cli` exists, but it is primarily useful for releases, artifacts, auth, and developer workflows rather than as the primary implementation path for issue-webhook connectors. That nuance should replace the current absolute statement.
  Sources: `@sentry/cli` metadata and Sentry CLI docs references
- Source doc’s MVP / Phase 2 / Phase 3 ordering is not realistic as written because MVP currently depends on undocumented comment-write endpoints. If “post comment back to Sentry” is mandatory for MVP, the doc needs a live verification step or a fallback plan. If not, MVP should be re-scoped to inbound issue ingestion plus outbound delivery elsewhere.
  Sources: https://docs.sentry.io/api/events/
  and the source doc itself
- Source doc’s Phase 2 “full tag CRUD” is not aligned with the public API evidence collected here because tag write support is not documented on issue endpoints. That item should be rephrased as “re-verify whether public API exposes any supported tag mutation surface” rather than as a known future enhancement.
  Sources: https://docs.sentry.io/api/events/
  and https://docs.sentry.io/api/projects/
- Source doc’s Phase 2 “issue.assigned webhook handler” is reasonable, but it should use the current webhook action naming and the documented member/team lookup endpoints.
  Sources: https://github.com/getsentry/integration-platform-example , https://docs.sentry.io/api/organizations/list-an-organizations-members/ ,
  and https://docs.sentry.io/api/teams/list-an-organizations-teams/
- Source doc’s “minimum admin panel config fields” are incomplete for a robust implementation. At minimum the config should distinguish `baseUrl` or `apiBaseUrl`, `authMode`, and potentially `installationUuid` or integration metadata if public integrations are ever supported.
  Sources: https://docs.sentry.io/api/
  and https://docs.sentry.io/organization/integrations/integration-platform/
- Source doc says `sentry.region` should be `"us" | "de"`. That is too narrow if self-hosted is supported. `baseUrl` should be the primary config, with region as optional derived metadata for SaaS.
  Sources: https://docs.sentry.io/api/
  and https://docs.sentry.io/api/auth/
- Source doc’s open question “outbound-only flow” conflicts with the earlier MVP endpoint table, which includes posting comments back to Sentry. The implementation path section should decide whether Sentry comment-back is required or whether Sentry is strictly intake plus external delivery.
  Source: the source doc itself at lines 209-259 and 737-744
- Source doc’s open question about “Sentry version detection” is a good blocker to keep. Self-hosted support is under-specified in the public docs collected here, so version/capability detection really is an operational blocker.
  Source: https://docs.sentry.io/api/auth/
  and https://docs.sentry.io/platforms/apple/user-feedback
- Source doc’s open question about “priority field availability” is partly misframed. The bigger question is not only version availability, but also that current single-issue update docs do not expose priority at all, while bulk org mutate does.
  Sources: https://docs.sentry.io/api/events/update-an-issue/
  and https://docs.sentry.io/api/events/bulk-mutate-an-organizations-issues/
- Source doc’s comment-threading open question is good and should stay. The current evidence supports flat comment activity, not threaded replies, and that materially affects mention handling and UX expectations.
  Sources: current webhook and issue docs do not document threading.
- Source doc’s rate-limit monitoring open question is also good. The official docs give headers, but not fixed numbers, so runtime observability matters.
  Source: https://docs.sentry.io/api/ratelimits/
- Source doc should add one operational note here: the official rate-limit docs explicitly warn that polling is likely to get clients rate limited and recommend webhooks when possible. That warning belongs in the implementation-path discussion as much as in the pagination section.
  Source: https://docs.sentry.io/api/ratelimits/
- Source doc should add one more open question: “Do we accept undocumented issue-comment endpoints, or do we constrain MVP to webhook intake plus external delivery until Sentry comment API support is proven against the public schema?” That is the key deployment-risk blocker exposed by this review.
  Sources: https://docs.sentry.io/api/events/ and `@sentry/api`

## Priority fixes
1. Remove or heavily caveat the issue-comment CRUD section. Current public Sentry API docs and the published `@sentry/api` schema do not expose the comment endpoints the source doc treats as stable.
2. Correct webhook action names. Replace `archived` with `ignored` for issue actions, and replace comment `updated` with `edited` unless re-verified against the dedicated webhook pages.
3. Fix priority handling. Single-issue `PUT /organizations/{org}/issues/{id}/` does not currently document `priority`; the documented priority mutation surface is bulk organization issue mutation, and it only documents `low|medium|high`.
4. Fix scope mapping. Member lookup needs `member:read`, and org team listing uses `org:read`; the current scope table is wrong for real onboarding and assignee resolution.
5. Replace all shorthand `/api/0/issues/{issue_id}/...` paths with the documented `/api/0/organizations/{organization_id_or_slug}/issues/{issue_id}/...` forms, or explicitly mark any remaining shorthand endpoints as undocumented.
6. Remove undocumented tag mutation claims. Keep only the documented read-side tag endpoints unless a supported write surface is proven.
7. Replace rate-limit numbers and `Retry-After` claims with what Sentry actually documents: the `X-Sentry-Rate-Limit-*` headers, per-caller/per-endpoint limiting, and concurrent limits.
8. Fix pagination guidance. Treat cursors as opaque Link-header values; do not document a parsed cursor format.
9. Expand the auth section to include public integrations with OAuth2, refresh tokens, PKCE, device flow, DSN auth limitations, and legacy API keys.
10. Correct regional hosting guidance. For cloud, prefer `us.sentry.io` or `de.sentry.io` when region matters; do not describe `sentry.io` as the US region host.
11. Replace `GET /api/0/organizations/{org}/users/` with the documented members endpoint and update the config/runtime plan accordingly.
12. Re-scope MVP if necessary. If comment-back to Sentry is mandatory, add a required live-verification step before implementation; otherwise declare Sentry intake-only for MVP and route outbound updates to a different connector.
