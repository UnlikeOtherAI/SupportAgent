# Crashlytics Connector Doc Review — Hosting Variants & Version Drift

**Source:** `docs/connectors/crashlytics.md`
**Reviewer focus:** hosting modes, API version correctness, deprecations, regional gotchas, feature tier differences
**Date:** 2026-04-18

---

## Verdict

**Mostly accurate with several concrete errors.** The doc correctly identifies Crashlytics as cloud-only and read-only. The fundamental architecture (Firebase Alerts + BigQuery + Error Reporting API) is correct. However, the alert event type names are wrong throughout, the CloudEvent payload shape does not match the real schema, the Error Reporting API quota numbers are wrong, the BigQuery table naming omits the `firebase_crashlytics` dataset prefix, one deprecated-field note is missing, and the `is_fatal` deprecation note undersells the full picture.

---

## Findings

### F1 — Alert event type names are wrong across the board

**Variant affected:** All (cloud-only platform, but affects all usage)

**What the doc says (Section 3A, table):**
```
crashlytics.newAnomalousIssue
crashlytics.newIssue
crashlytics.regression
crashlytics.velocityAlert
crashlytics.newRateThresholdFatal
crashlytics.newRateThresholdNonfatal
crashlytics.stalenessAlert
```

**Correction:** The actual alert type strings as documented by Firebase (confirmed against `firebase-functions` v7 TypeScript declarations and the Cloud Functions for Firebase reference docs) are:

```
crashlytics.newFatalIssue
crashlytics.newNonfatalIssue
crashlytics.newAnrIssue
crashlytics.regression
crashlytics.velocity
crashlytics.stabilityDigest
crashlytics.missingSymbolFile
```

Specific divergences:
- `crashlytics.newAnomalousIssue` — does not exist. The nearest match is `crashlytics.newFatalIssue` or `crashlytics.newNonfatalIssue`. There is no "anomalous" variant in the public API.
- `crashlytics.newIssue` — does not exist. New issues are split by type: `crashlytics.newFatalIssue`, `crashlytics.newNonfatalIssue`, `crashlytics.newAnrIssue`.
- `crashlytics.velocityAlert` — wrong. Correct name is `crashlytics.velocity`.
- `crashlytics.newRateThresholdFatal` — does not exist as a separate alert type. Rate/velocity thresholds are covered by `crashlytics.velocity`.
- `crashlytics.newRateThresholdNonfatal` — does not exist.
- `crashlytics.stalenessAlert` — does not exist in any documented Firebase Alert type.
- `crashlytics.stabilityDigest` (trending/digest alert) and `crashlytics.missingSymbolFile` are real types the doc omits entirely.

The corresponding SDK function names are:
- `onNewFatalIssuePublished`
- `onNewNonfatalIssuePublished`
- `onNewAnrIssuePublished`
- `onRegressionAlertPublished`
- `onVelocityAlertPublished`
- `onStabilityDigestPublished`

---

### F2 — CloudEvent type string in payload example is wrong

**Variant affected:** Cloud (Eventarc path, Section 3A)

**What the doc says:**
```json
"type": "com.google.firebase.firebasecrashlytics.alerts.v1"
```

**Correction:** The canonical CloudEvent type for all Firebase Alerts (including Crashlytics) is:
```
google.firebase.firebasealerts.alerts.v1.published
```
The alert type is communicated via a separate `alerttype` extension attribute, not via the `type` field. The `source` field is also wrong: the doc shows `//firebasecrashlytics.googleapis.com/projects/{projectNumber}` but the real source is `//firebasealerts.googleapis.com/projects/{projectNumber}`.

---

### F3 — CloudEvent payload shape does not match real schema

**Variant affected:** Cloud (Eventarc path, Section 3A)

**What the doc says:** The payload example shows `payload.issueId`, `payload.issueTitle`, `payload.firstVersion`, `payload.latestVersion`, `payload.platform`, `payload.bundleId`, `payload.crashCount`, `payload.impactedSessions`, `payload.impactedDevices`, `payload.unaffectedDevices`, `payload.priority`.

