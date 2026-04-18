# Crashlytics Connector Design

> Firebase Crashlytics is an error-monitoring and crash-reporting platform. It **does not expose a public write API** — there is no way to create issues, post comments, change status, or assign owners via REST. Intake is event-driven via Firebase Alerts or batch/realtime via BigQuery export.

**Category:** error-monitoring
**Cloud-only:** Yes — no self-hosted variant.
**Official reference:** https://firebase.google.com/docs/crashlytics

---

## 1. Overview

Crashlytics has no public REST API for write operations. All crash/issue management happens through the Firebase Console. The only read surfaces are:

- **Error Reporting API** (read-only) — exposes grouped errors and event logs.
- **Firebase Alerts** (Cloud Functions) — push events when new issues, regressions, or velocity spikes are detected.
- **BigQuery Export** — batch (daily) or streaming (realtime) crash event data for SQL-based analysis.

There is **no outbound capability** in this connector. SupportAgent can only receive events and query historical data — it cannot close, label, assign, or comment on Crashlytics issues.

---

## 2. Authentication

### Service Account (JSON key)

The only supported auth mechanism for all Crashlytics surfaces.

- **How to obtain:** GCP Console → IAM → Service Accounts → create key (JSON). Grant roles:
  - `roles/errorreporting.reader` — for Error Reporting API reads.
  - `roles/bigquery.dataViewer` — for BigQuery export queries.
  - `roles/cloudfunctions.invoker` — for triggering Cloud Functions that handle alerts.
- **Header:** `Authorization: Bearer <token>` via `google-auth-library` (adc or explicit key file).
- **Token lifetime:** 1-hour access tokens, auto-refreshed by SDK. Service account keys never expire unless rotated.
- **Scope:** `https://www.googleapis.com/auth/cloud-platform`
- **Recommendation for MVP:** Service account JSON key. Store in connector config, mount via environment variable or secret manager.

**No OAuth2 user-flow** exists for Crashlytics — service accounts are the only option.

---

## 3. Inbound — Events and Intake

### 3A. Firebase Alerts (Push — recommended for real-time)

Firebase Alerts deliver push events to Cloud Functions (v1) or Eventarc (v2) when Crashlytics detects issues.

**No direct webhook URL** — you must use a Cloud Function as the receiver. SupportAgent deploys a Cloud Function per tenant that receives the alert and forwards it to the SupportAgent dispatcher.

#### Available alert types

| Alert event name | Trigger |
|---|---|
| `crashlytics.newAnomalousIssue` | First occurrence of a new crash pattern (anomaly detected) |
| `crashlytics.newIssue` | New crash/ANR that has been seen before (non-anomalous) |
| `crashlytics.regression` | Previously-closed issue reoccurring |
| `crashlytics.velocityAlert` | Crash impacts ≥N% of sessions in a 30-min window |
| `crashlytics.newRateThresholdFatal` | Fatal crash rate exceeds configured threshold |
| `crashlytics.newRateThresholdNonfatal` | Non-fatal crash rate exceeds configured threshold |
| `crashlytics.stalenessAlert` | No new events on an issue for N days (configurable) |

#### Payload shape (Cloud Events v2 format via Eventarc)

```json
{
  "specversion": "1.0",
  "type": "com.google.firebase.firebasecrashlytics.alerts.v1",
  "source": "//firebasecrashlytics.googleapis.com/projects/{projectNumber}",
  "subject": "projects/{projectId}/apps/{appId}",
  "time": "2026-04-18T10:30:00Z",
  "datacontenttype": "application/json",
  "data": {
    "alertType": "crashlytics.newAnomalousIssue",
    "payload": {
      "issueId": "fabc123def456",
      "issueTitle": "SIGABRT in [AppDelegate application:didFinishLaunchingWithOptions:]",
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
  }
}
```

**Key fields to persist:**
- `payload.issueId` — stable issue identifier
- `payload.issueTitle` — crash title/signature
- `payload.platform` — IOS / ANDROID
- `payload.bundleId` — app package/bundle ID
- `payload.crashCount`, `payload.impactedSessions` — severity proxies
- `payload.priority` — HIGH / MEDIUM / LOW (from alert rules)
- `payload.firstVersion`, `payload.latestVersion` — version context
- `alertType` — which rule triggered
- `subject` — contains `projectId` and `appId` for tenant routing

