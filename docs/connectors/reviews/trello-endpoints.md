# Trello Connector — API Endpoint Coverage Review

**Reviewer:** Claude Code
**Date:** 2026-04-18
**Source doc:** `docs/connectors/trello.md`
**Verdict:** APPROVED WITH CORRECTIONS (5 critical path corrections needed)

---

## Summary

The Trello connector document is well-structured and covers the full surface area needed for SupportAgent. The base URL (`https://api.trello.com/1`), path patterns, and webhook integration are all accurate. Five endpoint paths need correction — all are off by the `/id` prefix in the path segment for adding/removing existing labels and members from cards.

---

## Findings

### 1. Add existing label to card — WRONG PATH

**Endpoint:** Section 4.6 (Add/Remove Label)
**Doc says:** `POST /1/cards/{cardId}/labels` with `color={colorName}&name={labelName}` or `&color={colorName}`
**Actually correct:** `POST /1/cards/{cardId}/idLabels?value={labelId}` — adds an existing label from the board to the card
**What the doc describes:** Creates a NEW label on the board AND adds it to the card simultaneously (this is `POST /1/cards/{cardId}/labels`). This is NOT the "add existing label" operation.
**Citation:** [Trello Cards API — Add Label to Card](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/#api-cards-id-idlabels-post)

**Correction needed:**
- `POST /1/cards/{cardId}/idLabels?value={labelId}` — adds an existing label by ID
- Keep `POST /1/cards/{cardId}/labels` documented separately as "create + add new label" (this endpoint does both)
- `color` and `name` are NOT valid params for `POST /1/cards/{cardId}/idLabels` — only `value`

---

### 2. Remove label from card — WRONG PATH

**Endpoint:** Section 4.6 (Remove label)
**Doc says:** `DELETE /1/cards/{cardId}/labels/{labelId}`
**Actually correct:** `DELETE /1/cards/{cardId}/idLabels/{labelId}`
**Citation:** [Trello Cards API — Remove Label from Card](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/#api-cards-id-idlabels-label-id-delete)

---

### 3. Add member to card — WRONG PATH AND PARAM

**Endpoint:** Section 4.8 (Assign User)
**Doc says:**
```
POST /1/cards/{cardId}/members
  &value={memberId}
```
**Actually correct:**
```
POST /1/cards/{cardId}/idMembers
  ?value={memberId}
```
**Issue:** Path uses `/members/` but should use `/idMembers/`. The parameter name `value` is correct.
**Citation:** [Trello Cards API — Add Member to Card](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/#api-cards-id-idmembers-post)

---

### 4. Remove member from card — WRONG PATH

**Endpoint:** Section 4.8 (Remove assignee)
**Doc says:** `DELETE /1/cards/{cardId}/members/{memberId}`
**Actually correct:** `DELETE /1/cards/{cardId}/idMembers/{memberId}`
**Citation:** [Trello Cards API — Remove Member from Card](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/#api-cards-id-idmembers-member-id-delete)

---

### 5. Create label — MISSING REQUIRED FIELD

**Endpoint:** Section 5.1 (Create label)
**Doc says:** `&name={labelName}&color={color}` (idBoard noted, but color and name marked optional in bullet list)
**Actually correct:** `color` is required. `name` is optional (can create color-only labels).
**Citation:** [Trello Labels API — Create Label](https://developer.atlassian.com/cloud/trello/rest/api-group-labels/)

---

## Verified Correct Endpoints

| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /1/cards` | ✅ | idList required; name, desc, pos, due, dueComplete, idMembers, idLabels all optional |
| `GET /1/cards/{cardId}` | ✅ | `?customFieldItems=true` param confirmed |
| `PUT /1/cards/{cardId}` | ✅ | All update params optional; `closed=true` for archive |
| `DELETE /1/cards/{cardId}` | ✅ | |
| `POST /1/cards/{cardId}/actions/comments?text=...` | ✅ | `text` is required param |
| `PUT /1/actions/{actionId}` | ✅ | Updates comment actions; `text` param |
| `PUT /1/actions/{actionId}/text?value=...` | ✅ | Alternate update path with `value` param |
| `DELETE /1/actions/{actionId}` | ✅ | |
| `PUT /1/labels/{labelId}` | ✅ | name and color optional for update |
| `DELETE /1/labels/{labelId}` | ✅ | |
| `GET /1/boards/{boardId}/labels` | ✅ | `limit` param available |
| `GET /1/boards/{boardId}/lists` | ✅ | |
| `GET /1/boards/{boardId}/members` | ✅ | |
| `GET /1/boards/{boardId}/actions` | ✅ | `limit`, `page`, `filter`, `since`, `before` all available |
| `GET /1/boards/{boardId}/customFields` | ✅ | |
| `GET /1/members/{idOrUsername}` | ✅ | |
| `POST /1/labels` | ✅ | idBoard, color required; name optional |
| `POST /1/cards/{cardId}/attachments` | ✅ | `url` OR `file` (multipart); `name`, `setCover` optional |
| `PUT /1/cards/{cardId}/customField/{customFieldId}/item` | ✅ | `value` param with JSON e.g. `{"text":"..."}` |
| `GET /1/search` | ✅ | `query`, `idBoards`, `modelTypes`, `cards_limit` all available |
| `GET /1/search/members` | ✅ | |
| `POST /1/cards/{cardId}/checklists` | ✅ | |
| `POST /1/checklists/{id}/checkItems` | ✅ | |
| `POST /1/tokens/{token}/webhooks` | ✅ | |
| `GET /1/tokens/{token}/webhooks` | ✅ | |
| `DELETE /1/webhooks/{webhookId}` | ✅ | |

---

## Verified Absent (Correctly Documented)

| Capability | Status | Notes |
|-----------|--------|-------|
| Edit comment directly | ⚠️ Documented workaround, but `PUT /1/actions/{id}` DOES exist | See note below |
| Card-level webhook events | ⚠️ | Only board/card-level; no list-level webhooks (correct) |
| Self-hosted | ⚠️ | Trello is cloud-only (correct) |
| Native priority model | ⚠️ | No built-in priority (correct — use labels or custom fields) |

**Edit comment clarification:** Section 4.3 says "no standalone edit endpoint" and documents delete+recreate. This is overly cautious — `PUT /1/actions/{id}?text=...` exists and edits comment actions in place. The workaround is valid but the direct edit IS available. Recommend updating section 4.3 to reflect this.

---

## Not Verified (Out of Scope for This Review)

- Attachment DELETE endpoint — not found in API docs but likely exists (`DELETE /1/cards/{cardId}/attachments/{attachmentId}`)
- Rate limit header behavior
- OAuth2 3LO flow details
- Enterprise-specific endpoints

---

## Request Body Format

Confirmed: Trello accepts both query parameters and JSON request body for POST/PUT endpoints. The doc correctly uses query param style throughout.

---

## Overall Assessment

The document is solid. The 5 path corrections (all involving the `/id` prefix pattern) are the only critical fixes needed. Adding the `PUT /1/actions/{id}` edit endpoint note in Section 4.3 would also improve accuracy. Otherwise the endpoint surface is complete and well-documented for SupportAgent's needs.
