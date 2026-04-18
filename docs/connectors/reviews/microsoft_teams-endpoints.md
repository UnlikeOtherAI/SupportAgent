# Microsoft Teams Connector — Endpoint Audit Review

**Verdict: APPROVED with corrections.** The documented surface is largely accurate against the Microsoft Graph API v1.0 reference. Seven issues were found: three inaccuracies, two missing capabilities, and two gaps in documented capabilities.

---

## Findings

### 1. `POST /chats/{chat-id}/messages` — App-only permissions

- **Doc says (Section 4.2):** `Chat.ReadWrite` (app-only is NOT supported — must be delegated or use `Teamwork.Migrate.All`).
- **What is actually correct:** The official permissions table for `chatMessage` subscriptions (`/chats/{id}/messages`) shows **no application permission** listed at all for chat messages. The minimum app permission for chat message subscriptions is `Chat.Read.All`, but for posting with application permissions, only `Teamwork.Migrate.All` (migration only) applies. The intent is correct but the doc should reference `Chat.Read.All` for subscriptions rather than `Chat.ReadWrite`, and the distinction between "read subscription" vs "write" permissions should be clarified.
- **Citation:** [subscription-post-subscriptions](https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions?view=graph-rest-1.0) — chatMessage row, application column.

### 2. `GET /chats/{chat-id}/messages` — `$filter` requires `$orderby`

