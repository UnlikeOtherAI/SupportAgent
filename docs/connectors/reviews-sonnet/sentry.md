# Sentry combined review

## Verdict

The document is generally well-structured and covers the most important areas for a Sentry connector. Authentication, webhook intake, status/priority models, and pagination are handled correctly at a high level. However, several claims are inaccurate or unverifiable: the `@sentry/api` npm package does not exist as described, the HMAC verification code sample contains a logic error (it re-serializes the body instead of using the raw bytes), the rate limit header names appear to be invented (Sentry does not publish `X-Sentry-Rate-Limit-*` headers in this form for REST API consumers), and the tag write API (`POST /api/0/issues/{issue_id}/tags/{key}/`) does not match Sentry's actual REST surface. The doc is a solid first draft but needs targeted corrections before implementation begins.

---

## Authentication

**What the doc says**: Three mechanisms — Organization Auth Token, Internal Integration token, and Member User Token. Recommends Internal Integration per tenant with `event:read`, `event:write`, and optionally `org:read`. Token is non-expiring. Webhook secret is the "Client Secret" shown in integration settings.

**Findings**:

- Auth Token and Internal Integration distinction is accurate. Sentry does distinguish between user API tokens and integration tokens. The recommendation to use one Internal Integration per tenant is architecturally sound.
- Scope table is correct in spirit. `event:read`, `event:write`, `event:admin`, `org:read`, `org:write`, `team:read` are real Sentry scopes and the mappings in the table are accurate.
- "Non-expiring until revoked" is accurate for both token types as of current Sentry cloud behavior.
- Webhook HMAC: The doc states the Client Secret is used for HMAC-SHA256 verification and is shown when you first save the webhook URL. This matches Sentry's Integration Platform docs. The "Client Secret" terminology is correct.
- **Gap**: The doc does not mention that Internal Integration tokens can be regenerated from settings (lost tokens can be recovered). It states only that the Client Secret can be regenerated if lost, but the same applies to the auth token.
- **Gap**: No mention of the `sentry-key` vs `Bearer` distinction. Sentry's older DSN-based auth uses `sentry-key`; the REST API always uses `Authorization: Bearer`. This is fine for the connector but worth noting explicitly to avoid confusion when reading Sentry docs that reference DSN auth.
- **Gap**: For self-hosted Sentry, there is no documented difference in auth mechanism — this is accurate (same Bearer token flow), but the doc could explicitly confirm this rather than leaving it implicit.
- OAuth2 (public integrations) is not mentioned. For SupportAgent's single-tenant Internal Integration model, this is intentionally out of scope and the omission is justified. The doc should explicitly note that Public/OAuth2 integrations are out of scope.

**Verdict**: Accurate and sufficient for MVP. Minor gaps around token recovery and explicit OAuth2 exclusion.

---

## Endpoints

**What the doc says**: Lists endpoints for list issues, get issue, post/edit/delete comment, update issue (status, assignee, priority), list tags, set tag, list events, list projects, list users.

**Findings**:

