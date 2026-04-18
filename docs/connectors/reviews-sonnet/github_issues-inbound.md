# Inbound Event Review: GitHub Issues Connector

**Verdict**: MOSTLY CORRECT with several gaps and one notable inaccuracy. The webhook event coverage, signature verification, and polling fallback are well-specified. The main deficiencies are: missing `issues.assigned`/`issues.unassigned` from MVP event list despite being needed, no mention of replay protection absence, incomplete handling of the mention detection problem, a factual error about the `issue_dependencies` event, and insufficient guidance on eventual-consistency gaps. Details below.

---

## Event Coverage

- **`issues.assigned` / `issues.unassigned` absent from MVP webhook list**
  Section 11 MVP webhook events omit `issues.assigned` and `issues.unassigned`, but the trigger matchers section (Section 6) explicitly lists assignee triggers as in-scope. If assignee changes must be handled in real time, these events belong in the MVP event table. Deferring them to Phase 2 without acknowledging the gap leaves the triage worker with no signal when an issue is assigned to the bot.
  Correction: add `issues.assigned` and `issues.unassigned` to the MVP webhook event list, or explicitly note that assignee triggers are polling-only until Phase 2.

- **`issues.edited` absent from MVP but needed for title/body triggers**
  Section 6 defines `title_matches` and `body_matches` triggers. Without `issues.edited` in the MVP intake, edits to issue title or body after initial creation will not fire those triggers via webhook. The event is listed under Phase 2, but the mismatch with MVP-level trigger definitions is not flagged.
  Correction: either add `issues.edited` to MVP events or note that title/body triggers only fire on `issues.opened` until Phase 2.

- **`issue_dependencies` event is not a standard GitHub webhook event**
  The event table in Section 3 lists `issue_dependencies` with actions `blocking_added`, `blocking_removed`, `blocked_by_added`, `blocked_by_removed`. This event does not exist in GitHub's published webhook event catalog. GitHub does not deliver dependency change webhooks via standard repository webhooks. Issue dependency data is only accessible via GraphQL (`linkedBranches` / sub-issues API, currently in beta) or via the timeline API (`cross-referenced` timeline events).
  Correction: remove `issue_dependencies` from the webhook event table. Document dependency tracking as a polling-only concern via `GET /repos/{owner}/{repo}/issues/{issue_number}/timeline` and filter for `cross-referenced` or `connected` timeline event types.

- **`label` event scope clarification is correct but incomplete**
  Section 10 correctly notes that `label` fires for repository label CRUD, not per-issue label changes. However, Section 3's event table lists `label` alongside `issues` and `issue_comment` as if it were a standard intake event. For SupportAgent purposes, `label` is an outbound management concern, not an inbound triage signal. The table should note this distinction explicitly.
  Correction: move `label` event out of the inbound event table or annotate it as "label CRUD only, not per-issue; not an intake trigger."

---

## Event Name Spelling and Scoping

- **Event names are correctly scoped**
  The document uses `issues` (not `issue`) as the webhook event name and `issue_comment` for comments. These match GitHub's actual event header values delivered in `X-GitHub-Event`. No errors found here.

- **Action values are correct**
  `opened`, `closed`, `reopened`, `labeled`, `unlabeled`, `assigned`, `unassigned`, `edited`, `deleted`, `transferred` are all valid action values for the `issues` event. `created`, `edited`, `deleted` are valid for `issue_comment`. These are accurate.

---

## Payload Top-Level Shape

- **`GitHubWebhookPayload` interface is accurate for `issues.*` events**
  Top-level fields `action`, `issue`, `repository`, `sender`, `label`, `assignee` are correct. The `label` and `assignee` fields are properly typed as optional (present only for labeled/assigned actions respectively).

- **`comment` field placement in webhook payload**
  For `issue_comment.*` events, the top-level payload contains `comment` alongside `issue`, `repository`, and `sender`. The interface includes `comment?: GitHubIssueComment` as optional, which is correct structurally. However, the Appendix B webhook example for `issue_comment.created` shows this correctly, so no code-level error, but the TypeScript interface could be split into two separate payload types (`IssuesWebhookPayload` and `IssueCommentWebhookPayload`) to make it unambiguous which fields are always present for which event.

