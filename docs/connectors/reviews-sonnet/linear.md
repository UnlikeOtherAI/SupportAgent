# Linear combined review

## Verdict

The Linear connector document is well-researched and substantially accurate. It correctly identifies Linear as GraphQL-only with no REST fallback, covers both PAT and OAuth2 auth paths, and documents the webhook event model with correct signature headers. The biggest gaps are: the GraphQL endpoint URL is wrong (the production endpoint is `https://api.linear.app/graphql`, not `/graphql/v1`); the rate-limit header set is described vaguely with the wrong header names; the OAuth access token lifetime claim ("short-lived, hours") conflicts with Linear's documented behavior; and the polling strategy conflates two distinct sync primitives (`updatedAt` filtering and `lastSyncId`) that should not be mixed. Overall confidence is moderate-high — the document is safe to implement from, but several field-level claims need verification against the live schema before shipping.

---

## Authentication

**PAT**

The doc correctly states PATs live at Settings → Account → Security → API keys and are carried as `Authorization: Bearer <token>`. The claim that tokens are "indefinite until manually revoked" is accurate. The assertion that there is "no scopes granularity" on a PAT is correct — PATs inherit the creating user's permissions workspace-wide.

**OAuth 2.0**

The doc says the OAuth access token is "short-lived, hours". Linear's official OAuth docs (https://developers.linear.app/docs/oauth/authentication) do not specify a fixed expiry and describe the token as long-lived unless revoked. The statement should either be verified against current behavior or left as "duration unspecified." The refresh token is described as "optional" — that is correct; Linear only issues a refresh token if the app requests `offline_access`.

Scope list (`read`, `write`, `comments`, `issues`, `projects`, `teams`, `users`) appears accurate. However, the minimum-sufficient table only maps three operations — it omits webhook registration, which requires `admin` scope on some workspace tiers, not just `write`. This needs verification; if `write` is insufficient for `webhookCreate` in some configurations, MVP setup will silently fail.

**Webhook HMAC**

