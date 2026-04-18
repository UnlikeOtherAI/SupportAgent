# GitHub Connector — Endpoint Coverage Review

**Verdict**: MOSTLY CORRECT with several minor issues and one notable omission. The document is thorough and well-structured. The endpoint paths, HTTP methods, and body fields are almost entirely accurate. Issues are minor: one wrong pagination claim, one missing `get single comment` endpoint in the MVP list, one incorrect `ghListReposForOwner` mapping, and a slightly misleading description of delete-label response code.

---

## Findings

### 1. Pagination — claim that GitHub uses page-number pagination only is incomplete

- **Capability affected**: Pagination / Section 9
- **What the doc says**: "GitHub uses **page number pagination** (not cursor-based) for most endpoints"
- **What is actually correct**: The REST API does use page-number pagination for most endpoints. However, the GitHub GraphQL API (used for Projects v2) uses cursor-based pagination (`after`/`before` with `pageInfo.endCursor`). More importantly, the doc later references GraphQL for Projects v2 but never flags that pagination contracts differ entirely there. For REST this claim is accurate; the framing should note the GraphQL exception.
- **Citation**: https://docs.github.com/en/graphql/overview/about-the-graphql-api#pagination

---

### 2. `GET /repos/{owner}/{repo}/issues/comments` — filter claim is incorrect

- **Capability affected**: List comments, Section 9 filter table
- **What the doc says**: "`GET /repos/{owner}/{repo}/issues/comments` — `issue_number` filter not supported — iterate per issue"
- **What is actually correct**: This is accurate — the repo-level comments endpoint (`/repos/{owner}/{repo}/issues/comments`) does NOT accept `issue_number` as a query filter. You must use the per-issue endpoint (`/repos/{owner}/{repo}/issues/{issue_number}/comments`) to scope by issue. The doc's guidance to iterate per issue is correct. No change needed, but the table entry is confusing because it lists it as an endpoint without making clear it is for reading all repo comments chronologically (useful for sync), not for per-issue listing. The real per-issue listing endpoint is separately documented. Consider clarifying the intent.
- **Citation**: https://docs.github.com/en/rest/issues/comments#list-issue-comments-for-a-repository

---

### 3. `DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}` — response code is wrong

- **Capability affected**: Remove label, Section 4
- **What the doc says**: "DELETE: Response 200 OK (removes single label)"
- **What is actually correct**: The GitHub REST API returns `200 OK` with the remaining labels array when removing a label from an issue. This is correct. No error here — confirming accuracy.
- **Citation**: https://docs.github.com/en/rest/issues/labels#remove-a-label-from-an-issue

---

### 4. `ghListReposForOwner` mapping is wrong

- **Capability affected**: Appendix A — implementation map
- **What the doc says**: `ghListReposForOwner()` → `GET /repos/{owner}` (also used for `ghCanListReposForOwner`)
- **What is actually correct**: `GET /repos/{owner}` is not a valid GitHub REST endpoint. The correct endpoints are:
  - For a user: `GET /users/{username}/repos`
  - For an organization: `GET /orgs/{org}/repos`
  - For the authenticated user's own repos: `GET /user/repos`

  The path `GET /repos/{owner}` does not exist in the GitHub REST API and will return 404. The MVP scope (Section 11) correctly lists `GET /orgs/{org}/repos`, but the Appendix A mapping contradicts it.
- **Citation**: https://docs.github.com/en/rest/repos/repos#list-repositories-for-a-user and https://docs.github.com/en/rest/repos/repos#list-organization-repositories

---

### 5. `GET /repos/{owner}/{repo}/issues/comments/{id}` — missing from MVP scope

- **Capability affected**: Get single comment — Section 11 MVP endpoint list
- **What the doc says**: MVP list includes edit comment (`PATCH`) and delete comment (`DELETE`) for `issues/comments/{comment_id}`, but does not include `GET /repos/{owner}/{repo}/issues/comments/{comment_id}` (get single comment by ID).
- **What is actually correct**: The endpoint exists and is needed when the `ghGetComment()` function (Appendix A) is ported to the REST client. It is correctly listed in Appendix A as a mapped function but omitted from the MVP scope list in Section 11. This is a minor oversight — the implementation map implies it but the scope list does not enumerate it.
- **Citation**: https://docs.github.com/en/rest/issues/comments#get-an-issue-comment

---

### 6. `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` — missing `comments` field documentation

- **Capability affected**: Approve/Request changes on PR, Section 4
- **What the doc says**:
  ```
  POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews
  {
    "event": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
    "body": "Review comment body"
  }
  ```
- **What is actually correct**: The documented body fields are valid but incomplete. The `comments` array field is also accepted and required when `event` is `REQUEST_CHANGES` if inline file comments are needed. More importantly, `body` is **required** when `event` is `REQUEST_CHANGES` (the API returns 422 if omitted). The doc does not flag this constraint.
- **Citation**: https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request

---

### 7. `POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers` — `team_slugs` field undocumented

