# GitLab Connector — Inbound Events Review

**Verdict: APPROVED WITH CORRECTIONS** — The webhook and polling story is fundamentally sound, but has several specific issues to fix before implementation.

---

## Findings

### 1. `event_type` field missing from documented payload shapes

**Affected:** All three webhook event types (Issue Hook, MR Hook, Note Hook)

**Problem:** The doc only documents `object_kind` but GitLab webhooks also include a top-level `event_type` field. For Issue Hooks, `event_type` is `"issue"` regardless of `object_kind` being `"issue"` or `"work_item"`. For Note Hooks, `event_type` is `"note"`. This field is the reliable discriminator for payload shape, not just `object_kind`.

**Correction — add to webhook envelope fields (section 3.5):**
```
event_type: "issue" | "merge_request" | "note" | "work_item"  # top-level, always present
```

**Correction — Note Hook payload shape (section 3.5) also needs `event_type`:**
```json
{
  "object_kind": "note",
  "event_type": "note",   // ← missing from doc
  "user": { ... },
  "project": { ... },
  "object_attributes": { ... },
  "issue": { "iid": 5 },          // present for issue comments
  "merge_request": { "iid": 12 }  // present for MR comments
}
```

---

### 2. Label add/remove detection is under-specified

**Affected:** Issue Hook and MR Hook — label change detection (section 6 triggers table)

**Problem:** The triggers table says to diff `changes.labels.previous[]` / `changes.labels.current[]` to find added/removed labels. This is correct, but the doc never establishes that label changes come through the generic `update` action — there is no `label_add` or `label_remove` action. The `objectAttributes.action` on label-change events is `"update"`, not a label-specific action. A reader could incorrectly implement separate handlers expecting `action === "label_add"`.

**Correction — add a note in section 6 (Triggers table) or under Issue Hook actions:**
> Label add/remove is **not** a separate event type. GitLab fires `Issue Hook` with `action: "update"` and the diff lives in `changes.labels.previous` / `changes.labels.current`. Compare these arrays to determine what was added vs. removed.

---

### 3. Assignee change detection is under-specified

**Affected:** Issue Hook and MR Hook — assignee change triggers (section 6)

**Problem:** Same pattern as labels. Assignee changes arrive as `action: "update"` with `changes.assignees.previous` / `changes.assignees.current`. The triggers table entry "Assignee change — `changes.assignees` with `previous`/`current`" is correct but easy to miss without context.

**Correction — expand the assignee trigger row:**
> **Assignee change** — `objectAttributes.action === "update"` AND `changes.assignees.previous` / `changes.assignees.current` present. Diff the arrays to identify added/removed assignees.

---

### 4. Work Items have separate `object_kind` — connector must handle both

**Affected:** Issue Hook — `object_kind` field (section 3.1 and 3.3)

**Problem:** The doc only mentions `object_kind: issue` for Issue Hooks. However, when GitLab delivers a webhook for a Work Item (Task, Incident, Test Case, Epic via group webhook), `object_kind` is `"work_item"` and a `type` field holds the specific type (`"Task"`, `"Incident"`, `"Epic"`). Only legacy issues send `object_kind: "issue"`. If the connector only matches `object_kind === "issue"`, it will silently drop Work Item events.

**Correction — update section 3.1 Issue Hook row:**
| Header Value | `object_kind` | `type` | Actions | SupportAgent relevance |
|---|---|---|---|---|
| `Issue Hook` | `issue` (legacy) / `work_item` (Tasks, Incidents, etc.) | `Issue` / `Task` / `Incident` / etc. | `open`, `close`, `reopen`, `update` | **Primary** — inbound issues |

**Correction — update section 3.3 payload fields (Issue/MR from `objectAttributes`):**
```
type: "Issue" | "Task" | "Incident" | etc.  # discriminator for work item type
```

**Correction — update MVP webhook event handling:**
```
- Handle both object_kind: "issue" and object_kind: "work_item" on Issue Hook
- Check payload.type to determine if it's a legacy issue or a specific work item type
```

---

### 5. Note Hook `action` values are accurate

**Affected:** Note Hook — `action` field (section 3.1)

**No issue found.** The doc correctly lists `create` and `update` as the only Note Hook action values. Verified against current GitLab docs.

---

### 6. MR Hook `action` values need correction

**Affected:** Merge Request Hook — `action` values (section 3.1)

**Problem:** The doc lists `open`, `close`, `reopen`, `update`, `merge`, `approval`, `approved`, `unapproval`, `unapproved`. Two issues:

1. `approval` is not a standalone MR action. The actual set is: `open`, `close`, `reopen`, `update`, `merge`, `approved`, `unapproved`. The `approval` vs `approved` distinction is misleading — "approval" describes a user's action, "approved" describes the MR's resulting state.
2. `approval` (as listed) is the event type for the Approval webhook, which is a **separate** webhook type, not a Merge Request Hook action. GitLab has a distinct `Approval Hook` for approval events.

