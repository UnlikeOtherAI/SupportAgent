# Linear Connector — Inbound Events Review

**Verdict: APPROVED WITH NOTES** — webhook and polling story is structurally correct. Three items need clarification or flagging before implementation.

---

## 1. Payload Top-Level Shape — Incomplete

**Affected section:** 3, Webhook Event Names

The document says:

> Each webhook payload includes a top-level `action` field (string) — the action value is one of `create`, `update`, `delete`, `archive`, `unarchive`.

This is true but incomplete. The actual `EntityWebhookPayload` top-level shape has more fields:

```typescript
interface EntityWebhookPayload {
  action: "create" | "update" | "delete" | "archive" | "unarchive";
  type: string; // e.g. "Issue", "Comment"
  webhookId: string;
  webhookTimestamp: number; // Unix ms, same as linear-timestamp header
  createdAt: string;
  organizationId: string;
  oauthClientId: string | null;
  appUserId: string | null;
  // plus the entity-specific data object
  data: IssueWebhookPayload | CommentWebhookPayload | ...;
}
```

**Correction:** Add `webhookId` and `webhookTimestamp` to the documented top-level shape. `webhookId` is a stable unique delivery ID per webhook invocation — this is the **correct idempotency key** for deduplication, not the entity `id`.

The document's gotcha #11 says "Same event can be delivered more than once — use `id` dedup on stored entities." This conflates two things:

1. **Idempotency** (same event processed once) → use `webhookId` as the dedup key
2. **Deduplication** (don't process the same entity twice) → use entity `id` + `updatedAt`

**The document should recommend:** Store `webhookId` on first receipt; reject subsequent deliveries with the same `webhookId`. This is a proper idempotency key. The entity `id` + `updatedAt` approach is for sync correctness, not delivery idempotency.

---

## 2. Deduplication Key — `webhookId` Not Documented

**Affected section:** 3, Webhook Event Names and gotcha #11

The document correctly notes that Linear can deliver the same webhook more than once but does not identify `webhookId` as the deduplication key.

**Correction:** Document that each webhook delivery includes a unique `webhookId`. SupportAgent should store this on first receipt and reject duplicates. Entity `id` + `updatedAt` is a fallback for sync deduplication but not sufficient for delivery deduplication.

---

## 3. Mentions — Detection Requires Body Parsing, Not a Dedicated Field

**Affected section:** 3, Webhook Event Names, and section 6 (Triggers We Can Match On)

The document correctly identifies mention detection as regex on body content:

> Mention of bot user: `IssueWebhookPayload.body` / `CommentWebhookPayload.body` containing our `@[BotName](user:bot-id)` mention syntax

**This is accurate but should be elevated to a named gap.** Unlike GitHub which has a `mentioned` array in the webhook payload, Linear delivers mentions only through the body content. There is no `mentions` array in webhook payloads.

**Correction:** Add a note:

> **Mention detection:** Linear does not include a `mentions` array in webhook payloads. Mentions arrive as markdown URN syntax `@[Name](user:user-uuid)` in the issue or comment body. SupportAgent must parse body content for this pattern to detect @mentions. No separate API lookup is required — the syntax is self-contained — but this means mention detection is purely text-based rather than structured.

---

## 4. Assign Events — Covered by Issue Update, Not a Separate Event

**Affected section:** 3, Webhook Event Names

The checklist asks whether "assign" is covered. The document does not explicitly list "assign" as a webhook event. However, Linear does not emit a separate `Issue.assign` action — assign changes arrive as `Issue` with `action: "update"` and the `assignee` field changing.

**This is correct behavior.** The trigger table entry `Issue assignee = X` → `IssueWebhookPayload.assignee` is the right approach.

**Correction:** Add a clarifying note: "Linear has no separate assign event. Assign changes are delivered as `Issue` updates. Check `data.assignee` (the new assignee) and `data.fromAssignee` or compare with previously stored assignee to detect the change."

---

## 5. Status Transition — `fromState` / `toState` Field Availability Unverified

**Affected section:** 6, Triggers We Can Match On

The trigger table says:

> Status transition: `IssueWebhookPayload.state` / `fromState` / `toState` (on update action)

The `fromState` and `toState` fields are present in Linear's GraphQL API for `Issue` updates. However, **it is not confirmed that these fields are included in webhook delivery payloads.** The SDK's `_generated_documents.ts` generates types from the API schema, but webhook delivery may omit some fields for payload size reasons.

**Correction:** Add a flag:

> **Status transition detection:** `fromState` and `toState` fields should appear in `IssueWebhookPayload` for `update` actions on state changes, but verify this against actual webhook deliveries before relying on it. As a fallback, compare `data.state` (the new state) against the previously stored state from the database.

If `fromState` is not in the webhook payload, SupportAgent must fetch the previous state from its own stored copy — which is fine, but the document should note this dependency.

---

## 6. Comment Reply — Correctly Covered, Minor Wording Fix

**Affected section:** 3, Webhook Event Names

Linear has no separate "reply" action — replies use `Comment` with `parentId` set. The document correctly shows this in section 3 under Comment webhook actions and in section 4 (Outbound) with the `parentId` field.

**No change needed.** This is correctly documented.

---

## 7. Polling — `lastSyncId` Not Explained Sufficiently

**Affected section:** 3, Polling Fallback

The document says:

> No cursor from the API itself — use `updatedAt` timestamps as pseudo-cursors. Sync by tracking `lastSyncId` from the `Subscription` response as well.

The "Subscription response" here is unclear. Linear's `Subscription` GraphQL type returns a `lastSyncId` field, but this is not the same as webhook subscription registration. The document should clarify:

**Correction:** Replace with:

> Polling fallback uses `updatedAt` timestamps as pseudo-cursors via `filter: { updatedAt: { gte: "<timestamp>" } }`. For issues, also query `subscription { lastSyncId }` periodically to get the server-side sync cursor. Use `lastSyncId` to backfill any gaps that timestamp-based polling might miss due to clock skew. Poll with a `-5m` lookback window to account for clock differences between SupportAgent and Linear.

---

## 8. Eventual Consistency — Correctly Flagged

**Affected section:** 10, Known Gotcha #12

Gotcha #12 says:

> After `issueCreate`, the created issue may not appear in `issues` queries for several seconds. Don't assume immediate consistency.

This is correctly documented. One addition: this gap also applies to comment creation and other mutations.

**Correction:** Extend gotcha #12: "Eventual consistency applies to all write operations (issue creation, comment creation, status changes, etc.). After any mutation, wait at least 2–5 seconds before querying the affected entity. If a subsequent webhook is expected but not received within 10 seconds, trigger a reconciliation poll."

---

## 9. Loop Prevention — `botActor` Correct, `creator` Sufficient

**Affected section:** 3, What We Need for no_self_retrigger

The document correctly identifies `botActor.id` as the field for detecting app-authored comments, and `creator.id` as the stable identifier for self-comparison.

One clarification: the document says "Our connector should identify itself as an app user." Linear app users (OAuth bots) have `User.app: true` and can be identified by `appUserId` in the webhook payload top-level shape. This is an additional signal beyond `botActor`.

**Correction:** Add to section 3:

> For loop prevention, the webhook payload top-level `appUserId` field is set when the delivery is for a comment or action originating from our app. This is a strong signal — if `appUserId === process.env.LINEAR_APP_USER_ID`, the event is from our own app. `botActor.id === process.env.LINEAR_APP_USER_ID` provides the same signal for comments posted by our app user. Both can be checked; `appUserId` at the top level is preferred as it doesn't depend on the entity type.

---

## 10. No Missing Events — Correct

**Affected section:** 3, Webhook Event Names

Checking against the required events:

| Required event | Linear webhook | Status |
|---|---|---|
| New item (Issue) | `Issue` + `action: "create"` | ✓ |
| New comment | `Comment` + `action: "create"` | ✓ |
| Comment edit | `Comment` + `action: "update"` | ✓ |
| Comment delete | `Comment` + `action: "delete"` | ✓ |
| Status change | `Issue` + `action: "update"` with state diff | ✓ (see note #5) |
| Label add/remove | `Issue` + `action: "update"` with `labelIds` diff | ✓ |
| Mention | Body content parsing for `@[Name](user:user-id)` | ✓ (see note #3) |
| Reply | `Comment` + `action: "create"` with `parentId` | ✓ |
| Close/resolve | `Issue` + `action: "archive"` or state change to completed | ✓ |
| Assign | `Issue` + `action: "update"` with assignee diff | ✓ (see note #4) |

All required events are covered or derivable from covered events.

---

## 11. Signature Verification — Correct

**Affected section:** 3, Signature Verification

The document states:
- Header: `linear-signature`
- Algorithm: HMAC-SHA256 hex
- Timestamp header: `linear-timestamp`
- Tolerance: 60 seconds
- SDK helper: `LinearWebhookClient` from `@linear/sdk/webhooks`

All of this is correct based on the SDK source code.

One minor addition: the document says "Linear generates it, or you provide one" for the webhook secret. This is accurate — `webhookCreateFromEndpoint` accepts a `secret` parameter, or Linear generates one if omitted.

---

## 12. Delivery Guarantees — Correct

**Affected section:** 3, Retry / Delivery Semantics

The document says:
- Exponential backoff retry (up to ~24h)
- 2xx = success
- No dead-letter queue
- At-least-once delivery (same event can be delivered twice)

All of this is correctly documented. The gotcha about replay (gotcha #11) is correctly placed as a known limitation.

---

## Summary

**Approved with notes.** The webhook and polling story is fundamentally sound. The three items requiring action:

1. **Document `webhookId` as the idempotency key** — this is the proper dedup mechanism, not entity `id`
2. **Flag `fromState`/`toState` field availability in webhook payloads as unverified** — add fallback strategy using stored state
3. **Elevate mention detection to a named gap** — it's body-parsing only, not a structured field

The rest are minor clarifications that improve precision without changing the implementation approach.
