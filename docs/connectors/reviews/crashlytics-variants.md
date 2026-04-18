# Review: crashlytics.md — Hosting Variants & API Versions

**Reviewer scope:** Cloud vs self-hosted coverage, API version accuracy, base URL correctness, feature matrix, deprecations, regional/gov-cloud variants, breaking-change straddling.

**Overall verdict:** ACCURATE. No material errors. One minor ambiguity and two optional enhancements noted below.

---

## Findings

### 1. Cloud-only declaration

**Variant:** Firebase Crashlytics — cloud-only
**What the doc says:** "**Cloud-only:** Yes — no self-hosted variant." (line 6)
**Verdict:** Correct. Firebase has no on-premise, self-managed, or air-gapped variant. Verified against Firebase documentation and GCP API discovery — no alternative surface exists.

### 2. Error Reporting API version

**Variant:** Error Reporting API
**What the doc says:** `v1beta1` used throughout (lines 311–312, Section 3A payload `source`, Section 8). No mention of a `v1` equivalent.
**Verdict:** Correct. GCP API discovery confirms only one version exists — `v1beta1`. There is no GA `v1` for the Error Reporting API. The v1beta1 is marked `preferred: true` with no deprecation notice in the discovery document.

**Optional enhancement (non-blocking):** Add a footnote: "The Error Reporting API has no GA v1 release. v1beta1 is the only available and preferred version." This prevents future confusion if a v1 lands.

### 3. BigQuery API version

**Variant:** BigQuery export
**What the doc says:** References `bigquery.googleapis.com` but does not explicitly state the API version.
**Verdict:** Subtle gap. BigQuery API is **v2** (verified via GCP discovery — `bigquery:v2`, `preferred: true`). Section 8 mentions BigQuery quotas but never names the version. For completeness, state `bigquery.googleapis.com/bigquery/v2` as the base.

**Correction (optional):** In Section 3B "BigQuery Export" and Section 8 "BigQuery," explicitly call out "BigQuery API v2" so readers know which surface they're programming against.

### 4. Eventarc version ambiguity

**Variant:** Firebase Alerts via Eventarc
**What the doc says:** "Firebase Alerts deliver push events to Cloud Functions (v1) or Eventarc (v2)" (Section 3A intro, line 46).
**Verdict:** Ambiguous but not wrong. There is no Eventarc v2 API — the API is **v1** (verified: `eventarc:v1` in discovery, `preferred: true`). The "(v2)" likely refers to the **Cloud Events spec version 2** (Cloud Events spec v1 is obsolete; current spec is v1.0.2, often colloquially called "v2"). The payload example in Section 3A confirms Cloud Events v1.0.2 format (`"specversion": "1.0"`). This is a wording issue, not a factual error.

**Correction:** Rewrite as "Firebase Alerts deliver push events via Cloud Functions (1st gen) or Eventarc (Cloud Events v1.0.2 format)" to disambiguate the Cloud Functions generation model from the Cloud Events spec version.

### 5. Base URL patterns

**What the doc says:**
- Error Reporting: `clouderrorreporting.googleapis.com` (Section 3A payload `source`, Section 8)
- BigQuery: implied `bigquery.googleapis.com` (Section 3B)
- Eventarc: not used directly by connector code (relay only)

**Verdict:** Correct. Verified via discovery:
- Error Reporting: `rootUrl: "https://clouderrorreporting.googleapis.com/"`, `servicePath: ""`
- BigQuery: `rootUrl: "https://bigquery.googleapis.com/"`, `servicePath: "bigquery/v2/"`
- Eventarc: `rootUrl: "https://eventarc.googleapis.com/"`, `servicePath: ""`

No variant-specific base URLs exist (no EU-specific GCP endpoints for these APIs).

### 6. `is_fatal` deprecation

**What the doc says:** "**`is_fatal` is deprecated.** Use `error_type` (FATAL / NON_FATAL / ANR) instead." (line 344)
**Verdict:** Correct. Firebase BigQuery schema documentation explicitly marks `is_fatal` as deprecated and directs users to `error_type`. The deprecation is stated without a specific sunset date — this is accurate as Firebase does not publish sunset dates for BigQuery schema fields in the public schema reference.

