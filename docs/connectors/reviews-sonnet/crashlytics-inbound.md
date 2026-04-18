# Inbound Review: Crashlytics Connector

**Verdict: FAIL — multiple alert event names are wrong, the CloudEvents type string is fabricated, the payload shape is incorrect, and the event taxonomy misrepresents what the platform actually delivers.**

The doc's understanding of the overall architecture (Cloud Function required, no direct webhook URL, BigQuery as polling fallback, read-only connector) is accurate. However the concrete event names, payload field paths, and CloudEvents envelope are substantially wrong. These are the fields a connector implementation reads at runtime, so the errors are blocking.

---

## Findings

### 1. Alert event names are wrong across the board

**Affected flow:** Section 3A "Available alert types" table; Section 6 "Triggers We Can Match On"; Section 11 MVP intake list.

**What is wrong:** The doc invents event names that do not appear in the official Firebase SDK or Eventarc documentation. None of the following names exist:

| Doc name | Status |
|---|---|
| `crashlytics.newAnomalousIssue` | Not found in any official source |
| `crashlytics.newIssue` | Not found in any official source |
| `crashlytics.velocityAlert` | Wrong — actual name is `crashlytics.velocity` |
| `crashlytics.newRateThresholdFatal` | Not found in any official source |
| `crashlytics.newRateThresholdNonfatal` | Not found in any official source |
| `crashlytics.stalenessAlert` | Not found in any official source |

**Correction:** The complete set of officially documented Crashlytics alert event types (used both as Cloud Functions handler identifiers and as Eventarc `alerttype` filter values) is:

| Correct event type | Trigger description |
|---|---|
| `crashlytics.newFatalIssue` | New fatal crash issue (first occurrence only) |
| `crashlytics.newNonfatalIssue` | New non-fatal error issue (first occurrence only) |
| `crashlytics.newAnrIssue` | New ANR issue (first occurrence only) |
| `crashlytics.regression` | Closed issue reoccurring in a new app version |
| `crashlytics.velocity` | Single issue causing a significant percentage of sessions to crash |
| `crashlytics.stabilityDigest` | Periodic digest of top trending issues |
| `crashlytics.missingSymbolFile` | Debug symbols absent for an incoming crash (symbolication failure) |

Sources: `firebase-functions` TypeScript definitions (v6.3.2, v7.0.0) and the Eventarc trigger documentation.

---

### 2. Payload field shapes are wrong

**Affected flow:** Section 3A payload example JSON; code snippet that accesses `payload.issueId`, `payload.issueTitle`, `payload.platform`, `payload.bundleId`, `payload.crashCount`, `payload.impactedSessions`, `payload.impactedDevices`, `payload.unaffectedDevices`, `payload.priority`, `payload.firstVersion`, `payload.latestVersion`.

**What is wrong:** The payload shown is not the actual `firebase-functions` payload shape. It conflates several alert types into a single made-up structure. The actual SDK types differ significantly.

**Correction:** The real payload hierarchy accessed in a Cloud Function is `event.data.payload.*` (for v2 functions). The concrete shapes per event type:

**All three new-issue events** (`newFatalIssue`, `newNonfatalIssue`, `newAnrIssue`) — payload type `NewFatalIssuePayload` / `NewNonfatalIssuePayload` / `NewAnrIssuePayload`:
```
event.appId                    — Firebase App ID
event.data.payload.issue.id    — Crashlytics issue ID
event.data.payload.issue.title — crash title / signature
event.data.payload.issue.subtitle
event.data.payload.issue.appVersion
```
There is no `platform`, `bundleId`, `crashCount`, `impactedSessions`, `impactedDevices`, `unaffectedDevices`, or `priority` field in these payloads. The app context comes from `event.appId`, not payload fields.

**Regression** (`crashlytics.regression`) — `RegressionAlertPayload`:
```
event.data.payload.type         — issue sub-type string (e.g. "fatal", "nonfatal", "anr")
event.data.payload.issue        — Issue object (same shape as above)
event.data.payload.resolveTime  — ISO timestamp of last resolution
```

**Velocity alert** (`crashlytics.velocity`) — `VelocityAlertPayload`:
```
event.data.payload.issue           — Issue object
event.data.payload.createTime      — ISO timestamp
event.data.payload.crashCount      — number of crashes in alert window
event.data.payload.crashPercentage — percentage of sessions affected
event.data.payload.firstVersion    — first app version where issue appeared
```
Note: `latestVersion` and `impactedDevices` / `impactedSessions` / `unaffectedDevices` do not exist on this payload.

**Stability digest** (`crashlytics.stabilityDigest`) — `StabilityDigestPayload`:
```
event.data.payload.digestDate
event.data.payload.trendingIssues[]  — array of TrendingIssueDetails
  .type
  .issue         — Issue object
  .eventCount
  .userCount
```
Known broken field: the Crashlytics backend always emits exactly 4 entries in `trendingIssues` regardless of how many real issues exist. Items beyond the actual count have empty/zero values. The doc does not flag this.

