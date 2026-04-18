# Microsoft Teams combined review

## Verdict

The document is broadly accurate and covers the most important constraints of the Teams/Graph API surface. The auth model, dual-surface architecture (Graph + Bot Framework), and critical gotchas (app-only channel posting restriction, subscription expiry, no issue-tracker model) are correctly identified. However, several specific claims are inaccurate or incomplete: the Bot Framework signature-verification description is wrong, the Graph SDK npm package name is inconsistent within the document, pagination `$top` limits overstate reality on channel-message endpoints, the `scope` parameter in the bot token request is wrong, and the mention-resolution mechanism for `<at>` tags overstates reliability. The open-questions section is well-chosen. Overall confidence: medium-high; safe to implement from but requires the corrections below before production.

---

## Authentication

### 2.1 — Azure AD App Registration

The single-tenant vs multi-tenant table is correct. However, the comparison block for the token endpoint URLs (section 2.1) is identical for both variants — the text acknowledges this in prose but the table implies a difference that does not exist in the URL itself. The distinction is only in the authorization step (`/common/` vs `/{tenantId}/`). This is more confusing than helpful; the table should be removed or rewritten.

The `availableToOtherTenants: true` manifest property is a legacy manifest field (pre-v2 manifest). The current Azure portal and Microsoft Entra documentation use `signInAudience: "AzureADMultipleOrgs"` only. Both achieve the same thing, but citing the deprecated field alongside the current one without noting that only one is needed causes confusion.

### 2.2 — Token Acquisition

Client credentials flow is correctly described. The `expires_in: 3599` example is accurate. The note that there is no refresh token in client credentials flow is correct.

The `ext_expires_in` field is real and returned, but its meaning is not explained: it represents the extended lifetime used by the resilience infrastructure. Tokens are valid up to `ext_expires_in` seconds even if the main token service is temporarily unavailable. Not mentioning this is a minor gap, not an error.

### 2.3 — Bot Framework token scope

**Inaccuracy.** Section 2.3 states the bot token request uses:

```
scope=https://graph.microsoft.com/.default
```

This is wrong. The Bot Framework token endpoint (`https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token`) requires:

```
scope=https://api.botframework.com/.default
```

Using `https://graph.microsoft.com/.default` will return a token that cannot authenticate Bot Framework calls. The correct scope for Bot Connector API is `https://api.botframework.com/.default`.

Reference: https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication

### 2.3 — Required Permissions

The permissions table is accurate for read and subscription operations. One gap: `ChannelMessage.Send` is listed as the permission for posting to a channel, but the document later correctly notes in section 4.1 that app-only channel message posting is NOT supported under `ChannelMessage.Send` with application permissions. This is contradictory — the permissions table implies `ChannelMessage.Send` will work for the connector, but it will not for app-only sending. The table needs a note clarifying that this permission only applies to delegated (user) context, and that Bot Framework is required for app-only.

`Teamwork.Migrate.All` is mentioned in section 4.1 as an alternative but is correctly flagged as migration-only — it is not a legitimate path for normal outbound messaging. Good.

### 2.3 — Admin consent URL

The document references `/oauth2/v2.0/tenantAdminConsent` as an endpoint. This does not exist as a standalone endpoint. The correct mechanism is the admin consent URL pattern:

```
https://login.microsoftonline.com/{tenantId}/adminconsent?client_id={clientId}&redirect_uri={redirectUri}
```

Reference: https://learn.microsoft.com/en-us/entra/identity-platform/v2-admin-consent

---

## Endpoints

### 4.1 — POST channel message (app-only)

The document correctly identifies this as a critical limitation: Graph API v1.0 does not allow app-only channel message posting via `ChannelMessage.Send`. This is accurate and well-highlighted.

However, it then recommends Bot Framework as the solution and says "Bot Framework supports proactive messaging with app-only auth via the bot credentials." This is true but incomplete — Bot Framework proactive messaging requires the bot to have an existing `serviceUrl` and `conversationId`, which means the bot must have been installed in the team/channel first. A net-new bot cannot post to an arbitrary channel it was never installed in, even with valid credentials. The document should note this installation prerequisite.

### 4.2 — POST chat message

Correctly notes app-only is not supported for chat messages. Correctly notes you cannot create a new chat. The constraint that `Chat.ReadWrite` must be delegated is accurate.

**Gap:** The document does not mention `TeamsAppInstallation.ReadWriteForChat.All`, which is required if the bot was not pre-installed in the chat and you want to install it programmatically to gain chat access.

