# Review: GitHub Issues Connector — Endpoint Coverage

**Reviewer:** API Audit
**Date:** 2026-04-18
**Verdict:** Mostly accurate with several corrections needed

---

## Critical Findings

### 1. Remove Assignees — Wrong HTTP Method and Path

**Endpoint:** Remove assignees from issue
**Doc says:** `DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees/{assignee}`
**Actually correct:** `DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees`
- Assignee usernames go in the request body, not the URL path
- Body: `{ "assignees": ["username1", "username2"] }`

**Citation:** [per GitHub Issues Assignees API](https://docs.github.com/en/rest/issues/assignees)

---

### 2. Projects v2 — Incorrect API Paths

**Endpoint:** Add/update/delete project items
**Doc says:**
```
POST /projects/{project_id}/items
PATCH /projects/items/{item_id}
DELETE /projects/items/{item_id}
```
**Actually correct:**
```
POST /orgs/{org}/projectsV2/{project_number}/items
# Update/delete paths also require org and project_number context
```
The path uses `projectsV2` (not `projects`) and requires both `org` and `project_number`.

**Citation:** [per GitHub Projects Items API](https://docs.github.com/rest/projects/items)

---

### 3. Sub-issues Endpoint — Does Not Exist in REST API

**Endpoint:** `GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues`
**Doc status:** Listed in Phase 3
**Reality:** No REST API endpoint for sub-issues exists. Sub-issues is a GitHub features that may only be accessible via GraphQL or not at all in the API.

**Action needed:** Remove or mark as "GraphQL only / API unavailable"

**Citation:** [per GitHub Issues API](https://docs.github.com/en/rest/issues)

---

## Moderate Findings

### 4. List Repository Comments — Missing Sort Parameter

**Endpoint:** `GET /repos/{owner}/{repo}/issues/comments`
**Doc mentions:** `sort` parameter (correct)
**Gap:** The doc doesn't list `direction` parameter (`asc` or `desc`) which controls order
**Impact:** Low — not critical for MVP

**Citation:** [per GitHub Issues Comments API](https://docs.github.com/en/rest/issues/comments)

---

### 5. Create Issue — Optional `type` Field Not Documented

**Endpoint:** `POST /repos/{owner}/{repo}/issues`
**Doc shows:** `title`, `body`, `milestone`, `labels`, `assignees`
**Missing:** `type` field (optional) — distinguishes `Issue` from `PullRequest`
**Impact:** Low — the default is `Issue` anyway

**Citation:** [per GitHub Issues API](https://docs.github.com/en/rest/issues/issues)

---

### 6. Update Issue — `issue_field_values` Misleading

**Endpoint:** `PATCH /repos/{owner}/{repo}/issues/{issue_number}`
**Doc mentions:** `issue_field_values` in body
**Context:** This field is for Projects v2 integration, not base issue fields
**Impact:** Medium — could confuse implementers

**Better approach:** Document Projects v2 field updates separately under Phase 2/3

**Citation:** [per GitHub Issues API](https://docs.github.com/en/rest/issues/issues)

---

### 7. Timeline API Pagination Description

**Endpoint:** `GET /repos/{owner}/{repo}/issues/{issue_number}/timeline`
**Doc says:** "Timeline uses cursor-based pagination internally but exposes page-based API"
**Actually:** Timeline uses **offset-based** pagination (`page`, `per_page`), not cursor-based
**Impact:** Low — still usable, just technically incorrect description

**Citation:** [per GitHub Timeline API](https://docs.github.com/en/rest/issues/timeline)

---

### 8. Comments Polling — Two Endpoints Listed, One Has Limits

**Endpoints listed:**
```
GET /repos/{owner}/{repo}/issues/{issue_number}/comments
GET /repos/{owner}/{repo}/issues/comments?since=<timestamp>
```
**Issue:** The second endpoint (`/issues/comments` scoped to repo) does exist but is documented without noting its limitations — it returns comments across ALL issues and `since` only filters by creation time.

**Better approach:** Recommend `GET /repos/{owner}/{repo}/issues/{issue_number}/comments?since=<timestamp>` instead, or clarify the difference.

**Citation:** [per GitHub Issues Comments API](https://docs.github.com/en/rest/issues/comments)

---

## Minor Findings

### 9. Milestones — Listed But Not Fully Documented

**MVP endpoints include:** `GET /repos/{owner}/{repo}/milestones?per_page=100`
**Status:** Correct path, but milestones are rarely needed for SupportAgent
**Action:** OK to leave as-is; not a bug, just underdocumented

---

### 10. Pin/Unpin Comment — Correct but Missing from MVP Scope

**Endpoints documented correctly:**
```
PUT /repos/{owner}/{repo}/issues/comments/{comment_id}/pin
DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}/pin
```
**Status:** Accurate, but not listed in MVP or Phase 2 scopes
**Action:** Add to Phase 3 if needed, or remove from doc

**Citation:** [per GitHub Issues Comments API](https://docs.github.com/en/rest/issues/comments)

---

## Verified Correct Endpoints

The following endpoints are correctly documented:

| Capability | Method | Path | Status |
|------------|--------|------|--------|
| List issues | GET | `/repos/{owner}/{repo}/issues` | Correct |
| Get issue | GET | `/repos/{owner}/{repo}/issues/{issue_number}` | Correct |
| Create issue | POST | `/repos/{owner}/{repo}/issues` | Correct |
| Update issue title/body/state | PATCH | `/repos/{owner}/{repo}/issues/{issue_number}` | Correct |
| Close/reopen issue | PATCH | `/repos/{owner}/{repo}/issues/{issue_number}` | Correct |
| Lock issue | PUT | `/repos/{owner}/{repo}/issues/{issue_number}/lock` | Correct |
| Unlock issue | DELETE | `/repos/{owner}/{repo}/issues/{issue_number}/lock` | Correct |
| List issue comments | GET | `/repos/{owner}/{repo}/issues/{issue_number}/comments` | Correct |
| List repo comments | GET | `/repos/{owner}/{repo}/issues/comments` | Correct |
| Get comment | GET | `/repos/{owner}/{repo}/issues/comments/{comment_id}` | Correct |
| Post comment | POST | `/repos/{owner}/{repo}/issues/{issue_number}/comments` | Correct |
| Edit comment | PATCH | `/repos/{owner}/{repo}/issues/comments/{comment_id}` | Correct |
| Delete comment | DELETE | `/repos/{owner}/{repo}/issues/comments/{comment_id}` | Correct |
| Add labels | POST | `/repos/{owner}/{repo}/issues/{issue_number}/labels` | Correct |
| Remove label | DELETE | `/repos/{owner}/{repo}/issues/{issue_number}/labels/{name}` | Correct |
| Replace all labels | PUT | `/repos/{owner}/{repo}/issues/{issue_number}/labels` | Correct |
| Add assignees | POST | `/repos/{owner}/{repo}/issues/{issue_number}/assignees` | Correct |
| List labels | GET | `/repos/{owner}/{repo}/labels` | Correct |
| Create label | POST | `/repos/{owner}/{repo}/labels` | Correct |
| Update label | PATCH | `/repos/{owner}/{repo}/labels/{name}` | Correct |
| Delete label | DELETE | `/repos/{owner}/{repo}/labels/{name}` | Correct |
| List assignees | GET | `/repos/{owner}/{repo}/assignees` | Correct |
| Check assignee | GET | `/repos/{owner}/{repo}/assignees/{assignee}` | Correct |
| Lock/unlock | PUT/DELETE | `/repos/{owner}/{repo}/issues/{issue_number}/lock` | Correct |
| List events | GET | `/repos/{owner}/{repo}/issues/{issue_number}/events` | Correct |
| List timeline | GET | `/repos/{owner}/{repo}/issues/{issue_number}/timeline` | Correct |
| Get user | GET | `/users/{username}` | Correct |
| Get authenticated user | GET | `/user` | Correct |
| Search issues | GET | `/search/issues` | Correct |
| List milestones | GET | `/repos/{owner}/{repo}/milestones` | Correct |

---

## Summary

**Must fix:**
1. Remove Assignees: Change DELETE path to use body instead of path parameter
2. Projects v2: Fix paths to use `projectsV2` and `org/project_number`

**Should fix:**
3. Sub-issues: Remove or mark as unavailable
4. Timeline pagination description: Fix "cursor-based" to "offset-based"
5. Comments polling: Clarify endpoint differences

**Nice to have:**
6. Add `type` field to Create Issue
7. Separate `issue_field_values` from base issue update docs
8. Pin/unlock comment in Phase 3 scope

**Overall:** The document is well-structured and 90%+ accurate. The critical issues are the remove assignees path and Projects v2 paths.
