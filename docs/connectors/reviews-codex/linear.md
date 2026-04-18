# Linear combined review

## Verdict
The source document is directionally useful but materially out of date in several areas that would affect an actual SupportAgent connector implementation. The biggest gaps are authentication drift, the wrong GraphQL base path, outdated webhook semantics, incorrect mention syntax, incorrect attachment/file-upload guidance, and unsupported claims around IDs, pagination limits, and rate limits. Confidence is medium-high because the corrections below are grounded in current official Linear developer docs, current official Linear SDK docs, and the published `@linear/sdk` package surface.

## Authentication
- The source says the production GraphQL endpoint is `https://api.linear.app/graphql/v1`.
  What is true: current official docs publish `https://api.linear.app/graphql` with no `/v1`.
  Citation: https://linear.app/developers/graphql

- The source says PATs are sent as `Authorization: Bearer <token>`.
  What is true: current official docs distinguish OAuth from API keys.
  OAuth uses `Authorization: Bearer <ACCESS_TOKEN>`.
  Personal API keys are documented as `Authorization: <API_KEY>`.
  Citation: https://linear.app/developers/graphql

- The source describes only two auth mechanisms: PAT and OAuth 2.0.
  What is true: that is incomplete for a serious connector review in April 2026.
  Linear now documents:
  `personal API keys`
  `OAuth authorization code`
  `OAuth PKCE`
  `OAuth actor=app`
  `OAuth client_credentials` for server-to-server app tokens when explicitly enabled on the app
  Citation: https://linear.app/developers/graphql
  Citation: https://linear.app/developers/oauth-2-0-authentication
  Citation: https://linear.app/developers/oauth-actor-authorization

- The source says OAuth returns a short-lived access token plus an optional refresh token.
  What is true: current docs say a refresh token is returned and the access token is valid for 24 hours.
  The docs also state: “All OAuth2 applications were migrated to the new refresh token system on April 1, 2026.”
  Treat refresh as part of the normal lifecycle, not optional.
  Citation: https://linear.app/developers/oauth-2-0-authentication

- The source does not cover refresh-token rotation behavior.
  What is true: Linear documents refresh token rotation plus a 30-minute replay/grace window for recovering a lost rotated refresh token response after network failure.
  Citation: https://linear.app/developers/oauth-2-0-authentication

- The source does not cover token revocation.
  What is true: Linear documents `POST https://api.linear.app/oauth/revoke` and recommends the `token` form field for revocation.
  Citation: https://linear.app/developers/oauth-2-0-authentication

- The source says OAuth scopes are `read`, `write`, `comments`, `issues`, `projects`, `teams`, `users`.
  What is true: current docs list:
  `read`
  `write`
  `issues:create`
  `comments:create`
  `timeSchedule:write`
  `admin`
  Agent/app scopes are documented separately:
  `app:assignable`
  `app:mentionable`
  `customer:read`
  `customer:write`
  `initiative:read`
  `initiative:write`
  Citation: https://linear.app/developers/oauth-2-0-authentication
  Citation: https://linear.app/developers/agents

- The source says the OAuth token is tied to a bot/app identity.
  What is true: default OAuth acts as the authorizing user.
  App identity requires `actor=app`.
  The current docs explicitly say default actor is `user`, and `app` must be requested.
  Citation: https://linear.app/developers/oauth-2-0-authentication
  Citation: https://linear.app/developers/oauth-actor-authorization

- The source misses an important app-mode restriction.
  What is true: agent/app installs using `actor=app` cannot also request `admin` scope.
  Citation: https://linear.app/developers/agents

- The source says “App user token tied to a bot/app identity” as if that were the general OAuth case.
  What is true: for MVP planning this matters a lot.
  If SupportAgent wants comments and issue updates to appear from a bot identity, the doc should require `actor=app`.
  If SupportAgent wants actions attributed to a human installer, the doc should use default user actor mode.
  Citation: https://linear.app/developers/oauth-actor-authorization

- The source does not cover client-credentials app tokens.
  What is true: Linear supports `grant_type=client_credentials` when the app has that mode enabled.
  Those tokens:
  are `app` actor tokens
  are valid for 30 days
  have no refresh token
  replace the previous active client-credentials token for that app
  are invalidated if the app client secret rotates
  Citation: https://linear.app/developers/oauth-2-0-authentication

