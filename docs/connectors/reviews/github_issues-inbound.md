# GitHub Issues Connector — Inbound Events Review

**Verdict: REJECTED — requires revisions before approval**

---

## 1. `issue_comment` Event Name Missing Scope Prefix

**Affected section:** 3, Event Types table

The table lists `issue_comment` as an event row without the `issue_comment.` action scope prefix. GitHub delivers this event as `issue_comment.created`, `issue_comment.edited`, `issue_comment.deleted`.

**Correction:** Change the event row from:
```
| `issue_comment` | `created`, `edited`, `deleted` | Comment sync |
```
to:
```
| `issue_comment.created` | — (no action field for this event) | Comment sync |
| `issue_comment.edited`  | — | Comment edit sync |
| `issue_comment.deleted` | — | Comment deletion sync |
```

The `issue_comment` event does not carry an `action` field — the event name itself encodes the action. The document currently implies `action: "created"` exists on the webhook, which is incorrect for this event family.

---

## 2. Milestone Events Not Listed

**Affected section:** 3, Event Types table

The table covers `issues`, `issue_comment`, `label`, and `issue_dependencies` events. GitHub also delivers `milestone` webhook events:

- `milestone.created`
- `milestone.closed`
- `milestone.deleted`
- `milestone.opened` (renamed from `created` in 2022 API — verify current name)

These fire when a milestone itself is created, closed, deleted, or opened. While not "issue status change," milestone lifecycle is a legitimate SupportAgent trigger surface — an issue moving into or out of a milestone can signal workflow state.

**Correction:** Add a row:
```
| `milestone` | `created`, `closed`, `deleted`, `opened` | Milestone lifecycle (Phase 2) |
```

Or, if milestones are out of scope for MVP, document them as a Phase 2 event and note they are intentionally excluded.

---

## 3. `changes` Field Not Documented for `edited` Action

**Affected section:** 3, Webhook-specific payload

The documented `GitHubWebhookPayload` interface lacks the `changes` field, which GitHub delivers on `edited` actions:

```typescript
interface GitHubWebhookPayload {
  // ... existing fields ...
  changes?: {
    title?: { from: string };
    body?: { from: string };
    body_text?: { from: string };
    state?: { from: string };  // when issue state changes
    // ... other field changes
  };
  reason?: string;  // for locked/unlocked, etc.
}
```

The `changes` object contains the previous value of any edited field. Without it, SupportAgent cannot distinguish "title changed from X to Y" vs "someone edited the title to the same value."

**Correction:** Add `changes?: Record<string, { from: string }>` to the interface. Document that `changes` is only populated on `action: "edited"` payloads. Note that for `action: "locked"` / `action: "unlocked"`, a `reason` field may be present (e.g., `"off-topic"`, `"too heated"`).

---

## 4. `performed_via_github_app` Not Documented

**Affected section:** 3, Webhook-specific payload

When a webhook event originates from a GitHub App (not a human or standard bot), GitHub includes `performed_via_github_app` in the payload:

```typescript
performed_via_github_app?: {
  id: number;
  name: string;
  description: string;
  // ...
};
```

This appears on both `issue` and `comment` objects in the webhook payload, not just as a sender type.

**Why it matters for SupportAgent:** A GitHub App can post as a "bot" (sender.type === 'Bot'), and without `performed_via_github_app` in the interface, the connector cannot distinguish:
- A human using a GitHub App
- An automated GitHub App action
- A PAT-based bot

**Correction:** Add `performed_via_github_app?: GitHubApp` to the `GitHubIssue` and `GitHubIssueComment` interfaces, and document when it appears in webhook payloads.

---

## 5. Replay Protection — Not Documented, but GitHub Has None

**Affected section:** 3, Webhook Delivery Semantics

The document does not address replay protection or timestamp tolerance. This is correct in practice — GitHub webhooks do **not** include a timestamp in the signature or enforce a freshness window. The only replay mitigation is the `X-GitHub-Delivery` UUID header.

**Correction:** Add a note:

> **Replay protection:** GitHub does not enforce timestamp tolerance or include a signature timestamp. The only deduplication signal is `X-GitHub-Delivery` (UUID). SupportAgent should deduplicate by delivery ID. There is no built-in replay window — if a delivery is processed and the request is replayed, SupportAgent relies on its own idempotency logic (e.g., processing by issue/comment ID, not delivery ID alone).

---

## 6. Polling Fallback — Cursor Strategy Missing, `since` Limitation Not Flagged

**Affected section:** 3.3, Polling Fallback

The document recommends:
```
1. Store last-checked timestamp per repo
2. Use `since=<last_timestamp>` for incremental sync
3. Fall back to full sync on cache miss
```

**Issues:**

1. **`since` filter is per-issue, not per-event:** The `?since=` parameter on `GET /repos/{owner}/{repo}/issues` filters issues that were **updated at or after** that timestamp. It does NOT return all events (comments, label changes, etc.) that occurred on existing issues after that time. If SupportAgent needs to detect new comments on old issues, `?since=` on the issues endpoint will miss them.

2. **No comment cursor strategy:** The document shows two comment polling endpoints:
   ```
   GET /repos/{owner}/{repo}/issues/{issue_number}/comments
   GET /repos/{owner}/{repo}/issues/comments?since=<timestamp>
   ```
   But the second endpoint (`issues/comments?since=`) is a repo-scoped comment list that returns ALL comments site-wide with `created_at >= since`. There is no cursor/pagination strategy for this endpoint — it uses page-based pagination with `Link` headers.

