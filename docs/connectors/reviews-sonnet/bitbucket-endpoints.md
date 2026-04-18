# Endpoint Review: Bitbucket Connector

**Reviewer**: claude-sonnet-4-6  
**Source doc**: `docs/connectors/bitbucket.md`  
**Date**: 2026-04-18  
**Scope**: API endpoint coverage — HTTP methods, paths, body fields, response shapes, parameter names.  
Auth, webhooks, and rate-limit handling reviewed only where directly tied to an endpoint claim.

---

## Verdict

**Conditionally acceptable with required corrections.** The doc covers the right endpoint surface and is mostly accurate for the Cloud 2.0 API. However it contains several concrete errors: wrong inline-comment body schema, hallucinated label add/remove body format, incorrect webhook event names, wrong issue state list, wrong issue metadata paths, a `type` field that causes merge failures, and it misses the imminent sunset of the Bitbucket Issues tracker entirely. Fix these before implementation.

---

## Findings

### 1. Inline comment body schema is wrong (§4.2)

**What the doc says**  
```json
"inline": {
  "to": { "commit": "{commit_hash}", "path": "src/file.ts" },
  "from": { "commit": "{commit_hash}", "path": "src/file.ts" },
  "outdated": false
}
```

**What is actually correct**  
The `inline` object uses **integer line numbers**, not nested commit/path objects. The real schema:
```json
"inline": {
  "from": 160,
  "to": 160,
  "start_from": 120,
  "start_to": 120,
  "path": "src/file.ts"
}
```
- `from`/`to` — line numbers in the new (right-hand) version of the file.
- `start_from`/`start_to` — line numbers in the old (left-hand) version.
- `path` — file path string, top-level inside `inline`, not inside a sub-object.
- There is no `outdated` field in the POST body, and no `commit` sub-object inside `inline`.

