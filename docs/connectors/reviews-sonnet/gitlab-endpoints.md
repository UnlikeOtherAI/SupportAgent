# GitLab Connector — Endpoint Coverage Review

**Verdict: MOSTLY CORRECT with several notable issues.** The endpoint surface is broadly right and the HTTP methods are accurate, but there are meaningful gaps in GET-single endpoints, a wrong webhook registration path, an incorrect MR merge path, a missing upload endpoint for attachments, gaps in the Discussions API coverage, and a handful of field-level inaccuracies.

---

## Findings

### 1. Webhook Registration — Wrong Path

- **Endpoint:** `POST /projects/:id/integrations/webhooks`
- **What the doc says:** `POST /projects/:id/integrations/webhooks` (section 3.1)
- **What is actually correct:** `POST /projects/:id/hooks`
  - The `/integrations/webhooks` path does not exist in the GitLab REST API. Project webhooks are managed at `/projects/:id/hooks`. The integrations namespace under `/projects/:id/integrations/` is for service integrations (Slack, Jira, etc.), not for webhook registration.
  - Per GitLab API reference: https://docs.gitlab.com/ee/api/projects.html#add-project-hook
- **Severity:** High — this would cause 404s in any connector that automates webhook registration.

---

### 2. List Issues — Missing `get single issue` in Section 11 Summary Table

- **Endpoint:** `GET /projects/:id/issues/:iid`
- **What the doc says:** Section 4 (no dedicated section for get-single-issue), section 11 table includes it.
- **Assessment:** The endpoint is mentioned in the MVP table in section 11 but has no dedicated documented parameters or response shape in section 4. The doc jumps from Create Issue (4.1) to Create MR (4.2) without a "Get Issue" or "List Issues" section.
- **What is actually correct:** Both `GET /projects/:id/issues` and `GET /projects/:id/issues/:iid` need documented query parameters. Key list filters that SupportAgent would use: `state`, `labels`, `assignee_id`, `milestone`, `search`, `in`, `updated_after`, `created_after`, `order_by`, `sort`, `per_page`, `page`.
- **Citation:** https://docs.gitlab.com/ee/api/issues.html#list-project-issues

---

### 3. Edit Issue — No Dedicated Section, Params Are Scattered

- **Endpoint:** `PUT /projects/:id/issues/:iid`
- **What the doc says:** The update endpoint is mentioned in sections 4.7 (change status), 4.8 (labels), 4.9 (assignees), 4.10 (milestone), and 4.13 (priority). There is no single "Edit Issue" section listing all writable fields together.
- **What is actually correct:** The doc is not wrong per se, but the split representation risks the implementor missing writable fields. The `PUT /projects/:id/issues/:iid` endpoint also accepts `title`, `description`, `confidential`, `due_date`, `weight` (Premium+), `health_status` (Ultimate), `add_labels`, `remove_labels`, `labels`, `assignee_ids`, `milestone_id`, `state_event`.
- **Citation:** https://docs.gitlab.com/ee/api/issues.html#edit-an-issue

---

### 4. MR Merge Endpoint — Wrong HTTP Method

- **Endpoint:** Section 4.12
- **What the doc says:** `PUT /projects/:id/merge_requests/:merge_request_iid/merge`
- **What is actually correct:** The method is `PUT` which is actually correct per the GitLab docs. However the path used in the MVP table in section 11 omits the `/merge` sub-resource endpoint entirely. More importantly, the params listed (`squash`, `squash_commit_message`, `merge_commit_message`, `should_remove_source_branch`) are correct but the doc omits `merge_when_pipeline_succeeds` (boolean), which is the most commonly needed optional param.
- **Citation:** https://docs.gitlab.com/ee/api/merge_requests.html#merge-a-merge-request

---

### 5. Attach File / Screenshot — Incorrect Endpoint Description

- **Endpoint:** `POST /projects/:id/uploads`
- **What the doc says (section 4.14):** "GitLab doesn't support file uploads via REST API for issue descriptions. Workarounds: 1. Upload to container registry or generic package registry: `POST /projects/:id/uploads`"
- **What is actually correct:** `POST /projects/:id/uploads` IS the official file upload endpoint — it is not a "workaround" involving the container or package registry. This endpoint accepts `multipart/form-data` with a `file` field and returns `{ alt, url, full_path, markdown }`. The `markdown` field is a ready-to-paste Markdown image reference. This is the standard, first-class way to upload files and images for use in issue/MR descriptions and comments.
- **The doc mis-characterizes a real REST endpoint as a workaround and incorrectly groups it with the container/package registry.**
- **Citation:** https://docs.gitlab.com/ee/api/projects.html#upload-a-file

