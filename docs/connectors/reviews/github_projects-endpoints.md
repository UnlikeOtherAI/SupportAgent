# GitHub Projects v2 — Endpoint Coverage Review

**Review date**: 2026-04-18
**Source**: `docs/connectors/github_projects.md`
**Scope**: API endpoint accuracy for SupportAgent connector capabilities
**Excluded**: Auth, webhooks, rate limits

---

## Verdict: NEEDS REVISION

The document has significant gaps in REST API coverage and is missing several GraphQL mutations needed for full SupportAgent functionality.

---

## Findings

### 1. REST endpoint paths are wrong

**Affected**: All REST endpoints in Section 4

**What the doc says**:
```
GET /orgs/{org}/projects/{project_id}
GET /orgs/{org}/projects
PATCH /orgs/{org}/projects/{project_id}
DELETE /orgs/{org}/projects/{project_id}
```

**What is actually correct**:
```
GET /orgs/{org}/projectsV2/{project_number}
GET /orgs/{org}/projectsV2
PATCH /orgs/{org}/projectsV2/{project_number}
DELETE /orgs/{org}/projectsV2/{project_number}
```

**Issue**: Path uses `projects` instead of `projectsV2`, and `project_id` instead of `project_number`. GitHub's REST API uses `projectsV2` (no hyphen) for v2-specific endpoints. Also uses `project_number` (numeric) not `project_id`.

