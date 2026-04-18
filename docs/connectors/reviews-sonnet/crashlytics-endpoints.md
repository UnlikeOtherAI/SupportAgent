# Crashlytics Connector — Endpoint Coverage Review

**Verdict: PASS with significant caveats.** The doc correctly identifies Crashlytics as a read-only, no-write-API platform, which eliminates most of the standard endpoint checklist by design. However, several endpoint paths and payload field names documented under the Error Reporting API and Firebase Alerts sections are inaccurate or misleading and need correction.

---

## Findings

### 1. Alert event type names are wrong — several do not exist in the official API

**Affected section:** Section 3A, Table of alert event names; Section 6 Triggers table.

**What the doc says:**

| Alert event name | Trigger |
|---|---|
| `crashlytics.newAnomalousIssue` | First occurrence of a new crash pattern (anomaly detected) |
| `crashlytics.newIssue` | New crash/ANR that has been seen before (non-anomalous) |
| `crashlytics.velocityAlert` | Crash impacts ≥N% of sessions |
| `crashlytics.newRateThresholdFatal` | Fatal crash rate exceeds threshold |
| `crashlytics.newRateThresholdNonfatal` | Non-fatal crash rate exceeds threshold |
| `crashlytics.stalenessAlert` | No new events on an issue for N days |

**What is actually correct:**

The complete official list of Crashlytics alert event type strings, as documented in the Firebase Functions reference and confirmed via the Eventarc trigger documentation, is:

| Correct event type string | Description |
|---|---|
| `crashlytics.newFatalIssue` | New fatal crash not previously seen |
| `crashlytics.newNonfatalIssue` | New non-fatal error not previously seen |
| `crashlytics.newAnrIssue` | New ANR error not previously seen |
| `crashlytics.regression` | Crash on issue previously marked closed |
| `crashlytics.stabilityDigest` | Notification of top trending issues |
| `crashlytics.velocity` | Single issue causing significant session crashes |
| `crashlytics.missingSymbolFile` | No debug symbols to symbolicate a crash report |

None of the following event types in the doc exist in any official Firebase or GCP documentation:
- `crashlytics.newAnomalousIssue` — not a real event type; the closest analog is `crashlytics.newFatalIssue` or `crashlytics.newAnrIssue`
- `crashlytics.newIssue` — not a real event type
- `crashlytics.velocityAlert` — the correct name is `crashlytics.velocity`
- `crashlytics.newRateThresholdFatal` — does not exist in official docs
- `crashlytics.newRateThresholdNonfatal` — does not exist in official docs
- `crashlytics.stalenessAlert` — does not exist in official docs

