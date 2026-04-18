# Trello combined review

## Verdict
The source document is directionally useful for a Trello cloud connector, but it is not yet safe as an implementation reference. The biggest gaps are: it overstates OAuth2 readiness, gets several write endpoints wrong, understates or misstates webhook behavior, and gives inaccurate rate-limit guidance. Confidence is high on the core corrections below because they are backed by Trello’s current official REST, webhook, custom-fields, and rate-limit docs as of 2026-04-18.

## Authentication
- The doc is correct that Trello is cloud-only and that SupportAgent should target the REST API rather than Power-Ups for server-side automation.
- The doc is also correct that the practical auth path today is API key + user token.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/
- The doc should explicitly say there is no Trello service-account auth model for this connector.
  What the doc says: it discusses API key, PAT-like token, OAuth2, and Power-Ups, but never explicitly rules out service accounts.
  What is true: the official Trello REST docs center on app key + user token and token-owned webhooks; there is no first-party service-account install flow analogous to GitHub Apps or Slack app installations in the docs reviewed.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/
- The doc should explicitly say there is no app-install auth mode for external backend integrations in the Trello REST docs reviewed.
  What the doc says: it mentions Power-Ups, which may imply an installable app model is relevant.
  What is true: Power-Ups are UI-side extensions; the backend connector path still hinges on app key + token, and the Power-Up/client.js docs are browser-oriented rather than a backend installation/auth model.
  Citations:
  https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/
  https://developer.atlassian.com/cloud/trello/guides/client-js/client-js-reference/
- The scope model for current token auth is described mostly correctly: `read`, `write`, and `account`.
  Citation: https://developer.atlassian.com/cloud/trello/guides/client-js/client-js-reference/
- The minimum-sufficient scope guidance needs tightening.
  What the doc says: `account` is part of the scope table and is presented alongside the others without a strong warning.
  What is true: SupportAgent MVP should default to `read,write`; `account` should be optional and only requested if email or account-only fields are actually needed. The doc itself says email is not reliably available.
  Citations:
  https://developer.atlassian.com/cloud/trello/guides/client-js/client-js-reference/
  https://developer.atlassian.com/cloud/trello/rest/api-group-tokens/
- The token-expiry section is partially correct but incomplete operationally.
  What the doc says: expiration options are `1hour`, `1day`, `30days`, `never`, and MVP should use `never`.
  What is true: those expiry values are documented, but the review doc should also call out that there is no refresh-token flow for the current key+token model; rotation is revoke-and-reissue, and token deletion is an explicit REST operation.
  Citations:
  https://developer.atlassian.com/cloud/trello/guides/client-js/client-js-reference/
  https://developer.atlassian.com/cloud/trello/rest/api-group-tokens/
- The doc should not describe OAuth2 3LO as a realistic near-term implementation path for SupportAgent yet.
  What the doc says: “OAuth2 3LO (Phase 2+)” with new scopes like `data:read`, `data:write`, `action:read`, `action:write`, `account:read`.
  What is true: Trello’s changelog announced OAuth2 introduction in April 2025, but the current REST resources SupportAgent needs still repeatedly state “Forge and OAuth2 apps cannot access this REST resource,” including cards, boards, tokens, and token-scoped webhooks. The doc’s OAuth2 scope names are therefore not a safe basis for this connector design.
  Citations:
  https://developer.atlassian.com/cloud/trello/changelog/
  https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
  https://developer.atlassian.com/cloud/trello/rest/api-group-boards/
  https://developer.atlassian.com/cloud/trello/rest/api-group-tokens/
- The doc should say more clearly that the app secret is required if SupportAgent wants to verify webhook signatures.
  What the doc says: webhook HMAC uses `appSecret`, but the MVP config list does not include it.
  What is true: Trello signs webhook requests with the application secret, which is distinct from the public API key. Without storing the secret, signature verification cannot be implemented.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