**Citation**: [Bitbucket Cloud REST API – Commits group, PR comment schema](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-commits/); [Atlassian Developer Community – inline PR comment endpoint](https://community.developer.atlassian.com/t/api-post-endpoint-for-inline-pull-request-comments/60452)

---

### 2. Issue label add/remove body format is hallucinated (§4.7)

**What the doc says**  
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

**What is actually correct**  
Bitbucket Cloud issues do **not have a `labels` field** in the API 2.0 issue object schema. The issue object uses `kind`, `priority`, `component`, `milestone`, and `version` for categorisation. The `labels` array with `add`/`remove` sub-objects does not exist; sending it would be silently ignored or rejected. The `type` field at the top level of an update body is also not valid here.

Additionally, the HTTP method shown is `POST` but updating an issue requires `PUT`.

If the doc is thinking of the `labels` array visible in the issue payload (§3.2), that field appears in webhook payloads but is **not a writable field via the REST API** and is not documented in the PUT schema.

**Citation**: [Bitbucket Cloud REST API – Issue Tracker POST schema](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-issue-tracker/#api-repositories-workspace-repo-slug-issues-post) — no `labels` field present; PUT schema is identical.

---

### 3. Webhook event names `pullrequest:needs_review` and `pullrequest:request_change` do not exist (§3.1.2, §6.1, §11)

**What the doc says**  
Events `pullrequest:needs_review` and `pullrequest:request_change` are listed as valid webhook events.

**What is actually correct**  
Neither event exists. The correct event names are:
- `pullrequest:changes_request_created` — when a reviewer requests changes
- `pullrequest:changes_request_removed` — when that request is removed

There is no `pullrequest:needs_review` event key. The doc also lists it in the Phase 2 additional webhook events (§11). Both references need correction.

Additionally, the MVP webhook list in §11 includes `pullrequest:request_change` — this should be `pullrequest:changes_request_created`.

**Citation**: [Bitbucket Cloud Event Payloads – Atlassian Support](https://support.atlassian.com/bitbucket-cloud/docs/event-payloads/)

---

### 4. Issue state list is incomplete — missing `submitted` and `invalid` (§4.6, §5.3)

**What the doc says**  
Available states: `new`, `open`, `on hold`, `resolved`, `duplicate`, `wontfix`, `closed`

**What is actually correct**  
The complete list has nine values:  
`submitted`, `new`, `open`, `on hold`, `resolved`, `duplicate`, `invalid`, `wontfix`, `closed`

`submitted` is the initial state assigned automatically on creation (not the same as `new`). `invalid` is a distinct close reason. Both are missing from §4.6 and §5.3.

**Citation**: [Bitbucket Cloud Event Payloads](https://support.atlassian.com/bitbucket-cloud/docs/event-payloads/) — Issue entity `state` field enumeration.

---

### 5. Issue status update body uses nonexistent `status` field (§4.6)

**What the doc says**  
```json
PUT /2.0/repositories/{workspace}/{repo}/issues/{issue_id}
{
  "state": "resolved",
  "status": "resolved"
}
```

**What is actually correct**  
There is no `status` field on the issue object. The field is `state` only. Sending `"status"` is a no-op at best.

**Citation**: [Bitbucket Cloud REST API – Issue Tracker PUT](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-issue-tracker/#api-repositories-workspace-repo-slug-issues-issue-id-put)

---

### 6. Issue metadata paths are wrong — `/issues/components` does not exist (§5.5)

**What the doc says**  
```
GET /2.0/repositories/{workspace}/{repo}/issues/components
GET /2.0/repositories/{workspace}/{repo}/issues/milestones
GET /2.0/repositories/{workspace}/{repo}/issues/versions
```

**What is actually correct**  
Components, milestones, and versions are **repository-level resources**, not nested under `/issues/`. Correct paths:
```
GET /2.0/repositories/{workspace}/{repo}/components
GET /2.0/repositories/{workspace}/{repo}/components/{component_id}
GET /2.0/repositories/{workspace}/{repo}/milestones
GET /2.0/repositories/{workspace}/{repo}/milestones/{milestone_id}
GET /2.0/repositories/{workspace}/{repo}/versions
GET /2.0/repositories/{workspace}/{repo}/versions/{version_id}
```

**Citation**: [Bitbucket Cloud REST API – Issue Tracker group](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-issue-tracker/) — components/milestones/versions listed at repository level.

---

### 7. Merge body includes `type` field that causes 400 errors (§4.10)

**What the doc says**  
```json
POST /2.0/repositories/{workspace}/{repo}/pullrequests/{pull_request_id}/merge
{
  "message": "Merged by SupportAgent",
  "type": "merge"
}
```

**What is actually correct**  
Including the `type` field in the merge body is documented but in practice causes a `400 Bad Request` without details in the Bitbucket Cloud API. Multiple confirmed community reports and the correct merge body omits `type`:
```json
{
  "message": "Merged by SupportAgent",
  "merge_strategy": "merge_commit",
  "close_source_branch": true
}
```
Supported `merge_strategy` values include `merge_commit`, `squash`, `fast_forward` (availability depends on repo settings). Sending no body uses repository defaults and works reliably.

**Citation**: [Atlassian Developer Community – Cannot merge PR via REST API when body is provided](https://community.developer.atlassian.com/t/cannot-merge-pull-request-via-bitbucket-rest-api-when-body-is-provided/60898)

---

### 8. Rate limit headers are partially wrong (§8.1)

**What the doc says**  
Headers returned: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

**What is actually correct**  
The Bitbucket Cloud API returns:
- `X-RateLimit-Limit` — total requests permitted per hour (correct)
- `X-RateLimit-NearLimit` — boolean, `true` when remaining drops below 20% (not documented in the doc)
- `X-RateLimit-Resource` — identifies the endpoint resource group for scaled rate limits

There is no `X-RateLimit-Remaining` or `X-RateLimit-Reset` header. These are GitHub-style headers and do not exist in Bitbucket's response.

The rate limit model is also more nuanced than described. For Standard/Premium workspaces with 100+ paid users, the limit scales: `1,000 + (paid_users - 100) × 10`, capped at 10,000/hour. The free vs paid distinction in the doc (`60/hr` for free authenticated) does not match current docs — authenticated requests are `1,000/hr` as a baseline regardless of plan.

**Citation**: [API request limits – Atlassian Support](https://support.atlassian.com/bitbucket-cloud/docs/api-request-limits/)

---

### 9. Issue tracker is being sunset — doc does not mention this (§4, §5, §11)

**What the doc says**  
The doc describes the Bitbucket issue tracker as a first-class, production-viable integration target with no caveats.

**What is actually correct**  
Atlassian has announced the sunset of Bitbucket Issues and Wikis:
- **April 2026**: New repositories can no longer enable the issue tracker.
- **Mid-August 2026**: Existing issues will be fully removed.

Given today's date (2026-04-18), the feature is already past the new-enablement cutoff. This is a significant constraint that must be documented. Any SupportAgent connector relying on Bitbucket Issues is writing to a feature with a ~4-month remaining lifespan.

The MVP and Phase 2 scopes in §11 list several issue endpoints as priorities — these should be deprioritised or replaced with a Jira connector integration note.

**Citation**: [Announcing sunset of Bitbucket Issues and Wikis – Atlassian Community](https://community.atlassian.com/forums/Bitbucket-articles/Announcing-sunset-of-Bitbucket-Issues-and-Wikis/ba-p/3193882)

---

### 10. Data Center issue status update uses invented endpoint pattern (§4.6)

**What the doc says**  
```
PUT /rest/api/latest/projects/{projectKey}/repos/{repo}/issues/{issueId}
{
  "state": { "id": 3 }
}
```

**What is actually correct**  
Bitbucket Data Center does not have a built-in issue tracker endpoint at `/rest/api/latest/projects/.../issues/`. The Data Center REST API does not expose an issue tracker resource under the standard `/rest/api/` path. The Data Center issue tracker (if enabled) has a separate REST surface that is not documented in the standard API reference. This endpoint path appears to be fabricated or confused with another product (possibly Jira Data Center).

**Citation**: [Bitbucket Data Center REST API reference](https://developer.atlassian.com/server/bitbucket/rest/v1002/) — no `/issues` resource listed under project/repo paths.

---

### 11. Issue comment path in §11 MVP list is correct but comment on the Change endpoint is missing

**What the doc says**  
The MVP list includes `PUT` for issue comments but does not include `DELETE /issues/{id}/comments/{comment_id}`.

**What is actually correct**  
`DELETE /2.0/repositories/{workspace}/{repo}/issues/{id}/comments/{comment_id}` exists and is documented. The doc does include it in §4 (Delete Comment) but the §11 MVP endpoint list is missing it:

```
DELETE /2.0/repositories/{workspace}/{repo}/issues/{id}/comments/{comment_id}
```

Also missing from the MVP list but present in the API:
```
POST /2.0/repositories/{workspace}/{repo}/issues/{id}/changes
```
This is how you transition issue state via the Changes endpoint (as opposed to inline PUT on the issue). It provides an audit trail. The `PUT` approach does also work for state changes but the Changes endpoint is the preferred pattern.

**Citation**: [Bitbucket Cloud REST API – Issue Tracker](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-issue-tracker/)

---

### 12. `POST /2.0/user` listed as "Verify token" endpoint (§11 MVP)

**What the doc says**  
```
POST /2.0/user   # Verify token
```

**What is actually correct**  
The endpoint for retrieving the current authenticated user is `GET /2.0/user`, not `POST /2.0/user`. There is no POST on `/2.0/user`. Token verification is done via `GET /2.0/user` — a successful 200 response confirms the token is valid.

**Citation**: [Bitbucket Cloud REST API – Users](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-users/#api-user-get)

---

### 13. PR decline body field is not valid (§4.10)

**What the doc says**  
```json
POST /2.0/repositories/{workspace}/{repo}/pullrequests/{pull_request_id}/decline
{
  "message": "Declined by SupportAgent"
}
```

**What is actually correct**  
The decline endpoint does not accept a `message` field in the body. The body should be empty or omitted entirely. If a decline reason is needed, it must be posted as a comment separately before declining. Sending a body to the decline endpoint may cause a `400` error.

**Citation**: [Bitbucket Cloud REST API – Pull Requests decline](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/#api-repositories-workspace-repo-slug-pullrequests-pull-request-id-decline-post)

---

## Items Verified as Correct

- `POST /2.0/repositories/{workspace}/{repo}/pullrequests` — method and path correct; `title` and `source` required.
- `PUT /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments/{comment_id}` — method, path, body (`content.raw`) correct.
- `DELETE` on PR comments — method and path correct.
- `POST`/`DELETE` on `/approve` — correct for approve/unapprove.
- `POST`/`DELETE` on `/resolve` for comment threads — confirmed present in the API.
- `POST`/`DELETE` on `/request-changes` (doc calls it `/request_change`) — underlying capability exists; note the actual event key is `pullrequest:changes_request_created` not `request_change`.
- Data Center PR comment body uses `text` (not `content.raw`) — correct per DC API.
- Data Center edit comment requires `version` field in body — correct.
- Issue `assignee` field uses `{ "uuid": "..." }` for Cloud — correct.
- Pagination: Cloud uses `page`/`pagelen`, DC uses `start`/`limit` — correct.
- `GET /2.0/user/emails` requires `account:read` + `email` scope — correct.
- `POST /2.0/repositories/{workspace}/{repo}/issues/{id}/attachments` with multipart — correct path and method.
- Issue `kind` enum (`bug`, `enhancement`, `proposal`, `task`, `question`) — correct.
- Issue `priority` enum (`trivial`, `minor`, `major`, `critical`, `blocker`) — correct.