- **`installation` field missing from GitHub App webhook payloads**
  When the connector is configured as a GitHub App (recommended for multi-tenant, documented in Section 2), every webhook payload includes a top-level `installation` object:
  ```json
  {
    "installation": { "id": 12345, "node_id": "MDIzOkludGVncmF0aW9uSW5zdGFsbGF0aW9uMTIzNDU=" }
  }
  ```
  This field is required to look up which installation token to use when making follow-up API calls. Its absence from the payload interface and the normalization layer is a gap that will cause issues during multi-tenant implementation.
  Correction: add `installation?: { id: number; node_id: string }` to `GitHubWebhookPayload`.

- **`organization` field missing from org-level webhook payloads**
  Org-level webhooks include a top-level `organization` object. Not critical for issue triage but relevant for multi-repo connectors scoped to an org.

---

## Signature Verification

- **Algorithm and header name are correct**
  HMAC-SHA256 via `X-Hub-Signature-256` is accurate. The older `X-Hub-Signature` (SHA1) still exists but GitHub recommends the SHA256 variant. The document correctly uses the 256 variant.

- **Raw body requirement is stated but not emphasized**
  The pseudocode signs `rawBody`, which is correct. However, the document does not explicitly warn that the raw request body bytes must be used before any JSON parsing or body middleware transforms the payload. This is a common implementation mistake with Express/Koa body parsers.
  Correction: add a note: "Verify signature against the raw request body buffer, before any JSON.parse or middleware transforms. Using the parsed object will produce the wrong HMAC."

- **`X-Hub-Signature-256` header is absent from the delivery guarantee notes**
  The document mentions `X-GitHub-Delivery` and `X-GitHub-Event` in the delivery semantics table but omits `X-Hub-Signature-256` from that table. It is covered in Section 2, but a reader scanning Section 3 for inbound verification details may miss it.
  Correction: add `X-Hub-Signature-256` to the webhook delivery headers table in Section 3 with a note pointing to Section 2 for verification pseudocode.

---

## Replay Protection and Timestamp Tolerance

- **No mention that GitHub does not provide timestamp-based replay protection**
  GitHub webhook payloads do not include a delivery timestamp that must be validated against a tolerance window (unlike Slack, which requires `X-Slack-Request-Timestamp` to be within 5 minutes). The only replay protection GitHub offers is the delivery UUID in `X-GitHub-Delivery`.
  The document does not address this at all. Implementers need to know:
  1. GitHub has no built-in timestamp tolerance enforcement — there is no equivalent of Slack's 5-minute window.
  2. Replay protection, if needed, must be implemented by storing and deduplicating `X-GitHub-Delivery` UUIDs.
  Correction: add a note under webhook delivery semantics: "GitHub does not enforce a timestamp tolerance window. To prevent replay attacks, store processed `X-GitHub-Delivery` UUIDs and reject duplicates within a configurable window (e.g., 24 hours)."

---

## Webhook Delivery Guarantees

- **At-least-once semantics not explicitly stated**
  The document describes retry behavior (up to 5 retries, exponential backoff) but never states the delivery guarantee model. GitHub webhooks are at-least-once: the same event may be delivered more than once if the first delivery timed out but was actually processed.
  Correction: add "Delivery guarantee: at-least-once. Idempotency keyed on `X-GitHub-Delivery` UUID is required."

- **Retry window is not quantified**
  GitHub retries up to 5 times but the document does not state the total retry window duration. GitHub's documented retry schedule is approximately: immediate, then 5s, 10s, 30s, 60s — covering roughly 2 minutes. After that, the delivery is marked failed with no further automatic retries (manual re-delivery is possible).
  Correction: add the approximate retry schedule and note that after ~2 minutes of failure, no further automatic delivery occurs.