- The source’s “Required scopes for MVP operations” table is no longer minimum-sufficient.
  What is true:
  Read-only intake can use `read`.
  Creating issues can use `issues:create` instead of full `write`.
  Creating comments can use `comments:create` instead of full `write`.
  Updating issue state, assignee, labels, priority, and webhook administration still needs broader write access and should be called out explicitly.
  Citation: https://linear.app/developers/oauth-2-0-authentication

- The source says webhook registration is API-only and says “No UI-based webhook registration.”
  What is true: current official docs say the easiest way is via Settings and show a UI flow.
  API creation via `webhookCreate` also exists.
  Citation: https://linear.app/developers/webhooks

- The source says webhook secret can be generated by Linear or supplied by us.
  What is true: the public webhooks docs do not document caller-supplied secrets in the `webhookCreate` example.
  The docs say the signing secret can be found on the webhook detail page.
  This should be treated as a doc gap or an implementation detail to verify against schema, not a fact.
  Citation: https://linear.app/developers/webhooks

- The source’s webhook signing section mixes public spec and SDK internals.
  What is true in the public docs:
  Signature header: `Linear-Signature`
  Algorithm: HMAC-SHA256 over the raw request body
  Timestamp source documented publicly: `webhookTimestamp` field in the parsed JSON body
  Replay guidance: reject if older than about 60 seconds
  Optional extra validation: source IP allowlist
  Citation: https://linear.app/developers/webhooks

- The source says timestamp header is `linear-timestamp` as part of the platform spec.
  What is true: the official web docs do not document a `Linear-Timestamp` header at all.
  The current SDK does export `LINEAR_WEBHOOK_TS_HEADER = "linear-timestamp"` and prefers that header if present, then falls back to the body field, but that is an SDK implementation detail rather than the documented webhook contract.
  Citation: https://linear.app/developers/webhooks
  Citation: `@linear/sdk@82.0.0` `dist/webhooks-Bbhy0Mv8.mjs`

- The source is silent on cloud-vs-region auth behavior.
  What is true: multi-region routing is intentionally hidden behind the same primary domains, including `api.linear.app`, so there is no region-specific auth base URL for the connector to select.
  Citation: https://linear.app/now/how-we-built-multi-region-support-for-linear

- The source says “Cloud only; no self-hosted variant exists.”
  What is true: I did not find public docs for a self-hosted Linear product/API variant, so “no public self-hosted Linear API variant is documented” is a fair statement.
  But the doc should still explicitly flag that enterprise/regional hosting exists behind the same domains and that there is no separate connector auth path by region.
  Citation: https://linear.app/now/how-we-built-multi-region-support-for-linear

## Endpoints
- The source should stop presenting “endpoints” as if Linear had REST resource paths.
  What is true: SupportAgent should model Linear as GraphQL-only.
  Every capability below is `POST https://api.linear.app/graphql`.
  There is no supported `/v1` REST path in the public docs.
  Citation: https://linear.app/developers/graphql

- List items:
  The source broadly gets “query issues” right but should use the real GraphQL model.
  Valid patterns:
  `team(id: "...") { issues { nodes { ... } pageInfo { ... } } }`
  `issues(filter: { ... }, first: N, after: CURSOR, orderBy: updatedAt) { nodes { ... } pageInfo { ... } }`
  Citation: https://linear.app/developers/graphql
  Citation: https://linear.app/developers/pagination
  Citation: https://linear.app/developers/filtering

- Get one item:
  The source is fine to use `issue(id: "BLA-123")` or a UUID.
  Current docs explicitly allow shorthand issue identifiers for issue fetch/update.
  Citation: https://linear.app/developers/graphql

- Create item:
  The source mutation name `issueCreate` is correct.
  The example body is incomplete but valid as a minimal example if it includes at least `teamId`.
  Better MVP example:
  `input: { teamId, title, description, priority, assigneeId, labelIds, projectId, cycleId, stateId }`
  Current public SDK surface also supports `delegateId`, `dueDate`, `subscriberIds`, `parentId`, `templateId`, and more.
  Citation: https://linear.app/developers/graphql
  Citation: `@linear/sdk@82.0.0` `IssueCreateInput`

