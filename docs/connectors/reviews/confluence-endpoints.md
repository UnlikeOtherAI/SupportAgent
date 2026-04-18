# Confluence Connector — Endpoint Audit Review

**Reviewer**: Endpoint coverage audit
**Source**: `docs/connectors/confluence.md`
**Date**: 2026-04-18
**Verdict**: Issues found — significant path mismatches between documented v2 endpoints and actual API

---

## Critical Issues

### 1. Labels — v2 has no POST/DELETE endpoints

**Doc says**:
- `POST /wiki/api/v2/pages/{pageId}/labels` — add label (line 198)
- `DELETE /wiki/api/v2/pages/{pageId}/labels/{labelName}` — remove label (line 203)
- `GET /wiki/api/v2/pages/{pageId}/labels` — list labels (line 243)

**Actual (v2 Label API)**: Only GET operations exist:
- `GET /pages/{id}/labels`
- `GET /blogposts/{id}/labels`
- `GET /attachments/{id}/labels`
- `GET /spaces/{id}/labels`
- `GET /labels` (global search with filters)

**No POST, no DELETE in v2.**

**Where labels actually work**: v1 REST API (`/wiki/rest/api/content/{id}/label`):
- `POST /wiki/rest/api/content/{id}/label` — add labels (body: `[{ "prefix": "...", "name": "..." }]`)
- `DELETE /wiki/rest/api/content/{id}/label/{label}` — remove by path
- `DELETE /wiki/rest/api/content/{id}/label?name={name}` — remove by query (for labels with `/`)
- `GET /wiki/rest/api/content/{id}/label` — list labels

**Fix required**: The doc conflates v1 label CRUD with v2 GET-only endpoints. Document label add/remove as v1 only, or remove them from the v2 quick reference table.

**Citation**: [Confluence REST API v2 — Label](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-label/), [Confluence REST API v1 — Content Labels](https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content-labels/)

---

### 2. Attachment upload — does not exist in v2

**Doc says** (line 221–228):
```
POST /wiki/api/v2/attachments
Content-Type: multipart/form-data
X-Atlassian-Token: no-check
Body: file (binary), name, mediaType, containerId, containerType
```

**Actual (v2 Attachment API)**: Only GET and DELETE:
- `GET /attachments`
- `GET /attachments/{id}`
- `DELETE /attachments/{id}`
- `GET /pages/{id}/attachments`
- `GET /blogposts/{id}/attachments`
- `GET /custom-content/{id}/attachments`
- `GET /labels/{id}/attachments`

**No POST endpoint in v2.**

**Where attachment upload actually works**: v1 REST API:
- `POST /wiki/rest/api/content/{id}/child/attachment` — upload (multipart)
- `GET /wiki/rest/api/content/{id}/child/attachment` — list
- `DELETE /wiki/rest/api/content/{id}/child/attachment/{id}` — delete

**Fix required**: Remove the v2 attachment upload example entirely. Document upload as v1-only with the correct path. The v2 quick reference table correctly omits attachment upload — the Outbound section incorrectly says it exists in v2.

**Citation**: [Confluence REST API v2 — Attachment](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-attachment/), [Confluence REST API v1 — Content Attachments](https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content-attachments/)

---

### 3. Comments — path structures are wrong for v2

The doc uses generic `/comments` paths throughout, but v2 separates comments into two distinct types with different roots.

#### 3a. List comments on a page

**Doc says** (line 96, 426):
```
GET /wiki/api/v2/pages/{pageId}/comments
```

**Actual v2**: No generic `/pages/{id}/comments` endpoint. Two separate endpoints:
```
GET /pages/{id}/footer-comments
GET /pages/{id}/inline-comments
```

Footer comments are thread-level. Inline comments are tied to specific text ranges.

**Fix required**: Replace with both endpoint paths and explain the distinction. For polling all comment activity on a page, call both.

#### 3b. Create comment

**Doc says** (line 162, 427):
```
POST /wiki/api/v2/comments
Body: { body, container: { id, type } }
```

**Actual v2**: No top-level `/comments` POST. Separate endpoints:
```
POST /footer-comments
Body: blogPostId | pageId | parentCommentId | attachmentId | customContentId, body

POST /inline-comments
Body: blogPostId | pageId | parentCommentId, body, inlineCommentProperties (required)
```

The `inlineCommentProperties` is required for inline comments — contains `textSelection`, `textSelectionMatchCount`, `textSelectionMatchIndex`.

**Fix required**: Remove the generic `POST /wiki/api/v2/comments` example. Replace with `POST /footer-comments` (simpler, for SupportAgent use) and note inline comments require extra properties.

#### 3c. Update comment

**Doc says** (line 183):
```
PUT /wiki/api/v2/comments/{commentId}
```

