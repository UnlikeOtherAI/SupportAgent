# Slack combined review

## Verdict
The source doc is directionally useful, but it is not yet reliable enough to drive implementation without rework. The biggest gaps are around auth taxonomy, hosting variants, attachment upload, thread/comment retrieval limits, and the distinction between native Slack capabilities versus issue-tracker semantics that Slack simply does not have. Confidence is medium-high because the major contradictions here are directly backed by current Slack official docs, especially the 2024-2025 changes around file upload, docs-site migration, token rotation, GovSlack, and `conversations.history` / `conversations.replies` limits.

## Authentication
- Source doc lines 38-47 reduce Slack auth to bot, user, enterprise, and app-level tokens.
- Slack’s current auth docs list more token classes: bot, workflow, user, configuration, app-level, and service tokens, with legacy token types called out separately.
- SupportAgent does not need every token type for MVP, but the review doc should still mark which are relevant, which are irrelevant, and which are legacy or special-purpose.
- Citation: https://docs.slack.dev/authentication/tokens/

- Source doc line 47 says app-level tokens grant workspace-level access across all installed workspaces.
- Slack’s token docs describe app-level tokens as app-scoped tokens used only with specific APIs, across organizations/installations, not as general Web API workspace tokens.
- For SupportAgent this matters because `xapp-` should only be used for Socket Mode and a few app-level APIs, not for `chat.*`, `conversations.*`, or `users.*`.
- Citation: https://docs.slack.dev/authentication/tokens/
- Citation: https://docs.slack.dev/reference/methods/apps.connections.open
- Citation: https://docs.slack.dev/reference/scopes/connections.write

- Source doc lines 42-45 imply `xoxe-` is an “enterprise token” class.
- Current Slack docs are more precise: with token rotation enabled, exchanged bot and user access tokens gain the `xoxe.` prefix, and refresh tokens are `xoxe-...`; this is not the same as saying “Enterprise Grid token.”
- The doc should stop describing `xoxe-` as an org-wide Enterprise token type and instead explain that rotatable bot/user access tokens become `xoxe.xoxb-...` or `xoxe.xoxp-...`.
- Citation: https://docs.slack.dev/authentication/using-token-rotation/
- Citation: https://docs.slack.dev/reference/methods/oauth.v2.access

- Source doc lines 49-54 recommend “bot token only” and say no OAuth redirect flow is required for single-workspace tenants.
- That is partially true operationally if a human manually installs the app in one workspace, but the doc should still say installation is OAuth-backed at the platform level and multi-tenant distribution requires OAuth V2.
- The implementation consequence is that SupportAgent can support a manual single-workspace install path first, but the source doc should not present that as a different auth protocol.
- Citation: https://docs.slack.dev/authentication/installing-with-oauth
- Citation: https://docs.slack.dev/reference/methods/oauth.v2.access

- Source doc lines 60-65 show the OAuth V2 response as `bot: { bot_user_id, bot_access_token }`.
- That response shape is outdated for Slack apps using OAuth V2.
- Current `oauth.v2.access` returns top-level `access_token`, `token_type`, `scope`, `bot_user_id`, and optional `authed_user`; the nested `bot.bot_access_token` shape belongs to older `oauth.access` examples.
- This is a concrete accuracy bug and should be fixed before anyone copies the sample.
- Citation: https://docs.slack.dev/reference/methods/oauth.v2.access
- Citation: https://docs.slack.dev/reference/methods/oauth.access

- Source doc lines 68-73 say token rotation refresh happens via `oauth.v2.access`.
- That is correct for refreshing a rotated token.
- The doc is missing the earlier migration step: long-lived bot/user tokens are first exchanged via `oauth.v2.exchange`, then refreshed later via `oauth.v2.access grant_type=refresh_token`.
- Without that distinction, the setup path is incomplete.
- Citation: https://docs.slack.dev/authentication/using-token-rotation/
- Citation: https://docs.slack.dev/reference/methods/oauth.v2.exchange

- Source doc lines 71-73 say refresh tokens are single-use and access tokens expire every 12 hours.
- That is accurate.
- The doc should add two operational details from Slack’s current guidance: token rotation cannot be turned off once enabled, and Slack enforces a 2-active-token limit if you refresh too aggressively.
- Citation: https://docs.slack.dev/authentication/using-token-rotation/

- Source doc lines 75-90 list scopes but do not identify minimum-sufficient combinations by feature slice.
- For MVP, minimum-sufficient scope guidance should be separated into:
- `chat:write` for posting.
- `app_mentions:read` for channel mentions.
- `im:history` if DM intake is in scope.
- `channels:history` and `groups:history` only if channel/private-channel monitoring is truly required.
- `users:read` and `users:read.email` only if identity-to-email mapping is a product need.
- `files:write` only if outbound attachment upload is in scope.
- `channels:read`, `groups:read`, `im:read`, `mpim:read` only if SupportAgent must discover conversations instead of being configured with IDs.
- Citations: https://docs.slack.dev/reference/methods/chat.postMessage
- Citation: https://docs.slack.dev/reference/events/app_mention
- Citation: https://docs.slack.dev/reference/events/message.im
- Citation: https://docs.slack.dev/reference/scopes/users.read.email
- Citation: https://docs.slack.dev/reference/scopes/files.write
- Citation: https://docs.slack.dev/reference/methods/conversations.list