**Citation:** [Firebase Alerts Triggers — Cloud Functions for Firebase](https://firebase.google.com/docs/functions/alert-events); [Route Firebase Alerts events to Cloud Run — Eventarc](https://cloud.google.com/eventarc/docs/run/route-trigger-firebase-alerts); [firebase-functions v6.3.2 crashlytics.d.ts](https://app.unpkg.com/firebase-functions@6.3.2/files/lib/v2/providers/alerts/crashlytics.d.ts)

---

### 2. Alert payload fields are substantially incorrect

**Affected section:** Section 3A, "Payload shape (Cloud Events v2 format via Eventarc)", and the `data.payload` block.

**What the doc says:**

```json
"payload": {
  "issueId": "fabc123def456",
  "issueTitle": "...",
  "firstVersion": "4.2.0",
  "latestVersion": "4.3.1",
  "platform": "IOS",
  "bundleId": "com.example.myapp",
  "crashCount": 1,
  "impactedSessions": 47,
  "impactedDevices": 44,
  "unaffectedDevices": 312,
  "timestamp": "2026-04-18T10:30:00Z",
  "priority": "HIGH"
}
```

**What is actually correct:**

The actual payload shapes differ significantly by alert type. Per the official TypeScript type definitions in `firebase-functions`:

**For `crashlytics.newFatalIssue`, `crashlytics.newNonfatalIssue`, `crashlytics.newAnrIssue`:**
```json
{
  "@type": "type.googleapis.com/google.events.firebase.firebasealerts.v1.CrashlyticsNewFatalIssuePayload",
  "issue": {
    "id": "...",
    "title": "...",
    "subtitle": "...",
    "appVersion": "..."
  }
}
```

**For `crashlytics.velocity`:**
```json
{
  "@type": "type.googleapis.com/google.events.firebase.firebasealerts.v1.CrashlyticsVelocityAlertPayload",
  "issue": { "id": "...", "title": "...", "subtitle": "...", "appVersion": "..." },
  "createTime": "...",
  "crashCount": 42,
  "crashPercentage": 4.7,
  "firstVersion": "4.2.0"
}
```

**For `crashlytics.regression`:**
```json
{
  "@type": "type.googleapis.com/google.events.firebase.firebasealerts.v1.CrashlyticsRegressionAlertPayload",
  "type": "fatal",
  "issue": { "id": "...", "title": "...", "subtitle": "...", "appVersion": "..." },
  "resolveTime": "..."
}
```

The following fields documented in the doc **do not exist** in the official SDK payload types:
- `issueId` — the correct field path is `issue.id`
- `issueTitle` — the correct field path is `issue.title`
- `latestVersion` — not present in any payload type
- `platform` — not present in alert payload (present in BigQuery export only)
- `bundleId` — not in alert payload; `appId` is at the event level, not in `payload`
- `impactedSessions` — not a real field; the velocity payload uses `crashCount` (number of sessions) and `crashPercentage` (percentage of sessions)
- `impactedDevices` — not a real field
- `unaffectedDevices` — not a real field
- `timestamp` — not a real payload field
- `priority` — not a real field; Crashlytics does not emit a priority value in alert payloads

The `appId` field is real but it belongs at the event top level (`event.appId`), not inside `data.payload`.

**Citation:** [firebase-functions v6.3.2 crashlytics.d.ts](https://app.unpkg.com/firebase-functions@6.3.2/files/lib/v2/providers/alerts/crashlytics.d.ts); [Firebase Alerts Triggers](https://firebase.google.com/docs/functions/alert-events)

---

### 3. CloudEvent `type` string is wrong

**Affected section:** Section 3A, "Payload shape" block — the `type` field.

**What the doc says:**
```json
"type": "com.google.firebase.firebasecrashlytics.alerts.v1"
```

**What is actually correct:**
```
google.firebase.firebasealerts.alerts.v1.published
```

This is the official CloudEvent type used for all Firebase Alerts. The doc's value (`com.google.firebase.firebasecrashlytics.alerts.v1`) does not match any documented schema.

**Citation:** [Route Firebase Alerts events to Cloud Run — Eventarc](https://cloud.google.com/eventarc/docs/run/route-trigger-firebase-alerts) — trigger is created with `--event-filters="type=google.firebase.firebasealerts.alerts.v1.published"`

---

### 4. Error Reporting API — list endpoint path is wrong

**Affected section:** Section 9 "Pagination & Search", Error Reporting API subsection.

**What the doc says:**
```http
GET /v1beta1/projects/{projectId}/groups?pageSize=100&pageToken={token}
```
with claimed max page size of 100 and default of 20.

**What is actually correct:**

There is **no `projects.groups` list method** in the Error Reporting API v1beta1. The `projects.groups` resource only exposes `get` (by group name) and `update`. Listing groups with statistics is done via a separate resource:

```http
GET https://clouderrorreporting.googleapis.com/v1beta1/{projectName=projects/*}/groupStats
```

This endpoint (`projects.groupStats.list`) accepts `pageSize` (default 20, no documented hard max of 100), `pageToken`, `groupId[]`, `serviceFilter`, `timeRange`, `order`, `alignment`, and `timedCountDuration`.

The doc's path `/v1beta1/projects/{projectId}/groups` conflates two different resources. To list issues the correct endpoint is `/v1beta1/{projectName}/groupStats`.

**Citation:** [projects.groupStats.list — Error Reporting API](https://cloud.google.com/error-reporting/reference/rest/v1beta1/projects.groupStats/list); [projects.groups — Error Reporting API](https://cloud.google.com/error-reporting/reference/rest/v1beta1/projects.groups)

---

### 5. Error Reporting API base URL not specified

**Affected section:** Section 9, and implicitly throughout.

**What the doc says:** The doc omits the service hostname, giving only path fragments like `/v1beta1/projects/{projectId}/groups`.

**What is correct:** The base hostname is `clouderrorreporting.googleapis.com`. Full URL:
```
https://clouderrorreporting.googleapis.com/v1beta1/{projectName=projects/*}/groupStats
```

This should be stated explicitly in the connector doc so the implementer has the full URL.

**Citation:** [Error Reporting API reference](https://cloud.google.com/error-reporting/reference/rest)

---

### 6. Priority model section describes non-existent API behavior

**Affected section:** Section 5 "Built-in priority model".

**What the doc says:**
> Crashlytics assigns priority at the alert-rule level: HIGH / MEDIUM / LOW

This model and the three-tier priority values (HIGH, MEDIUM, LOW) do not appear in any official Firebase or Error Reporting API documentation. Crashlytics alert payloads contain no `priority` field. The doc appears to have invented a priority tier model that does not exist.

There is no priority field surfaced by any official Crashlytics API, alert payload, BigQuery schema, or Cloud Functions SDK.

**Citation:** per Crashlytics API reference — no `priority` field documented anywhere; [firebase-functions crashlytics.d.ts](https://app.unpkg.com/firebase-functions@6.3.2/files/lib/v2/providers/alerts/crashlytics.d.ts) confirms no priority field in any payload type.

---

### 7. Code example uses wrong SDK import pattern

**Affected section:** Section 3A, Cloud Function example.

**What the doc says:**
```typescript
import * as functions from "firebase-functions";
import { onCustomEventPublished } from "firebase-functions/alert/crashlytics";
```

**What is actually correct:**

The 2nd-gen Cloud Functions SDK does not export `onCustomEventPublished` from `firebase-functions/alert/crashlytics`. The correct 2nd-gen pattern for Crashlytics triggers uses dedicated handlers:

```typescript
import { onNewFatalIssuePublished } from "firebase-functions/v2/alerts/crashlytics";
```

or for raw event handling via Eventarc:

```typescript
import { onCustomEventPublished } from "firebase-functions/v2/eventarc";
```

The module path `firebase-functions/alert/crashlytics` (without `v2/`) is the 1st-gen path and the function `onCustomEventPublished` does not live there.

**Citation:** [alerts.crashlytics namespace — Cloud Functions for Firebase](https://firebase.google.com/docs/reference/functions/2nd-gen/node/firebase-functions.alerts.crashlytics); [Firebase Alerts Triggers](https://firebase.google.com/docs/functions/alert-events)

---

## Confirmed Correct Claims

The following substantive claims in the doc are accurate and do not need changes:

- No public write API exists — confirmed. Crashlytics exposes no create/update/delete/comment endpoints via REST.
- Firebase Alerts require a Cloud Function as receiver, not a plain webhook URL — confirmed.
- BigQuery export table naming pattern (`{bundleId}_ANDROID`, `{bundleId}_REALTIME`) — consistent with official docs.
- BigQuery polling strategy and key fields (`issue_id`, `event_timestamp`, `error_type`, `platform`, `application.display_version`, `custom_keys`, `user.id`) — these fields match the documented BigQuery export schema.
- `error_type` values FATAL / NON_FATAL / ANR — correct.
- `is_fatal` deprecated in favor of `error_type` — correct.
- `projects.groupStats.list` uses `pageToken` pagination — confirmed (though the endpoint path cited is wrong, the pagination mechanism is correct).
- Service account is the only auth mechanism — confirmed.
- Eventarc delivers at-least-once with exponential backoff — confirmed.
- `crashlytics.regression` event type — confirmed correct.

---

## Summary of Required Corrections

| Issue | Severity |
|---|---|
| Six alert event type strings are hallucinated or wrong | High |
| Alert payload fields are mostly hallucinated (`issueId`, `issueTitle`, `platform`, `bundleId`, `impactedSessions`, `impactedDevices`, `unaffectedDevices`, `timestamp`, `priority`) | High |
| CloudEvent `type` string is wrong | High |
| Error Reporting API list endpoint path is wrong (`/groups` vs `/groupStats`) | High |
| Priority model (HIGH/MEDIUM/LOW) does not exist in the API | Medium |
| SDK import path in code example is wrong | Medium |
| Error Reporting API base hostname not stated | Low |