- The doc should distinguish between public and secret credentials.
  What the doc says: `apiKey` and `apiToken` are both config entries.
  What is true: Trello’s docs explicitly say the API key is intended to be publicly accessible, while the API token must be kept secret. The review doc should reflect that so secrets handling is precise.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/
- The doc should add webhook-owned-by-token consequences to the token lifecycle section.
  What the doc says: token expiry is listed, but webhook impact is not fully emphasized.
  What is true: if the token is revoked or expires, the webhook is deleted.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
- The doc correctly notes there is no self-hosted/Data Center Trello variant.
- The doc correctly notes cloud enterprise customers still use the same cloud API family.
- The doc should add one more auth implementation note: for SupportAgent, OAuth header support is not especially valuable versus query-param auth, because all official examples for these resources use `key` and `token` query parameters and webhook registration examples are token-scoped that way.
  Citations:
  https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/
  https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/

## Endpoints
- The base URL `https://api.trello.com/1` is correct.
- The source doc should separate destructive delete from archive/close.
  What the doc says: “delete/close” coverage is blurred, with most implementation guidance focused on `closed=true`.
  What is true: both exist. Archive/unarchive is `PUT /1/cards/{id}?closed=true|false`; hard delete is `DEL /1/cards/{id}`.
  Citation: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- `GET /1/cards/{id}` for “get one” is correct.
  Citation: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- `POST /1/cards` for create is correct, but the doc should mention that JSON bodies are allowed and not just query params.
  Citation: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- `PUT /1/cards/{id}` for edit is correct.
  Citation: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- The list-items guidance should be narrowed to supported access patterns rather than implying one universal paged collection endpoint.
  What the doc says: board-state calls and board actions calls are both used, but “list items” coverage is not normalized.
  What is true: SupportAgent will likely need:
  `GET /1/boards/{id}/cards`
  `GET /1/boards/{id}/cards/{filter}`
  `GET /1/boards/{boardId}/actions`
  `GET /1/cards/{id}`
  and possibly `GET /1/cards/{id}/actions` for card-local comment/activity refreshes.
  Citations:
  https://developer.atlassian.com/cloud/trello/rest/api-group-boards/
  https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- Comment create is correctly identified as `POST /1/cards/{id}/actions/comments?text=...`.
  Citation: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- Comment edit is wrong in the source.
  What the doc says: “Not directly supported” and suggests delete+recreate.
  What is true: Trello has a first-party edit endpoint:
  `PUT /1/cards/{id}/actions/{idAction}/comments?text=...`
  Citation: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- Comment delete is incomplete in the source.
  What the doc says: `DELETE /1/actions/{actionId}`
  What is true: the card-comment delete endpoint Trello documents for this flow is:
  `DELETE /1/cards/{id}/actions/{idAction}/comments`
  The broader actions-group delete route may exist elsewhere, but this doc is meant to be implementation-safe for the card connector path and should use the card-scoped route it can cite.
  Citation: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- Existing-label add is wrong in the source.
  What the doc says: `POST /1/cards/{cardId}/labels` with `color` or `name`, and implies it can add existing labels.
  What is true: there are two distinct operations:
  `POST /1/cards/{id}/idLabels?value={labelId}` adds an existing board label to a card.
  `POST /1/cards/{id}/labels?color=...&name=...` creates a new board label and adds it to the card.
  The source doc conflates them.
  Citation: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- Label removal is wrong in the source.
  What the doc says: `DELETE /1/cards/{cardId}/labels/{labelId}`
  What is true: the documented route is `DELETE /1/cards/{id}/idLabels/{idLabel}`.
  Citation: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- Member assignment add is wrong in the source.
  What the doc says: `POST /1/cards/{cardId}/members &value={memberId}`
  What is true: the documented route is `POST /1/cards/{id}/idMembers?value={memberId}`.
  Citation: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- Member assignment removal is wrong in the source.
  What the doc says: `DELETE /1/cards/{cardId}/members/{memberId}`
  What is true: the documented route is `DELETE /1/cards/{id}/idMembers/{idMember}`.
  Citation: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- The “mention user” section is too confident.
  What the doc says: mention syntax is `@{username}` or `@{fullName}`.
  What is true: Trello comments are plain text over the REST endpoint, and the docs reviewed do not provide a REST contract guaranteeing mention parsing semantics by `username` versus `fullName`. For SupportAgent, mentions should be treated as text patterns unless product behavior is verified separately.
  Citation: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- Attachment upload coverage is incomplete and contains unsupported numeric limits.
  What the doc says: URL attach and multipart upload are supported, max 10MB, max 4 attachments per card.
  What is true: the documented endpoint is `POST /1/cards/{id}/attachments` with query params including `name`, `file`, `mimeType`, `url`, and `setCover`. The official docs reviewed do not support the hard-coded `10MB` / `4 attachments per card` claims. Trello’s limits docs explicitly warn that object limits vary and should be read from API responses rather than hard-coded.
  Citations:
  https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
  https://developer.atlassian.com/cloud/trello/guides/rest-api/limits/
