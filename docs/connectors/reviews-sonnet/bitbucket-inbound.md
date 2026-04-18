# Inbound Events Review — Bitbucket Connector

**Reviewer**: claude-sonnet-4-6  
**Source document**: `docs/connectors/bitbucket.md`  
**Review scope**: Webhook / polling / event intake only (auth, outbound, and rate-limit coverage handled separately)  
**Date**: 2026-04-18

---

## Verdict

**Mostly correct, several issues require fixes before implementation.**  
The doc covers the right territory but contains a wrong event name, a missing header, incorrect retry figures, an inaccurate payload description, and several gaps in the Data Center event table that would cause silent misses in production. None of the errors are catastrophic but all of them affect correctness at the connector boundary.

---

## Findings

### 1. Wrong event name: `pullrequest:request_change`

- **Affected flow**: PR "changes requested" webhook handler.
- **Problem**: The doc lists `pullrequest:request_change` in both section 3.1.2 and section 11 (MVP event list). The actual Bitbucket Cloud event key is `pullrequest:changes_request_created`. A companion event `pullrequest:changes_request_removed` fires when the changes-request is withdrawn.
- **Correction**: Replace `pullrequest:request_change` with `pullrequest:changes_request_created` (and add `pullrequest:changes_request_removed` for completeness). The payload top-level adds a `changes_request` object alongside `actor`, `pullrequest`, and `repository`.

---

### 2. Missing Cloud signature header: `X-Hub-Signature-256`

- **Affected flow**: Signature verification (section 3.1.3).
- **Problem**: The doc says Bitbucket Cloud sends two headers — `X-Hub-Signature` and `X-Hub-Signature-256` — but the verification text only shows `X-Hub-Signature`. Both carry identical SHA256 values. The doc also does not name `X-Hub-Signature-256` at all, which is a problem because consumers who follow GitHub's convention and look for `X-Hub-Signature-256` will find it works on Bitbucket too, and the connector should prefer it for forward-compatibility.
- **Correction**: Document both headers. Prefer `X-Hub-Signature-256` for verification (same value, GitHub-compatible header name). `X-Hub-Signature` is also present and safe to use as a fallback. Neither header is `X-Hub-Signature-256: sha256=…` with a doubled prefix — the value format is `sha256={hex}` in both cases.

---

### 3. Retry count is wrong — Cloud retries twice (3 total), not three times

- **Affected flow**: Webhook delivery guarantees / idempotency design (section 3.1.4 and Appendix B).
- **Problem**: The doc table says "3 attempts (automatic)" for Cloud retries and Appendix B says "Bitbucket retries 3x". Official Atlassian documentation states Bitbucket retries up to **two more times** after an initial failure on HTTP 5xx, giving 3 total delivery attempts (1 original + 2 retries), not 3 retries. The wording in the doc implies 3 retries (4 total).
- **Correction**: "Up to 3 total delivery attempts (1 initial + 2 automatic retries on HTTP 5xx)". Retries fire only on 5xx responses, not on timeout — a timeout is logged as status `-1` and does **not** trigger a retry automatically.
- **Additional gap**: Retry delay is described as "exponential backoff" but Atlassian's own documentation says retries happen essentially immediately with no configurable delay. Remove the exponential backoff claim.

---

### 4. Timeout value is wrong for Cloud (10 s, not 30 s)

- **Affected flow**: Webhook delivery guarantees (section 3.1.4).
- **Problem**: The doc lists a 30-second timeout for Bitbucket Cloud webhooks. The actual documented timeout is **10 seconds**. Responses not received within 10 s are recorded as a timeout (status `-1`) and are not retried.
- **Correction**: Change Cloud timeout from `30 seconds` to `10 seconds`.

---

### 5. Missing Cloud webhook events: `pullrequest:comment_resolved` and `pullrequest:comment_reopened`

- **Affected flow**: Comment thread resolution intake.
- **Problem**: Bitbucket Cloud fires `pullrequest:comment_resolved` and `pullrequest:comment_reopened` as distinct events. The doc only lists `pullrequest:comment_created`, `pullrequest:comment_updated`, and `pullrequest:comment_deleted`. Resolve/reopen events are relevant for tracking comment thread lifecycle and for driving outbound "resolve thread" operations.
- **Correction**: Add `pullrequest:comment_resolved` and `pullrequest:comment_reopened` to section 3.1.2 and to the MVP event list in section 11.

---

### 6. Missing Cloud webhook events: `pullrequest:superseded`

- **Affected flow**: PR close/status-change intake.
- **Problem**: Bitbucket Cloud emits `pullrequest:superseded` when a PR is superseded by another. The doc lists `pullrequest:fulfilled` (merged) and `pullrequest:rejected` (declined) but not `pullrequest:superseded`. For completeness — especially if the connector tracks all "closed" PR states — this event should be noted.
- **Correction**: Add `pullrequest:superseded` to section 3.1.2 with a note that it is a terminal PR state distinct from merge and decline.

---

### 7. Missing Cloud events: `repo:branch_created`, `repo:branch_deleted`, `repo:deleted`, `repo:transfer`, `repo:commit_comment_created`, `repo:commit_status_created`, `repo:commit_status_updated`

