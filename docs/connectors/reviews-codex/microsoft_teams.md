# Microsoft Teams combined review

## Verdict
The source document is directionally useful but not reliable enough to implement against as written. Its biggest problems are auth-model conflation, webhook verification inaccuracies, nonexistent polling/delta claims, and incorrect SDK/package guidance. Confidence is medium-high because the major contradictions are directly documented in current Microsoft Graph and Teams docs, but a few operational edges still depend on tenant policy, app installation scope, and sovereign-cloud requirements.

## Authentication
- The doc is right that Microsoft Teams integrations sit on top of Microsoft Entra ID plus Microsoft Graph, and that there is no self-hosted Teams Server API equivalent. It should explicitly add sovereign cloud variants instead of treating the platform as a single cloud shape. Official national cloud coverage is listed on the Graph endpoint pages, for example the channel message send doc and message list docs:
  https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/api/channel-list-messages?view=graph-rest-1.0

- The doc overstates client-credentials as the recommended universal server-side model. That is only correct for many read and subscription flows. Normal message sending in Teams channels and chats is still delegated-only in Graph; application permission is migration-only via `Teamwork.Migrate.All`.
  Channel send permissions:
  https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0
  Chat send permissions:
  https://learn.microsoft.com/en-us/graph/api/chat-post-messages?view=graph-rest-1.0

- The source doc’s minimum-permissions table is not minimum-sufficient and in places is wrong:
  `POST /teams/{team-id}/channels/{channel-id}/messages` least-privileged delegated permission is `ChannelMessage.Send`, not app-only `ChannelMessage.Send` and not a normal app-only flow.
  `POST /chats/{chat-id}/messages` least-privileged delegated permission is `ChatMessage.Send`, not `Chat.ReadWrite`.
  `GET /chats/{chat-id}/messages` least-privileged app permission is `ChatMessage.Read.Chat`; higher is `Chat.Read.All`.
  `GET /teams/{team-id}/channels/{channel-id}/messages` least-privileged app permission can be `ChannelMessage.Read.Group` via resource-specific consent, not only tenant-wide `ChannelMessage.Read.All`.
  Citations:
  https://learn.microsoft.com/en-us/graph/api/chat-post-messages?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/api/chat-list-messages?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/api/channel-list-messages?view=graph-rest-1.0

- The doc says delegated permissions are “not applicable for server-side connector.” That is too strong. If SupportAgent wants normal Graph-based outbound posting, delegated user context is required. A pure server-to-server Graph connector cannot do normal message posting without falling back to bot flows or migration-only APIs.
  https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/api/chat-post-messages?view=graph-rest-1.0

- The doc is incomplete on app installation as an auth/operational prerequisite. For bot-based proactive messaging, the app that contains the bot must already be installed in the user, chat, or team scope before sending proactive messages. That is not just a deployment detail; it is part of the capability model.
  https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages
  https://learn.microsoft.com/en-us/graph/api/resources/teamsappinstallation

- The Bot Framework token scope in the doc is wrong. It says to request a bot token with `scope=https://graph.microsoft.com/.default`. The Bot Connector auth doc requires `scope=https://api.botframework.com/.default`.
  https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0

- The Bot Framework request-auth description is wrong in a security-sensitive way. The doc claims an HMAC-style shared-secret validation of the raw body and refers to `MS-ChannelToken`. Current Bot Framework guidance is JWT bearer validation using the `Authorization` header, Bot Framework OpenID metadata, and signing keys from `https://login.botframework.com/v1/.well-known/openidconfiguration`.
  https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0

- The doc correctly notes that client-credentials access tokens have no refresh token and must be reacquired. That part is fine for Graph app-only and bot app credentials.