- The label model section contains at least one unsupported claim.
  What the doc says: 50 labels per board.
  What is true: the official docs reviewed do not document a fixed 50-label cap here. The review doc should either cite a current official limit page or remove this number.
  Citation for limits variability: https://developer.atlassian.com/cloud/trello/guides/rest-api/limits/
- The label colors list is incomplete/misaligned with current examples.
  What the doc says in one place: label colors include `grey`; in another place: `black`, `yellow`, and no `grey`.
  What is true: the doc is internally inconsistent and should be normalized against current Trello label enum docs before implementation.
  Citation: https://developer.atlassian.com/cloud/trello/rest/api-group-boards/
- The custom-field type list is wrong.
  What the doc says: `text`, `number`, `date`, `checkbox`, `select`, `rating`.
  What is true: the custom-fields guide documents types as `checkbox`, `date`, `list`, `number`, and `text`; there is no `rating` type, and “select” is represented as `list`.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/getting-started-with-custom-fields/
- The custom-field update example body is wrong or misleading.
  What the doc says: `&value={jsonValue}` via query string.
  What is true: the documented endpoint supports JSON request bodies. For list-type fields you use `idValue`; for others you send `value` with string payloads such as `{ "number": "42" }` or `{ "checked": "true" }`.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/getting-started-with-custom-fields/
- The source doc correctly states Trello has no built-in priority or severity model.
- The source doc correctly suggests labels and custom fields as the practical mapping surface.
- The source doc should prefer list IDs and label IDs in config mappings, not list names and label names.
  What the doc says: `listNameToStatus` and `labelNameToPriority`.
  What is true: list names and label names are editable. SupportAgent should map from stable IDs, storing display names only for operator UX.
  Citation context: Trello resources are ID-first across board/list/card/label/member APIs.
  Citations:
  https://developer.atlassian.com/cloud/trello/rest/api-group-boards/
  https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- The document is silent on valid example request bodies for several operations where body form matters.
  Gap: create card, update card, comment edit, custom field update, attachment upload.
  Fix needed: show at least one body/query example per SupportAgent-required write path, using only documented fields.

## Inbound events
- The webhook section is broadly on the right mechanism: Trello webhooks should be the primary inbound path.
- The webhook registration endpoint the doc uses is valid:
  `POST /1/tokens/{token}/webhooks`
  Citation: https://developer.atlassian.com/cloud/trello/rest/api-group-tokens/
- The callback HEAD requirement is correctly described.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
- The HMAC description is basically correct.
  What the doc says: `X-Trello-Webhook`, base64(HMAC-SHA1(appSecret, JSON.stringify(body)+callbackURL))
  What is true: Trello documents the header, HMAC-SHA1, binary representation of request body + callbackURL, keyed by the application secret.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
