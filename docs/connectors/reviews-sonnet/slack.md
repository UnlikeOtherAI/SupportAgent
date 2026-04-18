# Slack combined review

## Verdict

The Slack connector doc is well-structured and broadly accurate for a mid-2025 Slack bot implementation. Authentication, signature verification, and the core messaging endpoints are correctly described. The main gaps are: (1) the `conversations.replies` rate-limit note is correct but its interaction with thread polling is underspecified; (2) the Tier table is incomplete — Tier 1 and Tier 4 exist and several methods listed as Tier 3 are actually Tier 2; (3) `files.uploadV2` usage is sketched but the required two-step upload protocol is not described; (4) Enterprise Grid org-token scoping and admin-level scopes are mentioned but not fully detailed; (5) the doc is silent on event retry counts, `Retry-After` header semantics, and the HTTP 200 requirement for slash command acknowledgment timing. Confidence is moderate-high: the doc is a reliable starting point but needs targeted corrections before implementation.

---

## Authentication

**Token types** — Accurate overall. The `xoxe-` prefix is used for both org-level access tokens and refresh tokens; the doc flags this but the table entry for "Enterprise token" lists `xoxe-` twice with slightly confusing wording. Clarify: access tokens on Enterprise Grid are `xoxe-1-*`, refresh tokens are `xoxe-r-*`.

**App-Level Token** — Described briefly under section 2 but not included in the token-type table. App-Level Tokens (`xapp-*`) are distinct from org tokens; they are used for Socket Mode connections, not workspace API calls. The doc conflates them slightly by saying they "grant workspace-level access across all installed workspaces" — this is incorrect; `xapp-*` tokens are for the app's connections layer (Socket Mode), not for calling workspace methods. Ref: https://docs.slack.dev/authentication/token-types

**OAuth 2.0 flow** — Correctly described for v2. The `authed_user` object in the response also contains `access_token` (user token) when `user_scope` is requested; the doc omits this, which matters if the connector later needs user-context operations.

**Token rotation** — Correct: 12-hour expiry, single-use refresh tokens, `grant_type=refresh_token` against `/api/oauth.v2.access`. One omission: rotating tokens also require storing the new refresh token from the response's `refresh_token` field after each rotation call; the doc does not mention this and it is a critical implementation detail.

**Scopes** — Minimum-sufficient and accurate for the stated MVP. One note: `users:read.email` has been required for all apps since 2017 — the parenthetical date annotation adds no useful information. The scope for listing workspace members via `users.list` is `users:read`, which is listed; confirm that `users:read` also covers `users.list` (it does). Missing scope for slash commands: slash commands do not require an OAuth scope — they are configured in the app manifest and delivered via HTTP POST. This is correct behavior but the scope table does not mention it, which could cause confusion.

**HMAC signing** — Algorithm, header names, base-string format, and 5-minute replay window are all correct. The code example is accurate. One gap: the doc does not mention that the raw body must be preserved before any JSON parsing — middleware that eagerly parses JSON bodies will break verification. This is a common implementation pitfall worth flagging explicitly. Ref: https://docs.slack.dev/authentication/verifying-requests-from-slack

---

## Endpoints

**General note on HTTP methods** — Slack's Web API uses `POST` for nearly all methods (including reads), with `application/json` or `application/x-www-form-urlencoded` bodies, and `Authorization: Bearer` header. The Appendix A table lists `users.info` as `GET /api/users.info` — this is incorrect; `users.info` accepts both GET (with query params) and POST (with body), but the conventional and SDK-default form is POST. The method inconsistency in the appendix should be normalized.

**`auth.test`** — Correct. Returns `user_id`, `bot_id`, `team_id`, `url`. The doc derives `ourBotUserId` from `auth.test().user_id` — accurate.

**`bots.info`** — Correct. Takes `bot` param (bot user ID). Returns `bot.bot_id`.

**`users.info` / `users.list`** — Correct. `users.list` supports cursor pagination (documented in section 9).

**`conversations.list`** — Correct, Tier 2. The `types` parameter (`public_channel`, `private_channel`, `mpim`, `im`) is not mentioned; callers need it to enumerate all channel types the bot has access to.

**`conversations.history`** — Correct. The `oldest` / `latest` / `inclusive` filtering parameters are covered in the polling fallback example. The `has_more` flag for pagination is not mentioned but `response_metadata.next_cursor` is referenced later — adequate.