**Actual v2**:
```
PUT /footer-comments/{comment-id}  Body: version, body, _links
PUT /inline-comments/{comment-id}  Body: version, body, resolved
```

The `version` field (object with `number`) is required on update — not just the ID.

**Fix required**: Split by comment type. Note the version requirement.

#### 3d. Delete comment

**Doc says** (line 187–189):
> Confluence does NOT have a native delete endpoint. Workaround: use content property to mark as hidden...

**This is wrong for v2.** Both comment types support DELETE:
```
DELETE /footer-comments/{comment-id}
DELETE /inline-comments/{comment-id}
```

The v1 also supports delete: `DELETE /wiki/rest/api/content/{id}/child/comment/{id}`.

**Fix required**: Delete does exist in v2. Remove the "no native delete" note. Document the correct v2 delete endpoints. Keep the note that deletion requires `delete:comment:confluence` scope.

**Citation**: [Confluence REST API v2 — Comment](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-comment/), [Confluence REST API v1 — Content Children and Descendants (comments)](https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content-children-and-descendants/)

---

## Moderate Issues

### 4. User lookup — path is wrong for v2

**Doc says** (line 298–300, 430):
```
GET /wiki/api/v2/users/{accountId}
Response: { accountId, displayName, email, profilePicture }
```

**Actual v2 User API**: No `GET /users/{id}` endpoint. Available:
- `POST /users-bulk` — bulk lookup by accountIds (requires `read:user:confluence`)
- `POST /user/access/check-access-by-email` — check site access by email
- `POST /user/access/invite-by-email` — invite by email

There is no single-user GET by accountId.

**Fix required**: The `/users/{id}` endpoint does not exist in v2. The correct approach for v2 is `POST /users-bulk` with a single ID. Or fall back to v1: `GET /wiki/rest/api/user?key={accountId}` or `GET /wiki/rest/api/user?username={username}`.

**Citation**: [Confluence REST API v2 — User](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-user/)

---

### 5. Page update — `type` field incorrectly listed as required

**Doc says** (line 132):
```json
{ "type": "page", "title": "Page Title", "spaceId": "SPACE_ID", ... }
```

