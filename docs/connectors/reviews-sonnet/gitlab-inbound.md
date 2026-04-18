# GitLab Connector — Inbound Events Review

**Verdict:** MOSTLY CORRECT with several gaps and one factual error that require fixes before implementation. The core event set, payload shapes, and signature mechanism are accurately described. Key issues: missing `confidential_note` event type, the `Idempotency-Key` header claim is unverified and likely incorrect, label-change detection uses non-canonical field paths, mention detection is under-specified, and there is no coverage of the `confidential_issues_events` toggle or the webhook retry window duration.

---

## Findings

### 1. Missing webhook event type: Confidential Issue Hook

- **Flow affected:** Inbound issue intake
- **What is wrong:** Section 3.1 lists `Issue Hook` but omits `Confidential Issue Hook`. GitLab fires a separate `X-Gitlab-Event: Confidential Issue Hook` for confidential issues (when the user creates an issue with `confidential: true`). If the webhook is configured without `confidential_issues_events: true`, confidential issues are silently dropped.
- **Correction:** Add a row to the event table: `Confidential Issue Hook` / `object_kind: issue` / actions `open, close, reopen, update`. The webhook registration call (section 3.1) must include `confidential_issues_events: true`. The connector should treat this event identically to `Issue Hook` after confirming bot has access.

---

### 2. Missing webhook event type: Confidential Note Hook

- **Flow affected:** Inbound comment intake on confidential issues
- **What is wrong:** Section 3.1 lists `Note Hook` but omits `Confidential Note Hook` (`X-Gitlab-Event: Confidential Note Hook`). Comments on confidential issues arrive under this separate header. Without handling it, comments on confidential issues are never processed.
- **Correction:** Add `Confidential Note Hook` / `object_kind: note` to the event table. Webhook registration must include `confidential_note_events: true`. Handler logic should be identical to `Note Hook`.

---

### 3. Idempotency-Key header claim is unverified / likely incorrect

- **Flow affected:** Replay protection / deduplication (section 3.3)
- **What is wrong:** The doc states "GitLab sends an `Idempotency-Key` header with each delivery attempt." This is not documented in GitLab's official webhook documentation and is not observed in practice. GitLab does NOT currently send an `Idempotency-Key` header on webhook deliveries. This appears to be a confusion with other platforms (e.g., Stripe). Section 10.10 also repeats this claim and notes "the value format and semantics are not clearly documented" — which is a signal the claim itself may be wrong.
- **Correction:** Remove the `Idempotency-Key` deduplication claim. Instead, use `object_kind` + `objectAttributes.id` + `objectAttributes.updated_at` as the idempotency composite key. For Note Hook events, use `objectAttributes.id` (note ID) as the dedup key — note IDs are globally unique within a GitLab instance.

---

### 4. Label-change detection uses non-canonical field paths

- **Flow affected:** Label add/remove triggers (section 6, triggers table)
- **What is wrong:** The doc describes label change detection via `changes.labels.previous[]` and `changes.labels.current[]`. The actual GitLab webhook payload for label changes uses `changes.labels` with keys `previous` and `current`, each containing an array of label objects with fields `{ id, title, color, description, ... }`. The field is `title`, not a bare string. The doc implies the diff contains strings but it contains label objects.
- **Correction:** The correct diff path is `changes.labels.previous[].title` and `changes.labels.current[].title` for name-based comparisons, or `changes.labels.previous[].id` / `changes.labels.current[].id` for ID-based matching. Compute added = IDs in `current` not in `previous`; removed = IDs in `previous` not in `current`.

---

### 5. Note Hook `action` field is not always present

- **Flow affected:** New comment trigger (section 6, `objectAttributes.action === "create"`)
- **What is wrong:** Section 6 states `object_kind === "note"` + `objectAttributes.action === "create"` to detect new comments. However, the `action` field on Note Hook payloads is not consistently present across GitLab versions. On many self-managed instances (pre-16.x), Note Hook payloads do not include `objectAttributes.action`. Detection based solely on this field will miss events on older instances.
- **Correction:** Treat any inbound `Note Hook` / `Confidential Note Hook` as a new comment unless `objectAttributes.updated_at` differs significantly from `objectAttributes.created_at` (indicating an edit). For editing detection, the connector should compare `updated_at > created_at` by a small threshold (e.g., > 2 seconds). Do not depend on `action` being present.