---

### 6. Discussions API — Resolve Thread Endpoint Is Wrong

- **Endpoint:** Section 4.15 and Phase 2 list (section 11)
- **What the doc says (section 4.15):** `PUT /projects/:id/issues/:issue_iid/discussions/:discussion_id` with `body: { resolved: true }` to resolve a thread.
- **What the doc says (section 11, Phase 2):** `POST /projects/:id/issues/:iid/discussions/:discussion_id/resolve`
- **These two are inconsistent with each other and both are partially wrong.**
- **What is actually correct:**
  - To resolve a discussion on a **merge request** (not an issue), use: `PUT /projects/:id/merge_requests/:merge_request_iid/discussions/:discussion_id` with body `{ resolved: true }`.
  - Issue discussions **cannot be resolved** via the API — only MR discussions have a resolved state.
  - The path `POST .../resolve` listed in section 11 does not exist.
- **Citation:** https://docs.gitlab.com/ee/api/discussions.html#resolve-a-merge-request-discussion

---

### 7. Discussions API — List Discussions Endpoint Missing Correct Detail

- **Endpoint:** `GET /projects/:id/issues/:issue_iid/discussions`
- **What the doc says:** Mentioned in Phase 2 list in section 11, not documented in section 4.
- **What is actually correct:** The endpoint exists and is `GET /projects/:id/issues/:issue_iid/discussions`. For MRs: `GET /projects/:id/merge_requests/:merge_request_iid/discussions`. Response shape is an array of discussion objects, each with `id` (discussion ID), `individual_note` (bool), and `notes[]` array. This is meaningfully different from the Notes API response shape and needs to be called out explicitly for implementors.
- **Citation:** https://docs.gitlab.com/ee/api/discussions.html#list-project-issue-discussion-items

---

### 8. Add Reply to Discussion — Missing Required `body` Param Note

- **Endpoint:** `POST /projects/:id/issues/:issue_iid/discussions/:discussion_id/notes`
- **What the doc says (section 4.15):** Path shown but no param table.
- **What is actually correct:** `body` (string) is required. `created_at` is optional (admin only). Without a param table this is incomplete documentation.
- **Citation:** https://docs.gitlab.com/ee/api/discussions.html#add-note-to-existing-issue-thread

---

### 9. Edit MR Comment — `PATCH` vs `PUT`

- **Endpoint:** `PUT /projects/:id/merge_requests/:merge_request_iid/notes/:note_id`
- **What the doc says (section 4.5):** `PUT` method for both issue and MR note edits.
- **What is actually correct:** The GitLab API accepts both `PUT` and `PATCH` for note edits. `PUT` is correct and documented. No issue here, but worth noting that `PATCH` is also valid if the SDK uses it.
- **Citation:** https://docs.gitlab.com/ee/api/notes.html#modify-existing-issue-note

---

### 10. `internal` Field on Issue Notes (Section 4.3)

- **Endpoint:** `POST /projects/:id/issues/:issue_iid/notes`
- **What the doc says (section 4.3):** No mention of `internal` field.
- **What the doc says (section 4.4):** `internal` boolean listed for MR notes only.
- **What is actually correct:** The `internal` field is available on **both** issue notes and MR notes (GitLab 15.0+). Issue note creation also accepts `internal: true` to create a confidential/internal note. Omitting this from section 4.3 is a gap.
- **Citation:** https://docs.gitlab.com/ee/api/notes.html#create-new-issue-note

---

### 11. Labels API — `GET /projects/:id/labels` Missing Filter Params

- **Endpoint:** `GET /projects/:id/labels`
- **What the doc says (section 4.8 and 5.1):** Endpoint listed, no filter params.
- **What is actually correct:** The labels list endpoint accepts `with_counts` (bool, include issue/MR counts), `include_ancestor_groups` (bool, include group labels), `search` (string filter). For SupportAgent, `include_ancestor_groups=true` is important to surface group-level labels alongside project labels.
- **Citation:** https://docs.gitlab.com/ee/api/labels.html#list-labels