- Edit/patch item:
  The source mutation `issueUpdate` is correct.
  The source example is too narrow for SupportAgent.
  `IssueUpdateInput` currently supports:
  `assigneeId`
  `delegateId`
  `description`
  `dueDate`
  `labelIds`
  `addedLabelIds`
  `removedLabelIds`
  `priority`
  `projectId`
  `releaseIds`
  `stateId`
  `subscriberIds`
  `teamId`
  `title`
  `trashed`
  Citation: https://linear.app/developers/graphql
  Citation: `@linear/sdk@82.0.0` `IssueUpdateInput`

- Delete/close item:
  The source treats archive/close/delete a bit loosely.
  What is true:
  `issueArchive` exists and is exposed in the SDK as `archiveIssue`
  `issueDelete` also exists and is exposed in the SDK as `deleteIssue`
  “close” in Linear workflow terms is usually a state transition to a completed/canceled workflow state via `issueUpdate(stateId: ...)`
  SupportAgent should distinguish:
  close/resolve = state transition
  archive = `issueArchive`
  delete = `issueDelete`
  Citation: https://linear.app/developers/graphql
  Citation: `@linear/sdk@82.0.0` GraphQL documents for `archiveIssue`, `deleteIssue`, `updateIssue`

- List comments:
  The source should name the actual read paths instead of implying a REST-style endpoint.
  Valid patterns:
  `issue(id: ...) { comments { nodes { ... } pageInfo { ... } } }`
  `comments(filter: { issue: { id: { eq: "..." } } }) { nodes { ... } }`
  Citation: https://linear.app/developers/sdk-fetching-and-modifying-data
  Citation: `@linear/sdk@82.0.0` comment connection types

- Post comment:
  The source mutation `commentCreate` is correct.
  The example body is valid for an issue comment when it uses `issueId` plus optional `body` and optional `parentId`.
  Current input also supports `createAsUser`, `displayIconUrl`, `doNotSubscribeToIssue`, `quotedText`, and more.
  Citation: `@linear/sdk@82.0.0` `CommentCreateInput`

- Edit comment:
  The source mutation `commentUpdate` is correct.
  The likely MVP-safe input is just `{ body: "..." }`.
  Citation: `@linear/sdk@82.0.0` `CommentUpdateInput`

- Delete comment:
  The source mutation `commentDelete` is correct.
  The response shape is a delete payload with `success`, `entityId`, `lastSyncId`, not just a naked success boolean.
  Citation: `@linear/sdk@82.0.0` `DeleteCommentDocument`

- Add/remove label or tag:
  The source says labels are set by sending full `labelIds`, and suggests `issueLabelCreate` or `issueLabelDelete` for granular control.
  That is misleading for SupportAgent.
  Current surface also exposes:
  `issueAddLabel(id, labelId)`
  `issueRemoveLabel(id, labelId)`
  And `issueUpdate` supports:
  `addedLabelIds`
  `removedLabelIds`
  `labelIds`
  `issueLabelCreate` and `issueLabelDelete` are label-definition operations, not issue-label-assignment operations.
  Citation: `@linear/sdk@82.0.0` GraphQL documents for `issueAddLabel`, `issueRemoveLabel`, `updateIssue`

- Set priority:
  The source’s example is valid.
  The integer mapping in the source is also consistent with current type comments:
  `0` none
  `1` urgent
  `2` high
  `3` medium
  `4` low
  Citation: `@linear/sdk@82.0.0` `IssueCreateInput` and `IssueUpdateInput`

- Set/change status or transition:
  The source is right that status changes are driven by `stateId`, not literal status strings.
  But the source should stop saying “fetch via `team.workflow.states`” unless it verifies that exact field shape against current schema.
  The public docs show `workflowStates` and `workflowState(id)` queries.
  Safer wording: statuses are `WorkflowState` records and transitions use `stateId`.
  Citation: https://linear.app/developers/graphql

- Assign a user:
  The source example using `assigneeId` is correct.
  But the connector spec should also mention `delegateId` for app/agent delegation because that is now part of the current issue model and matters if SupportAgent ever runs as an app actor.
  Citation: https://linear.app/developers/agents
  Citation: `@linear/sdk@82.0.0` `IssueCreateInput` and `IssueUpdateInput`

- Mention a user:
  The source is wrong here.
  It says to use `@[Name](user:user-uuid)` and “user URNs”.
  Current official docs say mentions in GraphQL markdown are created by inserting the plain Linear URL of the resource.
  Example:
  `https://linear.app/yourworkspaceurl/profiles/someuser`
  `https://linear.app/yourworkspaceurl/issue/LIN-123/some-issue`
  Citation: https://linear.app/developers/graphql

