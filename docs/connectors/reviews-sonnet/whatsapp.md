# WhatsApp combined review

## Verdict

The document is broadly accurate and well-structured, covering the most important operational realities of the WhatsApp Business Cloud API. The biggest factual errors are in the webhook signature section (the doc simultaneously claims ECDSA and then implements HMAC-SHA256, while the real mechanism is HMAC-SHA256 only — ECDSA is not used here), and in the token lifecycle section (System User tokens do not auto-refresh; they are non-expiring as long as the user and app remain active, not 60-day tokens). The rate-limit tier table contains numbers that do not match current Meta documentation. Several third-party npm packages listed either do not exist or contain garbled names. The SDK section needs a clean correction. Loop-prevention logic contains a subtle inversion that would cause self-sent messages to be processed rather than suppressed. Overall confidence: medium-high on structure and coverage, medium on numerical accuracy.

---

## Authentication

**Token type and creation (§2.1)**
Correct that a System User Access Token is the right mechanism for a server-side connector. The endpoint shown for exchanging a short-lived token:
```
POST https://graph.facebook.com/v21.0/oauth/access_token
grant_type=fb_exchange_token&...
```
is accurate for the Graph API token exchange flow.

**Token lifetime (§2.2)**
The doc states System User tokens last "~60 days with automatic refresh." This is wrong in two ways:
- System User Access Tokens are **non-expiring** as long as the system user is active and the app remains in a published or development state. They do not have a 60-day window.
- There is no automatic refresh. If the token is invalidated (user deleted, app unpublished, password rotated), a new token must be manually generated in Meta Business Manager.
- The "~60 days" figure applies to long-lived User Access Tokens generated via `fb_exchange_token` for human users, not System Users.
- Source: https://developers.facebook.com/docs/whatsapp/business-management-api/get-started#system-user-access-tokens

**Required permissions (§2.3)**
The three listed permissions (`whatsapp_business_management`, `whatsapp_business_messaging`, `business_management`) are correct and minimum-sufficient for the described operations.

**Webhook verification GET flow (§2.4)**
Accurate. The hub-challenge handshake is correct.

**Webhook signature (§2.5) — critical error**
Section 2.5 header claims ECDSA (P-256), then the implementation uses `crypto.createHmac('sha256', appSecret)`. These are contradictory. The actual mechanism is **HMAC-SHA256** with the app secret as the key. Meta does not use ECDSA for webhook signing; the `X-Hub-SHA256` header contains an HMAC-SHA256 hex digest prefixed with `sha256=` (e.g., `sha256=abcdef...`). The implementation code in §2.5 is functionally correct (HMAC-SHA256) but the description and §10.13 repeat the ECDSA claim. The description must be corrected — ECDSA is never used.

The code also omits the `sha256=` prefix strip: the header value is `sha256={hex}`, not just `{hex}`. The comparison will always fail without stripping the prefix:
```javascript
const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(body).digest('hex');
```
Source: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#event-notifications

**Self-hosted vs cloud auth**
Correctly notes that on-premises is sunset. No auth differences to flag.

---

## Endpoints

**Send message (§4.1, §4.2)**
The send endpoint `POST /v21.0/{Phone-Number-ID}/messages` is correct. Request and response bodies are accurate. The v21.0 version prefix is omitted from the MVP table in §11 — all paths should include the version prefix or document that the base URL handles it.

**Interactive buttons (§4.3)**
Body structure is correct. The 3-button maximum is accurately documented in §10.11.

**Interactive list (§4.4)**
Body structure is correct.

**Media send (§4.5)**
Correct. Both link-based and media-ID-based sending are documented.

**Mark as read (§4.6)**
The endpoint is not shown explicitly — the doc puts all operations through `POST /{Phone-Number-ID}/messages` without distinguishing that mark-read uses the same path. This is correct behavior but the MVP table (§11) listing the same path for eight distinct operations is opaque. A comment or discriminator column would help implementers.

**Reply threading (§4.7)**
The `context.message_id` field is correct.