**Actual (v2 POST /pages body requirements)**:
- `spaceId` — required
- `status` — required (for create with specific status)
- `title` — optional (can create with no title)
- `body` — optional
- `parentId` — optional
- `subtype` — optional
- `type` — **not a valid field in the request body** (it's always derived from `subtype` or defaulted)

**Fix required**: Remove `"type": "page"` from the minimal body example. The `type` is implicit.

**Citation**: [Confluence REST API v2 — POST /pages](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/)

---

### 6. Page update (PUT) — required fields are incomplete

**Doc references** `PUT /wiki/api/v2/pages/{id}` but does not document the body requirements.

**Actual (v2 PUT /pages/{id})**:
- `id` (string) — required
- `status` (string) — required
- `title` (string) — required
- `body` (PageBodyWrite) — required
- `version` (object with `number`) — required
- `spaceId` — optional
- `parentId` — optional
- `ownerId` — optional

**Fix required**: Document the full PUT body requirements. The `version` field (object) is especially important — Confluence uses optimistic locking and rejects updates without the correct version number.

---

### 7. Page hierarchy endpoints — paths partially correct

**Doc says** (line 232–233):
- Get children: `GET /wiki/api/v2/pages/{pageId}/children`
- Get ancestors: `GET /wiki/api/v2/pages/{pageId}/ancestors`

**Actual v2**:
- `GET /pages/{id}/children` — exists but marked deprecated
- `GET /pages/{id}/direct-children` — non-deprecated replacement for direct children
- `GET /pages/{id}/ancestors` — exists (returns id + type per ancestor)

**Also missing**: `GET /pages/{id}/descendants` — exists in v2 with `depth` and `limit` params (requires `read:hierarchical-content:confluence` scope).

**Fix required**: Add the non-deprecated `direct-children` endpoint. Add descendants. Mark `children` as deprecated.

**Citation**: [Confluence REST API v2 — Children](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-children/), [Confluence REST API v2 — Ancestors](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-ancestors/), [Confluence REST API v2 — Descendants](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-descendants/)

---

## Minor Issues

### 8. v1 vs v2 — doc never explicitly specifies which API version each v1 endpoint belongs to

The doc frequently writes `/wiki/api/v2/...` but then describes v1-only endpoints (labels, attachment upload) with v2-style paths. The confusion cascades:

- Line 509: Quick reference table lists label endpoints under v2 column with v2-style paths
- Line 526: Lists `GET /wiki/api/v2/comments?containerId={pageId}&containerType=page` — this endpoint does not exist in either version
- The v1 endpoints (which actually have label add/remove, attachment upload, comment CRUD) are barely documented with correct v1 paths

**Fix required**: Clearly segregate v1 and v2 endpoints throughout. The v2 quick reference should only list endpoints that actually exist in v2. Move v1-only endpoints (label add/remove, attachment upload, comment CRUD via child paths) to a separate v1 section with correct paths (`/wiki/rest/api/...`).

### 9. Confluence does not have status/priority/severity — doc correctly notes this

No issues here. Lines 262–268 correctly identify that pages have `status` (current/draft/trashed) but no configurable priority. This is accurate and should be preserved.

### 10. Label add body in v1 — doc omits `prefix` field

The doc says (line 199):
```
Body: { "name": "important" }
```

In v1, the label body requires an array with both `prefix` and `name`:
```json
[{ "prefix": "", "name": "important" }]
```

`prefix` can be empty string `""`, but it must be present.

**Fix required**: Show the correct v1 label body structure.

---

## Summary of Path Corrections

| Capability | Doc says | Actually correct |
|------------|----------|-----------------|
| Add label to page | `POST /wiki/api/v2/pages/{id}/labels` | `POST /wiki/rest/api/content/{id}/label` (v1 only) |
| Remove label from page | `DELETE /wiki/api/v2/pages/{id}/labels/{name}` | `DELETE /wiki/rest/api/content/{id}/label/{name}` (v1 only) |
| List page labels | `GET /wiki/api/v2/pages/{id}/labels` | `GET /pages/{id}/labels` (v2 ✓) |
| Upload attachment | `POST /wiki/api/v2/attachments` | `POST /wiki/rest/api/content/{id}/child/attachment` (v1 only) |
| List page comments | `GET /wiki/api/v2/pages/{id}/comments` | `GET /pages/{id}/footer-comments` or `/pages/{id}/inline-comments` (v2) |
| Create comment | `POST /wiki/api/v2/comments` | `POST /footer-comments` (v2) or `POST /wiki/rest/api/content/{id}/child/comment` (v1) |
| Update comment | `PUT /wiki/api/v2/comments/{id}` | `PUT /footer-comments/{id}` or `PUT /inline-comments/{id}` (v2) |
| Delete comment | "does not exist" | `DELETE /footer-comments/{id}` / `DELETE /inline-comments/{id}` (v2) |
| Get user by ID | `GET /wiki/api/v2/users/{id}` | `POST /users-bulk` with single ID (v2) or `GET /wiki/rest/api/user?key=...` (v1) |
| Create page body | includes `"type": "page"` | `type` not valid in body; `spaceId` is the only required field |
| Page children | `GET /pages/{id}/children` | `GET /pages/{id}/direct-children` (non-deprecated); `children` is deprecated |

---

## Capabilities Not Covered (Acceptable Gaps)

These capabilities are not applicable to Confluence, and the doc correctly notes this:
- Issue/ticket tracking (Confluence is a wiki, not an issue tracker)
- Custom fields (no equivalent)
- Priority/severity (not applicable)
- Assignee field (pages don't have one — user mentions via ADF/storage are the equivalent)

These are correctly handled in the doc. No change needed.

---

## Endpoints Verified as Correct

- `GET /wiki/api/v2/pages` — list pages with CQL filter ✓
- `GET /wiki/api/v2/pages/{id}` — get page by ID ✓
- `POST /wiki/api/v2/pages` — create page (body structure mostly correct, remove `type`) ✓
- `PUT /wiki/api/v2/pages/{id}` — update page (partially documented, needs full body reqs) ✓
- `DELETE /pages/{id}` — delete page ✓ (implied, should be explicit)
- `GET /wiki/api/v2/spaces` — list spaces ✓
- `GET /wiki/api/v2/spaces/{id}` — get space by ID ✓
- `GET /spaces/{id}/pages` — list pages in space ✓
- Cursor-based pagination pattern (`cursor`, `limit`) ✓
- CQL search (`cql` query param) ✓
- Mention syntax in storage and ADF ✓
- Page version tracking via `version.number` ✓
- External URL construction ✓

---

## Recommendations

1. **Split the doc into v1 and v2 sections** with clear API version labeling. The current doc mixes them without distinction.

2. **For MVP (v2-first)**: Drop label add/remove and attachment upload from MVP scope since they require v1 fallback. Or document the v1 fallback paths clearly with the correct `/wiki/rest/api/` prefix.

3. **For comments**: Decide whether SupportAgent needs inline comments (tied to text selection) or only footer comments (thread-level). This affects which v2 endpoints to implement. For most support use cases, footer comments are sufficient.

4. **Add version requirement to all PUT endpoints**: Confluence v2 uses optimistic locking. Every update (page, comment) requires the `version` object in the body.

5. **Add explicit DELETE endpoints**: Document `DELETE /pages/{id}` (with `purge` param) and the two comment delete paths.