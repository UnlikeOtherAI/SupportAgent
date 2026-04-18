# PagerDuty Connector — Hosting Variants & Version-Drift Review

**Reviewer**: Claude Code audit
**Source**: `docs/connectors/pagerduty.md`
**Date**: 2026-04-18
**Scope**: Hosting modes, API versions, deprecations, regional variants, enterprise-tier features, plan-gated capabilities

---

## Verdict

**APPROVED WITH MINOR CORRECTIONS** — The document correctly identifies PagerDuty as a cloud-only platform with no self-hosted variant, a single REST API v2 endpoint, no regional variants, and accurate plan-tier gating for priority and enterprise features. One factual error and one gap need correction: the priority-gating claim is incomplete, and the absence of a self-hosted variant should be emphasized with the context that PagerDuty has never offered one.

---

## Findings

### 1. Self-Hosted Variant — Correctly Absent, But Needs Stronger Framing

- **Variant affected**: All
- **What the doc says** (line 11-12): "Cloud vs self-hosted: Cloud-only (SaaS). PagerDuty has no self-hosted variant."
- **Verification**: Confirmed. PagerDuty has never offered an on-premise, self-hosted, or private-cloud deployment. There is no PagerDuty equivalent to GitHub Enterprise Server or Sentry self-hosted. This is distinct from platforms that had self-hosted options and deprecated them (Jira Server, Bitbucket Server).
- **Correction**: No factual correction needed — the statement is accurate. However, the doc should clarify *why* this is the case rather than stating it as a flat fact. The reason: PagerDuty's platform is infrastructure-heavy (notification delivery, PagerDuty app integration, on-call scheduling engine, SMS/phone push) and has always been operated as a managed service. Add a sentence: "PagerDuty operates its incident management infrastructure as a managed cloud service. There is no on-premise or private-cloud deployment option, and none has ever existed." This distinguishes PagerDuty from platforms that had self-hosted and deprecated it.
- **Status**: No factual error, but framing improvement recommended.

---

### 2. API Version — Correct