- The webhook signature section should be strengthened in two ways.
  Gap 1: it should say there is no documented timestamp, nonce, or replay-protection header from Trello.
  Gap 2: SupportAgent therefore needs local replay/idempotency protection keyed on `action.id`, plus optional duplicate suppression on identical signature/body tuples over a short window.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
- The retry section is only half-right.
  What the doc says: 3 retries with 30s, 60s, 120s backoff, then disabled after 30 consecutive failures.
  What is true: the retry timings are correct, but automatic disablement is not “30 consecutive failures.” Trello says both thresholds must be met: failures for 30 days and over 1000 times.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
- The delete-on-410 behavior is missing from the main operational guidance.
  What is true: returning HTTP 410 Gone deletes the webhook.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
- The token-lost-access behavior is underspecified.
  What the doc says: failures include token losing model access.
  What is true: that is correct, and the webhook guide also explains special admin-token behavior for organization-scoped admin visibility. That matters for enterprise/workspace-level installs.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
- The event-type matrix in the source doc is incomplete and partially wrong.
  What the doc says: key events include `createCard`, `updateCard`, `deleteCard`, `commentCard`, `moveCardToList`, etc.; it also says list create/delete/rename events are not available.
  What is true:
  `createCard`, `commentCard`, `deleteCard`, `addLabelToCard`, `removeLabelFromCard`, `addMemberToCard`, `removeMemberFromCard`, `addAttachmentToCard`, `voteOnCard`, `copyCard`, `updateCard`, `updateCheckItem`, `updateCheckItemStateOnCard`, `updateComment`, `deleteComment`, `createList`, `updateList`, `moveCardToBoard`, `moveCardFromBoard`, `moveListToBoard`, and `moveListFromBoard` are all present in Trello’s webhook action matrix.
  The specific `moveCardToList` event name is not in the official table reviewed.
  Citations:
  https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
- For SupportAgent-required inbound events, the document should explicitly include:
  `createCard`
  `commentCard`
  `updateComment`
  `deleteComment`
  `updateCard`
  `addLabelToCard`
  `removeLabelFromCard`
  `addMemberToCard`
  `removeMemberFromCard`
  `addAttachmentToCard`
  `deleteAttachmentFromCard`
  and possibly `updateCustomFieldItem` if priority/severity will be custom-field based.
  Citations:
  https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
  https://developer.atlassian.com/cloud/trello/guides/rest-api/getting-started-with-custom-fields/
- Mention detection is almost, but not fully, handled.
  What the doc says: detect `@{botUsername}` in `action.data.text`.
  What is true: webhook-only mention detection is sufficient for new comments because `commentCard` carries the text, but if comment edits can newly add a mention, SupportAgent must also process `updateComment` actions or poll for edited comment actions.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
- Bot-authored loop prevention is weaker than it should be.
  What the doc says: compare `action.idMemberCreator` to stored bot member IDs.
  What is true: that helps, but Trello also supports `X-Trello-Client-Identifier` on outbound API requests, and echoes that identifier back to webhooks owned by the same app key. That is the cleaner loop-prevention mechanism for automation.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
- Polling fallback needs correction.
  What the doc says: `page` + `limit` + `since`, with `page=0` examples.
  What is true: `page` exists on actions endpoints, but Trello’s API intro explicitly says the correct way to paginate mutable action/card lists beyond 1000 is `before`/`since`, often using the last returned action ID as `before`. The source should not present page-based iteration as the primary strategy.
  Citations:
  https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/
  https://developer.atlassian.com/cloud/trello/rest/api-group-boards/
- The polling design should explicitly recommend:
  list endpoint: `GET /1/boards/{boardId}/actions`
  filter set: include comment, update, label, member, attachment, createCard, and possibly custom-field actions
  cursor: newest seen action ID or timestamp, then page backward with `before`
  new-comment detection: `commentCard`, plus `updateComment` if edited mentions matter
  reconciliation: periodic `GET /1/boards/{id}/cards/{filter}` or `GET /1/cards/{id}`