**Correction — update MR Hook actions in section 3.1:**
| `Merge Request Hook` | `merge_request` | `open`, `close`, `reopen`, `update`, `merge`, `approved`, `unapproved` | **Primary** |

> **Note:** Approval events (`approved` / `unapproved`) on MRs arrive as Merge Request Hook with those action values. A separate `Approval Hook` also exists for granular per-user approval tracking — evaluate if needed for Phase 2+.

---

### 7. Replay protection — no timestamp tolerance to document

**Affected:** Webhook verification (section 3.2)

**Finding — no issue, but worth noting:** GitLab does not send a timestamp header (unlike GitHub's `X-Hub-Signature-256` with timestamp prefix). There is no mechanism to detect replay attacks beyond the `Idempotency-Key` header. This is a known GitLab limitation and should be documented.

**Correction — add to section 3.2 or a new note:**
> **No timestamp header:** Unlike GitHub, GitLab does not send a delivery timestamp in webhook headers. Replay protection relies solely on `X-Gitlab-Webhook-UUID` deduplication (store the UUID per delivery) and `Idempotency-Key` header. UUID was introduced in GitLab 17.4. Older instances may not send it.

---

### 8. `Idempotency-Key` header — versioning caveat missing

**Affected:** Retry/delivery semantics (section 3.3)

**Problem:** The doc mentions `Idempotency-Key` header but omits that it was introduced in **GitLab 17.4** (released ~mid-2025). Self-managed instances on older versions will not send it. The connector must handle its absence gracefully.

**Correction — update section 3.3:**
> **Idempotency-Key header:** Present on all deliveries from GitLab 17.4+. Older instances (pre-17.4) do not send this header. Fall back to `X-Gitlab-Webhook-UUID` (also 17.4+) or `payload.objectAttributes.updated_at` + `payload.objectAttributes.id` for deduplication.

**Additional header to note:** `X-Gitlab-Webhook-UUID` — a unique UUID per delivery (also GitLab 17.4+). Use as the primary idempotency key when present.

---

### 9. `X-Gitlab-Event-UUID` header not documented

**Affected:** Webhook delivery headers (section 3.2 or 3.3)

**Problem:** GitLab sends `X-Gitlab-Webhook-UUID` (not `X-Gitlab-Event-UUID`) as a unique per-delivery identifier. This is the preferred idempotency key. The doc doesn't mention it.

**Correction — add to section 3.3:**
> **Headers present on every delivery (GitLab 17.4+):**
> - `X-Gitlab-Webhook-UUID` — unique per delivery attempt; use as idempotency key
> - `X-Gitlab-Event-UUID` — event UUID (may differ from webhook delivery UUID)
> - `X-Gitlab-Token` — the shared secret
> - `X-Gitlab-Event` — event type name (e.g., `Issue Hook`)
> - `X-Gitlab-Instance` — GitLab instance hostname

---

### 10. Note Hook: `objectAttributes.note` not `body`

**Affected:** Comment/Note payload fields (section 3.5)

**Problem:** The doc uses `body` for the note content in the webhook payload (`objectAttributes.body`). The actual field name in GitLab webhook payloads is `objectAttributes.note` (not `body`). Note content is in `objectAttributes.note`.

**Correction — update section 3.5 Comment/Note fields:**
```
objectAttributes.note  # actual field name for comment body in webhook payload
objectAttributes.body  # this is the API response field, NOT the webhook field
```

The Note API response uses `body`, but the **webhook payload** uses `note`. This is a critical distinction that will cause bugs.

---

### 11. Mention detection — confirmed correct, but nuance missing

**Affected:** Mention trigger (section 6)

**No issue found.** GitLab has no separate mention event. The doc correctly identifies that mention detection requires text scanning `objectAttributes.note` (webhook) or the API's `body` field for `@bot-username`. This is accurate.

**Addition — note in section 6:**
> **Bot mention detection:** GitLab sends no dedicated `mention` event. Scan `objectAttributes.note` (webhook) or `body` (API) for `@botUsername`. Note: this is text-only; GitLab does not surface which users were explicitly resolved as mentions in the webhook payload. If precise mention tracking is required, a secondary lookup via `@gitlab/api` to resolve mentions in the rendered content may be needed.

---

### 12. Bot-authored content filter — `system` field caveat correct but needs expansion

**Affected:** Bot identity / no-self-retrigger (section 7.3)

**Finding — mostly correct, but incomplete.** The doc correctly warns that `note.system === true` only marks system-generated notes (e.g., "MR merged"). Regular bot comments via PAT are NOT `system: true`. However, the doc misses one nuance: GitLab does not provide a webhook field that marks "this note was created by our bot." The only reliable approach is comparing `author.id === botId` or `author.username === botUsername` on every event.

**Correction — expand section 7.3 loop prevention:**
> **Reliable bot filtering:** GitLab provides no `is_bot` flag or special marker on webhook events. The ONLY reliable approach:
> 1. Store bot's global `userId` (integer) — prefer this over username (case-sensitive, stable)
> 2. On every webhook: `payload.user.id === botId` (for Issue/MR events) and `payload.objectAttributes.author.id === botId` (for Note Hooks)
> 3. For Note Hooks, also check `payload.objectAttributes.author.username === botUsername` as a fallback
> 4. `note.system === true` is NOT sufficient — only marks GitLab-generated system notes (status changes, etc.), not bot comments

---

### 13. Eventual-consistency gap — webhook fires before API-readable

**Affected:** Note Hook, Issue/MR creation events

**Finding — needs documentation.** GitLab's webhook delivery is asynchronous and can arrive before the event is queryable via the API. For example:
- A new comment webhook arrives but `GET /issues/:iid/notes` may not yet return the new note
- Issue/MR creation webhooks may arrive before the API reflects the new resource

**Addition — new note under section 3.3 or 3.4:**
> **Eventual-consistency gap:** Webhook delivery is not guaranteed to precede API availability. If the connector fetches the referenced resource after receiving a webhook (e.g., to enrich with current state), it must retry with exponential backoff. A 500ms initial delay with up to 3 retries is a reasonable default. Alternatively, rely on the webhook payload fields directly for creation events rather than a follow-up API lookup.

---

### 14. Dead-letter / disable behavior documented correctly

**Affected:** Webhook delivery guarantees (section 3.3)

**No issue found.** The doc correctly states: 4 consecutive failures temporarily disable (1 min to 24h backoff), 40 consecutive failures permanently disable, re-enabled only by a successful test delivery. The `enable_ssl_verification` flag for webhook registration is correctly noted.

---

### 15. Polling fallback — correct with one missing filter

**Affected:** Polling fallback (section 3.4)

**Minor gap:** The polling endpoints use `updated_after` / `updated_before` correctly. However, for detecting new comments on existing issues/MRs via polling, `GET /issues/:iid/notes` does not support `updated_after` filtering — it only supports `sort=desc` and pagination. The connector must paginate from the start and detect new notes by ID or `created_at` comparison.

**Correction — update section 3.4:**
> **Comment polling (issues/MRs):** `GET /projects/:id/issues/:iid/notes` does NOT support `updated_after`. Sort by `created_at` descending and track the highest known `note_id` to detect new comments since last poll. For high-volume polling, consider `GET /projects/:id/merge_requests/:iid/notes` — same constraint.

---

### 16. Group-level webhooks missing from registration docs

**Affected:** Webhook registration (section 3.1)

**Minor gap:** The doc only mentions project-level webhook registration. GitLab also supports group-level webhooks for events on all projects within a group (epics, group milestones, cross-project events). Premium+ is required for some group webhook events.

**Addition — under section 3.1:**
> **Group webhooks:** For watching multiple projects under a single group, register webhooks at the group level via `POST /groups/:id/hooks`. Group-level webhooks receive events for all projects in the group. Some event types (e.g., Epic) are only available via group webhooks. Premium+ required for some event types.

---

## Summary of Corrections

| # | Section | Severity | Fix |
|---|---|---|---|
| 1 | 3.1, 3.5 | High | Add `event_type` to all payload shape docs |
| 2 | 3.1, 6 | Medium | Clarify label changes arrive as `update` action, not separate events |
| 3 | 6 | Medium | Clarify assignee changes: `action: "update"` + `changes.assignees` diff |
| 4 | 3.1, 3.3, MVP | High | Handle `object_kind: "work_item"` alongside `object_kind: "issue"` |
| 5 | 3.1 | None | Confirmed correct |
| 6 | 3.1 | Medium | Remove `approval` from MR Hook actions; it belongs to Approval Hook |
| 7 | 3.2 | Low | Document: no timestamp header — replay protection via UUID only |
| 8 | 3.3 | Medium | `Idempotency-Key` and `X-Gitlab-Webhook-UUID` are GitLab 17.4+ |
| 9 | 3.3 | Medium | Document `X-Gitlab-Webhook-UUID` as the primary idempotency key |
| 10 | 3.5 | High | `objectAttributes.note` is the webhook field, not `body` |
| 11 | 6 | Low | Note: GitLab surfaces no mention metadata in webhook payload |
| 12 | 7.3 | Medium | `system` flag insufficient; use `author.id` comparison only |
| 13 | 3.3/3.4 | Medium | Document eventual-consistency gap and retry guidance |
| 14 | 3.3 | None | Confirmed correct |
| 15 | 3.4 | Medium | Notes polling doesn't support `updated_after`; track highest note_id |
| 16 | 3.1 | Low | Add group-level webhook registration |

**Critical fixes before implementation:** #1, #4, #10, #12 (the `event_type`/`work_item` gap and `note` vs `body` field name are the most likely to cause silent data loss).