3. **How to detect new comments on existing items:** The document does not address this. The correct approach is:
   - Poll `GET /repos/{owner}/{repo}/issues?since=<last_check>` for updated issues
   - For each updated issue, fetch `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` and diff against known state
   - OR use the Timeline API: `GET /repos/{owner}/{repo}/issues/{issue_number}/timeline` which returns a unified event feed including comments, label changes, assignees, etc., with cursor-based pagination

**Correction:**
1. Note that `?since=` on the issues list endpoint detects issue-level updates (new or modified), not sub-item events
2. Add a strategy for detecting new comments on existing issues — either polling comments per updated issue, or using the Timeline API for comprehensive event capture
3. Note that `GET /repos/{owner}/{repo}/issues/comments?since=` returns repo-global comments (not filtered to specific issues) and uses page-based pagination

---

## 7. `issue.pull_request` Discrimination — Not in Interface

**Affected section:** 3, Webhook-specific payload, and Section 10, Gotcha #1

The document correctly notes in the gotchas that PRs share the Issues API and must be filtered by checking `issue.pull_request`. However, the `GitHubWebhookPayload` interface does not include `pull_request` on the `issue` object.

**Correction:** Ensure the `GitHubIssue` interface includes:
```typescript
pull_request?: { url: string; html_url: string; merged_at: string | null } | null;
```

And use this in the webhook handler to filter out PRs before processing as issues.

---

## 8. Mention Detection — No Dedicated Webhook, Requires Content Parsing

**Affected section:** 6, Mention Triggers

The document shows:
```typescript
{ trigger: 'mention', value: 'support-agent[bot]' }
```

This is correct, but the document does not explain **how** GitHub surfaces mentions in webhooks. GitHub has no `mention.created` event. The only way to detect a mention is:
1. Parse `@username` in `issue.body` or `comment.body`
2. Use the Search API: `GET /search/issues?q=mentions:support-agent[bot]`

**Correction:** Add a note in section 3 or 6:

> **Mention detection:** GitHub does not fire a dedicated mention event. To detect @mentions of the bot:
> - For webhook intake: parse `@<bot-login>` pattern in `issue.body` or `comment.body` from the `issues.opened` / `issue_comment.created` payload
> - For reconciliation: use `GET /search/issues?q=mentions:<bot-login>+updated:>=<timestamp>` (note: 30/min rate limit)
> - Alternatively, maintain a bot mention event by processing all issue/comment webhooks and scanning bodies

This makes it clear that mention detection is client-side text scanning, not a native event.

---

## 9. Webhook Delivery Guarantees — Correct, No Dead-Letter

**Affected section:** 3, Retry behavior

The document correctly states:
- 5 retries with exponential backoff
- 10-second timeout
- Manual re-delivery available

These are accurate. GitHub's webhook delivery is **at-least-once** with no dead-letter visibility — if SupportAgent misses a delivery, there's no API to list failed webhooks.

**Correction:** Add a note:

> **Delivery guarantee:** GitHub webhooks are at-least-once. There is no dead-letter queue or failed delivery list API. If the endpoint fails persistently, events are silently dropped. SupportAgent requires a polling fallback to cover gaps.

---

## 10. Timeline API vs Events API — Not in Inbound Section

**Affected section:** 3, Polling Fallback

The document mentions Timeline vs Events API in the API Gotchas (section 10) but not in the polling fallback section (3.3). The Timeline API (`GET /repos/{owner}/{repo}/issues/{issue_number}/timeline`) is the correct tool for detecting all events on an issue (comments, label changes, assignments, state changes) in a unified feed.

**Correction:** In section 3.3, add a note:

> **For comprehensive per-issue event sync:** Use `GET /repos/{owner}/{repo}/issues/{issue_number}/timeline` which returns a unified feed of all issue events (comments, labels, assignments, state changes). Cursor-based pagination via `pageInfo` in the response. More efficient than polling comments + labels + assignments separately.

This makes the polling strategy actionable rather than leaving it to the gotchas.

---

## 11. Loop Prevention — Bot Detection Methods Correct

**Affected section:** 7.3, Bot Identity

The document lists three bot detection methods:
1. `sender.type === 'Bot'` ✓
2. Login suffix `<name>[bot]` ✓
3. `author_association === 'NONE'` + bot type ✗ (partially)

**Correction on #3:** `author_association === 'NONE'` means the actor has no formal association with the repo (not a collaborator, member, etc.). This is **not** the same as "bot." A random user filing an issue also has `author_association: 'NONE'`. The condition should be `author_association === 'NONE' AND sender.type === 'Bot'`, or simply rely on `sender.type === 'Bot'`.

---

## Summary of Required Fixes

1. **Event naming**: Fix `issue_comment` to use full event names (`issue_comment.created`, etc.) with note that no `action` field exists on this event family
2. **Milestone events**: Add `milestone.created/closed/deleted/opened` (or document as out-of-scope Phase 2)
3. **`changes` field**: Document for `action: "edited"` payloads; add `reason` for locked/unlocked
4. **`performed_via_github_app`**: Add to `GitHubIssue` and `GitHubIssueComment` interfaces
5. **Replay protection**: Add note that GitHub has no timestamp tolerance; deduplicate by delivery ID
6. **Polling cursor strategy**: Document how to detect new comments on existing issues; note `?since=` limitations; recommend Timeline API for comprehensive per-issue sync
7. **`pull_request` in interface**: Ensure the field is present for PR filtering
8. **Mention detection**: Explicitly state this requires body parsing, not a native event; explain the two detection approaches
9. **Delivery guarantees**: Add at-least-once note and dead-letter gap warning
10. **Timeline API placement**: Move Timeline API note from gotchas to the polling section
11. **Loop prevention #3**: Correct `author_association === 'NONE'` condition to require `sender.type === 'Bot'`