- The source doc is silent on webhook payload scope subtleties.
  Gap: board webhooks can emit actions about many child objects; model/watch-object choice determines what arrives.
  Gap: enterprise/workspace installs may want organization-scoped webhooks in addition to board webhooks for admin lifecycle awareness.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/

## Hosting variants
- The doc is correct that there is no self-hosted Trello/Data Center path.
- The doc is correct that Atlassian Enterprise still uses the Trello cloud API surface.
- The doc should explicitly say there is no separate regional API base URL documented for data residency.
  What the doc says: nothing beyond `https://api.trello.com/1`.
  What is true: the official docs reviewed only expose the global cloud base URL. If data residency matters, that is an operational/compliance question, not an API-base-URL variant in the Trello docs reviewed.
  Citations:
  https://developer.atlassian.com/cloud/trello/
  https://developer.atlassian.com/cloud/trello/rest/
- The doc should say more clearly that there is no meaningful “major API version drift” story today for SupportAgent.
  What the doc says: base URL `/1`.
  What is true: `/1` remains the operative REST version; the more important drift risk is auth capability drift and endpoint-specific restrictions, not a `/v2` migration path.
  Citations:
  https://developer.atlassian.com/cloud/trello/rest/
  https://developer.atlassian.com/cloud/trello/changelog/
- The document’s “hosting variants” coverage is too thin on enterprise specifics.
  Gap: it should note that workspace/org admin tokens can see some private-board activity by privilege, and that losing admin status changes webhook behavior.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
- The source doc includes some deprecations, but the section is not curated around connector relevance.
  Good: it flags SCIM deprecation and member privacy endpoint change.
  Missing: it should clearly separate connector-critical deprecations from unrelated platform noise.
  Connector-relevant current examples from the official changelog are:
  SCIM deprecation notice
  compliance endpoint migration
  OAuth2 introduction announcement
  Citations:
  https://developer.atlassian.com/cloud/trello/changelog/
- The doc should not imply that Trello Business Class versus Enterprise creates a materially different REST base path for this connector. The key differences are account capabilities and admin visibility, not API host/version.
- The “feature matrix” needed by SupportAgent is currently incomplete.
  It should explicitly mark:
  API key + token: usable today
  OAuth2/Forge for needed REST resources: not usable today for this connector path
  webhooks: usable only with token-scoped REST resources
  custom fields: board feature dependent; empty arrays or 403s when disabled
  Citations:
  https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
  https://developer.atlassian.com/cloud/trello/rest/api-group-boards/
  https://developer.atlassian.com/cloud/trello/rest/api-group-tokens/
  https://developer.atlassian.com/cloud/trello/guides/rest-api/getting-started-with-custom-fields/

## Rate limits & pagination
- The source doc’s rate-limit table is materially wrong.
  What the doc says: 200 requests per second, 100 per token per 10 seconds, 300 per key per 10 seconds.
  What is true: the official limits are 300 requests per 10 seconds per API key, 100 requests per 10 seconds per token, and 100 requests per 900 seconds for `/1/members/`. The “200 requests per second” number is not supported by the official rate-limit guide reviewed.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/rate-limits/
- The source doc’s “no rate limit headers” statement is false.
  What the doc says: Trello does not return rate-limit headers.
  What is true: Trello documents and exemplifies headers such as:
  `x-rate-limit-api-token-interval-ms`
  `x-rate-limit-api-token-max`
  `x-rate-limit-api-token-remaining`
  `x-rate-limit-api-key-interval-ms`
  `x-rate-limit-api-key-max`
  `x-rate-limit-api-key-remaining`
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/rate-limits/
- The doc should not recommend fixed sleeps as the primary retry strategy.
  What the doc says: use fixed conservative delays like 100ms between writes.
  What is true: SupportAgent should inspect the returned rate-limit headers and apply bounded exponential backoff with jitter on 429s. Trello does not document `Retry-After` here, so the backoff policy has to be client-managed.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/rate-limits/
