# Endpoint Review — GitHub Issues Connector

**Verdict: MOSTLY CORRECT with several actionable gaps and two inaccuracies.**

The doc covers the core REST surface well. The HTTP methods, paths, and required body fields for the primary CRUD operations are accurate. Issues found below range from incorrect Projects v2 paths (hallucinated REST endpoints) to missing remove-assignees endpoint and a missing "get one issue" response note.

---

## Findings

### 1. Projects v2 endpoints are incorrect (hallucinated REST paths)

**Capability**: Projects v2 item management and field values (Sections 5 and 11)

**What the doc says**:
```
GET /orgs/{org}/projectsV2
GET /repos/{owner}/{repo}/projectsV2
POST /projects/{project_id}/items
PATCH /projects/items/{item_id}
DELETE /projects/items/{item_id}
GET /projects/{project_id}/fields
POST /projects/{project_id}/fields
```

**What is actually correct**: GitHub Projects v2 has no REST API. All Projects v2 operations — listing projects, adding items, updating field values, reading fields — are exclusively available through the **GraphQL API** at `POST /graphql`. There are no REST endpoints at `/projects/{project_id}/items` or `/orgs/{org}/projectsV2`. The REST paths shown do not exist.

The correct approach uses GraphQL mutations and queries, for example:
- `addProjectV2ItemById` mutation — add an issue to a project
- `updateProjectV2ItemFieldValue` mutation — set a field value
- `deleteProjectV2Item` mutation — remove an item
- `projectsV2` connection on `organization` or `repository` nodes — list projects

**Citation**: https://docs.github.com/en/graphql/reference/mutations#addprojectv2itembyid and https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects

**Impact**: Any code that attempts to call these REST endpoints will receive 404. This is a blocking implementation error for the Phase 3 features.

---

### 2. Remove assignees endpoint not documented

**Capability**: Remove assignees

**What the doc says**: Section 4 ("Add/Remove Assignees") only documents the `POST` to add assignees. Section 11 Phase 2 lists `DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees/{assignee}` but that path is also wrong (see finding 3 below).

**What is actually correct**: The endpoint to remove assignees is:
```
DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees
```
Request body:
```json
{ "assignees": ["username1"] }
```
Response: `200 OK` with updated Issue object.

This is a separate endpoint from the add, uses a request body (not a path segment), and is missing entirely from Section 4's Outbound documentation.

**Citation**: https://docs.github.com/en/rest/issues/assignees#remove-assignees-from-an-issue

---

### 3. Phase 2 remove-assignees path is wrong

**Capability**: Remove assignees (Phase 2 scope, Section 11)

**What the doc says**:
```
DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees/{assignee}
```

**What is actually correct**:
```
DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees
```
The username is passed in the **request body** as `{ "assignees": ["username"] }`, not as a path segment. The path shown does not exist; GitHub returns 404 for it.

**Citation**: https://docs.github.com/en/rest/issues/assignees#remove-assignees-from-an-issue

---

### 4. Edit issue endpoint not documented in Section 4

**Capability**: Edit / patch issue (title, body, milestone)

**What the doc says**: Section 4 documents "Change State" using `PATCH /repos/{owner}/{repo}/issues/{issue_number}` but frames it only as a state change. The general-purpose edit operation (update title, body, milestone) is absent from Section 4's outbound narrative, though the endpoint is listed in Section 11 Phase 2 with a brief comment.

**What is actually correct**: `PATCH /repos/{owner}/{repo}/issues/{issue_number}` accepts any combination of `title`, `body`, `state`, `state_reason`, `milestone`, `labels`, `assignees`. It is the single edit endpoint and should be documented in Section 4 as a standalone "Edit Issue" operation with full body field table, not only in the context of state changes.

**Citation**: https://docs.github.com/en/rest/issues/issues#update-an-issue

---

### 5. Add labels response code is documented incorrectly

**Capability**: Add labels

**What the doc says**:
```
POST /repos/{owner}/{repo}/issues/{issue_number}/labels
Response: 200 OK with array of Label objects
```

**What is actually correct**: The response code for adding labels is `200 OK`. The path and method are correct. However, the response body is the **complete list of all labels now on the issue**, not only the labels just added. The doc says "array of Label objects" which is technically correct but could mislead: implementers may assume only newly added labels are returned. Minor but worth clarifying in implementation notes.

**Citation**: https://docs.github.com/en/rest/issues/labels#add-labels-to-an-issue

---

### 6. Replace all labels — response code and body not documented

**Capability**: Replace all labels

**What the doc says**: Section 4 shows the `PUT` path and request body but omits the response code and response shape.

**What is actually correct**:
- Response: `200 OK`
- Body: array of all Label objects now on the issue (same shape as the add-labels response)

**Citation**: https://docs.github.com/en/rest/issues/labels#set-labels-for-an-issue

---

### 7. Lock issue — lock_reason value "too heated" is incorrect

**Capability**: Lock issue

**What the doc says**:
```json
{ "lock_reason": "off-topic" | "too heated" | "resolved" | "spam" }
```