**`conversations.replies`** — Correctly identified as rate-limited. The two-step fetch pattern (get parent message first, then replies) is not described. Also: `conversations.replies` returns the parent message as the first item in `messages[]`; implementations must skip it. This is a subtle but real gotcha.

**`chat.postMessage`** — Correct. Required fields: `channel` + one of `text`, `blocks`, or `attachments`. The `metadata` field is documented (requires `metadata` bot scope, which is not in the scopes table — gap). The 1 msg/sec per channel limit is correct.

**`chat.update`** — Correct: bot-only restriction noted.

**`chat.delete`** — Correct: bot-only restriction noted.

**`chat.postEphemeral`** — Correct. Note: ephemeral messages cannot be sent in DMs (IM channels); this constraint is not mentioned.

**`conversations.open`** — Correct. `return_im: true` is not a valid param name; the correct param is `return_im` (boolean, no value needed — just `"return_im": true`). The example is fine as shown.

**`reactions.add` / `reactions.remove`** — Correct. The `timestamp` field name in `reactions.add` example matches the API (some SDK versions use `timestamp`, the raw API uses `timestamp`). Fine.

**`files.uploadV2`** — This is significantly underspecified. The v2 upload API is a two-step process:
1. `POST /api/files.getUploadURLExternal` — get a pre-signed upload URL and `file_id`
2. PUT binary content to the pre-signed URL
3. `POST /api/files.completeUploadExternal` — finalize and share to channels

The doc shows a single `POST /api/files.uploadV2` call with `file: <binary>` — this endpoint does not exist in this form. The legacy `files.upload` was deprecated; the new flow is `getUploadURLExternal` + PUT + `completeUploadExternal`. This needs full correction before implementation. Ref: https://docs.slack.dev/reference/methods/files.getUploadURLExternal

**Missing endpoints for SupportAgent completeness**:
- `conversations.join` / `conversations.invite` — required before the bot can post in a channel it was not invited to; not listed.
- `users.lookupByEmail` — useful for identity mapping (email → user ID); not listed.
- `chat.scheduleMessage` (Phase 3 mentions scheduled delivery but no endpoint).

---

## Inbound events

**Event wrapper** — Correct shape. The `authorizations` array (present in newer event payloads for apps with org-level installs) is not mentioned but is not needed for MVP.

**Event types table** — Accurate for the listed events. One gap: `member_joined_channel` and `member_left_channel` are not listed but may be relevant if SupportAgent tracks channel membership. Not a blocker for MVP.

**`message` subtype handling** — The doc notes `message_changed` and `message_deleted` event types. These are actually subtypes delivered inside a `message` event (i.e., `event.type === "message"` and `event.subtype === "message_changed"`), not top-level event names that can be subscribed to separately. The subscription name is `message.channels` (etc.); the subtype filters within that. The table conflates event subscription names with subtype values — should be clarified.

**Retry semantics** — The doc says "return HTTP 2xx within 3 seconds or Slack retries" and "HTTP 409 does not trigger retry." Missing details:
- Slack will retry up to **3 times** with a short backoff (approximately 1 minute between retries).
- Each retry carries the `X-Slack-Retry-Num` header (1, 2, 3) and `X-Slack-Retry-Reason` header.
- Implementations should respond immediately with 200 and process asynchronously (ack-then-process pattern); the doc implies this but does not make it explicit.
- Ref: https://docs.slack.dev/apis/events-api#retries

**Deduplication** — Correctly identifies `event_id`. The retry headers are an additional signal.

**Polling fallback** — The `conversations.history` example is correct. The `oldest` parameter is a Slack timestamp string (float as string, e.g., `"1515449522.000016"`), not a Unix integer — the code passes it as `lastProcessedTimestamp` which is fine if typed correctly. The 1 req/min limit for `conversations.replies` is noted as a critical constraint.

**Mention detection** — The doc correctly identifies `app_mention` event and text scanning for `<@BOT_USER_ID>`. No additional lookup is required beyond what is described.

**Bot-authored content filtering** — The `no_self_retrigger` pattern is correct: check `event.bot_id === ourBotId` OR `event.user === ourBotUserId`. One edge case not mentioned: messages from other bots (not ours) will also have a `bot_id` field; whether to process them or skip is a policy decision the doc does not address.

**Loop prevention** — The delivery marker pattern (storing `response.ts`) is good but the doc does not describe how to use it to detect our own re-delivered events in the webhook path. The `bot_id` check is sufficient for that purpose, but the two approaches should be presented as complementary rather than as a single block.

