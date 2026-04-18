# Crashlytics Connector — Authentication & Credentials Review

**Verdict: APPROVED WITH NOTES — one verifiable role name error, one missing nuance on org policy**

---

## 1. Error Reporting Role Name Is Non-Standard

**Affected section:** Section 2, "Service Account (JSON key)"

The document specifies the GCP role as `roles/errorreporting.reader`.

**Issue:** GCP predefined roles for Cloud Error Reporting follow the `clouderrorreporting.*` prefix pattern (e.g., `roles/clouderrorreporting.user`, `roles/clouderrorreporting.admin`). I could not verify that `roles/errorreporting.reader` exists as a valid predefined role.

**Why it matters:** If the role name is wrong, the connector setup instructions fail silently — the service account gets created but is denied read access. Users would spend hours debugging "why is my Error Reporting API returning 403?"

**Concrete correction:** Change `roles/errorreporting.reader` to `roles/clouderrorreporting.user`. The `clouderrorreporting.user` role includes `clouderrorreporting.errorGroups.get` and `clouderrorreporting.errorEvents.list` — the permissions needed for reading issues and events. If a read-only subset is needed, check whether `clouderrorreporting.viewer` is a valid predefined role; if not, `clouderrorreporting.user` is the minimum read role.

---

## 2. Service Account Key Expiration — Incomplete Org Policy Context

**Affected section:** Section 2, "Token lifetime"

The document states: "Service account keys never expire unless rotated."

**Issue:** This is the **default behavior**, but the document omits a critical exception. GCP organizations created on or after **May 3, 2024** have `iam.disableServiceAccountKeyCreation` enforced by default. This means new service account key creation is blocked at the org level unless explicitly exempted. Additionally, the inverse constraint `iam.requireServiceAccountKeyValidityPeriod` can be set at the org level to enforce a maximum validity period (e.g., 30 days) for all service account keys.

**Why it matters:** If SupportAgent is deployed to a customer using a post-May 2024 GCP organization, key creation fails at the GCP Console step. The MVP recommendation ("store service account JSON") would be impossible to follow without knowing about the org policy exemption. This is not hypothetical — new GCP organizations default to this constraint.

**Concrete correction:** Add a note under "How to obtain":

> **Org policy note:** If the customer's GCP organization was created after May 2024, the `iam.disableServiceAccountKeyCreation` constraint may be enforced by default, blocking key creation at the console. The customer's org admin must create an exemption for the service account before key creation is possible. Alternatively, use Workload Identity Federation to avoid service account key files entirely.

---

## 3. `defaultIntakeMode` Is Inconsistent With Architecture

**Affected section:** Section 2 / platform-registry (crashlytics entry)

The platform registry entry for `crashlytics` specifies `defaultIntakeMode: 'webhook'`.

**Issue:** Firebase Alerts are not traditional webhooks. They require deploying and hosting a Cloud Function — the customer cannot just register a URL. This is architecturally closer to `manual` or a distinct `cloud-function` mode than a standard `webhook` intake pattern where you paste a URL into a third-party UI.

**Why it matters:** The `defaultIntakeMode` field drives UI and automation behavior. If downstream code branches on `webhook` to show a "paste your webhook URL" field, the Crashlytics connector would show the wrong configuration UI.

**Concrete correction:** Either:
- Change `defaultIntakeMode` to `'manual'` with a note that Cloud Function deployment is required, or
- Add a new mode `'cloud-function'` if other connectors (e.g., Eventarc-based) share this pattern, and document it

The document itself (Section 11) acknowledges the Cloud Function requirement — this should be reflected in the registry entry.

---

## 4. Firebase Alerts Signature Verification — Imprecise but Not Wrong

**Affected section:** Section 3A, "Signature verification"

The document says Firebase SDK handles signature verification automatically and describes Eventarc delivering "signed JWT in `Authorization: Bearer` from Workload Identity Federation."

