# Jira Connector — API Endpoint Review

**Reviewer:** Claude Code
**Source:** `docs/connectors/jira.md`
**Scope:** Endpoint correctness only. Auth, webhooks (registration), rate limits out of scope.

---

## Verdict: ISSUES FOUND — needs correction before shipping

Three endpoint paths are wrong or deprecated. Several response shape hints need correction.

---

## Findings

### 1. Search endpoint is deprecated

**Affected:** Section 3.2 polling fallback, Section 9.1 pagination example, Section 9.3 search table, Section 11 MVP endpoints

**Doc says:**
```
GET /rest/api/3/search?jql=...
```

**Actual:** `GET /rest/api/3/search` is marked "Currently being removed" in the official docs. The recommended endpoint is `GET /rest/api/3/search/jql`.

The new `/rest/api/3/search/jql` endpoint also has different response pagination: `nextPageToken` and `reconcileIssues` (read-after-write consistency) are only available on the new endpoint.

**Fix:** Replace all instances of `GET /rest/api/3/search` with `GET /rest/api/3/search/jql`.

**Citation:** [Jira Cloud REST API v3 — Issue Search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/) (per official docs)

---

### 2. Webhook registration path in MVP section is wrong

**Affected:** Section 11 — `POST /rest/api/3/webhooks/1.0/webhook`

**Doc says:** `POST /rest/api/3/webhooks/1.0/webhook`
**Actual:** No such path exists. Correct paths are:
- Admin webhooks (Basic Auth / PAT): `POST /rest/webhooks/1.0/webhook`
- OAuth/Connect apps: `POST /rest/api/2/webhook`

The path in section 11 mixes up the versioning prefix (`/rest/api/3/`) with the webhook-specific prefix (`/rest/webhooks/1.0/`).

**Fix:** Section 11 MVP endpoints should list two separate webhook registration endpoints with their auth requirements, OR if only targeting admin webhooks, use `POST /rest/webhooks/1.0/webhook`.

