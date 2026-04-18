# SDK & Build-Plan Review — Crashlytics Connector

**Reviewer:** claude-sonnet-4-6
**Date:** 2026-04-18
**Source doc:** `docs/connectors/crashlytics.md`

---

## Verdict

The doc is structurally sound and correctly identifies the hard constraints (no write API, no webhook URL, Cloud Function required). However it contains several inaccurate npm package characterisations, wrong alert-event names, a misleading import path/API call in the code example, and a mischaracterisation of `@google-cloud/error-reporting` as a read client. None of these are blockers individually, but together they would mislead the developer building the connector.

---

## Findings

### 1. Wrong alert event type names throughout (Section 3A, 6, 11)

**What the doc assumes:**
The doc invents its own event-type taxonomy:
- `crashlytics.newAnomalousIssue`
- `crashlytics.newIssue`
- `crashlytics.newRateThresholdFatal`
- `crashlytics.newRateThresholdNonfatal`
- `crashlytics.stalenessAlert`

**What is actually true:**
The official Eventarc/Cloud Functions event type names (per the Eventarc Standard docs and `firebase-functions@6.x` type declarations) are:

| Correct name | Maps to doc's intent |
|---|---|
| `crashlytics.newFatalIssue` | new fatal crash |
| `crashlytics.newNonfatalIssue` | new non-fatal error |
| `crashlytics.newAnrIssue` | new ANR |
| `crashlytics.regression` | regression (doc got this one right) |
| `crashlytics.velocity` | velocity/rate spike |
| `crashlytics.stabilityDigest` | trending issues digest |
| `crashlytics.missingSymbolFile` | symbolication failure |

`newAnomalousIssue`, `newRateThresholdFatal`, `newRateThresholdNonfatal`, and `stalenessAlert` do not appear anywhere in the official Firebase or Eventarc docs, the firebase-functions SDK source, or the `.d.ts` declarations. They appear to be hallucinated. The section 11 MVP list ("Handle: `newAnomalousIssue`, `velocityAlert`, `regression`, `newRateThresholdFatal`") needs a full rewrite using the actual names.

### 2. Wrong import path and wrong function name in the code example (Section 3A)

**What the doc assumes:**
```typescript
import { onCustomEventPublished } from "firebase-functions/alert/crashlytics";
```
And presents this as the way to handle a Crashlytics Firebase Alert.

**What is actually true:**
`onCustomEventPublished` does **not** exist in the `firebase-functions` alerts.crashlytics namespace. The actual v2 SDK (firebase-functions@6.x) exports six named, typed handlers:
- `onNewFatalIssuePublished`
- `onNewNonfatalIssuePublished`
- `onNewAnrIssuePublished`
- `onRegressionAlertPublished`
- `onVelocityAlertPublished`
- `onStabilityDigestPublished`

The correct import path is `firebase-functions/v2/alerts/crashlytics` (not `firebase-functions/alert/crashlytics`). A corrected example:

```typescript
import { onNewFatalIssuePublished } from "firebase-functions/v2/alerts/crashlytics";

export const crashlyticsHandler = onNewFatalIssuePublished(async (event) => {
  const payload = event.data.payload;
  // forward to SupportAgent dispatcher
});
```

Each handler accepts an optional `appId` string or `CrashlyticsOptions` object as a first argument, enabling per-app scoping without extra filtering logic.

### 3. `@google-cloud/error-reporting` mischaracterised as a read client (Section 12)

**What the doc assumes:**
"[Use] `@google-cloud/error-reporting` — Error Reporting API client (read-only)."

**What is actually true:**
`@google-cloud/error-reporting` is a **write-only** client. Its sole purpose is to report (write) errors from Node.js applications to GCP Error Reporting. It is the equivalent of an error logger. The IAM role required is `roles/errorreporting.writer`.

To **read** Error Reporting groups and events, you must call the REST API directly (e.g. `GET /v1beta1/projects/{id}/groupStats`) with `google-auth-library` tokens, or use the `@google-cloud/error-reporting`'s underlying REST surface via raw fetch. There is no read-oriented Node.js client library for Error Reporting; the doc should recommend raw fetch + `google-auth-library` for the read path, which is what Section 12 elsewhere recommends for "lightweight" cases anyway.

The required IAM role listed in Section 2 (`roles/errorreporting.reader`) is correct for the REST API read path, so the auth section is fine — only the package description is wrong.

### 4. `firebase-admin` dependency recommendation needs a caveat (Section 12)

**What the doc assumes:**
"Do not add `firebase-admin` unless needed for Cloud Function deployment."

**What is actually true:**
This guidance is correct, but incomplete. `firebase-admin` (currently v13.x) carries significant transitive weight — historically 80–100 MB installed, primarily due to gRPC binaries when Firestore is included. For a SupportAgent connector worker that only needs to forward alert events, `firebase-admin` is unnecessary. The doc should explicitly call out that Cloud Function trigger handling uses `firebase-functions` (not `firebase-admin`), and that `firebase-admin` is only needed if the connector directly accesses Firebase Auth, Firestore, or other Firebase services. Recommend using `--omit=optional` if it is pulled in transitively.