- Source doc lines 85-86 say `users:read.email` is required for apps after Jan 4, 2017.
- The old date note is historically true, but the better current statement is that `users:read.email` is now required to access `email` in `users.info` and `users.list`, and it must be requested together with `users:read`.
- That is the statement engineers need today.
- Citation: https://docs.slack.dev/reference/scopes/users.read.email
- Citation: https://docs.slack.dev/reference/methods/users.info

- Source doc is silent on configuration tokens.
- Current Slack docs say configuration tokens are per-workspace and only for App Manifest APIs.
- SupportAgent likely does not need them for runtime messaging, but the research doc should explicitly mark them “out of scope for connector runtime; only relevant if we automate app creation/manifests.”
- Citation: https://docs.slack.dev/authentication/tokens/

- Source doc is silent on service tokens.
- Current Slack docs include service tokens, but only for apps created with the Deno Slack SDK, and note they are long-lived and CLI-oriented.
- SupportAgent should explicitly mark service tokens as not part of the chosen implementation path.
- Citation: https://docs.slack.dev/authentication/tokens/

- Source doc does not call out client secret rotation behavior.
- Slack’s request-verification doc notes the previous client secret remains valid for 24 hours after regeneration unless revoked manually.
- That matters for rollout and secret rotation procedures in hosted deployments.
- Citation: https://docs.slack.dev/authentication/verifying-requests-from-slack

- Source doc correctly describes HMAC signing at lines 120-147.
- It should add one implementation-critical nuance from Slack’s spec: compute the signature from the raw UTF-8 request body before any JSON or form parsing.
- This matters for both Events API JSON payloads and slash-command `application/x-www-form-urlencoded` payloads.
- Citation: https://docs.slack.dev/authentication/verifying-requests-from-slack

- Source doc does not distinguish cloud Slack from GovSlack auth endpoints.
- For GovSlack, OAuth authorize, OAuth token exchange, webhook-style callbacks, and dynamically generated URLs move to `slack-gov.com`, and app credentials are created at `api.slack-gov.com`.
- This is a major hosting/auth omission.
- Citation: https://docs.slack.dev/govslack/

- Source doc does not explicitly mention that app install shape differs for organization-ready apps.
- Slack’s Enterprise docs call out `is_enterprise_install` and org-wide installation behavior.
- SupportAgent should track whether an install is workspace-scoped or org-scoped because repo-to-workspace/channel routing depends on it.
- Citation: https://docs.slack.dev/enterprise/developing-for-enterprise-orgs/
- Citation: https://docs.slack.dev/reference/methods/oauth.v2.access

## Endpoints
- The source doc is strongest on basic messaging endpoints and weakest on capability framing.
- SupportAgent needs a capability matrix that says “native,” “supported via workaround,” or “not a Slack capability.”
- Without that, the current doc reads too much like an issue-tracker connector instead of a communication-channel connector.

- `list items` for Slack should mean “list conversations we may operate in,” not “list tickets.”
- The correct endpoint is `GET https://slack.com/api/conversations.list`.
- Required scopes depend on conversation type: `channels:read`, `groups:read`, `im:read`, `mpim:read`.
- Response is a page of limited conversation objects plus `response_metadata.next_cursor`, not a ticket list.
- Citation: https://docs.slack.dev/reference/methods/conversations.list

- `get one` is underspecified in the source doc.
- There are at least three different “get one” needs SupportAgent may have:
- Get one conversation: `GET /api/conversations.info`.
- Get one user: `GET /api/users.info`.
- Get one message thread root or a thread page: `GET /api/conversations.history` or `GET /api/conversations.replies`.
- The source doc should separate those instead of implying one generic item getter.
- Citation: https://docs.slack.dev/reference/methods/conversations.info
- Citation: https://docs.slack.dev/reference/methods/users.info
- Citation: https://docs.slack.dev/reference/methods/conversations.history
- Citation: https://docs.slack.dev/reference/methods/conversations.replies

- `create` for Slack message output is correctly identified as `POST /api/chat.postMessage` at lines 227-238.
- The doc should add that `channel` can be a conversation ID, and for bot-started 1:1 DM flows a user ID can also be passed to `chat.postMessage`.
- It should also call out `chat:write.public` if the bot must post to public channels it has not joined.
- Citation: https://docs.slack.dev/reference/methods/chat.postMessage

- The `chat.postMessage` example body is valid in broad shape.
- The `metadata` field example is also valid, but the doc should mention that metadata is visible to any app or user in the workspace with access to it and is not a private connector-only field.
- Citation: https://docs.slack.dev/reference/methods/chat.postMessage
- Citation: https://docs.slack.dev/messaging/message-metadata

