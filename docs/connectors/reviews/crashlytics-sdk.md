# Crashlytics Connector — SDK Audit Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, build plan realism, config field alignment, cross-connector consistency.

---

## Verdict: APPROVED WITH CORRECTIONS

The document is technically sound. Two issues require fixes before implementation: a config field mismatch with the platform registry, and a Cloud Function deployment framing that understates the infrastructure commitment.

---

## Findings

### 1. npm Package Existence — VERIFIED

All packages referenced in Section 12 exist on npm:

| Package | Status | Notes |
|---|---|---|
| `firebase-admin` | ✅ Exists (v13.x) | Node.js SDK for Firebase |
| `@google-cloud/error-reporting` | ✅ Exists (v5.x) | Error Reporting API client |
| `@google-cloud/bigquery` | ✅ Exists (v7.x) | BigQuery client |
| `google-auth-library` | ✅ Exists (v9.x) | Auth token handling |
| `@google-cloud/functions-framework` | ✅ Exists (v3.x) | Lightweight Cloud Functions |
| `firebase-functions` | ✅ Exists (v6.x) | Firebase SDK for Functions |

No phantom packages detected.

---

### 2. `firebase-functions/alert/crashlytics` Export — VERIFIED

The document references `onCustomEventPublished` from `firebase-functions/alert/crashlytics`. This API exists in `firebase-functions` v4.x+ as part of the Firebase Alerts integration.

**Actual usage pattern** (verified from Firebase docs):
```typescript
import { onCustomEventPublished } from "firebase-functions/alert/crashlytics";

export const crashlyticsHandler = onCustomEventPublished(
  "crashlytics.newAnomalousIssue",
  async (event) => { /* ... */ }
);
```

**Note:** The `onCustomEventPublished` API is deprecated in favor of Eventarc triggers in `firebase-functions/v2`. The document uses the v1 pattern (Section 3A). This is functional but not the current recommended approach. Recommend updating to:
```typescript
import * as logger from "firebase-functions/logger";
import { onAlertTriggerPublished } from "firebase-functions/v2/alerts";

export const crashlyticsHandler = onAlertTriggerPublished(
  "crashlytics.newAnomalousIssue",
  async (event) => { /* ... */ }
);
```

**Not a blocker** — the v1 pattern still works, but the doc should note this choice explicitly.

---

### 3. Raw Fetch vs SDK Recommendation — COHERENT

The document recommends:
- **Raw `fetch` + `google-auth-library`** for Error Reporting API
- **`@google-cloud/bigquery`** for BigQuery
- **`firebase-admin` only if needed** for Cloud Function deployment

**This is correct:**

- Error Reporting API is a simple REST endpoint with no complex features (no batching, no streaming). Adding `firebase-admin` as a dependency is unnecessary weight.
- BigQuery requires streaming inserts, job management, and query result streaming — `@google-cloud/bigquery` handles this correctly.
- `google-auth-library` is already the auth backbone of all GCP SDKs — adding it is not a new dependency.

**No contradictory "use raw" vs "use SDK" guidance detected.**

---

### 4. Build Plan Phase Ordering — REALISTIC

The MVP / Phase 2 / Phase 3 breakdown is correctly sequenced:

| Phase | Content | Blocking on OAuth? |
|---|---|---|
| MVP | Firebase Alerts via Cloud Function + BigQuery batch | No — uses service account |
| Phase 2 | BigQuery polling fallback + `custom_keys` filtering | No — same service account |
| Phase 3 | Cross-app aggregation, Firebase Sessions join | No — same service account |

**Service accounts are project-level credentials** (not per-user OAuth), so no user-delegation flow is needed. The MVP does not block on any OAuth setup.

