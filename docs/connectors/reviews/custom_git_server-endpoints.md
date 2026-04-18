# Custom Git Server Connector — Endpoint Coverage Review

**Reviewer**: endpoint coverage audit
**Source**: `docs/connectors/custom_git_server.md`
**Date**: 2026-04-18
**Verdict**: FAIL — multiple incorrect paths, hallucinated endpoints, missing capabilities

---

## Critical Findings

### 1. Bitbucket Server DC — hallucinated issue endpoints

**Affected**: Section 11, MVP table, row "List items" and "Get item" for Bitbucket DC

The doc lists:
```
GET /rest/api/latest/projects/{key}/repos/{repo}/issues
GET /rest/api/latest/projects/{key}/repos/{repo}/issues/{id}
POST /rest/api/latest/projects/{key}/repos/{repo}/issues
```

**What the doc says**: Bitbucket Server/DC has per-repo issue endpoints.

**What is actually correct**: Bitbucket Server (Data Center) does not have a built-in issue tracker API. Issues are managed through Jira Software, not per-repo within Bitbucket. The Atlassian documentation for Bitbucket Server REST API contains no `/issues` endpoints. The only tracking is PR/code review. Listing this as an available endpoint is fabricated.

**Fix**: Remove Bitbucket DC from issue tracker capabilities, or clarify it requires Jira integration (which is a separate API surface).

