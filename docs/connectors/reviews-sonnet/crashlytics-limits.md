# Crashlytics Connector — Rate Limits & Operational Reliability Review

**Source doc:** `docs/connectors/crashlytics.md`
**Reviewer focus:** rate limits, pagination, retries, error handling, bulk operations
**Date:** 2026-04-18

---

## Verdict

The doc is broadly sound on architecture and read-only semantics, but contains several concrete errors in the rate-limits section and the alert-event-name table. The BigQuery streaming-insert figure is wrong by an order of magnitude. The alert type names do not match the Eventarc filter strings or Cloud Functions SDK names that are actually shipped. The Error Reporting API rate-limit number and header claim are both unverified or incorrect. The pagination section states a max page size of 100 without an official source — the official docs do not publish a maximum. The dead-letter queue advice is incorrect. These issues are material for anyone building the connector.

---

## Findings

### 1. Error Reporting API — Rate Limit Numbers

**Area:** Section 8, "Error Reporting API"

**Claim in doc:**
> Default 600 requests/minute per project (adjustable in GCP Console).

**Correct value:**
The official Error Reporting quota page (https://docs.cloud.google.com/error-reporting/quotas) lists three separate limits:
- Error event data requests: **60/min per user**
- Error group metadata requests: **60/min per user**
- Error reports (ingest): **6,000/min** (project-wide)

The doc collapses these into a single "600 req/min per project" figure that does not appear in current official documentation. The read limits that matter for the connector (listing `groupStats`, listing events) are 60/min per user, not 600/min per project. This is a 10x error and could cause the connector to throttle far sooner than expected.

**Citation:** https://docs.cloud.google.com/error-reporting/quotas

---

### 2. Error Reporting API — Rate Limit Headers

**Area:** Section 8, "Error Reporting API"

**Claim in doc:**
> Exposed via: Standard GCP rate limit headers (`X-RateLimit-Limit`, `Retry-After`).

**Correct value:**
GCP APIs do **not** use `X-RateLimit-*` headers. Google Cloud returns **HTTP 429** for rate quota overruns (or **403 RATE_LIMIT_EXCEEDED** for older APIs / Compute Engine). The response body carries a JSON error object with `"domain": "usageLimits"` and `"reason": "rateLimitExceeded"`. No `X-RateLimit-Limit` or `Retry-After` header is documented for the Error Reporting API; this header pattern is specific to GitHub and similar platforms. The connector should detect `429` (or `403` with reason `rateLimitExceeded`) and apply exponential backoff. There is no documented `Retry-After` header to read.

**Citation:** https://docs.cloud.google.com/docs/quotas/troubleshoot

---

### 3. Error Reporting API — Retry Advice

**Area:** Section 8 implicitly; Section 10 is silent

**Claim in doc:**
The doc does not give explicit retry guidance for the Error Reporting API.

**Finding:**
Google's official recommendation for all rate-limited GCP API calls is truncated exponential backoff with jitter, starting no sooner than 1 second after the error. The doc should state this explicitly. Absence of guidance risks an implementer doing an immediate retry on 429, which would create a retry storm.

**Citation:** https://docs.cloud.google.com/docs/quotas/troubleshoot

---

### 4. BigQuery — Streaming Insert Quota

**Area:** Section 8, "BigQuery"

**Claim in doc:**
> Streaming inserts: 100,000 rows/second per project.

**Correct value:**
The current BigQuery streaming insert quota is:
- US/EU multi-regions, with `insertId`: **500,000 rows/second per project** (per-table cap: 100,000 rows/sec)
- All other regions: **100,000 rows/second per project**
- Without `insertId`: **1 GB/second** per project

The doc's figure of 100,000 rows/second is the per-table limit in US/EU regions (not the per-project limit), and it omits the multi-region/single-region distinction entirely. For a connector ingesting Crashlytics export data this is unlikely to be a practical bottleneck, but the figure is misleading. Note also that the BigQuery Storage Write API (generally preferred for new projects since 2023) has different quota semantics not mentioned in the doc.

**Citation:** https://cloud.google.com/bigquery/quotas#streaming_inserts

---

### 5. BigQuery — Daily Query Limit Missing

**Area:** Section 8, "BigQuery"

**Claim in doc:**
> 100 concurrent queries per project, 10,000 queries per day (default).

**Correct value:**
The 100-concurrent-queries figure is broadly correct for on-demand projects (dynamically computed, approximately 100). However, the "10,000 queries per day" figure is not the current default quota. As of September 2025, Google introduced a **200 TiB/day** data-processed limit for new on-demand projects; legacy projects may retain "unlimited" or a usage-based cap. There is no published "10,000 queries per day" count-based limit in current docs — daily limits are expressed in bytes processed, not query count. The doc should replace this with the actual constraint (bytes processed per day, default 200 TiB for new projects).

**Citation:** https://docs.cloud.google.com/bigquery/quotas

---

### 6. Alert Event Names — Multiple Errors

**Area:** Section 3A, Tables "Available alert types"; Section 6 Triggers table

**Claim in doc:**
The doc lists these alert type names:
- `crashlytics.newAnomalousIssue`
- `crashlytics.newIssue`
- `crashlytics.velocityAlert`
- `crashlytics.newRateThresholdFatal`
- `crashlytics.newRateThresholdNonfatal`
- `crashlytics.stalenessAlert`

**Correct values:**
The actual Eventarc filter strings shipped in Firebase (verified against the Cloud Functions for Firebase SDK and Eventarc routing docs) are:

| Eventarc filter string | Cloud Functions 2nd-gen handler |
|---|---|
| `crashlytics.newFatalIssue` | `onNewFatalIssuePublished()` |
| `crashlytics.newNonfatalIssue` | `onNewNonfatalIssuePublished()` |
| `crashlytics.newAnrIssue` | `onNewAnrIssuePublished()` |
| `crashlytics.regression` | `onRegressionAlertPublished()` |
| `crashlytics.velocity` | `onVelocityAlertPublished()` |
| `crashlytics.stabilityDigest` | `onStabilityDigestPublished()` |
| `crashlytics.missingSymbolFile` | (no SDK handler) |

None of the names in the doc — `newAnomalousIssue`, `newIssue`, `velocityAlert` (has an extra "Alert"), `newRateThresholdFatal`, `newRateThresholdNonfatal`, `stalenessAlert` — appear in the current Firebase SDK or Eventarc documentation. Using these incorrect strings in a Cloud Function trigger or Eventarc filter will cause the trigger to never fire.

The payload structure shown in the doc (`alertType`, `payload.issueId`, `payload.priority`, etc.) also does not match the actual SDK payload interfaces (`NewFatalIssuePayload`, `VelocityAlertPayload`, etc.), which use a different nesting model without a top-level `alertType` field in the event data — the alert type is in the CloudEvent `type` field.

**Citation:** https://firebase.google.com/docs/reference/functions/2nd-gen/node/firebase-functions.alerts.crashlytics, https://cloud.google.com/eventarc/docs/run/route-trigger-firebase-alerts

---

### 7. Eventarc Retry Semantics — Dead-Letter Queue Claim

**Area:** Section 3A, "Retry semantics"

**Claim in doc:**
> Firebase Alerts / Eventarc guarantees at-least-once delivery with exponential backoff (up to ~24 hours). No dead-letter queue configuration needed for MVP.

**Correct value:**
The "up to ~24 hours" is correct — Eventarc's default message retention duration is 24 hours, after which undelivered messages are **discarded**. However, the claim that "no dead-letter queue configuration needed" is incorrect from a reliability standpoint. The official Eventarc docs explicitly state that a dead-letter topic (dead-letter queue) is available and should be configured if you need to handle persistent failures without losing events. The backoff parameters are configurable through the underlying Pub/Sub subscription (default minimum: 10 seconds, maximum: 600 seconds). For a production connector, silently dropping alerts after 24 hours without a DLQ is a reliability gap, not an acceptable default.

**Citation:** https://docs.cloud.google.com/eventarc/docs/retry-events

---

### 8. Pagination — Max Page Size Unverified

**Area:** Section 9, "Error Reporting API"

**Claim in doc:**
> Max page size: 100 items per page (`pageSize` param, default 20).

**Correct value:**
The default page size of 20 is confirmed by the official `projects.groupStats/list` reference. However, the official documentation does **not publish a maximum value** for `pageSize`. The doc's "100 items" ceiling has no citation and may be an empirical observation or an assumption. The endpoint path in the doc (`/v1beta1/projects/{projectId}/groups?pageSize=100&pageToken={token}`) is also wrong — the correct endpoint for listing error group stats is:

```
GET https://clouderrorreporting.googleapis.com/v1beta1/projects/{projectName}/groupStats
```

The path `projects/{projectId}/groups` is a different resource (individual group metadata, not group stats with event counts). A connector built against the wrong endpoint will get different (incomplete) data.

**Citation:** https://docs.cloud.google.com/error-reporting/reference/rest/v1beta1/projects.groupStats/list

---

### 9. BigQuery Pagination — "Unlimited" Result Size

**Area:** Section 9, "BigQuery"

**Claim in doc:**
> Max page size: Unlimited within a single job result (up to 100GB result limit).

**Finding:**
Characterizing this as "unlimited" is misleading. BigQuery query results are paginated via `pageToken` in the job results response; the practical ceiling is 100 GB of uncompressed result data per query, and individual `tabledata.list` calls are limited to `maxResults` rows per call. The connector's polling loop must handle pagination correctly even for large result sets — "unlimited within a single job result" could be read as meaning pagination is unnecessary, which is incorrect for high-volume exports.

---

### 10. BigQuery Table Naming — New Infrastructure (2024/2025)

**Area:** Section 3B, "Table naming"

**Claim in doc:**
> Batch table: `{bundleId}` (e.g., `com_example_myapp_ANDROID`)

**Correct value:**
In mid-October 2024, Crashlytics launched a new BigQuery export infrastructure. All projects were migrated to this new infrastructure by March 2, 2026. Under the new infrastructure, batch table names are based on the bundle IDs/package names **as registered in the Firebase project** (not necessarily as they appear in the app binary), with periods converted to underscores and the platform suffix appended. In practice this may be identical for most projects, but the doc's description matches the old infrastructure's behavior and does not mention this migration. Any tenant that migrated to the new infrastructure and registered a different identifier than their binary's bundle ID will see unexpected table names.

**Citation:** https://firebase.google.com/docs/crashlytics/bigquery-dataset-schema

---

### 11. Issue ID Correlation — Claim Updated to Correct

**Area:** Section 10, Gotcha #7

**Claim in doc:**
> The Firebase Alert `issueId` may differ from BigQuery's `issue_id` due to different internal systems — correlate by title + bundle + platform.

**Finding:**
Research against official docs and community sources indicates that `issueId` in Firebase Alert payloads and `issue_id` in BigQuery export rows **are the same identifier** — both reference the Crashlytics issue grouping ID. The doc's caution about correlation by title+bundle+platform is overly defensive and could lead to unnecessary deduplication complexity. The one real caveat is that issue IDs changed format during the 2023 analysis-engine upgrade (pre-2023 vs post-2023 issues may have different ID formats), but cross-system mismatch between Alerts and BigQuery is not a documented issue.

**Recommendation:** Revise the gotcha to clarify that `issueId` == `issue_id` across systems, and note only the 2023 engine change as a format-versioning concern.

**Citation:** https://firebase.google.com/docs/crashlytics/bigquery-dataset-schema, https://firebase.google.com/docs/functions/alert-events

---

## Summary of Issues by Severity

| Severity | Finding |
|---|---|
| Critical | Alert event names are all wrong — triggers will never fire |
| Critical | Error Reporting API endpoint path in pagination section is wrong (`/groups` vs `/groupStats`) |
| High | Error Reporting rate limit: 60/min per user (not 600/min per project) |
| High | Rate limit headers: GCP uses 429 with JSON body, not `X-RateLimit-*` headers |
| Medium | BigQuery streaming insert: 500,000 rows/sec in US/EU (not 100,000/sec per project) |
| Medium | BigQuery daily limit: TiB-based quota, not 10,000 queries/day |
| Medium | Dead-letter queue: should be recommended, not dismissed |
| Low | Eventarc retry backoff params not stated (10s–600s range) |
| Low | Max Error Reporting page size: 100 is unverified; no maximum is published |
| Low | BigQuery "unlimited" pagination framing is misleading |
| Low | BigQuery table naming change (new 2024 infrastructure) not documented |
| Informational | issueId == issue_id across systems; gotcha #7 overstates the risk |