**Delete (§4.8)**
Correct that delete uses `type: "delete"`. The 15-minute window is accurate.

**Reaction send (§4.9)**
The body structure is missing the required top-level wrapper fields (`messaging_product`, `to`, etc.). The snippet as written would be rejected. It should be:
```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "15559876543",
  "type": "reaction",
  "reaction": {
    "message_id": "wamid.target-message-id",
    "emoji": "👍"
  }
}
```

**Upload media (§4.10)**
The multipart form field name is not `file` — it is `file` for the binary but the form must also include `type` (MIME type) and `messaging_product=whatsapp`. The minimal correct form:
```
file=@screenshot.png; type=image/png
type=image/png
messaging_product=whatsapp
```
Source: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#upload-media

**Template management**
The MVP table lists `GET /{Phone-Number-ID}/message_templates` and `POST /{Phone-Number-ID}/message_templates`. The correct path is under the WABA, not the phone number:
- List: `GET /v21.0/{WABA-ID}/message_templates`
- Create: `POST /v21.0/{WABA-ID}/message_templates`
Source: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates

**Read single message (§9.3)**
The path `GET /v21.0/{message-id}?phone_number_id={phone-number-id}` is an approximation. In practice this is a Graph API node lookup: `GET /v21.0/{wamid}` which requires the token to have access to the WABA that owns the message. The `phone_number_id` query param is not a documented parameter on this endpoint.

**Missing endpoints**
The doc does not cover:
- `GET /v21.0/{Phone-Number-ID}` — retrieve phone number details (needed to verify registration status)
- `POST /v21.0/{WABA-ID}/subscribed_apps` — subscribe app to WABA webhooks programmatically
- `DELETE /v21.0/{media-id}` — delete uploaded media
- `GET /v21.0/{media-id}` — retrieve media URL for download (required to fetch inbound media before the URL expires)

The absence of the media retrieval endpoint is a significant gap: inbound media (images, documents) arrives as a media ID, not a URL. The connector must call `GET /v21.0/{media-id}` to get a temporary download URL, then download the file, before the media ID expires (~30 days but the URL is short-lived).

---

## Inbound events

**Event subscription fields (§3.1)**
The listed fields (`messages`, `message_deliveries`, `message_reads`, `message_reactions`, `conversations`) are all real webhook subscription fields and the descriptions are accurate.

**Payload shape (§3.2)**
The top-level envelope is accurate. The nested path `entry[0].changes[0].value.messages[0]` is the correct access pattern. The example payloads for text, image, document, and location types are all correct and representative.

**Retry semantics (§3.3)**
"Up to 7 times with exponential backoff" — Meta's documentation states retries occur but does not publish a fixed retry count of exactly 7. The 20-second response timeout is accurate. The "no replay" statement is accurate and important.

**Polling fallback (§3.4)**
The doc correctly states there is no cursor-based polling. The "Read Messages endpoint" link and the suggestion to use `POST /messages` with `action=mark_read` are accurate. However, the claim that you can "request messages from a specific message.id" is misleading — there is no list-messages-since-id endpoint. The correct fallback is: rely entirely on webhook delivery, store checkpoint per conversation, and accept that missed events during downtime cannot be recovered from the API.

**Mention detection**
Not applicable to WhatsApp (1:1 messaging only, no @mentions). Not a gap.

**Bot-authored content filtering / loop prevention (§7.3)**
The logic described has a critical inversion:

The doc says:
- If `message.id` ∈ `outbound_message_ids` → skip

This is backwards. When you send a message, Meta returns the `wamid` in the send response. WhatsApp does NOT echo your own sent messages back to your webhook as inbound `messages` events. What does come back is a status update in the `statuses` array (not `messages` array), containing the `id` of your sent message. The current logic would never match because sent wamids do not appear in `messages[*].id` of inbound webhooks.

The correct loop prevention is: check if the inbound webhook object contains `statuses` (delivery/read receipts for your outbound messages) rather than `messages`, and skip those. Inbound `messages` are always from the customer.