- **Variant affected**: All
- **What the doc says** (line 9-10): "REST API (`https://api.pagerduty.com`) — manage incidents, users, services, webhooks, escalation policies" and "Events API v2 (`https://events.pagerduty.com/v2`) — one-way event ingestion"
- **Verification**: PagerDuty exposes two distinct APIs: the REST API at `api.pagerduty.com` (current version is v2, no explicit vN in URL) and the Events API v2 at `events.pagerduty.com/v2`. The doc correctly identifies both. The REST API is not explicitly versioned in its URL path (unlike GitHub's `/v3`), but the API itself follows REST v2 conventions. No other versions exist. The connector correctly uses the REST API only.
- **Status**: Accurate. No correction needed.

---

### 3. Regional Variants — Correctly Absent

- **Variant affected**: N/A (no regional splits)
- **What the doc says**: No regional endpoints are mentioned, which is correct.
- **Verification**: PagerDuty operates a single global API at `api.pagerduty.com`. Unlike Sentry (`de.sentry.io`) or Jira (AU/EU/US routing at `*.atlassian.net`), PagerDuty has no regional or sovereign cloud variants. No EU endpoint, no AU endpoint, no GovCloud equivalent. The doc correctly omits regional variants — no false claims were made.
- **Status**: Accurate. No correction needed.

---

### 4. Priority Field — Plan-Gating Claim Incomplete

- **Variant affected**: Free/Lite plan accounts (vs Standard+)
- **What the doc says**: §10 (line 602-604): "Priority Requires Standard+ Plan. The `priority` field on incidents returns `null` for Free/Lite accounts. `GET /priorities` returns empty array."
- **Verification**: Correct. The `priority` field on incidents and the `GET /priorities` endpoint require a Standard or Enterprise plan. Free/Lite accounts do not have priority levels configured, and the `priority` field returns `null`.
- **Gap**: The doc mentions priority requires Standard+ in §10 Gotchas, but does not flag this in the feature matrix or in the specific endpoint sections. The Priority field is mentioned in §5 (line 420-426) and §6 (line 467) without the plan-gate warning. The warning appears only in §10 (line 602) and §11 (line 668 "GET /priorities — list and set priority" appears in Phase 2 without a tier label).
- **Correction**: Add `(Standard+ plan)` label to:
  - §5 Priority description (line 420): "Priority (Standard+ only)"
  - §6 trigger table row (line 467): "Priority change | `changed_fields` contains `priority` | Requires Standard+ plan"
  - §11 Phase 2 list (line 668): `GET /priorities` — label as Enterprise-gated
- **Status**: Partial correction needed. The plan-gating is correct but scattered and not consistently labeled across all appearances of the feature.

---

### 5. Enterprise-Only Features — Correctly Identified

- **Variant affected**: Enterprise plan accounts
- **What the doc says** (line 622-626):
  > - `GET /audit/records` — Enterprise plan only.
  > - `GET /business_services` — Enterprise plan only.
  > - `GET /response_plays` — Standard+ plan.
- **Verification**: Confirmed. Audit records and business services are Enterprise-tier features. Response plays are Standard+ (not Enterprise-only). The doc correctly distinguishes between Standard+ and Enterprise tiers. These features are in Phase 3 (advanced) with appropriate tier labels.
- **Status**: Accurate. No correction needed.

---

### 6. No Path Variants Between Hosting Modes

- **Variant affected**: N/A — single hosting mode
- **What the doc says**: No claims about path differences between hosting modes (because there is only one hosting mode).
- **Verification**: PagerDuty has no equivalent to Jira's `/rest/api/2/` vs `/rest/api/3/` path drift. All tenants use the same `https://api.pagerduty.com` base URL with identical endpoint paths. No correction needed.
- **Status**: N/A — correctly handled by omission.

---

### 7. No Deprecation or Sunset Dates Affecting Connector Scope

- **Variant affected**: All
- **What the doc says**: No deprecation notices in the doc.
- **Verification**: PagerDuty's REST API v2 is stable. There are no announced breaking changes or sunset dates for any endpoint used by this connector. The Events API v2 (not used by this connector) is also stable. No correction needed.
- **Advisory**: PagerDuty occasionally deprecates individual endpoints or fields — monitor the [PagerDuty API changelog](https://developer.pagerduty.com/docs/rest-api-v2/r11-overview) for breaking changes. This is a watch item, not a current correction.
- **Status**: No action required. The absence of deprecation notices is correct.

---

### 8. Webhook Per-Service Architecture — Correct

- **Variant affected**: All
- **What the doc says** (line 12, line 51-53): "There is no global account-level webhook" and "each Service that needs webhook delivery must have a `generic_webhook` extension registered."
- **Verification**: Confirmed. PagerDuty webhooks are registered per-Service via extensions. There is no account-level webhook registration. The doc correctly handles this as a multi-tenant implication (one webhook per tenant per service).
- **Status**: Accurate. No correction needed.

---

### 9. SSO / SCIM / Admin Features — Correctly Out of Scope

- **Variant affected**: Enterprise tier for SSO/SCIM
- **What the doc says**: Authentication section covers API Key and OAuth 2.0 only. SSO and SCIM are not mentioned (correctly omitted from connector scope).
- **Verification**: PagerDuty supports SAML SSO, SCIM provisioning, and advanced admin features on Enterprise plans. These are admin-configuration features, not connector-integration features. The connector uses API keys and does not need to surface SSO/SCIM to function. The doc correctly excludes them.
- **Status**: Accurate. No correction needed.

---

### 10. Service Account Requirement — Correct

- **Variant affected**: All
- **What the doc says** (line 498-503, line 628-631): "The connector needs a dedicated PagerDuty user account (service account) to act as the bot."
- **Verification**: Confirmed. The `From` header on all mutating requests must contain a valid account user's email. PagerDuty's API key is associated with a user, and outbound actions (creating incidents, posting notes, acknowledging) are performed as that user. The doc correctly recommends a dedicated service account.
- **Status**: Accurate. No correction needed.

---

## Feature Matrix

| Feature | Cloud | Self-hosted | Plan tier | Notes |
|---|---|---|---|---|
| REST API (`api.pagerduty.com`) | ✅ | N/A | All | Cloud-only platform |
| Events API v2 (`events.pagerduty.com/v2`) | ✅ | N/A | All | Not used by this connector |
| Webhooks (per-service) | ✅ | N/A | All | No account-level webhook |
| Incident CRUD | ✅ | N/A | All | |
| Notes (append-only) | ✅ | N/A | All | No edit/delete |
| Priority field | ✅ | N/A | Standard+ only | `null` on Free/Lite |
| `GET /priorities` | ✅ | N/A | Standard+ only | Empty array on Free/Lite |
| `GET /audit/records` | ✅ | N/A | Enterprise only | Phase 3 scope |
| `GET /business_services` | ✅ | N/A | Enterprise only | Phase 3 scope |
| `GET /response_plays` | ✅ | N/A | Standard+ | Phase 3 scope |
| SSO (SAML) | ✅ | N/A | Enterprise | Admin config, not connector scope |
| SCIM provisioning | ✅ | N/A | Enterprise | Admin config, not connector scope |
| Rate limits | ✅ | N/A | All (tier-differentiated) | Standard/Enterprise: 1000/min; Lite/Free: 250/min |

---

## Summary of Corrections

| # | Severity | Location | Issue | Correction |
|---|---|---|---|---|
| 1 | Low | §1 (line 11-12) | Self-hosted note is flat fact without context | Add one sentence: "PagerDuty operates its incident management infrastructure as a managed cloud service. There is no on-premise or private-cloud deployment option, and none has ever existed." |
| 2 | Low | §5 (line 420), §6 (line 467), §11 (line 668) | Priority plan-gating not consistently labeled | Add `(Standard+ only)` label to all Priority references throughout the doc |

**No blockers.** The document's core framing (cloud-only, REST API v2, webhook-per-service, plan-tier gating) is correct and remains valid after corrections. PagerDuty's architectural simplicity (single cloud deployment, single API version, single global endpoint) means there are no hosting-mode or API-version drift concerns that affect this connector.

---

## Recommended Additions

1. **Self-hosted framing** (low priority): Strengthen line 11-12 with context that PagerDuty has never offered on-premise.
2. **Priority plan-gate consistency** (low priority): Add `(Standard+ only)` labels to all Priority references in §5, §6, and §11.
3. **Feature matrix** (advisory): A summary table (per the one above) could be added to §1 or §10 to make plan-gating and hosting-mode implications scannable at a glance.