- Attach file:
  The source says “File upload (binary) is not supported via API — external URLs only.”
  That is incorrect.
  Current official docs explicitly document:
  `fileUpload` mutation to get a pre-signed upload URL
  server-side `PUT` of the file bytes to that URL
  resulting `assetUrl` for later use in issue/comment markdown
  Citation: https://linear.app/developers/how-to-upload-a-file-to-linear
  Citation: `@linear/sdk@82.0.0` `UploadPayload`

- Attach URL/link:
  The source’s `attachmentCreate` example is also incomplete.
  Current public SDK surface requires:
  `issueId`
  `title`
  `url`
  Optional:
  `subtitle`
  `metadata`
  `iconUrl`
  `commentBody`
  There is no documented `archivable` field on `AttachmentCreateInput`.
  Citation: https://linear.app/developers/attachments
  Citation: `@linear/sdk@82.0.0` `AttachmentCreateInput`

- Response shapes:
  The source repeatedly shows simplified payloads that omit `lastSyncId`.
  Current SDK mutation payloads commonly include:
  `success`
  `lastSyncId`
  mutated entity or `entityId`
  This matters if SupportAgent wants deterministic sync cursors or auditability.
  Citation: `@linear/sdk@82.0.0` `CommentPayload`, `AttachmentPayload`, `IssuePayload`, `IssueBatchPayload`, `UploadPayload`

- Example bodies with hallucinated fields:
  `AttachmentCreateInput.archivable` appears hallucinated.
  Issue mention URN syntax appears hallucinated.
  `Issue.body` as HTML/rich text appears unsupported in current public docs; current public write fields are `description` and internal `descriptionData`.
  Current webhook payload docs also do not support the source’s `creator: { id, name, email }` expansion for issue/comment data payloads as written.
  Citation: https://linear.app/developers/graphql
  Citation: https://linear.app/developers/webhooks
  Citation: `@linear/sdk@82.0.0` `IssueCreateInput`, `IssueUpdateInput`, `AttachmentCreateInput`

- Severity:
  The source is correct that Linear does not have a built-in severity field.
  But it should say explicitly that SupportAgent must model severity through labels or custom fields, not expect a first-class issue property.

- Label model:
  The source says labels are flat and have no hierarchy.
  That is no longer safe.
  Current SDK types include `isGroup` and `parentId` on `IssueLabelUpdateInput`.
  Citation: `@linear/sdk@82.0.0` `IssueLabelUpdateInput`

- Identity shape:
  The source says IDs are ULIDs.
  That contradicts current official examples and current SDK comments, which repeatedly reference UUID v4 strings for model IDs plus human-readable issue identifiers like `LIN-123`.
  Citation: https://linear.app/developers/graphql
  Citation: https://linear.app/developers/webhooks
  Citation: `@linear/sdk@82.0.0` input type comments

## Inbound events
- The source’s event inventory is incomplete.
  Current public docs list data-change webhooks for:
  `Issue`
  `Issue attachments`
  `Issue comments`
  `Issue labels`
  `Comment reactions`
  `Projects`
  `Project updates`
  `Documents`
  `Initiatives`
  `Initiative Updates`
  `Cycles`
  `Customers`
  `Customer Requests`
  `Users`
  Plus convenience webhooks for:
  `Issue SLA`
  `OAuthApp revoked`
  Current SDK webhook union additionally exposes:
  `AppUserNotification`
  `PermissionChange`
  `AgentSessionEvent`
  Citation: https://linear.app/developers/webhooks
  Citation: `@linear/sdk@82.0.0` `LinearWebhookEventType`

- The source’s action model is wrong.
  It says action values include `create`, `update`, `delete`, `archive`, `unarchive`.
  Current official webhooks docs say data change events use:
  `create`
  `update`
  `remove`
  Other event streams can have event-specific action values.
  Citation: https://linear.app/developers/webhooks

- The source says each webhook is registered via a `type` field on subscription.
  What is true: the public webhook creation docs use `resourceTypes`.
  Citation: https://linear.app/developers/webhooks

