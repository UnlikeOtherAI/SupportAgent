# GitLab Connector — Hosting Variants & Version-Drift Review

## Verdict

**Mostly adequate, with notable gaps.** The doc correctly identifies the three primary hosting modes (GitLab.com, self-managed CE/EE, GitLab Dedicated) and consistently distinguishes tier-gated features. However, GitLab Dedicated is mentioned only implicitly, the API v4 version statement is not explicit in the overview, self-managed minimum version requirements are entirely absent for several features, and a handful of features are presented as broadly available when they carry tier or version constraints.

---

## Findings

### Hosting Mode Coverage

- **Variant affected:** All
- **What the doc says:** Section 1 states "GitLab.com (SaaS) and GitLab Self-Managed (CE/EE/Dedicated)" in a single parenthetical. GitLab Dedicated is mentioned only here.
- **Correction:** GitLab Dedicated deserves a discrete call-out. It is a single-tenant SaaS offering (not self-managed infrastructure), has its own base URL pattern (`<tenant>.gitlab-dedicated.com`), and applies GitLab.com-style rate limits rather than admin-configurable self-managed limits. The doc conflates Dedicated with CE/EE self-managed in sections 8 and 10, which is wrong for rate-limit strategy. Add a row or note for Dedicated in the base URL quick reference and the GitLab.com vs Self-Managed table (Section 10.2).

---

### API Version Statement

- **Variant affected:** All
- **What the doc says:** The API reference link points to `/ee/api/rest/index.html`. No explicit statement that the connector targets v4 appears in the overview or quick reference.
- **Correction:** State explicitly: "GitLab REST API v4 (stable since GitLab 9.0; v3 was removed in GitLab 11.0)." The quick reference footer only shows the base URL ending in `/api/v4`. A developer skimming for the version contract will miss this. Noting that v3 is gone is relevant for anyone integrating with older self-managed instances still on GitLab 10.x (rare but possible in enterprises that lag on upgrades).

---

### Base URL Patterns

- **Variant affected:** GitLab Dedicated
- **What the doc says:** Quick reference lists `https://gitlab.com/api/v4` and `https://self-hosted.example.com/api/v4`. Section 11 connector config lists `apiUrl` with examples of those two forms.
- **Correction:** Add `https://<tenant>.gitlab-dedicated.com/api/v4` as a third valid pattern. Dedicated tenants will enter a subdomain URL that does not match either documented pattern, which could confuse operators configuring the connector.

---

### Self-Managed CE vs EE Feature Differences

- **Variant affected:** Self-managed CE
- **What the doc says:** Section 10.1 shows a tier matrix (Free/Premium/Ultimate) for feature availability. It does not distinguish between self-managed CE (which maps to Free) and self-managed EE (which unlocks Premium/Ultimate depending on license).
- **Correction:** Add a note that on self-managed, CE corresponds to the Free tier and EE requires a paid license to unlock Premium/Ultimate features. A tenant running self-managed EE without a Premium license behaves like Free, and the connector should handle 403s on Premium+ endpoints for any CE or unlicensed EE instance. The doc implies tier only matters on GitLab.com.

---

### Self-Managed Minimum Version Requirements

- **Variant affected:** Self-managed CE/EE
- **What the doc says:** The doc mentions multiple features without stating what minimum GitLab version is required for self-managed instances.
- **Corrections (by feature):**
  - **Work Items API (GA in 18.7):** The doc notes this in the Section 1 callout but does not state the self-managed minimum version needed. State: requires GitLab 18.7+ on self-managed.
  - **Keyset pagination:** Available from GitLab 13.0+. Self-managed instances before 13.0 will reject the `pagination=keyset` parameter. Not noted anywhere.
  - **`internal` visibility:** The doc correctly notes this is self-managed only (Section 10.2), but does not state it was introduced in GitLab 8.9.
  - **`detailed_merge_status` field (MR payload, Section 3.5):** This field replaced the deprecated `merge_status` in GitLab 15.6. Self-managed instances before 15.6 will return `merge_status` only. The doc lists both but does not flag the version split.
  - **`draft` MR field (Section 3.5):** The `draft` boolean on MRs replaced the older `work_in_progress` field in GitLab 14.0. Self-managed instances before 14.0 use `work_in_progress`. Not mentioned.
  - **`self_rotate` scope for PATs (Section 2.1):** Introduced in GitLab 16.3. Self-managed instances before 16.3 do not support this scope. The doc references it without version qualification.
  - **Service accounts (Section 2.4 summary table):** Service accounts as a dedicated feature (distinct from bot users) were introduced in GitLab 15.1. Earlier self-managed instances do not have a service account concept separate from regular user accounts.