### 4.5 — Edit message (PATCH)

The document states PATCH is "not directly supported via Graph API v1.0" and then immediately provides the PATCH endpoint. This is contradictory. PATCH for channel messages IS supported in v1.0 for messages sent by the app, specifically for soft-delete (setting `deletedDateTime`) and for updating `body`. The statement should say "not universally supported" or clarify that only the sending app can patch its own messages and only `body` and `deletedDateTime` are patchable.

Reference: https://learn.microsoft.com/en-us/graph/api/chatmessage-update

### 4.6 — Delete message

"Not supported in Graph API v1.0" — this is partially incorrect. Soft-delete (setting `deletedDateTime` via PATCH) IS supported in Graph v1.0 for app-owned messages. Hard-delete is not available. The Bot Framework `DeleteActivityAsync` is also correct but is a separate path. The section should distinguish soft-delete (Graph PATCH) from hard-delete (unsupported).

### 4.7 — Mention user

"Must match the user's display name exactly as it appears in the tenant directory" — this is inaccurate. The `<at>` tag alone does not reliably create a notification mention. The correct way to mention a user in a Graph API chatMessage is to use the `mentions` array in the message body alongside the `<at id="{mentionIndex}">` tag in the HTML content:

```json
{
  "body": {
    "contentType": "html",
    "content": "<p><at id=\"0\">John Doe</at> please see this.</p>"
  },
  "mentions": [{
    "id": 0,
    "mentionText": "John Doe",
    "mentioned": {
      "user": {
        "displayName": "John Doe",
        "id": "aad-object-id",
        "userIdentityType": "aadUser"
      }
    }
  }]
}
```

Without the `mentions` array, the `<at>` tag renders visually but does NOT generate a notification to the user. This is a significant correctness gap for any workflow that relies on mention-based notifications.

Reference: https://learn.microsoft.com/en-us/graph/api/chatmessage-post#example-3-send-message-with-a-mention

### 4.8 — Attachments

The requirement for `Sites.ReadWrite.All` plus SharePoint permissions for file upload is accurate. No significant issues.

### Gaps in endpoint coverage

The MVP endpoint table in section 11 does not include:
- `GET /teams` — listing teams the bot/app is a member of (needed to enumerate `watchedTeamIds`)
- `PATCH /teams/{id}/channels/{id}/messages/{id}` — edit own message
- `GET /teams/{id}/tags` — reading team tags for tag-mention support
- `GET /chats/{id}` — get a single chat by ID

These are not blockers but should be in the endpoint inventory for completeness.

---

## Inbound events

### 3.1 — Graph change notifications

The subscription `expirationDateTime` maximum of 4230 minutes (~3 days) is correct for `chatMessage` resources. However, the maximum varies by resource type:

| Resource | Max lifetime |
|---|---|
| `chatMessage` | 60 minutes (channel/chat messages) |
| `chat` | 60 minutes |
| `teams` | 60 minutes |
| `teamMember` / `chatMember` | 60 minutes |

**The document's claim of 4230 minutes is wrong for Teams message resources.** The 4230-minute maximum applies to other Graph resources (e.g., `driveItem`), not Teams messaging. For Teams channel/chat message subscriptions the maximum is 60 minutes, requiring much more frequent renewal.

Reference: https://learn.microsoft.com/en-us/graph/api/resources/subscription#maximum-length-of-subscription-per-resource-type

This is a high-priority fix — it directly affects the renewal job design.

### 3.1 — Validation flow

The description of the validation step is partially wrong. The document says your endpoint must respond with "a JSON body containing `validationRequest.type === 'verificationRequest'` and echoing back the challenge." The actual validation flow is:

1. Graph sends a GET (not POST) with `validationToken` as a query parameter.
2. Your endpoint must return HTTP 200 with `Content-Type: text/plain` and the `validationToken` value as the plain-text response body.

The validation is a GET request with a query parameter, not a POST with a JSON body. Getting this wrong will cause subscription creation to fail entirely.

Reference: https://learn.microsoft.com/en-us/graph/webhooks#notification-endpoint-validation

### 3.1 — clientState security

The document correctly notes that `clientState` is not a cryptographic signature. It then advises "protect against replay attacks by tracking subscription IDs and delivery timestamps." This is the right approach, but the document should also note that Microsoft now supports optional encryption of notification payloads (via `encryptionCertificate` in the subscription) for sensitive resources. For Teams messages containing PII this is worth flagging.