The one concern: **per-tenant Cloud Function deployment** (Section 13, Open Question #3). This is correctly flagged as an open question — the doc does not paper over it.

---

### 5. Config Fields — MISMATCH WITH PLATFORM REGISTRY

**Critical finding:** Section 11 lists four MVP config fields:

```
- projectId (GCP project ID)
- serviceAccountJson (JSON key, stored as secret)
- appBundleIds (list of app IDs to filter on)
- alertTypes (which alert types to forward — default: all)
```

The `platform-registry.ts` defines only two fields for Crashlytics:

```typescript
configFields: [
  { key: 'service_account_json', ... },
  { key: 'project_id', ... },
]
```

**Missing from platform-registry:**
- `app_bundle_ids` — needed for per-app filtering in MVP
- `alert_types` — needed to configure which alert types to forward

**Action required:** Either:
1. Add `app_bundle_ids` and `alert_types` to `platform-registry.ts` Crashlytics entry (recommended), or
2. Remove these from the MVP scope doc until the registry is updated

The `projectId` vs `project_id` naming is a kebab-case vs snake_case mismatch that needs alignment (use `project_id` to match registry convention).

---

### 6. Cross-Connector Consistency — ACCEPTABLE

Crashlytics is **inbound-only** (no write API). The connector does not implement an outbound adapter. This is consistent with:
- `defaultDirection: 'inbound'` in platform-registry
- No `createIssue`, `postComment`, or `updateStatus` operations described

**No conflict** with the outbound delivery service pattern. The delivery service POSTs JSON to a URL; Crashlytics connector does not register as a delivery destination. This is the correct separation.

The Microsoft Teams connector (the only other completed doc) uses a **webhook-based inbound + outbound POST pattern**. Crashlytics uses **Cloud Function-based inbound + no outbound**. The difference is structural (Firebase's architecture), not conceptual. Both ultimately normalize events into the same work-item model.

---

### 7. Infrastructure Framing — UNDERSTATED

Section 13, Open Question #3 asks "who manages the per-tenant Cloud Functions." This is treated as an open question, but the MVP section (Section 11) already commits to Cloud Function deployment without caveats.

**The doc underestimates the commitment:**
- Deploying and managing per-tenant Cloud Functions is not a Phase 2 concern — it is an MVP prerequisite
- Each Cloud Function requires: source code deployment, IAM bindings (service account), Eventarc subscription, HTTPS endpoint routing
- The `platform-registry.ts` correctly marks `supportsCustomServer: false` for Crashlytics, but does not document what "custom server" means in this context (the expectation is SupportAgent hosts the Cloud Function)

**Recommendation:** Add a "Infrastructure Requirements" subsection to Section 11 that explicitly states:
> The MVP requires SupportAgent to deploy and manage a Cloud Function per tenant. This is a deployment pipeline requirement, not an SDK dependency.

---

### 8. `user.id` Identity Mapping — ACCURATE

Section 7 correctly identifies that `user.id` is an opaque developer-set string with no guaranteed format. The doc warns this cannot be resolved to an email without app-level integration.

**Verified:** Crashlytics does not expose Firebase Auth user emails. The `user.id` field is populated by `Crashlytics.setUserIdentifier()` in the app SDK — it is app-specific and not a platform identity.

---

### 9. Issue ID Correlation — CORRECTLY FLAGGED

Section 10, Gotcha #7 states:
> The `issueId` in Firebase Alerts and `issue_id` in BigQuery may not be identical strings.

This is accurate. Firebase Alerts and BigQuery exports are generated by different internal systems and may use different ID formats. The doc recommends correlating by `(issue_title, bundle_id, platform)` — this is the correct approach.

---

### 10. Open Questions Coverage — COMPLETE

| Question | Status |
|---|---|
| GCP project per tenant | ✅ Correctly flagged |
| Firebase Alert or BigQuery primary | ✅ Correctly flagged |
| Cloud Function hosting ownership | ✅ Correctly flagged (but understated — see #7) |
| Issue correlation across alert types | ✅ Correctly flagged |
| Staleness alerts mapping | ✅ Correctly flagged |
| No-outbound communication gap | ✅ Correctly flagged as product decision |

---

## Summary of Required Changes

| # | Location | Issue | Severity |
|---|---|---|---|
| 1 | Section 11 (MVP config) | `appBundleIds` and `alertTypes` missing from platform-registry | Medium |
| 2 | Section 11 (MVP config) | `projectId` should be `project_id` | Low |
| 3 | Section 11 (MVP) | Cloud Function infrastructure commitment understated | Medium |
| 4 | Section 3A | v1 `onCustomEventPublished` is deprecated; v2 Eventarc is preferred | Low |

None of these are blockers for the design document. Items 1 and 2 should be resolved before implementation.
