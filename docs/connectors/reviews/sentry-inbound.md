# Sentry Connector — Inbound Events Review

**Reviewer scope:** webhook intake completeness, payload shape accuracy, signature verification, replay protection, delivery guarantees, polling fallback, mention detection.
**Source:** `docs/connectors/sentry.md`
**Date:** 2026-04-18

---

## Verdict: APPROVED WITH CORRECTIONS

The document is structurally sound. The webhook/polling story is coherent and the signature/retention semantics are accurate. Four items require correction or explicit flagging before implementation.

---

## 1. Issue Webhook Payload — Documented Subset vs. Actual Payload

**Affected section:** 3a, Issue Webhook Payload (lines 117–148)

The documented example shows only 7 fields in `data.issue`: `id`, `url`, `web_url`, `project_url`, `status`, `substatus`, `issueType`, `issueCategory`.

Per the official Sentry Integration Platform webhook docs, the issue webhook payload includes a **significantly wider set of fields**:

```
id, url, web_url, project_url, shareId, shortId, title, culprit, permalink,
logger, level, status, statusDetails, substatus, isPublic, platform, project,
type, metadata, numComments, assignedTo, isBookmarked, isSubscribed,
subscriptionDetails, hasSeen, annotations, issueType, issueCategory,
priority, priorityLockedAt, seerFixabilityScore, seerAutofixLastTriggered,
isUnhandled, count, userCount, firstSeen, lastSeen
```

**Key fields present in the webhook that the document omits:**
- `assignedTo` — confirmed present in official docs
- `title` — confirmed present in official docs
- `shortId` — confirmed present in official docs
- `priority` — confirmed present in official docs
- `count` — confirmed present in official docs
- `annotations` — confirmed present in official docs

**Fields that remain absent even in the full webhook:**
- `tags` — not in webhook; must be fetched via `GET /api/0/issues/{issue_id}/tags/`
- `user` — not in webhook; actor info is in `actor` (top-level), not embedded in issue
- `first_release` — not in webhook

**Correction:** The section 3a example payload should be replaced with the actual fields Sentry delivers. The list in §10e (gotcha #10e) partially corrects this but the example in §3a still shows the wrong field set. Update the example to:

```json
{
  "action": "created",
  "installation": { "uuid": "24b...280" },
  "data": {
    "issue": {
      "id": "1234567890",
      "shortId": "SENTRY-123",
      "title": "ConnectionError: Failed to fetch",
      "url": "https://sentry.io/api/0/organizations/example-org/issues/1234567890/",
      "web_url": "https://example-org.sentry.io/issues/1234567890/",
      "project_url": "https://example-org.sentry.io/issues/?project=4509877862268928",
      "project": { "id": "450987...", "name": "my-project", "slug": "my-project" },
      "status": "unresolved",
      "substatus": "new",
      "assignedTo": null,
      "priority": "high",
      "count": "47",
      "userCount": 3,
      "annotations": [],
      "culprit": "setup/index.ts in main",
      "logger": "",
      "level": "error",
      "isUnhandled": false,
      "issueType": "error",
      "issueCategory": "error",
      "metadata": { ... }
    }
  },
  "actor": { "type": "application", "id": "supportagent-integration", "name": "SupportAgent" }
}
```

Also update the "Fields to persist" bullet list to include `title`, `shortId`, `assignedTo`, `priority`, `count`, `userCount`.

---

## 2. Tag/Label Events — No Webhook Exists; Document Correctly Flags This

**Affected section:** 3a, Webhook Event Types table (line 85–93)

The document correctly omits a tag-change webhook event. Sentry has no webhook for tag additions or removals — tags are attached to individual Events (crash occurrences), not to Issues, and Sentry does not emit a webhook when a tag is added to an Event.

The document correctly handles this by:
- Marking the `error` resource as "No (use polling)" — this is where tag changes originate
- Section 4g documenting tag CRUD via API
- Section 5 documenting tags as the label equivalent

**No change required.** This is correctly documented.

---

## 3. `assigned` Action — Verification Needed

**Affected section:** 3a, Webhook Event Types table, line 87

The document lists `assigned` as an issue webhook action. The official webhook docs confirm `assignedTo` exists in the issue payload, but the explicit list of issue webhook actions (`created`, `resolved`, `archived`, `unresolved`) is not fully enumerated in the public docs. The source of `assigned` as a separate action is the document itself, not a verified Sentry source.

**Correction:** Add a note flagging uncertainty:

> The `assigned` action is documented based on Sentry's `assignedTo` field appearing in the issue payload and the `assigned` action being referenced in SupportAgent's trigger matrix. Confirm via actual webhook delivery testing whether Sentry emits `action: "assigned"` or whether assignment changes arrive as `action: "updated"` with only the `assignedTo` field changing. The trigger matrix should support both patterns as a fallback.

---

## 4. Polling Fallback — Comment Detection Gap on Existing Issues

**Affected section:** 3b, Polling Fallback (lines 174–202)

The document describes polling `GET /api/0/organizations/{org}/issues/` with `is:unresolved` and `statsPeriod=1h`. This catches new issues and re-opened issues.

**Gap:** New comments on **existing, unchanged** issues will not trigger a poll event if the issue's `updatedAt` does not change when a comment is added. (Note: Sentry's issue `updated_at` typically does update when comments are added, but this is not guaranteed and is not explicitly documented.)