The `context.id` check (§7.3 second bullet) is correct: a customer replying to your message will have `context.id` = your wamid, and that should be processed normally.

**Signature verification header**
As noted in Authentication, the `X-Hub-SHA256` value includes a `sha256=` prefix that must be stripped before comparison.

---

## Hosting variants

**Cloud-only (§1, §10.1)**
Correct. On-Premises API sunset date of October 23, 2025 is accurate.

**No self-hosted variant**
Correct and clearly stated. The connector is permanently dependent on Meta's infrastructure.

**API versioning**
The doc uses v21.0 throughout. As of April 2026, Meta's Graph API is at v22.0. v21.0 remains supported (Meta supports API versions for approximately 2 years) but the connector should target the current stable version or implement version configuration. Meta's versioning schedule: https://developers.facebook.com/docs/graph-api/changelog/

**Regional/data residency**
Not covered. WhatsApp Cloud API data residency options (EU storage, other regions) are available for enterprise WABAs. This is an operational gap for GDPR-compliant deployments and should be flagged in the open questions section, not silently omitted.

**Enterprise tiers**
The doc mentions "Enterprise" in the rate-limit table but does not document the enterprise-tier feature differences (e.g., higher message limits, data residency, group chat access). §10.14 mentions limited group support for "specific enterprise tiers" but does not characterize the tier or access path.

**Breaking changes between API versions**
Not covered. There are no current breaking changes between v21.0 and v22.0 that affect the endpoints documented here, but the lack of a versioning strategy in the connector design is a gap.

---

## Rate limits & pagination

**Rate-limit tier table (§8.1) — inaccurate numbers**
The table presents tiers as "Unverified WABA," "Verified WABA," "High quality," "Enterprise" with specific msg/sec and monthly limits. Meta's actual tier model is different:

- Meta uses a **messaging limit tier** system with tiers: 1K, 10K, 100K, unlimited (per 24 hours, not per month).
- The tier you start at depends on verification status, not a simple verified/unverified binary.
- The per-second throughput (80/250/1000 msg/sec) values are not documented in Meta's current published rate-limit documentation in this form.
- The "250/month" and "1,000/month" monthly limits are outdated — Meta moved to 24-hour rolling windows, not monthly limits.

Source: https://developers.facebook.com/docs/whatsapp/messaging-limits

**Per-conversation limits (§8.2)**
"15 messages/minute per conversation" — this specific limit is not in current Meta documentation. Meta does not publish per-conversation per-minute limits publicly. This number may be from an older version of the docs or an unofficial source. Flag as unverified.

**Rate-limit response format (§8.3)**
The error body with code `131030` is accurate. The absence of a `Retry-After` header is accurate. The exponential backoff recommendation (1s → 30s) is sensible.

**Template message limits (§8.4)**
The category descriptions (marketing/utility/authentication) and their relative frequency allowances are accurate. The "1 contact per day per template" for marketing is a simplification — the actual rule is around the conversation-based pricing model and opt-in requirements, not a simple 1-per-day cap per template.

**Bulk/batch**
Correctly states no batch endpoint exists.

**Error response shape**
The error structure in §8.3 is correct. Appendix B error codes are accurate for the codes listed, though the list is incomplete (missing 131047 for expired message, 131051 for unsupported message type, among others).

**Pagination**
The "no cursor-based pagination" statement is accurate for the messages domain. However, the template list endpoint (`GET /{WABA-ID}/message_templates`) does support cursor-based pagination via `after`/`before` cursors in the standard Graph API `paging` envelope. This is not documented.

---

## SDK & implementation path

**npm packages (§12.1) — partially invalid**
The table lists:
- `whatsapp-api-js` — this package exists on npm and is a legitimate community wrapper.
- `` `@抽離/whatsapp-webhook` `` — this is a garbled/invalid package name containing Chinese characters. It does not exist on npm. Remove.
- `fb-sdk` — this package name does not correspond to Meta's official SDK. Meta's official JavaScript SDK is `facebook-nodejs-business-sdk` (for Business API operations). Remove or correct.