---

### 3. CloudEvents envelope type string is fabricated

**Affected flow:** Section 3A "Payload shape (Cloud Events v2 format via Eventarc)" JSON block, `type` field.

**What is wrong:** The doc shows:
```json
"type": "com.google.firebase.firebasecrashlytics.alerts.v1"
```

This string does not exist. It is not the Eventarc type for Firebase Alerts.

**Correction:** The actual CloudEvents type string for all Firebase Alert events delivered via Eventarc is:
```
google.firebase.firebasealerts.alerts.v1.published
```
To filter for Crashlytics specifically, an Eventarc trigger uses the `alerttype` attribute filter (e.g., `alerttype=crashlytics.newFatalIssue`). The `type` field in the CloudEvents envelope is always the single generic value above, not a per-alert-type string.

---

### 4. `data.alertType` field path is wrong in the CloudEvents envelope

**Affected flow:** Section 3A JSON example; Section 6 trigger table referencing `alertType`.

**What is wrong:** The doc shows the CloudEvents envelope with `data.alertType` as a top-level field in the `data` object alongside `data.payload`. The actual structure from `firebase-functions` is that `alertType` lives on the `CrashlyticsEvent` object itself (`event.alertType`), not inside `event.data`. The `data` object wraps `FirebaseAlertData<T>` which exposes `payload`.

**Correction:** Access `alertType` via `event.alertType`, not `event.data.alertType`. The `event.data.payload` path is correct for the actual crash data.

---

### 5. Missing event types from the coverage list

**Affected flow:** Section 3A coverage table; Section 11 MVP scope.

**What is wrong:** The doc omits two officially supported alert types entirely:
- `crashlytics.newAnrIssue` — ANR (Application Not Responding) events are separate from fatal/non-fatal crashes and require their own handler. Missing from the event table and MVP list.
- `crashlytics.missingSymbolFile` — symbolication failure alert. Relevant for iOS crash triage (missing dSYM). Not present anywhere in the doc.
- `crashlytics.stabilityDigest` — periodic trending digest. The doc lists `stalenessAlert` which does not exist, but does not list `stabilityDigest` which does.

---

### 6. `issue.id` vs `issueId` in BigQuery correlation caveat is stated backwards

**Affected flow:** Section 10, gotcha #7.

**What is wrong:** The doc states: "the Firebase Alert `issueId` may differ from BigQuery's `issue_id` due to different internal systems — correlate by title + bundle + platform."

**Assessment:** This claim is directionally plausible as a caution, but the actual `Issue.id` field in the Firebase Alert payload and `issue_id` in BigQuery are documented as the same identifier (the Crashlytics issue group ID). The doc should cite a concrete source or observed discrepancy before recommending title+bundle+platform correlation as the fallback, since that fallback is error-prone (same crash title can appear across different issue groups after a version bump). This should be marked as an open question, not stated as fact.

---

### 7. BigQuery table naming — batch table pattern is incomplete

**Affected flow:** Section 3B "Table naming."

**What is wrong:** The doc states the batch table name is `{bundleId}` with example `com_example_myapp_ANDROID` and the realtime table is `{bundleId}_REALTIME`. The example for the batch table omits that dots in the bundle identifier are replaced with underscores and that the platform suffix is always appended uppercase. The pattern is correct for Android but the doc does not clarify the iOS equivalent uses the bundle identifier in the same underscore-substitution pattern (e.g., `com_example_myapp_IOS`, not `com_example_myapp_IOS` — this is correct but unstated). The realtime suffix `_REALTIME` is confirmed correct.

**Correction:** Batch table pattern: `{bundle_id_dots_to_underscores}_{PLATFORM}` (e.g., `com_google_test_ANDROID`). Realtime table: same with `_REALTIME` appended. This is confirmed by official schema docs.

---

### 8. `onCustomEventPublished` is wrong — not the correct handler for Firebase Alerts

**Affected flow:** Section 3A code snippet.

**What is wrong:** The code example uses:
```typescript
import { onCustomEventPublished } from "firebase-functions/alert/crashlytics";
export const crashlyticsHandler = onCustomEventPublished(
  "crashlytics.newAnomalousIssue",
  async (event) => { ... }
);
```

This import path and function name are incorrect. `onCustomEventPublished` is a generic Eventarc custom event handler from a different module. Crashlytics alert handlers come from `firebase-functions/v2/alerts/crashlytics` and use typed handler functions.

**Correction:**
```typescript
import { onNewFatalIssuePublished, onVelocityAlertPublished, onRegressionAlertPublished } from "firebase-functions/v2/alerts/crashlytics";

export const onFatalCrash = onNewFatalIssuePublished(async (event) => {
  const { id, title, subtitle, appVersion } = event.data.payload.issue;
  const appId = event.appId;
  // forward to SupportAgent dispatcher
});
```