- `edit/patch` is correctly mapped to `POST /api/chat.update`.
- The doc’s claim that only the same bot can update its own messages is directionally correct, but Slack’s current wording is that only messages posted by the authenticated user are updatable, and bot users may update the messages they post.
- This distinction matters if the connector ever uses user tokens.
- Citation: https://docs.slack.dev/reference/methods/chat.update

- `delete/close` is only partially covered.
- `chat.delete` deletes messages.
- There is no “close ticket” or “close conversation” endpoint equivalent for Slack threads/channels in the sense SupportAgent uses for issue trackers.
- The review doc should explicitly mark “close” as unsupported natively for Slack communication threads.
- Citation: https://docs.slack.dev/messaging/modifying-messages/
- Citation: https://docs.slack.dev/reference/methods/chat.delete

- `list comments` for a Slack thread is not clearly documented in the source file.
- The correct endpoint is `GET /api/conversations.replies` with `channel` and parent `ts`.
- Important constraint: bot tokens can use `conversations.replies` for DMs and MPDMs, but public/private channel threads require a user token with `channels:history` or `groups:history`.
- This is one of the most important endpoint caveats missing from the source doc.
- Citation: https://docs.slack.dev/reference/methods/conversations.replies/

- `post comment` in Slack should be described as “post a thread reply.”
- The correct endpoint is still `POST /api/chat.postMessage` with `thread_ts` set to the parent message timestamp.
- The current source doc hints at this in the generic post-message example but never promotes it to an explicit comment capability.
- Citation: https://docs.slack.dev/reference/methods/chat.postMessage

- `edit comment` and `delete comment` in Slack are also just `chat.update` and `chat.delete` against the reply message `ts`.
- The current source doc does not spell that out.
- For SupportAgent this matters because threaded replies are likely the primary outbound write path.
- Citation: https://docs.slack.dev/reference/methods/chat.update
- Citation: https://docs.slack.dev/reference/methods/chat.delete

- `add/remove label or tag` is not a native Slack capability.
- The source doc correctly says Slack has no native labels, custom fields, priority, severity, or workflow statuses.
- That should be elevated into the endpoint matrix, not left as a side note.
- If SupportAgent wants a lightweight marker, `reactions.add` / `reactions.remove` are the closest native workaround, but they are not labels semantically.
- Citation: https://docs.slack.dev/reference/methods/reactions.add
- Citation: https://docs.slack.dev/reference/methods/reactions.remove

- `set priority/severity` is not a native Slack capability.
- The doc’s metadata workaround is technically valid because `chat.postMessage` supports `metadata`.
- But metadata is message-scoped structured data, not a first-class Slack ticket field, and it will not behave like a queryable status system for operators unless we build that layer ourselves.
- Citation: https://docs.slack.dev/reference/methods/chat.postMessage
- Citation: https://docs.slack.dev/messaging/message-metadata

- `set/change status` and `transition` are unsupported as native Slack concepts.
- The source doc says so indirectly, but the endpoint coverage section needs to say “unsupported, no Web API method.”
- This is important to prevent hallucinated implementation plans later.
- Citation: https://docs.slack.dev/reference/methods

- `assign a user` is unsupported as a native Slack work-item field.
- The only native “assignment-like” pattern here is mentioning a user in message text using `<@U123...>`.
- That is formatting, not an assignment endpoint.
- Citation: https://docs.slack.dev/reference/methods/chat.postMessage

- `mention a user` should be documented as message formatting, not a standalone endpoint.
- The source doc is correct at lines 296-298 that `<@U123ABC456>` is the syntax.
- The connector should treat mention rendering as part of message composition.
- Citation: https://docs.slack.dev/messaging/formatting-message-text/

- `attach file` is currently misdocumented.
- Source doc lines 300-305 say `POST /api/files.uploadV2`.
- There is no Web API endpoint named `files.uploadV2`.
- Current Slack guidance is to use `files.getUploadURLExternal`, upload bytes to the returned URL, then call `files.completeUploadExternal`; `uploadV2` is an SDK convenience wrapper, not the HTTP method name.
- This is a concrete endpoint bug that must be corrected.
- Citation: https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/
- Citation: https://docs.slack.dev/reference/methods/files.getUploadURLExternal
- Citation: https://docs.slack.dev/reference/methods/files.completeUploadExternal/
- Citation: https://docs.slack.dev/tools/node-slack-sdk/web-api/

- The source doc does not mention that `files.upload` is deprecated and has a sunset date.
- Slack says new apps have been unable to use `files.upload` since May 16, 2024, and all apps must migrate by November 12, 2025.
- This should be called out in both endpoint coverage and deprecations.
- Citation: https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/
- Citation: https://docs.slack.dev/reference/methods/files.upload

- `open a DM` is correctly mapped to `POST /api/conversations.open`, but the source doc omits scope details and argument nuance.
- Bot tokens need `im:write` for DM and `mpim:write` for MPDM; `conversations.open` is not for creating public/private channels.
- The example response shape is valid.
- Citation: https://docs.slack.dev/reference/methods/conversations.open/

