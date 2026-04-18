# GitHub Connector — Inbound Events Review

**Verdict**: The inbound intake story is largely solid and well-structured. Signature verification, delivery semantics, deduplication, eventual-consistency gaps, and bot loop-prevention are all correctly described. Several gaps and inaccuracies are present that could cause missed events, incorrect event routing, or silent failures in production.

---

## Findings

### 1. Event name format is inconsistent — webhook header vs payload action

- **Flow affected**: All event routing logic.
- **Problem**: The `X-GitHub-Event` header carries the *event type* (e.g., `issues`, `issue_comment`, `pull_request`) without an action suffix. The `action` field in the JSON payload carries the sub-action (e.g., `opened`, `created`). The document and the trigger table mix both conventions in the same column using dot notation (`issues.opened`, `issue_comment.created`) as though that were the raw header value.
- **Correction**: The header value is `issues`, not `issues.opened`. The full discriminant is `X-GitHub-Event: issues` + `payload.action === "opened"`. The document should clarify that the dot notation is SupportAgent's internal canonical name, not the raw GitHub wire format. The trigger table in Section 6 correctly uses `action ===` expressions, but Section 3 table column "Event Name" implies these are raw header values, which is misleading.

---

### 2. `issues.reopened` is missing from Section 3 event table

- **Flow affected**: Status-change intake; reopened-issue triage.
- **Problem**: Section 3's relevant event types table lists `issues.opened` and `issues.closed` but omits `issues.reopened`. The trigger table in Section 6 lists `github.issue.reopened`, and the MVP webhook list at the end includes it. The omission in Section 3 means the intake event table is incomplete.
- **Correction**: Add `issues.reopened` (action `reopened` on `X-GitHub-Event: issues`) to the Section 3 table, marked "Yes" for MVP.

---

### 3. `issues.assigned` / `issues.unassigned` — `unassigned` action is missing

- **Flow affected**: Assignee-change intake.
- **Problem**: Section 3 lists `issues.assigned` (Phase 2) but does not list `issues.unassigned`. GitHub fires a separate `action: "unassigned"` event on the `issues` event type when an assignee is removed. Section 6's trigger table mentions `removed_from` for the assignee trigger but no corresponding intake event is listed.
- **Correction**: Add `issues.unassigned` (action `unassigned` on `X-GitHub-Event: issues`) to Section 3, Phase 2, alongside `issues.assigned`.

---

### 4. `pull_request.reopened` is missing

- **Flow affected**: PR status-change intake.
- **Problem**: `pull_request.opened` and `pull_request.closed` are listed but `pull_request.reopened` (action `reopened`) is absent. A PR can be reopened after being closed without merging, which is a meaningful state change for triage.
- **Correction**: Add `pull_request.reopened` to Section 3 (Phase 2) and to Section 11's webhook event list.

---

### 5. `pull_request.synchronize` is missing

- **Flow affected**: PR update detection; re-triage on new commits pushed to a PR.
- **Problem**: When a contributor pushes new commits to a PR branch, GitHub fires `pull_request` with `action: "synchronize"`. This is how SupportAgent would know to re-evaluate a PR after new commits. It is absent from both Section 3 and Section 11.
- **Correction**: Add `pull_request.synchronize` (Phase 2) to Section 3. It is the correct event to watch for "PR updated with new commits".

---

### 6. `pull_request.edited` is missing

- **Flow affected**: PR title/body/base-branch change detection.
- **Problem**: GitHub fires `pull_request` with `action: "edited"` when the PR title, body, or base branch is changed. Not listed anywhere in the document.
- **Correction**: Add `pull_request.edited` (Phase 2) to Section 3. Payload includes a `changes` object with `title.from`, `body.from`, `base.sha.from` as applicable.

---

### 7. `pull_request.ready_for_review` and `pull_request.converted_to_draft` are absent

- **Flow affected**: Draft/ready PR lifecycle intake.
- **Problem**: GitHub fires these two `pull_request` sub-actions when a PR transitions between draft and ready-for-review. Absent from the document. Relevant for any triage automation that should trigger only on non-draft PRs.
- **Correction**: Add both to Section 3 as Phase 2 entries. Without them, there is no webhook signal for the draft→ready transition.

---

### 8. `X-GitHub-Event` header value for `issue_comment` events is wrong in description

- **Flow affected**: Comment intake routing.
- **Problem**: The document's Section 3 trigger table entry `github.issue.comment` describes matching `action === 'created'` on `issue_comment`. This is correct for payload routing. However, nowhere is it noted that the header value is `issue_comment` (with underscore), not `issue-comment` or `comment`. The naming of the internal trigger (`github.issue.comment`) could cause confusion.
- **Correction**: Explicitly note: `X-GitHub-Event: issue_comment`, `payload.action: "created" | "edited" | "deleted"`. This is a minor documentation gap but important for the webhook router implementation.

