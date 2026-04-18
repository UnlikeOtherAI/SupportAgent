# WhatsApp combined review

## Verdict
The source doc is directionally useful for a Cloud API based WhatsApp connector, but it is not safe to implement from as-is. The biggest gaps are: incorrect token lifecycle, incorrect webhook signature/header details, stale or invented webhook field names, stale Graph versions, multiple hallucinated or misplaced endpoints, and outdated rate-limit/retry assumptions. Confidence is medium-high because the core Cloud API shape is clear in current Meta docs, but a few operational claims in the source doc could not be verified from current public docs and should be downgraded to open questions instead of hard facts.

## Authentication
- The source correctly centers the connector on Meta-hosted WhatsApp Business Platform tokens, but it flattens Meta auth into a generic “System User Access Token” story. Current Meta docs distinguish three token modes: `System User access token` for direct developers, `Business Integration System User access token` for Tech Providers / Embedded Signup, and short-lived `User access token` mainly for testing. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/
- The source’s token exchange example (`POST /oauth/access_token` with `fb_exchange_token`) is not the recommended production path for this connector. Current WhatsApp docs tell direct developers to generate system user tokens in Business Settings, and Tech Providers to obtain business integration system user tokens through Embedded Signup / Facebook Login for Businesses. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/
- The source’s token lifetime section is materially wrong. It says long-lived system user tokens are “~60 days with automatic refresh” and then also says they “do not expire.” Current Meta docs describe system tokens as long-lived, user access tokens as expiring every few hours, and the permissions doc’s `debug_token` example shows `expires_at: 0` and `data_access_expires_at: 0` for a valid system token. The doc should remove the “60 days” and “auto-refresh on 401” guidance. Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions/
- The source should explicitly separate direct-developer and solution-provider auth. For SupportAgent this matters because SaaS / multi-tenant onboarding should not be documented as “use one system user token per tenant” when Meta’s documented path for provider-style onboarding is Embedded Signup plus business integration system user tokens. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/
- The permissions list is close but not minimum-sufficient as written. Current docs say the general minimum is:
  `whatsapp_business_management` for WABA metadata, template management, phone-number metadata, analytics, and WABA-change webhooks.
  `whatsapp_business_messaging` for sending messages and receiving incoming-message / message-status webhooks.
  `business_management` is only needed if you must programmatically access the business portfolio, and Meta explicitly calls that “rarely needed.”
  The source presents `business_management` as a standard required permission; for MVP it should be optional. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions/
- The source is missing newer optional permissions relevant only to marketing-specific extensions. Current docs list `whatsapp_business_manage_events` and `ads_read` as optional for Marketing Messages API / conversion metrics, which matters if the doc is trying to be current and exhaustive. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions/
- The source’s admin-consent guidance is incomplete. It correctly notes `Manage app`, but current Meta docs also emphasize business asset access on the WABA itself, with `Partial` or `Full` business asset access controlling what the token can reach. That should be documented because many “code 200 permission denied” failures come from WABA asset access, not missing OAuth scopes. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/
- The source’s webhook verification section is only half-correct. The GET verification flow using `hub.mode`, `hub.verify_token`, and `hub.challenge` is correct. Citation: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- The webhook signature section is materially incorrect in three ways:
  it says “ECDSA (P-256)”;
  it uses header name `X-Hub-SHA256`;
  it then describes HMAC-SHA256 with the app secret.
  Current Meta webhook docs say payloads are signed with a SHA256 signature in header `X-Hub-Signature-256`, prefixed with `sha256=`, and verified by generating a SHA256 signature from the payload and your app secret. The source should be rewritten to HMAC-SHA256 style verification with the exact documented header name and `sha256=` prefix handling. Citation: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- The sample signature code is also wrong operationally because it compares the raw header buffer with the raw hex digest buffer. The header includes the `sha256=` prefix; the doc should say “strip the prefix, then timing-safe compare the digest bytes / hex strings.” Citation: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- The source is silent on replay protection. Current Meta docs document signature verification, but I did not find a public Meta doc for a webhook timestamp / replay header for WhatsApp. The review recommendation is: document this as a gap, state that Meta does not document a signed timestamp header in the current public webhook docs, and require idempotency keyed by webhook payload message IDs / status IDs instead of inventing a replay protocol. Citations:
  https://developers.facebook.com/docs/graph-api/webhooks/getting-started
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/webhooks/whatsapp-incoming-webhook-payload/
- The source should also stop using the generic auth taxonomy from the audit prompt (`API key`, `PAT`, `service account`) as if those were applicable to WhatsApp. Current Meta docs frame auth around access-token types, not PATs or service accounts. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/