- The source says “No UI-based webhook registration.”
  That is false and matters operationally for inbound setup flows.
  Linear documents both Settings UI and GraphQL API creation paths.
  Citation: https://linear.app/developers/webhooks

- The source’s top-level payload examples are too thin.
  Current documented/common top-level shape for entity webhooks is:
  `action`
  `type`
  `actor`
  `data`
  `url`
  `createdAt`
  `organizationId`
  `webhookTimestamp`
  `webhookId`
  `updatedFrom` on updates
  Citation: https://linear.app/developers/webhooks
  Citation: `@linear/sdk@82.0.0` `BaseWebhookPayload` and entity webhook unions

- The source inflates nested issue/comment webhook payloads.
  What is true:
  Current docs show `actor` at the top level and entity data under `data`.
  The SDK’s webhook payload types include many scalar IDs and selected child objects under `data`, but not the exact “creator object with email” shape the source presents for issue/comment intake.
  SupportAgent should not implement against those invented nested objects.
  Citation: https://linear.app/developers/webhooks
  Citation: `@linear/sdk@82.0.0` `IssueWebhookPayload`, `CommentWebhookPayload`

- The source says `botActor.id` is the critical loop-prevention identifier.
  What is true: that is not documented as the stable public contract.
  Public docs center the top-level `actor`.
  Current SDK webhook payload types expose `botActor` on issue/comment payloads, but the published base payloads and docs do not guarantee the exact nested object shape described in the source.
  Safer loop prevention for MVP:
  compare top-level `actor.id` and actor type when running as `actor=app`
  store your own app user ID from `viewer { id }`
  optionally ignore events whose payload `data.userId` or `creatorId` matches your app user
  Citation: https://linear.app/developers/webhooks
  Citation: https://linear.app/developers/agents
  Citation: `@linear/sdk@82.0.0` webhook payload types

- The source does not mention `Linear-Delivery`.
  What is true: the public webhook docs include `Linear-Delivery`, a UUID v4 unique delivery identifier.
  SupportAgent should persist it for dedupe/replay tracking.
  Citation: https://linear.app/developers/webhooks

- Signature verification:
  The source is broadly right on HMAC-SHA256 over raw bytes.
  It should also note:
  use raw request body
  compare with constant-time semantics
  verify timestamp within about 60 seconds
  IP allowlist is optional defense-in-depth
  Citation: https://linear.app/developers/webhooks

- Replay protection:
  The source says “No replay protection beyond timestamp.”
  That is not the right framing for an implementation review.
  There is a documented timestamp check.
  There is also `Linear-Delivery`, which SupportAgent can use as an idempotency key even though Linear does not present it as a full anti-replay protocol.
  Citation: https://linear.app/developers/webhooks

- Delivery guarantees and retry windows:
  The source says retries are exponential up to about 24h and gives no exact schedule.
  Current public docs are more precise:
  failure conditions include non-200, server unavailable, or response taking longer than 5 seconds
  retries happen a maximum of 3 times
  backoff schedule is 1 minute, 1 hour, and 6 hours
  webhooks may be disabled if the endpoint remains unresponsive
  Citation: https://linear.app/developers/webhooks

- Polling fallback:
  The source says “No cursor from the API itself — use updatedAt timestamps as pseudo-cursors.”
  That is wrong.
  Linear uses Relay-style cursor pagination with `pageInfo.endCursor`.
  For polling, the docs recommend ordering by `updatedAt`, filtering, and using cursor pagination.
  SupportAgent should persist both:
  a time overlap window for `updatedAt`
  the GraphQL cursor for page traversal
  Citation: https://linear.app/developers/pagination
  Citation: https://linear.app/developers/graphql

- The source says “No `updated_since` filter.”
  That is reasonable in spirit but the phrasing should be narrower.
  The public docs do not document a generic `updated_since` convenience parameter.
  They do document filtering and ordering.
  The current schema clearly supports filter objects such as `updatedAt`.
  Citation: https://linear.app/developers/filtering
  Citation: https://linear.app/developers/graphql

- New-comment detection:
  The source implies issue polling can cover comment events.
  That is not enough for SupportAgent.
  If webhook delivery is unavailable, the doc should spell out a comment polling strategy too:
  use `issue.comments` or `comments(filter: ...)`
  filter/order by `updatedAt`
  overlap the time window
  dedupe on comment ID
  This is currently a gap in the source doc.