- **Affected flow**: Repository-level event intake (section 3.1.2).
- **Problem**: The repository events table only lists `repo:push`, `repo:fork`, and `repo:updated`. Current Bitbucket Cloud documentation shows additional events: `repo:branch_created`, `repo:branch_deleted`, `repo:deleted`, `repo:transfer`, `repo:commit_comment_created`, `repo:commit_status_created`, and `repo:commit_status_updated`. The `repo:commit_status_*` events are directly relevant to CI/CD integration. The doc's Phase 3 section mentions pipeline status tracking but the webhook event path to get there is absent.
- **Correction**: Extend the repository events table to include the full set from official docs. Flag `repo:commit_status_created` / `repo:commit_status_updated` as useful for Phase 3 CI/CD integration.

---

### 8. Missing issue webhook event: `issue:updated` does not include a separate `issue:comment_updated` or `issue:comment_deleted`

- **Affected flow**: Issue comment intake.
- **Problem**: The doc lists `issue:comment_updated` and `issue:comment_deleted` as distinct Cloud events. The official Bitbucket Cloud event-payload documentation only lists three issue events: `issue:created`, `issue:updated`, and `issue:comment_created`. There are no `issue:comment_updated` or `issue:comment_deleted` event keys. Comment edits and deletes on issues do not appear to have dedicated webhook events — they must be detected via polling.
- **Correction**: Remove `issue:comment_updated` and `issue:comment_deleted` from section 3.1.2. Note that issue comment changes require polling (`GET /2.0/repositories/{workspace}/{repo}/issues/{id}/comments`) as no webhook fires for them.

---

### 9. Data Center event names: `pr:comment:created` and `pr:comment:edited` are wrong

- **Affected flow**: PR comment intake on Data Center.
- **Problem**: Section 3.1.2 lists Data Center comment events as `pr:comment:created`, `pr:comment:edited`, and `pr:comment:deleted`. The actual Data Center event keys (from confluence.atlassian.com/bitbucketserver) are `pr:comment:added`, `pr:comment:edited`, and `pr:comment:deleted`. "created" is a Cloud naming convention; Data Center uses "added".
- **Correction**: Replace `pr:comment:created` with `pr:comment:added` in the Data Center event table.

---

### 10. Data Center missing events: `pr:from_ref_updated`, `pr:to_ref_updated`, `pr:modified`, `pr:reviewer:updated`, `pr:reviewer:changes_requested`, `pr:deleted`

- **Affected flow**: Data Center PR event intake (section 3.1.2).
- **Problem**: The Data Center event table is abbreviated with only 8 events. The actual set includes at least: `pr:from_ref_updated` (source branch updated), `pr:to_ref_updated` (target branch updated), `pr:modified` (title/description change), `pr:reviewer:updated` (reviewer list changed), `pr:reviewer:changes_requested`, and `pr:deleted`. Without `pr:modified`, the connector will miss PR title/description edits. Without `pr:reviewer:changes_requested`, it will miss the Data Center equivalent of changes-requested.
- **Correction**: Expand the Data Center PR event table to match the full set from Atlassian Data Center documentation.

---

### 11. Data Center also has repo-level comment events not listed

- **Affected flow**: Commit comment intake on Data Center.
- **Problem**: Data Center emits `repo:comment:added`, `repo:comment:edited`, and `repo:comment:deleted` for commit-level comments. These are absent from the doc's Data Center event list.
- **Correction**: Add commit comment events to the Data Center events table.

---

### 12. Payload top-level shape: `pullrequest` wrapper field is `pullrequest`, not shown in webhook envelope

- **Affected flow**: Inbound payload parsing (section 3.2).
- **Problem**: The payload samples in section 3.2 show the PR object directly (bare `id`, `type`, etc.) as if it is the full webhook envelope. But webhook payloads from Bitbucket Cloud wrap the resource inside a top-level key. For PR events the envelope is `{ "actor": {...}, "pullrequest": {...}, "repository": {...} }`. The comment payload envelope is `{ "actor": {...}, "repository": {...}, "pullrequest": {...}, "comment": {...} }`. The samples in 3.2 appear to show just the inner object, not the full envelope delivered to the webhook URL.
- **Correction**: Wrap each sample with the full envelope showing `actor`, `repository`, and the resource key (`pullrequest`, `issue`, `comment`) at the top level. This is load-bearing for the connector's JSON deserializer.

---

### 13. Mention detection requires text parse — no dedicated webhook field

- **Affected flow**: Bot mention detection (sections 6.1, 6.2).
- **Problem**: The doc correctly notes that mention detection requires parsing `comment.content.raw` for `@bot-username`. This is accurate — Bitbucket Cloud has no structured `mentions` field in webhook payloads. The doc should flag that this means mention detection is inherently fragile against username changes and requires the connector to maintain the bot's configured username.
- **Correction**: Add a note that there is no structured `mentions` array; mention detection is purely text-based. If the bot's username changes the connector configuration must be updated to match. Consider also that `content.raw` uses `@{username}` syntax where username is the Atlassian account nickname (not UUID), making it impossible to correlate via UUID alone without a lookup.