**Correction:** Add a polling strategy for comments:

> **Detecting new comments on existing issues:** Sentry issues update their `lastEvent` timestamp and related metadata when comments are added, but the issue-level `updated_at` change is the reliable signal. Poll `GET /api/0/organizations/{org}/issues/?statsPeriod=1h` to get recently updated issues, then for each, fetch `GET /api/0/issues/{issue_id}/comments/` and diff against stored state. Alternatively, on each issue webhook or poll cycle, fetch comments for that issue and check for new `comment_id`s not in the stored set.

This is consistent with the document's approach in Section 10c (dedup by `comment_id`) but the polling strategy section should make the comment-detection mechanism explicit.

---

## 5. No Reply Event — Correctly Documented

**Affected section:** 3a, Webhook Event Types; section 4 outbound

Sentry comments are flat — there is no reply threading. The document correctly shows only `created`, `updated`, `deleted` actions for the `comment` resource. No separate reply event exists.

**No change required.** This is correctly documented.

---

## 6. Mention Detection — Correct, Should Be Named as a Gap

**Affected section:** 6, Triggers We Can Match On (lines 434–443)

The document correctly identifies that Sentry has no @mention system and that comment body parsing is required. Section 6 says:

> "Contains @-mention of bot: `data.comment` contains `@supportagent`"

**This is accurate.** Sentry does not include a `mentions` array in webhook payloads. Mentions arrive as plain text patterns in the `data.comment` field.

**Correction:** Elevate this to a named gap:

> **Mention detection:** Sentry has no structured mention system. There is no `mentions` field in comment webhook payloads. Detection requires regex scanning of `data.comment` for `@supportagent` (or whichever bot name is configured). No separate API lookup is needed — the comment body contains the full text. This is a text-based detection only; there is no guaranteed "bot was mentioned" signal beyond string matching.

---

## 7. Signature Verification — Correct

**Affected section:** 3a, Signature Verification (lines 94–108)

- Header: `Sentry-Hook-Signature` ✅
- Algorithm: HMAC-SHA256 ✅
- Input: raw request body as UTF-8 JSON string ✅
- Timestamp header: `Sentry-Hook-Timestamp` ✅
- Tolerance: >5min old → reject ✅

**Verification logic example** (lines 99–106): The code uses `JSON.stringify(requestBody)` which could produce inconsistent results if `requestBody` is already a string (double-stringify) vs an object. The correct approach is:

```js
// If requestBody is a Buffer/string from raw body:
const hmac = crypto.createHmac('sha256', clientSecret);
hmac.update(requestBody); // raw bytes
const digest = hmac.digest('hex');

// If requestBody is a parsed object:
const hmac = crypto.createHmac('sha256', clientSecret);
hmac.update(JSON.stringify(requestBody), 'utf8'); // must specify utf8 encoding
const digest = hmac.digest('hex');
```

**Correction:** Clarify the verification to handle both string and object inputs:

> Webhook signature verification must use the **raw request body bytes** (before JSON parsing). If using Express or similar framework, read `req.rawBody` or `req.body` as a Buffer/string. Never re-serialize a parsed object — `JSON.stringify()` can produce different whitespace/ordering than the original bytes Sentry signed.

---

## 8. Replay Protection — Correct

**Affected section:** 3a, Signature Verification, line 107

The document correctly specifies:
- `Sentry-Hook-Timestamp` (Unix seconds)
- Reject if >5min old

5 minutes is a reasonable tolerance. This is correctly documented.

---

## 9. Delivery Guarantees — Correct, Minor Gap

**Affected section:** 3a, Retry / Delivery Semantics (lines 110–116)