#### Signature verification

Eventarc delivers events with a **signed JWT** in ` Authorization: Bearer` from Workload Identity Federation. Cloud Functions verify via the Firebase SDK:

```typescript
import * as functions from "firebase-functions";
import { onCustomEventPublished } from "firebase-functions/alert/crashlytics";

export const crashlyticsHandler = onCustomEventPublished(
  "crashlytics.newAnomalousIssue",
  async (event) => {
    // Firebase SDK handles signature verification automatically
    const payload = event.data.payload;
    // forward to SupportAgent dispatcher
  }
);
```

No manual HMAC verification needed — Firebase handles it.

#### Retry semantics

Firebase Alerts / Eventarc guarantees **at-least-once delivery** with exponential backoff (up to ~24 hours). No dead-letter queue configuration needed for MVP.

### 3B. BigQuery Export (Pull — recommended for reconciliation)

Crashlytics exports one row per crash event to BigQuery. SupportAgent polls this table to detect new issues or changes.

**Setup:** Firebase Console → Project Settings → Integrations → BigQuery → Link → enable daily batch export + optional realtime streaming.

#### Table naming

- Batch table: `{bundleId}` (e.g., `com_example_myapp_ANDROID`)
- Realtime table: `{bundleId}_REALTIME` (streaming, no backfill)

#### Key fields for trigger matching

| BigQuery field | Trigger use |
|---|---|
| `issue_id` | Deduplication, link to alert events |
| `event_timestamp` | Cursor for polling |
| `error_type` | FATAL / NON_FATAL / ANR severity tier |
| `platform` | IOS / ANDROID filter |
| `application.display_version` | Version-scoped triggers |
| `device.manufacturer`, `device.model` | Device-specific filters |
| `custom_keys` (REPEATED) | Developer-defined key-value pairs for custom routing |
| `exceptions.type` (Android) | Exception class name filter |
| `error.title` (Apple) | NSError title filter |
| `user.id` | Per-user crash reports |

#### Polling strategy

```sql
-- Detect new issues since last poll
SELECT
  issue_id,
  issue_title,
  platform,
  bundle_identifier,
  error_type,
  application.display_version,
  MAX(event_timestamp) AS latest_event,
  COUNT(*) AS event_count
FROM `project.dataset.com_example_myapp_ANDROID`
WHERE event_timestamp > @last_poll_time
GROUP BY issue_id, issue_title, platform, bundle_identifier, error_type, application.display_version
ORDER BY latest_event DESC
```

Use `MAX(event_timestamp)` per `issue_id` to detect when a known issue gained new events (regression signal). Store the last-seen timestamp in connector state.

---

## 4. Outbound — Writing Back

**Not supported.** Crashlytics has no write API.

- No create issue endpoint.
- No post comment endpoint.
- No status transition endpoint.
- No label management endpoint.
- No assignee endpoint.
- No close/resolve endpoint.

All Crashlytics issue management is manual via the Firebase Console. The connector is **read-only**.

If SupportAgent needs to close a Crashlytics issue, the team must do it manually or via a Firebase Console workflow. There is no REST path for this.

---

## 5. Labels, Flags, Fields, Priorities

### Built-in priority model

Crashlytics assigns priority at the alert-rule level, not the issue level:

| Priority | Meaning |
|---|---|
| `HIGH` | Anomalous issues, velocity alerts, fatal regressions |
| `MEDIUM` | Non-fatal regressions, threshold breaches |
| `LOW` | General new issues, staleness warnings |

### Status model

Crashlytics has a **fixed two-state model** for issues:

- **Open** — actively receiving new events.
- **Closed** — no events for a period; can be reopened by a new event.

There is no workflow / status transition API. Closing is done manually in the Firebase Console or by marking an issue "resolved" in the UI.

### Labels / Tags

Crashlytics has no user-defined labels or tags. Issues are grouped purely by **issue signature** (crash stack fingerprint).

**Custom keys** (`custom_keys` in BigQuery) are the closest analog — developers set key-value pairs at crash time via the SDK:

```swift
Crashlytics.setCustomValue(value: "premium", forKey: "user_tier")
```

These are queryable in BigQuery but not settable via API.

