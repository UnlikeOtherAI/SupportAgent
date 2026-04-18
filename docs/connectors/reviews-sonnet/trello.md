# Trello combined review

## Verdict

The Trello connector doc is thorough and largely accurate for a cloud-only REST API. Authentication, endpoint shapes, webhook mechanics, and rate limit numbers are mostly correct. The biggest gaps are: the HMAC signing formula uses `appSecret` but the Trello API key model does not have a separate "app secret" — the signing key is the API key's secret, which needs clarification; the edit-comment claim is partially wrong (there is a `PUT /1/actions/{id}` endpoint for updating a `commentCard` action); the file attachment constraint (4 attachments/card) is not documented by Trello and is likely incorrect; the OAuth2 scope names in 2.2 are speculative; and the `since` cursor strategy for polling is correct but the doc omits the `before` + action-ID cursor approach that avoids timestamp collisions. Confidence in the overall shape is high; specific field-level or constraint-level details need spot verification against the live reference.

---

## Authentication

**What the doc says:**
- API key + token via query params (`?key=&token=`), or OAuth header.
- Three token generation paths: manual, OAuth1 3LO, OAuth2 3LO.
- Scopes: `read`, `write`, `account`.
- Token expiry options: `1hour`, `1day`, `30days`, `never`.
- OAuth2 3LO scopes: `data:read`, `data:write`, `action:read`, `action:write`, `account:read`.
- Forge/OAuth2 apps cannot access `/webhooks/` or `/batch`.

**What is true / gaps:**

1. **HMAC signing key is misnamed.** Section 3.1 says `base64(HMAC-SHA1(appSecret, ...))`. Trello's webhook verification uses the API key's *secret* (the "OAuth Secret" shown on the app-key page, distinct from the API key itself). The variable name `appSecret` is ambiguous — the doc should clearly label this as the "OAuth Secret" (also called `clientSecret` in some Atlassian docs), not the API key or the user token. Reference: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/#triggering-webhooks

2. **OAuth2 scope names are unverified.** `data:read`, `data:write`, `action:read`, `action:write` look plausible for Atlassian's newer scopes but are not confirmed in the public Trello REST docs as of early 2026. The OAuth1 scopes (`read`, `write`, `account`) are accurate and well-documented. The doc correctly notes this is "still transitioning."

3. **Token expiry options are accurate.** `1hour`, `1day`, `30days`, `never` are all valid values passed in the `expiration` param during the OAuth1 authorize redirect.

4. **No mention of token revocation.** The doc covers expiry but does not explain how to programmatically revoke a token (`DELETE /1/tokens/{token}`). Important for tenant offboarding.

5. **`account` scope and email availability.** Section 2.3 and 7.2 correctly note that email requires `account` scope and user consent. Accurate.

6. **No self-hosted auth differences.** Correctly noted — there are none, since Trello is cloud-only.

**Fixes needed:**
- Rename `appSecret` → `oauthSecret` (or "OAuth Secret / client secret from app-key page") in section 3.1.
- Add `DELETE /1/tokens/{token}` for revocation.
- Mark OAuth2 scope names as tentative/unverified.

---

## Endpoints

**What the doc says:**
- Full CRUD on cards, comments, labels, members, webhooks via standard REST paths.
- Edit comment: "no PUT endpoint" — workaround is delete + recreate.
- Add label to card: `POST /1/cards/{cardId}/labels` with `color` and/or `name`.
- Attach file: max 10 MB, max 4 attachments per card.
- Custom field update: `PUT /1/cards/{cardId}/customField/{customFieldId}/item`.

**What is true / gaps:**

1. **Edit comment endpoint exists.** The doc (section 4.3) claims there is no edit endpoint. This is wrong. Trello does expose `PUT /1/actions/{actionId}` to update the `text` of a `commentCard` action. Reference: https://developer.atlassian.com/cloud/trello/rest/api-group-actions/#api-actions-id-put — only the action author can edit. The doc should replace the delete+recreate workaround with this endpoint.

2. **Add label to card — field confusion.** `POST /1/cards/{cardId}/labels` expects `value` (a label ID), not `color` + `name`. The endpoint for adding an existing label to a card takes `value={labelId}`. The `color` + `name` form is for `POST /1/labels` (create a board label) or for creating a new label directly on the card in older API behavior. Verify against: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/#api-cards-id-labels-post

3. **4 attachments per card limit is not documented.** The official Trello REST docs do not state a 4-attachment cap. The 10 MB per-file limit is documented. The "4 attachments" figure appears to be incorrect or conflated with something else. Remove or verify with a source.