In §12.4, `` `@抽離/whatsapp-upload` `` is also garbled and should be removed.

**Raw fetch recommendation (§12.2)**
Correct and appropriate. The rationale is sound.

**No CLI equivalent (§12.3)**
Accurate.

**MVP/Phase 2/Phase 3 ordering (§11)**
The phasing is sensible. Template management in Phase 2 is appropriate. One concern: the MVP includes `POST /{Phone-Number-ID}/message_templates` (create template) but template creation requires WABA-level access and the correct path is under the WABA ID, not the phone number ID (see Endpoints section above). If the MVP does not include a template management UI, the create-template endpoint could move to Phase 2.

**Config field list (§11 MVP)**
The config fields listed are accurate and sufficient:
- `wabaId`, `phoneNumberId`, `appId`, `appSecret`, `systemUserAccessToken`, `webhookVerifyToken`, `webhookUrl`

The inclusion of `outboundMessageIds: Set<string>` as a config field is architecturally wrong — this is runtime state, not configuration. It belongs in the database or in-memory store, not the connector config schema.

**Open questions (§13)**
The open questions are well-chosen and raise the right operational blockers. §13.8 (self-hosting limitation) correctly identifies that the connector always depends on Meta's cloud. §13.5 (media storage strategy) is important and correctly flagged — inbound media URLs from the download API are temporary and media must be fetched and stored promptly.

Missing open question: what is the fallback behavior when a customer messages outside the 24-hour window and no approved template exists? This is a real launch blocker that should be in the open questions.

---

## Priority fixes

1. **Webhook signature description (§2.5, §10.13):** Remove all ECDSA references. Correct to HMAC-SHA256 only. Add the `sha256=` prefix strip to the verification code. This is a security-critical correctness bug.

2. **System User token lifetime (§2.2):** Remove the "~60 days with automatic refresh" claim. Replace with: non-expiring while the system user is active; no automatic refresh; must be regenerated manually if invalidated.

3. **Rate-limit tier table (§8.1):** Replace the fabricated monthly limits and per-second tiers with the actual Meta messaging limit tier model (1K/10K/100K/Unlimited per 24 hours). Remove the per-conversation 15 msg/min figure or mark it as unverified.

4. **Template endpoint paths (§11 MVP table):** Change template list and create paths from `/{Phone-Number-ID}/message_templates` to `/{WABA-ID}/message_templates`.

5. **Loop prevention inversion (§7.3):** Correct the logic: inbound `messages` events are always from the customer and do not include your own sent messages. Outbound echoes appear in `statuses`, not `messages`. Remove the `message.id ∈ outbound_message_ids` check or reframe it correctly.

6. **Reaction send body (§4.9):** Add the required top-level envelope fields (`messaging_product`, `recipient_type`, `to`) to the reaction send example.

7. **Media upload form fields (§4.10):** Add `messaging_product=whatsapp` and `type={mime-type}` to the multipart upload example.

8. **Invalid npm package names (§12.1, §12.4):** Remove `@抽離/whatsapp-webhook`, `fb-sdk`, and `@抽離/whatsapp-upload`. These do not exist. Replace `fb-sdk` reference with `facebook-nodejs-business-sdk` if Graph API access is needed.

9. **Missing media retrieval endpoint:** Document `GET /v21.0/{media-id}` as required for inbound media handling. Without it, inbound image and document messages cannot be processed. This should be in the MVP endpoint table.

10. **`outboundMessageIds` as config field (§11):** Move this to runtime state documentation. It is not a connector configuration parameter.

11. **API version currency:** Note that v22.0 is current as of early 2026 and add a recommendation to make the API version configurable rather than hardcoded to v21.0.

12. **Data residency gap:** Add an open question about EU/regional data residency for GDPR-relevant deployments.

13. **Template pagination:** Document that the template list endpoint supports cursor pagination via the standard Graph API `paging` envelope.