---

## Hosting variants

**Cloud only** — Correctly stated. Slack has no self-hosted equivalent.

**Enterprise Grid** — The doc correctly identifies org-token prefix (`xoxe-`) and the need for org-wide app deployment. Gaps:
- Enterprise Grid org tokens require the app to be distributed as an "org-wide app" in the admin console; normal workspace installs do not yield org tokens.
- The `admin.*` family of API methods (for org admins) requires `admin:*` scopes that are gated behind Slack's Enterprise Grid plan and a separate approval process. These are not needed for MVP but should be noted as gated.
- `team_id` in event payloads identifies the workspace within a Grid org; `enterprise_id` identifies the org. The doc mentions `team_id` for fan-out but does not mention `enterprise_id`.

**API versioning** — Slack does not use URL-based versioning (no `/v1/`, `/v2/`). All methods are at `/api/<method>` with no version segment. The doc implicitly reflects this but never states it, which could confuse developers coming from other platforms. Worth one sentence.

**Deprecations** — `files.upload` (legacy) is deprecated in favor of the new upload flow. The doc uses `files.uploadV2` as the endpoint name but this is not the actual endpoint (see Endpoints section). The actual replacement endpoints are `files.getUploadURLExternal` and `files.completeUploadExternal`.

**Regional / data residency** — Slack offers data residency in the EU and Japan for Enterprise Grid customers. These workspaces use different base URLs (`https://eu.slack.com/api/*` or `https://jp.slack.com/api/*` for some methods). The doc does not mention this. For a multi-tenant SupportAgent deployment, the base URL must be configurable per workspace. Ref: https://slack.com/intl/en-gb/help/articles/360001138727

**Socket Mode** — Not mentioned. Socket Mode is an alternative to HTTP webhooks that uses a WebSocket connection — useful for development behind firewalls or for apps that cannot expose a public endpoint. For production it is less common, but the doc should mention it exists as an alternative. The `xapp-*` token used for Socket Mode is already mentioned in the token section but not connected to this use case.

---

## Rate limits & pagination

**Tier system** — The doc shows only Tier 2 and Tier 3. Slack's full tier list:
- Tier 1: 1+ req/min (very restricted, e.g., `admin.*` methods)
- Tier 2: 20+ req/min
- Tier 3: 50+ req/min
- Tier 4: 100+ req/min (e.g., `chat.postMessage` per-workspace, not per-channel)
- Special: method-specific (e.g., `chat.postMessage` 1/sec/channel, `conversations.replies` 1/min for non-Marketplace)

The doc's tier table omitting Tier 1 and Tier 4 is an incomplete characterization. Several Appendix A entries are miscategorized: `auth.test` is Tier 3 (correct), `conversations.list` is Tier 2 (correct), `conversations.history` is Tier 3 (correct), `users.info` is Tier 4 (not Tier 3 as listed). Ref: https://docs.slack.dev/apis/web-api/rate-limits

**Rate limit response** — The doc shows the JSON body with `retry_after`. Slack also sends a `Retry-After` header (integer seconds). The SDK handles this automatically; raw-fetch implementations must check both.

**429 vs 403** — Rate limit responses are always HTTP 429 for Slack. The 403 is used for auth/permission failures. The doc does not describe the error shape for 403 (which is `{ "ok": false, "error": "missing_scope" }` or `"not_authed"` etc.) — worth noting for error handling.

**Retry-After** — `retry_after` in the body gives seconds to wait. The doc's rate-limit section shows the body but does not give backoff guidance beyond this. Recommended: honor `Retry-After`, then apply jitter for subsequent retries.

