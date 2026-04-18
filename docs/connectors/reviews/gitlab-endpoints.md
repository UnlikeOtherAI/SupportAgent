# GitLab Connector — API Endpoint Coverage Review

**Verdict: APPROVED with findings**

The endpoint surface is mostly accurate and well-documented. Several issues need correction before implementation.

---

## Findings

### Finding 1: Missing DELETE Issues Endpoint

**Endpoint:** `DELETE /projects/:id/issues/:issue_iid`

**What the doc says:** Does not document this endpoint. The outbound write section (Section 4) covers create, update, and status change but omits delete entirely.

**What is correct:** The DELETE endpoint exists and is fully documented in the official GitLab API. As of GitLab 18.10, users can delete issues they authored; users with Planner or Owner role can delete any issue.

**Severity:** Low — delete is rarely needed for support agent use cases, but the omission is misleading.

**Reference:** [GitLab Issues API — Delete an issue](https://docs.gitlab.com/ee/api/issues.html#delete-an-issue)

---

### Finding 2: Missing Required `color` Parameter for Label Creation

**Endpoint:** `POST /projects/:id/labels`

**What the doc says (Section 4.8):**
```
POST   /projects/:id/labels         # create label
```
No parameters listed as required beyond the path.

**What is correct:** Both `name` AND `color` are required. The color must be a 6-digit hex with `#` prefix (e.g., `#FFAABB`) or a CSS color name.

| Param | Type | Required |
|-------|------|----------|
| `name` | string | Yes |
| `color` | string | Yes |
| `description` | string | No |
| `priority` | integer | No |
| `archived` | boolean | No |

**Severity:** Medium — implementation will fail with a 400 error if `color` is omitted.

**Reference:** [GitLab Labels API — Create a project label](https://docs.gitlab.com/ee/api/labels.html#create-a-project-label)

---

### Finding 3: Ambiguous Update Label Requirements

**Endpoint:** `PUT /projects/:id/labels/:label_id`

**What the doc says (Section 4.8):**
```
PUT    /projects/:id/labels/:label_id  # update (name, color, description, priority)
```

**What is correct:** At least one of `new_name` OR `color` is required. The API rejects updates with only description/priority. Additionally, the parameter is `new_name` not `name` when renaming.

| Param | Type | Required |
|-------|------|----------|
| `new_name` | string | Yes if `color` not provided |
| `color` | string | Yes if `new_name` not provided |
| `description` | string | No |
| `priority` | integer | No |
| `archived` | boolean | No |

**Severity:** Low — connector likely won't need to rename labels.

**Reference:** [GitLab Labels API — Update a project label](https://docs.gitlab.com/ee/api/labels.html#update-a-project-label)

---

### Finding 4: Missing Merge Parameters on MR Merge Endpoint

**Endpoint:** `PUT /projects/:id/merge_requests/:merge_request_iid/merge`

**What the doc says (Section 4.12):**
```
PUT /projects/:id/merge_requests/:merge_request_iid/merge
body: { squash, squash_commit_message, merge_commit_message, should_remove_source_branch }
```

**What is correct:** Two additional parameters should be documented:

| Param | Type | Notes |
|-------|------|-------|
| `sha` | string | If present, must match HEAD of source branch. Prevents merging unreviewed commits. |
| `auto_merge` | boolean | Merge when pipeline succeeds. Replaces deprecated `merge_when_pipeline_succeeds`. |

The `sha` parameter is important for safety-critical merges. The `auto_merge` parameter is the current replacement for the deprecated `merge_when_pipeline_succeeds`.

**Severity:** Low — basic merge will work, but advanced merge control is incomplete.

**Reference:** [GitLab Merge Requests API — Merge a merge request](https://docs.gitlab.com/ee/api/merge_requests.html#merge-a-merge-request)

---

### Finding 5: Note Body Character Limit Is Inconsistent

**Endpoint:** `POST /projects/:id/issues/:issue_iid/notes`

**What the doc says (Section 4.3):**
```
| `body` | string | **Required**, max 1,000,000 chars |
```

**What is correct:** The MR creation endpoint documents the limit as 1,048,576 characters. The issue/notes endpoint does not explicitly document a per-note limit, but the MR description field has this limit. This suggests the note body limit in the doc may be approximate.

**Severity:** Very low — the limit is generous and unlikely to be hit.

**Reference:** [GitLab Merge Requests API — Create a merge request](https://docs.gitlab.com/ee/api/merge_requests.html#create-a-merge-request) (description field limit)

---

### Finding 6: MR Merge Endpoint Still Documents Deprecated Parameter

**Endpoint:** `PUT /projects/:id/merge_requests/:merge_request_iid/merge`

**What the doc says (Section 4.12):**
```
Params: `squash`, `squash_commit_message`, `merge_commit_message`, `should_remove_source_branch`
```

**What is correct:** `merge_when_pipeline_succeeds` was deprecated in GitLab 17.11. The current parameter is `auto_merge` (boolean). The doc doesn't mention `merge_when_pipeline_succeeds`, so this is not incorrect—just incomplete (see Finding 4).

**Severity:** Informational only.

---

## Verified Correct Endpoints

The following endpoints are accurate and need no changes:

| Category | Endpoint | Status |
|----------|----------|--------|
| List issues | `GET /projects/:id/issues` | Correct — filters `labels`, `state`, `assignee_id`, `milestone`, `search`, `updated_after/before` all valid |
| Get issue | `GET /projects/:id/issues/:issue_iid` | Correct |
| Create issue | `POST /projects/:id/issues` | Correct — `title` required, `description`, `labels`, `assignee_ids`, `milestone_id`, `due_date`, `confidential`, `created_at`, `iid` all valid |
| Update issue | `PUT /projects/:id/issues/:issue_iid` | Correct — `state_event`, `add_labels`, `remove_labels`, `labels`, `assignee_ids`, `milestone_id`, `weight` all valid |
| List MRs | `GET /projects/:id/merge_requests` | Correct |
| Get MR | `GET /projects/:id/merge_requests/:merge_request_iid` | Correct |
| Create MR | `POST /projects/:id/merge_requests` | Correct — `source_branch`, `target_branch`, `title` required; `description`, `labels`, `assignee_ids`, `reviewer_ids`, `milestone_id`, `squash`, `remove_source_branch` all valid |
| Update MR | `PUT /projects/:id/merge_requests/:merge_request_iid` | Correct — `state_event`, `add_labels`, `remove_labels`, `labels`, `assignee_ids`, `reviewer_ids`, `milestone_id` all valid |
| List notes (issues) | `GET /projects/:id/issues/:issue_iid/notes` | Correct |
| List notes (MRs) | `GET /projects/:id/merge_requests/:merge_request_iid/notes` | Correct |
| Post note (issues) | `POST /projects/:id/issues/:issue_iid/notes` | Correct — `body` required, `internal`, `created_at` valid |
| Post note (MRs) | `POST /projects/:id/merge_requests/:merge_request_iid/notes` | Correct — `body` required, `internal`, `merge_request_diff_head_sha` valid |
| Edit note (issues) | `PUT /projects/:id/issues/:issue_iid/notes/:note_id` | Correct |
| Edit note (MRs) | `PUT /projects/:id/merge_requests/:merge_request_iid/notes/:note_id` | Correct |
| Delete note (issues) | `DELETE /projects/:id/issues/:issue_iid/notes/:note_id` | Correct |
| Delete note (MRs) | `DELETE /projects/:id/merge_requests/:merge_request_iid/notes/:note_id` | Correct |
| List discussions (issues) | `GET /projects/:id/issues/:issue_iid/discussions` | Correct |
| List discussions (MRs) | `GET /projects/:id/merge_requests/:merge_request_iid/discussions` | Correct |
| Create discussion (issues) | `POST /projects/:id/issues/:issue_iid/discussions` | Correct — `body` required, `position` for diff notes |
| Create discussion (MRs) | `POST /projects/:id/merge_requests/:merge_request_iid/discussions` | Correct |
| Add note to discussion (issues) | `POST /projects/:id/issues/:issue_iid/discussions/:discussion_id/notes` | Correct |
| Add note to discussion (MRs) | `POST /projects/:id/merge_requests/:merge_request_iid/discussions/:discussion_id/notes` | Correct |
| Resolve thread (issues) | `PUT /projects/:id/issues/:issue_iid/discussions/:discussion_id` | Correct — `resolved` boolean |
| Resolve thread (MRs) | `PUT /projects/:id/merge_requests/:merge_request_iid/discussions/:discussion_id` | Correct — `resolved` boolean |
| File upload | `POST /projects/:id/uploads` | Correct |
| List labels | `GET /projects/:id/labels` | Correct |
| Delete label | `DELETE /projects/:id/labels/:label_id` | Correct |
| Promote label | `PUT /projects/:id/labels/:label_id/promote` | Correct |

---

## Summary of Recommended Changes

1. **Add to Section 4:** Document `DELETE /projects/:id/issues/:issue_iid` as an available endpoint (Low priority)

2. **Section 4.8 — Create Label:** Add `color` as a required parameter alongside `name`

3. **Section 4.8 — Update Label:** Clarify that either `new_name` OR `color` is required; rename `name` to `new_name` in the parameter reference

4. **Section 4.12 — Merge MR:** Add `sha` and `auto_merge` parameters to the merge endpoint documentation

---

**Reviewed against:** [GitLab REST API Documentation](https://docs.gitlab.com/ee/api/rest/index.html) (issues.md, merge_requests.md, notes.md, discussions.md, labels.md)