---

### 12. Members Endpoint — Possible Wrong Path

- **Endpoint:** `GET /projects/:id/members/all`
- **What the doc says (sections 5.5 and 11):** `GET /projects/:id/members/all`
- **What is actually correct:** The endpoint is `GET /projects/:id/members/all` — this is correct and distinct from `GET /projects/:id/members` (which excludes inherited members). The `/all` variant includes members inherited from parent groups. This is the right choice for assignee/reviewer resolution, but the doc should note that it returns both direct and inherited members and that `GET /users?search=...` is the correct endpoint when resolving arbitrary usernames not necessarily members of the project.
- **Assessment:** Path is correct. Context note is missing.
- **Citation:** https://docs.gitlab.com/ee/api/members.html#list-all-members-of-a-group-or-project-including-inherited-and-invited-members

---

### 13. Polling Fallback — `notes` Endpoint Filter Not Standard

- **Endpoint:** `GET /projects/:id/issues/:iid/notes?updated_after=...`
- **What the doc says (section 3.4):** Lists `updated_after` as a filter for notes.
- **What is actually correct:** The Notes list endpoint does **not** support `updated_after` as a documented query parameter. The issues and MRs list endpoints support `updated_after`, but the notes endpoint only supports `order_by` (`created_at` or `updated_at`) and `sort`. For note polling, the correct approach is to poll the parent issue/MR with `updated_after` and then fetch notes when the parent has been updated — not to filter notes directly by time.
- **Citation:** https://docs.gitlab.com/ee/api/notes.html#list-project-issue-notes

---

### 14. Response Shape for `GET /users/:id` — Email Field Omission

- **Endpoint:** `GET /users/:id`
- **What the doc says (section 7.2):** Returns `{ id, username, name, state, avatar_url, web_url, created_at }`, and notes "No email in response."
- **What is actually correct:** Partially correct. For admin-authenticated requests, `GET /users/:id` does return `email`. For non-admin authenticated requests, `email` is only returned if the user has set a public email. The statement "No email in response" is inaccurate for admin tokens — it should say "email is only in the response for admin tokens or when the user has set a public email."
- **Citation:** https://docs.gitlab.com/ee/api/users.html#get-a-single-user

---

### 15. `iid` vs `id` in API Paths — Inconsistency in Section 11 Table

- **What the doc says (section 11 MVP table):** Uses `:iid` for issues and MRs correctly in most rows, but one MR row shows `PUT /projects/:id/merge_requests/:iid` (without `merge_request_` prefix in the variable name).
- **What is actually correct:** The path variable in the table should be consistently named `:merge_request_iid` to match the GitLab API docs and avoid implementor confusion with `:iid` used for both issues and MRs in the same table.
- **Assessment:** Minor naming inconsistency in the table; underlying path structure is correct.

---

## Summary Table

| # | Capability | Severity | Issue |
|---|---|---|---|
| 1 | Webhook registration | High | Wrong path — should be `/projects/:id/hooks` |
| 2 | List / get issue | Medium | Missing list params; get-single has no dedicated section |
| 3 | Edit issue | Medium | Writable fields scattered across 5 sections |
| 4 | Merge MR | Low | Missing `merge_when_pipeline_succeeds` param |
| 5 | Attach file | Medium | `POST /projects/:id/uploads` is not a workaround — it is the real endpoint |
| 6 | Resolve discussion | High | Issue discussions cannot be resolved; POST resolve path does not exist |
| 7 | List discussions | Low | Endpoint present but response shape not documented |
| 8 | Reply to discussion | Low | Missing required `body` param table |
| 9 | Edit note (MR) | None | PUT is correct |
| 10 | Internal issue notes | Low | `internal` field omitted from issue note creation |
| 11 | List labels | Low | Missing `include_ancestor_groups` and `search` params |
| 12 | List members | None | Path is correct; context note on `/users?search` missing |
| 13 | Note polling | Medium | `updated_after` not a valid notes filter param |
| 14 | User email | Low | "No email" claim is wrong for admin tokens |
| 15 | MR iid naming | Low | Minor naming inconsistency in MVP table |