- `GET /api/0/organizations/{org}/issues/` — correct path, correct scope (`event:read`). Query parameter `query` with Sentry search syntax is accurate.
- `GET /api/0/issues/{issue_id}/` — correct.
- `POST /api/0/issues/{issue_id}/comments/` — correct path and method. Response body shown (201) looks plausible. The `issue` field in the response being a string ID is consistent with Sentry's API style.
- `PUT /api/0/issues/{issue_id}/comments/{comment_id}/` — correct method and path for editing a comment.
- `DELETE /api/0/issues/{issue_id}/comments/{comment_id}/` — correct, 204 No Content is the expected response.
- `PUT /api/0/organizations/{org}/issues/{issue_id}/` — correct path for updating status, assignee, priority. The body examples for `status`, `assignedTo`, and `priority` are accurate.
- Priority values `None`, `low`, `medium`, `high`, `critical` — accurate as of Sentry ~23.x.
- **Inaccuracy — tag write endpoint**: The doc describes `POST /api/0/issues/{issue_id}/tags/{tag_key}/` with a body `{"value": "production"}` as the way to set a tag on an issue. This endpoint does not exist in Sentry's REST API for setting tags on issues from the outside. Tags on issues are derived from the events (SDK-side). The `GET /api/0/issues/{issue_id}/tags/` endpoint exists for reading tag distribution, but there is no write path to set arbitrary tags on issues via the REST API. The doc's statement "Tags are immutable once set — you can add a new key:value, but you cannot change an existing tag value" is also misleading because the actual constraint is that tags come from SDK event payloads, not from the management API. **This entire tag write section needs to be corrected or removed.**
- `GET /api/0/organizations/{org}/users/` — correct path and scope.
- `DELETE /api/0/issues/{issue_id}/` for issue deletion with `event:admin` scope — correct.
- `GET /api/0/issues/{issue_id}/events/` — correct.
- **Gap**: No endpoint listed for fetching a single comment (`GET /api/0/issues/{issue_id}/comments/{comment_id}/`) or listing all comments on an issue (`GET /api/0/issues/{issue_id}/comments/`). These are needed for polling-based comment sync and for verifying comment state after posting.
- **Gap**: No endpoint for listing teams (`GET /api/0/organizations/{org}/teams/`), which is needed if SupportAgent supports assigning issues to teams.
- `PUT /api/0/organizations/{org}/issues/` for bulk update is mentioned in Phase 2. This endpoint does exist (it accepts a list of `id` values via query param), so the Phase 2 reference is accurate.
- Deprecated endpoint `GET /api/0/projects/{org}/{project}/issues/` flagged correctly in §10i.
- File attachment noted as not supported via API — accurate; Sentry attachments go through a separate DSN-based upload, not the management REST API.

**Verdict**: Mostly correct but the tag write endpoint is a significant inaccuracy that would cause implementation failures. Comment listing endpoints are missing.

---

## Inbound events

**What the doc says**: Webhook via Integration Platform, six resource types listed, HMAC-SHA256 on `Sentry-Hook-Signature`, replay protection via `Sentry-Hook-Timestamp`, exponential backoff retries (1s → 32s, 6 retries), no deduplication, idempotency key `(issue_id, action, timestamp)`.

**Findings**:

- Resource types (`issue`, `comment`, `error`, `installation`, `event_alert`, `metric_alert`) are accurate. The doc also mentions `seer` and `preprod_artifact` in §11 as events to ignore — these are real Sentry webhook resource types introduced more recently.
- Issue webhook actions (`created`, `resolved`, `assigned`, `archived`, `unresolved`) are accurate.
- Comment webhook actions (`created`, `updated`, `deleted`) are accurate.
- **HMAC verification code is incorrect**: The verification snippet does:
  ```js
  hmac.update(JSON.stringify(requestBody), 'utf8');
  ```
  This re-serializes a parsed object. To correctly verify the signature, the raw request body bytes (before any JSON parsing) must be used. Re-serializing a parsed object can produce different JSON (different key order, whitespace) and will cause spurious signature failures. The correct pattern is to buffer the raw request body as a string/Buffer before calling `JSON.parse`, then use that raw buffer in `hmac.update`. This is a standard webhook verification mistake and needs to be corrected.
  Reference: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