4. **Custom field update path.** The path `PUT /1/cards/{cardId}/customField/{customFieldId}/item` is correct. The `value` body field must be a JSON object keyed by type (e.g., `{"text": "foo"}` or `{"number": "5"}` — note number is a string). The doc shows this correctly.

5. **`GET /1/cards/{cardId}?customFieldItems=true`** — correct.

6. **Delete webhook path.** `DELETE /1/webhooks/{id}` is correct (no trailing slash needed, though the doc includes one inconsistently).

7. **`POST /1/cards/{cardId}/members` uses `value` param.** The doc says `&value={memberId}` — this is correct.

8. **`POST /1/cards` — query params vs body.** Trello accepts `POST /1/cards` with fields as either query params or JSON body. The doc uses query params, which works but sending a JSON body is cleaner for complex payloads. Not wrong, just worth noting for implementation.

9. **`moveCardToList` is not a separate action type.** In the webhook payload, moving a card to a list fires an `updateCard` action with `data.listAfter` and `data.listBefore`, not a distinct `moveCardToList` type. Section 3.2 lists it as a separate event name, and section 6 trigger table also lists it. This needs correction — the trigger should match `action.type === "updateCard"` and check for `action.data.listAfter` presence. Reference: https://developer.atlassian.com/cloud/trello/guides/rest-api/action-types/

**Fixes needed (ranked):**
1. Correct `moveCardToList` — it is `updateCard` with `data.listAfter`, not a separate type.
2. Replace comment edit workaround with `PUT /1/actions/{actionId}`.
3. Fix `POST /1/cards/{cardId}/labels` field: `value={labelId}`, not `color`+`name`.
4. Remove or source the 4-attachments-per-card limit.

---

## Inbound events

**What the doc says:**
- Webhooks registered on `POST /1/tokens/{token}/webhooks/`.
- HMAC: `base64(HMAC-SHA1(appSecret, JSON.stringify(body) + callbackURL))`, header `X-Trello-Webhook`.
- Retries: 3x at 30s/60s/120s; auto-disable after 30 consecutive failures.
- Polling: `GET /1/boards/{boardId}/actions` with `since` + `page`/`limit`.
- Bot loop prevention via `action.idMemberCreator`.
- Lists 13 event types including `moveCardToList`.

**What is true / gaps:**

1. **`moveCardToList` action type does not exist** (see Endpoints section). This affects both the event table in 3.2 and the trigger table in section 6. The correct detection is `updateCard` + `data.listAfter` set.

2. **HMAC bytes signed.** The doc says `JSON.stringify(body) + callbackURL`. The actual Trello signature is computed over the raw request body bytes concatenated with the callback URL string, not over `JSON.stringify(body)`. In JavaScript, if the body is already a string (raw), use it directly; don't re-serialize. This distinction matters for servers that parse and re-serialize JSON. Reference: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/#triggering-webhooks

3. **Signing key.** As noted in Authentication, the key is the OAuth Secret, not `appSecret`. The HMAC formula must use the correct key label.

4. **Replay protection.** The doc does not mention replay protection. Trello webhooks do not include a timestamp or nonce in the signature, so replay protection must be implemented at the application layer (e.g., deduplicate by `action.id`). This is a gap — the doc should note that Trello provides no built-in replay window.

