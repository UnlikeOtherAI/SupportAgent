# GitHub Connector — Inbound Events Review

**Verdict: ISSUES FOUND — see findings below**

---

## 1. `issue_comment` Trigger Matcher Has Wrong Field Reference

**Affected section:** 6, Trigger Matcher table, row `github.issue.comment`

The document lists:
```
| `github.issue.comment` | `action === 'created'` on `issue_comment` | event match |
```

**Problem:** The `issue_comment` webhook event does **not** carry an `action` field. The action is encoded in the event name itself: `issue_comment.created`, `issue_comment.edited`, `issue_comment.deleted`. There is no `action` property on this webhook payload.

**Correction:** Change the trigger matcher to use the event name, not an `action` field:
```
| `github.issue.comment` | Event name `issue_comment.created` | event match |
```

The discriminator for matching should be the `X-GitHub-Event` header value, not `payload.action`.

---

## 2. `issue_comment.edited` Trigger Matcher Also Wrong

**Affected section:** 6, Trigger Matcher table (not explicitly listed, but implied in event table)

The event table in section 3 correctly shows `issue_comment.edited` as a separate event. However, if the trigger matcher uses `action === 'edited'` on the `issue_comment` event (following the pattern from finding #1), it will never fire because no `action` field exists.

**Correction:** Add explicit trigger matcher:
```
| `github.issue.comment.edited` | Event name `issue_comment.edited` | event match |
```

---

## 3. `changes` Field Missing from Documented Payload Shape

**Affected section:** 3, Payload Fields to Persist

The documented payload example does not include the `changes` field, which GitHub includes on `edited` events to show the previous value of modified fields.

**GitHub delivers this on `issues.edited`, `issue_comment.edited`, etc.:**
```json
{
  "action": "edited",
  "changes": {
    "title": { "from": "Original Title" },
    "body": { "from": "Original body..." },
    "body_text": { "from": "Original body (desktop)" }
  }
}
```

**Correction:** Add `changes?: { [key: string]: { from: string } }` to the documented webhook payload shape. Note that this field is only present on `edited` actions and contains the prior value of each modified field.

Also add `reason?: string` for `locked`/`unlocked` actions.

---

## 4. Milestone Events Incomplete

**Affected section:** 3, Event Types table

The table only lists `issues.demilestoned` for milestone-related events. GitHub delivers these milestone webhook events:

- `milestone.created`
- `milestone.closed`
- `milestone.opened` (renamed from `milestone.created` in 2022; verify current GH API)
- `milestone.deleted`

These fire when a milestone itself is created, closed, or deleted. While `issues.demilestoned` handles "an issue moved in/out of a milestone," the milestone lifecycle events are separate triggers.

**Correction:** Either add milestone lifecycle events to the table (marked Phase 2 if out of MVP scope) or explicitly note they are out of scope:
```
| `milestone.created` | Milestone created | Phase 2 |
| `milestone.closed` | Milestone closed | Phase 2 |
| `milestone.deleted` | Milestone deleted | Phase 2 |
```

---

## 5. `pull_request` Field Present but Interface Unclear

**Affected section:** 3, Payload Fields to Persist

The REST API example includes `"pull_request": { "url": "...", "merged_at": null, "merged": false }`, which is correct. However, the webhook payload structure (TypeScript interface) is not explicitly documented.

**Correction:** Ensure the webhook payload interface includes:
```typescript
pull_request?: {
  url: string;
  html_url: string;
  merged_at: string | null;
  merged: boolean;
} | null;
```

And document that `issue.pull_request` is `null` for issues, non-null for PRs. The webhook handler must check this field to filter PRs from issue-only workflows.

---

## 6. `performed_via_github_app` Not Documented

**Affected section:** 3, Payload Fields to Persist

When a webhook event originates from a GitHub App (not a human or PAT-based bot), GitHub includes `performed_via_github_app` in the payload. This appears on `issue`, `comment`, and other objects.

**Why it matters:** A GitHub App can have `sender.type === 'Bot'` and a login ending in `[bot]`, indistinguishable from a PAT-based bot. The `performed_via_github_app` field distinguishes an automated GitHub App action from a standard bot.

**Correction:** Add to the `GitHubIssue` and `GitHubIssueComment` interfaces:
```typescript
performed_via_github_app?: {
  id: number;
  name: string;
  description: string;
  // ... other fields
};
```

Document that when this field is present, the action was taken via GitHub App automation, not a human or PAT.

---

## 7. Replay Protection — Missing Note

**Affected section:** 3, Signature Verification or Delivery Semantics

The document correctly implements HMAC-SHA256 signature verification but does not note GitHub's lack of replay protection.

**Correction:** Add to the signature verification section or delivery semantics:

> **Replay protection:** GitHub does not include a timestamp in the signature or enforce a freshness window. The only deduplication signal is `X-GitHub-Delivery` (UUID). SupportAgent must deduplicate by delivery ID and implement idempotent processing (handle events by issue/comment ID, not delivery ID alone).

---

## 8. Eventual Consistency Gap Not Prominent

**Affected section:** 10, Known Gotchas

The document mentions eventual consistency briefly in the gotchas:
> "Webhook delivery and API read consistency are not guaranteed. After receiving `issues.opened`, a subsequent `GET /repos/{owner}/{repo}/issues/{issue_number}` may return 404 briefly."

This is correct but buried. For an inbound events review, this is critical — it affects how the connector handles new issues.

**Correction:** Move this note to section 3 (Inbound — Events and Intake) under a "Eventual Consistency" subheading:

> **Eventual consistency:** After receiving `issues.opened`, the issue may not yet be readable via `GET /repos/{owner}/{repo}/issues/{issue_number}`. Retry with exponential backoff (suggest 3 retries, 1s/2s/4s delays) before failing the event.

---

## 9. Polling Fallback — `since` Parameter Misleading

**Affected section:** 3.3, Polling Fallback

The document recommends:
```
GET /repos/{owner}/{repo}/issues?since=<ISO8601>&per_page=100
```

**Problem:** The `since` parameter on the issues list endpoint returns issues **updated at or after** that timestamp. It does NOT return all events (comments, label changes, assignments) that occurred on existing issues after that time.

**For detecting new comments on existing issues:** `?since=` on the issues endpoint misses them because the issue's `updated_at` may not change when a comment is added (verify: actually it does change). But `since` on the comments endpoint (`GET /repos/{owner}/{repo}/issues/{issue_number}/comments?since=`) only returns comments on that specific issue, not a global comment feed.

**Correction:** Clarify the `since` strategy:

> **`since` parameter behavior:**
> - `GET /repos/{owner}/{repo}/issues?since=<timestamp>` — returns issues with `updated_at >= timestamp`. This includes old issues that received comments/label changes after the `since` time (because `updated_at` changes on those events).
> - `GET /repos/{owner}/{repo}/issues/{issue_number}/comments?since=<timestamp>` — returns comments on that specific issue with `created_at >= timestamp`. Requires knowing the issue number first.
>
> **Recommended approach:** Poll `GET /repos/{owner}/{repo}/issues?since=<last_check>` for updated issues, then for each updated issue, fetch comments and diff against known state.

---

## 10. Mention Detection — Correct but Could Be Clearer

**Affected section:** 6, Mention Trigger

The document correctly identifies mention detection as requiring body parsing:
```
| Mention of bot | `comment.body` contains `@<bot_login>` | regex |
```

The Search API approach is mentioned in section 10 gotchas (indirectly, via rate limit note on search). But the mention detection strategy is not explicit in section 3 or section 6.

**Correction:** Add an explicit "Mention Detection" subsection in section 3:

> **Mention detection:** GitHub does not fire a dedicated mention event. To detect @mentions of the bot:
> - **Webhook path:** Parse `@<bot-login>` pattern in `issue.body` or `comment.body` from `issues.opened` / `issue_comment.created` payloads
> - **Reconciliation:** Use `GET /search/issues?q=mentions:<bot-login>+updated:>=<timestamp>` (rate limited: 30/min)
> - Maintain mention coverage by processing all issue/comment webhooks and scanning bodies

---

## 11. Bot Loop Prevention — `author_association` Condition Overly Broad

**Affected section:** 7.3, Bot Identity (implied) or implicit in trigger design

The document does not explicitly document loop prevention, but the trigger matcher for `github.issue.comment` implies it.

**Problem with relying on `author_association === 'NONE'`:** This field means the actor has no formal association with the repo (not a collaborator, member, etc.). A random user filing an issue has `author_association: 'NONE'`. This is not equivalent to "bot."

**Correction:** If loop prevention is implemented, ensure conditions are precise:
- `sender.type === 'Bot'` — primary bot signal
- `sender.login === bot_login` — exact match for this bot
- `performed_via_github_app` present — GitHub App action
- `author_association === 'NONE'` alone is insufficient — must combine with other signals

---

## 12. Delivery Guarantees — Missing Dead-Letter Warning

**Affected section:** 3, Delivery Semantics

The document correctly states retry behavior (5 retries, exponential backoff) but does not warn about the dead-letter gap.

**Correction:** Add:

> **Delivery guarantee:** GitHub webhooks are at-least-once. There is no dead-letter queue or API to list failed deliveries. If SupportAgent endpoint fails persistently, events are silently dropped. A polling fallback is required to cover gaps.

---

## 13. `repository` vs `repository_url` in Webhook Payload

**Affected section:** 3, Payload Fields to Persist

The REST API example uses `"repository_url": "https://api.github.com/repos/owner/repo"`. But the webhook payload uses `"repository": { ... }` as a full object, not `repository_url`.

**Correction:** Note the difference:
- REST API response: `repository_url` (string URL)
- Webhook payload: `repository` (full object with `id`, `name`, `full_name`, `html_url`, etc.)

The connector must handle both shapes.

---

## 14. Missing `sender` in Webhook Payload Documentation

**Affected section:** 3, Payload Fields to Persist

The webhook payload always includes `sender` (the user who triggered the event) and `installation` (for GitHub App events). Neither is in the documented payload shape.

**Correction:** Add to the webhook payload interface:
```typescript
sender: {
  id: number;
  login: string;
  type: 'User' | 'Bot' | 'Organization';
  // ...
};
installation?: {
  id: number;
  node_id: string;
  // ... for GitHub App events
};
```

---

## Summary of Findings

| # | Severity | Issue | Location |
|---|----------|-------|----------|
| 1 | High | `issue_comment` trigger uses non-existent `action` field | Section 6 |
| 2 | High | `issue_comment.edited` trigger same issue | Section 6 |
| 3 | Medium | `changes` field not documented | Section 3 |
| 4 | Low | Milestone events incomplete (only `demilestoned` listed) | Section 3 |
| 5 | Low | `pull_request` field in webhook interface unclear | Section 3 |
| 6 | Low | `performed_via_github_app` not documented | Section 3 |
| 7 | Medium | Replay protection gap not noted | Section 3 |
| 8 | Medium | Eventual consistency buried in gotchas | Section 10 → Section 3 |
| 9 | Medium | `since` parameter behavior unclear | Section 3.3 |
| 10 | Low | Mention detection strategy scattered | Section 6, 10 |
| 11 | Low | Bot loop prevention conditions too broad | Implied |
| 12 | Medium | Dead-letter gap not warned | Section 3 |
| 13 | Low | `repository` vs `repository_url` shape mismatch | Section 3 |
| 14 | Low | `sender` and `installation` missing from interface | Section 3 |

**Critical fixes required:**
1. Fix `issue_comment` trigger matcher to use event name, not `action` field (findings #1, #2)
2. Add replay protection note (finding #7)
3. Move eventual consistency warning to inbound section (finding #8)
4. Clarify `since` parameter behavior for polling (finding #9)
5. Add dead-letter delivery gap warning (finding #12)

**Nice to have:**
- `changes` field documentation
- Milestone events completeness
- `performed_via_github_app` documentation
- `sender` and `installation` in payload interface