---

### 6. Mention detection is under-specified for bot mention use case

- **Flow affected:** Mention detection / bot-mention trigger (section 3.5 and section 6)
- **What is wrong:** Section 6 says bot mention can be detected by scanning `objectAttributes.body` for `@bot-username`. This is correct but incomplete. The doc does not address:
  - GitLab does NOT send a separate "mention" event — all mentions arrive via the same `Note Hook` or `Issue Hook` payloads. This needs to be explicit.
  - Mentions in issue descriptions (not comments) arrive on `Issue Hook` with `action: update` — the connector must also scan `objectAttributes.description` in issue update events, not only note bodies.
  - Mentions in MR descriptions and MR notes require scanning `objectAttributes.description` on `Merge Request Hook` and `objectAttributes.body` on `Note Hook` with `noteable_type: MergeRequest`.
  - There is no GitLab-native field that flags "this event contains a mention of user X" — the text scan is the only mechanism.
- **Correction:** Add an explicit "Mention Detection" subsection. State: no dedicated mention event exists; the connector must scan `objectAttributes.body` (notes) and `objectAttributes.description` (issue/MR create or update) for `@botUsername`. Mention matches should be case-insensitive since GitLab usernames are case-insensitive in mentions.

---

### 7. Webhook retry window and disable-after-failure threshold details are incomplete

- **Flow affected:** Delivery guarantees (section 3.3)
- **What is wrong:** The doc states "retries with exponential backoff" and "after 40 consecutive failures, the webhook is permanently disabled." Both claims are directionally correct but lack precision:
  - GitLab retries failed webhooks up to 4 additional times (total 5 attempts), not indefinitely until 40 failures. The 40-failure disable threshold applies to the *total count of recent failures* tracked by the webhook health mechanism, not to a single delivery stream.
  - The re-enable claim is also incorrect: a disabled webhook is NOT automatically re-enabled on a successful delivery. It must be manually re-enabled via the UI or API (`PUT /projects/:id/integrations/webhooks/:hook_id`).
  - GitLab.com imposes a 24-hour lookback for the failure count.
- **Correction:** Clarify: each delivery attempt is retried up to 4 times with exponential backoff (total 5 attempts per event). The webhook is auto-disabled after accumulating failures over time (threshold: 40 consecutive failures per GitLab docs). Manual re-enable is required via `PUT /projects/:id/integrations/webhooks/:hook_id` — it does NOT auto-recover.

---

### 8. Polling fallback does not cover comment discovery on existing items

- **Flow affected:** Polling fallback — new comments on existing issues/MRs (section 3.4)
- **What is wrong:** The doc lists polling endpoints for issues and MRs using `updated_after`, and includes note endpoints. However, it does not describe the strategy for discovering new comments on existing issues when polling. The issue `updated_at` is bumped when a note is added, so the issue list poll will surface issues with new comments — but then the connector must fetch all notes for those issues to find which note is new. The doc does not describe this two-step pattern.
- **Correction:** Document the polling pattern explicitly: (1) poll `GET /projects/:id/issues?updated_after=<cursor>` to find issues touched since last poll; (2) for each updated issue, poll `GET /projects/:id/issues/:iid/notes?updated_after=<cursor>` to retrieve only new/updated notes. Store the last-seen `updated_at` per issue to minimize redundant note fetches. Same pattern applies for MR notes.

---

### 9. No coverage of eventual consistency gap for Note Hook payloads

- **Flow affected:** Note intake — `Note Hook` processing
- **What is wrong:** GitLab can fire a `Note Hook` webhook before the note is fully visible via the REST API (e.g., immediately after creation, the `GET /projects/:id/issues/:iid/notes/:note_id` endpoint may return 404 for a brief window). This is a known eventual-consistency gap in GitLab's architecture. The doc does not flag this risk.
- **Correction:** Add a note: after receiving a `Note Hook`, if a follow-up GET for the note returns 404, implement a short retry (e.g., 3 attempts with 1-second delay). This is particularly relevant for self-managed instances under load.