- **No mention of GitHub's 72-hour re-delivery window**
  GitHub allows manual re-delivery of failed webhooks via the UI or API for up to 72 hours. This is relevant for operational recovery.
  Correction: document the 72-hour manual re-delivery window under delivery guarantees.

- **Dead-letter behavior**
  The document mentions manual re-delivery is available but does not specify what happens when all retries are exhausted. There is no dead-letter queue on GitHub's side — failed deliveries simply appear in the webhook delivery log as failed. The connector must implement its own reconciliation via polling when webhook delivery is uncertain.
  Correction: state explicitly that GitHub has no dead-letter queue; polling fallback is the only recovery path after retry exhaustion.

---

## Polling Fallback

- **`since` parameter behavior edge case not documented**
  The `since` parameter filters by `updated_at`, not `created_at`. An issue created before the last-checked timestamp but edited after it will appear in results. This is correct behavior for the polling strategy but should be documented so the normalizer does not treat all results as new items.
  Correction: note that `since` matches on `updated_at`; the normalizer must check whether the issue already exists in the store and diff accordingly.

- **Comments polling endpoint is correct but cursor strategy is missing**
  The document lists `GET /repos/{owner}/{repo}/issues/comments?since=<timestamp>` for cross-issue comment polling. However, this endpoint returns all comments across all issues in the repo sorted by `updated_at`. For a repo with high comment volume, this requires careful page iteration. No guidance is given on how to handle the case where there are more than 100 new comments per polling cycle (i.e., how to know when to stop paginating).
  Correction: add guidance: "Paginate until a comment's `updated_at` is older than the last-checked timestamp, then stop. Do not rely on total count."

- **No guidance on detecting new comments on existing items during polling**
  The review prompt specifically asks whether the polling fallback can detect new comments on existing issues. The document lists the comments endpoint but does not explain the detection logic: to find new comments on known issues, either (a) poll `GET /repos/{owner}/{repo}/issues/comments?since=<timestamp>` globally and match `issue_url` back to known issue IDs, or (b) poll per-issue using `GET /repos/{owner}/{repo}/issues/{issue_number}/comments?since=<timestamp>`. Strategy (a) is more efficient at scale. Neither strategy is explained.
  Correction: add a subsection explaining the comment detection approach during polling fallback.

- **Page-number pagination vs cursor for polling correctness**
  The document uses page-number pagination for the polling fallback. Under high-volume conditions, if new issues are created between page fetches, items can shift pages and cause missed events. This is a known limitation of page-number pagination without a stable sort cursor.
  Correction: add a note that page-number pagination during polling is susceptible to drift under write load; for high-volume repos, use the `since` timestamp approach exclusively and avoid multi-page pagination across a single poll cycle.

---

## Mention Detection

- **Mention trigger implementation is incomplete**
  Section 6 defines a `mention` trigger with value `support-agent[bot]`. However, the document does not explain how to detect a mention from the webhook payload alone. GitHub does not deliver a dedicated "mentioned" webhook event. The `issue_comment.created` payload body text must be scanned for `@support-agent[bot]` by the connector itself — there is no platform-side signal.
  Section 3 does not document this at all. Section 6 lists the trigger but gives no implementation path.
  Correction: add a note in Section 3 under mention detection: "GitHub does not deliver a mention-specific webhook event. Mention detection requires scanning `issue.body` on `issues.opened`/`issues.edited` and `comment.body` on `issue_comment.created`/`issue_comment.edited` for the configured bot username pattern. A separate API lookup is not required."

- **`mentions:user` search qualifier is available but not referenced for polling**
  The Search API supports `mentions:<username>` as a qualifier. During polling fallback, this could be used to find issues or comments mentioning the bot. The document lists the qualifier in the Search API table (Section 9) but does not connect it to mention detection.
  Correction: reference `GET /search/issues?q=mentions:support-agent[bot]+updated:><timestamp>` as an alternative mention-detection polling strategy.

---

## Bot-Authored Content Filtering