### Custom fields

None. Crashlytics does not support custom fields on issues.

### How to enumerate available fields

No enumeration endpoint. The field set is fixed and documented in the BigQuery schema (see Section 3B above).

---

## 6. Triggers We Can Match On

Since Crashlytics is read-only, triggers are **inbound-only**. Here are the usable dimensions:

| Trigger dimension | Source | Notes |
|---|---|---|
| `alertType` = `newAnomalousIssue` | Firebase Alert | Anomaly-detected new crash |
| `alertType` = `velocityAlert` | Firebase Alert | Crash rate spike |
| `alertType` = `regression` | Firebase Alert | Re-opened closed issue |
| `alertType` = `newRateThresholdFatal` | Firebase Alert | Fatal rate exceeded threshold |
| `platform` = IOS / ANDROID | Alert + BigQuery | Filter by mobile OS |
| `bundleId` / `bundle_identifier` | Alert + BigQuery | Per-app routing |
| `error_type` = FATAL / NON_FATAL / ANR | BigQuery | Severity tier |
| `application.display_version` | BigQuery | Version-scoped |
| `custom_keys.key` = X | BigQuery | Developer-defined routing |
| `device.manufacturer` / `device.model` | BigQuery | Device-specific |
| `crashCount` / `impactedSessions` | Alert | Volume/severity proxy |

**Cannot match on:** comment body (no comments), assignee (no assignees), labels (no labels), status transitions (no API to observe them).

---

## 7. Identity Mapping

### User ID shape

Crashlytics does not have a concept of users/collaborators. There is no user ID to map to email.

The `user.id` field in BigQuery is **app-specific** — set by the developer via `Crashlytics.setUserIdentifier()`:

```swift
Crashlytics.setUserIdentifier(firebaseUser.uid)
```

This is an opaque string with no guaranteed format. It cannot be reliably resolved to an email without the app-level mapping (which is out of scope for this connector).

### Bot identity / no_self_retrigger

Not applicable — Crashlytics does not have a bot user concept. SupportAgent cannot post to Crashlytics, so there is no self-retrigger concern.

### Author field on comments

Not applicable — no comment API.

---

## 8. Rate Limits

### Error Reporting API

- **Quotas:** Default 600 requests/minute per project (adjustable in GCP Console).
- **Exposed via:** Standard GCP rate limit headers (`X-RateLimit-Limit`, `Retry-After`).
- No per-endpoint细分.

### BigQuery

- **Query limits:** 100 concurrent queries per project, 10,000 queries per day (default).
- **Streaming inserts:** 100,000 rows/second per project.
- No rate limit headers in query responses — use the `jobs.insert` API with `location=US` for quota tracking.

### Firebase Alerts

No documented rate limit. Eventarc delivers at-least-once with no explicit cap on alert frequency.

---

## 9. Pagination & Search

### Error Reporting API

- **Style:** Page tokens (`nextPageToken` in response body).
- **Max page size:** 100 items per page (`pageSize` param, default 20).
- **Search:** No free-text search. Filter by `timeRange`, `group` (issue ID).

```http
GET /v1beta1/projects/{projectId}/groups?pageSize=100&pageToken={token}
```

### BigQuery

- **Style:** Page tokens via Job results (`pageToken` in job done response).
- **Max page size:** Unlimited within a single job result (up to 100GB result limit).
- **Search:** Full SQL — `WHERE` clauses on any column, `LIKE`, `REGEXP_CONTAINS`.

### No issue search API

Crashlytics has no equivalent of GitHub's Issues search. You cannot search for issues by title, label, or status via API. BigQuery is the only search surface.

---

## 10. Known Gotchas

1. **No write API.** This is the fundamental limitation. The connector is read-only.

2. **No webhook URL** — Firebase Alerts require a Cloud Function. SupportAgent must deploy and manage a per-tenant Cloud Function, not just register a webhook URL. This adds infrastructure complexity vs. GitHub/Jira webhooks.

3. **BigQuery realtime tables have no backfill.** If you enable streaming export after a crash, historical events are not backfilled. The batch table backfills up to 30 days.

4. **`user.id` is not an email.** Crashlytics does not expose the Firebase Auth user email. `user.id` is set by the developer and may be an opaque UID. No identity resolution without app-level integration.