**Correction:** The real Crashlytics alert payload (from `NewFatalIssuePayload`, `VelocityAlertPayload`, etc. in the firebase-functions SDK) has this shape:
```
data.payload.issue.id
data.payload.issue.title
data.payload.issue.subtitle
data.payload.issue.appVersion
```
The `data` wrapper also uses `@type` (a proto type URL), `createTime`, and `endTime` fields. Fields like `crashCount`, `impactedSessions`, `impactedDevices`, `unaffectedDevices`, `priority`, `firstVersion`, `latestVersion`, `bundleId`, and `platform` are not top-level payload fields in the documented SDK types. The velocity payload contains crash-rate details, not generic session counts. The doc's payload is partially invented or conflated with BigQuery schema fields.

The `subject` field format `projects/{projectId}/apps/{appId}` is plausible for CloudEvents context but is not the documented `subject` shape; `appId` is a top-level CloudEvent extension attribute (`appid`), not embedded in `subject`.

---

### F4 — Error Reporting API quota numbers are wrong

**Variant affected:** Cloud (Section 8)

**What the doc says:**
> Default 600 requests/minute per project

**Correction:** Per the official GCP Error Reporting quotas page, the actual limits are:
- Error event data requests: **60 per minute per user**
- Error group metadata requests: **60 per minute per user**
- Error reports ingested: **6,000 per minute** (ingest, not read)

There is no documented 600 req/min per-project limit for the read API. The doc overstates the default read quota by 10x.

---

### F5 — Error Reporting API rate-limit header claim is unverified

**Variant affected:** Cloud (Section 8)

**What the doc says:**
> Exposed via: Standard GCP rate limit headers (`X-RateLimit-Limit`, `Retry-After`)

**Correction:** GCP APIs typically return `429 Too Many Requests` with a `Retry-After` header or a structured error body with `status: RESOURCE_EXHAUSTED`, not `X-RateLimit-Limit`. The Error Reporting API does not document `X-RateLimit-Limit` headers — that header pattern is associated with GitHub's API, not GCP. This claim should be removed or replaced with accurate GCP quota error handling guidance.

---

### F6 — BigQuery table naming omits the dataset prefix

**Variant affected:** Cloud (Section 3B, table naming)

**What the doc says:**
> Batch table: `{bundleId}` (e.g., `com_example_myapp_ANDROID`)
> Realtime table: `{bundleId}_REALTIME`

**Correction:** Tables live inside a dataset named `firebase_crashlytics`. The fully qualified reference is:
```
{projectId}.firebase_crashlytics.{bundle_id_with_underscores}_{PLATFORM}
```
The `_REALTIME` suffix for the streaming table is correct. The platform suffix is `_IOS` (not `_ANDROID` only); iOS apps use `_IOS`. The doc's example only shows `_ANDROID` — acceptable as an example, but the prose should note both `_IOS` and `_ANDROID` suffixes.

The doc's example SQL query in Section 3B also omits the dataset prefix, which would make the query fail as written.

---

### F7 — BigQuery new export infrastructure migration not mentioned

**Variant affected:** Cloud (Section 3B)

**What the doc says:** No mention of any infrastructure version differences.

**Correction:** In October 2024, Firebase launched a new batch export infrastructure. As of March 2, 2026, all projects have been automatically migrated. The key behavioral difference: the old infrastructure named batch tables using bundle IDs/package names from the app binary; the new infrastructure uses the bundle IDs/package names registered in the Firebase project console. Projects migrated before the cutoff may have had data split across differently-named tables. This is a known gotcha that should be noted in Section 10 (gotchas) and Section 3B.

---

### F8 — `is_fatal` deprecation note is correct but incomplete