## Endpoints
- The source hardcodes `v21.0` throughout. That is stale. Current Meta reference material for Message API is on `v23.0`, while current guide pages for send/reaction/mark-read show latest-version placeholders up to `v25.0`. The doc should stop pinning examples to `v21.0` and instead say “use the latest stable Graph API version supported by the connector.” Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/reaction-messages/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/mark-message-as-read/
- For outbound send, the source is broadly correct that message send goes through `POST /{Version}/{Phone-Number-ID}/messages`. Current Message API docs confirm this single endpoint for text, media, templates, interactive messages, reactions, mark-read, and other message operations. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api/
- The text-message example shape is valid in current docs: `messaging_product`, `recipient_type`, `to`, `type: text`, and `text.body` / `text.preview_url`. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages/
- The source’s response-shape description for send is incomplete. Current docs say the accepted response can include:
  `messaging_product`
  `contacts[]`
  `messages[].id`
  optionally `messages[].group_id` for group sends
  optionally `messages[].message_status` for paced template sends.
  The review doc should note these optional response fields because they matter for loop prevention and pacing observability. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages/
- The template-send example is broadly valid, but the source’s note that template names are case-sensitive should be rechecked against actual creation rules. Current template docs emphasize lowercase alphanumeric + underscores for names and categorize templates as `authentication`, `marketing`, or `utility`. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
- The source’s interactive list/button section is partly stale. Current send-message docs now cover more interactive types than the source lists, including URL CTA buttons, location request, flows, product messages, and call-permission-request / catalog variants in the schema. The source should not imply “button” and “list” are the complete interactive surface. Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api/
- The reaction request body in the source is wrong. It shows:
  `type: reaction`
  `reaction: { emoji: "👍" }`
  top-level `message_id`
  Current Meta docs require `reaction.message_id` nested inside the `reaction` object, not a top-level `message_id`. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/reaction-messages/
- The source’s “Delete message” section appears hallucinated or at minimum unsupported by current public docs. Current send-message guides and current Message API reference do not document a `type: delete` message body or any delete-message endpoint on `/{Phone-Number-ID}/messages`. If SupportAgent needs message deletion, this should remain “not documented in current public Cloud API docs” instead of being presented as supported. Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api/
- The source’s “No edit/delete” statement is only half right. “No edit” is consistent with current docs. “Delete within 15 minutes” is not supported by a current public endpoint citation in the docs I checked, so it should not be asserted without a primary Meta reference.
- The source’s “Read single message” endpoint is not supported by the current Message API reference. Current Message API reference exposes only `POST /{Version}/{Phone-Number-ID}/messages`; it does not expose `GET /{message-id}?phone_number_id=...` for retrieving a message body by message ID. The source should remove or downgrade that endpoint unless a primary Meta reference is added. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api/
- The source’s polling section compounds that mistake by calling the mark-read operation a “Read Messages endpoint.” Current Meta docs show mark-as-read as another `POST /{Phone-Number-ID}/messages` operation with body `{ messaging_product, status: "read", message_id }`; it does not retrieve message history. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/mark-message-as-read/
- The source’s media upload endpoint is correct in shape: `POST /{Version}/{Phone-Number-ID}/media`. Current docs support multipart upload and return `{ id }`. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/media-upload-api/
- The source is missing the documented follow-on media endpoints that SupportAgent needs for attachment intake:
  `GET /{Version}/{Media-ID}` to retrieve a temporary media URL;
  `GET /{Version}/{Media-URL}` to download the binary;
  `DELETE /{Version}/{Media-ID}` to delete uploaded media if needed.
  Those should be added because attachment handling is explicitly in scope for SupportAgent. Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/media/media-api/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/media/media-download-api/