---

### 9. `pull_request_review_comment` header spelling not stated

- **Flow affected**: PR inline comment intake.
- **Problem**: The event name in Section 3 is written as `pull_request_review_comment.created`. The `X-GitHub-Event` header value is `pull_request_review_comment` (all underscores). The document does not explicitly state the header string, which matters for the webhook router's dispatch table.
- **Correction**: Add a note that the header is `X-GitHub-Event: pull_request_review_comment` with `payload.action: "created" | "edited" | "deleted"`.

---

### 10. `installation` and `installation_repositories` events — payload shape not described

- **Flow affected**: GitHub App multi-tenant intake; installation lifecycle.
- **Problem**: Section 11 lists `installation` and `installation_repositories` as MVP webhook events to handle, but Section 3 provides no payload shape or action variants for these events. The relevant actions are:
  - `installation`: `action` in `{ "created", "deleted", "suspend", "unsuspend", "new_permissions_accepted" }`
  - `installation_repositories`: `action` in `{ "added", "removed" }`
  Both carry an `installation.id` field that SupportAgent must persist to look up installation tokens.
- **Correction**: Add a brief payload reference for these two events in Section 3 (or a new subsection) so implementors know which action values to handle and which field to key on (`installation.id`).

---

### 11. Mention detection requires a body scan — no dedicated mention webhook

- **Flow affected**: Bot mention detection; @mention-triggered workflows.
- **Problem**: Section 6 correctly notes that mention detection requires `comment.body` regex matching (`@<bot_login>`). However, the document does not note that GitHub has no dedicated `mention` webhook event. There is also no note about the `mentioned` filter param on `GET /repos/{owner}/{repo}/issues` (polling) which can be used during polling fallback to find issues where the bot was mentioned in the body or title.
- **Correction**: Add a note that there is no dedicated mention webhook; mention detection is always done via body scan of `issue_comment.created` and `issues.opened`/`edited` payloads. For polling fallback, use `GET /repos/{owner}/{repo}/issues?mentioned=<bot_login>` to surface items with bot mentions.

---

### 12. Replay protection / timestamp tolerance — not enforced by GitHub

- **Flow affected**: Security posture of webhook receiver.
- **Problem**: The document does not state that GitHub does **not** include a timestamp in the signature scheme. There is no nonce or timestamp field in the GitHub webhook request that would allow replay protection. The only protection is the HMAC-SHA256 secret match and the `X-GitHub-Delivery` UUID for deduplication.
- **Correction**: Add an explicit note: GitHub does not enforce timestamp tolerance or replay windows. The receiver must implement its own replay protection by persisting `X-GitHub-Delivery` UUIDs (e.g., in Redis with 24–48h TTL). This is mentioned for deduplication in Section 10 but should also appear in the signature verification section (Section 3) as a security consideration.

---

### 13. Polling fallback — no comment polling strategy for existing issues

- **Flow affected**: Polling fallback; comment intake without webhooks.
- **Problem**: Section 3's polling fallback describes `gh issue list` with `--since` for issue-level polling. It does not describe how to detect *new comments* on existing issues. `GET /repos/{owner}/{repo}/issues?since=<ISO8601>` returns issues whose `updated_at` changed, which includes issues that received new comments. However, to retrieve the new comments themselves, a second call to `GET /repos/{owner}/{repo}/issues/{issue_number}/comments?since=<ISO8601>` is required per issue. This two-step is absent.
- **Correction**: Document the two-step polling pattern: (1) poll issues with `since` to get recently-updated issues, (2) for each, poll comments with `since` to find new comments. Note that `GET /repos/{owner}/{repo}/issues/comments?since=<ISO8601>&per_page=100` (repository-wide comment list) is also available and avoids the per-issue loop — it should be the preferred polling approach.

---

### 14. `GET /repos/{owner}/{repo}/issues/comments` — per-issue filter limitation misstated

- **Flow affected**: Comment polling.
- **Problem**: Section 9's table says "`issue_number` filter not supported — iterate per issue" for `GET /repos/{owner}/{repo}/issues/comments`. This is accurate for that endpoint (it lists all comments in a repo, not filtered by issue). However, the note omits that `since` is supported on this endpoint, making it the efficient way to poll for all new comments across all issues with a single call, sorted by `created_at`.
- **Correction**: Add a note that `GET /repos/{owner}/{repo}/issues/comments?since=<ISO8601>&per_page=100` can be used for efficient repository-wide new-comment polling, avoiding per-issue iteration.

---

### 15. Eventual consistency — `issues.opened` before issue is readable