- **Capability affected**: Add PR reviewers, Section 4
- **What the doc says**:
  ```
  POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers
  { "reviewers": ["username1", "team-slug"] }
  ```
- **What is actually correct**: `team-slug` cannot go in the `reviewers` array. Teams must be passed in a separate `team_reviewers` array:
  ```json
  { "reviewers": ["username1"], "team_reviewers": ["team-slug"] }
  ```
  Passing a team slug in `reviewers` will either silently ignore it or return a 422 validation error.
- **Citation**: https://docs.github.com/en/rest/pulls/review-requests#request-reviewers-for-a-pull-request

---

### 8. `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge` — `commit_title` and `commit_message` conditionality not noted

- **Capability affected**: Merge PR, Section 4
- **What the doc says**: Lists `commit_title` and `commit_message` as fields in the body without qualification.
- **What is actually correct**: `commit_title` and `commit_message` are only used when `merge_method` is `merge` or `squash`. They are silently ignored for `rebase`. Also, `sha` (the expected head SHA) is a recommended field to prevent merging stale PRs — this is a best-practice omission, not a hard error, but worth documenting.
- **Citation**: https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request

---

### 9. `POST /repos/{owner}/{repo}/issues/{issue_number}/labels` — return status is undocumented but wrong path implied

- **Capability affected**: Add labels, Section 4
- **What the doc says**: "Response: 200 OK — array of Label objects"
- **What is actually correct**: Correct. The endpoint returns `200 OK` with the full list of labels now on the issue. Confirmed accurate.
- **Citation**: https://docs.github.com/en/rest/issues/labels#add-labels-to-an-issue

---

### 10. `DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers` — missing from Phase 2 scope

- **Capability affected**: Remove PR reviewer — Section 11 Phase 2
- **What the doc says**: Phase 2 lists `DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers` as an endpoint to add.
- **What is actually correct**: The endpoint exists and the listing is correct. However, the body requirement is not noted: `DELETE` for this endpoint requires a JSON body (`{ "reviewers": [...], "team_reviewers": [...] }`) even though it is a DELETE. This is a GitHub API quirk and easy to miss in implementation.
- **Citation**: https://docs.github.com/en/rest/pulls/review-requests#remove-requested-reviewers-from-a-pull-request

---

### 11. `GET /repos/{owner}/{repo}/issues` — `pull_request` filtering not documented

- **Capability affected**: List issues/items, Section 9
- **What the doc says**: Filter params include `state`, `labels`, `sort`, `direction`, `since`, `milestone`, `assignee`, `creator`, `mentioned`, `per_page`, `page`.
- **What is actually correct**: This endpoint returns both issues AND pull requests by default. To fetch only issues (not PRs), callers must filter client-side on `pull_request` field being absent, or use the search API with `is:issue`. The endpoint has no server-side `type` filter to exclude PRs. This is a known quirk of the API that can cause unexpected behavior if the connector does not filter post-fetch. The doc mentions this quirk in Section 10 ("Issue vs PR Number Collisions") but not in the filter param table.
- **Citation**: https://docs.github.com/en/rest/issues/issues#list-repository-issues

---

### 12. GraphQL mutation name for Projects v2 is correct but incomplete

- **Capability affected**: GitHub Projects v2 write, Section 11 Phase 3
- **What the doc says**: `updateProjectV2ItemFieldValue` GraphQL mutation
- **What is actually correct**: The mutation name is correct. However, to write a status field value, the caller also needs `addProjectV2ItemById` to first add an item to the project if it is not already there, and `getProjectV2Fields` (a query, not mutation) to resolve the `fieldId` for the status field before writing. The doc correctly defers this to Phase 3 and references a separate spec file, so this is an observation rather than an error.
- **Citation**: https://docs.github.com/en/issues/planning-and-tracking-with-projects/using-the-api-that-supports-projects-v2/using-the-api-to-manage-projects

---

## Summary of Actionable Corrections

| # | Severity | Fix Required |
|---|----------|-------------|
| 4 | High | Fix Appendix A: `ghListReposForOwner` → `GET /users/{username}/repos` or `GET /orgs/{org}/repos`, not `GET /repos/{owner}` |
| 7 | High | Fix Section 4 PR reviewer body: team slugs go in `team_reviewers`, not `reviewers` |
| 6 | Medium | Note that `body` is required when `event === "REQUEST_CHANGES"` in review creation |
| 5 | Low | Add `GET /repos/{owner}/{repo}/issues/comments/{comment_id}` to MVP scope list |
| 8 | Low | Note `commit_title`/`commit_message` only apply for `merge`/`squash`; mention `sha` field |
| 10 | Low | Note that DELETE requested_reviewers requires a JSON body despite being a DELETE |
| 11 | Low | Add note to list-issues filter table that PRs are included and must be filtered client-side |
| 1 | Info | Clarify pagination note: REST is page-number; GraphQL (Projects v2) is cursor-based |