- The source’s template-management endpoints are on the wrong node. It documents:
  `GET /{Phone-Number-ID}/message_templates`
  `POST /{Phone-Number-ID}/message_templates`
  Current Meta docs put template management on the WABA:
  `GET /{Version}/{WABA-ID}/message_templates`
  `POST /{Version}/{WABA-ID}/message_templates`
  `DELETE /{Version}/{WABA-ID}/message_templates`
  `GET /{Version}/{TEMPLATE_ID}`
  `POST /{Version}/{TEMPLATE_ID}` for edit.
  This is a priority correction. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/template-api/
- The source underspecifies the template-list response. Current Template API docs return `data[]` plus `paging.cursors.after|before`; this is one of the few WhatsApp/WABA areas with explicit cursor pagination and should be documented precisely. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/template-api/
- The source’s WABA info endpoint (`GET /v21.0/{WABA-ID}`) is directionally correct but underdocumented. Current WABA API supports `GET /{Version}/{WABA-ID}` and optional `fields` such as `id`, `name`, `timezone_id`, `account_review_status`, `business_verification_status`, `country`, `ownership_type`, and `primary_business_location`. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/whatsapp-business-account-api/
- The source is missing the business-phone-number metadata endpoint that is likely necessary for channel setup and health checks:
  `GET /{Version}/{Phone-Number-ID}`
  with optional `fields` including `name_status` and `code_verification_status`.
  This is where quality / verified-name / verification state come from. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/whatsapp-business-account-phone-number-api/
- The source also misses that the phone-number metadata response exposes platform/throughput state in current docs and examples. This matters for SupportAgent setup validation, because the doc currently treats `phoneNumberId` as static config without documenting health / quality inspection. Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/whatsapp-business-account-phone-number-api/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
- The source’s “labels / flags / status / priority / severity” section is directionally correct that WhatsApp is not an issue tracker, but it overstates “conversation state: active, archived” without a current API citation. The current public docs I reviewed do not provide a simple conversation-state CRUD surface analogous to tickets. This should be reframed as “not a native issue model; SupportAgent must project its own issue state.” Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/webhooks/whatsapp-incoming-webhook-payload/
- For the required audit matrix:
  list items: not supported for inbound user messages in the Cloud API docs; source should explicitly mark this as “no general list inbox/messages endpoint.”
  get one: message-body retrieval by `message-id` is not currently documented; media retrieval by `media-id` is documented.
  create: yes, `POST /{Phone-Number-ID}/messages`, `POST /{Phone-Number-ID}/media`, `POST /{WABA-ID}/message_templates`.
  edit/patch: templates can be edited via `POST /{TEMPLATE_ID}`; messages themselves are not editable.
  delete/close: templates can be deleted via `DELETE /{WABA-ID}/message_templates`; media can be deleted via `DELETE /{Media-ID}`; message delete/close is not documented.
  list comments / post comment / edit comment / delete comment: not a native concept; messages are the comment analogue, but there is no public list/edit/delete comment API.
  add/remove label or tag: not documented in current Cloud API.
  set priority/severity/status/transition: not documented in current Cloud API.
  assign/mention user: not documented in current Cloud API.
  attach file: yes, upload media and send media messages are documented.
- The source should stop using “externalUrl = `https://wa.me/...`” as if it were a stable item URL. `wa.me` is a conversation-start shortcut, not a canonical message permalink. This is an implementation-risk note; I did not find a Meta doc offering a message permalink format, so the connector should likely store `null` or a synthetic internal route instead.

## Inbound events
- The source’s webhook subscription model is the most outdated section in the doc. It lists fields such as `message_deliveries`, `message_reads`, `message_reactions`, and `conversations`. Current incoming webhook payload reference instead shows `changes[].field` as one of:
  `messages`
  `group_lifecycle_update`
  `group_settings_update`
  `group_participant_update`
  and message delivery/read/failure events arrive as `value.statuses[]` under `field: "messages"`, not as separate top-level fields. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/webhooks/whatsapp-incoming-webhook-payload/
- The source should rewrite “event names” to the exact current payload model:
  incoming customer content: `changes[].field = "messages"` with `value.messages[]`
  outbound status notifications: `changes[].field = "messages"` with `value.statuses[]`
  group events: `group_lifecycle_update`, `group_settings_update`, `group_participant_update`
  template lifecycle: `field = "message_template_status_update"`
  phone throughput / quality updates: `field = "phone_number_quality_update"`
  Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/webhooks/whatsapp-incoming-webhook-payload/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/message_template_status_update/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/phone_number_quality_update/