- The source doc is silent on resource-specific consent as a way to reduce blast radius. That matters because some app permissions have scoped RSC alternatives:
  `ChannelMessage.Read.Group`
  `ChannelSettings.Read.Group`
  `ChatMessage.Read.Chat` is also surfaced for some message subscriptions.
  These are worth calling out for least-privilege design.
  https://learn.microsoft.com/en-us/graph/api/channel-list-messages?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/api/channel-list?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/teams-changenotifications-chatmessage

- The source doc introduces `availableToOtherTenants` as part of the multitenant model but does not cite current Entra manifest requirements. At minimum, that claim needs an Entra manifest citation or should be removed from the connector doc and replaced with a simpler “supported account types / tenant consent” explanation.

- The doc omits that listing all teams is not a direct `GET /teams` operation. The documented tenant-wide discovery path is list Microsoft 365 groups with `resourceProvisioningOptions/Any(x:x eq 'Team')`, then `GET /teams/{group-id}` for team details.
  https://learn.microsoft.com/en-us/graph/teams-list-all-teams

- There is no meaningful “service account” auth model unique to Teams here. The real choices are:
  Graph app-only for reads, subscriptions, and some install flows.
  Graph delegated for normal send/edit/delete where supported.
  Bot app credentials plus app installation and conversation references for bot conversations and proactive messages.
  The source doc should present those as distinct lanes instead of one combined auth story.

## Endpoints
- The source doc correctly identifies core read paths for channels, chats, channel messages, chat messages, replies, and subscriptions. It does not keep method/path/body/permission details accurate enough for implementation.

- `GET /teams/{team-id}/channels` is correctly shaped, but the doc understates team discovery. SupportAgent needs both:
  `GET /groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')`
  `GET /teams/{group-id}`
  before `GET /teams/{team-id}/channels`.
  Citation:
  https://learn.microsoft.com/en-us/graph/teams-list-all-teams
  https://learn.microsoft.com/en-us/graph/api/channel-list?view=graph-rest-1.0

- `GET /chats` exists, contrary to the source doc’s framing that you merely “retrieve existing chats via GET /chats” without clarifying path variants. The official doc supports delegated `/chats`, `/me/chats`, `/users/{id}/chats`, and app-only user-targeted variants.
  https://learn.microsoft.com/en-us/graph/api/chat-list?view=graph-rest-1.0

- `GET /teams/{team-id}/channels/{channel-id}/messages` is correctly identified for root posts only. The source doc should explicitly say replies are not included unless expanded or retrieved via `/replies`, and channel replies are first-class comment/thread objects for SupportAgent purposes.
  https://learn.microsoft.com/en-us/graph/api/channel-list-messages?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/api/chatmessage-list-replies?view=graph-rest-1.0

- `GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}` and `GET /chats/{chat-id}/messages/{message-id}` are missing from the endpoint inventory even though “get one” is in scope.
  https://learn.microsoft.com/en-us/graph/api/chatmessage-get?view=graph-rest-1.0

- `POST /teams/{team-id}/channels/{channel-id}/messages` and `POST /chats/{chat-id}/messages` are real, but the source doc’s examples should be corrected:
  least-privileged delegated permissions are `ChannelMessage.Send` and `ChatMessage.Send`;
  app-only normal sends are not supported;
  example request bodies should stay minimal and use the documented `chatMessage` body shape.
  Citations:
  https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/api/chat-post-messages?view=graph-rest-1.0

- `POST /teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies` is the correct thread reply path. That is a key “post comment” capability and should be promoted from a detail to a first-class capability row.
  https://learn.microsoft.com/en-us/graph/api/chatmessage-post-replies?view=graph-rest-1.0

- The doc says edit is “not directly supported” and then shows `PATCH` for body updates. That is materially misleading. Update is supported, but with asymmetric rules:
  delegated: most `chatMessage` properties can be updated;
  application: only `policyViolation` can be updated.
  For SupportAgent, body editing is a delegated-only capability.
  https://learn.microsoft.com/en-us/graph/api/chatmessage-update?view=graph-rest-1.0