---

### Features Claimed Broadly That Are Tier-Restricted

- **Variant affected:** Free tier (GitLab.com and self-managed CE)
- **What the doc says:** Section 3.1 lists `Milestone Hook` as an available webhook event type without tier qualification.
- **Correction:** Group milestone webhooks require Premium+. Project milestone webhooks are available on Free. The doc does not distinguish between project and group milestone hooks; the tier constraint on the group variant should be noted.

- **Variant affected:** Free tier
- **What the doc says:** Section 3.4 polling fallback includes `GET /groups/:id/issues` in the example as "global across projects."
- **Correction:** The group-level issues API is available on Free, but the Section 9.3 filter table says `GET /groups/:id/issues` requires "Premium+" without explaining why. This is partially correct: group-level search for issues and epics at scale is a Premium feature for cross-project reporting, but a basic `GET /groups/:id/issues` call works on Free. The doc is inconsistent between Section 3.4 and Section 9.3. Reconcile with a clarifying note.

- **Variant affected:** Free tier
- **What the doc says:** Section 4.15 (Threaded Discussions) states the resolve endpoint as `POST /projects/:id/issues/:issue_iid/discussions/:discussion_id/resolve`.
- **Correction:** Resolving discussions on issues is a Free feature. Resolving discussions on MRs requires that all discussions be resolved before merging, which is a per-project setting available on all tiers. However, the doc implies this is a Phase 2 Premium feature in Section 11 ("resolve thread" listed under Phase 2 alongside epics). Clarify: Discussions API itself is Free; the Phase 2 callout should not imply otherwise.

- **Variant affected:** Ultimate only
- **What the doc says:** Section 5.4 mentions `customAttributes` via GraphQL as a workaround for custom fields without stating it is an Ultimate feature.
- **Correction:** `customAttributes` on work items via the GraphQL API is an Ultimate-tier feature. Free and Premium tenants cannot use this workaround. State the tier constraint explicitly.

---

### Deprecations and Sunset Dates

- **Variant affected:** All
- **What the doc says:** The doc mentions `merge_status` vs `detailed_merge_status` and `work_in_progress` vs `draft` in field listings without flagging either as deprecated.
- **Correction:**
  - `merge_status` is deprecated since GitLab 15.6 (no announced sunset date as of writing, but it will eventually be removed). Add a deprecation note.
  - `work_in_progress` boolean on MRs is deprecated since GitLab 14.0 in favor of `draft`. Add a deprecation note and self-managed version split.
  - The Issues API (`/api/v4/issues`) is not deprecated, but the doc's note about Work Items API as "an upgrade path" should clarify that GitLab has announced Work Items as the long-term unified model, though no sunset date for the legacy Issues API has been set as of GitLab 18.x.

---

### Webhook Registration Endpoint

- **Variant affected:** All
- **What the doc says:** Section 3.1 shows webhook registration as `POST /projects/:id/integrations/webhooks`.
- **Correction:** The canonical webhook registration endpoint is `POST /projects/:id/hooks` (and has been since v4). The `/integrations/webhooks` path is the UI path, not the REST API path. The REST API for webhook CRUD is:
  - `POST /projects/:id/hooks`
  - `GET /projects/:id/hooks`
  - `GET /projects/:id/hooks/:hook_id`
  - `PUT /projects/:id/hooks/:hook_id`
  - `DELETE /projects/:id/hooks/:hook_id`
  The doc uses the wrong path. This is a correctness bug that will cause 404s at runtime.

---

### Idempotency-Key Header