- The source’s inbound message payload example is generally aligned for a simple text message. The top-level shape `object -> entry[] -> changes[] -> value` is correct. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/webhooks/whatsapp-incoming-webhook-payload/
- The source omits the `statuses[]` payload shape that SupportAgent needs for outbound delivery tracking and loop prevention. Current docs define `statuses[].id`, `status`, `timestamp`, `recipient_id`, optional `conversation`, optional `pricing`, and optional `errors[]`. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/webhooks/whatsapp-incoming-webhook-payload/
- The source’s “conversation started/ended” field is stale. In current docs, conversation metadata appears nested on status objects as `statuses[].conversation`, with nested `id`, `expiration_timestamp`, and `origin.type`; it is not presented as a separate top-level `conversations` webhook field in the incoming payload reference. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/webhooks/whatsapp-incoming-webhook-payload/
- The source is silent on template-status and phone-quality webhooks, but those are operationally important for SupportAgent if it plans to manage templates or observe throughput upgrades. The exact event surfaces are:
  `field: "message_template_status_update"` with `value.event`, template identifiers, reason, and optional rejection/disable info.
  `field: "phone_number_quality_update"` with `value.event`, `current_limit`, and `max_daily_conversations_per_business`.
  Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/message_template_status_update/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/phone_number_quality_update/
- The source’s signature verification algorithm and header are wrong, as noted above. Current Graph docs are clear: `X-Hub-Signature-256`, SHA256 signature, generated from payload plus app secret. Citation: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- The source’s retry semantics are materially wrong. It says “up to 7 times” and “respond within 20 seconds.” Current throughput docs say Meta attempts to redeliver failed webhooks for up to 7 days with exponential backoff, recommends median latency <= 250ms, and says fewer than 1% of requests should exceed 1s. This should be corrected because SupportAgent sizing / SLAs depend on it. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput/
- The source’s polling fallback section is not implementation-safe:
  it proposes “re-fetch messages after known gaps”;
  it cites a “Read Messages endpoint” that is actually mark-as-read;
  it implies single-message lookup by message ID.
  Current public docs do not expose a general polling endpoint for inbound message content. The doc should say:
  primary intake is webhook-only;
  recovery is limited;
  you must persist inbound payloads durably at receipt time;
  mark-read is acknowledgement, not retrieval;
  message-history APIs do not replace inbox polling.
  Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/mark-message-as-read/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/message-history/whatsapp-business-message-history-events-api/
- The source’s “No message replay API” claim is directionally right for inbound message bodies, but too absolute. Current Meta docs do have a WhatsApp Business Message History Events API for delivery-status history on a message-history entry, with cursor pagination. That is not a general inbound-message replay API, so the doc should distinguish the two. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/message-history/whatsapp-business-message-history-events-api/
- The source’s mention detection angle is missing. For 1:1 business chats there is no documented native “@bot mention” field in current webhook payloads. If SupportAgent wants mention-style triggering, the doc should mark that as “not a first-class WhatsApp feature in current public docs; requires command-prefix / keyword parsing, especially in groups.” Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/webhooks/whatsapp-incoming-webhook-payload/
- The source’s bot-authored loop-prevention section is wrong in the key detail. It says outbound messages “come back in the webhook as an inbound message” and suggests checking inbound `messages[].id` against sent IDs. Current docs separate incoming content (`value.messages[]`) from status notifications (`value.statuses[]`), and send-message docs say the send response `messages[].id` appears in associated `messages` webhooks such as sent/read/delivered webhooks. The correct loop model is:
  store outbound WhatsApp message IDs;
  treat `statuses[].id` as outbound tracking events;
  treat incoming `messages[]` as user/system/group content;
  treat replies via `context.message_id` / context linkage as user replies to bot messages.
  Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/webhooks/whatsapp-incoming-webhook-payload/
- The source uses `context.id`; current Message API schema uses `context.message_id` for contextual replies. The webhook payload docs should be checked for the inbound shape and the source should keep naming consistent with current send docs. Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api/
- The source’s identity assumptions for inbound authors are too strong. Current docs explicitly note that a WhatsApp user’s `wa_id` may not always match the phone number input / phone number string. The doc should not treat `wa_id` as “always the same phone number.” Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/webhooks/whatsapp-incoming-webhook-payload/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages/