- The doc says delete is not supported in Graph v1.0. That is false. Soft delete is supported through Graph:
  channel root: `POST /teams/{teamId}/channels/{channelId}/messages/{messageId}/softDelete`
  channel reply: `POST /teams/{teamId}/channels/{channelId}/messages/{messageId}/replies/{replyId}/softDelete`
  chat message: `POST /users/{userId}/chats/{chatId}/messages/{messageId}/softDelete`
  It is delegated-only, not app-only.
  https://learn.microsoft.com/en-us/graph/api/chatmessage-softdelete?view=graph-rest-1.0

- The doc is silent on undelete, which exists and may matter for moderation-aware reconciliation. That omission is acceptable for MVP but should be noted if the connector models deletion state.
  Resource methods are documented from the `chatMessage` resource page:
  https://learn.microsoft.com/en-us/graph/api/resources/chatMessage

- The doc’s mention guidance is incomplete. A mention is not just `<at>Name</at>` in HTML; Teams messages also carry a `mentions` collection. The connector doc should not imply that matching raw display-name text alone is sufficient. SupportAgent should treat the returned `mentions` collection as authoritative where available.
  Response shapes on message docs show `mentions`.
  https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/api/chatmessage-get?view=graph-rest-1.0

- The attachment guidance is too loose for implementation. The doc says “upload to SharePoint/OneDrive and reference it” but does not provide an official Teams-message file-attachment flow endpoint sequence or constraints. That means the connector review should treat message file attachment as unresolved, not implementation-ready. SupportAgent should not mark “attach file” as fully covered by the source doc.
  The only official thing clearly evidenced in the message resource is that `attachments` exist as references on `chatMessage`.
  https://learn.microsoft.com/en-us/graph/api/resources/chatMessage

- The doc correctly says Teams has no issue-tracker-style close/status/severity/priority model. That means the required SupportAgent capabilities map as follows:
  list items: yes, chats/channels/messages.
  get one: yes, but the source doc omitted official get-one endpoints.
  create: yes, messages/replies.
  edit/patch: partially, delegated body edits only; app-only policy-violation only.
  delete/close: soft delete yes; close/status transition no native concept.
  list comments: channel replies yes; chat threading is flatter and does not map the same way.
  post/edit/delete comment: yes for channel replies, with the same delegated-vs-app constraints.
  add/remove label or tag: no message labels; team tags exist but are a different feature surface.
  set priority/severity/status/transition: no native message-level model.
  assign user: no assign primitive.
  mention user: yes.
  attach file: partially documented, not ready as written.

- The doc says “Adaptive Cards” can be sent by setting `contentType` to `adaptiveCard` with card JSON in `content`. That needs a direct Microsoft citation or a safer wording, because the reviewed source does not anchor the exact Graph request shape for cards. As written, it is too implementation-specific without proof.

- The source doc says you cannot create a new chat via Graph. That needs correction. Graph does support chat creation in broader Teams APIs, even if it is not part of the specific message-send flow. If the connector doc wants to exclude chat creation from MVP, it should say “out of scope for SupportAgent MVP” rather than “cannot create.”

## Inbound events
- The source doc is right that Graph change notifications are the main webhook mechanism for message change events, and that Bot Framework activities are a separate inbound surface for bot conversations.

- The webhook validation description is wrong. Graph validates the notification endpoint using a validation token exchange and expects the token echoed back in plain text, not a “VALIDATION chip” in JSON.
  https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks

- The doc understates Graph notification security. `clientState` is only the baseline shared-secret check for basic notifications. For rich notifications with resource data, Microsoft also sends `validationTokens` JWTs that must be validated, and resource data is encrypted and must be decrypted. Saying “Graph does not use traditional HMAC-signed webhooks” is fine, but replacing that with only `clientState` is not sufficient for current spec.
  https://learn.microsoft.com/en-us/graph/change-notifications-with-resource-data

