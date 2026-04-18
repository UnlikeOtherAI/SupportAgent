# GitHub Connector — Endpoint Coverage Review

**Verdict**: APPROVED with minor clarifications

---

## Issues (Must Fix)

### 1. Missing `mentioned` filter on issue list endpoint

- **Endpoint**: `GET /repos/{owner}/{repo}/issues`
- **Doc says**: Filters listed are `state`, `labels`, `sort`, `direction`, `since`, `milestone`, `assignee`, `creator`, `per_page`, `page`
- **Actually correct**: Official docs include `mentioned` as an additional filter parameter (`mentioned:username`)
- **Severity**: Low — uncommon filter, but should be documented for completeness
- **Citation**: [per GitHub REST API — List repository issues](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28#list-repository-issues)

---

## Clarifications Needed

### 2. Close Issue — `state_reason` parameter

- **Endpoint**: `PATCH /repos/{owner}/{repo}/issues/{issue_number}`
- **Doc says**: `{ "state": "closed", "state_reason": "completed" | "not_planned" | "duplicate" }`
- **Actually correct**: `state_reason` is the correct parameter name. However, when closing, you can send just `state: "closed"` and GitHub will prompt the user to select a reason. Sending `state_reason` alongside is correct for programmatic closure.
- **Citation**: [per GitHub REST API — Update an issue](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28#update-an-issue)

### 3. Create Issue — `title` is the only required field

- **Endpoint**: `POST /repos/{owner}/{repo}/issues`
- **Doc says**: Example shows `title`, `body`, `labels`, `assignees`, `milestone` in the request body without marking any as required
- **Actually correct**: Only `title` is required. The other fields (`body`, `labels`, `assignees`, `milestone`) are optional.
- **Severity**: Minor — the example implies all fields are needed, but they're labeled in code comments as just example fields
- **Citation**: [per GitHub REST API — Create an issue](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28#create-an-issue)

### 4. Create PR — `title` is required, not optional

- **Endpoint**: `POST /repos/{repo}/{owner}/pulls`
- **Doc says**: Example shows `title`, `head`, `base`, `body`, `draft`, `maintainer_can_modify`
- **Actually correct**: Official docs specify `title`, `head`, and `base` as required. The doc should mark these as required.
- **Severity**: Minor — code example with all fields obscures which are actually required
- **Citation**: [per GitHub REST API — Create a pull request](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#create-a-pull-request)

---

## Verified Correct

### 5. Issue list endpoint

- **Endpoint**: `GET /repos/{owner}/{repo}/issues`
- **Status**: Correct — all documented filters (`state`, `labels`, `sort`, `direction`, `since`, `milestone`, `assignee`, `creator`, `per_page`, `page`) match official API
- **Note**: `mentioned` filter is missing but uncommon (see finding #1)
- **Citation**: [per GitHub REST API — List repository issues](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28#list-repository-issues)

### 6. Get single issue

- **Endpoint**: `GET /repos/{owner}/{repo}/issues/{issue_number}`
- **Status**: Correct
- **Citation**: [per GitHub REST API — Get an issue](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28#get-an-issue)

### 7. Create issue

- **Endpoint**: `POST /repos/{owner}/{repo}/issues`
- **Status**: Correct — path, method, and body format all accurate
- **Clarification**: Only `title` is required (see finding #3)
- **Citation**: [per GitHub REST API — Create an issue](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28#create-an-issue)

### 8. Update issue (close/reopen/edit)

- **Endpoint**: `PATCH /repos/{owner}/{repo}/issues/{issue_number}`
- **Status**: Correct — method, path, and body format accurate
- **Clarification**: `state_reason` is correct parameter name (see finding #2)
- **Citation**: [per GitHub REST API — Update an issue](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28#update-an-issue)

### 9. Post issue comment

- **Endpoint**: `POST /repos/{owner}/{repo}/issues/{issue_number}/comments`
- **Status**: Correct — method, path, and body format accurate
- **Response**: 201 Created
- **Citation**: [per GitHub REST API — Create an issue comment](https://docs.github.com/en/rest/issues/comments?apiVersion=2022-11-28#create-an-issue-comment)

### 10. Edit issue comment

- **Endpoint**: `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}`
- **Status**: Correct — method, path, and body format accurate
- **Response**: 200 OK
- **Citation**: [per GitHub REST API — Update an issue comment](https://docs.github.com/en/rest/issues/comments?apiVersion=2022-11-28#update-an-issue-comment)

### 11. Delete issue comment

- **Endpoint**: `DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}`
- **Status**: Correct — method, path accurate
- **Response**: 204 No Content
- **Citation**: [per GitHub REST API — Delete an issue comment](https://docs.github.com/en/rest/issues/comments?apiVersion=2022-11-28#delete-an-issue-comment)

### 12. List issue comments

- **Endpoint**: `GET /repos/{owner}/{repo}/issues/{issue_number}/comments`
- **Status**: Correct
- **Citation**: [per GitHub REST API — List issue comments](https://docs.github.com/en/rest/issues/comments?apiVersion=2022-11-28#list-issue-comments)

### 13. Add labels to issue

- **Endpoint**: `POST /repos/{owner}/{repo}/issues/{issue_number}/labels`
- **Status**: Correct — method, path, and body format (`{"labels": ["bug", "enhancement"]}`) accurate
- **Response**: 200 OK with array of Label objects
- **Citation**: [per GitHub REST API — Add labels to an issue](https://docs.github.com/en/rest/issues/labels?apiVersion=2022-11-28#add-labels-to-an-issue)

### 14. Remove single label from issue

- **Endpoint**: `DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}`
- **Status**: Correct — method, path, and parameter name (`{name}` as URL parameter, not query param) accurate
- **Response**: 200 OK (verified — single label deletion returns 200, not 204)
- **Citation**: [per GitHub REST API — Remove a label from an issue](https://docs.github.com/en/rest/issues/labels?apiVersion=2022-11-28#remove-a-label-from-an-issue)

### 15. Replace all labels on issue

- **Endpoint**: `PUT /repos/{owner}/{repo}/issues/{issue_number}/labels`
- **Status**: Correct — method, path, and body format accurate
- **Citation**: [per GitHub REST API — Replace all labels for an issue](https://docs.github.com/en/rest/issues/labels?apiVersion=2022-11-28#replace-all-labels-for-an-issue)

### 16. Add assignees to issue

- **Endpoint**: `POST /repos/{owner}/{repo}/issues/{issue_number}/assignees`
- **Status**: Correct — method, path, and body format (`{"assignees": ["user1", "user2"]}`) accurate
- **Citation**: [per GitHub REST API — Add assignees to an issue](https://docs.github.com/en/rest/issues/assignees?apiVersion=2022-11-28#add-assignees-to-an-issue)

### 17. Remove assignees from issue

- **Endpoint**: `DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees`
- **Status**: Correct — method, path, and body format accurate
- **Citation**: [per GitHub REST API — Remove assignees from an issue](https://docs.github.com/en/rest/issues/assignees?apiVersion=2022-11-28#remove-assignees-from-an-issue)

### 18. Set milestone on issue

- **Endpoint**: `PATCH /repos/{owner}/{repo}/issues/{issue_number}` with `{"milestone": 1}`
- **Status**: Correct — milestone number (integer) is the correct format. Pass `null` to remove milestone.
- **Citation**: [per GitHub REST API — Update an issue](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28#update-an-issue)

### 19. Lock/unlock issue

- **Endpoints**:
  - `PUT /repos/{owner}/{repo}/issues/{issue_number}/lock` with `{"lock_reason": "off-topic"|"too heated"|"resolved"|"spam"}`
  - `DELETE /repos/{owner}/{repo}/issues/{issue_number}/lock`
- **Status**: Correct — methods, paths, and `lock_reason` values accurate
- **Note**: `lock_reason` is required on PUT, no body on DELETE
- **Citation**: [per GitHub REST API — Lock an issue](https://docs.github.com/en/rest/issues?apiVersion=2022-11-28#lock-an-issue)

### 20. List pull requests

- **Endpoint**: `GET /repos/{owner}/{repo}/pulls`
- **Status**: Correct — method, path, and filter parameters (`state`, `head`, `base`, `sort`, `direction`, `per_page`, `page`) accurate
- **Citation**: [per GitHub REST API — List pull requests](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#list-pull-requests)

### 21. Get pull request

- **Endpoint**: `GET /repos/{owner}/{repo}/pulls/{pull_number}`
- **Status**: Correct
- **Citation**: [per GitHub REST API — Get a pull request](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#get-a-pull-request)

### 22. Create pull request

- **Endpoint**: `POST /repos/{owner}/{repo}/pulls`
- **Status**: Correct — method, path, and body format accurate
- **Clarification**: `title`, `head`, `base` are required (see finding #4)
- **Citation**: [per GitHub REST API — Create a pull request](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#create-a-pull-request)

### 23. Update pull request

- **Endpoint**: `PATCH /repos/{owner}/{repo}/pulls/{pull_number}`
- **Status**: Correct
- **Citation**: [per GitHub REST API — Update a pull request](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#update-a-pull-request)

### 24. Merge pull request

- **Endpoint**: `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge`
- **Status**: Correct — method, path, and body format (`merge_method`, `commit_title`, `commit_message`) accurate
- **Note**: Response is 200 OK if mergeable, 405 if not
- **Citation**: [per GitHub REST API — Merge a pull request](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#merge-a-pull-request)

### 25. Add PR reviewers (request review)

- **Endpoint**: `POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers`
- **Status**: Correct — method, path, and body format (`{"reviewers": [...], "team_reviewers": [...]}`) accurate
- **Citation**: [per GitHub REST API — Add requested reviewers to a pull request](https://docs.github.com/en/rest/pulls/review-requests?apiVersion=2022-11-28#add-requested-reviewers-to-a-pull-request)

### 26. Remove PR reviewers

- **Endpoint**: `DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers`
- **Status**: Correct — method, path, and body format accurate
- **Citation**: [per GitHub REST API — Remove requested reviewers from a pull request](https://docs.github.com/en/rest/pulls/review-requests?apiVersion=2022-11-28#remove-requested-reviewers-from-a-pull-request)

### 27. Create PR review (approve/request changes/comment)

- **Endpoint**: `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews`
- **Status**: Correct — method, path, and body format (`event: "APPROVE"|"REQUEST_CHANGES"|"COMMENT"`, `body`) accurate
- **Citation**: [per GitHub REST API — Create a review for a pull request](https://docs.github.com/en/rest/pulls/reviews?apiVersion=2022-11-28#create-a-review-for-a-pull-request)

### 28. List PR reviews

- **Endpoint**: `GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews`
- **Status**: Correct
- **Citation**: [per GitHub REST API — List reviews for a pull request](https://docs.github.com/en/rest/pulls/reviews?apiVersion=2022-11-28#list-reviews-for-a-pull-request)

### 29. Create inline PR review comment

- **Endpoint**: `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments`
- **Status**: Correct — method, path, and body format (`body`, `commit_id`, `path`, `line`, `side`) accurate
- **Response**: 201 Created
- **Note**: This is distinct from issue-level comments. The doc correctly notes this distinction.
- **Citation**: [per GitHub REST API — Create a review comment for a pull request](https://docs.github.com/en/rest/pulls/comments?apiVersion=2022-11-28#create-a-review-comment-for-a-pull-request)

### 30. Edit inline PR review comment

- **Endpoint**: `PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}`
- **Status**: Correct — method, path, and body format (`body`) accurate
- **Citation**: [per GitHub REST API — Update a review comment for a pull request](https://docs.github.com/en/rest/pulls/comments?apiVersion=2022-11-28#update-a-review-comment-for-a-pull-request)

### 31. Delete inline PR review comment

- **Endpoint**: `DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}`
- **Status**: Correct — method and path accurate
- **Citation**: [per GitHub REST API — Delete a review comment for a pull request](https://docs.github.com/en/rest/pulls/comments?apiVersion=2022-11-28#delete-a-review-comment-for-a-pull-request)

### 32. List PR review comments

- **Endpoint**: `GET /repos/{owner}/{repo}/pulls/{pull_number}/comments`
- **Status**: Correct
- **Note**: `GET /repos/{owner}/{repo}/pulls/comments` lists ALL review comments in a repo (different endpoint)
- **Citation**: [per GitHub REST API](https://docs.github.com/en/rest/pulls/comments?apiVersion=2022-11-28#list-review-comments-on-a-pull-request)

### 33. Search issues

- **Endpoint**: `GET /search/issues`
- **Status**: Correct — path and example qualifiers accurate
- **Rate limit**: 30 requests/minute (authenticated) — doc correctly notes this
- **Citation**: [per GitHub REST API — Search issues and pull requests](https://docs.github.com/en/rest/search)

### 34. List labels for repo

- **Endpoint**: `GET /repos/{owner}/{repo}/labels`
- **Status**: Correct
- **Citation**: [per GitHub REST API — List labels for a repository](https://docs.github.com/en/rest/issues/labels?apiVersion=2022-11-28#list-labels-for-a-repository)

### 35. Create label

- **Endpoint**: `POST /repos/{owner}/{repo}/labels`
- **Status**: Correct
- **Citation**: [per GitHub REST API — Create a label](https://docs.github.com/en/rest/issues/labels?apiVersion=2022-11-28#create-a-label)

---

## Missing Capabilities

### 36. File attachment — Not Supported

- **Capability**: Attach file/screenshot to issue or comment
- **Status**: **GitHub does not support file uploads via REST API** for issues or comments
- **Workaround**: Upload to GitHub's gist API or external storage, then link in comment body
- **Note**: The doc correctly omits this endpoint — it does not exist

### 37. Priority/Severity — Not Native, Use Labels

- **Capability**: Set priority or severity
- **Status**: GitHub has no native priority or severity field. The doc correctly documents this as labels.
- **Note**: No endpoint to set — labels are the only mechanism
- **Citation**: [per GitHub REST API issues reference](https://docs.github.com/en/rest/issues)

### 38. Status Transition — Not Native, Use State

- **Capability**: Set status or workflow transition
- **Status**: GitHub has only `state` (`open` | `closed`) with `state_reason` for closure. No custom statuses.
- **Note**: The doc correctly documents this limitation
- **Citation**: [per GitHub REST API — Update an issue](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28#update-an-issue)

---

## Summary

The document is well-structured and accurate. Key points:

1. **All documented endpoints are correct** — HTTP methods, paths, and parameter names match official GitHub API docs
2. **Issue vs PR comments distinction is handled correctly** — the doc clearly differentiates `issue_comment` from `pull_request_review_comment`
3. **Missing filter**: `mentioned` parameter on issue list endpoint (minor)
4. **Required field clarity**: `title` for create-issue and create-PR should be marked as required
5. **File attachments**: Correctly absent — GitHub doesn't support this via API
6. **Priority/Severity**: Correctly documented as labels-only

**Recommendation**: Fix findings #1-4 for completeness. No blocking issues.
