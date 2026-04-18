# Auth Review: Crashlytics Connector

**Verdict:** Mostly correct on the fundamentals, but contains several inaccuracies and gaps that would cause misconfigured deployments. The IAM role list for Eventarc routing is wrong, the OAuth scope description is incomplete, the CloudEvent `type` field value is wrong, the `cloudfunctions.invoker` role recommendation is outdated for 2nd-gen functions, and the document omits Workload Identity Federation as the GCP-recommended alternative to JSON key files.

---

## Findings

### 1. Wrong IAM role for Eventarc / Cloud Function invocation

**Issue:** Section 2 lists `roles/cloudfunctions.invoker` as the role needed "for triggering Cloud Functions that handle alerts." This is only correct for 1st-gen Cloud Functions. The document recommends Cloud Functions v2 / Eventarc in Section 3A.

**Why it matters:** Cloud Functions (2nd gen) are built on Cloud Run. Eventarc requires the trigger's service account to have `roles/run.invoker`, not `roles/cloudfunctions.invoker`. Granting the wrong role will silently prevent alert delivery — Eventarc will authenticate but the invocation will be rejected with 403.

**Correction:** Replace `roles/cloudfunctions.invoker` with `roles/run.invoker` in the service account role list. Add a note: `roles/cloudfunctions.invoker` applies only to 1st-gen Cloud Functions, which are not the recommended path here.

---

### 2. Missing Crashlytics-native IAM roles

**Issue:** The document only lists `roles/errorreporting.reader` and `roles/bigquery.dataViewer` for the service account, omitting the Firebase Crashlytics-specific predefined roles.

**Why it matters:** The GCP IAM reference defines three Crashlytics-native roles:
- `roles/firebasecrashlytics.viewer` — read-only access to Crashlytics resources
- `roles/firebasecrashlytics.admin` — full read/write access
- `roles/firebasecrash.symbolMappingsAdmin` — symbol file management

For an inbound-only connector, `roles/firebasecrashlytics.viewer` is the least-privilege choice and should be listed explicitly. Using only `roles/errorreporting.reader` may not grant access to all Crashlytics data surfaces (the Error Reporting API and the Crashlytics console use different data layers).

**Correction:** Add `roles/firebasecrashlytics.viewer` to the required roles. Clarify which role grants access to which surface (Error Reporting API vs. Crashlytics data).

---

### 3. OAuth scope is incomplete

**Issue:** Section 2 states the required OAuth scope is only `https://www.googleapis.com/auth/cloud-platform`. The Error Reporting API actually accepts either of two scopes:
- `https://www.googleapis.com/auth/cloud-platform`
- `https://www.googleapis.com/auth/stackdriver-integration`

**Why it matters:** The `stackdriver-integration` scope is narrower than `cloud-platform` and is the least-privilege option for Error Reporting API access specifically. Omitting it means implementers cannot choose the minimum-scope path, which contradicts least-privilege security practice.

**Correction:** Document both accepted scopes. Recommend `https://www.googleapis.com/auth/stackdriver-integration` when only Error Reporting API access is needed, and `https://www.googleapis.com/auth/cloud-platform` when BigQuery access is also required (BigQuery does not accept the stackdriver scope).

---

### 4. CloudEvent `type` field is incorrect in the payload example

**Issue:** Section 3A shows the CloudEvent `type` field as:
```
"type": "com.google.firebase.firebasecrashlytics.alerts.v1"
```

**Why it matters:** The actual Eventarc event type used by Firebase Alerts is:
```
google.firebase.firebasealerts.alerts.v1.published
```
This is the canonical type string used in `gcloud eventarc triggers create --event-filters="type=..."` and in every official Eventarc routing example. The `com.google.*` prefix is not a GCP event type format; GCP uses the `google.*` reverse-DNS format. Code or trigger configuration using the wrong type string will simply never match any events.

**Correction:** Update the `type` field in the payload example to `google.firebase.firebasealerts.alerts.v1.published`.

---

### 5. CloudEvent `source` field format is questionable

**Issue:** The example payload shows:
```
"source": "//firebasecrashlytics.googleapis.com/projects/{projectNumber}"
```

**Why it matters:** The GCP resource name format for Eventarc uses `//firebasecrashlytics.googleapis.com/projects/{projectId}` (project ID, not project number). Google's own example payloads use project ID strings in the source. Using project number here is inconsistent and may cause tenant routing bugs if the connector parses the source field to extract project identity.

**Correction:** Clarify whether the source field contains project ID or project number, and verify against the actual delivered payload. If uncertain, do not rely on parsing the `source` field for tenant routing — use `subject` instead (which the document already recommends).

---

### 6. `roles/errorreporting.reader` may not exist

**Issue:** The document uses `roles/errorreporting.reader` as the role for Error Reporting API reads. The canonical IAM role is `roles/errorreporting.viewer` (viewer, not reader).

**Why it matters:** If the wrong role name is used in Terraform, `gcloud`, or IaC provisioning scripts, the grant will fail or not be recognized. GCP IAM role names are exact strings.

**Correction:** Verify the exact role name against the IAM reference. The standard GCP pattern for read-only roles uses `viewer` not `reader`. Replace `roles/errorreporting.reader` with `roles/errorreporting.viewer` if that is the correct name, or document the exact role name from the IAM reference.

---

### 7. Service account JSON key recommended without security caveat