**Citation:** [Jira Cloud Webhooks](https://developer.atlassian.com/cloud/jira/platform/webhooks/) (per official docs)

---

### 3. Project list endpoint is deprecated

**Affected:** Section 9.3 table — `GET /rest/api/3/project/search`

Wait — section 9.3 already shows the correct path `GET /rest/api/3/project/search`. Let me re-check... actually section 9.3 shows `GET /rest/api/3/project/search` which is correct. But the **body text** of section 9.3 says "List projects: `GET /rest/api/3/issue/createmeta`" which is wrong — `createmeta` is for available fields, not project listing. This is a confusion of two different endpoints.

**Doc says:** `GET /rest/api/3/issue/createmeta` listed under "List projects"
**Actual:** `createmeta` returns available fields for issue creation. The correct project listing endpoint is `GET /rest/api/3/project/search` (which is already listed separately in the same table).

**Fix:** Remove `GET /rest/api/3/issue/createmeta` from the "List projects" row or move it to its own row with the correct description.

**Citation:** [Jira Cloud REST API v3 — Projects](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/) (per official docs)

---

### 4. Response pagination shape for search vs comment list

**Affected:** Section 9.1 — "nextPageToken for forward-only cursor pagination"

The doc shows a generic response shape with `values: [...]` and says "nextPageToken for forward-only cursor pagination."

**Issue:** The `values` key is used by the **search** endpoint. The `POST /rest/api/3/comment/list` endpoint returns a `PageBeanComment` which uses `comments: [...]` (not `values`). The pagination keys also differ.

**Fix:** Clarify that the response shape with `values` is for search. For `POST /rest/api/3/comment/list`, the response uses `comments: [...]` and pagination fields are `startAt`, `maxResults`, `total`, `isLast`, and `nextPage`.

**Citation:** [Jira Cloud REST API v3 — Issue Comments](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/) (per official docs)

---

### 5. POST /rest/api/3/comment/list — comment IDs are integers

**Affected:** Section 9.3 table entry for `POST /rest/api/3/comment/list`, and the TypeScript interface `JiraComment` in section 3.2

**Doc says:** The TypeScript interface shows `id: string`. The table entry shows no body format.

**Actual:** The `ids` parameter in `POST /rest/api/3/comment/list` accepts an **array of integers**, not strings. Jira uses integer IDs for comments internally. The `id` field on a Comment object is an integer (not a string).

**Fix:** Update the TypeScript interface in section 3.2 to use `id: number` instead of `id: string`. Clarify in section 9.3 that the body is `{ "ids": [1, 2, 3] }` (integer array).

**Citation:** [Jira Cloud REST API v3 — Issue Comments](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/) (per official docs)

---

### 6. DELETE webhook path in MVP section

**Affected:** Section 11 — `DELETE /rest/api/3/webhooks/1.0/webhook/{id}`

**Doc says:** `DELETE /rest/api/3/webhooks/1.0/webhook/{id}`
**Actual:** The path should be `DELETE /rest/webhooks/1.0/webhook/{id}` (for admin webhooks) or `DELETE /rest/api/2/webhook/{id}` (for OAuth/Connect). The `/rest/api/3/webhooks/1.0/` prefix is incorrect.

**Fix:** Same as finding #2 — use `DELETE /rest/webhooks/1.0/webhook/{id}` for admin webhooks.

**Citation:** [Jira Cloud Webhooks](https://developer.atlassian.com/cloud/jira/platform/webhooks/) (per official docs)

---

## Confirmed Correct

These endpoints match the official API reference:

| Endpoint | Section | Status |
|----------|---------|--------|
| `POST /rest/api/3/issue` | 4.1 | ✓ Correct |
| `GET /rest/api/3/issue/{key}` | 11 | ✓ Correct |
| `PUT /rest/api/3/issue/{key}` | 4.5, 4.6, 4.7, 4.8, 11 | ✓ Correct (PUT, not PATCH) |
| `GET /rest/api/3/issue/{key}/comment` | 11 | ✓ Correct |
| `POST /rest/api/3/issue/{key}/comment` | 4.2, 11 | ✓ Correct, 201 response |
| `PUT /rest/api/3/issue/{key}/comment/{id}` | 4.3, 11 | ✓ Correct |
| `DELETE /rest/api/3/issue/{key}/comment/{id}` | 4.4 | ✓ Correct, 204 response |
| `GET /rest/api/3/issue/{key}/transitions` | 4.5, 11 | ✓ Correct |
| `POST /rest/api/3/issue/{key}/transitions` | 4.5, 4.10, 11 | ✓ Correct |
| `POST /rest/api/3/issue/{key}/attachments` | 4.11 | ✓ Correct, multipart/form-data, `X-Atlassian-Token: no-check` |
| `GET /rest/api/3/priority` | 5.4, 11 | ✓ Correct |
| `GET /rest/api/3/status` | 5.3 | ✓ Correct |
| `GET /rest/api/3/label` | 5.1 | ✓ Correct |
| `GET /rest/api/3/field` | 5.2 | ✓ Correct |
| `GET /rest/api/3/field/search?projectIds=` | 5.2 | ✓ Correct |
| `GET /rest/api/3/user?accountId=` | 7.2 | ✓ Correct |
| `POST /rest/api/3/issue/bulk` | 11 | ✓ Correct, max 50 issues |
| `GET /rest/api/3/project/search` | 11 | ✓ Correct (not the deprecated `/rest/api/3/project`) |
| `POST /rest/api/3/comment/list` | 9.3 | ✓ Endpoint exists (but see finding #5) |
| `GET /rest/api/3/issue/{key}/changelog` | 9.3 | ✓ Correct |
| `GET /rest/api/3/issue/createmeta` | 4.1, 5.2 | ✓ Correct (but see finding #3) |
| `POST /rest/webhooks/1.0/webhook` | 3.1 | ✓ Correct for admin webhooks |
| `POST /rest/api/2/webhook` | 3.1 | ✓ Correct for OAuth/Connect apps |
| Assignee unassign pattern `{ "accountId": null }` | 4.8 | ✓ Confirmed correct |
| Priority set by `{ "name": "High" }` | 4.7 | ✓ Name-based priority works |
| ADF body format for comments/descriptions | 4.2, 4.3, Appendix C | ✓ Correct structure |

---

## Summary

**3 wrong paths, 1 deprecated path in active use, 2 response shape hints need correction.**

Priority fix: the deprecated `GET /rest/api/3/search` is used in the polling fallback and MVP — this will break when Atlassian completes the removal. The webhook path in section 11 is also actively wrong.
