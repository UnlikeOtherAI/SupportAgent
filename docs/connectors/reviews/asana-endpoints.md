# Asana Connector — Endpoint Coverage Review

**Reviewer:** Endpoint coverage audit (auth, webhooks, rate limits out of scope)
**Source:** `docs/connectors/asana.md`
**Verdict:** APPROVED WITH MINOR CORRECTIONS

---

## Findings

### ✅ LIST TASKS

- **Endpoint:** `GET /tasks?workspace=<workspace_gid>&limit=100&offset=<offset>`
- **Doc says:** Correct path and query params (line 236)
- **Verification:** Correct. `workspace` is required. Supports `limit` (max 100) and `offset` for pagination.
- **Filters documented:** `modified_since`, `workspace` — adequate for SupportAgent.

### ✅ GET TASK BY ID

- **Endpoint:** `GET /tasks/{gid}`
- **Doc says:** Correct (line 836, MVP table)
- **Verification:** Correct.

### ✅ CREATE TASK

- **Endpoint:** `POST /api/1.0/tasks`
- **Doc says:** Body includes `name`, `notes`, `workspace`, `projects`, `assignee`, `due_on` (lines 274–283)
- **Verification:** Correct endpoint. Minor: Asana docs state only `workspace` is explicitly required, OR `projects`/`parent` as alternative. `name` is practically required but not API-enforced. Doc should clarify this nuance.
- **Issue (minor):** The example shows `assignee` as a bare user GID string. This works but Asana also accepts `{"gid": "<user_gid>"}` object form. Both are valid; doc's form is fine.

### ✅ UPDATE/PATCH TASK

- **Endpoint:** `PUT /api/1.0/tasks/{gid}`
- **Doc says:** Correct path (lines 337, 394, 426)
- **Verification:** Correct. PUT replaces the task fields provided. Supports all editable fields: `name`, `notes`, `assignee`, `completed`, `due_on`, `custom_fields`.

### ✅ CLOSE/RESOLVE TASK

- **Endpoint:** `PUT /api/1.0/tasks/{gid}` with `{"data": {"completed": true}}`
- **Doc says:** Correct (lines 334–346, 424–437)
- **Verification:** Correct. This is the proper way to mark a task complete.

### ✅ LIST COMMENTS (STORIES)

- **Endpoint:** `GET /api/1.0/tasks/{gid}/stories`
- **Doc says:** Correct (line 838, MVP table)
- **Verification:** Correct. Comments are stories of type `comment`. Response includes all story types; filter client-side or note that `type: "comment"` is the filter.
- **Missing from doc:** No query params documented (`limit`, `opt_fields`). Minor — not blocking but should note for pagination.

### ✅ POST COMMENT

