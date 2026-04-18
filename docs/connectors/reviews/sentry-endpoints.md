# Sentry Connector — API Endpoint Surface Review

**Reviewer**: Claude Code audit
**Source**: `docs/connectors/sentry.md`
**Scope**: HTTP methods, paths, request bodies, response shapes, parameter names. Auth/scope verification excluded per charter.

---

## Verdict: APPROVED WITH CORRECTIONS

The document is largely accurate. Three specific corrections are needed before this can be used as an implementation reference.

---

## Findings

### 1. `[MAJOR]` Wrong endpoint path for listing org members

**Affected**: §7 (Identity Mapping) — `/api/0/organizations/{org}/users/`

**Doc says**: `GET /api/0/organizations/{org}/users/`

**Actually correct**: `GET /api/0/organizations/{organization_id_or_slug}/members/`

**Evidence**: Confirmed via [docs.sentry.io/api/organizations/list-an-organizations-members/](https://docs.sentry.io/api/organizations/list-an-organizations-members/) — the endpoint is `members`, not `users`.

**Also**: Wrong required scope in §2 table. The doc says `org:read` for listing members, but the official docs require `member:admin | member:read | member:write`. The `org:read` scope is for projects and teams, not member enumeration.

**Fix**: Update path to `/api/0/organizations/{org}/members/` and scope to `member:read`. Also update the MVP endpoints table in §11 which uses the incorrect path.

---

### 2. `[MAJOR]` Tag `POST` endpoint does not exist

**Affected**: §4g (Add/Remove Tags) — `POST /api/0/issues/{issue_id}/tags/{tag_key}/`

**Doc says**: `POST /api/0/issues/{issue_id}/tags/{tag_key}/` with body `{ "value": "production" }` sets a tag value.

**Actually correct**: No such POST endpoint exists. The `GroupTagKeyDetailsEndpoint` (mounted at `/issues/{issue_id}/tags/{key}/`) only supports `GET`. No `POST`, `PUT`, or `PATCH` method exists for setting tag values via the REST API.

**Evidence**: Confirmed from Sentry's open-source codebase (`src/sentry/issues/endpoints/group_tagkey_details.py`). The endpoint class defines only `publish_status = { "GET": ApiPublishStatus.PUBLIC }`. The tagstore backend has no `set_tag_value` method — tags are set by the SDK when events are ingested, not through the API.

**Impact**: If SupportAgent tries to `POST` to this endpoint, it will receive a 405 Method Not Allowed. Tag-based automation in §4g, §6 (Trigger Matrix), and Phase 2 (§11) that relies on setting tag values is not possible.

**Fix**: Remove the `POST /api/0/issues/{issue_id}/tags/{tag_key}/` endpoint from the document. Replace with a note that Sentry tags cannot be set via API — they are derived from SDK event payloads. Add a `GET /api/0/issues/{issue_id}/tags/{key}/values/` endpoint for reading tag values. Remove Phase 2's "Full tag CRUD" line.

---

### 3. `[MINOR]` GET issue detail path is ambiguous but valid

**Affected**: §4a example response, §10e, §11 (MVP endpoints table)

**Doc says**: `GET /api/0/issues/{issue_id}/`

**Actually correct**: This path is valid. The `GroupDetailsEndpoint` is mounted at both `/api/0/issues/{issue_id}/` (top-level) and `/api/0/organizations/{org}/issues/{issue_id}/` (org-scoped). Both return identical responses.

**Evidence**: Confirmed from Sentry's URL routing (`src/sentry/api/urls.py`). The `create_group_urls` function is included at both `r"^(?:issues|groups)/"` (top-level) and `r"^(?P<organization_id_or_slug>[^/]+)/(?:issues|groups)/"` (org-scoped).

**Note**: The official Sentry API docs at [docs.sentry.io/api/events/retrieve-an-issue/](https://docs.sentry.io/api/events/retrieve-an-issue/) document the org-scoped path. Either form works; the doc's choice is acceptable but the org-scoped form is the officially documented one.

**Fix**: Optional — prefer the org-scoped form `GET /api/0/organizations/{org}/issues/{issue_id}/` for consistency with the rest of the document and alignment with official docs.

---

### 4. `[CORRECT]` Comment endpoints — path verified

**Doc says**: `POST /api/0/issues/{issue_id}/comments/`, `PUT /api/0/issues/{issue_id}/comments/{comment_id}/`, `DELETE /api/0/issues/{issue_id}/comments/{comment_id}/`

**Actually correct**: Confirmed from Sentry URL routing (`src/sentry/api/urls.py`):

```
r"^(?P<issue_id>[^/]+)/(?:notes|comments)/$"          → GroupNotesEndpoint
r"^(?P<issue_id>[^/]+)/(?:notes|comments)/(?P<note_id>[^/]+)/$" → GroupNotesDetailsEndpoint
```

Both `notes` and `comments` are accepted as URL components. The doc uses `comments` which is valid.

The `GroupNotesEndpoint` supports `GET` (list) and `POST` (create). `GroupNotesDetailsEndpoint` supports `PUT` (update) and `DELETE`. Response shapes match the documented examples.

---

### 5. `[CORRECT]` Tag read endpoints — verified

**Doc says**: `GET /api/0/issues/{issue_id}/tags/` and `GET /api/0/issues/{issue_id}/tags/{key}/values/`

**Actually correct**: Confirmed from URL routing:

```
r"^(?P<issue_id>[^/]+)/tags/$"                           → GroupTagsEndpoint
r"^(?P<issue_id>[^/]+)/tags/(?P<key>[^/]+)/$"          → GroupTagKeyDetailsEndpoint
r"^(?P<issue_id>[^/]+)/tags/(?<key>[^/]+)/values/$"    → GroupTagKeyValuesEndpoint
```

---

### 6. `[CORRECT]` Update issue endpoint — verified

**Doc says**: `PUT /api/0/organizations/{org}/issues/{issue_id}/` with body fields `status`, `assignedTo`, `priority`

**Actually correct**: Confirmed from [docs.sentry.io/api/events/update-an-issue/](https://docs.sentry.io/api/events/update-an-issue/). The official docs list the same path and body parameters. The doc accurately captures `status`, `assignedTo`, `statusDetails`, and `priority` as valid fields.

**Additional fields** (not mentioned in doc but supported): `inbox` (boolean), `hasSeen` (boolean), `isBookmarked` (boolean), `isPublic` (boolean), `isSubscribed` (boolean), `substatus` (string). None of these are required for MVP but could be documented.

---

### 7. `[CORRECT]` Bulk update endpoint — verified

**Doc mentions**: `PUT /api/0/organizations/{org}/issues/` in Phase 2

**Actually correct**: Confirmed from [docs.sentry.io/api/events/bulk-mutate-an-organizations-issues/](https://docs.sentry.io/api/events/bulk-mutate-an-organizations-issues/). Path is correct, method is `PUT`, supports `id` (array of issue IDs) as a required query/body param. `status`, `assignedTo`, `priority`, `substatus` are all valid body params.

---

### 8. `[CORRECT]` List issues endpoint — verified

**Doc says**: `GET /api/0/organizations/{organization_slug}/issues/` with query params `query`, `statsPeriod`, `cursor`, `shortIdLookup`

**Actually correct**: Confirmed from [docs.sentry.io/api/events/list-an-organizations-issues/](https://docs.sentry.io/api/events/list-an-organizations-issues/). Path, query params, and scopes (`event:admin | event:read | event:write`) are all correct.

**Additional params** (not listed but available): `environment`, `project`, `groupStatsPeriod`, `start`, `end`, `viewId`, `sort`, `limit`, `expand`, `collapse`. None are required for MVP.

---

### 9. `[CORRECT]` List projects endpoint — verified

**Doc says**: `GET /api/0/organizations/{org}/projects/`

**Actually correct**: Confirmed from [docs.sentry.io/api/organizations/list-an-organizations-projects/](https://docs.sentry.io/api/organizations/list-an-organizations-projects/). Path and scopes (`org:admin | org:read | org:write`) are correct.

---

### 10. `[CORRECT]` List teams endpoint — verified

**Doc says**: Teams listing requires `team:read` scope (in §2 scope table).

**Actually correct**: Confirmed from [docs.sentry.io/api/teams/list-an-organizations-teams/](https://docs.sentry.io/api/teams/list-an-organizations-teams/). The endpoint is `GET /api/0/organizations/{org}/teams/` and scopes are `org:admin | org:read | org:write`. The doc's `team:read` scope is not correct for this endpoint — it should be `org:read`. However this is a minor scope table discrepancy excluded from this review's scope, so no change required unless auth reviewer flags it.

---

### 11. `[CORRECT]` Delete issue endpoint — verified

**Doc says**: `DELETE /api/0/issues/{issue_id}/` with scope `event:admin`

**Actually correct**: The `GroupDetailsEndpoint` has a `delete` method available at both `/api/0/issues/{issue_id}/` (top-level) and `/api/0/organizations/{org}/issues/{issue_id}/` (org-scoped). Publish status is `PRIVATE`. Scope `event:admin` is correct per the codebase.

---

### 12. `[CORRECT]` List issue events endpoint — verified

**Doc says**: `GET /api/0/issues/{issue_id}/events/`

**Actually correct**: Available via `GroupEventsEndpoint` mounted at `r"^(?P<issue_id>[^/]+)/events/$"` in both top-level and org-scoped URL patterns.

---

### 13. `[CORRECT]` Attach file endpoint — correctly marked as unsupported

**Doc says**: Not supported via API.

**Correct**: No file attachment upload endpoint exists on the issue resource. File attachments in Sentry use DSN upload (direct ingestion path), not the REST API. This is correctly identified as N/A.

---

## Summary Table

| Capability | Doc Endpoint | Status |
|---|---|---|
| List issues | `GET /api/0/organizations/{org}/issues/` | ✓ Correct |
| Get issue | `GET /api/0/issues/{issue_id}/` | ✓ Valid (org-scoped preferred) |
| Update issue | `PUT /api/0/organizations/{org}/issues/{id}/` | ✓ Correct |
| Delete issue | `DELETE /api/0/issues/{id}/` | ✓ Correct |
| List comments | `GET /api/0/issues/{id}/comments/` | ✓ Correct |
| Post comment | `POST /api/0/issues/{id}/comments/` | ✓ Correct |
| Edit comment | `PUT /api/0/issues/{id}/comments/{cid}/` | ✓ Correct |
| Delete comment | `DELETE /api/0/issues/{id}/comments/{cid}/` | ✓ Correct |
| List tags | `GET /api/0/issues/{id}/tags/` | ✓ Correct |
| Get tag values | `GET /api/0/issues/{id}/tags/{key}/values/` | ✓ Correct |
| Set tag value | `POST /api/0/issues/{id}/tags/{key}/` | ✗ Does not exist |
| List projects | `GET /api/0/organizations/{org}/projects/` | ✓ Correct |
| List org members | `GET /api/0/organizations/{org}/users/` | ✗ Wrong path (should be `/members/`) |
| List teams | `GET /api/0/organizations/{org}/teams/` | ✓ Correct |
| Bulk update | `PUT /api/0/organizations/{org}/issues/` | ✓ Correct |
| List events | `GET /api/0/issues/{id}/events/` | ✓ Correct |
| Assign user | via `assignedTo` in PUT body | ✓ Correct |
| Set priority | via `priority` in PUT body | ✓ Correct |
| Set status | via `status` in PUT body | ✓ Correct |
| Attach file | N/A | ✓ Correct (does not exist) |

---

## Required Changes

1. **Fix §7 and §11**: Change `/api/0/organizations/{org}/users/` → `/api/0/organizations/{org}/members/`. Change scope from `org:read` → `member:read`.

2. **Remove §4g POST tag endpoint**: Delete the `POST /api/0/issues/{issue_id}/tags/{tag_key}/` entry. Add a note that tag values cannot be set via the REST API.

3. **Update §6 (Trigger Matrix)**: Remove any trigger references that assume tag values can be written via API.

4. **Update §11 Phase 2**: Remove "Full tag CRUD" line and `POST /api/0/issues/{issue_id}/tags/{key}/` endpoint.

5. **Optional**: Standardize on org-scoped paths (`/api/0/organizations/{org}/issues/{id}/`) for all endpoints for consistency with official documentation.
