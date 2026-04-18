# Custom Git Server Connector — Inbound Events Review

**Verdict: APPROVED WITH CORRECTIONS** — The webhook and polling story is broadly sound but has several specific gaps, one critical payload shape mismatch, and some event name uncertainties that must be resolved before implementation.

---

## Findings

### 1. Gitea/Forgejo `label_added` / `label_removed` — `changes` object absent from payload docs

**Affected:** Gitea/Forgejo webhook payload shapes (Section 3.3), trigger matcher coverage (Section 6.1)

**Problem:** Section 6.1 lists `label_added` and `label_removed` as `action` values and references `changes.labels.current` / `changes.labels.previous` for detecting them. However, the documented payload example in Section 3.3 shows `labels` as a static array on the issue object — there is no `changes` object. The `changes` object is the correct location for Gitea's label diff data in webhook payloads, but it is never shown.

**Correction — add `changes` object to the Gitea/Forgejo Issue Payload example (Section 3.3):**

```json
{
  "action": "label_added",
  "issue": { "id": 12345, "number": 42, ... },
  "repository": { ... },
  "sender": { ... },
  "changes": {
    "labels": {
      "added": ["high-priority"],
      "removed": []
    }
  }
}
```

For `label_removed`: `"added": []`, `"removed": ["high-priority"]`.

**Also correct Section 6.1 trigger row:**
> `label_added` → `action === "label_added"` AND `changes.labels.added[]` contains the label name.
> `label_removed` → `action === "label_removed"` AND `changes.labels.removed[]` contains the label name.

---

### 2. GitLab SM — `event_type` field missing from payload envelope

**Affected:** GitLab SM webhook payload shapes (Section 3.1.4 / cross-reference to gitlab.md)

**Problem:** The document correctly cross-references gitlab.md for GitLab SM webhook events, but gitlab-inbound.md identifies that the webhook payload envelope requires both `object_kind` and `event_type`. The `event_type` field is the reliable discriminator for payload shape (e.g., `event_type: "note"` vs `object_kind: "note"` for Note Hooks). Custom git server doc Section 10.10 (payload shapes comparison table) shows `{ object_kind, object_attributes, project, user }` but omits `event_type`.

**Correction — add `event_type` to GitLab SM shape in the comparison table (Section 10.10):**
```
GitLab SM: { object_kind, object_attributes, project, user, event_type }
```

---

### 3. GitLab SM — `Note Hook` body field is `note`, not `body`