- **Endpoint:** `POST /api/1.0/tasks/{gid}/stories`
- **Doc says:** Body `{"data": {"text": "...", "is_pinned": true}}` (lines 295–300)
- **Verification:** Endpoint correct. **PROBLEM:** `is_pinned` is NOT a valid field in the Asana Stories create request per [Asana API reference](https://developers.asana.com/reference/stories). The create story endpoint only accepts: `text`, `hearted`, `num_hearts`. Pinning is UI-only; not available via API.
- **Fix required:** Remove `is_pinned` from the example request body.

### ✅ EDIT COMMENT

- **Endpoint:** `PUT /api/1.0/stories/{gid}`
- **Doc says:** Body `{"data": {"text": "Updated comment body"}}` (lines 309–319)
- **Verification:** Correct. Only `text` can be updated on stories. Constraint about own comments only is accurate.

### ✅ DELETE COMMENT

- **Endpoint:** `DELETE /api/1.0/stories/{gid}`
- **Doc says:** Correct (lines 325–330)
- **Verification:** Correct. Constraint about only deleting own comments is accurate.

### ✅ ADD TAG

- **Endpoint:** `POST /api/1.0/tasks/{gid}/addTag`
- **Doc says:** Body `{"data": {"tag": "<tag_gid>"}}` (lines 367–377)
- **Verification:** Correct.

### ✅ REMOVE TAG

- **Endpoint:** `POST /api/1.0/tasks/{gid}/removeTag`
- **Doc says:** Body `{"data": {"tag": "<tag_gid>"}}` (lines 380–389)
- **Verification:** Correct.

### ✅ SET/CHANGE STATUS

- **Doc says:** Use `completed` boolean for simple close, or custom field for workflow status (lines 332–364)
- **Verification:** Accurate. Asana has no built-in status field. Workflow status requires a custom field (enum type). Doc correctly shows how to update custom field via `PUT /tasks/{gid}` with `custom_fields: {"<field_gid>": "<enum_option_gid>"}`.

### ✅ SET PRIORITY

- **Doc says:** No built-in priority; use custom field (lines 530–536)
- **Verification:** Accurate. Asana has no priority field. Priority must be a custom field.

### ✅ ASSIGN USER / MENTION USER

- **Assign:** `PUT /api/1.0/tasks/{gid}` with `assignee: "<user_gid>"` (lines 391–403)
- **Mention:** `@user_id` syntax in comment text via POST stories (lines 405–421)
- **Verification:** Both correct. Asana converts `@user_id` to a mention link in the UI.

### ✅ ATTACH FILE / SCREENSHOT

- **Endpoint:** `POST /api/1.0/tasks/{gid}/attachments`
- **Doc says:** Two forms — multipart upload and external URL reference (lines 441–466)
- **Verification:** Correct. Both upload methods are documented correctly.
- **Note:** Scope listed as `stories:write` or `tasks:write` — should also include `attachments` scope if available. Per Asana docs, `tasks:write` or `stories:write` is sufficient for attachments.

### ✅ WEBHOOKS

- **Create:** `POST /api/1.0/webhooks` with `resource` and `target` (lines 97–108)
- **Get:** `GET /api/1.0/webhooks/{gid}` (line 844)
- **Delete:** `DELETE /api/1.0/webhooks/{gid}` (line 845)
- **Verification:** All correct. Handshake mechanism documented accurately.

### ✅ SEARCH TASKS

- **Endpoint:** `GET /api/1.0/workspaces/{workspace_gid}/tasks/search`
- **Doc says:** Params: `text`, `projects`, `assignee`, `completed`, `modified_since` (lines 753–765)
- **Verification:** Correct. This is the proper search endpoint. Filters documented are realistic for SupportAgent use.

### ✅ LIST TAGS

- **Endpoint:** `GET /api/1.0/tags?workspace=<workspace_gid>`
- **Doc says:** Correct path (lines 482–486, 540–544)
- **Verification:** Correct. `workspace` is required query param.

### ✅ LIST PROJECTS WITH CUSTOM FIELDS

- **Endpoint:** `GET /api/1.0/projects/{gid}?opt_fields=...`
- **Doc says:** Correct with `opt_fields` for custom field discovery (lines 500–503, 542)
- **Verification:** Correct pattern.

### ✅ GET USER

- **Endpoint:** `GET /api/1.0/users/{gid}?opt_fields=name,email`
- **Doc says:** Correct (lines 611–622)
- **Verification:** Correct.

### ✅ CUSTOM FIELD UPDATE

- **Endpoint:** `PUT /api/1.0/tasks/{gid}` with `custom_fields` object
- **Doc says:** Correct pattern (lines 511–520)
- **Verification:** Correct. Enum custom fields take enum option GID as value.

---

## Summary

| Capability | Status | Notes |
|------------|--------|-------|
| List items (tasks) | ✅ | Correct with filters |
| Get item by ID | ✅ | |
| Create item | ✅ | Minor: `name` not strictly required per API |
| Edit/patch item | ✅ | |
| Close/resolve item | ✅ | |
| List comments | ✅ | |
| Post comment | ⚠️ | Remove `is_pinned` from example |
| Edit comment | ✅ | |
| Delete comment | ✅ | |
| Add/remove tag | ✅ | |
| Set status | ✅ | Via `completed` or custom field |
| Set priority | ✅ | Via custom field only |
| Assign/mention user | ✅ | |
| Attach file | ✅ | Both upload methods correct |
| Webhooks | ✅ | Create/get/delete all correct |
| Search | ✅ | |
| User lookup | ✅ | |

---

## Required Fixes

1. **Line ~298:** Remove `"is_pinned": true` from the POST stories example. This field is not supported in the API request body.

2. **Line ~275:** Add a note that `name` is practically required (tasks without names are unhelpful) but only `workspace` (or `projects`/`parent`) is API-enforced as required.

---

## Out of Scope (Correctly Omitted)

- **Delete task** — `DELETE /tasks/{gid}` exists but not documented in MVP scope. Appropriate for MVP.
- **Projects CRUD** — Only project GET with custom fields is needed for SupportAgent. Correct.
- **Subtasks** — Not needed for MVP connector scope. Correct omission.

---

*Review based on [Asana REST API Reference](https://developers.asana.com/reference) and [Asana API Guides](https://developers.asana.com/docs).*