- The source doc’s identity example at lines 346-350 is wrong.
- It passes `auth.user_id` into `bots.info({ bot: ... })`.
- Slack’s `bots.info` requires a bot ID like `B123...`, not a user ID.
- Slack also says `auth.test` with a bot token can directly return `bot_id`.
- This is an implementation bug if copied literally.
- Citation: https://docs.slack.dev/reference/methods/auth.test
- Citation: https://docs.slack.dev/reference/methods/bots.info

- The source doc’s `users.info` example at lines 355-359 should show `GET /api/users.info` rather than `POST`.
- Slack docs list it as `GET https://slack.com/api/users.info`.
- The response shape should mention `{ ok, user: { ... } }`.
- Citation: https://docs.slack.dev/reference/methods/users.info

- The source doc’s search section is risky as written.
- `search.messages` exists, but it is user-token only and requires the legacy `search:read` scope.
- Slack’s scope page explicitly calls `search:read` a legacy scope and recommends more granular Real-time Search scopes instead.
- For SupportAgent, `search.messages` should not be in the recommended MVP or even default Phase 2 path unless there is a strong need and a user-token model to support it.
- Citation: https://docs.slack.dev/reference/methods/search.messages/
- Citation: https://docs.slack.dev/reference/scopes/search.read

## Inbound events
- Source doc lines 102-167 correctly identify Events API as the primary inbound path and correctly describe the HMAC algorithm.
- The missing pieces are event coverage, wrapper shape updates, retries, slash-command parity, and thread/new-comment nuance.

- The event wrapper example at lines 108-117 is incomplete for current Slack behavior.
- Slack’s current Events API examples include `authorizations`, `event_context`, and `is_ext_shared_channel`; `authorizations` is especially important for Enterprise and Slack Connect visibility.
- The review doc should say those fields are expected and must be preserved when present.
- Citation: https://docs.slack.dev/apis/events-api/

- The source doc does not mention the one-time `url_verification` challenge flow used when configuring Events API request URLs.
- That is a gap in webhook setup coverage.
- Citation: https://docs.slack.dev/reference/events/url_verification

- Source doc lines 149-161 list `message_changed` and `message_deleted` as top-level event names.
- In Slack they arrive as `message` events with subtypes such as `message_changed` and `message_deleted`, not as standalone event types to subscribe to.
- The doc should make that distinction explicit because subscription config and handler logic differ.
- Citation: https://docs.slack.dev/reference/events/message
- Citation: https://docs.slack.dev/reference/events/message/message_changed
- Citation: https://docs.slack.dev/reference/events/message/message_deleted/

- The source doc omits `message_replied`.
- For SupportAgent, “new comment detection” in threaded conversations is important, and Slack exposes this as a `message` subtype / reply signal.
- Slack also documents a known gotcha: the `message_replied` subtype can be missing in Events API deliveries, so handlers should inspect `thread_ts`.
- This belongs in the inbound-events section.
- Citation: https://docs.slack.dev/reference/events/message/message_replied/

- The source doc treats mention detection as `app_mention` plus a string-contains fallback.
- For channels, `app_mention` is the best direct signal and requires `app_mentions:read`.
- For DMs, `app_mention` does not fire; Slack says to subscribe to `message.im`.
- The source doc hints at this but should state it more sharply: channel mention detection can be webhook-only via `app_mention`, DM invocation requires message events.
- Citation: https://docs.slack.dev/reference/events/app_mention
- Citation: https://docs.slack.dev/reference/events/message.im

- Source doc lines 165-167 understate retry semantics.
- Slack retries failed deliveries up to 3 times with a near-immediate retry, then 1 minute, then 5 minutes later.
- Slack also sends `x-slack-retry-num` and `x-slack-retry-reason` headers.
- This should be captured, along with `event_id` de-duplication.
- Citation: https://docs.slack.dev/apis/events-api/

- Source doc line 166 says HTTP 409 does not trigger retry.
- Slack’s retry docs describe retries in terms of failure conditions and headers but do not make 409 a recommended special success code for Events API handling.
- I would treat the 409 claim as unsupported unless the team has a Slack-specific citation; otherwise remove it.
- Citation: https://docs.slack.dev/apis/events-api/

- Source doc correctly says to answer within 3 seconds.
- The doc should add that slash commands and interactive payloads also need prompt acknowledgment, and `trigger_id` is only valid for 3 seconds.
- Citation: https://docs.slack.dev/apis/events-api/
- Citation: https://docs.slack.dev/interactivity/handling-user-interaction/
- Citation: https://docs.slack.dev/interactivity/implementing-slash-commands/

- Source doc covers signature verification only for Events API JSON.
- Slack uses the same signing-secret model for Events API, slash commands, shortcuts, and interactivity payloads.
- SupportAgent should document one shared verifier for all inbound Slack HTTP callbacks.
- Citation: https://docs.slack.dev/authentication/verifying-requests-from-slack