- The error-response characterization is incomplete.
  What the doc says: almost nothing beyond general limits.
  What is true: the official guide shows JSON shapes such as:
  `{ "error": "API_TOKEN_LIMIT_EXCEEDED", "message": "Rate limit exceeded" }`
  `{ "error": "API_KEY_LIMIT_EXCEEDED", "message": "Rate limit exceeded" }`
  `{ "error": "API_TOO_MANY_CARDS_REQUESTED", "message": "Requested too many cards with action loads, please limit" }`
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/rate-limits/
- The source doc should add route-specific caution for `/1/members`, `/1/membersSearch`, and `/1/search`.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/rate-limits/
- The source doc should recommend board-nested resources over member/search routes where possible.
  What is true: Trello’s guide explicitly recommends nested resources like `/1/boards/{id}/members` instead of heavy `/1/members` usage.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/rate-limits/
- The pagination section is partly right and partly misleading.
  What the doc says: offset pagination with `page` + `limit`.
  What is true: actions endpoints do expose `page`, but the Trello API intro says the right way to iterate mutable long lists past 1000 is with `before` and `since`, using the last card/action ID when needed. For SupportAgent polling, `before`/`since` should be the primary cursor strategy.
  Citations:
  https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/
  https://developer.atlassian.com/cloud/trello/rest/api-group-boards/
- The action max page size of 1000 is correct.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/
- The board-cards section should warn about response-size limits.
  What the doc says: board card fetches “return all open cards.”
  What is true: Trello specifically warns about response-size errors when loading too many cards with actions together. SupportAgent should avoid over-fetching giant board snapshots with nested actions.
  Citation: https://developer.atlassian.com/cloud/trello/guides/rest-api/rate-limits/
- The batch section is only partially trustworthy.
  What the doc says: max 10 URLs and counts as N requests.
  What is true: `GET /1/batch` exists and is limited to 10 URLs, and Forge/OAuth2 restrictions are real. The official rate-limit guide reviewed does not explicitly confirm the “counts as N requests” statement, so that claim should be either cited from a current official source or downgraded to “unverified.”
  Citations:
  https://developer.atlassian.com/cloud/trello/rest/api-group-batch/
  https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
- Concurrency guidance is missing.
  Gap: the doc should recommend low per-token concurrency and shared per-key budget tracking. A sensible implementation inference is a small concurrent request pool per token with dynamic throttling from `x-rate-limit-*` headers.
  Note: that concurrency number is an implementation inference, not a Trello-documented constant.

## SDK & implementation path
- The “no official Atlassian SDK” recommendation is mostly correct for backend work.
- The source doc is incomplete because Trello does have official browser-side helpers.
  What the doc says: no official SDK, third-party wrappers only.
  What is true: Trello documents `client.js` and the REST API client for Power-Ups, but those are browser/Power-Up-oriented rather than a backend Node SDK that SupportAgent should use.
  Citations:
  https://developer.atlassian.com/cloud/trello/guides/client-js/client-js-reference/
  https://developer.atlassian.com/cloud/trello/power-ups/rest-api-client/
- The raw-fetch recommendation for SupportAgent is coherent.
  Reason: backend connector needs explicit control over query-param auth, header injection, signature verification, retries, and Zod validation, and the official helpers do not solve that backend use case.
- The package existence section is partly wrong.
  What the doc says: `trello` and `trello-api-client` are third-party npm options.
  What is true: `trello` exists on npm; `trello-api-client` was not found on npm at review time. That second package should be removed or replaced with a package that is verifiably current.
