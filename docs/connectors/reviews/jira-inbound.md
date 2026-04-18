# Jira Connector — Inbound Events Review

**Verdict: APPROVED WITH NOTES** — webhook and polling story is structurally sound. Six items need clarification, correction, or flagging before implementation.

---

## 1. Signature Verification Format — Incomplete

**Affected section:** 3.1, Signature Verification (lines 156–172)

The document says:

> Header: `X-Hub-Signature` (format: `method=signature`)
> Algorithm: HMAC-SHA256

This is correct but the format description is ambiguous. The actual format per the WebSub spec is `sha256=<hex_digest>`, not a general `method=signature` pattern.

**Correction:** Update lines 158–159 to:

```markdown
- **Header:** `X-Hub-Signature`
- **Format:** `sha256=<hmac_hex_digest>` (WebSub specification)
- **Algorithm:** HMAC-SHA256
- **Signed content:** Raw request body bytes only
```

The document's example (lines 166–172) is correct and should be retained as-is — it shows `sha256=a4771c39fbe90f...` which is the right format.

---

## 2. Timestamp Tolerance / Replay Protection — Missing

**Affected section:** 3.1, Signature Verification

The document does not mention any timestamp-based replay protection. Jira Cloud does not enforce a timestamp tolerance window — the signature is purely HMAC(body, secret). There is no `X-Hub-Signature-256` equivalent with timestamp inclusion.

**Correction:** Add to signature verification section:

> **Replay protection:** Jira Cloud does not include a webhook timestamp in the signature. Replay protection relies entirely on the `X-Atlassian-Webhook-Identifier` header (unique per delivery, preserved across retries). SupportAgent should track received identifiers and reject duplicates. No timestamp tolerance window applies.

---

## 3. Mention Detection — Requires ADF Body Parsing, Not a Dedicated Field

**Affected section:** 3.1, Event Types (table); section 6.1, Trigger Attributes; section 6.3, Event Field Availability

The document mentions "Mention" in the trigger table (line 569):

> Mention: Match on `comment.body` containing mention ADF node

This is accurate — Jira does not include a `mentions` array in webhook payloads. There is no structured field indicating who was @mentioned. Mentions arrive only as `mention` nodes within the Atlassian Document Format (ADF) body.

**Correction:** Add a named gap note in section 6.1:

> **Mention detection (gap):** Jira webhook payloads do not include a dedicated `mentions` field. To detect @mentions, SupportAgent must parse the ADF `comment.body` (or `issue.fields.description`) looking for nodes of type `mention` with an `attrs.id` matching our bot's `accountId`. Example ADF node:
> ```json
> { "type": "mention", "attrs": { "id": "712020:abc123", "text": "@SupportBot" } }
> ```
> No separate API lookup is required — the mention syntax is self-contained in the body. However, this means mention detection is purely text/tree-based rather than using a structured field.

Also update section 6.3 Event Field Availability table to add a row:

| Event | Available Fields |
|---|---|
| `comment_created` / `comment_updated` | Comment object + issue key; **no dedicated mentions field — parse `body.content[].type === "mention"`** |

---

## 4. Polling Cursor Strategy — Wrong Pagination Model

**Affected section:** 3.1, Polling Fallback Strategy (lines 185–199)

The document says:

> **Pagination:** `nextPageToken` for forward-only cursor pagination

This is incorrect. Jira Cloud REST API v3 uses **offset-based pagination**, not cursor pagination. There is no `nextPageToken` in responses.

**Correction:** Replace lines 196–199 with:

> **Pagination:** Offset-based with `startAt` and `maxResults`. Jira returns:
> ```json
> { "startAt": 0, "maxResults": 50, "total": 1234, "isLast": false, "values": [...] }
> ```
> Set `startAt` to `startAt + maxResults` for the next page. Stop when `isLast: true` or `startAt >= total`.
>
> There is no server-side cursor. Track your own `lastUpdated` timestamp cursor between polling runs. For comments on existing issues, use `updated >= lastSyncTimestamp` with JQL.

Note: The JQL example on line 189 is correct (`updated >= '2024-01-01 00:00' ORDER BY updated ASC`).

---

## 5. Bot-authored Content Loop Prevention — Not Documented

**Affected section:** 3.1, Webhook Event Names; section 3.2, Payload Fields to Persist

The document does not explain how SupportAgent can detect and filter out its own bot-authored content to prevent loop retriggering.

**Correction:** Add to section 3.2 after the `User` interface:

> **Loop prevention (bot-authored content):** When SupportAgent posts comments via the Jira API using an API token, the `author.accountId` in webhook deliveries will match the API token owner's account ID. SupportAgent should:
>
> 1. Store its own `accountId` in connector config
> 2. On every incoming event (`comment_created`, `jira:issue_created`), check `event.user.accountId === config.ownAccountId` or `event.comment.author.accountId === config.ownAccountId`
> 3. If matched, skip processing — the event originated from SupportAgent
>
> Note: If using OAuth user context, the author will be the authorizing user's account ID, not a bot service account. In that case, add a marker label (e.g., `support-agent-source`) to bot-created issues and filter via JQL.

---

## 6. Eventual Consistency — Add Comment Creation Gap

**Affected section:** 10, Known Gotcha #12 (lines 771–777)