**Issue:** Section 2 recommends service account JSON keys as the MVP authentication approach with no mention of the security risks or GCP's own guidance against them.

**Why it matters:** GCP documentation explicitly states that service account keys are a security risk if not managed correctly, that they have no expiry by default, and that Workload Identity Federation (WIF) is the recommended alternative for workloads running outside Google Cloud. Recommending JSON keys without caveats is security advice that could lead to long-lived credential exposure, especially since the document targets a SaaS-style multi-tenant system where per-customer keys would be stored in application config.

**Correction:** Add a security caveat to the JSON key recommendation. Document Workload Identity Federation as the preferred alternative when SupportAgent runs on a platform that supports it (e.g., GKE, Cloud Run, or an external OIDC-capable provider). At minimum, note that keys should be stored in Secret Manager, not plaintext config, and should have a rotation policy.

---

### 8. "No OAuth2 user-flow exists" is correct but incomplete

**Issue:** Section 2 states "No OAuth2 user-flow exists for Crashlytics — service accounts are the only option." This is correct for the data APIs, but the statement could be misread as covering the Eventarc delivery path.

**Why it matters:** Eventarc event delivery to Cloud Run / Cloud Functions uses signed JWTs issued by Google's internal Workload Identity service — this is a form of OAuth2 token, just not a user-interactive flow. The document does mention "signed JWT in Authorization: Bearer from Workload Identity Federation" in Section 3A, which contradicts the Section 2 statement if read broadly.

**Correction:** Scope the Section 2 statement more precisely: "No OAuth2 user-flow exists for accessing Crashlytics data APIs — service accounts (or Workload Identity Federation) are the only options." Keep the Section 3A description of Eventarc JWT delivery as-is, since it describes the delivery authentication, not the data-read authentication.

---

### 9. Eventarc delivery authentication description is vague

**Issue:** Section 3A states Eventarc delivers events "with a signed JWT in `Authorization: Bearer` from Workload Identity Federation" and that "Firebase SDK handles signature verification automatically." This is correct for Cloud Functions using the Firebase SDK, but the explanation is too thin for implementers who might deploy a standalone HTTP receiver or Cloud Run service instead.

**Why it matters:** If SupportAgent deploys a Cloud Run receiver (rather than a Cloud Functions SDK-wrapped handler), automatic JWT verification does not happen. The implementer must manually validate the OIDC token in the `Authorization` header. The issuer is `https://accounts.google.com`, and the audience is the Cloud Run service URL. Skipping this check would allow any caller to inject fake Crashlytics events.

**Correction:** Add a note clarifying that automatic verification only applies when using the Firebase Functions SDK. For standalone Cloud Run receivers, document the OIDC token validation requirement: verify `iss = https://accounts.google.com`, `aud = <service URL>`, and that the email claim matches the Eventarc service account. Reference the Cloud Run authentication docs.

---

### 10. No replay protection described for Eventarc delivery

**Issue:** The document mentions "at-least-once delivery" but does not describe replay protection or idempotency requirements for the incoming event handler.

**Why it matters:** At-least-once delivery means the same alert event can be delivered more than once. Without idempotency on the receiver side (keyed on the CloudEvent `id` field), duplicate triage runs can be triggered for the same crash event.

**Correction:** Add a note that the receiver must be idempotent. The CloudEvent `id` field (unique per event) should be used to deduplicate: store seen IDs or use the `issueId` + `alertType` + event timestamp as a deduplication key. This is a correctness concern, not just a performance one.

---

### 11. Secret-type classification not stated

**Issue:** The platform-registry requires a `secret_type` classification for each credential. The document never classifies the service account JSON key with a registry type (e.g., `service_account`, `api_key`, `oauth2_client`, `webhook_secret`).

**Why it matters:** Inconsistent classification makes connector config schema generation ambiguous and can lead to incorrect secret storage behavior (e.g., storing a service account JSON as a simple string vs. a structured credential object).

**Correction:** Add an explicit `secret_type: service_account` classification for `serviceAccountJson` in the connector config section (Section 11). If the registry uses a different canonical name, use that instead and document it.

---

## Summary of Corrections Required

| # | Location | Severity | Change |
|---|---|---|---|
| 1 | Section 2, IAM roles | High | `cloudfunctions.invoker` → `run.invoker` for v2 / Eventarc targets |
| 2 | Section 2, IAM roles | Medium | Add `roles/firebasecrashlytics.viewer` |
| 3 | Section 2, OAuth scopes | Medium | Add `stackdriver-integration` as least-privilege alternative |
| 4 | Section 3A, CloudEvent payload | High | Fix `type` to `google.firebase.firebasealerts.alerts.v1.published` |
| 5 | Section 3A, CloudEvent payload | Low | Clarify project ID vs. project number in `source` |
| 6 | Section 2, IAM roles | High | Verify `errorreporting.reader` vs. `errorreporting.viewer` |
| 7 | Section 2, MVP recommendation | Medium | Add WIF alternative and security caveat for JSON keys |
| 8 | Section 2, OAuth statement | Low | Scope the "no OAuth2 user-flow" claim to data APIs only |
| 9 | Section 3A, verification | High | Document manual OIDC verification for non-SDK Cloud Run receivers |
| 10 | Section 3A, retry semantics | Medium | Add idempotency / deduplication requirement on `id` field |
| 11 | Section 11, config fields | Low | Add `secret_type: service_account` classification |