Per [Atlassian Bitbucket Server REST API reference](https://docs.atlassian.com/bitbucket-server/rest/latest/bitbucket-rest.html).

---

### 2. Azure DevOps — Work Item Create path is wrong

**Affected**: Section 4.1 (Create Issue, Azure DevOps), Section 11 (MVP table)

The doc says:
```
POST /{project}/_apis/wit/workitems?api-version=7.0
[
  { "op": "add", "path": "/fields/System.Title", "value": "..." },
  { "op": "add", "path": "/fields/System.Description", "value": "..." },
  { "op": "add", "path": "/fields/System.WorkItemType", "value": "Bug" }
]
```

**What the doc says**: Type is specified as a field in the JSON body.

**What is actually correct**: The work item **type must be a path parameter**, not a field. The correct path is:
```
POST https://dev.azure.com/{organization}/{project}/_apis/wit/workitems/${type}?api-version=7.0
```
Where `${type}` is `Bug`, `Task`, `Epic`, etc. as a path segment. Omitting the type from the path produces a 400 error.

Per [Azure DevOps Work Items Create](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/create?view=azure-devops-rest-7.1).

---

### 3. Azure DevOps — Comment create path uses wrong segment name

**Affected**: Section 4.2, Section 11 (MVP table)

The doc says:
```
POST /{project}/_apis/wit/workitems/{id}/comments?api-version=7.0
{ "text": "Comment text" }
```

**What the doc says**: Path uses `workitems` (lowercase, plural) and works with `api-version=7.0`.

**What is actually correct**: The path is `_apis/wit/workItems/{workItemId}/comments` — `workItems` with a capital **I**. More critically, the Add Comment operation requires `api-version=7.1-preview.4`. Using `7.0` returns a 400. The `text` field is correct and is the only required field.

Per [Azure DevOps Comments Add Comment](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments/add-comment?view=azure-devops-rest-7.1).

---

### 4. Azure DevOps — Comment threading is hallucinated

**Affected**: Section 4.10 (Threaded Comments)

The doc shows:
```
POST /{project}/_apis/wit/workitems/{id}/comments
{
  "text": "comment",
  "parentCommentId": 123,
  "commentsType": 1
}
```

**What the doc says**: Azure DevOps comments support threading via `parentCommentId` and `commentsType` fields in the request body.

**What is actually correct**: The Add Comment endpoint accepts only one field: `text` (string). There is no `parentCommentId`, `commentsType`, or any other body field. Comment threading in Azure DevOps is a UI/display concept — the API does not support it via the REST comments endpoint. You cannot reply to a specific comment via the REST API.

Per [Azure DevOps Comments Add Comment](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments/add-comment?view=azure-devops-rest-7.1).

---

### 5. Azure DevOps — Comment edit path uses wrong API version

**Affected**: Section 4.3 (Edit Comment)

The doc says:
```
PATCH /{project}/_apis/wit/workitems/{id}/comments/{commentId}?api-version=7.0
```

**What the doc says**: Edit comment with `api-version=7.0`.

**What is actually correct**: Update Comment requires `api-version=7.1-preview.4`. Also `workItems` must use capital **I**.

Per [Azure DevOps Comments Update Comment](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments/update-comment?view=azure-devops-rest-7.1).

---

### 6. Azure DevOps — Comment delete path is incomplete

**Affected**: Section 4.4 (Delete Comment)

The doc omits the DELETE comment endpoint entirely.

**What is actually correct**:
```
DELETE https://dev.azure.com/{organization}/{project}/_apis/wit/workItems/{workItemId}/comments/{commentId}?api-version=7.1-preview.4
```

Per [Azure DevOps Comments Delete](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments/delete?view=azure-devops-rest-7.1).

---

## Medium Findings

### 7. Azure DevOps — Polling query parameter is wrong

**Affected**: Section 3.2, polling fallback

The doc shows:
```
GET /{project}/_apis/wit/workitems?$top=50&updatedAfter={timestamp}
```

**What the doc says**: Use `updatedAfter` as a query parameter for time-based filtering.

**What is actually correct**: Azure DevOps work item list does not have an `updatedAfter` parameter. The correct approach uses OData `$filter`:
```
GET /{project}/_apis/wit/workitems?$filter=System.ChangedDate%20ge%20{timestamp}&$top=50&api-version=7.0
```

Per [Azure DevOps Work Items List](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/list?view=azure-devops-rest-7.1).

---

### 8. GitLab — API version prefix missing from MVP table

**Affected**: Section 11, MVP table

The GitLab column in the MVP table shows paths like `GET /projects/{id}/issues` without the `/api/v4` prefix.

**What the doc says**: `GET /projects/{id}/issues`

**What is actually correct**: `GET /api/v4/projects/{id}/issues`

All GitLab REST API endpoints are under `/api/v4`. The absence of this prefix is a consistent error throughout the GitLab column of the MVP table. Section 4 references correctly say to see `gitlab.md`, but the table gives bare paths.

Per [GitLab REST API documentation](https://docs.gitlab.com/ee/api/rest/).

---

### 9. GitLab — Issue update method is correct but naming matters

**Affected**: Section 11, MVP table, "Update item" row for GitLab SM

The doc says `PUT /projects/{id}/issues/{iid}` — this is correct.

**What is actually correct**: GitLab uses `PUT` for issue updates, not `PATCH`. This is unusual (most platforms use PATCH) but confirmed by the API docs. The doc is correct here.

Per [GitLab Issues API](https://docs.gitlab.com/ee/api/issues.html).

---

### 10. Gitea/Forgejo — Label add body field naming

**Affected**: Section 4.6 (Add/Remove Label)

The doc shows:
```
POST /repos/{owner}/{repo}/issues/{index}/labels
{ "name": "needs-info" }
```

**Verification**: Confirmed via Gitea swagger. The body is `name` (string), not `id`. The path uses `labels` (plural) and the issue index. This is correct.

**Note**: The doc correctly mentions `POST /repos/{owner}/{repo}/labels` for creating labels — this is also correct.

Per [Gitea API swagger](https://docs.gitea.com/development/swagger).

---

### 11. Gitea/Forgejo — Status change via PATCH is correct

**Affected**: Section 4.5 (Change Status)

The doc shows:
```
PATCH /repos/{owner}/{repo}/issues/{index}
{ "state": "closed" }
```

**What is actually correct**: Confirmed. Gitea uses `state` as the field name (`open` or `closed`). This is correct.

---

### 12. Gitea/Forgejo — Mention syntax is correct

**Affected**: Section 4.8 (Mention User)

The doc says `@username` in Markdown body for Gitea/Forgejo. Confirmed — Gitea supports Markdown with `@username` mentions in issue/PR bodies and comments.

---

## Missing Capabilities

### 13. GitLab — No separate notes endpoint documented for outbound comments

**Affected**: Section 4.3, Section 11

The doc references `gitlab.md` for comment posting but the MVP table's GitLab column correctly shows `POST /projects/{id}/issues/{iid}/notes`. However, the custom_git_server.md itself does not include the correct path inline.

For completeness, the actual paths are:
- List notes: `GET /api/v4/projects/{id}/issues/{iid}/notes`
- Create note: `POST /api/v4/projects/{id}/issues/{iid}/notes` (body: `body`)
- Update note: `PUT /api/v4/projects/{id}/issues/{iid}/notes/{note_id}` (body: `body`)
- Delete note: `DELETE /api/v4/projects/{id}/issues/{iid}/notes/{note_id}`

Per [GitLab Notes API](https://docs.gitlab.com/ee/api/notes.html).

---

### 14. Azure DevOps — Attachment upload path and method

**Affected**: Section 4.9 (Attach File)

The doc shows:
```
POST /{project}/_apis/wit/attachments?fileName={name}&api-version=7.0
Content-Type: multipart/form-data
```

**Verification**: The path is close. The correct path for Azure DevOps Server is:
```
POST https://dev.azure.com/{organization}/{project}/_apis/wit/attachments?fileName={fileName}&uploadType=simple&api-version=7.0
```
Note: `uploadType` is a required query parameter (`simple` or `chunked`). The doc omits it. The response shape is different — it's not a JSON object with `attachments` array, it returns attachment metadata directly.

Per [Azure DevOps Work Item Tracking Attachments](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/attachments/).

---

## Summary by Capability

| Capability | Gitea/Forgejo | GitLab SM | Azure DevOps | Bitbucket DC |
|---|---|---|---|---|
| List items | Correct | Correct (needs `/api/v4`) | Correct (needs OData `$filter`) | **Hallucinated** |
| Get item | Correct | Correct | Correct | **Hallucinated** |
| Create item | Correct | Correct | **Wrong path** (type in path) | **Hallucinated** |
| Update/edit item | Correct (PATCH) | Correct (PUT) | Correct (PATCH) | N/A |
| Change status | Correct | Correct (`state_event`) | Correct (PATCH) | N/A |
| List comments | Correct | Correct | Correct (needs capital I) | N/A |
| Post comment | Correct | Correct | **Wrong api-version** | N/A |
| Edit comment | Correct | Correct (PUT) | **Wrong api-version, wrong path** | N/A |
| Delete comment | Correct | Correct (DELETE) | **Missing** | N/A |
| Add label | Correct (POST body `name`) | Correct | N/A (uses fields) | N/A |
| Remove label | Correct | Correct | N/A | N/A |
| Set assignee | Correct | Correct | Correct | N/A |
| Attach file | Correct (multipart) | Correct (multipart) | **Wrong path** (missing `uploadType`) | N/A |
| Threaded comments | N/A (flat) | N/A | **Hallucinated** | N/A |

---

## Priority Fixes

1. **Remove Bitbucket DC issue endpoints** — they don't exist. Bitbucket Server has no per-repo issue API.
2. **Fix Azure DevOps work item create** — type is a path parameter, not a body field.
3. **Fix Azure DevOps comment operations** — use `api-version=7.1-preview.4` and `workItems` (capital I).
4. **Remove Azure DevOps comment threading** — `parentCommentId` and `commentsType` don't exist in the REST API.
5. **Add Azure DevOps delete comment endpoint**.
6. **Fix GitLab API prefix** — add `/api/v4` to all GitLab paths in the MVP table.
7. **Fix Azure DevOps polling** — replace `updatedAfter` with OData `$filter`.
8. **Fix Azure DevOps attachment** — add required `uploadType` query parameter.