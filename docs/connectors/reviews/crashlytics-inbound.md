# Crashlytics Inbound Events Review

**Verdict: FAIL — Critical event type name errors, payload shape mismatches, and missing alert types**

---

## Event Types — CRITICAL ERRORS

### Finding: All alert event names are wrong

**Document lists:**
- `crashlytics.newAnomalousIssue`
- `crashlytics.newIssue`
- `crashlytics.regression`
- `crashlytics.velocityAlert`
- `crashlytics.newRateThresholdFatal`
- `crashlytics.newRateThresholdNonfatal`
- `crashlytics.stalenessAlert`

**Actual SDK values (from `firebase-functions@3.24.1`):**
- `crashlytics.newFatalIssue` — handler: `onNewFatalIssuePublished`
- `crashlytics.newNonfatalIssue` — handler: `onNewNonfatalIssuePublished`
- `crashlytics.regression` — handler: `onRegressionAlertPublished`
- `crashlytics.stabilityDigest` — handler: `onStabilityDigestPublished`
- `crashlytics.velocity` — handler: `onVelocityAlertPublished`
- `crashlytics.newAnrIssue` — handler: `onNewAnrIssuePublished`

**Corrections:**
| Document (wrong) | Correct |
|---|---|
| `crashlytics.newAnomalousIssue` | `crashlytics.newFatalIssue` |
| `crashlytics.newIssue` | `crashlytics.newNonfatalIssue` |
| `crashlytics.velocityAlert` | `crashlytics.velocity` |
| `crashlytics.newRateThresholdFatal` | **Does not exist in SDK** |
| `crashlytics.newRateThresholdNonfatal` | **Does not exist in SDK** |
| `crashlytics.stalenessAlert` | **Does not exist in SDK** |

**Impact:** A Cloud Function filtering on `alertType === 'crashlytics.newAnomalousIssue'` will never fire. The connector will miss all events.

**Source:** `unpkg.com/firebase-functions@3.24.1/lib/v2/providers/alerts/crashlytics.js`

---

### Finding: Missing alert type — `crashlytics.newAnrIssue`

The SDK exposes `onNewAnrIssuePublished` for Application Not Responding issues. This is distinct from fatal/nonfatal crashes. The document does not mention ANR as a separate alert type.

**Correction:** Add `crashlytics.newAnrIssue` to the alert table with trigger: "New ANR (Application Not Responding) detected."

---

### Finding: Missing alert type — `crashlytics.stabilityDigest`

The SDK exposes `onStabilityDigestPublished` for stability digests. The document does not mention this type.

**Correction:** Add `crashlytics.stabilityDigest` to the alert table. This appears to be the "trending issues" alert from Firebase Console. Trigger: "Issue emerging or trending upward."

---

## Payload Shape — MISMATCHES

### Finding: Wrong payload field paths

**Document shows:**
```json
{
  "data": {
    "alertType": "crashlytics.newFatalIssue",
    "payload": {
      "issueId": "fabc123def456",
      "issueTitle": "SIGABRT in ...",
      "platform": "IOS",
      ...
    }
  }
}
```

**Actual structure (from Firebase sample + SDK):**
The SDK delivers a CloudEvent with `event.data` being the raw Eventarc payload. The Cloud Functions SDK converts:
- `alerttype` → `alertType` (camelCase conversion)
- `appid` → `appId`

The issue payload is nested under `event.data.payload.issue`:

```json
{
  "specversion": "1.0",
  "type": "google.firebase.firebasealerts.alerts.v1.published",
  "alerttype": "crashlytics.newFatalIssue",
  "data": {
    "payload": {
      "issue": {
        "id": "fabc123def456",
        "title": "SIGABRT in ...",
        "subtitle": "...",
        "appVersion": "4.3.1"
      }
    }
  }
}
```

**Corrections:**
| Document (wrong) | Correct |
|---|---|
| `data.alertType` | `alerttype` (raw CloudEvent) or `alertType` (after SDK conversion) |
| `data.payload.issueId` | `data.payload.issue.id` |
| `data.payload.issueTitle` | `data.payload.issue.title` |
| `data.payload.platform` | **Not in `payload.issue`** — platform is in BigQuery, not in alert payload |
| `data.payload.bundleId` | **Not in alert payload** — use `subject` field for `projectId/apps/appId` |

The SDK's `onCustomEventPublished` (v1 style) vs `onNewFatalIssuePublished` (v2 style) produce different shapes. Recommend using v2 handlers (`onNewFatalIssuePublished` etc.) and the payload structure they produce.

---

### Finding: Wrong CloudEvents `type` field

**Document shows:**
```json
"type": "com.google.firebase.firebasecrashlytics.alerts.v1"
```

**Actual:**
```javascript
exports.eventType = 'google.firebase.firebasealerts.alerts.v1.published';
```

This is the base event type for all Firebase Alerts, not just Crashlytics. The specific alert type is in `eventFilters.alerttype`.

**Correction:** The `type` field in CloudEvents is `google.firebase.firebasealerts.alerts.v1.published` for all Firebase Alerts. Do not use a Crashlytics-specific type.

---

## Signature Verification — INCOMPLETE

### Finding: Missing Eventarc delivery verification details

The document says "Firebase SDK handles signature verification automatically" but does not explain what this means for SupportAgent's Cloud Function.