- Retry semantics (exponential backoff, up to 6 retries, 2xx = success): plausible and consistent with Sentry's documented behavior, though Sentry's docs do not publish the exact retry schedule publicly. The 1s/2s/4s/8s/16s/32s schedule is a reasonable estimate but should be marked as approximate.
- The note that Sentry marks the integration as "failing" after all retries is accurate — Sentry's UI does show a "disabled" state for webhooks that fail repeatedly.
- "Sentry does not deduplicate webhook deliveries" — accurate.
- Idempotency key `(issue_id, action, timestamp)` is reasonable. However `timestamp` here would come from the webhook payload's `data.timestamp` on comments, or from `Sentry-Hook-Timestamp` on the outer envelope. The doc should clarify which timestamp is used.
- **Gap**: No mention of the `installation.uuid` as the tenant routing key in idempotency logic. The idempotency key should include `installation.uuid` to prevent cross-tenant collision in a multi-tenant deployment.
- **Gap**: No mention of comment webhook polling fallback. If webhook delivery fails for comment events, how does SupportAgent catch missed comments? The polling fallback described in §3b covers issue polling but not comment polling. There is no `GET /api/0/issues/{issue_id}/comments/` mentioned as a polling fallback for comments.
- Bot-loop prevention (§7): The doc describes using the returned `user.id` from a posted comment to detect self-authored comments. This is correct in principle. The doc correctly notes that for issue events, `actor.type == "application"` identifies integration-triggered events.
- Mention detection: The doc correctly states Sentry has no @mention system and that SupportAgent must scan `data.comment` for mention strings. This is accurate.
- Delivery guarantees: Sentry's webhook delivery is at-least-once (not exactly-once). The doc implies this correctly via the deduplication note.

**Verdict**: The HMAC verification code error is a high-priority fix. The idempotency key needs `installation.uuid`. Comment polling fallback is a gap. Other inbound event coverage is accurate.

---

## Hosting variants

**What the doc says**: Cloud (US `sentry.io`, EU `de.sentry.io`), self-hosted (single binary or Docker). API version parity: cloud v0 == self-hosted. Integration Platform on self-hosted since Sentry 21.x. Self-hosted may lack rate limit enforcement.

**Findings**:

- Cloud US and EU base URL distinction is accurate. `sentry.io` for US, `de.sentry.io` for EU.
- "API version parity: cloud v0 == self-hosted" — broadly accurate. Sentry maintains the `/api/0/` prefix on both. Feature parity between a specific cloud version and a self-hosted version depends on the self-hosted version, but the API version prefix is stable.
- Integration Platform on self-hosted since Sentry 21.x: plausible, though the exact version boundary is hard to verify. The guidance to check tenant version during onboarding is correct.
- **Gap**: No mention of Sentry's SaaS single-tenant / dedicated / enterprise tiers. Sentry Enterprise SaaS (dedicated instances) is a distinct offering from standard cloud and self-hosted. The base URL for dedicated tenants may differ from `sentry.io`. This could matter if enterprise SupportAgent customers use dedicated Sentry instances.
- **Gap**: No mention of version detection strategy for self-hosted. The open question in §13 raises this but does not propose a resolution. The `/api/0/` prefix is stable, but feature availability (priority field, substatus) differs. The doc could suggest checking the `/api/0/organizations/{org}/` response for feature flags or using `/api/0/` health/version endpoints if they exist.
- "Self-hosted has no built-in rate limit enforcement in some versions" — accurate. Self-hosted Sentry historically did not enforce the same rate limits as cloud. Defensive backoff is correct advice.
- **Gap**: No mention of data residency considerations beyond the EU region cloud. Some organizations may require that SupportAgent not proxy Sentry data across regions.
- Known deprecations: `GET /api/0/projects/{org}/{project}/issues/` deprecated in 2024 is correctly flagged.
- No breaking changes between major API versions are documented. Sentry has not had a v1 API, so v0 is the only version. This is accurate but the doc should note that Sentry does make breaking changes within v0 (they maintain a changelog at https://docs.sentry.io/api/changelog/).

**Verdict**: Adequate for cloud and common self-hosted cases. Gaps around dedicated/enterprise hosting and version detection strategy.

---

## Rate limits & pagination

**What the doc says**: Fixed-window per-endpoint. Headers: `X-Sentry-Rate-Limit-Limit`, `X-Sentry-Rate-Limit-Remaining`, `X-Sentry-Rate-Limit-Reset`, `X-Sentry-Rate-Limit-ConcurrentLimit`, `X-Sentry-Rate-Limit-ConcurrentRemaining`. Specific limits table (1000/min issues GET, 100/min issues POST/PUT, etc.). 429 with `Retry-After`. Cursor-based pagination via `Link` header, max 100 per page.

**Findings**:

- **Rate limit headers are inaccurate**: Sentry's public REST API does not document `X-Sentry-Rate-Limit-*` headers for the management API. Sentry uses these headers (in a different format) for their ingestion/DSN API (the SDK side), not the REST management API. The management API returns 429 on rate limit but the specific header names listed (`X-Sentry-Rate-Limit-Limit`, `X-Sentry-Rate-Limit-Remaining`, `X-Sentry-Rate-Limit-Reset`) are not confirmed in Sentry's public REST API documentation. The `Retry-After` header on 429 is real and confirmed. The implementation should only rely on `Retry-After` and treat the other headers as potentially absent.
  Reference: https://docs.sentry.io/api/ratelimits/
- **Rate limit numbers in the table are unverifiable**: Sentry does not publicly publish per-endpoint rate limit numbers for their management API. The figures (1000/min, 100/min, 60/min, etc.) appear to be reasonable estimates but are not from official documentation. They should be labeled as "approximate/unverified" or removed in favor of purely reactive rate limit handling (observe 429 and back off).
- `Retry-After` on 429: accurate, Sentry does include this header.
- Rate limits by token identity, not by endpoint — this is likely accurate and consistent with how Sentry's rate limits work, but again is not officially documented. The advice to isolate tenants by token is sound regardless.
- **Pagination**: Cursor-based via `Link` header (RFC 5988) is accurate. The `cursor` parameter format `{timestamp},{shard},{shardIndex}` is accurate and matches Sentry's implementation. The `results="true"/"false"` attribute on the `rel="next"` link is Sentry-specific and is correctly documented.
- Max page size of 100 is accurate for most endpoints.
- `?limit={n}` to control page size is accurate.
- **Gap**: No mention of the `X-Hits` header that Sentry returns on issue list endpoints, which gives the total count of matching issues before pagination. This is useful for progress estimation during initial sync.
- **Gap**: No discussion of what happens when a cursor expires. Sentry cursors are timestamp-based and can become invalid if too much time passes or if the underlying data changes significantly. SupportAgent should handle cursor invalidation gracefully by restarting from the beginning.
- Bulk endpoints: Phase 2 mentions `PUT /api/0/organizations/{org}/issues/` for batch operations. This endpoint exists and accepts `id` as a repeated query parameter. The description is accurate.
- Error response shape: Not characterized in the doc. Sentry typically returns `{"detail": "..."}` or `{"errors": {...}}`. This should be documented for connector error handling.

**Verdict**: Pagination is accurate. Rate limit header names are likely wrong and numbers are unverified — implementation must not depend on those specific header names beyond `Retry-After`. The `X-Hits` header gap is minor but useful.

---

## SDK & implementation path

**What the doc says**: `@sentry/api` npm package wraps `/api/0/` with typed interfaces. Recommends raw `fetch` over the SDK. No CLI equivalent. Node.js built-in `crypto` for webhook signature.

**Findings**:

- **`@sentry/api` package does not exist as described**: There is no npm package named `@sentry/api` that serves as a REST management API client. The `@sentry/api` package that exists in the `sentry-javascript` monorepo is an internal package used by the Sentry SDK itself for SDK-internal operations — it is not published for external consumption as a management API client. The URL `https://github.com/getsentry/sentry-javascript/tree/develop/packages/api` refers to an internal package. The doc's characterization ("wraps all `/api/0/` endpoints with typed interfaces") is inaccurate. There is no official Sentry npm package for the management REST API. **The recommendation to use raw `fetch` is correct; the SDK description is wrong and should be removed or corrected to avoid confusion.**
- Raw `fetch` / `undici` recommendation: correct and appropriate for this use case.
- Node.js built-in `crypto` for HMAC: correct, no external package needed.
- No CLI equivalent to `gh` for Sentry: accurate.
- MVP phase ordering (list issues, get issue, post comment, update issue, list projects, list users) is logical and implementable.
- Phase 2 additions (tag CRUD, escalation tracking, bulk operations, polling reconciliation, event fetch) are reasonable.
- Phase 3 items (quota advisory, release tracking, performance issues, Seer, multi-integration) are reasonable stretch goals.
- Config field list (`organizationSlug`, `authToken`, `clientSecret`, `region`, `selfHostedUrl`) is complete and sufficient for MVP.
- Open questions in §13 are well-chosen. Question 8 (whether SupportAgent posts comments back to Sentry at all) is a critical architectural question that should be answered before implementation.
- **Gap**: No mention of connection timeout or request timeout recommendations. Sentry's API can be slow on large orgs (many issues). SupportAgent should set explicit timeouts (e.g., 30s) on fetch calls.
- **Gap**: No mention of how the connector handles Sentry's occasional maintenance windows or API unavailability. A circuit breaker or health check strategy would be relevant for production readiness.

**Verdict**: The `@sentry/api` package claim is the most significant error here — it would send an implementer on a wild goose chase. The raw `fetch` recommendation is correct and the MVP scope is reasonable.

---

## Priority fixes

1. **Fix HMAC verification code** (§3a): Replace `JSON.stringify(requestBody)` with the raw request body buffer. This is a correctness bug that will cause all webhook signature verifications to fail if the JSON serializer produces different output than Sentry sent.

2. **Remove or correct tag write endpoint** (§4g): `POST /api/0/issues/{issue_id}/tags/{tag_key}/` does not exist as a write endpoint in Sentry's management REST API. Tags on issues come from SDK event payloads. Remove this section or replace it with an accurate description of how tags work (read-only from the management API perspective).

3. **Remove `@sentry/api` SDK claim** (§12): This package does not exist as a public management API client. Replace with a note that no official REST management API client library exists for Node.js and raw `fetch` is the correct approach.

4. **Correct or remove rate limit header names** (§8): `X-Sentry-Rate-Limit-Limit/Remaining/Reset/ConcurrentLimit/ConcurrentRemaining` are not confirmed Sentry REST management API headers. Replace the header table with a note that `Retry-After` is the only reliable signal on 429, and that the specific header names should be confirmed against live API responses before implementation. Remove the per-endpoint rate limit numbers table or label them as unverified estimates.
   Reference: https://docs.sentry.io/api/ratelimits/

5. **Add `installation.uuid` to idempotency key** (§10c): The idempotency key `(issue_id, action, timestamp)` can collide across tenants in a multi-tenant deployment. Change to `(installation_uuid, issue_id, action, timestamp)`.

6. **Add comment listing endpoint** (§4, §3b): Document `GET /api/0/issues/{issue_id}/comments/` as needed for polling-based comment sync and as a fallback when comment webhooks fail.

7. **Clarify timestamp in HMAC freshness check** (§3a): The replay prevention note says to check `Sentry-Hook-Timestamp` but the verification code does not show this check. Add explicit code showing how to compare `Sentry-Hook-Timestamp` against `Date.now()` using the raw header value before checking the HMAC.

8. **Mark rate limit numbers as unverified** (§8): The per-endpoint limits table (1000/min, 100/min, etc.) is not from official Sentry documentation. Label all values as approximate or replace with reactive-only advice.

9. **Note that Sentry makes breaking changes within v0** (§10i): Add a reference to the Sentry API changelog at https://docs.sentry.io/api/changelog/ so implementers know where to track breaking changes.

10. **Add dedicated/enterprise hosting note** (§10a): Mention that Sentry Enterprise SaaS (dedicated instances) exists and may use non-standard base URLs. The onboarding flow should accept a custom base URL for these cases, not only `sentry.io` / `de.sentry.io` / self-hosted URL.