**Variant affected:** Cloud (Section 10, gotcha #9)

**What the doc says:**
> `is_fatal` is deprecated. Use `error_type` (FATAL / NON_FATAL / ANR) instead.

**Correction:** This is accurate. Additionally, the official schema docs also flag `user.email` and `user.name` as deprecated fields that should not be used. The doc correctly treats `user.id` as the active user field (Section 7) but does not mention the deprecated sibling fields. This is a minor gap rather than an error.

---

### F9 — `priority` field on alert payload does not exist as documented

**Variant affected:** Cloud (Sections 3A and 5)

**What the doc says (Section 3A payload example):**
```json
"priority": "HIGH"
```
And Section 5 defines a priority model with HIGH / MEDIUM / LOW values said to come from alert-rule level.

**Correction:** The Firebase Crashlytics alert payload has no documented `priority` field. The SDK types (`NewFatalIssuePayload`, `VelocityAlertPayload`, etc.) do not include a `priority` property. Firebase Alerts do not assign issue priorities — the console shows severity indicators but these are not surfaced in the programmatic payload. This entire priority model described in Section 5 appears to be invented. Remove or replace with documentation of what is actually in each payload type.

---

### F10 — Issue ID correlation concern (Gotcha #7) is understated

**Variant affected:** Cloud (Section 10, gotcha #7)

**What the doc says:**
> The Firebase Alert `issueId` may differ from BigQuery's `issue_id` due to different internal systems

**Correction:** This concern is real but the doc should be more concrete: the Firebase Alert payload field is `issue.id` (nested under `issue`), not a top-level `issueId`. The relationship between `issue.id` in alerts and `issue_id` in BigQuery has not been confirmed as stable across all alert types. The alert payload also exposes `issue.appVersion` but not the full version range available in BigQuery. This warrants a concrete integration note, not just a vague warning.

---

### F11 — `stalenessAlert` trigger entry in Section 6 should be removed

**Variant affected:** Cloud (Section 6 trigger table)

**What the doc says:**
> `alertType` = `stalenessAlert` listed as a usable trigger dimension

**Correction:** `crashlytics.stalenessAlert` is not a real Firebase Alert type (see F1). This row in the trigger table should be removed. The `crashlytics.stabilityDigest` type (trending issues digest) and `crashlytics.missingSymbolFile` should be added if those triggers are useful.

---

### F12 — `newRateThresholdFatal` and `newRateThresholdNonfatal` in Section 11 (MVP scope) should be removed

**Variant affected:** Cloud (Section 11)

**What the doc says:**
> Handle: `newAnomalousIssue`, `velocityAlert`, `regression`, `newRateThresholdFatal`

**Correction:** None of these names are correct. The MVP scope should reference the real event types: `crashlytics.newFatalIssue`, `crashlytics.newNonfatalIssue`, `crashlytics.newAnrIssue`, `crashlytics.regression`, `crashlytics.velocity`.

---

## Summary of Items to Fix

| # | Section | Severity | Issue |
|---|---------|----------|-------|
| F1 | 3A, 6, 11 | Critical | All 7 alert event type names are wrong; use documented names |
| F2 | 3A | Critical | CloudEvent `type` string and `source` are wrong |
| F3 | 3A | High | Payload shape is largely invented; use SDK type definitions |
| F4 | 8 | High | Error Reporting API quota stated as 600/min/project; actual is 60/min/user |
| F5 | 8 | Medium | `X-RateLimit-Limit` header is a GitHub pattern, not GCP |
| F6 | 3B | Medium | Dataset `firebase_crashlytics` prefix missing from table names and SQL |
| F7 | 3B, 10 | Medium | New batch export infrastructure (March 2026 migration) not mentioned |
| F8 | 10 | Low | `user.email` and `user.name` deprecated fields not noted |
| F9 | 3A, 5 | High | `priority` field in payload is undocumented/does not exist |
| F10 | 10 | Low | Issue ID correlation note uses wrong field name (`issueId` vs `issue.id`) |
| F11 | 6 | Medium | `stalenessAlert` trigger row should be removed |
| F12 | 11 | High | MVP scope references non-existent alert type names |

---

## Items Verified as Correct

- Cloud-only deployment: confirmed. No self-hosted variant exists.
- No public write API: confirmed. Read-only connector design is accurate.
- Service account is the only auth mechanism: confirmed.
- BigQuery batch table backfill up to 30 days: confirmed.
- Realtime tables have no backfill: confirmed.
- `is_fatal` deprecated in favour of `error_type`: confirmed.
- `user.id` is app-specific and opaque: confirmed.
- BigQuery table suffix pattern (`_ANDROID`, `_IOS`): confirmed (with dataset prefix caveat, F6).
- At-least-once delivery semantics for Eventarc: confirmed.
- No per-issue label/tag system in Crashlytics: confirmed.
- `custom_keys` in BigQuery as the closest analog to labels: confirmed.
- Streaming export requires Blaze (pay-as-you-go) plan: confirmed.
- Eventarc delivers via signed JWT (Workload Identity Federation): confirmed.
- Cloud Function required as receiver (no direct webhook URL): confirmed.