5. **No label/status enumeration.** The connector cannot discover available labels or statuses — they don't exist in Crashlytics.

6. **Eventual consistency in BigQuery.** Batch exports are delayed up to 24 hours. Streaming is near-realtime but not guaranteed. Do not rely on BigQuery for real-time alerting — use Firebase Alerts for that.

7. **Issue ID stability.** `issue_id` in BigQuery is stable across events for the same crash signature. But the Firebase Alert `issueId` may differ from BigQuery's `issue_id` due to different internal systems — correlate by title + bundle + platform.

8. **Service account is project-level.** All Crashlytics data is scoped to a GCP project. Multi-tenant support requires one service account per Firebase project (per customer). This complicates the connector config.

9. **`is_fatal` is deprecated.** Use `error_type` (FATAL / NON_FATAL / ANR) instead.

10. **No per-issue notification settings.** Alert rules are project-wide. You cannot set different notification rules per issue.

---

## 11. Recommended Connector Scope

### MVP (minimum to be useful)

**Intake:**
- Firebase Alerts via Cloud Function (Eventarc) for real-time event ingestion
  - Handle: `newAnomalousIssue`, `velocityAlert`, `regression`, `newRateThresholdFatal`
- BigQuery polling for historical queries and reconciliation (batch table)

**Config fields:**
- `projectId` (GCP project ID)
- `serviceAccountJson` (JSON key, stored as secret)
- `appBundleIds` (list of app IDs to filter on)
- `alertTypes` (which alert types to forward — default: all)

**Connector type:** inbound-only. No outbound.

### Phase 2 (reconciliation + volume filtering)

- Add BigQuery polling as a fallback intake path
- Support `custom_keys` filtering via BigQuery SQL
- Volume-based trigger (crashCount threshold)
- Platform/version-scoped routing

### Phase 3 (advanced)

- Cross-app aggregation (one issue across multiple bundle IDs)
- Firebase Sessions join for crash-free user percentage per issue
- Anomaly context enrichment (link to Firebase Performance data)

---

## 12. Dependencies

### Official SDK

- **`firebase-admin`** — Node.js SDK for Firebase Auth, Cloud Functions triggers, and Admin SDK access.
- **`@google-cloud/error-reporting`** — Error Reporting API client (read-only).
- **`@google-cloud/bigquery`** — BigQuery client for export queries.
- **`google-auth-library`** — Auth underlying all GCP clients.

**Recommendation:** Use raw `fetch` with `google-auth-library` for the Error Reporting API (lightweight) and `@google-cloud/bigquery` for BigQuery (complex streaming + query management). Do not add `firebase-admin` unless needed for Cloud Function deployment.

### No CLI

There is no `crashlytics` CLI equivalent to `gh`. No shell-out parity path.

### Cloud Function deployment

SupportAgent must deploy a per-tenant Cloud Function to receive Firebase Alerts. Options:
- **`@google-cloud/functions-framework`** — lightweight, no Firebase CLI dependency.
- **`firebase-functions`** — if Firebase CLI parity is needed.

---

## 13. Open Questions

1. **GCP project per tenant?** Crashlytics data lives in a GCP project. Multi-tenant support requires either one GCP project per customer or shared-project with per-app filtering. Which model does SupportAgent target?

2. **Firebase Alert or BigQuery primary?** Firebase Alerts are real-time but require Cloud Function infrastructure. BigQuery is reliable but delayed. Should the connector use both as redundant paths or one as primary with the other as fallback?

3. **Cloud Function hosting?** Who manages the per-tenant Cloud Functions — SupportAgent (serverless) or the customer (their GCP)? Affects service account permissions and deployment pipeline.

4. **Issue correlation across alert types.** The `issueId` in Firebase Alerts and `issue_id` in BigQuery may not be identical strings. Do we need to correlate by `(issue_title, bundle_id, platform)` instead of a stable ID?

5. **Staleness alerts.** The `stalenessAlert` event fires when an issue goes quiet. Should this map to a "resolved" trigger in SupportAgent's model, or is it informational only?

6. **No-outbound communication to users.** Since Crashlytics has no write API, how does SupportAgent communicate findings back to the team? Email notification via Firebase Alerts? Slack via a separate integration? This is a connector design gap that needs a product decision.