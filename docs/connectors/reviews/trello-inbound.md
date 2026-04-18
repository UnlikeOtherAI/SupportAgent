# Trello Connector — Inbound Events Review

**Reviewer:** Claude Code
**Date:** 2026-04-18
**Scope:** Webhook intake, polling fallback, event completeness, signature verification, delivery semantics
**Source:** `docs/connectors/trello.md`

---

## Verdict: Needs Fixes

The event list is largely correct and the payload shape is accurate. Six issues require correction before implementation: HMAC secret undefined, no replay protection documented, `moveCardToList` sub-event ambiguity, reply detection gap, a type in the trigger table, and a critical delivery gap. All other items pass or are correctly noted as platform limitations.

---

## 1. HMAC Secret — Name Correct, Documentation Ambiguous

**Affected sections:** Lines 100–103, line 807 (Quick Reference)

**What the doc says:**
> "Algorithm: base64(HMAC-SHA1(appSecret, JSON.stringify(body) + callbackURL))"

**Problem:** `appSecret` is never defined. The trello-auth review already flagged this from the auth angle. From the inbound intake angle, the additional problem is that the algorithm description uses one ordering of the concatenated data but doesn't confirm whether `body` should be stringified before or after concatenation, and critically, whether the secret is the **token** or the **API key**.

**Concrete correction — Lines 100–103, replace with:**
```
HMAC verification:
- Header: X-Trello-Webhook
- Algorithm: HMAC-SHA1 (RFC 2104)
- Signed content: UTF-8 string of (raw body bytes as text) + callbackURL string, concatenated
- Secret: the token secret (same value as apiToken for tokens obtained via simple token flow)
- Compare: base64-encode the HMAC-SHA1 of the signed content using the token secret;
  reject if it does not match the X-Trello-Webhook header value
```

**Quick Reference correction (line 807):**
```
Webhook HMAC: base64(HMAC-SHA1(tokenSecret, body_text + callbackURL))
where tokenSecret === apiToken (for simple token flow tokens)
```

---

## 2. Replay Protection — Missing

**Affected section:** Section 3.1, HMAC Verification block

The document does not mention replay protection at all. Trello does not include a timestamp in the HMAC signature or a separate delivery ID header. There is no timestamp-based freshness window.

**Correction — Add after the HMAC verification block:**
```
Replay protection: Trello does not include a timestamp in webhook signatures and
provides no delivery UUID. There is no server-enforced freshness window.
SupportAgent must deduplicate by action ID (action.id field, unique per action).
If the same action ID is received twice, treat the second as a duplicate.
```

This is consistent with how Trello delivers — each `createCard`, `commentCard`, etc. action has a unique `id` and fires at most once per delivery attempt (3 retries on failure, no dead-letter visibility).

---

## 3. `moveCardToList` — Verify as Distinct Event vs UpdateCard Subtype

**Affected section:** Lines 134, 457

The document lists `moveCardToList` as a distinct event type (line 134 in the event table, line 457 in the trigger matcher). It also lists `updateCard` as a separate event type (line 123, line 462).

**Potential issue:** Trello may fire `updateCard` with a `data.listAfter` / `data.listBefore` structure when a card moves between lists, rather than firing a separate `moveCardToList` event. In this case, `moveCardToList` would be a sub-type of `updateCard` detectable only by checking for the presence of `data.listAfter` in the `updateCard` payload.

**Evidence:** The trigger table in section 6 separates `moveCardToList` from `updateCard`, but the webhook event types table in section 3.2 also lists `moveCardToList` separately. The Trello webhook notification payload documentation shows `data.listAfter` and `data.listBefore` fields on action objects, which is the canonical way to detect list moves within `updateCard`.

**Concrete correction — verify and clarify:**
```
In the webhook event types table (line 134), add a note:
"moveCardToList is detected within updateCard via data.listAfter/data.listBefore
presence check. Verify: Trello may also fire a distinct moveCardToList action type.
If both exist, prefer data.listAfter presence check on updateCard for maximum coverage."

In the trigger matcher (line 457), clarify:
"Card moved to list:
  - action.type === 'updateCard' AND action.data.listAfter exists → list move (preferred)
  - action.type === 'moveCardToList' → list move (verify this event type exists)"
```

If `moveCardToList` is confirmed as a distinct event type, no change needed. If it is only a sub-type of `updateCard`, the trigger matcher entry should be collapsed.

---

## 4. Reply Detection — No Structured Parent-Child in Webhook

**Affected section:** Section 6, Trigger Matcher; Section 3.2