- **Flow affected**: Issue normalization after webhook delivery.
- **Problem**: Section 10 correctly notes this gap: "After receiving `issues.opened`, a subsequent `GET` may return 404 briefly." However, Section 3 does not reference this constraint in the event intake description. Implementors reading only Section 3 may not know to apply retry-with-backoff when fetching full issue data after a webhook fires.
- **Correction**: Add a cross-reference in Section 3's delivery semantics: "Note: payload data from webhooks may be stale or incomplete; always refetch via REST after receipt. See Section 10 for eventual consistency notes."

---

### 16. Bot loop prevention — `sender` vs `user` field

- **Flow affected**: `no_self_retrigger` logic; bot comment loop prevention.
- **Problem**: Section 7 describes filtering on `payload.sender.id`. This is correct for `issues.*` and `pull_request.*` events where `sender` represents the actor. For `issue_comment.*` events, the actor is also in `payload.sender` (not `payload.comment.user`). The document is correct but does not clarify that `sender` and `comment.user` are always the same person for new comment events — there is no case where they differ. This could cause implementors to use the wrong field.
- **Correction**: Add a note that for comment events, `payload.sender` and `payload.comment.user` should be identical. Prefer `payload.sender.id` for consistency across all event types, since it is always present at the envelope level.

---

### 17. `issues.milestoned` is missing; `issues.demilestoned` is listed inconsistently

- **Flow affected**: Milestone-change intake.
- **Problem**: Section 3 lists `issues.demilestoned` (Phase 2) but omits `issues.milestoned` (when a milestone is added). GitHub fires both as separate actions (`milestoned` and `demilestoned`) on the `issues` event type. They come as a pair.
- **Correction**: Add `issues.milestoned` alongside `issues.demilestoned` in Section 3 (Phase 2).

---

### 18. Webhook delivery retry window mis-described

- **Flow affected**: Reliability planning; at-least-once delivery guarantees.
- **Problem**: Section 3 says "~5 retries over ~24 hours". GitHub's actual documented retry behavior is up to 3 retries at increasing intervals: 5 min, 30 min, 1 hour, 6 hours, 24 hours — totaling potentially 5 attempts (initial + 4 retries) over 24 hours. The "~5 retries" phrasing is imprecise; the initial delivery is not a retry. The total attempts is up to 5 (1 initial + 4 retries).
- **Correction**: Clarify: "GitHub makes up to 5 delivery attempts total (1 initial + 4 retries) with exponential back-off over approximately 24 hours." Dead-letter behavior: after the final retry GitHub marks the delivery as failed with no further attempt. No built-in dead-letter queue — SupportAgent must reconcile via polling if webhook delivery lapses.

---

### 19. No mention of `workflow_run` or `workflow_job` events for CI-adjacent triage

- **Flow affected**: Phase 3 CI triage.
- **Problem**: Section 11's Phase 3 roadmap mentions check runs but does not mention `workflow_run` or `workflow_job` events. These are the GitHub Actions-level events (separate from `check_run`/`check_suite`). If SupportAgent wants to trigger on GitHub Actions outcomes, `workflow_run.completed` is the correct event, not `check_run.completed` (which is lower-level and used for external CI systems integrating via the Checks API).
- **Correction**: Add `workflow_run.completed` to Phase 3 alongside `check_run.completed`. Note the distinction: `check_run` is for external CI; `workflow_run` is for GitHub Actions.

---

## Summary of Missing Events

| Event | Action(s) | Phase | Status in Doc |
|---|---|---|---|
| `issues` | `reopened` | MVP | Missing from Section 3 table |
| `issues` | `unassigned` | Phase 2 | Missing entirely |
| `issues` | `milestoned` | Phase 2 | Missing (only `demilestoned` listed) |
| `pull_request` | `reopened` | Phase 2 | Missing |
| `pull_request` | `synchronize` | Phase 2 | Missing |
| `pull_request` | `edited` | Phase 2 | Missing |
| `pull_request` | `ready_for_review` | Phase 2 | Missing |
| `pull_request` | `converted_to_draft` | Phase 2 | Missing |
| `workflow_run` | `completed` | Phase 3 | Missing |

## Confirmed Correct

- HMAC-SHA256 signature via `X-Hub-Signature-256` — correct algorithm and header name.
- `timingSafeEqual` usage in the code sample — correct.
- `X-GitHub-Delivery` UUID deduplication strategy — correct.
- 10-second response timeout with 202 async pattern — correct.
- `updated_at` cursor strategy for polling — correct.
- Bot identity via `sender.id` comparison — correct approach.
- Eventual consistency gap noted in Section 10 — correct.
- No timestamp replay protection from GitHub — implied but should be explicit (see Finding 12).
- Dual comment context (issue-level vs review-level) — correctly documented.
