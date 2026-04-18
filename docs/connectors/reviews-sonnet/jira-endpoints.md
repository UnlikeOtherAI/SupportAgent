# Jira Connector — Endpoint Coverage Review

**Reviewer:** Sonnet endpoint audit
**Source doc:** `docs/connectors/jira.md`
**Date:** 2026-04-18

## Verdict

**MOSTLY CORRECT — 4 bugs, 3 gaps, 2 minor inaccuracies.**

The document covers the endpoint surface well. Core CRUD, comments, transitions, labels, priority, assignment, and attachments are all present. Versioning is consistent at `/rest/api/3/`. Several specific issues need fixing before implementation.

---

## Findings

### BUG — List Issues: wrong endpoint in Section 11 MVP list

- **Capability:** List issues / JQL search
- **What the doc says (§11 MVP):** `GET /rest/api/3/search`
- **What is actually correct:** `GET /rest/api/3/search/jql` — the dedicated JQL search endpoint introduced in v3. The legacy `/rest/api/3/search` also exists but is parameterized differently and is being soft-deprecated in favor of `/search/jql`. Section 9.3 of the same doc correctly lists `/rest/api/3/search/jql`; Section 11 contradicts it.
- **Citation:** https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-get

---

### BUG — Polling fallback endpoint mismatch

- **Capability:** Polling / reconciliation search
- **What the doc says (§3.1 Polling Fallback):** `GET /rest/api/3/search/jql` with query param `nextPageToken` alongside `startAt`
- **What is actually correct:** `nextPageToken` and `startAt` are mutually exclusive pagination strategies. When using cursor pagination (`nextPageToken`), you omit `startAt`. When using offset pagination, you use `startAt` and omit `nextPageToken`. Mixing both in the same example is misleading and will cause API errors in practice. Section 9.1 also incorrectly shows them combined in the same URL.
- **Citation:** https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-get (see `nextPageToken` vs `startAt` parameter docs)

---

### BUG — Unassign user body uses deprecated `name` field

- **Capability:** Assign / unassign user
- **What the doc says (§4.8):**
  ```json
  { "fields": { "assignee": { "name": null } } }
  ```
- **What is actually correct:** In Jira Cloud v3, `name` is deprecated. The correct way to unassign is:
  ```json
  { "fields": { "assignee": null } }
  ```
  Setting `assignee` to `null` directly (not wrapping in an object with `name: null`) is the documented v3 pattern. The `name` field is not valid in Cloud v3 user objects.
- **Citation:** https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-put — `assignee` field accepts `null` directly

---

### BUG — Post comment body has invalid JSON syntax

- **Capability:** Post comment
- **What the doc says (§4.2):** The mention node in the ADF example body uses unquoted key syntax:
  ```json
  { "type": "mention", attrs: { "id": "accountId", "text": "@username" } }
  ```
- **What is actually correct:** `attrs` must be a quoted key. The JSON is syntactically invalid as written. Correct form:
  ```json
  { "type": "mention", "attrs": { "id": "accountId", "text": "@username" } }
  ```
  Appendix C has the correct syntax; Section 4.2 does not.
- **Citation:** Standard JSON specification; Appendix C of this same doc is correct

---

### GAP — No `GET /rest/api/3/issue/{issueIdOrKey}` documented in the body

- **Capability:** Get one issue by ID
- **What the doc says:** The endpoint appears only implicitly in the Appendix A client snippet and in §11 MVP list, but is never given a dedicated section in the Outbound or any numbered section the way create, comment, transition, etc. are.
- **What is correct:** This is a first-class endpoint that needs its own documented entry (HTTP method, path, useful query params such as `fields`, `expand`, and response shape).
- **Citation:** https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-get

---

### GAP — No `GET /rest/api/3/issue/{issueIdOrKey}/comment` section

- **Capability:** List comments on an issue
- **What the doc says:** Listed in §11 MVP as `GET /rest/api/3/issue/{key}/comment` but has no dedicated section documenting the endpoint, query params (`startAt`, `maxResults`, `orderBy`, `expand`), or response shape.
- **What is correct:** Needs a section alongside 4.2–4.4. The `orderBy` param (default `created` ASC) and pagination params are relevant for implementation.
- **Citation:** https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/#api-rest-api-3-issue-issueidorkey-comment-get

---

### GAP — Edit issue (PUT) endpoint has no standalone section