- Retry with exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s (6 retries) ✅
- 2xx = success; anything else = failure ✅
- After retries fail, webhook marked as failing but not permanently dropped ✅

**Minor gap:** The document says "It does **not** drop the webhook permanently" but does not clarify whether Sentry re-attempts indefinitely or eventually stops. Based on Sentry's behavior, failed webhook deliveries are retried indefinitely with the same backoff schedule on each attempt, but the integration can be manually re-enabled. The document should note:

> **Delivery guarantee:** At-least-once. After 6 retries fail, Sentry marks the webhook integration as failing and stops delivering to that endpoint until re-enabled. There is no dead-letter queue or API to list failed deliveries. A polling fallback is required to cover gaps when the webhook endpoint is disabled.

---

## 10. Loop Prevention / Bot Filter — Correct, Verify `assignedTo` Availability

**Affected section:** 7, Identity Mapping (lines 500–521)

The document correctly describes:
- `actor.type === "application"` for app-initiated actions ✅
- `actor.name` matching integration name for self-triggered issue events ✅
- Comment self-trigger detection via `data.actor.id === bot_user_id` ✅

One verification needed: The document says `data.issue.assigned_to` for detecting "assigned to bot" (line 446, 474), but the actual webhook field is `assignedTo` (camelCase, no underscore) per official docs. Also, the issue webhook may not always include `assignedTo` if the assignment was done by a different user without triggering a separate `assigned` action event.

**Correction:** Note in section 7:
> `assignedTo` is camelCase in the webhook payload (not `assigned_to`). Verify via test delivery that `assignedTo` appears in the issue webhook when an assignment occurs, or fall back to fetching `GET /api/0/issues/{issue_id}/` after the webhook to get the current assignee.

---

## 11. Eventual Consistency — Correctly Flagged

**Affected section:** 10b, Webhook Eventual Consistency (lines 617–621)

The document correctly notes:
> "Sentry webhooks are **delivered after** the event is processed internally. There is a small delay (typically <1s, but can be minutes during high load)."
> "During reconciliation, use the polling API with `statsPeriod=1h` as the source of truth."

**No change required.** This is correctly documented and the mitigation strategy is appropriate.

---

## 12. No Missing Events — Verification Summary

| Required event | Sentry webhook | Status |
|---|---|---|
| New issue created | `issue` + `action: "created"` | ✅ |
| New comment | `comment` + `action: "created"` | ✅ |
| Comment edit | `comment` + `action: "updated"` | ✅ |
| Comment delete | `comment` + `action: "deleted"` | ✅ |
| Status change | `issue` + `action: "resolved"`/`"unresolved"`/`"archived"` | ✅ |
| Tag add/remove | **No webhook exists** | ⚠️ Use polling |
| Mention | Body content parsing only — no structured field | ✅ (text-based only) |
| Reply | N/A — Sentry has flat comments, no threads | ✅ (not applicable) |
| Close/resolve | `issue` + `action: "resolved"`/`"archived"` | ✅ |
| Assign | `issue` + `action: "assigned"` or `assignedTo` field change | ⚠️ Verify action name |

**Summary:** All required events are either covered by a webhook or explicitly noted as requiring polling. The tag/label gap is a Sentry platform limitation, not a documentation gap. The assign action name needs verification.

---

## Summary of Required Changes

| # | Severity | Location | Issue |
|---|---|---|---|
| 1 | High | Section 3a (payload example) | Replace example with actual fields Sentry sends (`assignedTo`, `title`, `shortId`, `priority`, `count`, etc.) |
| 2 | High | Section 3b (polling) | Add explicit strategy for detecting new comments on existing issues |
| 3 | Medium | Section 3a (signature verification) | Clarify that verification must use raw body bytes, not re-serialized objects |
| 4 | Medium | Section 7 (identity mapping) | Note `assignedTo` is camelCase; verify `assigned` action name via test delivery |
| 5 | Medium | Section 10c (delivery semantics) | Add note about webhook endpoint being disabled after persistent failures |
| 6 | Low | Section 6 (triggers) | Elevate mention detection to named gap with explicit "text-based only" note |
| 7 | Low | Section 3a (event table) | Flag `assigned` action as unverified pending test delivery confirmation |

**Critical fixes required:**
1. Update issue webhook example payload to match actual Sentry fields
2. Add polling strategy for new comments on existing issues
3. Fix signature verification to use raw body bytes

**Nice to have:**
- `assigned` action verification
- Delivery semantics clarifications
- Mention detection elevation to named gap