Trello has no threaded reply concept in its card model. All comments on a card are flat `commentCard` actions. Trello does not expose a parent comment ID in the `commentCard` webhook payload.

**What the doc implies:** The trigger table has no "reply" row explicitly. The `commentCard` trigger matcher correctly captures all comments.

**Gap:** If a tenant expects to distinguish "top-level comments" from "replies," this is not possible from the webhook payload alone. There is no `parentId`, `inReplyTo`, or threading metadata.

**Correction — Add to Section 6 trigger matcher:**
```
| Card comment | action.type === "commentCard" | Inbound comment (flat — no reply threading in Trello) |
```

**No structured fix available.** Trello cards are flat. If tenants need threading, it must be implemented at the SupportAgent layer (e.g., by correlating comment timestamps or using external tooling).

---

## 5. Comment Edit Detection — No Edit Event

**Affected section:** Section 3.2, Event Types

Trello has no comment edit endpoint (`PUT /1/actions/{actionId}`). If a user edits a comment via the Trello UI, the only API workaround is delete + recreate. The `commentCard` webhook fires for new comments. Deleting a comment fires the action (type: `deleteComment`? verify — this is not documented as a webhook event type in the doc).

**Gap:** No separate `commentEdited` event type exists. Edited comments are not distinguishable from new comments via webhook payload without checking whether the action ID is new or a previously seen ID being "re-created."

**Correction — Add to event types table:**
```
| deleteComment | Comment deleted | Archive detection for comments |
```

And note: "Trello does not fire a comment edit webhook. If a comment is edited via UI, no webhook is delivered. If the comment is deleted and recreated as a workaround, two separate commentCard events fire."

---

## 6. Type in Trigger Table — `removeLabelToCard` vs `removeLabelFromCard`

**Affected section:** Line 459

**What the doc says:**
> `removeLabelToCard` — missing `From`

**Problem:** Line 130 of the document correctly uses `removeLabelFromCard` (with `From`). Line 459 uses `removeLabelToCard` (with `To`). This is a typo that will cause the trigger matcher to never match the label removal event.

**Concrete correction — Line 459:**
```
| Label removed | action.type === "removeLabelFromCard" | — |
  (was removeLabelToCard — typo)
```

---

## 7. Webhook Delivery Guarantee — Critical Gap

**Affected section:** Section 3.1, Retry Semantics (lines 111–114)

The document states:
> "3 retries: 30s, 60s, 120s (exponential backoff)"
> "Disabled after 30 consecutive failures"

**Missing:** What happens to events that fail all 3 retries and are then lost because the webhook is disabled? There is no API to list failed deliveries, no dead-letter queue, and no visibility into dropped events. A tenant whose webhook is disabled (e.g., SupportAgent downtime) silently loses all events until the webhook is re-enabled.

**Correction — Add after line 114:**
```
Dead-letter gap: Trello does not provide an API to retrieve failed webhook deliveries.
If SupportAgent endpoint is down and 30 consecutive deliveries fail, the webhook is
auto-disabled and all subsequent events are silently dropped until manually re-enabled.
There is no server-side event log. A polling fallback is essential to cover gaps
during downtime.
```