- The CLI parity statement is correct enough: there is no mainstream Trello CLI equivalent to `gh` that should shape the connector design.
- The MVP endpoint list is close but should be corrected before implementation.
  Remove or fix:
  `POST /1/cards/{cardId}/labels` for existing-label add
  `DELETE /1/cards/{cardId}/labels/{labelId}`
  `POST /1/cards/{cardId}/members`
  `DELETE /1/cards/{cardId}/members/{memberId}`
  Add:
  `PUT /1/cards/{id}/actions/{idAction}/comments`
  `DELETE /1/cards/{id}/actions/{idAction}/comments`
  `POST /1/cards/{id}/idLabels`
  `DELETE /1/cards/{id}/idLabels/{idLabel}`
  `POST /1/cards/{id}/idMembers`
  `DELETE /1/cards/{id}/idMembers/{idMember}`
- The MVP config list does not match the real implementation path.
  Missing:
  `appSecret` for webhook verification
  stable `boardIds`
  stable `listIdToStatus`
  stable `labelIdToPriority`
  optional `customFieldIdToSeverity`
  loop-prevention `clientIdentifier`
  optional `accountScopeEnabled`
  optional polling cursor storage model
  Why this matters: the current config proposal keys important mappings by mutable names and omits the webhook secret entirely.
- The Phase 2 list is partly realistic and partly noisy.
  Realistic:
  custom fields
  attachments
  search
  enterprise/workspace member reads where truly needed
  Noisy or weakly justified for SupportAgent:
  Butler automation
  board templates
  board backgrounds
  cover visuals
  These do not look like connector-critical roadmap items for triage/build/merge workflows.
- The open-questions section misses some operational blockers that matter more than the listed product curiosities.
  Missing blockers:
  Can tenants provision and rotate app secret, API key, and user token securely?
  Are tenants willing to use a user-owned long-lived token, or is the product blocked until Trello ships usable OAuth2 for these endpoints?
  Do we require comment-edit support in outbound delivery, now that the endpoint exists?
  Will we key mappings by list/label IDs rather than names?
  Are board-scoped webhooks enough, or do enterprise installs need organization webhooks too?
  Do we need custom-field-driven triggers, including `updateCustomFieldItem`?
- The current doc’s Q6 is now stale.
  What the doc says: Trello has no edit-comment endpoint.
  What is true: it does. That question should be replaced with a different operational blocker.
  Citation: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/

## Priority fixes
1. Remove OAuth2 as a near-term connector auth path and rewrite auth around what Trello officially supports for these endpoints today: API key + user token + app secret. Cite the REST resources that still say OAuth2/Forge cannot access them.
2. Fix the write endpoint matrix before any implementation starts: comment edit/delete, existing-label add/remove, and member add/remove are all wrong in the source.
3. Rewrite the webhook section to use Trello’s real delivery semantics: 3 retries with 30/60/120-second backoff, disablement only after 30 days and more than 1000 failures, and loop prevention via `X-Trello-Client-Identifier`.
4. Replace the event list with the official action names SupportAgent actually needs, including `updateComment`, `deleteComment`, attachment events, and list events; remove unsupported names like `moveCardToList` unless separately verified.
5. Fix rate-limit guidance: remove the unsupported `200 req/s` number, add the documented `/1/members` route cap, add `x-rate-limit-*` headers, and stop saying Trello exposes no rate-limit headers.
6. Replace page-first polling guidance with `before`/`since` cursoring for long action streams, and explicitly recommend action-ID or timestamp cursors for reconciliation.
7. Correct custom-field coverage: supported types are `checkbox`, `date`, `list`, `number`, `text`; update examples to use `idValue` for list fields and string payloads for values.
8. Update MVP config to use stable IDs and include the missing webhook secret and client identifier fields.
9. Remove or verify unsupported hard-coded limits such as “50 labels per board,” “10MB attachment max,” “4 attachments per card,” and any other number not tied to a current official source.
10. Trim the roadmap and deprecations sections so they focus on connector-critical facts rather than unrelated Trello platform features or stale uncertainties.