**Missing information:**
1. The Cloud Function receives a CloudEvent with an `Authorization: Bearer` JWT from Workload Identity Federation
2. CloudEvents SDK (or Firebase Functions SDK) validates the JWT automatically
3. No manual HMAC verification needed — but the connector must use the CloudEvents SDK or Firebase Functions SDK to receive events
4. For Eventarc HTTP targets (if SupportAgent uses Eventarc directly instead of Cloud Functions), the delivery includes an `Authorization` header with a signed JWT that must be verified

**Clarification needed:** If SupportAgent uses Eventarc with HTTP targets (direct webhook-like delivery to a backend), the signature verification is:
- Algorithm: JWT RS256
- Header: `Authorization: Bearer <JWT>`
- The JWT must be validated against Google public keys from `https://www.gstatic.com/iap/verify/public_key-jwk`
- The `issuer` claim must be `https://cloud.google.com/iap`
- The `aud` claim must match the backend's audience

If SupportAgent uses Cloud Functions, Firebase handles this automatically.

---

## Replay Protection / Timestamp Tolerance — NOT DOCUMENTED

### Finding: Missing event deduplication guidance

Firebase Alerts / Eventarc guarantees at-least-once delivery. The document states this but does not address replay protection.

**Missing guidance:**
1. Crashlytics events may be delivered multiple times (at-least-once)
2. SupportAgent should deduplicate on `data.payload.issue.id` + `alerttype` + `time`
3. No timestamp tolerance is documented for Eventarc itself — events don't expire within typical delivery windows
4. For Cloud Functions, the function execution ID can be used for idempotency

**Recommendation:** Document that the dispatcher must handle duplicate deliveries and use `(issue.id, alerttype)` as a natural idempotency key.

---

## Webhook Delivery Guarantees — PARTIAL

### Finding: Retry window not specified

The document says "at-least-once delivery with exponential backoff (up to ~24 hours)" but does not cite this or verify it.

**Verification needed:** Check Firebase documentation for the actual retry window. Eventarc retry policies:
- Default retry: exponential backoff with unlimited duration (until event is delivered or event retention expires)
- Event retention: 7 days for Eventarc
- Dead-letter: Not available for all Eventarc configurations

**Correction:** Update the retry semantics to reflect Eventarc's actual behavior. Add note that Eventarc retries indefinitely until delivery or event expiry (7 days), not "up to ~24 hours."

---

## Polling Fallback — GOOD

### Finding: BigQuery polling strategy is correct

The polling strategy document is sound:
- Uses `MAX(event_timestamp)` per `issue_id` for regression detection — correct
- Groups by issue for deduplication — correct
- Uses parameterized `@last_poll_time` for cursor — correct

**Minor note:** The SQL aliases use `bundle_identifier` but the BigQuery table naming uses `{bundleId}`. Ensure consistency in documentation.

---

## Mention Detection — N/A

**Finding: Not applicable**

Crashlytics has no comment/mention system. This is correctly noted in the document. No changes needed.

---

## Bot-Authored Content — N/A

**Finding: Not applicable**

Crashlytics has no write API. SupportAgent cannot post content. No loop-prevention needed.

---

## Eventual Consistency — NOTED

### Finding: Good note on BigQuery consistency

The document correctly flags:
- Batch exports delayed up to 24 hours
- Streaming near-realtime but not guaranteed
- Don't rely on BigQuery for real-time alerting

**Addendum:** Firebase Alerts themselves may have a small delay (minutes) from crash occurrence to alert delivery. There is no documented SLA for alert delivery latency.

---

## Issue ID Correlation — IMPORTANT GAP

### Finding: Alert `issueId` vs BigQuery `issue_id` mismatch is underemphasized

The document mentions this in "Known Gotchas #7" but it affects core deduplication logic.

**Recommendation:** Emphasize that:
- Alert `issue.id` (string like `fabc123def456`) is NOT the same as BigQuery `issue_id`
- Correlation must be by `(issue.title, bundle_id, platform)` not by ID alone
- This is a known limitation that affects deduplication between alert and polling paths

---

## Summary of Corrections Needed

1. **CRITICAL:** Fix all alert event type names to match SDK (`crashlytics.newFatalIssue`, `crashlytics.newNonfatalIssue`, `crashlytics.velocity`, `crashlytics.newAnrIssue`, `crashlytics.stabilityDigest`, `crashlytics.regression`)

2. **CRITICAL:** Remove non-existent alert types (`newRateThresholdFatal`, `newRateThresholdNonfatal`, `stalenessAlert`, `newAnomalousIssue`, `newIssue`)

3. **CRITICAL:** Fix payload paths (`data.payload.issue.id`, `data.payload.issue.title`, etc.)

4. **HIGH:** Fix CloudEvents `type` field to `google.firebase.firebasealerts.alerts.v1.published`

5. **HIGH:** Add `crashlytics.newAnrIssue` and `crashlytics.stabilityDigest` alert types

6. **MEDIUM:** Document Eventarc HTTP target signature verification (JWT RS256) for direct webhook-style delivery

7. **MEDIUM:** Correct retry semantics (indefinite until event expiry, not "~24 hours")

8. **LOW:** Emphasize issue ID correlation limitation in deduplication section

---

## Reference Sources

- Firebase Functions SDK (v2): `unpkg.com/firebase-functions@3.24.1/lib/v2/providers/alerts/crashlytics.js`
- Firebase Alerts sample: `github.com/firebase/functions-samples/Node/alerts-to-discord`
- Firebase Console docs: `firebase.google.com/docs/crashlytics/alerts`
- BigQuery schema fields: `firebase.google.com/docs/crashlytics/bigquery-dataset-schema`
