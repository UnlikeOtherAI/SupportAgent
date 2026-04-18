# Review: GitHub Projects v2 Connector — Inbound Events

**Reviewer**: Claude Code (inbound-events audit)
**Source**: `docs/connectors/github_projects.md`
**Verdict**: Needs corrections before use

---

## Summary

The document covers Projects v2 webhook intake adequately for MVP scope but is missing several related-issue/PR events, has incorrect `pull_request.merged` reference, omits some `issue_comment` actions, and lacks replay-protection and mention-detection guidance. Signature verification details are accurate.

---

## Findings

### 1. Missing `issue_comment` events

**Affected**: Section 3 (Inbound Events), Section 6 (Triggers)
**Issue**: `issue_comment` webhook has 5 actions: `created`, `deleted`, `edited`, `pinned`, `unpinned`. Document only lists `created` by implication in polling section and never documents `edited` or `deleted` as triggers.
**Correction**: Add to trigger table:
- `issue_comment.created` — New comment on issue/PR
- `issue_comment.edited` — Comment edited
- `issue_comment.deleted` — Comment deleted
- `issue_comment.pinned` — Comment pinned (rare but valid)
- `issue_comment.unpinned` — Comment unpinned (rare but valid)

`issue_comment` payload top-level fields are: `action`, `comment`, `issue`, plus common fields `installation`, `organization`, `repository`, `sender`.

---

### 2. `pull_request.merged` is not a valid action

**Affected**: Section 6 (Triggers), Section 11 (MVP scope)
**Issue**: Document references `pull_request.merged` as a trigger and webhook event. This does not exist. GitHub fires `pull_request.closed` for all closures; the `merged` boolean field in the payload distinguishes merged from non-merged closes.
**Correction**: Remove `pull_request.merged` from trigger table. For `pull_request.closed`, check `pull_request.merged == true` in the payload to detect merges.

---

### 3. Incomplete `issues` action list

**Affected**: Section 6 (Triggers)
**Issue**: Document lists `issues.opened`, `issues.closed`, `issues.labeled`, `issues.unlabeled`, `issues.assigned`, `issues.unassigned`. GitHub fires 17+ issue actions including `edited`, `pinned`, `unpinned`, `locked`, `unlocked`, `transferred`, `deleted`, `demilestoned`, `milestoned`, `typed`, `untyped`.
**Correction**: For MVP, document is acceptable with current subset, but add a note in Section 10 (Known Gotchas) that `issues.edited` fires on body/title edits and `issues.transferred` fires when an issue is transferred between repos. These are relevant for SupportAgent's mention/content detection.

---

### 4. Incomplete `pull_request` action list

**Affected**: Section 6 (Triggers), Section 11 (Phase 2)
**Issue**: Document omits `pull_request.ready_for_review`, `pull_request.converted_to_draft`, `pull_request.synchronize`, `pull_request.review_requested`, `pull_request.review_request_removed`, `pull_request.enqueued`, `pull_request.dequeued`, `pull_request.auto_merge_enabled`, `pull_request.auto_merge_disabled`.
**Correction**: Add `pull_request.ready_for_review` to Phase 2 triggers — this fires when a PR leaves draft state and is relevant for "PR needs review" workflows. Others are lower priority.

---

### 5. Mention detection requires separate API call

**Affected**: Section 3 (Inbound Events)
**Issue**: Document does not address how to detect @mentions. GitHub does not fire a special webhook for mentions. The only way to detect if SupportAgent was mentioned is to parse the `issue.body` or `comment.body` text for `@<bot-login>` patterns.
**Correction**: Add to Section 3 or Webhook Gotchas:

> **Mention detection**: GitHub does not fire a dedicated mention webhook. To detect @mentions of the SupportAgent bot:
> 1. Receive `issues.opened`, `issues.edited`, `issue_comment.created`, or `issue_comment.edited`
> 2. Parse `issue.body` or `comment.body` for `@<bot-login>` patterns
> 3. Alternatively, use GitHub REST API `GET /repos/{owner}/{repo}/issues/{issue_number}/timeline` which includes mention events, but this requires additional API calls per event

---

### 6. No replay protection mechanism documented