## Hosting variants
- The source’s headline “Cloud-only; on-prem sunset October 23, 2025; no self-hosted equivalent exists” is too blunt for the current docs set. The current public docs emphasize the Meta-hosted Cloud API and Business Management APIs, but I did not find a current primary Meta doc in the reviewed set that restates the exact “October 23, 2025” sunset date. That exact date should be cited from a primary Meta changelog page or removed. If the team cannot produce the citation, downgrade it to “current public docs focus on Cloud API only.” Citation for current platform framing: https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
- The current docs present the platform as multiple active surfaces, not just “Cloud API”:
  WhatsApp Cloud API for messaging/calling/groups
  Business Management API for WABA assets, templates, and phone numbers
  Marketing Messages API for optimized marketing sends
  Webhooks as the primary inbound event plane.
  The source doc should treat these as hosting/product variants or capability surfaces because they affect auth scopes and roadmap decisions. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
- The source says “no support for group chats (standard).” That is no longer consistent with current docs. Current platform docs explicitly say Cloud API groups are supported, current Message API schema allows `recipient_type: "group"`, current webhook payload reference includes group-related fields, and there are Groups APIs in the nav/reference tree. This is a major outdated claim. Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/webhooks/whatsapp-incoming-webhook-payload/
- The source does not mention coexistence numbers. Current throughput docs say phone numbers that coexist with the WhatsApp Business app are capped at 20 mps. That matters for enterprise installs where customers may bring an existing number. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput/
- The source’s base-URL handling is mostly fine for cloud calls, but it should explicitly note that current official references all use the global Graph base URL `https://graph.facebook.com`; I did not find regional Graph base-URL variants in the reviewed docs. This means the regional/data-residency section is currently a gap, not something the doc can invent. Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/template-api/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/whatsapp-business-account-api/
- The source is missing version-drift guidance. Current docs span `v23.0` reference pages and guide pages showing latest-version placeholders up to `v25.0`. The review recommendation is: document tested minimum version plus “pin one current Graph version in code, watch Meta changelog, and re-audit at each major Graph release.” Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/mark-message-as-read/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/reaction-messages/
- The source is also missing explicit deprecations now visible in current webhook docs. For example, `phone_number_quality_update.current_limit` and `old_limit` are documented as being removed in February 2026 in favor of `max_daily_conversations_per_business`. That is exactly the kind of version-drift note this document should capture. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/phone_number_quality_update/
- The source’s “regional/data residency variants” coverage is absent. In the current public docs I reviewed, there is no documented region-specific Graph base URL or per-region webhook hostname variant, so the correct review note is “gap: no regional/data residency section; current public docs reviewed do not expose alternate base URLs.”
- The source’s “breaking changes between major API versions” coverage is absent. The best current evidence from the public docs is field deprecation (for example `current_limit` / `old_limit`) and newer capabilities like groups/calling/flows that make earlier assumptions invalid. The doc should add a “watchlist” section instead of pretending version drift is static.

## Rate limits & pagination
- The source’s rate-limit table is outdated. Current Meta docs say:
  WABA management endpoints: 200 requests/hour/app/WABA by default, and 5000 requests/hour/app/active-WABA for active WABAs with at least one registered phone number.
  business phone numbers: 80 mps by default and up to 1000 mps after automatic upgrade.
  coexistence numbers: fixed 20 mps.
  pair limit: 1 message every 6 seconds to the same user, about 10/minute or 600/hour.
  These numbers supersede the source’s “20/80/250/1000 mps” tier table and “15 messages/minute per conversation.” Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput/
- The source’s monthly-sent-limit table is stale. Current docs describe messaging limits and throughput separately, and the `phone_number_quality_update` webhook already uses values like `TIER_50`, `TIER_250`, `TIER_2K`, `TIER_10K`, `TIER_100K`, and `TIER_UNLIMITED`. The source’s “250 / 1,000 / 10,000 / unlimited monthly sent limit” table is not current enough to keep. Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/phone_number_quality_update/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
- The source’s rate-limit surfacing section is incomplete. Current Meta Graph docs say apps should inspect `X-App-Usage` / `X-Business-Use-Case-Usage` headers to understand current rate usage. The WhatsApp docs explicitly point to the Graph headers doc for this. The source should document both body errors and usage headers. Citations:
  https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