The header names (`linear-signature`, `linear-timestamp`) and HMAC-SHA256 algorithm are correct per Linear docs (https://developers.linear.app/docs/graphql/webhooks). The 60-second replay window is stated correctly. The note about `LINEAR_WEBHOOK_SIGNATURE_HEADER` being a named export from `@linear/sdk/webhooks` is accurate.

**Gap**: No mention of IP allowlist options or any organizational security policy that might block outbound webhook delivery. Not a blocking gap but worth a note.

---

## Endpoints

**GraphQL endpoint URL — incorrect**

The doc states the GraphQL endpoint is `https://api.linear.app/graphql/v1`. Linear's actual production endpoint is `https://api.linear.app/graphql` (no `/v1` suffix). See https://developers.linear.app/docs/graphql/working-with-the-graphql-api. This is the most consequential factual error in the document — every raw `fetch` call will 404 or redirect if built off the doc's URL.

**Mutations documented**

All six core mutations (`issueCreate`, `commentCreate`, `commentUpdate`, `commentDelete`, `issueUpdate`, `issueArchive`) are present. Argument names and input types match the published schema. The `IssueCreateInput`, `IssueUpdateInput`, and `CommentCreateInput` field names shown in the JSON examples are accurate.

**Label set vs. append semantics**

The doc correctly notes that setting `labelIds` on `issueUpdate` is a full replacement (set, not append). This is an important gotcha for the implementation.

**Attachment**

The doc notes `attachmentCreate` accepts a URL but not binary. That is accurate. However, the `archivable` field in the example body is not a standard field on `AttachmentCreateInput` per the schema; the correct fields are `url`, `title`, `subtitle`, `metadata`, `iconUrl`, `issueId`. The `archivable` key appears to be hallucinated or from an older schema version. This should be removed to avoid a schema validation error.

**Missing endpoints**

The following capabilities needed by SupportAgent are not covered or are only partially addressed:

- `webhookCreate` / `webhookUpdate` / `webhookDelete` — mentioned in passing but no mutation body shown.
- `issueLabels` / `issueLabel` query — the MVP scope table references `issueLabels(teamId)` but no query body or field shape is provided.
- `workflowStates` — referenced in the MVP scope table but no query example.
- `comments` query — referenced but no field shape shown. The actual query name is `issue.comments` (nested), not a top-level `comments` query with an `issueId` argument.
- List users query — listed as `users` in the MVP table. The actual schema exposes `users` as a paginated connection; this is fine but no example is shown.

**Delete issue**

The doc does not cover `issueDelete`. Whether SupportAgent needs it is an open question, but the endpoint review checklist requires it to be considered.

---

## Inbound events

**Event names and action values**

The event type names (`Issue`, `Comment`, `Cycle`, `Project`, `IssueLabel`, `Attachment`, `User`, `AuditEntry`) and action values (`create`, `update`, `delete`, `archive`, `unarchive`) are correct per Linear's webhook documentation.

**Payload shape**

The payload field inventory for Issue and Comment is thorough. One inaccuracy: `body` is listed as "HTML/Rich text" for Issue but Linear's API uses `description` for the markdown field and `bodyData` for the structured/rich-text JSON. The plain `body` field on an Issue is not a standard top-level field in the webhook payload. This conflation could cause the connector to look for a field that is absent.

**Mention detection**

The doc correctly notes that mentions can be detected by scanning `body` for the `@[Name](user:user-id)` pattern. However, it does not address whether Linear fires a separate webhook event for mentions (it does not — there is no `Mention` event type). The connector must parse comment bodies, which the doc implies but does not state explicitly.

**Bot-loop prevention**

The `botActor` field on comments is documented accurately. The strategy of comparing `botActor.id` against `LINEAR_APP_USER_ID` is correct. One gap: when the connector uses a PAT (not OAuth app), `botActor` will be `null` and only `creator.id` is available. The doc does not distinguish these two cases clearly.

**Polling**

The doc mixes two different sync primitives in section 3: `updatedAt`-based filtering and `lastSyncId` from the `Subscription` response. These are unrelated mechanisms. `lastSyncId` is a Linear-specific delta sync primitive used with `syncUpdates` — it is not the same as cursor-based `updatedAt` polling. Including both in the same paragraph without distinguishing them is confusing and could lead to incorrect implementation. Recommend separating them clearly or removing the `lastSyncId` reference if delta sync is not in scope.

**Retry / delivery semantics**

The claim of "exponential backoff up to ~24h" is plausible but not precisely documented by Linear. The doc correctly notes there is no dead-letter queue UI. The dedup warning (same event delivered twice) is accurate and important.

**Gap**: No mention of webhook event ordering guarantees (or lack thereof). Linear does not guarantee ordered delivery; the connector must handle out-of-order events.

---

## Hosting variants

Linear is cloud-only. The doc states this correctly. There is no self-hosted variant and no enterprise on-premise tier as of the knowledge cutoff. This section of the review checklist is not applicable to Linear, and the doc correctly flags this at the top.

**Regional / data residency**

The doc is silent on this. Linear does not currently offer regional data residency or EU-hosted instances as a product feature, but this should be confirmed if any tenant has data-residency requirements.

**API versioning**

Linear does not use URL-based versioning for its GraphQL API (no `/v1`, `/v2` paths). The doc's stated endpoint of `/graphql/v1` implies versioning that does not exist. The API evolves via schema additions; Linear follows additive-only changes and announces breaking changes. There are no known major-version migration paths to document.

---

## Rate limits & pagination

**Rate limit numbers**

The doc states ~600 requests/minute per workspace. This is a rough approximation. Linear's published guidance (https://developers.linear.app/docs/graphql/working-with-the-graphql-api#rate-limiting) describes complexity-based limiting rather than a simple per-minute request count. Each GraphQL query has a complexity score; the limit is expressed in complexity units per window, not raw request count. Implementing a simple "600 req/min" counter will be inaccurate. The connector should inspect response headers and handle `Ratelimited` errors rather than self-rate-limiting by request count.

**Rate limit headers**

The doc says Linear uses a `X-RateLimit-*` header set but does not name the exact headers. Linear's current headers are:
- `X-RateLimit-Requests-Limit`
- `X-RateLimit-Requests-Remaining`
- `X-RateLimit-Requests-Reset`
- `X-Complexity-*` equivalents (complexity budget)

Without the exact header names, the connector cannot implement proactive throttling. This is a gap that needs filling.

**429 behavior**

The doc is correct that a `Ratelimited` error surfaces as a `LinearGraphQLError` in the SDK. The claim that `Retry-After` is "not explicitly documented" is accurate — Linear does not reliably include a `Retry-After` header. The advice to use exponential backoff is correct.

**Pagination**

The Relay Connection spec usage (`first`, `after`, `pageInfo.endCursor`, `pageInfo.hasNextPage`) is accurate. The max page size of 250 via `first: 250` is correct. The default of 50 is correct.

**Bulk endpoints**

Correctly stated: there are none. All writes are single-record mutations.

**Error response shape**

The doc does not describe the GraphQL error envelope shape. Linear errors come back as `{ errors: [{ message, extensions: { type, userPresentableMessage } }] }` with HTTP 200. The connector must parse `errors[0].extensions.type` to distinguish rate limit, auth, and validation errors, since HTTP status will be 200 in most cases. This is a meaningful implementation gap.

---

## SDK & implementation path

**Package existence**

`@linear/sdk` exists on npm and is actively maintained (https://www.npmjs.com/package/@linear/sdk). Version `82.0.0` is plausible given the monorepo's rapid release cadence, but pinning to an exact version in design docs is fragile. The doc should recommend a semver range or say "latest stable."

**`@linear/sdk/webhooks` subpath**

This subpath export exists and `LinearWebhookClient` is a real export. The code example using `.createHandler()` and `.on("Issue", ...)` matches the SDK's public API. This is correct.

**Raw fetch recommendation**

The recommendation to prefer raw `fetch` for connector logic while using `@linear/sdk/webhooks` for signature verification is sound and internally consistent.

**MVP config fields**

The five config fields listed (`LINEAR_API_KEY`, `LINEAR_TEAM_ID`, `LINEAR_WORKSPACE_URL`, `LINEAR_WEBHOOK_SECRET`, `LINEAR_APP_USER_ID`) are appropriate for MVP. One observation: `LINEAR_WORKSPACE_URL` may not be needed if all URLs are returned directly in API responses (issues include a `url` field). It is worth clarifying whether this field is used for URL construction or purely cosmetic.

**MVP / Phase 2 / Phase 3 ordering**

The phasing is realistic. OAuth in Phase 2 rather than MVP is a sensible call. Custom fields, multi-team support, and SLA breach handling in later phases are appropriately deferred.

**Open questions**

All eight open questions are operationally relevant. Q3 (shared vs. per-tenant webhook endpoint) and Q4 (team scoping) are the most architecturally significant and should be resolved before implementation begins. Q6 (retry strategy) has a de facto answer (exponential backoff 1s→60s) that the doc could just commit to rather than leaving open.

---

## Priority fixes

1. **Fix GraphQL endpoint URL** — change `https://api.linear.app/graphql/v1` to `https://api.linear.app/graphql` throughout. Every raw fetch will fail against the wrong URL.

2. **Remove `archivable` from `AttachmentCreateInput` example** — this field does not exist in the schema. Replace with valid fields (`title`, `subtitle`, `metadata`, `iconUrl`).

3. **Clarify `body` vs. `description` on Issue** — the doc lists both and conflates them. `description` is the markdown field; `bodyData` is the structured rich-text JSON. Remove `body` from the Issue payload field list or annotate it correctly.

4. **Separate `updatedAt` polling from `lastSyncId` delta sync** — these are different mechanisms. Either document `syncUpdates` / `lastSyncId` as a distinct polling strategy with its own section, or remove the `lastSyncId` reference to avoid implementation confusion.

5. **Name the exact rate-limit headers** — add `X-RateLimit-Requests-Limit`, `X-RateLimit-Requests-Remaining`, `X-RateLimit-Requests-Reset` so the connector can implement proactive throttling.

6. **Document GraphQL error envelope shape** — add a note that errors arrive in `{ errors: [{ message, extensions: { type } }] }` with HTTP 200. Without this, error handling logic will be incomplete.

7. **Clarify OAuth access token lifetime** — either confirm the "hours" claim with a source or change to "duration unspecified / long-lived unless revoked."

8. **Clarify `webhookCreate` scope requirement** — verify whether `write` scope is sufficient or whether `admin` is required in some workspace tiers. Update the minimum-sufficient scope table accordingly.

9. **Bot-loop prevention when using PAT** — document that `botActor` is null for PAT-authenticated connectors; in that case the connector must fall back to comparing `creator.id` against its known user ID.

10. **Add query examples for `issueLabels`, `workflowStates`, and `comments`** — these are in the MVP scope table but have no example bodies, making them incomplete as implementation specs.