**Affected**: Section 3 (Inbound Events), Section 10 (Known Gotchas)
**Issue**: GitHub does not enforce timestamp-based replay protection (unlike Slack's `X-Slack-Request-Timestamp`). Webhook deliveries include `X-GitHub-Delivery` (GUID) but no expiring timestamp header. The document does not warn about this.
**Correction**: Add to Webhook Gotchas:

> **Replay protection**: GitHub does not provide timestamp-based replay protection. Use `X-GitHub-Delivery` GUID as an idempotency key. Store processed delivery IDs and reject duplicates. There is no automatic dead-letter queue — failed deliveries remain available for manual redelivery via `POST /repos/{owner}/{repo}/hooks/{hook_id}/deliveries/{delivery_id}/attempts`.

---

### 7. Webhook delivery guarantees are understated

**Affected**: Section 3 (Inbound Events), Section 10
**Issue**: Document says "Webhook delay: Events may arrive 1-30 seconds after action." This is accurate but incomplete. GitHub retries failed webhook deliveries (HTTP 4xx/5xx) automatically but does not document a fixed retry window. The redelivery API (`POST /hooks/{hook_id}/deliveries/{delivery_id}/attempts`) allows manual retry.
**Correction**: Update delivery guarantee note:

> **Delivery guarantees**: GitHub webhooks are at-least-once. Failed deliveries (4xx/5xx responses) are retried automatically with unspecified intervals. Deliveries that return 2xx are considered delivered and not retried. No dead-letter queue; failed deliveries can be manually redelivered via GitHub API.

---

### 8. `projects_v2_item` payload missing content details caveat

**Affected**: Section 3 (Payload Structure), Section 10 (Known Gotchas)
**Issue**: Document correctly notes "No per-item field values in webhook" but does not clarify that the `content` object (issue/PR title, body, author, labels) is also absent from the `projects_v2_item` webhook. You only get item ID and type.
**Correction**: The existing gotcha #4 ("Missing content details") already captures this, but clarify:

> The `projects_v2_item` payload does not include content details (title, body, author, labels, assignees). It only provides `projects_v2_item.id`, `projects_v2_item.type`, and `projects_v2_item.project_id`. To get content details, query the Issue/PR API using `content_id` from the item.

---

### 9. Polling fallback cursor strategy is underspecified

**Affected**: Section 3 (Polling Fallback)
**Issue**: Document shows cursor pagination with `pageInfo.endCursor` but does not address detecting *new comments on existing items* via polling. This is non-trivial — comments are not project items, so polling project items won't surface new comments.
**Correction**: Add to polling section:

> **Detecting new comments via polling**: `projects_v2_item` webhooks do not fire on issue/PR comment activity. To detect new comments on items already in a project:
> 1. Maintain a list of item `content_id` values (issue/PR IDs) for tracked items
> 2. Periodically poll `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` or GraphQL `issue.comments` for each tracked item
> 3. Use `updatedAt` cursor on the comments connection to avoid re-fetching all comments
> 4. Alternative: Subscribe to `issue_comment` webhook per repository instead of polling

---

### 10. Bot-authored content filter is incomplete

**Affected**: Section 7 (Identity Mapping)
**Issue**: Document correctly notes `sender.type == "Bot"` and `sender.login.startsWith("app[bot]")` for bot identification. However, this only filters *actions taken by* bots (who triggered the webhook), not *content authored by* bots (bot's comment bodies, bot-posted issues).
**Correction**: Add to bot identity section:

> **Filtering bot-authored content**: `sender.type` only indicates who performed the action, not the author of the content. To filter content authored by a GitHub App bot:
> 1. Store the bot's GitHub App slug (e.g., `[app-name][bot]`)
> 2. For `issues.opened`, check `issue.user.login == bot_slug`
> 3. For `issue_comment.created`, check `comment.user.login == bot_slug`
> 4. For `pull_request.opened`, check `pull_request.user.login == bot_slug`
> Do not rely on `sender` alone — a user can trigger an action that posts bot content.

---

### 11. Eventual consistency gap for field values

**Affected**: Section 10 (Known Gotchas)
**Issue**: Document notes "API staleness: Immediate post-webhook API calls may return stale data" but does not address that this applies to *all* GraphQL queries after receiving a `projects_v2_item.edited` event. GitHub's data store may not be immediately consistent.
**Correction**: Expand the eventual consistency note:

> **Eventual consistency**: After receiving `projects_v2_item.edited`, field values fetched via GraphQL may not reflect the change yet. Add retry logic with exponential backoff (e.g., 500ms, 1s, 2s, 4s) for up to 3 retries. Check `changes.field` in the webhook payload to determine which field changed, then verify the new value via query.

---

## Events Correctly Documented

The following are accurate and require no changes:

- **Webhook events**: `projects_v2` (created, edited, closed, reopened, deleted) and `projects_v2_item` (created, edited, archived, restored, converted, deleted, reordered) — all correct
- **Header names**: `X-Hub-Signature-256` (SHA-256) and `X-Hub-Signature` (SHA-1 legacy) — correct
- **Signature format**: `sha256=<hex_digest>` — correct
- **HMAC algorithm**: HMAC-SHA256 — correct
- **Payload structure**: Top-level fields (`action`, `projects_v2_item`, `changes`, `organization`, `sender`, `installation`) match current GitHub webhook format — correct
- **User-level projects no webhook**: Correct — organization-level only
- **Bot detection via `sender.type`**: Correct
- **Installation ID for loop prevention**: Correct

---

## Recommended Corrections Priority

**Must fix before MVP**:
1. Remove `pull_request.merged`, replace with `pull_request.closed` + `merged` boolean check
2. Add `issue_comment.created`, `issue_comment.edited`, `issue_comment.deleted` to triggers
3. Add replay protection guidance (GUID idempotency)
4. Add mention detection note (body parsing required)

**Should fix**:
5. Expand `issues` and `pull_request` action lists in triggers
6. Clarify polling cannot detect new comments without separate subscription/API call
7. Add bot-authored-content filtering guidance

**Nice to have**:
8. Expand eventual consistency guidance for field values
9. Document webhook delivery retry behavior explicitly