---

### 10. `object_kind` casing in payload vs header casing are mixed inconsistently

- **Flow affected:** Event routing
- **What is wrong:** The doc uses both `objectAttributes` (camelCase) and `object_kind` (snake_case) when describing payload fields. GitLab's webhook payloads use `object_kind` (snake_case) and `object_attributes` (snake_case) consistently. The camelCase `objectAttributes` used throughout sections 3.5 and 6 is incorrect — it will cause field access bugs if used literally in connector code.
- **Correction:** Replace all occurrences of `objectAttributes` with `object_attributes` in sections 3.5 and 6. The correct top-level key is `object_attributes` (snake_case). Example: `payload.object_attributes.body`, not `payload.objectAttributes.body`.

---

### 11. No coverage of `noteable_type` for routing Note Hook events

- **Flow affected:** Note Hook routing to correct item type
- **What is wrong:** Section 3.5 lists `noteable_type (Issue|MergeRequest|Commit|Snippet)` as a field to persist, but there is no guidance on using it for routing. A single `Note Hook` handler must dispatch to the correct item type based on `object_attributes.noteable_type`. The doc does not specify how to route these, or which `noteable_type` values SupportAgent should handle vs ignore.
- **Correction:** Add routing logic guidance: handle `noteable_type: "Issue"` and `noteable_type: "MergeRequest"` as primary cases. Log and discard `noteable_type: "Commit"` and `noteable_type: "Snippet"` at MVP — they have no corresponding SupportAgent item type.

---

### 12. Polling fallback missing cursor persistence strategy

- **Flow affected:** Polling fallback reliability (section 3.4)
- **What is wrong:** The polling queries use `updated_after` but the doc does not specify how the cursor is persisted and advanced. Without this, there is a risk of re-processing events on restart or of missing events at window boundaries.
- **Correction:** Specify: persist the cursor as `max(updated_at)` of all items returned in the last successful poll page, not as wall-clock time. Use overlap (subtract 30 seconds from the cursor) to handle events that arrive slightly out of order. Store cursor per project+item-type combination in the connector's own persistence layer (not in GitLab).

---

### 13. Bot-authored event filtering: `payload.user` vs `object_attributes.author_id`

- **Flow affected:** No-self-retrigger logic (section 7.3)
- **What is wrong:** Section 7.3 says to check `payload.user.id === botId` on Note Hook events. For `Note Hook` payloads, the top-level `user` field reflects the user who triggered the action, and `object_attributes.author_id` reflects the note's author. These are usually the same, but for system-generated notes or certain automation paths they may differ. The doc does not distinguish these two fields.
- **Correction:** For Note Hook events, check both `payload.user.id === botId` and `payload.object_attributes.author_id === botId`. Treat either match as bot-authored. The `object_attributes.author_id` field is the more reliable signal for note authorship; `payload.user` is the actor context.

---

## Summary of Required Corrections

| # | Issue | Severity |
|---|---|---|
| 1 | Missing `Confidential Issue Hook` event type | High — data loss |
| 2 | Missing `Confidential Note Hook` event type | High — data loss |
| 3 | False `Idempotency-Key` header claim | High — broken deduplication |
| 4 | Label-change paths reference string values, should be objects | Medium — logic bug |
| 5 | `action: "create"` not always present on Note Hook | Medium — missed events |
| 6 | Mention detection incomplete (description fields, case sensitivity) | Medium — missed triggers |
| 7 | Retry/disable semantics imprecise, auto-recover claim incorrect | Medium — ops hazard |
| 8 | Polling does not describe two-step comment discovery | Medium — missed comments |
| 9 | No eventual-consistency gap noted for Note Hook | Low — rare but real |
| 10 | `objectAttributes` should be `object_attributes` (snake_case) | High — runtime bug |
| 11 | No routing logic for `noteable_type` on Note Hook | Low — implementation gap |
| 12 | Cursor persistence strategy absent from polling fallback | Medium — reliability |
| 13 | Bot self-filter checks `user.id` but should also check `author_id` | Low — loop risk |