This matches the pattern from the GitHub-inbound review (finding #12) and Jira-inbound review (implied).

---

## 8. Polling — Comment-Specific Filter Missing

**Affected section:** Section 3.4, Polling Fallback (lines 178–183)

The document recommends polling with:
```
GET /1/boards/{boardId}/actions?limit=100&page=0&filter=createCard,commentCard,updateCard,...
```

**Gap:** The `filter` param restricts action types but Trello returns all matching action types in one response. There is no way to poll only `commentCard` actions without also fetching `createCard`, `updateCard`, etc. This means polling for "new comments on existing cards" always requires fetching all action types and filtering client-side.

**Correction — Add after line 181:**
```
Comment-only polling: There is no endpoint to poll only commentCard actions.
The /actions endpoint with filter=... returns all filtered action types together.
To detect new comments on existing items, fetch all actions and filter by
action.type === "commentCard" client-side. There is no efficient comment-only query.
```

Also note in section 3.4: The polling strategy uses `since` param for timestamp filtering. This is correct. Actions are sorted reverse-chronological (newest first), no ascending sort available.

---

## 9. Bot Loop Prevention — Correct

**Affected section:** Section 7.3 (lines 499–509)

The `no_self_retrigger` strategy is correctly documented:
1. Store `idMemberCreator` from our own comment/activity actions
2. On webhook receipt, check `action.idMemberCreator` against stored bot member IDs
3. Reject if it matches

The bot member ID lookup via `GET /1/tokens/{token}/member` is also correctly documented.

**No correction needed.** This is accurate.

---

## 10. Mention Detection — Correct, No Structured Field

**Affected section:** Section 6, Trigger Matcher (line 466)

The document correctly identifies:
> Mention of bot: `action.data.text` contains `@{botUsername}` — regex

Trello does not include a structured `mentions` array in webhook payloads. There is no separate API lookup needed — the `@username` pattern is self-contained in the comment text.

**No correction needed.** This is accurate. Document as-is.

---

## 11. Webhook Payload Shape — Correct

**Affected section:** Section 3.3

The documented payload shape is:
```json
{
  "action": { ... },
  "model": { ... },
  "webhook": { ... }
}
```

**Verification:** Top-level keys are `action`, `model`, and `webhook` — all correct. The `model` field contains the board (or other model) the webhook was registered on. The `webhook` field contains the webhook's own metadata.

**No correction needed.** Shape is accurate.

---

## 12. Eventual Consistency — Pass with Note

**Affected section:** Section 3 (not explicitly present)

Unlike GitHub (where `issues.opened` may return 404 via API before the webhook fires) and Jira (where comment creation webhook has a 2–10s delay), Trello fires webhooks synchronously with the action. After a `createCard` action fires, the card is readable via `GET /1/cards/{cardId}` immediately. No API read lag.

**No correction needed.** The absence of an eventual consistency note is accurate for Trello.

---

## 13. Event Completeness — All Required Events Covered

**Affected section:** Section 3.2, 6

| Required event | Trello webhook | Status |
|---|---|---|
| New item | `createCard` | ✓ |
| New comment | `commentCard` | ✓ |
| Status change | `moveCardToList` (verify) or `updateCard` + `data.listAfter` | ✓ (see finding #3) |
| Label add | `addLabelToCard` | ✓ |
| Label remove | `removeLabelFromCard` | ✓ (see finding #6) |
| Mention | `commentCard` + regex `@{username}` in `action.data.text` | ✓ (see finding #10) |
| Reply | No structured reply — all comments are flat `commentCard` | ✓ (see finding #4) |
| Close/resolve | `updateCard` + `data.card.closed=true` | ✓ |
| Assign | `addMemberToCard`, `removeMemberFromCard` | ✓ |

All required events are covered or correctly identified as platform gaps.

---

## Summary Table

| # | Area | Severity | Issue | Correction |
|---|---|---|---|---|
| 1 | HMAC secret | Medium | `appSecret` undefined; ordering ambiguous | Clarify: token secret, not API key; confirm concatenation order |
| 2 | Replay protection | Medium | No timestamp, no delivery UUID in signature | Add note: deduplicate by action.id; no server freshness window |
| 3 | `moveCardToList` | Medium | May be sub-type of `updateCard`, not distinct event | Verify; update trigger matcher to check `data.listAfter` on `updateCard` |
| 4 | Reply detection | Low | No parent/child threading in Trello | Add note: flat comment model, no reply distinction in webhook |
| 5 | Comment edit | Low | No edit event; edit = delete+recreate | Add `deleteComment` event type; note no edit webhook |
| 6 | Trigger table type | Medium | `removeLabelToCard` typo → will never match | Fix to `removeLabelFromCard` |
| 7 | Delivery guarantee | High | No dead-letter, silent drop on webhook disable | Add dead-letter gap warning |
| 8 | Polling comment filter | Low | No comment-only poll endpoint | Add note: filter client-side; no efficient comment-only query |
| 9 | Bot loop prevention | Pass | — | Correct as documented |
| 10 | Mention detection | Pass | — | Correct as documented |
| 11 | Payload shape | Pass | — | Correct as documented |
| 12 | Eventual consistency | Pass | — | Correctly absent (no EC gap in Trello) |
| 13 | Event completeness | Pass | — | All required events covered or correctly flagged |

---

## Priority Actions

**Must fix before implementation:**
1. Clarify HMAC secret (finding #1)
2. Add replay protection note (finding #2)
3. Fix `removeLabelToCard` typo (finding #6)
4. Add delivery dead-letter warning (finding #7)

**Should verify before implementation:**
5. Confirm `moveCardToList` as distinct event vs `updateCard` sub-type (finding #3)
6. Verify `deleteComment` is a valid webhook event type (finding #5)

**Enhancements (platform limitations, not doc errors):**
7. Note flat comment model for reply detection gap (finding #4)
8. Note no comment-only polling endpoint (finding #8)