- **Variant affected:** All
- **What the doc says:** Section 3.3 states: "GitLab sends an `Idempotency-Key` header with each delivery attempt."
- **Correction:** GitLab does NOT send an `Idempotency-Key` header on webhook deliveries. Each webhook delivery has a unique `X-Gitlab-Event-UUID` header (introduced in GitLab 14.7) that serves as a stable delivery ID for deduplication. Section 10.10 acknowledges uncertainty ("the value format and semantics are not clearly documented") but Section 3.3 states it as fact. Both references should be corrected to `X-Gitlab-Event-UUID`. Self-managed instances before 14.7 do not send this header.

---

### Rate Limits — GitLab Dedicated

- **Variant affected:** GitLab Dedicated
- **What the doc says:** Section 8 covers GitLab.com limits and notes self-managed admins configure their own. No mention of Dedicated.
- **Correction:** GitLab Dedicated applies GitLab.com-equivalent default limits but can be customized by the Dedicated support team on request. Operators of a Dedicated instance should treat it like GitLab.com limits unless they have explicitly negotiated higher limits. Add a Dedicated row or note to Section 8.

---

### `internal` Note Visibility (MR Comments)

- **Variant affected:** Self-managed, GitLab.com
- **What the doc says:** Section 4.4 lists `internal: boolean` as a param on `POST /projects/:id/merge_requests/:iid/notes` — "Internal note (hidden from external users)."
- **Correction:** Internal notes on MRs (confidential notes) require the project to have service desk or external participants enabled, and the concept of "external users" applies to Service Desk contacts, not arbitrary external accounts. The `internal` flag is available on Free tier but its visibility effect only manifests for Service Desk issues or when external participants are configured. For standard MRs between members, `internal: true` effectively makes the note visible only to project members (not guests). Add a clarifying note to avoid confusion.

---

### Regional / Data Residency

- **Variant affected:** GitLab.com
- **What the doc says:** No mention of regional data residency variants.
- **Correction:** GitLab.com offers regional instances: GitLab.com (US), and as of 2023, GitLab Dedicated supports EU and US regions. GitLab.com itself does not currently have a separate EU-hosted SaaS endpoint (unlike Jira, which has `eu.atlassian.net`). However, GitLab Dedicated tenants may be hosted in `eu-west-1` and will have a region-specific base URL. The doc should note this is a concern for Dedicated tenants and that the connector must store the tenant's full base URL rather than assuming `gitlab.com`.

---

### Breaking Changes Between v4 and v3

- **Variant affected:** Self-managed instances below GitLab 11.0 (rare)
- **What the doc says:** No mention of v3 removal.
- **Correction:** GitLab API v3 was removed in GitLab 11.0 (May 2018). Self-managed instances below 11.0 will not respond to `/api/v4/` paths at all. While instances this old are rare, an enterprise running a severely lagged self-managed deployment could hit this. A brief note in the overview that v3 is removed and the minimum supported self-managed version for the connector should be stated (recommend GitLab 13.0+ for keyset pagination support; absolute minimum GitLab 11.0 for v4).

---

## Summary of Required Corrections

| Severity | Area | Issue |
|---|---|---|
| High | Webhook registration | Wrong endpoint path: use `/projects/:id/hooks` not `/integrations/webhooks` |
| High | Webhook deduplication | `Idempotency-Key` does not exist; use `X-Gitlab-Event-UUID` (GitLab 14.7+) |
| Medium | Hosting modes | GitLab Dedicated needs its own base URL pattern and rate-limit note |
| Medium | Self-managed versions | Missing minimum version requirements for keyset pagination, Work Items API, `draft` field, `detailed_merge_status`, `self_rotate` scope, service accounts |
| Medium | Deprecations | `merge_status` and `work_in_progress` are deprecated; add version split and deprecation notes |
| Medium | CE vs EE | Clarify that CE = Free tier; unlicensed EE = Free tier |
| Low | GraphQL custom attributes | Mark as Ultimate-only |
| Low | Group milestone webhooks | Mark Premium+ variant |
| Low | Discussions API tier | Remove implication it is a Phase 2 / premium feature; it is Free |
| Low | `internal` note semantics | Clarify scope and Service Desk dependency |
| Low | Regional residency | Note Dedicated regional URLs; no separate GitLab.com EU endpoint |
| Low | API version statement | Make v4 explicit in overview; note v3 EOL at GitLab 11.0 |