### 7. Regional / data-residency variants

**What the doc says:** No regional variants mentioned.
**Verdict:** Correct. Firebase Crashlytics has no region-specific API endpoints, no EU-specific variant, no government-cloud-specific variant. The underlying GCP project can be placed in a regional or multi-regional location (us-central, europe-west, asia-east, etc.), and all Crashlytics data flows through that project's regional infrastructure. Crashlytics does not appear in Firebase's project-location settings (products like Firestore and Cloud Storage appear there; Crashlytics does not), indicating Crashlytics inherits the project's multi-region configuration automatically. The doc correctly avoids claiming any regional nuance.

**Note:** For completeness, the doc could add a one-liner: "Crashlytics inherits the GCP project's regional/multi-regional location. No separate regional configuration exists." This helps operators understand data residency implications.

### 8. Feature matrix — no tier restrictions

**What the doc says:** No claims of EE/premium-only features. All surfaces (Error Reporting API, Firebase Alerts, BigQuery export) are available to all Firebase plans that support Crashlytics (Spark and Blaze).
**Verdict:** Correct. Crashlytics and its associated APIs (Error Reporting, Eventarc, BigQuery export) are not gated by Firebase plan tier in ways that affect connector design. No enterprise-only features are claimed.

### 9. Self-hosted minimum version requirements

**What the doc says:** N/A — no self-hosted variant.
**Verdict:** Not applicable. Correctly omitted.

### 10. SSO / SCIM / audit features

**What the doc says:** N/A — not covered in this connector doc.
**Verdict:** Not applicable. Firebase Identity (Firebase Auth) is orthogonal to Crashlytics data access. Service account permissions (`roles/errorreporting.reader`, `roles/bigquery.dataViewer`) are the correct model and are covered in Section 2.

### 11. Other platforms mentioned in scope list

The following platforms are listed in the audit scope but are **not applicable to Crashlytics** and are correctly absent from the doc:

| Platform | Applicable? | Reason |
|---|---|---|
| GitHub (cloud + GHE Server + GHE Cloud) | No | Crashlytics is not GitHub |
| GitLab (gitlab.com + self-managed CE/EE/Dedicated) | No | Crashlytics is not GitLab |
| Bitbucket (Cloud + Data Center + Server) | No | Crashlytics is not Bitbucket |
| Jira (Cloud + Data Center + Server) | No | Crashlytics is not Jira |
| Sentry (sentry.io + on-premise) | No | Sentry is a separate product |
| Linear | No | Not Crashlytics |
| Trello | No | Not Crashlytics |
| Slack / Teams / WhatsApp | No | These are outbound notification channels; Crashlytics is read-only and has no webhook registration |

**The hosting-variants scope correctly applies only to Firebase Crashlytics' actual surface: cloud-only, no variants.**

### 12. Breaking changes between API versions

**What the doc says:** N/A — only one version of Error Reporting API exists.
**Verdict:** Not applicable. No version-straddling concerns.

---

## Summary

| Area | Status |
|---|---|
| Cloud-only declaration | ✅ Accurate |
| Error Reporting API v1beta1 | ✅ Accurate |
| BigQuery API version stated | ⚠️ Missing (v2, should add) |
| Eventarc version wording | ⚠️ Ambiguous ("v2" should clarify Cloud Events spec) |
| Base URL patterns | ✅ Accurate |
| `is_fatal` deprecation | ✅ Accurate |
| Regional/gov-cloud variants | ✅ Correctly absent |
| Feature tier restrictions | ✅ Correctly absent |
| Self-hosted variants | ✅ Correctly absent |
| Breaking-change straddling | ✅ N/A — single version |

**One required action:** Clarify "Eventarc (v2)" wording to prevent confusion between Eventarc API version and Cloud Events spec version.

**Two recommended additions (non-blocking):**
1. Note that Error Reporting API v1beta1 is the only version and has no GA v1.
2. Explicitly name BigQuery API v2 where the BigQuery surface is discussed.