- Source doc’s polling fallback at lines 169-181 is too thin for current Slack limits.
- Polling should be described as a fallback only, using `conversations.history` per monitored conversation plus `oldest` cursoring, and `conversations.replies` only for thread hydration when really necessary.
- Because non-Marketplace rate limits now affect both `conversations.history` and `conversations.replies`, the fallback must be channel-sparse and cursor-driven, not “poll everything.”
- Citation: https://docs.slack.dev/reference/methods/conversations.history/
- Citation: https://docs.slack.dev/reference/methods/conversations.replies/
- Citation: https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps

- Source doc line 181 says `conversations.replies` is 1 request/minute, max 15 total for non-Marketplace apps.
- That wording is inaccurate.
- Slack’s current wording is: for new commercially distributed non-Marketplace apps and installs after May 29, 2025, the method is limited to 1 request/minute and the maximum/default `limit` is 15 objects.
- It is not “15 total” overall.
- Citation: https://docs.slack.dev/reference/methods/conversations.replies/

- Source doc misses that `conversations.history` now has the same new non-Marketplace restriction pattern.
- That is a major omission because polling fallback relies on it.
- Citation: https://docs.slack.dev/reference/methods/conversations.history/
- Citation: https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps

- Source doc’s bot-loop prevention at lines 211-220 is directionally correct but incomplete.
- The handler should filter at least:
- Events authored by `bot_id` matching our app.
- Events where `event.user` equals our bot user ID.
- Messages carrying our connector metadata marker when we deliberately stamp outbound messages.
- Edits/deletes for our own messages when those should not retrigger workflows.
- Slack’s docs also note subtype variation and hidden message subtype behavior, so subtype-aware filtering is needed.
- Citation: https://docs.slack.dev/reference/events/message
- Citation: https://docs.slack.dev/reference/methods/chat.postMessage

- Source doc omits Socket Mode as an inbound delivery alternative.
- Slack supports receiving events and interactive payloads over WebSocket via Socket Mode using an app-level token.
- For enterprise or firewall-constrained customer deployments, this should be mentioned as a viable inbound mode next to public HTTPS webhooks.
- Citation: https://docs.slack.dev/apis/events-api/using-socket-mode/
- Citation: https://docs.slack.dev/reference/methods/apps.connections.open

- Source doc does not mention `team_access_granted` / `team_access_revoked`.
- For organization-ready apps on Enterprise Grid, these events help track which workspaces inside the org the app actually has access to.
- That is relevant for SupportAgent’s workspace/channel routing in org-wide installs.
- Citation: https://docs.slack.dev/enterprise/developing-for-enterprise-orgs/
- Citation: https://docs.slack.dev/reference/events/team_access_granted/

## Hosting variants
- Source doc lines 24-30 say Slack cloud default, Enterprise Grid, and no self-hosted.
- That misses the most important current hosting variant for connector design: GovSlack.
- GovSlack is a separate domain and deployment environment, not just a policy mode.
- Citation: https://docs.slack.dev/govslack/

- `Cloud commercial Slack` is correctly represented by `https://slack.com/api/*`.
- The doc should also note app management at `api.slack.com` and docs now living primarily on `docs.slack.dev`.
- That site migration matters because some older `api.slack.com` references still redirect but should not be treated as the canonical citation target.
- Citation: https://docs.slack.dev/changelog/2024/12/05/api-site-migration/

- `Enterprise Grid` is not a separate base URL.
- It is a hosting/deployment model with org-ready installation, org-wide events, and some org/admin APIs.
- The source doc’s table is okay at a high level, but it should explicitly say commercial Grid still uses `slack.com` Web API roots unless you are in GovSlack.
- Citation: https://docs.slack.dev/enterprise/developing-for-enterprise-orgs/

- `GovSlack` is missing entirely.
- GovSlack uses `slack-gov.com` and `api.slack-gov.com`, not `slack.com` / `api.slack.com`.
- OAuth authorize and token exchange calls, response URLs, incoming webhooks, and other hardcoded domains all need to move.
- Citation: https://docs.slack.dev/govslack/

- The source doc says “Cloud: Slack cloud only; no self-hosted variant.”
- That is correct as far as “no customer self-hosted Slack Server” goes.
- But the review should still flag that SupportAgent needs a variant row for commercial Slack versus GovSlack versus Enterprise Grid deployment model, because those materially change auth, domains, and feature availability.
- Citation: https://docs.slack.dev/govslack/
- Citation: https://docs.slack.dev/enterprise/developing-for-enterprise-orgs/

- Regional/data-residency coverage is missing.
- Slack offers data residency options for certain enterprise customers, and GovSlack is an even stronger domain-isolated variant.
- Even if most Web API behavior is unchanged, the connector doc should flag this operationally because procurement/security reviews will ask.
- Citation: https://slack.com/help/articles/360035633934-Data-residency-for-Slack-Data-residency-for-Slack
- Citation: https://docs.slack.dev/govslack/