Each alert type requires its own typed handler function — there is no single generic handler for all Crashlytics alert types.

---

### 9. Signature verification description is accurate in intent but misleading in mechanism

**Affected flow:** Section 3A "Signature verification."

**What is correct:** The doc correctly notes that no manual HMAC verification is needed when using the Firebase SDK — the SDK handles it.

**What is misleading:** The doc says Eventarc delivers events with "a signed JWT in `Authorization: Bearer` from Workload Identity Federation." This is accurate for Cloud Run endpoints receiving Eventarc events directly (the Eventarc service account OIDC token), but when using `firebase-functions` v2 handlers, authentication is handled entirely at the Cloud Functions layer — the developer never sees the JWT. The distinction matters if SupportAgent routes through a Cloud Run service rather than a native Cloud Function, in which case the OIDC token must be verified explicitly. This architectural branching should be called out clearly.

---

### 10. Retry / delivery guarantee window is understated

**Affected flow:** Section 3A "Retry semantics."

**What is stated:** "at-least-once delivery with exponential backoff (up to ~24 hours)."

**What is missing:** Eventarc's retry policy for Cloud Run destinations is configurable (minimum retry delay, maximum retry attempts). The default retry window and backoff parameters are not documented in the connector doc. For production use, the connector must handle idempotent delivery since at-least-once guarantees duplicates. The doc does not address idempotency — there is no mention of deduplication by `event.id` (the CloudEvents `id` field).

**Correction:** Add: deduplicate incoming events using the CloudEvents `id` field (present in the envelope). Store seen IDs in connector state with a TTL matching the retry window.

---

### 11. The `priority` field in the payload does not exist

**Affected flow:** Section 3A "Key fields to persist" (`payload.priority — HIGH / MEDIUM / LOW`); Section 5 "Built-in priority model."

**What is wrong:** No Crashlytics alert payload exposes a `priority` field (`HIGH`/`MEDIUM`/`LOW`). The priority/severity framing in the doc (Section 5) is an editorial construct — the SDK payloads do not carry this field. `VelocityAlertPayload` has `crashPercentage` and `crashCount` as severity proxies; `NewFatalIssuePayload` has none beyond the issue identity fields.

**Correction:** Remove `payload.priority` from the field list. Derive severity in the connector from the alert type itself (`newFatalIssue` = highest urgency, `velocity` = high urgency, `regression` = medium, `newNonfatalIssue`/`newAnrIssue` = lower) plus `crashCount`/`crashPercentage` from velocity payloads.

---

### 12. Polling strategy SQL references non-existent column `issue_title`

**Affected flow:** Section 3B SQL example.

**What is wrong:** The SQL query selects `issue_title` and groups by it. The confirmed BigQuery schema field for the issue title is not `issue_title` — the schema exposes `issue_id` at the top level but the issue title lives in nested fields. The exact column path for the crash title needs verification against the full BigQuery schema (`error.title` for Apple, `exceptions.type` for Android).

**Correction:** Verify `issue_title` exists as a top-level column before using it in GROUP BY. If it is not a flat column, the GROUP BY will fail. Consult the full dataset schema at `firebase.google.com/docs/crashlytics/bigquery-dataset-schema` and use the confirmed field paths. This query should be flagged as unverified.

---

## Summary of Required Changes

| # | Section | Severity | Issue |
|---|---|---|---|
| 1 | 3A event table | Blocking | All 6 event names are wrong — replace with the 7 correct names |
| 2 | 3A payload JSON + field list | Blocking | Payload shape does not match SDK types; fabricated fields present |
| 3 | 3A CloudEvents envelope | Blocking | `type` string is fabricated — correct value is `google.firebase.firebasealerts.alerts.v1.published` |
| 4 | 3A, 6 | Blocking | `data.alertType` path is wrong — it is `event.alertType` |
| 5 | 3A, 11 | High | `newAnrIssue`, `missingSymbolFile`, `stabilityDigest` are missing from coverage |
| 6 | 3A code snippet | Blocking | `onCustomEventPublished` import is wrong — use typed alert handlers |
| 7 | 5 | Blocking | `payload.priority` field does not exist in any alert payload |
| 8 | 10 gotcha #7 | Medium | Issue ID correlation claim is unverified; should be an open question |
| 9 | 3A retry | Medium | No idempotency / deduplication strategy using CloudEvents `id` |
| 10 | 3A sig verification | Low | OIDC token verification needed for Cloud Run path, not just Cloud Functions |
| 11 | 3B SQL | Medium | `issue_title` column existence in BigQuery flat schema is unverified |
| 12 | 3B table naming | Low | Clarify dot-to-underscore substitution rule explicitly |