**Citation**: [docs.github.com/rest/projects/items](https://docs.github.com/en/rest/projects/items), [docs.github.com/rest/projects/fields](https://docs.github.com/en/rest/projects/fields)

---

### 2. REST API for adding items exists — doc says it doesn't

**Affected**: Section 4, "REST API (Limited)" table

**What the doc says**:
> REST API does NOT support: Adding items to projects

**What is actually correct**:
```
POST /orgs/{org}/projectsV2/{project_number}/items
```

This endpoint exists and adds an existing issue/PR to a project. Required body fields: `type` ("Issue" or "PullRequest"), `id` (integer).

**Citation**: [docs.github.com/rest/projects/items](https://docs.github.com/en/rest/projects/items)

---

### 3. REST draft items endpoints missing

**Affected**: Document does not cover

**What exists but isn't documented**:
```
POST /orgs/{org}/projectsV2/{project_number}/drafts
POST /users/{user_id}/projectsV2/{project_number}/drafts
```

Required body: `title` (string, required), `body` (string, optional).

**Citation**: [docs.github.com/rest/projects/drafts](https://docs.github.com/en/rest/projects/drafts)

---

### 4. REST item listing supports filtering — not documented

**Affected**: Document does not cover

**What exists but isn't documented**:
```
GET /orgs/{org}/projectsV2/{project_number}/items?q={query}
```

Query parameter `q` supports filtering items. Optional `fields` parameter limits results to specific field IDs.

**Citation**: [docs.github.com/rest/projects/items](https://docs.github.com/en/rest/projects/items)

---

### 5. Missing GraphQL mutation: addAssigneesToAssignable

**Affected**: Section 5, MVP scope

**What exists but isn't documented**: `addAssigneesToAssignable` mutation for adding users to issues/PRs.

```
mutation AddAssignees($input: AddAssigneesToAssignableInput!) {
  addAssigneesToAssignable(input: $input) {
    assignable { ... }
  }
}
```

**Note**: This is separate from setting assignee fields in Projects v2. For project assignee fields, use `setIssueFieldValue`.

**Citation**: [docs.github.com/graphql/reference/mutations](https://docs.github.com/en/graphql/reference/mutations)

---

### 6. Missing GraphQL mutation: removeAssigneesFromAssignable

**Affected**: Document does not cover

**What exists but isn't documented**: `removeAssigneesFromAssignable` mutation.

**Citation**: [docs.github.com/graphql/reference/mutations](https://docs.github.com/en/graphql/reference/mutations)

---

### 7. Missing GraphQL mutation: removeLabelsFromLabelable

**Affected**: Section 5, MVP scope

**What the doc says**: Mentions `addLabelsToLabelable` for adding labels

**What is missing**: `removeLabelsFromLabelable` for removing labels

**Citation**: [docs.github.com/graphql/reference/mutations](https://docs.github.com/en/graphql/reference/mutations)

---

### 8. Missing GraphQL mutations: issue comment operations

**Affected**: Section 11, "Delivery operations"

**What the doc says**:
> Post comment on linked issue (via GitHub Issues connector)

**What is missing**: Actual GraphQL mutations for comment management:
- `addComment` — create comment on issue/PR
- `updateIssueComment` — edit existing comment
- `deleteIssueComment` — delete comment

REST equivalents exist at `POST /repos/{owner}/{repo}/issues/{issue_number}/comments`.

**Citation**: [docs.github.com/graphql/reference/mutations](https://docs.github.com/en/graphql/reference/mutations), [docs.github.com/rest/issues/comments](https://docs.github.com/en/rest/issues/comments)

---

### 9. File/screenshot attachment not addressed

**Affected**: Document does not cover

**What the doc should note**: GitHub does not have native file attachment. Workaround options:
- Upload to GitHub release or gist, attach URL in comment
- Use external hosting, include URL in issue body or comment
- No native drag-drop screenshot support in API

**Citation**: [docs.github.com/rest/issues](https://docs.github.com/en/rest/issues) — no attachment endpoint exists

---

### 10. setIssueFieldValue input field naming concern

**Affected**: Section 4, "Set Field Value" mutation

**What the doc shows**:
```json
{
  "input": {
    "issueId": "PVTI_xxx",
    "issueField": { ... }
  }
}
```

**Concern**: The input variable name `issueId` is ambiguous. For project items, the correct fields are `projectId` and `itemId` (or the field reference varies by operation). The document should clarify:
- For `setIssueFieldValue`: uses `projectId`, `itemId`, `fieldId`, and field-value nested object
- For project-specific field operations: `AddProjectV2DraftIssueInput` uses `projectId`, `title`, `body`, `assigneeIds`

**Citation**: GraphQL schema — verify exact input field names in [GitHub GraphQL Explorer](https://docs.github.com/en/graphql/overview/explorer)

---

## Capabilities Not Covered

| Capability | Status | Notes |
|------------|--------|-------|
| List items with filter | REST exists | `GET /orgs/{org}/projectsV2/{project_number}/items?q=` |
| Create draft issue | REST exists | `POST /orgs/{org}/projectsV2/{project_number}/drafts` |
| Add existing item to project | REST exists | `POST /orgs/{org}/projectsV2/{project_number}/items` |
| Add assignees | GraphQL exists | `addAssigneesToAssignable` |
| Remove assignees | GraphQL exists | `removeAssigneesFromAssignable` |
| Remove labels | GraphQL exists | `removeLabelsFromLabelable` |
| Post issue comment | GraphQL + REST exist | `addComment` / `POST /repos/.../comments` |
| Edit comment | GraphQL + REST exist | `updateIssueComment` / `PATCH /repos/.../comments/{id}` |
| Delete comment | GraphQL + REST exist | `deleteIssueComment` / `DELETE /repos/.../comments/{id}` |
| File attachment | Not native | External URL workaround only |
| Set milestone | Via `setIssueFieldValue` | Project milestone field or issue milestone |
| Set priority/severity | Via `setIssueFieldValue` | Custom single-select fields |

---

## Verified Correct

| Item | Status |
|------|--------|
| GraphQL endpoint URL | `POST https://api.github.com/graphql` — correct |
| Draft issue GraphQL mutation | `addProjectV2DraftIssue` — correct |
| Add item to project mutation | `addProjectV2ItemById` — correct |
| Clear field value mutation | `clearProjectV2ItemFieldValue` — correct |
| Archive/unarchive mutations | `archiveProjectV2Item` / `unarchiveProjectV2Item` — correct |
| Delete item mutation | `deleteProjectV2Item` — correct |
| Convert draft to issue mutation | `convertProjectV2DraftIssueItemToIssue` — correct |
| Add labels mutation | `addLabelsToLabelable` — correct |
| Projects v2 is GraphQL-primary | Correct — REST is limited but has more than documented |
| Global ID encoding/decoding | Correct — Base64 `type:id` format |

---

## Recommendations

1. **Fix all REST paths**: Replace `projects/{project_id}` with `projectsV2/{project_number}`
2. **Update REST limitations**: Remove "does not support adding items" — it does via REST
3. **Add draft items REST endpoints**: Document `POST /orgs/{org}/projectsV2/{project_number}/drafts`
4. **Add missing GraphQL mutations**: `addAssigneesToAssignable`, `removeAssigneesFromAssignable`, `removeLabelsFromLabelable`, `addComment`, `updateIssueComment`, `deleteIssueComment`
5. **Clarify setIssueFieldValue input**: Use correct field names `projectId` and `itemId`
6. **Document file attachment workaround**: Note that native attachments don't exist