- **Capability:** Edit / patch issue fields
- **What the doc says:** Sections 4.6, 4.7, and 4.8 each show `PUT /rest/api/3/issue/{issueIdOrKey}` for labels, priority, and assignee respectively, but there is no consolidated section describing the general edit endpoint: required headers, the `fields` vs `update` body distinction, version/conflict behavior (no ETag/optimistic locking in Jira), and the `notifyUsers` query param.
- **What is correct:** The general `PUT /rest/api/3/issue/{issueIdOrKey}` should have a base section that the label/priority/assign sections reference. This avoids repeating path info and makes it clear that all three can be batched into one call.
- **Citation:** https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-put

---

### INACCURACY — `createmeta` endpoint deprecation not noted

- **Capability:** Get create metadata / available fields
- **What the doc says (§4.1, §5.2, §11):** `GET /rest/api/3/issue/createmeta` — used as the way to discover available fields.
- **What is actually correct:** `GET /rest/api/3/issue/createmeta` was deprecated in Jira Cloud. The replacement endpoints are `GET /rest/api/3/issue/createmeta/{projectIdOrKey}/issuetypes` and `GET /rest/api/3/issue/createmeta/{projectIdOrKey}/fields`. Calling the old endpoint still works today but carries a deprecation warning. The doc should note this and prefer the new paginated form.
- **Citation:** https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-createmeta-get (deprecation notice at top of page)

---

### INACCURACY — Webhook registration path inconsistency

- **Capability:** Register webhook
- **What the doc says:**
  - §3.1 body: `POST /rest/webhooks/1.0/webhook`
  - §11 MVP list: `POST /rest/api/3/webhooks/1.0/webhook` (prefixed with `/rest/api/3/`)
- **What is actually correct:** The admin webhook path is `/rest/webhooks/1.0/webhook` (no `/api/3/` prefix). The §11 listing adds a spurious `/rest/api/3/` prefix that would produce a 404. The §3.1 version is correct.
- **Citation:** https://developer.atlassian.com/cloud/jira/platform/webhooks/#registering-a-webhook

---

## What Is Correct

The following capabilities are accurately documented and can be used as-is:

- `POST /rest/api/3/issue` — create issue (§4.1): method, path, required fields, ADF body shape all correct
- `PUT /rest/api/3/issue/{issueIdOrKey}/comment/{commentId}` — edit comment (§4.3): correct
- `DELETE /rest/api/3/issue/{issueIdOrKey}/comment/{commentId}` — delete comment (§4.4): correct
- `GET + POST /rest/api/3/issue/{issueIdOrKey}/transitions` — status transition two-step (§4.5): correct; the two-step pattern is the only correct way
- `PUT /rest/api/3/issue/{issueIdOrKey}` for labels (§4.6): `update.labels` with `add`/`remove` ops is correct
- `PUT /rest/api/3/issue/{issueIdOrKey}` for priority (§4.7): both `id` and `name` forms documented correctly
- `POST /rest/api/3/issue/{issueIdOrKey}/attachments` with `X-Atlassian-Token: no-check` (§4.11): correct
- ADF mention node in Appendix C: correct (the §4.2 inline copy has the JSON bug noted above)
- `GET /rest/api/3/user?accountId=...` for user resolution (§7.2): correct
- `DELETE /rest/webhooks/1.0/webhook/{id}` — the §11 path has the same spurious prefix bug as registration, but the concept is correct
- `POST /rest/api/3/comment/list` for batch comment fetch by IDs (§9.3): correct; this is a real endpoint

---

## Summary Table

| # | Severity | Section | Issue |
|---|----------|---------|-------|
| 1 | Bug | §11 MVP | `/search` vs `/search/jql` inconsistency |
| 2 | Bug | §3.1, §9.1 | `nextPageToken` and `startAt` shown together (mutually exclusive) |
| 3 | Bug | §4.8 | Unassign uses deprecated `name: null` instead of `assignee: null` |
| 4 | Bug | §4.2 | `attrs` key unquoted in ADF mention example — invalid JSON |
| 5 | Gap | — | Get-one-issue endpoint has no dedicated documented section |
| 6 | Gap | — | List-comments endpoint has no dedicated documented section |
| 7 | Gap | — | General edit-issue PUT has no consolidated section |
| 8 | Inaccuracy | §4.1, §5.2, §11 | `createmeta` deprecated; newer paginated endpoints not mentioned |
| 9 | Inaccuracy | §11 | Webhook register/delete paths have spurious `/api/3/` prefix |
