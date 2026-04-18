# Notion Connector — Endpoint Audit Review

**Reviewed by**: Claude Code (endpoints reviewer)
**Source file**: `docs/connectors/notion.md`
**Official reference**: https://developers.notion.com/reference/intro
**Date**: 2026-04-18

## Verdict: REJECT — 4 findings, 2 critical

---

## Critical Findings

### 1. `DELETE /v1/comments/{comment_id}` — Endpoint Does Not Exist

**Location**: Lines 154–158

**What the doc says**:
```
DELETE /v1/comments/{comment_id}
```

**What is actually correct**: The Notion API has **no delete comment endpoint**. The Comments resource only supports `POST /v1/comments` (create) and `PATCH /v1/comments/{comment_id}` (update). There is no documented or supported delete operation. Attempting to call `DELETE /v1/comments/{comment_id}` will return a 404 or method-not-allowed error.

**Per Notion API reference** (https://developers.notion.com/reference/update-a-comment): The spec defines only the PATCH update operation. No delete is listed under the Comments tag.

**Impact**: Any SupportAgent code that tries to delete a Notion comment will fail. This capability should be removed from the design doc and marked as unsupported.

---

### 2. `POST /v1/pages/{page_id}/move` — Endpoint Does Not Exist

**Location**: Lines 233–243

**What the doc says**:
```
POST /v1/pages/{page_id}/move
```
```json
{ "parent": { "page_id": "uuid" } }
```

**What is actually correct**: The Notion API does **not** have a `POST /v1/pages/{page_id}/move` endpoint. This path is not documented in the official reference. Pages cannot be moved via the API — the `parent` of a page is immutable after creation. The only way to "move" a page is to create a new page with the desired parent and archive the original.

**Per Notion API reference** (https://developers.notion.com/reference/intro): No move endpoint appears in the Page resource endpoints. The Gotcha at line 396 correctly states "Page parent immutability: Cannot change a page's parent after creation" — but then the doc contradicts itself by documenting a move endpoint.

**Impact**: The "Move Page" section (lines 233–243) should be removed or replaced with the create-new + archive-old pattern. The contradiction with the Gotcha at line 396 is confusing.

---

## Moderate Findings

### 3. Create Page — `children` support in body is unclear

**Location**: Lines 111–127

**What the doc says**: The `POST /v1/pages` example shows `children` as part of the request body, but does not note whether this is supported or whether blocks must be appended separately with `PATCH /v1/blocks/{id}/children`.

**What is actually correct**: The official `create-page` endpoint (POST /v1/pages) **does** support `children` in the request body. This is valid and supported. However, this is not documented as a confirmed fact — the doc shows it in the example but doesn't explicitly state it's supported. A reader might think it's just illustrative.

**Impact**: The doc should explicitly state that `children` can be passed in the create-page request body, so implementors know they don't need a separate PATCH call to populate initial page content.

---

### 4. Database Query — `last_edited_time` filter not explicitly documented

**Location**: Lines 371–381

**What the doc says**: The query example shows `filter` on a `Status` property and `sort` on `last_edited_time`. The polling fallback (line 87) also references using `last_edited_time` filter.

**What is actually correct**: The `POST /v1/databases/{id}/query` endpoint supports `sort` on page timestamps (including `last_edited_time`), but it does **not** support `filter` on page-level timestamps like `last_edited_time`. The filter operates on **database properties**, not page metadata. You can only sort by `last_edited_time`; you cannot filter rows by it.

**Impact**: The polling strategy at line 87 says "query by `last_edited_time` filter (most reliable)" — this overstates what the API can do. You can **sort** by `last_edited_time`, but you cannot **filter** by it. The reliable polling strategy is sort by `last_edited_time` descending, then diff the returned pages locally. The doc should correct this to avoid confusion in implementation.

---

## Confirmed Correct Endpoints

The following are accurately documented and verified against the official API:

| Endpoint | Status | Notes |
|---|---|---|
| `GET /v1/users/me` | ✓ | Bot identity |
| `GET /v1/users/{id}` | ✓ | User resolution |
| `POST /v1/pages` | ✓ | Create page, title as rich_text array, parent as page_id or database_id |
| `PATCH /v1/pages/{id}` | ✓ | Supports `in_trash`, `is_archived`, `properties`, `icon`, `cover` |
| `POST /v1/comments` | ✓ | Parent is page_id, block_id, or discussion_id. Body is `rich_text` or `markdown`. Attachments via `attachments` array. |
| `PATCH /v1/comments/{comment_id}` | ✓ | Exactly one of `rich_text` or `markdown` required |
| `GET /v1/comments?block_id={id}` | ✓ | List comments on a block or page |
| `POST /v1/databases/{id}/query` | ✓ | Cursor pagination, filter on properties, sort on timestamps |
| `GET /v1/databases/{id}` | ✓ | Full schema including select/status options |
| `PATCH /v1/databases/{id}` | ✓ | Supports title, description, icon, cover, in_trash |
| `GET /v1/blocks/{id}/children` | ✓ | List blocks |
| `PATCH /v1/blocks/{id}/children` | ✓ | Append blocks (append-only) |
| `POST /v1/search` | ✓ | Sort by `last_edited_time` supported |
| `POST /v1/file_uploads` | ✓ | Multipart upload before referencing in blocks/comments |
| `GET /v1/pages/{id}/properties/{prop}` | ✓ | Handles >25 item truncation |

---

## Other Notes

- **Title property format**: The doc correctly shows title as `[{ "type": "text", "text": { "content": "..." } }]` — a rich_text array, not a plain string. This is accurate.
- **Status/Select/Multi-select model**: The label/tag/priority model in sections 4–5 is accurately described. Notion has no native labels; these use database properties.
- **Webhook events**: `page.content_updated`, `page.locked`, `comment.created` are correctly listed. The `data_source.schema_updated` event (2025-09-03) is documented.
- **Rich text mentions**: The note that plain `@name` text is NOT a mention and that structured `mention` blocks are required is accurate.
- **Page parent immutability**: Correctly noted in Gotcha #12, but contradicted by the non-existent move endpoint in section 4.

---

## Summary

| Finding | Severity | Endpoint |
|---|---|---|
| DELETE comment does not exist | Critical | `DELETE /v1/comments/{comment_id}` |
| POST move page does not exist | Critical | `POST /v1/pages/{page_id}/move` |
| Create-page `children` support unclear | Moderate | `POST /v1/pages` |
| `last_edited_time` filter overstates API | Moderate | `POST /v1/databases/{id}/query` |

**Action required**: Remove the two non-existent endpoints and clarify the create-page children support and last_edited_time filter limitation before this doc is used for implementation.