- **Loop prevention via `sender.type` is correct but `sender.login` check is preferred**
  Section 7 correctly identifies `sender.type === 'Bot'` and login suffix as bot detection mechanisms. However, `sender.type === 'Bot'` will match any GitHub App bot, not just SupportAgent's own bot. If the repo has multiple GitHub App integrations, this could suppress legitimate inbound signals from other bots (e.g., a Dependabot comment that happens to mention a SupportAgent-relevant label).
  Correction: clarify that the primary loop-prevention check should be `sender.login === configured_bot_login`, not just `sender.type === 'Bot'`.

- **No guidance on whether to filter `issue_comment.edited` for bot-authored comments**
  If SupportAgent edits one of its own comments, `issue_comment.edited` fires with `sender.login === bot_login`. The document does not mention that the connector must filter this event to avoid re-triggering on its own edits.
  Correction: add a note that `issue_comment.edited` where `sender.login === configured_bot_login` must be suppressed to prevent edit loops.

---

## Eventual Consistency

- **Single mention in Section 10 Gotcha #4 is insufficient**
  The document notes "Webhook delivery may lag; use GET endpoint to verify current state." This is accurate but underspecified. In practice, GitHub's eventual consistency gap manifests as: a webhook fires with `issues.labeled` but immediately fetching the issue via REST may not yet reflect the new label (lag is typically <1s but can be longer under load).
  Correction: strengthen the guidance: "Do not rely on the webhook payload state as the definitive current state. For label, assignee, and milestone changes, fetch the issue via REST after receiving the webhook before persisting. Implement a short retry (e.g., 3 attempts with 500ms delay) if the fetched state does not yet reflect the expected change."

- **No note on comment body availability**
  When `issue_comment.created` fires, the `comment.body` in the payload is the authoritative value — no secondary fetch is needed. This is worth stating explicitly to avoid unnecessary API calls.
  Correction: add note: "For `issue_comment.created`, the `comment.body` in the webhook payload is the authoritative value; no secondary fetch is required."

---

## Known Broken Fields

- **`issue.reactions` absent from payload interface but present in REST response**
  The REST API response for issues includes a `reactions` object. The `GitHubIssue` interface omits it. Not a broken field, but a missing field that may be relevant for triage scoring.

- **`issue.timeline_url` is absent from interface**
  The actual REST response includes `timeline_url`. Minor omission; not a blocker.

- **`pull_request` field in interface typed as `{ url: string; html_url: string } | null`**
  The actual shape includes additional fields: `merged_at`, `diff_url`, `patch_url`. The interface is a subset, which is acceptable, but the comment `// null for issues` in the interface suggests this field will always be null for issues — which is true. The interface could include the full shape for correctness.

---

## Summary of Required Corrections

1. Add `issues.assigned` / `issues.unassigned` to MVP webhook event list, or explicitly defer with acknowledgment of trigger gap.
2. Add `issues.edited` to MVP or document that title/body triggers are webhook-blind until Phase 2.
3. Remove `issue_dependencies` webhook event — this event does not exist on GitHub.
4. Add `installation?: { id: number; node_id: string }` to webhook payload interface for GitHub App multi-tenant support.
5. Add raw-body verification warning before body parser middleware.
6. Add `X-Hub-Signature-256` to the Section 3 delivery headers table.
7. Document absence of timestamp-based replay protection; recommend `X-GitHub-Delivery` deduplication.
8. State at-least-once delivery guarantee explicitly.
9. Add approximate retry schedule (~2 min window, 5 attempts).
10. Document 72-hour manual re-delivery window and absence of a dead-letter queue.
11. Document `since` parameter behavior (matches `updated_at`, not `created_at`).
12. Add comment polling pagination stop condition.
13. Add mention detection implementation note (body scan, no platform event).
14. Clarify bot loop-prevention check: prefer `sender.login === configured_bot_login` over `sender.type === 'Bot'`.
15. Add guidance to suppress `issue_comment.edited` events from the bot's own login.
16. Strengthen eventual-consistency guidance for label/assignee/milestone webhook payloads.