5. **Delivery guarantees.** The doc says "3 retries: 30s, 60s, 120s" and "disabled after 30 consecutive failures." The 30s/60s/120s retry cadence is consistent with published guidance. The "30 consecutive failures" figure matches community-confirmed behavior (not 1000 as the doc notes in the inline correction — good that it's flagged). At-least-once delivery is implied; the doc should state idempotency is required.

6. **Polling `since` cursor.** Using an ISO8601 timestamp as the cursor is correct but has a collision window if multiple actions share the same millisecond. The doc should recommend storing the last `action.id` as a secondary cursor and using `before={actionId}` to page backward, or `since={actionId}` (Trello accepts action IDs in `since`/`before`, not just timestamps).

7. **`removeLabelToCard` typo.** Section 6 trigger table has `removeLabelToCard` — should be `removeLabelFromCard`.

8. **Mention detection.** Section 7.3 covers bot mention detection via `action.data.text` contains `@{botUsername}`. Accurate. The doc notes no webhook-specific mention event exists — correct.

9. **New comment detection on polling.** The doc correctly uses `commentCard` filter in the actions query. Adequate.

**Fixes needed:**
1. Replace `moveCardToList` event with `updateCard` + `data.listAfter` check.
2. Clarify HMAC bytes: raw request body string, not re-serialized JSON.
3. Rename signing key from `appSecret` to `oauthSecret`.
4. Add replay protection note: deduplicate by `action.id`.
5. Fix `removeLabelToCard` typo → `removeLabelFromCard`.
6. Note at-least-once delivery; advise idempotency by `action.id`.

---

## Hosting variants

**What the doc says:**
- Cloud-only. No self-hosted or Data Center variant.
- Enterprise workspaces use Atlassian Enterprise accounts but hit the same API.
- Base URL: `https://api.trello.com/1`.

**What is true / gaps:**

1. **Correct — Trello is cloud-only.** There is no Trello Data Center or self-hosted edition. This is accurate.

2. **API version.** Trello's API is versioned as `/1` and has not changed major versions. There is no `/2` or versioned migration path announced as of early 2026. Correct.

3. **Enterprise vs standard API.** The doc notes enterprise uses same API. Accurate for the connector's purposes. Enterprise-specific endpoints (`GET /1/enterprises/{id}/members` etc.) are noted in Phase 2. Correct.

4. **SCIM deprecation.** Section 10.9 correctly notes SCIM deprecated Dec 10, 2025. This is accurate based on Atlassian's deprecation notice.

5. **Regional/data-residency variants.** Trello does not offer data-residency or regional hosting (unlike Jira Cloud). The doc is silent on this — correct to omit.

6. **No breaking API version changes.** No v2 migration known. The deprecations noted (SCIM, label names endpoint, member privacy endpoint) are additive deprecations of specific endpoints, not version-level breaks. Well documented.

7. **Feature matrix gaps.** The doc mentions custom fields require a Power-Up but does not clarify that on Trello Free plans, the number of Power-Ups is limited (1 Power-Up on Free as of 2023, though this changed). For paid plans (Standard, Premium, Enterprise), custom fields are available without the Power-Up restriction. This is worth a note to avoid confusion when tenants on Free tiers cannot use custom field-based priority.

**Fixes needed:**
- Add a note on Trello plan tiers (Free vs Standard/Premium/Enterprise) and their effect on custom field availability.

---

## Rate limits & pagination

**What the doc says:**
- 200 req/s burst, 100 req/token/10s, 300 req/key/10s.
- Batch: 10 URLs.
- No rate limit headers — use fixed delays (100ms writes, 50ms reads).
- Pagination: `page` (0-indexed) + `limit`; actions max 1000.
- `since` / `before` for timestamp filtering.
- No bulk/batch write endpoint.

**What is true / gaps:**

1. **Rate limit numbers.** The stated limits (100/token/10s, 300/key/10s, 200/s burst) align with Trello's published guidance. However, Trello's official docs state "approximately 300 per 10 seconds per API key and 100 per 10 seconds per token" — the "200/s burst" figure is less clearly documented and may refer to an older threshold. Low risk but worth noting as approximate.

2. **No rate limit headers — correct.** Trello does not return `X-RateLimit-*` headers. On 429, the response body may contain an error message. The doc correctly notes this.

3. **429 response.** The doc does not describe the 429 response shape. Trello returns HTTP 429 with a plain-text or JSON body like `{"message":"API rate limit exceeded"}`. The implementation should handle both.

4. **Pagination — `page` + `limit` for actions.** Correct. Max `limit=1000` for actions. Cards on a board do not use pagination (returns all); the doc notes this as "no pagination param — returns all open cards." This is approximately correct but very large boards may be truncated at 1000 cards (unconfirmed). The doc should add a caveat.

5. **`since` accepts action IDs, not just timestamps.** As noted above, this is a useful pagination technique for reliable cursor-based polling that the doc omits.

6. **No bulk write endpoints.** Correct — Trello has no batch write API. The `GET /1/batch` endpoint is read-only (multiple GET requests batched).

7. **Concurrency.** The doc recommends fixed delays (100ms/50ms) but does not mention concurrency limits. For multi-tenant scenarios, queuing writes per-token to avoid bursting is advised. The doc touches on this with "no cross-tenant rate limit sharing" but doesn't prescribe a concurrency cap per tenant.

8. **Error shape.** The doc characterizes errors minimally. Trello errors are typically `{"message": "..."}` with standard HTTP status codes. 401 for bad key/token, 404 for missing resource, 403 for permission denied. The doc should include a brief error shape summary.

**Fixes needed:**
- Document 429 response shape.
- Add brief error shape summary (401/403/404 patterns).
- Note action ID as valid cursor value for `since`/`before`.
- Add caveat on large-board card pagination.

---

## SDK & implementation path

**What the doc says:**
- No official Atlassian SDK for Trello.
- Third-party: `trello`, `trello-api-client`.
- Recommendation: raw `fetch` with typed helpers.
- Structure: `trelloFetch.ts`, typed functions per resource group, Zod schemas.
- No CLI equivalent.
- MVP config: 8 fields including `apiKey`, `apiToken`, `boardIds`, mappings, `botUsername`, `webhookCallbackUrl`, `enabled`.
- Phase 2: custom fields, checklists, attachments, batch, search, org endpoints.
- Phase 3: board templates, Butler automation, Power-Up capabilities.

**What is true / gaps:**

1. **`trello` npm package.** The `trello` package (https://www.npmjs.com/package/trello) exists but is minimally maintained (last publish ~2019). It is effectively abandoned. The `trello-api-client` package has very low download counts and is not well-maintained either. The doc's recommendation to use raw `fetch` is correct — these SDKs add no meaningful value.

2. **Raw fetch recommendation is coherent.** Trello's API is simple query-param REST. A thin typed wrapper is the right approach. The proposed structure (`trelloFetch.ts` + resource modules + Zod) is clean and aligned with project conventions.

3. **MVP config fields.** The 8 config fields are appropriate. One addition to consider: `oauthSecret` (the webhook signing secret) is missing from the config list. Without it, HMAC verification cannot be implemented at runtime. This is a gap.

4. **Phase ordering is realistic.** MVP covers the core read/write/webhook loop. Phase 2 adds custom fields and attachments. Phase 3 adds Trello-specific automation (Butler). The ordering is sensible.

5. **Butler automation (Phase 3).** Butler is Trello's rule-based automation, available via a separate API (`https://api.trello.com/1/automation` endpoints). It is not a Power-Up in the traditional sense. Including it in Phase 3 is appropriate but the description ("if Trello introduces AI/automation Power-Ups") is misleading — Butler already exists. Reword.

6. **Open question Q3 encoding issue.** Section 13 Q3 contains a Unicode rendering artifact (`多org隔离` — appears to be a mixed-language character). Should be "multi-org isolation" or similar.

7. **No mention of webhook idempotency key in implementation.** Given at-least-once delivery, the MVP implementation path should note that the connector must deduplicate incoming webhook events by `action.id`. This is an implementation requirement that belongs in the MVP scope description.

8. **`botUsername` config field.** The doc includes `botUsername` for loop prevention but the preferred field for deduplication (as described in 7.3) is `idMemberCreator` (the member ID, not username). The config should store the bot's member ID, which can be resolved once via `GET /1/tokens/{token}/member` and cached. Username is user-editable; ID is stable.

**Fixes needed:**
1. Add `oauthSecret` to the MVP config field list.
2. Change `botUsername` config to `botMemberId` with a note on how to resolve it.
3. Fix Q3 encoding artifact.
4. Add webhook event deduplication by `action.id` to MVP scope.
5. Correct Butler description — it already exists, not hypothetical.

---

## Priority fixes

Ranked by impact on correctness and implementation safety:

1. **`moveCardToList` is not a real action type** — fires as `updateCard` with `data.listAfter`. Affects trigger logic in sections 3.2 and 6. High impact: if the connector filters on this string, it will miss all card-move events.

2. **HMAC signing key label** — `appSecret` must be renamed to `oauthSecret` (the OAuth Secret from the app-key page). The implementation will fail HMAC verification if the wrong secret is used.

3. **Edit comment endpoint exists** — `PUT /1/actions/{actionId}` updates comment text. The doc's claim that no edit endpoint exists is wrong and will cause unnecessary complexity.

4. **`POST /1/cards/{cardId}/labels` takes `value={labelId}`**, not `color`+`name`. Using the wrong field will cause 400 errors when adding existing labels to cards.

5. **`oauthSecret` missing from MVP config** — without it, webhook HMAC verification cannot be wired up at runtime.

6. **HMAC raw body note** — clarify that the signature is computed over the raw request body bytes, not re-serialized JSON.

7. **Replay protection gap** — document that Trello provides no nonce/timestamp in signatures; deduplication by `action.id` is required.

8. **`removeLabelToCard` typo** → `removeLabelFromCard` in section 6.

9. **4 attachments/card limit** — unverifiable claim; remove unless sourced.

10. **`botUsername` → `botMemberId`** in config and loop-prevention logic.

11. **Q3 encoding artifact** — fix mixed-language character in open questions.

12. **Plan tier note for custom fields** — Free plan allows only 1 Power-Up; affects custom field availability for some tenants.