- Mention detection:
  The source says mention detection can use `@[BotName](user:bot-id)` in body text.
  That syntax is not supported per current docs.
  SupportAgent should assume generic issue/comment webhooks do not provide a dedicated “mentioned users” array in the public contract.
  For generic connector mode, mention detection likely requires parsing markdown/body content or using the AgentSessionEvent flow if building a true Linear agent app.
  Citation: https://linear.app/developers/graphql
  Citation: https://linear.app/developers/agents

- Agent-native mention/delegation:
  The source does not mention that if SupportAgent is implemented as a true Linear app/agent, a mention or delegation can drive `AgentSessionEvent` webhooks instead of generic comment polling heuristics.
  That is a real product-path decision and should be an explicit open question.
  Citation: https://linear.app/developers/agents

## Hosting variants
- The source says “Cloud only; no self-hosted variant exists.”
  Publicly, that is close enough for the Linear product itself, but the review doc should be more precise:
  no public self-hosted Linear API/deployment variant is documented
  enterprise and regional hosting still exist on the same primary domains
  Citation: https://linear.app/now/how-we-built-multi-region-support-for-linear

- The source does not cover region/data residency.
  Current official Linear material says new workspaces can be hosted in Europe and still use the same `linear.app` and `api.linear.app` domains.
  That should be documented because it affects SupportAgent assumptions about base URLs and token audience.
  Citation: https://linear.app/now/how-we-built-multi-region-support-for-linear

- The source does not cover base URL stability across regions.
  What is true: Linear intentionally kept the same client and API domains across regions.
  There is no region-specific base URL for the connector to configure.
  Citation: https://linear.app/now/how-we-built-multi-region-support-for-linear

- The source incorrectly introduces versioning at the path level with `/graphql/v1`.
  Current official deprecation policy says the GraphQL API is not versioned like REST.
  Deprecations are handled through schema `@deprecated` and changelog entries.
  Citation: https://linear.app/developers/graphql
  Citation: https://linear.app/developers/deprecations

- The source is silent on breaking-change policy.
  Current official docs say there is no major-version API scheme here.
  Breaking changes are handled through the schema and proactive outreach for notable changes.
  Citation: https://linear.app/developers/deprecations

- The source is silent on currently relevant auth drift.
  Two current version-drift items need explicit mention:
  OAuth apps were migrated to refresh tokens on April 1, 2026
  `actor=application` is deprecated in favor of `actor=app`
  Citation: https://linear.app/developers/oauth-2-0-authentication
  Citation: https://linear.app/developers/oauth-actor-authorization

- The source is silent on feature-matrix caveats.
  SupportAgent should explicitly distinguish:
  generic GraphQL connector mode
  app/agent mode using `actor=app`
  agent-specific scopes/events which are still documented under the Agents area and include Developer Preview elements
  Citation: https://linear.app/developers/agents

- The source does not provide a cloud-only/EE-only/min-version matrix.
  Publicly, I did not find developer-doc evidence for separate cloud-vs-enterprise API surfaces or minimum API versions.
  That absence itself should be recorded instead of guessing.

## Rate limits & pagination
- The source says “Global limit ~600 requests/minute per workspace.”
  That is incorrect.
  Current official docs say:
  API key: 5,000 requests per hour per user
  OAuth App: 5,000 requests per hour per user or app user
  Unauthenticated: 600 requests per hour per IP
  Citation: https://linear.app/developers/rate-limiting

- The source says PAT and OAuth tokens share a workspace quota.
  Current docs frame request limits per authenticated user or app user, not per workspace-wide shared bucket.
  Citation: https://linear.app/developers/rate-limiting

- The source is incomplete on rate-limit headers.
  Current official docs document:
  `X-RateLimit-Requests-Limit`
  `X-RateLimit-Requests-Remaining`
  `X-RateLimit-Requests-Reset`
  Plus endpoint-specific:
  `X-RateLimit-Endpoint-Requests-Limit`
  `X-RateLimit-Endpoint-Requests-Remaining`
  `X-RateLimit-Endpoint-Requests-Reset`
  `X-RateLimit-Endpoint-Name`
  Plus complexity:
  `X-Complexity`
  `X-RateLimit-Complexity-Limit`
  `X-RateLimit-Complexity-Remaining`
  `X-RateLimit-Complexity-Reset`
  Citation: https://linear.app/developers/rate-limiting