**Pagination** — Cursor-based pagination is correctly described. The `response_metadata.next_cursor` field is the right mechanism. The max page sizes table is correct: 1000 for `conversations.list`, 999 for `conversations.history` (not 1000 — Slack's actual max is 999 for history, the doc has this right), 200 for `users.list`.

**Bulk / batch** — Slack has no batch endpoint. The doc is silent on this, which is correct: there is nothing to document.

**Concurrency** — No explicit concurrency limit is documented by Slack beyond the per-method rate limits. The doc is silent on this — acceptable.

**Error response shape** — The doc shows one error shape (`ratelimited`). The general Slack error envelope is `{ "ok": false, "error": "<error_code>" }`. Common errors worth characterizing for the connector: `channel_not_found`, `not_in_channel`, `msg_too_long`, `no_text`, `restricted_action`, `missing_scope`. The doc does not enumerate these — a gap for implementation but not a correctness error.

---

## SDK & implementation path

**npm packages** — All three packages exist and are actively maintained:
- `@slack/web-api`: https://www.npmjs.com/package/@slack/web-api (correct)
- `@slack/bolt`: https://www.npmjs.com/package/@slack/bolt (correct)
- `@slack/oauth`: https://www.npmjs.com/package/@slack/oauth (correct)

**SDK capabilities** — `@slack/web-api` provides full TypeScript types, auto-pagination via `paginate()` method, and built-in retry with `retryConfig`. `@slack/bolt` includes signature verification middleware, Events API routing, slash command routing, and OAuth installation flow. These capabilities are correctly characterized.

**`@slack/bolt` recommendation** — Sound for webhook-receiving components. The code example is correct. One note: `bolt` adds significant framework weight; if SupportAgent uses its own HTTP server (e.g., Fastify/Express), the `@slack/web-api` + manual signature verification pattern is lighter. The doc recommends bolt for the webhook server and raw fetch for outbound workers — this split is coherent.

**`files.uploadV2` in SDK** — The `@slack/web-api` SDK's `files.uploadV2()` method wraps the new two-step upload flow internally. So calling `client.files.uploadV2(...)` in the SDK is valid and handles the pre-signed URL steps automatically. However, the doc's raw example showing `POST /api/files.uploadV2` with a file body is wrong for direct HTTP — this distinction between SDK usage and raw HTTP must be clarified.

**MVP ordering** — Realistic. `auth.test` + `bots.info` at startup for identity resolution, then message sending, then event subscription, then reactions and file upload — sensible progression.

**Phase 2 / Phase 3** — Reasonable. Modal/Home tab in Phase 2 is appropriate (requires `views.*` methods and block kit familiarity). Slack Connect (multi-workspace) in Phase 3 is appropriate given OAuth complexity.

**Config fields** — The `SlackConnectorConfig` interface is clean and sufficient for MVP. One addition worth considering: `appToken?: string` for Socket Mode support in dev environments. The `mentionStyle: 'require' | 'allow'` field is a useful operational control.

**Open questions** — All 8 questions are well-scoped. Question 5 (`conversations.replies` limit) correctly identifies the caching mitigation. Question 8 (single endpoint, fan-out by `team_id`) is the correct multi-tenant architecture.

---

## Priority fixes

1. **`files.uploadV2` endpoint** (critical): The raw HTTP example is wrong — no single `POST /api/files.uploadV2` endpoint exists. Document the correct three-step flow (`getUploadURLExternal` → PUT → `completeUploadExternal`) for raw HTTP; note the SDK's `files.uploadV2()` wraps this transparently. Ref: https://docs.slack.dev/reference/methods/files.getUploadURLExternal

2. **Token rotation refresh-token persistence** (critical for correctness): Add explicit note that after each rotation call, the response `refresh_token` must be stored — it replaces the previous single-use refresh token.

3. **`message_changed` / `message_deleted` as subtypes, not event names** (moderate): These are `subtype` values within `message.*` events, not separately subscribable event types. Fix the events table to show the subscription name and the subtype value distinctly.

4. **Rate tier table** (moderate): Add Tier 1 and Tier 4. Correct `users.info` from Tier 3 to Tier 4. Cite the official rate-limits page.

5. **Regional base URLs for Enterprise Grid data residency** (moderate): Add note that EU/JP data-residency workspaces use `https://eu.slack.com/api/*` and `https://jp.slack.com/api/*`. Make the base URL configurable in `SlackConnectorConfig`.

6. **Raw body preservation for HMAC** (moderate): Add a callout that Express/Fastify body-parser middleware must be configured to preserve the raw body buffer; JSON-parsed bodies will fail signature verification.

7. **Retry headers** (low): Document `X-Slack-Retry-Num` and `X-Slack-Retry-Reason` headers sent on retried event deliveries. Note the ~3 retry maximum with ~1 minute backoff.

8. **`conversations.replies` first-item skip** (low): Add note that the parent message is included as the first item in `messages[]`; implementations must skip index 0 or filter by `ts !== thread_ts`.

9. **`chat.postEphemeral` DM restriction** (low): Note that ephemeral messages cannot be sent in IM channels.

10. **App-Level Token (`xapp-*`) clarification** (low): Separate the Socket Mode use case from org tokens in the token-type table; currently the `xapp-*` mention is accurate but contextually confusing next to Enterprise org tokens.