- Feature matrix coverage is missing.
- At minimum the source doc should mark:
- GovSlack-only domain and marketplace.
- GovSlack unsupported features such as Slack MCP server and Real-time Search API.
- Enterprise org-wide install events and admin APIs being Enterprise-specific.
- `team_access_granted` / `team_access_revoked` being relevant only for organization-ready apps.
- Citation: https://docs.slack.dev/govslack/
- Citation: https://docs.slack.dev/enterprise/developing-for-enterprise-orgs/

- Breaking-change coverage is incomplete.
- The document should explicitly call out:
- `files.upload` retirement on November 12, 2025.
- May 29, 2025 rate-limit changes for `conversations.history` and `conversations.replies` on new non-Marketplace commercial apps/installations.
- Legacy workspace apps deprecated as of August 2021.
- Classic/legacy auth examples should not be used for new implementations.
- Citation: https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/
- Citation: https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps
- Citation: https://docs.slack.dev/authentication/tokens/

- The source doc does not mention GovSlack feature restrictions.
- Current GovSlack docs say the Slack MCP server and Real-time Search API are not yet supported there.
- That matters because the source doc currently proposes `search.messages` in Phase 2 without any hosting-variant warning.
- Citation: https://docs.slack.dev/govslack/

## Rate limits & pagination
- Source doc lines 365-386 are now materially incomplete.
- Slack’s current rate-limit story is subtle enough that the doc should separate generic tiers, special-case methods, Events API delivery limits, and the 2025 non-Marketplace rule changes.

- Generic Web API tiers in the doc are fine at a high level.
- But the doc should add Tier 1 and Tier 4 explicitly because the current section skips Tier 1, even though the new `conversations.history` / `conversations.replies` restrictions effectively force these methods into a much lower tier for affected apps.
- Citation: https://docs.slack.dev/apis/web-api/rate-limits/

- Source doc line 377 says `chat.postMessage` is 1 msg/sec per channel.
- That is still correct, but Slack also says there is a workspace-wide posting limit above that and only short bursts are tolerated.
- The doc should preserve both constraints.
- Citation: https://docs.slack.dev/reference/methods/chat.postMessage
- Citation: https://docs.slack.dev/apis/web-api/rate-limits/

- Source doc line 378 gives the `conversations.replies` 1/minute note, but the section omits the same 2025 change for `conversations.history`.
- Since polling fallback depends on both, the omission is serious.
- Citation: https://docs.slack.dev/reference/methods/conversations.history/
- Citation: https://docs.slack.dev/reference/methods/conversations.replies/

- Source doc line 379 says `views.open` is 10/workspace/min.
- I did not verify that specific number from current official docs during this pass.
- Because the doc is not primarily about modal-heavy functionality, I would either cite the current method page directly or remove the exact numeric claim until verified.
- Citation needed from current `views.open` reference before keeping that number.

- Source doc line 380 says Events API is 30,000/workspace/app/60 min.
- That is correct and should stay.
- The doc should also mention the `app_rate_limited` event Slack emits when this limit is exceeded.
- Citation: https://docs.slack.dev/apis/web-api/rate-limits/

- Source doc line 384-386 shows a JSON rate-limit response body with `retry_after`.
- Slack’s current Web API guidance says rate limiting is surfaced primarily as HTTP `429 Too Many Requests` with a `Retry-After` header.
- Slack’s Node SDK docs also note the Web API generally responds with `200` for API-level errors and `429` for rate limiting.
- The doc should therefore anchor rate-limit handling on the HTTP status/header, not a JSON body field.
- Citation: https://docs.slack.dev/apis/web-api/rate-limits/
- Citation: https://docs.slack.dev/tools/node-slack-sdk/web-api/

- Retry guidance is underdeveloped.
- Slack explicitly tells clients to wait the `Retry-After` seconds before retrying the same method for the same workspace.
- The source doc should recommend method-scoped backoff keyed by workspace and method, not a global connector pause.
- Citation: https://docs.slack.dev/apis/web-api/rate-limits/

- Concurrency recommendations are missing.
- Slack does not publish exact burst numbers and recommends designing around roughly 1 request/second per API call, allowing only temporary bursts.
- For SupportAgent, that means:
- Serialize writes per destination channel.
- Keep per-workspace method queues.
- Avoid aggressive background reconciliation.
- Citation: https://docs.slack.dev/apis/web-api/rate-limits/

- Pagination coverage is mostly right.
- Slack’s general pagination guide says cursor-paginated methods use `cursor` plus `response_metadata.next_cursor`, recommend `100-200` items, and set a general maximum of `1000` subject to method variance.
- That matches the spirit of the source doc.
- Citation: https://docs.slack.dev/apis/web-api/pagination/

- Source doc line 403 says `conversations.list` max `limit` is 1,000.
- Slack docs say the parameter must be an integer under 1000, and pagination guidance says “under 1000.”
- This is a minor wording mismatch, but since the docs recommend “under 1000,” I would write the source doc as “use <=999 or simply follow Slack’s recommended 100-200.”
- Citation: https://docs.slack.dev/reference/methods/conversations.list/