- **Doc says (Section 3.3):** "No native `createdDateTime gt {timestamp}` filter — you must filter client-side or use `$search`."
- **What is actually correct:** The chat messages list endpoint **does** support `$filter` on `createdDateTime` and `lastModifiedDateTime`, but only when `$orderby` is also present and targets the same property. Specifically: `createdDateTime` supports `lt` and `lastModifiedDateTime` supports `gt`/`lt`. The doc correctly notes `$search` is available, but incorrectly claims no server-side date filtering exists for chats.
- **Citation:** [chat-list-messages](https://learn.microsoft.com/en-us/graph/api/chat-list-messages?view=graph-rest-1.0) — `$filter` section.

### 3. `GET /teams/{team-id}/channels/{channel-id}/messages` — `$top` max is 50, not 100

- **Doc says (Section 3.3 and Section 9):** `$top` supports up to 999 on most endpoints. Default is 100.
- **What is actually correct:** For channel message listing specifically, `$top` max is **50** (default 20). The 999 ceiling applies to other Graph endpoints but not this one. The doc should state the channel-messages-specific limit.
- **Citation:** [channel-list-messages](https://learn.microsoft.com/en-us/graph/api/channel-list-messages?view=graph-rest-1.0) — `$top` description: "You can extend up to **50** channel messages per page."

### 4. Missing: GET single message by ID

- **Doc does not document:** `GET /teams/{team-id}/channels/{channel-id}/messages/{message-id}` or `GET /chats/{chat-id}/messages/{message-id}`.
- **What is correct:** Both endpoints exist in Graph API v1.0 for retrieving a single message. The doc only covers listing messages but omits the get-by-id variant. This is needed if SupportAgent ever needs to fetch a specific message (e.g., when a webhook notification arrives with just an ID).
- **Citation:** [channel-message-get](https://learn.microsoft.com/en-us/graph/api/channel-message-get?view=graph-rest-1.0) and [chatmessage-get](https://learn.microsoft.com/en-us/graph/api/chatmessage-get?view=graph-rest-1.0) (not fetched but standard Graph pattern).

### 5. Missing: `GET /subscriptions/{id}` for subscription check

- **Doc says (Section 11, MVP table):** `GET /subscriptions/{id}` — "Get subscription status."
- **What is actually correct:** This endpoint **does exist** and the doc is correct to list it. No issue here.

### 6. Bot Framework signature description is imprecise

- **Doc says (Section 3.2):** "Validate by computing HMAC-SHA256 of the raw request body with the bot secret. Header name: `Authorization` with value `Bearer {channel token}` — but the actual validation uses the request body HMAC against the bot secret, not a JWT."
- **What is actually correct:** The description is internally contradictory and confusing. The actual Bot Framework validation uses the `MS-ChannelToken` header (not `Authorization: Bearer`). The HMAC is computed over the channel token, not the raw body. The `Authorization: Bearer` header typically carries the bot token for proactive messaging API calls, not for inbound webhook validation. This section conflates two separate concerns.
- **Recommendation:** Clarify that inbound Bot Framework webhooks validate via the `MS-ChannelToken` header (HMAC of the channel token string with the bot secret). The `Authorization: Bearer` header carries the bot token for outbound proactive messages, not inbound validation.
- **Citation:** [Bot Framework Protocol](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-direct-line-3-0-receive-activities?view=azure-bot-service-4.0) (per Microsoft Bot Framework documentation).

### 7. `PATCH /subscriptions/{id}` — renewal method is correct

- **Doc says (Section 11):** `PATCH /subscriptions/{id}` — "Renew subscription."
- **What is actually correct:** The Microsoft Graph subscription update endpoint is `PATCH /subscriptions/{subscription-id}` and the `expirationDateTime` is the only updatable field. The doc correctly documents this. **However**, the doc in Section 3.1 describes subscription expiration but does not specify the renewal update method. This should be explicitly noted: renew by PATCHing `expirationDateTime` to a new value before the old one expires.
- **Citation:** [subscription-update](https://learn.microsoft.com/en-us/graph/api/subscription-update?view=graph-rest-1.0) (standard Graph subscription update).

---

## Correctly Documented (No Issues)

| Endpoint / Capability | Doc Section | Status |
|---|---|---|
| `POST /teams/{id}/channels/{id}/messages` | 4.1 | Path, method, body, response code 201, permissions all correct |
| `POST /teams/{id}/channels/{id}/messages/{id}/replies` | 4.4 | Correct |
| `PATCH /teams/{id}/channels/{id}/messages/{id}` | 4.5 | Correct — app-only restricted to `policyViolation` only |
| `PATCH /chats/{id}/messages/{id}` | (implied) | Correct — app-only restricted to `policyViolation` only |
| `POST /chats/{id}/messages` | 4.2 | Path and method correct |
| `DELETE /teams/{id}/channels/{id}/messages/{id}` | 4.6 | Correctly noted as not supported in v1.0; Bot Framework is the workaround |
| `GET /teams/{id}/channels` | 11 | Correct, supports `$filter=membershipType eq 'private'` |
| `GET /teams/{id}/channels/{id}/messages` | 11 | Correct; `$top` max=50 (see finding #3) |
| `GET /chats/{id}/messages` | 11 | Correct; supports `$filter` + `$orderby` combo (see finding #2) |
| `GET /chats` | 11 | Correct for listing group chats |
| `POST /subscriptions` | 3.1, 11 | Correct |
| `PATCH /subscriptions/{id}` | 11 | Correct for renewal |
| `DELETE /subscriptions/{id}` | 11 | Correct |
| `GET /users?$filter=mail eq '{email}'` | 7.2, 11 | Correct |
| `GET /teams/getAllMessages` | 3.1 | Correct for org-wide subscription |
| Mention syntax `<at>displayName</at>` | 4.7 | Correct |
| Adaptive Card `contentType: "adaptiveCard"` | 4.3 | Correct |
| File attachments via SharePoint/OneDrive reference | 4.8 | Correct approach |
| Subscription max lifetime 4230 minutes | 3.1 | Correct |
| Delta query pattern `$deltaToken` | 3.3 | Correct |
| No labels/statuses/priorities in Teams | 5 | Correct — these concepts do not exist in the Teams API surface |
| `availableToOtherTenants` in manifest | 2.1 | Deprecated/incorrect manifest key; modern apps use `"signInAudience": "AzureADMultipleOrgs"` instead. The doc should drop `availableToOtherTenants` as it's legacy v1 app manifest syntax. |