Gotcha #12 correctly flags that project deletion does not trigger `issue_deleted` webhooks and that cascade operations have up to 15-minute secondary delivery delays.

**Correction:** Add two more gaps to the webhook limitations section:

> **Issue created via UI dialog:** When an issue is created through the Jira UI's "Create Issue" dialog (not the REST API), associated actions (e.g., attachment creation) may not trigger separate webhooks. Assume single-issue creation webhooks are fired, but attachments added in the same dialog flow may not have a corresponding `attachment_created` event.
>
> **Eventual consistency on comment creation:** After posting a comment via API, the `comment_created` webhook may not be delivered for 2–10 seconds. If SupportAgent expects a webhook after its own write and does not receive one within 15 seconds, trigger a reconciliation poll against `GET /rest/api/3/issue/{key}/comment`.

---

## 7. Missing Event — `issuelink_deleted` Not `issuelink_created` Only

**Affected section:** 3.1, Event Types table (lines 144–154)

The table lists only `issuelink_created`. Jira also fires `issuelink_deleted` when a link is removed.

**Correction:** Add `issuelink_deleted` to the events table and the webhook registration example.

---

## 8. `jira:issue_deleted` Gaps — Correctly Flagged, Could Be Clearer

**Affected section:** 10, Known Gotcha #12; section 3.1

The document correctly notes in line 773: "Project deletion does not trigger `issue_deleted` webhooks."

This is correctly documented. One addition:

**Correction:** Extend the gotcha:

> **`issue_deleted` gaps:** Project deletion cascades without firing `issue_deleted`. Additionally, when an issue is permanently deleted (not just moved to trash), no webhook is sent. SupportAgent should track `issue_id` values for all known issues and treat missing issues in polling results as implicit deletions after verification.

---

## 9. Status Change Detection — `changelog` Correctly Documented

**Affected section:** 3.1, Appendix B example (lines 1023–1057); section 6.3, Event Field Availability

The changelog example correctly shows status transition detection via `changelog.items[].field === "status"` with `fromString` and `toString`.

This is correct. No change needed.

---

## 10. Assign Detection — Covered by `jira:issue_updated`

**Affected section:** 3.1, Event Types; section 6.1, Trigger Attributes

Jira has no separate assign webhook. Assign changes arrive as `jira:issue_updated` with `changelog.items[].field === "assignee"`.

**This is correctly documented** in section 6.1:
> Assignee change: `assignee was "user@example.com"`

No change needed.

---

## 11. All Required Events Covered — Correct

**Affected section:** 3.1

Checking against the required event list:

| Required event | Jira webhook | Status |
|---|---|---|
| New item (issue) | `jira:issue_created` | ✓ |
| New comment | `comment_created` | ✓ |
| Comment edit | `comment_updated` | ✓ |
| Comment delete | `comment_deleted` | ✓ |
| Status change | `jira:issue_updated` + changelog `field === "status"` | ✓ |
| Label add/remove | `jira:issue_updated` + changelog `field === "labels"` | ✓ |
| Mention | ADF body parsing for `type === "mention"` | ✓ (see note #3) |
| Reply | `comment_created` (replies are comments with `parentId`) | ✓ (parentId in comment body, not webhook) |
| Close/resolve | `jira:issue_updated` + changelog `field === "resolution"` | ✓ |
| Assign | `jira:issue_updated` + changelog `field === "assignee"` | ✓ |

All required events are covered or derivable.

---

## 12. Delivery Guarantees — Correct

**Affected section:** 3.1, Retry / Delivery Semantics (lines 174–183)

The document correctly states:
- Up to 5 retries with randomized 5–15 minute backoff
- Trigger conditions: HTTP 408, 409, 425, 429, 5xx, connection failures
- Primary delivery within 30 seconds, Secondary within 15 minutes
- Concurrency limits: 20 primary + 10 secondary per tenant/URL pair
- `X-Atlassian-Webhook-Identifier` for deduplication

All of this is accurate per official documentation.

---

## 13. Webhook JQL Filtering — Correct

**Affected section:** 3.1, Webhook Registration (lines 124–126); section 6.2, Webhook JQL Filtering

The JQL filter example is correct. Note: Jira webhooks do not support JQL for sprint, version, or board events. This is a platform limitation, not a doc error — the document could note this under Known Gotchas.

**Correction:** Add to section 10:

> **JQL filter limitations:** Webhook JQL filtering does not apply to `sprint_*`, `jira:version_*`, or `board_*` events. These events will be delivered regardless of JQL filters. If only certain sprints or boards are relevant, filter in SupportAgent's event handler.

---

## Summary

**Approved with notes.** The webhook and polling story is fundamentally correct. The six items requiring action:

1. **Fix signature format description** — clarify `sha256=<hex>` format explicitly
2. **Add replay protection note** — Jira uses identifier-based dedup, no timestamp tolerance
3. **Elevate mention detection to named gap** — requires ADF body parsing, no structured field
4. **Fix pagination description** — Jira uses offset-based, not cursor pagination
5. **Document bot-authored loop prevention** — check `author.accountId` against own accountId
6. **Add comment creation eventual consistency gap** — 2–10 second webhook delay after writes

The remaining items are minor clarifications or platform limitations that should be documented as gotchas. The core inbound event story is sound.