- The source doc is missing lifecycle notifications as a required implementation detail for Teams message subscriptions when expiration exceeds one hour. Current Teams change-notification docs explicitly require `lifecycleNotificationUrl` in that case.
  https://learn.microsoft.com/en-us/graph/teams-changenotifications-chatmessage
  https://learn.microsoft.com/en-us/graph/teams-changenotifications-chat

- The source doc’s event coverage is incomplete. For messages, the supported change types include `created`, `updated`, and for some resources `deleted`. The source review should not frame inbound handling as create-only.
  https://learn.microsoft.com/en-us/graph/teams-changenotifications-chatmessage

- The source doc’s sample notification payload overpromises what arrives in `resourceData`. Without `includeResourceData`, Graph notifications are sparse and you must look up the message. With `includeResourceData`, you must also support encryption/decryption and validation-token handling. The review should call out that the document blurs those two modes.
  https://learn.microsoft.com/en-us/graph/change-notifications-with-resource-data

- The source doc says subscriptions support `teams/{team-id}/channels/{channel-id}` and `teams/{team-id}` generically for events, but SupportAgent’s actual need is message/comment intake. The review should prioritize:
  `/teams/getAllMessages`
  `/teams/{team-id}/channels/{channel-id}/messages`
  `/chats/getAllMessages`
  `/chats/{chat-id}/messages`
  and optionally `/chats` or membership resources only if conversation lifecycle matters.
  https://learn.microsoft.com/en-us/graph/teams-changenotifications-chatmessage
  https://learn.microsoft.com/en-us/graph/teams-changenotifications-chat

- The source doc’s subscription-expiration number is stale or at least undocumented in the cited Teams-message page. Current Microsoft Graph overview tables list `chatMessage` maximum expiration at 4,320 minutes, and the Teams message-notification page adds the one-hour lifecycle-notification requirement. The doc should stop asserting “4230 minutes” without a current citation.
  https://learn.microsoft.com/en-us/graph/change-notifications-overview
  https://learn.microsoft.com/en-us/graph/teams-changenotifications-chatmessage

- The source doc’s Bot Framework verification section is wrong enough that loop prevention and inbound trust would be broken. Incoming bot activities must be verified as JWT bearer tokens from Bot Framework, not HMAC signatures.
  https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0

- The polling fallback section contains the most serious implementation error in the entire document. It claims a channel-level delta query:
  `GET /teams/{team-id}/channels/{channel-id}/messages?$deltaToken=...`
  I did not find current Microsoft documentation for that endpoint shape. Current documented delta support relevant here is user-level chats:
  `GET /users/{id}/chats/getAllMessages/delta`
  For channels, Microsoft documents:
  `GET /teams/{team-id}/channels/{channel-id}/messages`
  and
  `GET /teams/{team-id}/channels/getAllMessages`
  with `lastModifiedDateTime` filtering.
  Citations:
  https://learn.microsoft.com/en-us/graph/api/chatmessage-delta?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/api/channel-list-messages?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/api/channel-getallmessages?view=graph-rest-1.0

- The doc also says Graph lacks `createdDateTime gt` filtering and that client-side filtering is required. That is only partly true:
  chat list messages supports `$orderby` plus `$filter`; `lastModifiedDateTime` supports `gt` and `lt`, and `createdDateTime` supports `lt`.
  team channel get-all-messages supports `lastModifiedDateTime` date-range filter.
  So the doc should split chat and channel polling strategies instead of presenting one false universal rule.
  https://learn.microsoft.com/en-us/graph/api/chat-list-messages?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/api/channel-getallmessages?view=graph-rest-1.0

- Mention detection is more capable than the doc suggests. For channel message subscriptions, Graph supports a subscription filter on `mentions/any(...)` for a specific user ID. That means webhook-side mention filtering can be first-class in some cases instead of always requiring post-fetch inspection.
  https://learn.microsoft.com/en-us/graph/teams-changenotifications-chatmessage