- The source’s claim that “no Retry-After header” exists may be true often enough in practice, but current official guidance emphasizes stopping calls and inspecting usage headers, not promising `Retry-After`. The doc should soften this to “do not depend on `Retry-After`; use usage headers plus exponential backoff.” Citations:
  https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
- The source’s backoff advice is also stale. Current WhatsApp docs explicitly recommend `4^X` seconds for pair-rate-limit retries after send failures to the same user. That should replace the generic `1,2,4,8,16,30` guidance at least for per-user throttling. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
- The source centers `429` with error code `131030` as the canonical throttling error. Current docs show multiple relevant throttling/error paths:
  Graph-style 429/code `4` for application request limit;
  throughput error `130429`;
  pair-rate-limit error `131056`.
  The connector doc should document all three classes instead of one hardcoded error. Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/message-history/whatsapp-business-message-history-events-api/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
- Pagination coverage in the source is too absolute. For inbound message history, yes, there is no general message-list pagination surface in current public docs. But other WhatsApp surfaces do paginate:
  template list uses `paging.cursors.after|before`;
  message-history events use cursor pagination with `limit` max 100.
  The doc should split “message inbox/history pagination” from “management API pagination.” Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/template-api/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/message-history/whatsapp-business-message-history-events-api/
- The source omits the max page size where it actually exists. Message-history events allow `limit` 1..100 with default 25. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/message-history/whatsapp-business-message-history-events-api/
- The source’s “No batch endpoint exists” is mostly right for message send, but the doc should say “no documented bulk message-send endpoint in Cloud API.” That is narrower and more accurate than “no batch endpoints exist” because template-management and marketing-specific APIs evolve separately.
- The source should explicitly characterize current error shapes. Current Meta references consistently show Graph-style error envelopes:
  `error.message`
  `error.type`
  `error.code`
  optional `error_subcode`
  optional `error_user_title`
  optional `error_user_msg`
  optional `is_transient`
  `fbtrace_id`
  This is important for a shared SupportAgent connector error contract. Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/whatsapp-business-account-api/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/message-history/whatsapp-business-message-history-events-api/
- Concurrency guidance is missing and should be added. Current throughput docs recommend webhook servers able to absorb roughly 3x outgoing-message traffic as status webhooks plus 1x expected incoming-message traffic, with median latency <= 250ms and <1% over 1s. That is better than the source’s unsupported “20s timeout” claim. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput/

## SDK & implementation path
- The source’s “no official npm SDK from Meta” claim is overstated. Current Meta docs no longer recommend an official SDK and explicitly mention third-party SDKs as not maintained or endorsed by Meta, which supports a raw-HTTP recommendation. However, npm still has an official-looking `whatsapp` package published by Meta/WhatsApp (`opensource+npm@fb.com`, repo `WhatsApp/WhatsApp-Nodejs-SDK`). The doc should either remove the absolute claim or restate it as “current docs do not recommend an official SDK for new Cloud API integrations.” Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
  https://www.npmjs.com/package/whatsapp
  https://github.com/WhatsApp/WhatsApp-Nodejs-SDK
- The source’s raw-fetch recommendation is coherent and should stay. Current Meta docs emphasize Graph API HTTP calls, current references are clean REST/Graph operations, and the docs do not endorse third-party wrappers. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
- The source’s package validation is weak:
  `whatsapp-api-js` does exist on npm (`6.2.1`) and markets itself as a TypeScript Cloud API wrapper.
  The cited scoped packages `@抽離/whatsapp-webhook` and `@抽離/whatsapp-upload` could not be verified as real npm packages during this audit and should not appear in the research doc without a working package URL.
  Citations:
  https://www.npmjs.com/package/whatsapp-api-js
  package-registry validation attempt during audit showed no verifiable result for the two scoped package names
- The source should explicitly mention the official Postman collection as the closest thing to an official “tooling path.” Current Meta docs point to the official WhatsApp Business Platform Postman collection. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
- The source is correct that there is no `gh`-style first-party CLI in the current docs set. That conclusion is sensible and matches the documented tooling surface (Business Manager / WhatsApp Manager / Postman / HTTP APIs). Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
- The source’s MVP scope includes template CRUD on the phone-number node, which is wrong and would derail implementation. The MVP endpoint inventory should be corrected to:
  send messages: `POST /{Phone-Number-ID}/messages`
  mark as read: same endpoint with `status: "read"`
  upload media: `POST /{Phone-Number-ID}/media`
  retrieve media URL: `GET /{Media-ID}`
  download media: `GET /{Media-URL}`
  get WABA: `GET /{WABA-ID}`
  get phone number metadata: `GET /{Phone-Number-ID}`
  list/get/create/edit/delete templates on the WABA / template node.
  Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/mark-message-as-read/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/media-upload-api/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/media/media-api/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/media/media-download-api/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/template-api/