### 3.2 — Bot Framework signature verification

**Significant inaccuracy.** The document states:

> "Validate by computing HMAC-SHA256 of the raw request body with the bot secret."

This is incorrect. Bot Framework does NOT use HMAC-SHA256 of the request body. Bot Framework validates incoming activities using **JWT Bearer tokens** in the `Authorization` header. The token is issued by Microsoft and signed with Microsoft's public key (obtained from `https://login.botframework.com/v1/.well-known/openidconfiguration`). The correct validation flow is:

1. Extract the `Authorization: Bearer {token}` header.
2. Fetch Microsoft's OpenID configuration to get the JWKS URI.
3. Validate the JWT: signature against Microsoft's public keys, `iss` claim, `aud` claim (your bot app ID), and `nbf`/`exp`.
4. Optionally verify the `serviceurl` claim matches the activity's `serviceUrl`.

HMAC-SHA256 against a "bot secret" is not how Bot Framework works. There is no "bot secret" used for per-request signing — the client secret is only used to obtain the token for outbound calls.

Reference: https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication#authenticate-requests-from-the-bot-framework-service

### 3.3 — Polling fallback

The delta query syntax is correct. The note that there is no native `createdDateTime gt {timestamp}` filter is accurate.

**Gap:** The document does not mention that delta queries for Teams channel messages have a known limitation: delta tokens expire after a period of inactivity (~7 days). If your service is down and the delta token expires, you must re-initialize the delta by issuing the delta query without a token. This should be handled in the polling fallback implementation.

### 3.3 — $top limit for messages

Section 3.3 states `$top` supports "max 50 or 100 depending on endpoint" for message listing. Section 9 then claims `$top` up to 999. These are inconsistent. For channel message listing specifically the maximum `$top` is 50. For most other Graph endpoints it is higher. The "999" claim in section 9 is misleading for the Teams use case.

---

## Hosting variants

The document states "Cloud-only (Teams as a service). No on-premises equivalent." This is accurate — Microsoft retired Skype for Business Server (the closest on-premises predecessor) and Teams has no self-hosted variant.

**Gap — government clouds:** The document briefly mentions GCC/GCC-High/DoD in the open questions but does not give them a section. This is appropriate deferral, but should note the distinct base URLs:

| Cloud | Graph base URL |
|---|---|
| Commercial | `https://graph.microsoft.com/v1.0` |
| GCC | `https://graph.microsoft.com/v1.0` (same) |
| GCC-High | `https://graph.microsoft.us/v1.0` |
| DoD | `https://dod-graph.microsoft.us/v1.0` |
| China (21Vianet) | `https://microsoftgraph.chinacloudapi.cn/v1.0` |

GCC shares the commercial endpoint; GCC-High and DoD do not. This matters for any enterprise customer in a regulated industry.

**API versioning:** The document targets v1.0 throughout, which is correct for production use. Beta endpoint usage is not recommended (no SLA, subject to breaking changes). No issues here.

**TeamsFx deprecation** is correctly flagged with the September 2026 community-only support date. Good.

---

## Rate limits & pagination

### Rate limits

The document gives no specific numeric rate limits, which is somewhat honest — Microsoft does not publish detailed per-resource limits. However, the following are documented:

- Per-app per-tenant: throttling applied at service level; no fixed public number
- HTTP 429 with `Retry-After` header: correct
- `429` vs `503`: the document only mentions 429 but Teams Graph calls can also return `503 Service Unavailable` during throttling in some scenarios. Retry-After applies to both.

**Gap:** The document does not mention the `x-ms-rlimit-remaining-*` headers that some Graph endpoints return. These are not universally available but worth checking in implementation.

The advice to use a message queue and delta queries is sound.

### Pagination

Section 9 claims `$top` up to 999 on "most endpoints." For Teams-specific endpoints this is not accurate:

- Channel messages: max `$top` is 50
- Chat messages: max `$top` is 50
- Teams list: higher
- Users list: up to 999

The blanket "999" claim should be replaced with endpoint-specific limits.

The `@odata.nextLink` pagination description is correct. The note that `@odata.nextLink` appears both in the response header and body is slightly inaccurate — for Graph API it is in the response **body** as `@odata.nextLink`, not as a Link header (unlike some other APIs). Not a major issue but should be precise.

### Batching