- The source doc says channel messages to a bot arrive in real time via Bot Framework when a user sends a DM or @mentions the bot in a channel. That is broadly right, but it omits the crucial Teams rule that in channels the bot receives messages only when explicitly @mentioned, even in replies. This matters for bot-command detection and for deciding whether Graph subscriptions are required to capture ambient channel traffic.
  https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/channel-and-group-conversations

- The loop-prevention guidance should be strengthened. For Graph message reads, self-authored filtering should check `from.application` and application identity type where present, not only `from.application.id == botId`. For Bot Framework, you also need conversation reference scoping and to ignore activities authored by the bot itself. The source doc recognizes part of this but should not treat one field check as sufficient.

## Hosting variants
- “Cloud-only, no on-prem equivalent” is correct at the Teams platform level. There is no customer-hosted Teams API. That part of the source doc is solid.

- The document misses the most important hosting/version variants that actually matter to SupportAgent:
  Global commercial cloud.
  US Government L4.
  US Government L5 / DoD.
  China operated by 21Vianet.
  Graph availability varies by endpoint, and proactive bot endpoints also change by government cloud.
  Citations:
  https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/api/chat-list-messages?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages

- The doc should explicitly add base-URL patterns per variant. Today it mostly assumes `https://graph.microsoft.com/v1.0` and standard Teams service URLs. For government cloud proactive messaging, Microsoft documents alternate `smba` endpoints.
  https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages

- There is no meaningful self-hosted Teams “enterprise tier” API surface to compare against, but there are tenant-policy and national-cloud differences. The review should recommend a feature matrix by:
  Graph read APIs.
  Graph delegated send APIs.
  Bot proactive messaging.
  Graph subscriptions with resource data.
  Teams app install/proactive install permissions.

- The source doc does not discuss private/shared channel behavior enough. The channel list doc explicitly says members cannot see private or shared channels they are not members of when using delegated context. That distinction matters when comparing delegated vs app-only connector behavior and when deciding whether SupportAgent can rely on one auth mode for discovery.
  https://learn.microsoft.com/en-us/graph/api/channel-list?view=graph-rest-1.0

- The doc says “app-only normal messaging is NOT supported on v1.0,” which is true today for standard sends, but it should also flag this as a major product constraint, not just a gotcha. It is the main reason a “Graph-only outbound” MVP is unrealistic.
  https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/api/chat-post-messages?view=graph-rest-1.0

- Deprecation handling is incomplete. The source doc notes TeamsFx deprecation, but it misses other version-drift implications:
  the Teams platform is pushing developers toward Teams SDK / Microsoft 365 Agents SDK for new app work;
  Graph Toolkit is deprecated for web experiences and should not be proposed as a new implementation path.
  Citations:
  https://learn.microsoft.com/en-us/microsoftteams/platform/toolkit/teamsfx-sdk
  https://learn.microsoft.com/en-us/graph/toolkit/upgrade

- The source doc does not include sunset dates where it names deprecated tooling. TeamsFx’s cited deprecation timing should be backed by the official page, not left as an uncited gotcha.
  https://learn.microsoft.com/en-us/microsoftteams/platform/toolkit/teamsfx-sdk

## Rate limits & pagination
- The source doc correctly says Graph throttling surfaces as HTTP 429 with `Retry-After`. That is supported by Microsoft’s throttling guidance.
  https://learn.microsoft.com/en-us/graph/throttling
  https://learn.microsoft.com/en-gb/graph/throttling-limits

- The document’s numeric pagination claims are wrong. It says default is 100 and `$top` is up to 999 on most endpoints. Current Teams message endpoints are much smaller:
  channel messages: default 20, max 50.
  chat messages: max 50.
  channel replies: max 50.
  This is a material implementation bug because it affects reconciliation loop sizing and queue fan-out.
  Citations:
  https://learn.microsoft.com/en-us/graph/api/channel-list-messages?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/api/chat-list-messages?view=graph-rest-1.0
  https://learn.microsoft.com/en-us/graph/api/chatmessage-list-replies?view=graph-rest-1.0