---

### 14. No timestamp / replay protection documented — accurate but should be explicit

- **Affected flow**: Replay protection (security checklist).
- **Problem**: Bitbucket Cloud does not enforce timestamp-based replay protection. The doc is silent on this (neither claims it exists nor explicitly notes its absence). Appendix B's checklist mentions idempotency but does not explain that the connector must implement its own replay protection via `X-Request-UUID` header deduplication.
- **Correction**: Add a note that Bitbucket provides no timestamp-based replay window. The `X-Request-UUID` header (unique per delivery, re-used across retries of the same event) and `X-Attempt-Number` header can be used for deduplication. Implementers should persist seen `X-Request-UUID` values for a dedup window (e.g., 24 hours) to handle retries without double-processing.

---

### 15. Bot-authored comment filtering: `user.uuid` is available but `X-Attempt-Number` loop risk

- **Affected flow**: Bot loop prevention (section 7.3).
- **Problem**: The doc correctly notes that `author.uuid` (Cloud) / `author.name` (DC) can be used for no-self-retrigger detection. However, `pullrequest:comment_created` and `issue:comment_created` both fire when the bot posts a comment, and these events will re-enter the inbound pipeline unless the connector checks the actor UUID before dispatching. The doc does not explicitly state that the `actor` field in the envelope (not just the comment's `user` field) identifies who triggered the event — for comment events these are the same person, but the connector should check `actor.uuid` at envelope level rather than digging into the nested object, for consistency.
- **Correction**: Add guidance that loop prevention should inspect `actor.uuid` (Cloud) / `actor.name` (DC) in the webhook envelope, not just the nested `comment.user` or `comment.author` field.

---

### 16. Polling fallback cursor: `updated_on` acknowledged but filtering not addressed

- **Affected flow**: Polling fallback (section 3.1.5).
- **Problem**: The doc recommends `sort=-updated_on` as the cursor strategy but does not mention the `q` (query) filter available on Bitbucket Cloud list endpoints, which enables server-side filtering like `updated_on > "2024-01-01T00:00:00+00:00"`. Without this filter the connector fetches all PRs/issues and filters client-side, which is expensive at scale.
- **Correction**: Add the `q` parameter example: `?q=updated_on > "2024-01-01T00:00:00+00:00"&sort=-updated_on` for both PR and issue polling fallback. This reduces transferred payload and avoids exhausting pagination for active repositories.

---

### 17. Issue comment polling gap: no mention of how to detect new comments via polling

- **Affected flow**: Polling fallback for issue comments (section 3.1.5).
- **Problem**: The polling fallback section mentions `GET .../issues/{id}/comments` but does not specify the filtering or cursor strategy for detecting newly added comments. Comments lack a top-level `updated_on` index — the poll must either compare the list length or track the latest comment `id` per issue.
- **Correction**: Note that for issue comment polling, cursor should be the highest known comment `id`. Poll `GET /2.0/repositories/{workspace}/{repo}/issues/{id}/comments?sort=-id&pagelen=10` and process any comment with `id > last_seen_id`.

---

## Summary of Required Corrections

| # | Section | Severity | Issue |
|---|---------|----------|-------|
| 1 | 3.1.2, 11 | High | `pullrequest:request_change` → `pullrequest:changes_request_created` (+`_removed`) |
| 2 | 3.1.3 | Medium | Missing `X-Hub-Signature-256` header (both headers sent; prefer `256`) |
| 3 | 3.1.4 | Medium | Retry count: "3 retries" → "2 retries (3 total attempts)" |
| 4 | 3.1.4 | Medium | Cloud timeout: 30 s → 10 s; remove exponential backoff claim |
| 5 | 3.1.2, 11 | Medium | Missing `pullrequest:comment_resolved` and `pullrequest:comment_reopened` |
| 6 | 3.1.2 | Low | Missing `pullrequest:superseded` terminal state |
| 7 | 3.1.2 | Low | Repository events table incomplete (7 additional events) |
| 8 | 3.1.2 | High | `issue:comment_updated` and `issue:comment_deleted` do not exist — remove |
| 9 | 3.1.2 | High | DC: `pr:comment:created` → `pr:comment:added` |
| 10 | 3.1.2 | Medium | DC PR event table missing 6 events (`pr:modified`, `pr:from_ref_updated`, etc.) |
| 11 | 3.1.2 | Low | DC missing commit comment events (`repo:comment:added/edited/deleted`) |
| 12 | 3.2 | High | Payload samples show inner object only — missing webhook envelope wrapper |
| 13 | 6.1, 6.2 | Medium | Mention detection is text-only; no structured field; username ≠ UUID |
| 14 | Appendix B | Medium | No replay protection; document `X-Request-UUID` + `X-Attempt-Number` dedup pattern |
| 15 | 7.3 | Low | Loop prevention should use envelope `actor.uuid`, not nested comment field |
| 16 | 3.1.5 | Low | Polling fallback missing `q` filter for server-side `updated_on` filtering |
| 17 | 3.1.5 | Low | Issue comment polling cursor strategy missing |