- Source doc line 404 says `conversations.history` max `limit` is 999.
- That is correct for the general method reference, but for new non-Marketplace commercial apps/installations Slack now reduces both default and maximum to 15.
- The source doc must include the variant-specific override.
- Citation: https://docs.slack.dev/reference/methods/conversations.history/

- Source doc line 405 says `users.list` max `limit` is 200.
- Slack’s current method page does not present 200 as the max; it recommends pagination and warns that omitting `limit` can cause `limit_required` or HTTP 500 behavior, while the general pagination guide says 1000 is the platform maximum subject to method variance.
- I would treat “200” as a recommendation, not a hard max, unless a verified method-page line proves otherwise.
- Citation: https://docs.slack.dev/reference/methods/users.list/
- Citation: https://docs.slack.dev/apis/web-api/pagination/

- Error-shape characterization is too thin.
- Slack method pages generally return `{ ok: false, error: "..." }` in the JSON body for application errors, and reserve HTTP `429` for rate limiting.
- Many method pages also list rich error enums such as `missing_scope`, `channel_not_found`, `team_access_not_granted`, `token_expired`, and `token_revoked`.
- The source doc should summarize that family rather than one example only.
- Citation: https://docs.slack.dev/reference/methods/chat.update
- Citation: https://docs.slack.dev/reference/methods/conversations.open/
- Citation: https://docs.slack.dev/reference/methods/reactions.add

- Bulk endpoint coverage is missing.
- Slack does not provide general batch message/comment write endpoints for the core flows described here.
- The closest relevant “bulk-like” area in this connector is file share to multiple destinations via `channels` in `files.completeUploadExternal`, capped at 100 channels per request.
- That is not a general-purpose bulk comments/messages API.
- Citation: https://docs.slack.dev/reference/methods/files.completeUploadExternal/

## SDK & implementation path
- The npm packages referenced in lines 486-490 exist.
- I verified current registry versions via `pnpm view`: `@slack/web-api` `7.15.1`, `@slack/bolt` `4.7.0`, and `@slack/oauth` `3.0.5`.
- This part of the source doc is accurate.

- The source doc says `@slack/web-api` is the core API client and `@slack/bolt` handles Events API.
- That is correct.
- Slack’s current Node SDK docs also confirm `@slack/web-api` handles formatting, retrying, and pagination, which strengthens the case for it over raw fetch for most of this connector.
- Citation: https://docs.slack.dev/tools/node-slack-sdk/web-api/

- The source doc does not mention a key SDK feature split clearly enough.
- `@slack/web-api` is a good fit for outbound writes and controlled polling.
- `@slack/bolt` is a good fit if we want Slack to manage inbound HTTP, signing verification, slash commands, interactivity, OAuth flow helpers, and optionally Socket Mode.
- `@slack/oauth` is specifically useful if we want to own the install flow without committing to full Bolt request handling.
- Citation: https://docs.slack.dev/tools/node-slack-sdk/web-api/
- Citation: https://docs.slack.dev/tools/bolt-js/reference/
- Citation: https://docs.slack.dev/tools/node-slack-sdk/oauth

- Source doc line 492 recommends Bolt for webhook server.
- That recommendation is coherent.
- Slack docs confirm Bolt supports signing-secret verification automatically, and Bolt handles token rotation automatically in supported versions.
- Citation: https://docs.slack.dev/tools/bolt-js/reference/
- Citation: https://docs.slack.dev/authentication/using-token-rotation/

- The raw-fetch recommendation at line 506 is too simplistic.
- Raw `fetch` is sensible only if we deliberately avoid Slack-specific convenience features and accept building our own retry, rate-limit, pagination, signature-verification, and upload orchestration.
- Given this connector’s needs, raw fetch looks coherent only for a very narrow outbound-only notification sender.
- For the full SupportAgent channel connector, `@slack/web-api` is the stronger default.
- Citation: https://docs.slack.dev/tools/node-slack-sdk/web-api/

- The current MVP/Phase 2/Phase 3 ordering is not fully realistic.
- MVP currently includes `conversations.history` monitoring, channel ops, slash commands, reactions, attachments, and multi-channel monitoring.
- Given Slack’s post-2025 polling limits, the true MVP should prioritize:
- App install/auth.
- `app_mention` and optionally `message.im` intake.
- `chat.postMessage` outbound, including thread replies.
- Basic identity bootstrap via `auth.test`.
- Optional `users.info` only if user/email mapping is actually needed.
- That would keep the connector webhook-first and avoid early dependence on rate-limited history reads.

- The current MVP includes `files.uploadV2`.
- As noted above, that is not an HTTP endpoint and should be reframed either as:
- SDK path: `web.filesUploadV2(...)` if we choose Node SDK convenience.
- Raw HTTP path: `files.getUploadURLExternal` + upload bytes + `files.completeUploadExternal`.
- This is both an endpoint and implementation-path correction.
- Citation: https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/
- Citation: https://docs.slack.dev/tools/node-slack-sdk/web-api/