### 5. CloudEvent `type` value in sample payload is non-standard (Section 3A)

**What the doc assumes:**
```json
"type": "com.google.firebase.firebasecrashlytics.alerts.v1"
```

**What is actually true:**
The canonical Eventarc CloudEvent type for all Firebase Alerts is:
`google.firebase.firebasealerts.alerts.v1.published`

The alert type (`crashlytics.velocity`, etc.) is carried as an extension attribute (`alerttype`), not embedded in the CloudEvent `type`. The doc's invented type string would cause the connector to fail any real event filtering or routing logic built on the CloudEvent `type` field.

### 6. MVP alert-type list in Section 11 is partially unverifiable (Section 11)

**What the doc assumes:**
MVP should handle `newAnomalousIssue`, `velocityAlert`, `regression`, `newRateThresholdFatal`.

**What is actually true:**
As established in finding 1, `newAnomalousIssue` and `newRateThresholdFatal` do not exist. A defensible MVP set using real event names would be:
- `crashlytics.newFatalIssue` — highest-signal new issue event
- `crashlytics.newAnrIssue` — ANR events (Android-specific, high severity)
- `crashlytics.regression` — reopened issues
- `crashlytics.velocity` — crash-rate spike

`newNonfatalIssue` and `stabilityDigest` are reasonable Phase 2 additions rather than MVP.

### 7. Phase ordering is otherwise sound

BigQuery polling in Phase 2 (after real-time alerts in MVP) is a correct ordering — it does not require OAuth, just the service account JSON already needed for MVP. No phase-ordering concern.

### 8. Config field list is appropriate for MVP (Section 11)

`projectId`, `serviceAccountJson`, `appBundleIds`, and `alertTypes` are the right four fields. No unnecessary extras, nothing missing for MVP. Matches what is actually required to route an Eventarc trigger and query BigQuery.

### 9. Open questions raise the right blockers (Section 13)

Q1 (GCP project per tenant), Q3 (who manages Cloud Functions), Q4 (issue ID correlation), and Q6 (no outbound path) are all genuine deployment blockers. These are well-scoped.

Q2 (Firebase Alert vs. BigQuery primary) is framed correctly given the latency trade-off. Q5 (staleness alert) is a product question, though `stalenessAlert` is not a real event name — the closest real equivalent would be `stabilityDigest` combined with application-level logic.

### 10. Cross-connector consistency — inbound-only is correctly declared

The doc explicitly declares this connector as inbound-only with no delivery adapter required. SupportAgent's uniform delivery model is not broken; this is a legitimate asymmetric connector. No flag needed.

### 11. `@google-cloud/functions-framework` and `firebase-functions` — both exist and are correct (Section 12)

Both packages exist and are actively maintained:
- `@google-cloud/functions-framework` — lightweight Eventarc-compatible runtime, no Firebase CLI dependency, correct for a SupportAgent-deployed receiver
- `firebase-functions` — heavier, but provides the typed Crashlytics handler wrappers (see finding 2)

For a connector that wants typed handler ergonomics, `firebase-functions` is the right choice. For a raw Cloud Run receiver, `@google-cloud/functions-framework` is correct. The doc presents both as alternatives, which is accurate, but should note that typed handlers only exist in `firebase-functions`.

### 12. `@google-cloud/bigquery` — correct and well-characterised (Section 12)

Package exists, actively maintained, provides pagination (job result page tokens), TypeScript types included. The doc's recommendation to use it for BigQuery export queries is sound.

### 13. `google-auth-library` — correct (Section 12)

Package exists, actively maintained, underpins all GCP client libraries. Recommendation to use it for raw Error Reporting API reads is appropriate.

---

## Summary of Required Fixes

| Priority | Issue | Location |
|---|---|---|
| High | Replace all invented event type names with official names (`newFatalIssue`, `newNonfatalIssue`, `newAnrIssue`, `regression`, `velocity`, `stabilityDigest`) | §3A table, §6 table, §11 MVP list |
| High | Fix code example: import path and function name (`onNewFatalIssuePublished` from `firebase-functions/v2/alerts/crashlytics`) | §3A code block |
| High | Fix CloudEvent `type` field in sample payload to `google.firebase.firebasealerts.alerts.v1.published` | §3A payload sample |
| Medium | Correct `@google-cloud/error-reporting` description from "read-only" to "write-only / error-reporter; not a read client" | §12 |
| Medium | Add note on `firebase-admin` transitive weight and when it is truly needed | §12 |
| Low | Update Q5 in open questions — `stalenessAlert` is not a real event; use `stabilityDigest` as the closest analog | §13 |