**What is actually correct**: The valid enum values are `"off-topic"`, `"too heated"`, `"resolved"`, `"spam"`. The value `"too heated"` is **correct** — it contains a space, which is the actual API value. This is not an error; it is just unusual and worth an explicit note in the doc because a developer might assume underscore or hyphen. The doc is accurate here.

No correction needed. Note preserved for completeness.

**Citation**: https://docs.github.com/en/rest/issues/issues#lock-an-issue

---

### 8. Get one issue — response shape hint missing

**Capability**: Get one item by ID

**What the doc says**: Section 11 MVP lists `GET /repos/{owner}/{repo}/issues/{issue_number}` without any inline documentation in Section 4. There is no "Get Issue" subsection in the Outbound or Inbound section despite being a primary polling/reconciliation call.

**What is actually correct**: The endpoint exists and returns the full Issue object (same shape as shown in Appendix A). It should appear as a documented operation in the connector scope section with its response code (`200 OK`) and a note that it returns a PR object if the issue number belongs to a pull request, requiring the same `pull_request` field filter.

**Citation**: https://docs.github.com/en/rest/issues/issues#get-an-issue

---

### 9. Timeline endpoint — Accept header required for stable response

**Capability**: Issue timeline (Section 10 gotcha #3 and Section 11 Phase 2)

**What the doc says**:
```
GET /repos/{owner}/{repo}/issues/{issue_number}/timeline?per_page=100
```

**What is actually correct**: The path and method are correct. However, the timeline endpoint requires the special preview Accept header to be stable and return consistent event types:
```
Accept: application/vnd.github.mockingbird-preview+json
```
Without this header, the API still responds but the event type set may differ across API versions. The doc should call this out alongside the standard `application/vnd.github+json` header listed in Appendix B.

**Citation**: https://docs.github.com/en/rest/issues/timeline

---

### 10. Attach file — upload-to-comment workaround not documented

**Capability**: Attach file / screenshot

**What the doc says**: Section 4 states GitHub Issues does not support direct file uploads via API and suggests GitHub Releases, Gist, or external hosting.

**What is actually correct**: This is accurate — there is no file upload endpoint for issue attachments. However, the doc omits a common real-world approach: GitHub allows Markdown image embeds from public URLs, and the GitHub Asset Upload endpoint (`POST /repos/{owner}/{repo}/issues/{issue_number}/comments` with multipart) does **not** exist. Uploads via the web UI go through a separate undocumented internal upload endpoint that is not part of the public API.

The doc's conclusion is correct; the omission of any note that there is no multipart endpoint (preventing easy implementation of screenshot attachment) is a gap worth adding for implementation clarity.

**Citation**: per GitHub Issues API reference — no file upload endpoint exists in public API.

---

### 11. Search API — `is:issue` qualifier is important but not called out as required

**Capability**: List items / search

**What the doc says**: Section 9 documents `GET /search/issues` with qualifiers including `is:issue`.

**What is actually correct**: The path, method, and qualifiers are accurate. One important behavioral note is missing: `GET /search/issues` returns **both issues and pull requests** by default. The `is:issue` qualifier must always be included to restrict results to issues only. The doc lists it as an "available qualifier" example without flagging it as mandatory for correct SupportAgent behavior. This should be elevated to a required qualifier note.

**Citation**: https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests

---

### 12. Comments polling endpoint — missing `direction` and `sort` query parameters

**Capability**: List comments, polling fallback

**What the doc says**:
```
GET /repos/{owner}/{repo}/issues/{issue_number}/comments
GET /repos/{owner}/{repo}/issues/comments?since=<timestamp>
```

**What is actually correct**: Both paths are correct. The repository-level comments endpoint (`/issues/comments`) also accepts `sort` (`created`, `updated`) and `direction` (`asc`, `desc`) parameters that are useful for incremental sync ordering. These are documented in the API reference but absent from the doc. Not blocking but useful to add.

**Citation**: https://docs.github.com/en/rest/issues/comments#list-issue-comments-for-a-repository

---

## Summary Table

| Capability | Status | Severity |
|---|---|---|
| List issues | Correct | — |
| Get one issue | Missing inline documentation | Low |
| Create issue | Correct | — |
| Edit issue | Partially documented (only state change framed) | Medium |
| Delete/close issue | Correct (state change) | — |
| List comments | Correct, minor query param gaps | Low |
| Post comment | Correct | — |
| Edit comment | Correct | — |
| Delete comment | Correct | — |
| Add label | Correct | — |
| Remove label | Correct | — |
| Replace labels | Missing response code/body | Low |
| Set priority/severity | Correct (label-based, no native field) | — |
| Set status/transition | Correct | — |
| Add assignees | Correct | — |
| Remove assignees | Wrong path in Phase 2; missing from Section 4 | High |
| Attach file | Correct (no API exists, noted) | — |
| Projects v2 operations | Hallucinated REST paths — GraphQL only | High |
| Lock/unlock issue | Correct | — |
| Timeline endpoint | Missing preview Accept header note | Low |
| Search issues | Missing mandatory `is:issue` qualifier note | Medium |