- The source doc’s config interface at lines 450-462 is missing fields needed for anything beyond a manually provisioned single-workspace bot.
- If we support OAuth installs, we also need at least:
- `clientId`
- `clientSecret`
- install mode / distribution mode
- token rotation enabled flag or derived token metadata
- optional `refreshToken`
- optional `enterpriseId`
- installation scope marker such as `isEnterpriseInstall`
- optional `appToken` if Socket Mode is supported
- optional API base URL override for GovSlack
- These are not optional operational details if SupportAgent will support hosted installs.
- Citation: https://docs.slack.dev/reference/methods/oauth.v2.access
- Citation: https://docs.slack.dev/enterprise/developing-for-enterprise-orgs/
- Citation: https://docs.slack.dev/govslack/
- Citation: https://docs.slack.dev/reference/scopes/connections.write

- Conversely, the config interface includes fields that should be derivable rather than operator-entered.
- `botUserId`, `botId`, and often `teamId` should be discovered via install response and/or `auth.test`, not typed manually.
- Citation: https://docs.slack.dev/reference/methods/auth.test
- Citation: https://docs.slack.dev/reference/methods/oauth.v2.access

- The source doc says Slack has no CLI equivalent to `gh`.
- That is fair in the context of this connector.
- Slack does have a Slack CLI, but it is oriented around app development workflows, not operator-side runtime messaging equivalent to GitHub CLI.
- The source doc should refine this to “no CLI that meaningfully replaces runtime connector operations.”
- Citation: https://docs.slack.dev/tools/node-slack-sdk/
- Citation: https://docs.slack.dev/authentication/tokens/

- The open questions are incomplete.
- The most important operational blockers not raised are:
- Do we support commercial Slack only, or GovSlack too?
- Do we support Socket Mode as a no-public-ingress option?
- Do we require thread reply reads in public/private channels, which would force a user-token path for `conversations.replies`?
- Do we need org-ready installs and workspace-access tracking for Enterprise Grid?
- Do we need email mapping strongly enough to request `users:read.email`?
- Are we willing to support the OAuth/token-rotation storage lifecycle, or do we limit MVP to manual single-workspace install?
- Those are higher-value blockers than the current “reaction signals?” style questions.

## Priority fixes
1. Replace the OAuth V2 response example and token taxonomy. The current doc mixes modern OAuth V2, token rotation, and older nested `bot.bot_access_token` response shapes. Use current `oauth.v2.access` and token-rotation docs, and stop describing `xoxe-` as an Enterprise token class. Citations: https://docs.slack.dev/reference/methods/oauth.v2.access and https://docs.slack.dev/authentication/using-token-rotation/

2. Fix attachment upload immediately. `files.uploadV2` is not a Web API endpoint. Document either the SDK helper or the real HTTP sequence `files.getUploadURLExternal` -> upload bytes -> `files.completeUploadExternal`, and mention the `files.upload` retirement on November 12, 2025. Citations: https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/ and https://docs.slack.dev/reference/methods/files.completeUploadExternal/

3. Rework inbound event coverage around current Slack semantics. Add `authorizations`, `event_context`, `url_verification`, retry headers, `message_replied`, and the “message subtypes are still `message` events” distinction. Citations: https://docs.slack.dev/apis/events-api/ and https://docs.slack.dev/reference/events/message/message_replied/

4. Add hosting variants properly. The current “cloud only / Enterprise Grid / no self-hosted” summary is incomplete without GovSlack, domain changes, org-ready installs, and GovSlack feature exclusions. Citations: https://docs.slack.dev/govslack/ and https://docs.slack.dev/enterprise/developing-for-enterprise-orgs/

5. Update the rate-limit and polling strategy. The doc must mention that both `conversations.history` and `conversations.replies` have new commercial non-Marketplace limits for new apps/installations, and that rate limiting is surfaced via HTTP `429` plus `Retry-After`, not a JSON `retry_after` contract you can rely on. Citations: https://docs.slack.dev/apis/web-api/rate-limits/ and https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps

6. Correct the identity/bootstrap example. `bots.info` takes a bot ID, not the `user_id` returned by `auth.test`, and `auth.test` itself can already return `bot_id` for bot tokens. Citations: https://docs.slack.dev/reference/methods/auth.test and https://docs.slack.dev/reference/methods/bots.info

7. Split native Slack capabilities from issue-tracker expectations. Explicitly mark labels, status, severity, transition, and assignment as unsupported natively, with reactions/metadata/user mentions documented only as workarounds. This will prevent future hallucinated implementation work.

8. Tighten the MVP scope. Make MVP webhook-first with `app_mention`, optional `message.im`, thread replies via `chat.postMessage`, and minimal read scopes. Push `search.messages`, broad polling, and advanced reconciliation out of MVP unless there is a hard requirement and a user-token strategy.