**Assessment:** The broad strokes are correct — Firebase Cloud Functions triggered by Firebase Alerts do authenticate via Google's infrastructure. However, the document conflates two things:

1. **Eventarc delivery** — Eventarc delivers events to Cloud Functions via an HTTP POST. The request includes an `Authorization: Bearer {jwt}` header where the JWT is signed by Google's Eventarc service. The Cloud Function can verify this JWT using the `google-auth-library` or Firebase SDK.

2. **Workload Identity Federation** — WIF is used when a workload running outside GCP (e.g., on AWS or on-prem) needs to access GCP resources without a service account key. WIF is **not** the delivery mechanism for Eventarc → Cloud Functions — the token is signed by Google's Eventarc service, not by an external identity provider.

**Why it matters:** Low risk — the code example correctly uses the Firebase SDK which abstracts all of this. But a reader who tries to manually implement WIF-based verification for incoming Firebase Alerts would go down the wrong path.

**Concrete correction:** Replace "from Workload Identity Federation" with "signed by Google's Eventarc service using OIDC-compatible JWTs." Keep the code example; it is correct as-is.

---

## 5. No Replay Protection Gap for Eventarc

**Affected section:** Section 3A, "Signature verification"

The document says Firebase SDK handles signature verification automatically but does not address replay protection.

**Assessment:** Eventarc JWTs include an `exp` (expiration) claim. Cloud Functions triggered via Eventarc receive events that have already passed Google's own replay checks (events older than the JWT TTL are rejected). The Firebase SDK's automatic handling does include expiration checking as part of JWT verification.

**Why it matters:** Not a real gap — but the document should note this so readers don't think they need to add additional replay protection.

**Concrete correction:** Add one sentence after "Firebase SDK handles signature verification automatically":

> The underlying Eventarc JWT includes an expiration claim; events beyond the TTL are rejected by Google's infrastructure before reaching the Cloud Function. No additional replay protection is needed on the receiving side.

---

## 6. OAuth Claims Are Correct and Consistent

**Affected section:** Section 2 and platform-registry

Both the document ("No OAuth2 user-flow exists for Crashlytics — service accounts are the only option") and the registry entry (`supportsOAuth: false`) agree. No contradiction.

---

## 7. Secret Type Classification Is Consistent

**Affected section:** Section 2 / platform-registry

The platform-registry uses `secretType: 'service_account'` for the `service_account_json` field. The document describes a GCP service account JSON key. This classification is correct and consistent with the registry's classification scheme.

---

## 8. MVP Recommendation Is Justifiable

**Affected section:** Section 2, "Recommendation for MVP"

Service account JSON key is recommended for MVP on the basis that it's the only supported auth mechanism.

**Assessment:** Correct. The alternative (Workload Identity Federation) avoids key files but requires more infrastructure (external identity provider, workload identity pool, service account impersonation). For an MVP, service account JSON via `google-auth-library` with Application Default Credentials or explicit key path is the lowest-friction path.

One nuance not mentioned: if the customer uses a post-May 2024 GCP org, the friction is higher than assumed (org policy exemption required). This is covered in finding #2 above.

---

## Summary

| # | Severity | Issue | Status |
|---|---|---|---|
| 1 | Medium | Role name `roles/errorreporting.reader` is non-standard — likely should be `roles/clouderrorreporting.user` | Fix required |
| 2 | Low | Service account key expiration ignores post-May 2024 org policy defaults | Fix recommended |
| 3 | Low | `defaultIntakeMode: 'webhook'` misrepresents Cloud Function requirement | Fix recommended |
| 4 | Low | "Workload Identity Federation" misdescribes Eventarc JWT delivery | Fix recommended |
| 5 | Info | Replay protection should be explicitly noted as handled | Fix recommended |
| 6 | — | OAuth consistency | No action |
| 7 | — | Secret type consistency | No action |
| 8 | — | MVP recommendation justification | No action (pending #2 fix) |

**Required fix (blocking):** Finding #1 — the Error Reporting role name. All other findings are recommended improvements.
