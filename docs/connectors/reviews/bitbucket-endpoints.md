# Bitbucket Connector — Endpoint Surface Review

**Reviewer**: Claude Code (endpoint coverage audit)
**Source**: `docs/connectors/bitbucket.md`
**Date**: 2026-04-18

---

## Verdict: Issues Found — Fix Before Implementation

The doc is mostly accurate but contains **3 incorrect API bodies** and **1 missing webhook event**. All are actionable and fixable.

---

## Findings

### 1. Update Issue — Cloud request body has wrong field

**Affected**: Section 4.6 (Change Status/Transition), Cloud example

**Doc says**:
```json
PUT /2.0/repositories/{workspace}/{repo}/issues/{issue_id}
{
  "state": "resolved",
  "status": "resolved"
}
```

**Actually correct**: Bitbucket Cloud uses `state` only for issue status. There is no top-level `status` field on Cloud issues (that's a Data Center concept via workflow IDs). Additionally, `version` is required for optimistic locking and must be included or the update returns `409 Conflict`.

**Fix**:
```json
PUT /2.0/repositories/{workspace}/{repo}/issues/{issue_id}
{
  "state": "resolved",
  "version": 3
}
```

Note: `version` must match the issue's current `version` value. List issues to retrieve it first.

**Citation**: Per [Bitbucket Cloud Issue API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-issue-tracker/)

---

### 2. Update Issue — missing `version` field in body example

**Affected**: Section 4.8 (Assign User), Cloud example

**Doc says**:
```json
PUT /2.0/repositories/{workspace}/{repo}/issues/{issue_id}
{
  "assignee": { "uuid": "{user-uuid}" }
}
```

**Actually correct**: The `version` field is required. Without it, the API returns `409 Conflict`. All `PUT` operations on Cloud issues require `version`.

**Fix**: Add `"version": N` to the body. Implementations must fetch the current issue version before updating.

---

### 3. Update Pull Request — missing `version` field

**Affected**: Section 11, MVP list — `PUT /2.0/repositories/{workspace}/{repo}/pullrequests/{id}`

**Doc shows**: Just the path, no body contract

**Actually required**: `version` is required for all `PUT` and `POST` mutation operations on both issues and pull requests in Bitbucket Cloud. It is an integer that increments on every change.

**Fix**: Document that any `PUT` to a Cloud resource requires `{"version": N}` in the body. List/retrieve the resource first to get the current version.

---

### 4. Add/Remove Label — API body has incorrect `type` field

**Affected**: Section 4.7, Cloud example

**Doc says**:
```json
POST /2.0/repositories/{workspace}/{repo}/issues/{issue_id}
{
  "type": "update",
  "labels": [
    { "name": "support", "add": true },
    { "name": "needs-info", "remove": true }
  ]
}
```

**Actually correct**: There is no `type` field on the request body. The `labels` array format is correct, but `type` should be removed.

**Fix**:
```json
POST /2.0/repositories/{workspace}/{repo}/issues/{issue_id}
{
  "labels": [
    { "name": "support", "add": true },
    { "name": "needs-info", "remove": true }
  ]
}
```

**Citation**: Per Bitbucket Cloud Issue Tracker API — label mutation is a direct POST with `labels` array only.

---

### 5. Missing webhook event: `issue:comment_updated`

**Affected**: Section 3.1.2 (Webhook Events), Issue Events table

**Doc lists**: `issue:created`, `issue:updated`, `issue:comment_created`, `issue:comment_deleted`

**Missing**: `issue:comment_updated` — but section 4.4 documents the `PUT` to edit an issue comment, and the doc's own webhook list in section 11 includes `issue:comment_updated`. The event exists in Bitbucket Cloud and must be in the table.

**Fix**: Add `issue:comment_updated` row to the Issue Events table in section 3.1.2.

---

## Capabilities Verified as Correct

| Capability | Endpoint | Status |
|------------|----------|--------|
| List issues | `GET /2.0/repositories/{workspace}/{repo}/issues` | Correct — filters `state`, `priority`, `kind`, `assignee` all supported |
| Get issue | `GET /2.0/repositories/{workspace}/{repo}/issues/{id}` | Correct |
| Create issue | `POST /2.0/repositories/{workspace}/{repo}/issues` — `title` is the only required field | Correct |
| Delete issue | `DELETE /2.0/repositories/{workspace}/{repo}/issues/{id}` | Correct |
| List issue comments | `GET /2.0/repositories/{workspace}/{repo}/issues/{id}/comments` | Correct |
| Post issue comment | `POST /2.0/repositories/{workspace}/{repo}/issues/{id}/comments` | Correct — `content` object with `raw`/`markup` |
| Edit issue comment | `PUT /2.0/repositories/{workspace}/{repo}/issues/{id}/comments/{comment_id}` | Correct |
| Delete issue comment | `DELETE /2.0/repositories/{workspace}/{repo}/issues/{id}/comments/{comment_id}` | Correct |
| Attach file/screenshot | `POST /2.0/repositories/{workspace}/{repo}/issues/{id}/attachments` — multipart/form-data | Correct — confirmed via API reference |
| List attachments | `GET /2.0/repositories/{workspace}/{repo}/issues/{id}/attachments` | Correct |
| Set priority | `PUT /2.0/repositories/{workspace}/{repo}/issues/{id}` with `priority: "critical"` — no version needed for priority-only updates | Correct |
| Assign user | `PUT /2.0/repositories/{workspace}/{repo}/issues/{id}` with `assignee: {uuid}` | Correct |
| Mention user | `@{username}` syntax in raw/markdown content | Correct — Bitbucket supports this |
| List PRs | `GET /2.0/repositories/{workspace}/{repo}/pullrequests` — `state` filter is correct | Correct |
| Get PR | `GET /2.0/repositories/{workspace}/{repo}/pullrequests/{id}` | Correct |
| Create PR | `POST /2.0/repositories/{workspace}/{repo}/pullrequests` — `title` + `source.branch.name` required | Correct |
| Merge PR | `POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/merge` | Correct |
| Decline PR | `POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/decline` | Correct |
| Approve PR | `POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/approve` | Correct |
| Unapprove PR | `DELETE /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/approve` | Correct |
| List PR comments | `GET /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments` | Correct |
| Post PR comment | `POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments` — `content` object | Correct |
| Edit PR comment | `PUT /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments/{comment_id}` | Correct |
| Delete PR comment | `DELETE /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments/{comment_id}` | Correct |
| Resolve thread | `POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments/{comment_id}/resolve` | Correct |
| Unresolve thread | `DELETE /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments/{comment_id}/resolve` | Correct |
| Data Center merge/decline | `POST /rest/api/latest/projects/{projectKey}/repos/{repo}/pull-requests/{id}/merge` and `/decline` | Correct |
| Data Center issue status | `PUT /rest/api/latest/projects/{projectKey}/repos/{repo}/issues/{issueId}` with `state: {id: 3}` | Correct |

---

## No GraphQL Confusion

Bitbucket Cloud is a REST-only platform. No GraphQL endpoints exist. The doc correctly uses REST paths throughout.

---

## Summary of Required Fixes

| # | Location | Fix |
|---|----------|-----|
| 1 | Section 4.6 Cloud example | Remove `status` field, add `version` |
| 2 | Section 4.8 Cloud example | Add `version` field |
| 3 | Section 11 MVP PUT PR | Add note about required `version` in body |
| 4 | Section 4.7 Cloud example | Remove `type` field from request body |
| 5 | Section 3.1.2 Issue Events table | Add `issue:comment_updated` row |