- The doc says `@odata.nextLink` is in the response header. For Graph paging, the general paging doc describes `@odata.nextLink` in the response body. The source doc should stop describing it as a response header requirement.
  https://learn.microsoft.com/en-us/graph/paging

- The source doc should explicitly separate cursor styles:
  standard paging uses `@odata.nextLink`;
  delta uses opaque `skipToken` and `deltaToken` embedded in `@odata.nextLink` / `@odata.deltaLink`;
  callers should reuse the full URL rather than reconstruct tokens.
  https://learn.microsoft.com/en-us/graph/paging
  https://learn.microsoft.com/en-us/graph/api/chatmessage-delta?view=graph-rest-1.0

- The numeric Teams service throttling section should cite and mirror current Microsoft wording:
  other GET Teams API calls: 30 rps per app per tenant, 1500 rps per app across tenants, 1 rps per app per tenant per channel/chat resource.
  other Teams API calls: 30 rps per app per tenant, 300 rps per app across tenants, 1 rps per app per tenant per channel/chat resource.
  maximum four requests per second per app on a given team.
  maximum one request per second per app per tenant on a given channel or chat.
  maximum one request per second per user when posting a message in a given chat or channel.
  https://learn.microsoft.com/en-gb/graph/throttling-limits

- The source doc is correct that JSON batching exists, but it should cite the current batch limit of 20 subrequests and note that batched requests are still throttled individually.
  https://learn.microsoft.com/en-us/graph/json-batching

- The source doc’s “Graph SDK handles Retry-After automatically” statement is too strong without naming SDK/runtime specifics. The review should downgrade that to “implement Retry-After-aware retries in the HTTP layer and verify SDK middleware behavior in the chosen language.”

- Error-shape coverage is missing. Graph standard errors arrive as:
  `{"error":{"code":"...","message":"...","innerError":{...},"details":[]}}`
  The connector doc should capture that for retry classification, auth failures, and audit logging.
  https://learn.microsoft.com/en-us/graph/errors

- The source doc’s replay-protection note for Graph notifications is underdeveloped. The review should recommend:
  validate `clientState`;
  validate `validationTokens` when present;
  store subscription ID and notification IDs or `(subscriptionId, resource, changeType, event time)` dedupe keys;
  respond immediately to avoid retries.
  The response guidance for rich notifications is `202 Accepted`.
  https://learn.microsoft.com/en-us/graph/change-notifications-with-resource-data

## SDK & implementation path
- The npm package names in the source doc are wrong. It lists `@microsoft/graph-sdk`, `@microsoft/graph`, and `@microsoft/msgraph`. The official Microsoft Graph JavaScript client package is `@microsoft/microsoft-graph-client`, with `@microsoft/microsoft-graph-types` for TypeScript types. Auth in Node typically uses `@azure/identity` or MSAL, not the Graph client package alone.
  https://learn.microsoft.com/en-us/graph/tutorials/javascript
  https://learn.microsoft.com/en-us/graph/sdks/sdk-installation

- The doc’s claim that the Graph SDK “handles token acquisition and caching automatically” is misleading. Microsoft’s JS guidance installs `@azure/identity` alongside the Graph client. Token acquisition and caching come from the chosen credential provider stack, not from the Graph client in isolation.
  https://learn.microsoft.com/en-us/graph/tutorials/javascript
  https://learn.microsoft.com/en-us/graph/tutorials/javascript-authentication

- The doc’s Graph SDK recommendation is still directionally reasonable, but the rationale should be rewritten:
  use the official Graph client for request building, paging helpers, and typed models;
  pair it with `@azure/identity` or MSAL for auth;
  do not promise automatic retries unless verified in the chosen middleware stack.

