# Crashlytics Connector Endpoint Audit

**Verdict:** Needs correction — 1 critical path error, 1 missing write API nuance, several incomplete field lists

---

## Findings

### 1. Error Reporting API list endpoint — WRONG PATH

**Affected:** Section 3, Error Reporting API / Section 9 Pagination

**Doc says:**
```
GET /v1beta1/projects/{projectId}/groups?pageSize=100&pageToken={token}
```

**What is actually correct:**
```
GET /v1beta1/{projectName=projects/*}/groupStats
```

**Details:** The Error Reporting API does not have a `/groups` collection endpoint. The correct endpoint for listing error groups (with statistics) is `/groupStats`. The path parameter must use the resource-name pattern `{projectName=projects/*}`, not a simple `{projectId}`.

Query parameters that are actually supported:
- `pageSize` (int, default 20, max 100)
- `pageToken` (string)
- `groupId[]` (string[], filter by specific group IDs)
- `serviceFilter` (object, filter by service context)
- `timeRange` (object, e.g., `{"period": "PERIOD_24_HOUR"}`)
- `order` (enum, default `COUNT_DESC`)
- `timedCountDuration` (string, e.g., `"3600s"`)
- `alignment` (enum)
- `alignmentTime` (string)

**Citation:** [Cloud Error Reporting API v1beta1 reference](https://docs.cloud.google.com/error-reporting/reference/rest/v1beta1/projects.groupStats/list)

---

### 2. Error Reporting API has a write endpoint — doc is incomplete

**Affected:** Section 4 (Outbound — Writing Back)

**Doc says:**
> **Not supported.** Crashlytics has no write API.
> No create issue endpoint. No status transition endpoint. No close/resolve endpoint.

**What is actually correct:**

The **Cloud Error Reporting API** (which is the underlying API for Crashlytics data) **does have a write endpoint**:

```
PUT /v1beta1/{group.name=projects/*/groups/*}
```

This can update an `ErrorGroup` resource, including the `resolutionStatus` field:
- `RESOLUTION_STATUS_UNSPECIFIED`
- `OPEN`
- `ACKNOWLEDGED`
- `RESOLVED`
- `MUTED`

**Important caveats:**
- This updates the Error Reporting view, not directly the Crashlytics console UI
- It's unclear whether Crashlytics-specific issue states sync back from Error Reporting updates
- Crashlytics does NOT expose: create issue, post comment, add label, assign user, attach file

**Recommendation:** The connector design should clarify the distinction:
1. Crashlytics has no public write API for creating/labeling/assigning
2. The underlying Error Reporting API CAN set resolution status, but this may not propagate to Crashlytics UI

**Citation:** [Cloud Error Reporting API — groups.update](https://docs.cloud.google.com/error-reporting/reference/rest/v1beta1/projects.groups/update)

---

### 3. Missing get-group-by-id endpoint

**Affected:** Section 3 (Error Reporting API read operations)

**Doc does not document:**
```
GET /v1beta1/{groupName=projects/*/groups/*}
```

This returns a single `ErrorGroup` with fields:
- `name` (string)
- `groupId` (string)
- `resolutionStatus` (enum)
- `trackingIssues[]` (array of `{url: string}`)

This is useful for getting detailed info about a single issue.

**Citation:** [Cloud Error Reporting API — groups.get](https://docs.cloud.google.com/error-reporting/reference/rest/v1beta1/projects.groups/get)

---

### 4. Missing events.list endpoint

**Affected:** Section 3 (Error Reporting API read operations)

**Doc does not document:**
```
GET /v1beta1/{projectName=projects/*}/events
```

This returns individual error events for a group. Useful for getting event-level details.

Query parameters:
- `groupId` (required string)
- `serviceFilter` (optional)
- `timeRange` (optional)
- `pageSize` (optional, default 20)
- `pageToken` (optional)

**Citation:** [Cloud Error Reporting API — events.list](https://docs.cloud.google.com/error-reporting/reference/rest/v1beta1/projects.events/list)

---

### 5. BigQuery schema — incomplete field list

**Affected:** Section 3B, Table of BigQuery fields

**Doc lists:** `issue_id`, `event_timestamp`, `error_type`, `platform`, `application.display_version`, `device.manufacturer`, `device.model`, `custom_keys`, `exceptions.type`, `error.title`, `user.id`

**Additional important fields available in the schema:**
- `event_id` (STRING) — unique per event
- `variant_id` (STRING) — for A/B testing variants
- `crashlytics_sdk_versions` (STRING)
- `installation_uuid` (STRING)
- `firebase_session_id` (STRING)
- `application.build_version` (STRING) — distinct from display_version
- `device.architecture` (STRING)
- `device.orientation` (STRING)
- `app_orientation` (STRING)
- `operating_system.name`, `operating_system.display_version`, `operating_system.type`
- `memory.free`, `memory.used`, `storage.free`, `storage.used`
- `threads` (REPEATED RECORD) — per-thread stack traces
- `breadcrumbs` (REPEATED RECORD) — user navigation breadcrumbs
- `logs` (REPEATED RECORD) — crash-associated log messages
- `user.email` (deprecated but still present), `user.name` (deprecated but still present)

**Citation:** [Firebase Crashlytics BigQuery schema](https://firebase.google.com/docs/crashlytics/bigquery-dataset-schema)

---

### 6. Firebase Alerts — alertType name is correct

**Verified correct:** All documented alert types match Firebase's documented event types:
- `crashlytics.newAnomalousIssue`
- `crashlytics.newIssue`
- `crashlytics.regression`
- `crashlytics.velocityAlert`
- `crashlytics.newRateThresholdFatal`
- `crashlytics.newRateThresholdNonfatal`
- `crashlytics.stalenessAlert`

The payload shape (issueId, issueTitle, platform, bundleId, priority, etc.) is accurate.

**Citation:** [Firebase Crashlytics Alerts documentation](https://firebase.google.com/docs/crashlytics)

---

### 7. BigQuery table naming — correct

**Verified correct:** Table names follow the pattern `{bundle_identifier}` with dots converted to underscores and `_ANDROID` or `_IOS` suffix appended:
- `com_example_myapp_ANDROID`
- `com_example_myapp_IOS`
- `com_example_myapp_REALTIME` (for streaming)
- `com_example_myapp_IOS_REALTIME` (for iOS streaming)

**Citation:** [Firebase Crashlytics BigQuery export](https://firebase.google.com/docs/crashlytics/bigquery-export)

---

### 8. `is_fatal` deprecation notice — correct

**Verified correct:** The doc correctly notes that `is_fatal` is deprecated and `error_type` (FATAL / NON_FATAL / ANR) should be used instead.

---

### 9. No-outbound capability claim — correct for Crashlytics scope

**Confirmed accurate:** Crashlytics has no endpoints for:
- Create issue
- Post comment (no comments on Crashlytics issues)
- Edit comment
- Delete comment
- Add/remove label or tag
- Assign/mention user (no user concept in Crashlytics)
- Attach file/screenshot (not via API)

The Error Reporting API's `updateGroup` with `resolutionStatus` is a partial exception (see finding #2), but the practical impact is unclear.

---

## Summary of Required Changes

| Priority | Finding | Action Required |
|----------|--------|-----------------|
| **Critical** | Wrong Error Reporting list path | Change `/groups` to `/groupStats` |
| **High** | Missing resolution status write capability | Clarify Error Reporting API vs Crashlytics distinction |
| **Medium** | Missing get-group endpoint | Add `GET /v1beta1/{groupName=projects/*/groups/*}` |
| **Medium** | Missing events.list endpoint | Add `GET /v1beta1/{projectName=projects/*}/events` |
| **Low** | Incomplete BigQuery field list | Add missing fields (event_id, variant_id, etc.) |

---

## Capabilities Not Available (Correctly Documented)

The following capabilities are correctly identified as non-existent:
- Create issue
- Post/edit/delete comment
- Label/tag management
- User assignment
- File/screenshot attachment
- Status transition API (beyond Error Reporting's partial resolution status)

These are accurate — there is no Crashlytics-specific API for these operations.