- The source’s minimum config list is missing a decision-critical auth discriminator. It should include an explicit auth mode such as:
  `direct_system_user`
  `embedded_signup_business_token`
  `test_user_token`
  because current Meta docs treat these as different onboarding models, not just different token strings. Citation: https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/
- The source’s config list also mixes runtime state into persistent admin configuration by including `outboundMessageIds: Set<string>`. That should not be admin config; it belongs in persisted delivery-tracking state / connector runtime storage.
- The source’s pairing flow is directionally useful, but it should mention that current docs support groups and that `wa_id` is not guaranteed to equal the displayed phone number string. Pairing should therefore bind on durable Meta identifiers plus verified phone context, not raw display strings alone. Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/webhooks/whatsapp-incoming-webhook-payload/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
- The source’s Phase 2 / Phase 3 ordering needs adjustment:
  group support should not be Phase 3 “enterprise only” because current docs describe groups as a Cloud API capability now, not an undocumented enterprise-only path.
  quality / throughput monitoring should move earlier because current webhook docs make it easy to track and it materially affects production safety.
  template-status webhooks should move earlier if template CRUD is in MVP.
  Citations:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/phone_number_quality_update/
  https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/message_template_status_update/
- The source’s open questions are mostly pointed in the right direction, but they miss several deployment blockers that are more urgent than some of the listed roadmap items:
  direct developer vs Tech Provider auth path;
  WABA asset access / permission-debugging workflow;
  webhook durability and idempotency plan given 7-day redelivery and no documented replay timestamp;
  current Graph API version pin and upgrade policy;
  whether group chats are in scope for MVP now that current docs support them;
  whether SupportAgent will handle template-status and throughput webhooks from day one.

## Priority fixes
1. Replace the auth section with current Meta token taxonomy and remove the false “60-day auto-refresh system token” claim. Cite the access-token and permissions docs directly.
2. Rewrite webhook signing to `X-Hub-Signature-256` + SHA256/app-secret verification, and remove the incorrect ECDSA / `X-Hub-SHA256` language.
3. Replace the webhook event model. Use `field: "messages"` with `value.messages[]` and `value.statuses[]`, plus separate `message_template_status_update` and `phone_number_quality_update` sections.
4. Remove or explicitly mark unsupported/hallucinated endpoints:
   `GET /{message-id}?phone_number_id=...`
   template CRUD under `/{Phone-Number-ID}/message_templates`
   message delete via `type: delete` unless a primary Meta doc is added.
5. Update all hardcoded versions from `v21.0` to “latest supported Graph version,” and note that current references/guides are already beyond `v21.0`.
6. Replace the rate-limit section with the current split between WABA request limits, 80 mps default throughput, 1000 mps upgraded throughput, coexistence 20 mps, and the 1-message-per-6-seconds pair limit.
7. Correct webhook retry guidance from “7 times / 20 seconds” to the current 7-day redelivery guidance and Meta’s published webhook latency/concurrency targets.
8. Fix loop-prevention guidance so outbound sends are tracked through `statuses[]` and stored outbound IDs, not by assuming business-authored messages are replayed as inbound customer messages.
9. Correct template management to WABA/template-node endpoints and add cursor pagination details.
10. Add the missing attachment retrieval path:
    `POST /{Phone-Number-ID}/media`
    `GET /{Media-ID}`
    `GET /{Media-URL}`
    `DELETE /{Media-ID}`
11. Update the hosting-variants section to reflect current platform surfaces and current group support, and either cite or remove the exact on-prem sunset date.
12. Clean up the implementation-path section:
    keep raw `fetch` as the default;
    remove unverifiable package names;
    mention the official Postman collection;
    move quality/template-status webhooks earlier in the roadmap;
    move `outboundMessageIds` out of admin config and into runtime state.