- The source misses the complexity budget entirely.
  Current official docs say:
  API key: 3,000,000 complexity points per hour
  OAuth app: 2,000,000 complexity points per hour
  Unauthenticated: 100,000 complexity points per hour
  Maximum single-query complexity: 10,000 points
  Citation: https://linear.app/developers/rate-limiting

- The source says Retry-After is not documented and recommends generic exponential backoff.
  That is partly right but incomplete.
  Current official docs do not document `Retry-After`.
  They do document reset headers and a GraphQL `RATELIMITED` error code with HTTP 400.
  The connector should therefore back off using the reset headers when present, not just blind exponential backoff.
  Citation: https://linear.app/developers/rate-limiting

- The source should characterize rate-limit failures more precisely.
  Current docs say rate-limited GraphQL requests return HTTP 400 with `errors[].extensions.code = RATELIMITED`.
  Citation: https://linear.app/developers/rate-limiting

- The source says “No bulk endpoints.”
  That is false.
  Current SDK/schema surface includes:
  `issueBatchCreate`
  `issueBatchUpdate`
  Citation: `@linear/sdk@82.0.0` GraphQL documents for `createIssueBatch` and `updateIssueBatch`

- The source says max page size is 250.
  I did not find a public Linear docs citation for that.
  Current official docs document only:
  Relay cursor pagination
  default 50 results
  `first` / `after` and `last` / `before`
  Because the source has no citation for 250, this should be treated as unsupported and removed or replaced with “verify against schema before relying on a hard max.”
  Citation: https://linear.app/developers/pagination

- The source says “No cursor from the API itself.”
  That is plainly wrong.
  Current pagination is cursor-based and exposes `pageInfo.endCursor`.
  Citation: https://linear.app/developers/pagination

- The source should note the default ordering behavior more carefully.
  Current docs say default ordering is by `createdAt`, and callers can order by `updatedAt` when polling recent changes.
  Citation: https://linear.app/developers/pagination
  Citation: https://linear.app/developers/graphql

- The source’s concurrency guidance is missing.
  Given the documented request limits, complexity limits, endpoint-specific caps, and webhook preference, the review should recommend:
  keep pollers low-concurrency
  page serially per workspace/team
  prefer webhooks for high-churn intake
  use custom narrow GraphQL selections
  avoid fetching nested connections unless needed
  Citation: https://linear.app/developers/rate-limiting

## SDK & implementation path
- The source correctly names `@linear/sdk`, and the claimed version `82.0.0` is current as of April 18, 2026.
  Citation: npm registry `@linear/sdk`

- The source’s code sample uses `import { Linear } from "@linear/sdk";`.
  Current official docs use `LinearClient`, not `Linear`.
  The review doc should treat the sample as outdated and align examples with the current SDK.
  Citation: https://linear.app/developers/graphql
  Citation: https://linear.app/developers/sdk-fetching-and-modifying-data

- The source should be clearer about what the SDK really buys us.
  Current documented SDK capabilities include:
  strong TypeScript typing
  model and connection helpers
  pagination helpers `fetchNext()` / `fetchPrevious()`
  webhook helper `LinearWebhookClient`
  raw GraphQL access via `client.rawRequest(...)`
  parsed error types
  Citation: https://linear.app/developers/sdk-fetching-and-modifying-data
  Citation: https://linear.app/developers/advanced-usage
  Citation: https://linear.app/developers/sdk-errors
  Citation: https://linear.app/developers/sdk-webhooks

- The source overstates some SDK-adjacent assumptions.
  I did not find official documentation for:
  automatic retry handling in the SDK
  documented webhook retry abstractions beyond signature verification
  a documented official CLI for Linear integration work
  Those should stay in SupportAgent’s own connector layer, not be implied as SDK features.
  Citation: https://linear.app/developers/sdk-errors
  Citation: https://linear.app/developers/sdk-webhooks

- Raw fetch vs SDK recommendation:
  The source should recommend a hybrid approach, not a false choice.
  Recommended path:
  SDK for auth wiring, typed common mutations, pagination helpers, webhook verification, and error parsing
  Custom GraphQL documents or `rawRequest` for SupportAgent polling paths and narrow intake projections, because Linear explicitly recommends custom, specific queries to control complexity
  Citation: https://linear.app/developers/advanced-usage
  Citation: https://linear.app/developers/rate-limiting