**Affected:** GitLab SM event triggers, mention detection (cross-referenced from gitlab-inbound.md #10)

**Problem:** The gitlab-inbound.md review identifies that GitLab's Note Hook webhook payload uses `objectAttributes.note` for the comment body, not `objectAttributes.body`. The `body` field is the API response field, not the webhook field. This distinction is not carried into the custom_git_server.md.

**Correction — update trigger matcher (Section 6.3, GitLab SM column):**
```
Comment body regex: objectAttributes.note  # NOT objectAttributes.body
Mention of bot: Parse objectAttributes.note for @botUsername  # NOT objectAttributes.body
```

---

### 4. Azure DevOps — event list is incomplete and comment edit/delete are missing

**Affected:** Azure DevOps webhook events (Section 3.1.5)

**Problem:** Section 10.2 (Known Gotchas) correctly flags "Work item comment edited/deleted events may be missing" for Azure DevOps. However, the main event table in Section 3.1.5 lists only `ms.vss.work.workitem.commented` and does not enumerate which work item event types are confirmed supported. Additionally, the document does not distinguish between "we're not sure if these events exist" vs "they definitely don't exist."

**Correction — update Section 3.1.5 event table with confirmed vs uncertain:**
```
| ms.vss.work.workitem.created | Work item created | Confirmed |
| ms.vss.work.workitem.updated | Work item updated | Confirmed |
| ms.vss.work.workitem.commented | Comment created | Confirmed |
| ms.vss.work.workitem.comment.edited | Comment edited | Uncertain — verify per Azure DevOps Server version |
| ms.vss.work.workitem.comment.deleted | Comment deleted | Uncertain — verify per Azure DevOps Server version |
```

---

### 5. Bitbucket DC — event namespace format is uncertain; may conflict with bitbucket.md

**Affected:** Bitbucket DC webhook events (Section 3.1.3)

**Problem:** Section 3.1.3 lists Bitbucket DC events with `pr:` prefix (e.g., `pr:opened`, `pr:modified`, `pr:merged`). However, the Bitbucket Cloud connector (bitbucket.md) uses `pullrequest:` prefix (e.g., `pullrequest:created`, `pullrequest:fulfilled`). It is unclear whether Bitbucket Server/DC uses `pr:` or `pullrequest:` as its event key namespace. The bitbucket.md source document uses `pullrequest:` for Cloud but the DC event list is not definitive about Server/DC format.

**Correction — add uncertainty note in Section 3.1.3:**
> **Note:** Bitbucket Server/DC event key format (`pr:` vs `pullrequest:` namespace) requires verification against the target tenant's version. Early Server versions may use `pr:`; later versions may align with Cloud's `pullrequest:` namespace. The connector should accept both formats or detect from the received `X-Event-Key` header.

---

### 6. Gitea/Forgejo polling — `GET comments` has no `since` parameter; comment-edit detection requires timestamp comparison

**Affected:** Polling fallback strategy (Section 3.2)

**Problem:** The polling section shows `GET /repos/{owner}/{repo}/issues/{index}/comments?limit=50` without mentioning that this endpoint does not support time-based filtering. Detecting new comments on existing issues via polling requires tracking the last-seen `created_at` and filtering client-side, or re-fetching the full comment list.

**Correction — update Gitea/Forgejo polling comment strategy:**
> **Gitea/Forgejo — Comment polling:** `GET /repos/{owner}/{repo}/issues/{index}/comments` does NOT support `since` or `updated_after` parameters. Track the highest known `comment.id` as cursor. On each poll, fetch all comments sorted by `created_at` descending and diff against the cached list. For detecting comment edits, compare `comment.updated_at` against the last-seen `updated_at` for each known comment ID.

---

### 7. Polling — no platform documents the comment-edit detection pattern

**Affected:** All platforms with polling fallback

**Problem:** For detecting edited comments (not just new comments) via polling, all platforms require comparing `updated_at` of each known comment against a stored reference. No platform surfaces this constraint explicitly.

**Addition — add to reconciliation strategy (Section 9.3 or 3.2):**
> **Comment edit detection via polling:** For all platforms, polling cannot rely on a `since` or `updated_after` filter at the comment level. The strategy is:
> 1. Track the highest known `comment.id` per item — this detects new comments
> 2. Track `comment.updated_at` per known comment ID — this detects edits
> 3. On each reconciliation pass: fetch comments, diff by ID for additions, diff `updated_at` for edits
> 4. For new items discovered via `updated_at` cursor, backfill all comments

---

### 8. Replay protection — absent for all self-hosted platforms; must be documented

**Affected:** All platforms with webhooks

**Problem:** Section 10 (Known Gotchas) does not address replay protection. None of Gitea, Forgejo, Gogs, Bitbucket DC, GitLab SM, or Azure DevOps send a delivery timestamp in webhook headers. This means:
- There is no timestamp-based tolerance window
- Duplicate delivery detection must rely on storing delivery IDs or computing content-based hashes
- Each platform provides a different deduplication key (if any)

**Addition — add new section under Section 3 or 10:**
> **Replay protection:** None of the self-hosted platforms send a delivery timestamp in webhook headers. The connector must implement its own deduplication:
>
> | Platform | Deduplication key | Notes |
> |---|---|---|
> | Gitea/Forgejo | `X-Gitea-Delivery` (UUID per delivery) | All versions; store with TTL |
> | Gogs | `X-Gogs-Delivery` (UUID per delivery) | All versions |
> | Bitbucket DC | `X-Request-UUID` | All versions; store with 24h TTL |
> | GitLab SM | `X-Gitlab-Webhook-UUID` (GitLab 17.4+) | Fall back to `payload.objectAttributes.updated_at` + `id` |
> | Azure DevOps | `messageId` (in payload) | All versions |
>
> **TTL recommendation:** Store deduplication keys with a 48-hour TTL. On duplicate delivery (same key), return 200 OK and skip processing.

---

### 9. Webhook delivery guarantees — partially documented but inconsistent

**Affected:** Gitea/Forgejo, GitLab SM (cross-referenced platforms)

**Problem:** Section 3.1.1 shows the Gitea/Forgejo webhook registration format but never describes delivery guarantees (retry count, retry window, dead-letter behavior). GitLab SM delivery semantics are in gitlab.md but not summarized in the custom_git_server doc. Azure DevOps has no delivery guarantee information at all.

**Correction — add delivery semantics table (Section 3.1.x or 10.x):**
> **Webhook delivery guarantees:**
>
> | Platform | Retries | Retry window | Dead-letter | Re-enable |
> |---|---|---|---|---|
> | Gitea/Forgejo | Configurable (default 3) | Immediate, then backoff | Dropped | Manual via admin UI |
> | Gogs | Unknown | Unknown | Unknown | Unknown |
> | Bitbucket DC | Configurable (default 3) | Configurable | Logged in UI | Manual |
> | GitLab SM | Exponential backoff | Up to 40 failures | Permanently disable | Test delivery or API |
> | Azure DevOps | Configurable | Per subscription | Per subscription | Per subscription |
>
> **Connector implication:** Always return 200 OK from the webhook handler immediately (before processing). Process asynchronously. On failure, the platform retries — do not rely on the first delivery being the only delivery.

---

### 10. Mention detection — correctly identified as text scan, but pattern not documented per platform

**Affected:** Mention trigger (Section 6.3)

**Finding — approach is correct.** All platforms require text scanning of the comment/body field. No platform provides a `mentioned_users` array or dedicated mention event.

**Addition — document platform-specific mention syntax patterns (Section 6.3):**
```
Gitea/Forgejo:    @username           (plain text, case-sensitive)
GitLab SM:        @username           (plain text, case-sensitive)
Bitbucket DC:     @{username}         (curly brace syntax, different from Cloud @username)
Azure DevOps:     @{user}             (with curly braces, @{displayName} or @{uniqueName})

Bot mention detection regex per platform:
  Gitea/Gitea:      new RegExp(`@${escapeRe(botUsername)}`, 'i')
  GitLab SM:        new RegExp(`@${escapeRe(botUsername)}`, 'i')
  Bitbucket DC:     new RegExp(`@\\{${escapeRe(botUsername)}\\}`, 'i')
  Azure DevOps:     new RegExp(`@\\{${escapeRe(botUsername)}\\}`, 'i')
```

> **Note:** Azure DevOps mentions use the identity's `displayName` or `uniqueName`, not necessarily a username. If the bot's Azure DevOps identity has displayName "Support Agent", the mention pattern is `@{Support Agent}`, not `@{support-agent}`. The connector must store the bot's Azure DevOps display name for accurate mention detection.

---

### 11. Bot-authored content filter — Azure DevOps field path is wrong

**Affected:** Bot identity / no_self_retrigger (Section 7.3)

**Problem:** Section 7.3 states for Azure DevOps:
> Check `payload.resource?.fields?.System.ChangedBy?.uniqueName`

The `System.ChangedBy` field on work items is an identity reference object with shape `{ displayName, uniqueName, id }`. However, for comment events (`ms.vss.work.workitem.commented`), the bot-authored check should look at the comment author, not the work item's `ChangedBy`. The comment author is at `payload.resource.fields.System.CreatedBy` or in the comments thread structure.

**Correction — update Section 7.3 Azure DevOps bot detection:**
```
Azure DevOps — work item field change:
  Check payload.resource?.fields?.System.ChangedBy?.uniqueName === botUniqueName

Azure DevOps — comment created:
  Check payload.resource?.fields?.System.CreatedBy?.uniqueName === botUniqueName
  # Note: System.CreatedBy is the work item creator, not the commenter.
  # For comment-level detection, the comment author is in the comments thread.
  # ms.vss.work.workitem.commented may not include per-comment author in all versions.
  # Verify by testing against the tenant's Azure DevOps Server version.
```

---

### 12. Gogs has fewer events than Gitea — connector gap not surfaced in MVP scope

**Affected:** MVP scope (Section 11)

**Problem:** Section 11 MVP scope lists Gitea/Forgejo events as `issues`, `issue_comment`, `pull_request`, `pull_request_comment`. The Gogs event list in Section 3.1.2 omits `pull_request_comment` and has no label/assignee event coverage. The MVP scope should clarify that Gogs has a reduced event surface vs Gitea.

**Correction — update Section 11 MVP event coverage table:**
```
| Gitea/Forgejo | issues, issue_comment, pull_request, pull_request_comment | Full |
| Gogs          | issues, issue_comment, pull_request | No pull_request_comment; no label/assign events |
```

---

### 13. Eventual consistency gap — not documented for any platform in this connector

**Affected:** All platforms (absent from document)

**Problem:** The gitlab-inbound review flags that webhooks can fire before the API reflects the change. The custom_git_server.md does not address this at all. All self-hosted platforms share this eventual consistency issue.

**Addition — add to Section 10 (Known Gotchas):**
> **Eventual consistency:** Webhook delivery is asynchronous and can precede API availability. For all platforms, after receiving a webhook that references a resource (e.g., new comment, updated issue), a follow-up API fetch may return stale data.
>
> **Connector implication:** When enriching webhook events with current state from the API, implement retry with exponential backoff (recommend: 500ms initial delay, 3 retries). Prefer using webhook payload fields directly for creation events rather than a follow-up API lookup.
>
> **Specific known gaps:**
> - Gitea/Forgejo: newly created comments may not appear in `GET .../issues/{index}/comments` for up to 1-2 seconds
> - Azure DevOps: work item field changes may not be queryable immediately after `workitem.updated` delivery
> - Bitbucket DC: inline comments may not appear in the activity list immediately after delivery

---

### 14. Bitbucket DC — HMAC header is `X-Hub-Signature`, not differentiated from Cloud

**Affected:** Signature verification (Section 2.5, Table)

**Problem:** Section 2.5 Table shows Bitbucket DC `X-Hub-Signature (v8.0+)` without clarifying that this header carries `sha256={hex}` format on DC (like Cloud) but is absent on versions < 8.0. The distinction between Cloud sending both `X-Hub-Signature` and `X-Hub-Signature-256` vs DC sending only `X-Hub-Signature` is not made.

**Correction — update Section 2.5 table:**
```
| Bitbucket DC | X-Hub-Signature | HMAC-SHA256 (v8.0+ only). Format: sha256={hex_digest}. Versions < 8.0 have no HMAC. |
```

---

### 15. Gitea/Forgejo `assignee_changed` — action is `edited`, not a dedicated event

**Affected:** Section 10.2 (Known Gotchas)

**Finding — correctly noted.** The document correctly states "No `assignee_changed` event — must detect via issue edit + compare." However, it should also clarify the `action` value for assignee changes is `edited`, not a named event. The `changes` object for assignee changes contains `assignees.previous` / `assignees.current`.

**Correction — expand Section 10.2 Gitea/Forgejo row:**
> Gitea/Forgejo: No `assignee_changed` event — detect via `action === "edited"` AND `changes.assignees.previous` / `changes.assignees.current` diff. Compare arrays to determine which assignee was added or removed.

---

## Summary of Corrections

| # | Severity | Section | Fix |
|---|---|---|---|
| 1 | **High** | 3.3, 6.1 | Add `changes.labels.added[]` / `changes.labels.removed[]` to Gitea payload docs |
| 2 | **High** | 10.10 | Add `event_type` to GitLab SM webhook envelope shape |
| 3 | **High** | 6.3 | Correct GitLab SM body field to `objectAttributes.note` (not `body`) |
| 4 | **Medium** | 3.1.5 | Mark Azure DevOps comment edit/delete as uncertain; add missing events |
| 5 | **Medium** | 3.1.3 | Add note on uncertain Bitbucket DC event namespace format |
| 6 | **Medium** | 3.2 | Document Gitea comment polling has no `since` param; requires ID-cursor strategy |
| 7 | **Medium** | 9.3 | Document comment-edit detection via `updated_at` comparison for all polling |
| 8 | **Medium** | 3/10 | Add replay protection section with per-platform deduplication keys |
| 9 | **Medium** | 3/10 | Add webhook delivery guarantees table (retries, dead-letter, re-enable) |
| 10 | **Low** | 6.3 | Document per-platform mention regex patterns; note Azure DevOps displayName |
| 11 | **Medium** | 7.3 | Fix Azure DevOps bot detection to distinguish work item changes vs comment author |
| 12 | **Low** | 11 | Clarify Gogs reduced event surface vs Gitea in MVP scope |
| 13 | **Medium** | 10 | Add eventual-consistency gap documentation for all platforms |
| 14 | **Low** | 2.5 | Clarify Bitbucket DC HMAC: `X-Hub-Signature` format same as Cloud, present v8.0+ only |
| 15 | **Low** | 10.2 | Clarify Gitea assignee change arrives as `action === "edited"` with `changes.assignees` diff |

**Critical fixes before implementation:** #1 (Gitea `changes` object missing from payload docs is the most likely silent bug), #2 (`event_type` required for GitLab SM shape discrimination), #3 (GitLab SM note field is `note`, not `body` — will cause bot mention detection to fail), and #11 (Azure DevOps bot detection field path is wrong for comment events).