The document correctly notes JSON batching (up to ~20 requests per batch). The actual documented limit is 20. "~20" is imprecise — it is exactly 20.

Reference: https://learn.microsoft.com/en-us/graph/json-batching#known-issues

---

## SDK & implementation path

### NPM package names

The document is internally inconsistent:

- Section 12.1 lists `@microsoft/graph-sdk` as the package name.
- Section 12.1's install command uses `@microsoft/graph` (not `@microsoft/graph-sdk`).
- Section 12.2 uses `@microsoft/graph` again.

The correct npm package name is `@microsoft/microsoft-graph-client` (not `@microsoft/graph` or `@microsoft/graph-sdk`). The `@microsoft/graph` package does not exist on npm in a maintained form relevant to this use case.

```
npm install @microsoft/microsoft-graph-client
```

Reference: https://www.npmjs.com/package/@microsoft/microsoft-graph-client

This is a concrete blocker — a developer following the doc will install the wrong package.

### MSAL Node

The install command lists `@microsoft/msal-node` in the npm command but the package list in 12.1 does not mention it. MSAL Node is the correct token acquisition library and should be explicitly listed with its npm name: `@microsoft/msal-node`.

### botbuilder SDK

`botbuilder` is correctly named. The package is `botbuilder` on npm (GA, v4.x). No issues.

### `@microsoft/adaptivecards-tools`

This package name is questionable. The standard package for Adaptive Cards in Node.js is `adaptivecards` or `adaptivecards-templating`. The `@microsoft/adaptivecards-tools` package does not appear to be a widely distributed npm package. The document should specify `adaptivecards` and `adaptivecards-templating`.

### Raw fetch vs SDK recommendation

The recommendation to use the Graph SDK for token caching and retry handling is sound. The note that the SDK handles `Retry-After` automatically is accurate when using the `GraphServiceClient` with a token credential provider.

### MVP config fields

The config field list in section 11 is complete and reasonable. One addition worth considering: `subscriptionRenewalIntervalMinutes` (given the 60-minute max subscription lifetime correction above, the renewal cadence becomes a critical operational parameter).

### Phase ordering

MVP, Phase 2, and Phase 3 ordering is logical. Adaptive Cards in Phase 2 is appropriate — they are non-trivial to implement correctly but not critical for basic triage. Delta query cursors in Phase 2 is the right call.

**Gap in open questions:** Question 1 ("can we use Bot Framework proactive message API with only application permissions?") — the answer is yes, but only for teams/channels where the bot app has been installed. The document should close this question with the known answer and note the installation prerequisite. This affects MVP scope.

---

## Priority fixes

1. **Bot Framework signature verification** (section 3.2): The described HMAC-SHA256 mechanism is completely wrong. Replace with JWT validation against Microsoft's public OpenID configuration. This is a security-critical correctness issue.

2. **Graph subscription max lifetime for Teams resources** (section 3.1): 4230 minutes is wrong; Teams message subscriptions max out at 60 minutes. The renewal job must run every ~45-50 minutes, not every ~3 days. This directly affects architecture.

3. **Webhook validation flow** (section 3.1): Graph sends a GET with `validationToken` query param; response must be `text/plain`. The described POST+JSON flow will cause all subscription creation attempts to fail.

4. **npm package name** (section 12.1): `@microsoft/graph-sdk` and `@microsoft/graph` are both wrong. Correct package is `@microsoft/microsoft-graph-client`. Fix the install command.

5. **Bot Framework token scope** (section 2.3): `scope=https://graph.microsoft.com/.default` is wrong for bot tokens. Must be `https://api.botframework.com/.default`.

6. **Mention implementation** (section 4.7): `<at>displayName</at>` alone does not trigger notifications. Must include the `mentions` array in the message body. Any triage flow that relies on @-mentions will silently fail without this.

7. **Admin consent URL** (section 2.3): `/oauth2/v2.0/tenantAdminConsent` does not exist as described. Replace with the correct admin consent URL pattern.

8. **$top limit inconsistency** (sections 3.3 and 9): Reconcile to correct per-endpoint limits (50 for channel/chat messages). Remove the misleading "999" blanket claim in the Teams context.

9. **App-only message send prerequisite** (section 4.1 and open question 1): Note that Bot Framework proactive messaging requires prior app installation in the team/channel. Close open question 1 with this answer.

10. **`@microsoft/adaptivecards-tools` package** (section 12.1): Verify or replace with the standard `adaptivecards` + `adaptivecards-templating` packages.