- CLI shell-out:
  The source should not suggest a CLI-based connector path unless it is prepared to own a third-party CLI dependency.
  I did not find an official Linear CLI in current docs.
  For SupportAgent this should be “no official CLI path; do not shell out for MVP.”

- MVP ordering:
  The current source doc’s implied MVP is too optimistic because it assumes generic webhook mentions, URL-only attachments, and simplified auth.
  A realistic phased path is:
  MVP: PAT or OAuth user actor, issue/comment read-write, webhooks for Issue and Comment, simple polling fallback, comment-back
  Phase 2: app actor mode, delegation support, stricter loop prevention, file upload support, label add/remove helpers, batch issue operations if needed
  Phase 3: agent-native `AgentSessionEvent`, client-credentials app tokens, regional/data-residency operational hardening

- MVP config fields should be updated.
  The current source doc should at minimum drive:
  `auth_mode` = `pat` | `oauth_user` | `oauth_app` | `oauth_client_credentials`
  `api_base_url` default `https://api.linear.app/graphql`
  `webhook_secret`
  `app_user_id` when using `actor=app`
  `team_ids` or mapping scope
  `poll_overlap_seconds`
  `last_seen_updated_at`
  `last_seen_cursor`
  `state_id_map` per team
  `label_id_map` per team
  `use_agent_session_events` boolean only if app mode is chosen

- Open questions should be sharper.
  The current document should explicitly ask:
  Do we want human-attributed writes or app-attributed writes?
  Do we need agent delegation, not just assignment?
  Are we using generic issue/comment webhooks or true agent webhooks?
  Do we need comment/body mention parsing or only assignment/delegation triggers?
  Will we support binary file upload into Linear or only outbound links?
  How will we persist per-team state IDs and label IDs?
  What retry/backoff policy should key off reset headers vs GraphQL 400 bodies?
  Do we need EU-region/data-residency disclosure in tenant setup?

## Priority fixes
1. Replace every `/graphql/v1` reference with `https://api.linear.app/graphql`, and fix PAT auth from `Bearer <token>` to `Authorization: <API_KEY>`. Source: https://linear.app/developers/graphql
2. Rewrite the OAuth section to current reality: default user actor, optional `actor=app`, current scopes, 24h access tokens, refresh-token lifecycle, and client-credentials support. Source: https://linear.app/developers/oauth-2-0-authentication and https://linear.app/developers/oauth-actor-authorization
3. Rewrite webhook semantics: UI registration exists, `resourceTypes` is the creation surface, data-change actions are `create`/`update`/`remove`, payloads include `organizationId`/`webhookId`/`webhookTimestamp`, and retries are `1m`/`1h`/`6h` with max 3 retries. Source: https://linear.app/developers/webhooks
4. Fix mention handling. Remove `@[Name](user:user-uuid)` and document plain Linear resource URLs for outbound mentions. Mark inbound mention detection as a connector decision that likely requires parsing or agent-native events. Source: https://linear.app/developers/graphql and https://linear.app/developers/agents
5. Fix attachment/file guidance. `attachmentCreate` requires `issueId`, `title`, and `url`; `archivable` is unsupported; binary upload is supported through `fileUpload` plus server-side `PUT`. Source: https://linear.app/developers/attachments and https://linear.app/developers/how-to-upload-a-file-to-linear
6. Fix label and status operations. Document `issueAddLabel`, `issueRemoveLabel`, `addedLabelIds`, `removedLabelIds`, `assigneeId`, `delegateId`, and `stateId`; stop implying `issueLabelCreate`/`issueLabelDelete` are how to attach labels to issues. Source: current `@linear/sdk@82.0.0`
7. Replace the rate-limit section entirely. Current numbers are per hour, not per minute, and the doc must include request headers, endpoint-specific headers, complexity limits, HTTP 400 `RATELIMITED`, and the absence of documented `Retry-After`. Source: https://linear.app/developers/rate-limiting
8. Remove unsupported claims about pagination max size, ULID IDs, flat labels, `Issue.body` HTML payloads, and `botActor.id` as a guaranteed public loop-prevention field. Replace them with current documented contract or mark them as schema-verification TODOs. Sources: https://linear.app/developers/pagination, https://linear.app/developers/graphql, https://linear.app/developers/webhooks, current `@linear/sdk@82.0.0`