- The Bot Framework SDK recommendation is sensible for bot webhook handling and proactive messaging. The source doc should add that request authentication is JWT-based and that app installation plus conversation references are required before proactive sends.
  https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0
  https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages

- The doc is right to avoid TeamsFx for new work, but its replacement guidance should be more precise:
  Graph REST + official Graph client for connector read/write flows.
  Bot Framework SDK for conversational bot transport.
  Avoid deprecated Graph Toolkit for new web UI dependencies.
  Citations:
  https://learn.microsoft.com/en-us/microsoftteams/platform/toolkit/teamsfx-sdk
  https://learn.microsoft.com/en-us/graph/toolkit/upgrade

- The CLI guidance is reasonable: there is no `gh`-equivalent for Teams. Microsoft Graph PowerShell and Microsoft 365 CLI are the nearest operator tools. That said, shelling out to either should be Phase 3 or admin-only, not part of the connector core.

- The MVP / Phase 2 / Phase 3 ordering is not coherent today because MVP still assumes Graph outbound writes can be solved with app-only auth. A realistic phased plan is:
  MVP: inbound Graph subscriptions or polling for reads; optional outbound only through delegated send or bot proactive messages where installation prerequisites are met.
  Phase 2: app installation automation, conversation-reference persistence, mention-filtered subscriptions, sovereign-cloud support.
  Phase 3: richer cards, message reactions, tag administration, search-driven backfills, admin tooling.

- The MVP config field list is not aligned with the actual auth split. `botId` and `botSecret` are not independent from the app registration in the way the doc suggests, and the connector needs explicit mode selection such as:
  `graph_auth_mode=app_only|delegated`
  `bot_enabled=true|false`
  `tenant_cloud=global|gcc|gcch|dod|21vianet`
  `requires_app_install=true|false`
  `subscription_mode=resource_data|lookup_after_notification`
  The current field list mixes Graph and bot values without capturing the operational decisions.

- Several “open questions” in the source doc should not be open:
  “Can we use Bot Framework proactive message API with only application permissions?” Answer: bot auth uses app credentials, but proactive sending still depends on installation/conversation prerequisites.
  “Bot user in tenant?” Answer: the app/bot must be installed into the relevant scope; this is documented.
  “Webhook reliability?” Answer: Graph recommends immediate acknowledgement and supports lifecycle notifications, but connectors should still reconcile because delivery is not a hard exactly-once guarantee.
  Citations:
  https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages
  https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks

## Priority fixes
1. Rewrite the auth section so it distinguishes three lanes clearly: Graph app-only reads/subscriptions, Graph delegated normal sends/edits/deletes, and Bot Framework bot traffic with JWT validation and installation prerequisites.
2. Replace the webhook verification section. Remove the HMAC/shared-secret Bot Framework claim, document Graph validation-token plus `clientState` behavior, and add validation-token JWT checks for rich notifications.
3. Delete the nonexistent channel-level delta polling recipe and replace it with documented polling options: channel list/get-all-messages, chat list-messages filters, and user-level `getAllMessages/delta` where applicable.
4. Correct every send/edit/delete endpoint row with the real least-privileged permissions and capability limits, especially that normal Graph outbound posting is delegated-only.
5. Fix pagination numbers and cursor semantics. Message endpoints are max 50, not 999, and `@odata.nextLink` should be treated as a body field/opaque URL.
6. Replace the SDK/package section with real npm packages: `@microsoft/microsoft-graph-client`, `@microsoft/microsoft-graph-types`, `@azure/identity`, and `botbuilder`.
7. Add hosting-variant guidance for sovereign clouds and government bot endpoints so the connector does not silently assume commercial cloud only.
8. Mark file attachments, adaptive-card payload shape, and message-level tagging/assignment as partial or unresolved instead of implementation-ready capabilities.
