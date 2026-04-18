# Verdict

Needs revision. The document gets the broad split right that Sentry has SaaS and self-hosted offerings and that the public REST API still uses `/api/0/`, but it overstates cloud/self-hosted parity, misstates the regional base-domain story, and includes several uncited or stale version-floor claims. It also misses tier and version caveats that matter for connector planning.

# Findings

- Variant affected: `sentry.io` cloud regional endpoints
  What the doc says: [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:10) says cloud is `sentry.io` with US region `sentry.io` and EU region `de.sentry.io`.
  Correction: Sentry’s API docs say the region-specific SaaS domains are `us.sentry.io` for US and `de.sentry.io` for Germany/EU. `sentry.io` is used in many examples, but it is not the precise “US region hostname” and should not be documented that way.

- Variant affected: `sentry.io` cloud regional endpoints
  What the doc says: [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:13) gives one cloud base URL: `https://sentry.io/api/0/`.
  Correction: The doc should distinguish generic SaaS examples from region-pinned bases. Precise wording should be: generic docs/examples often use `https://sentry.io/api/0/`; region-pinned SaaS bases are `https://us.sentry.io/api/0/` and `https://de.sentry.io/api/0/`; self-hosted remains `https://{host}/api/0/`.

- Variant affected: `sentry.io` cloud regional/data-residency behavior
  What the doc says: [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:10) only mentions `sentry.io` and `de.sentry.io`.
  Correction: Add the regional gotcha from Sentry’s API docs: some APIs must use the region-specific domain when the customer wants to target a specific data-storage location. The current wording hides a real connector risk for EU tenants if the implementation hardcodes `sentry.io`.

- Variant affected: self-hosted / on-prem packaging
  What the doc says: [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:11) describes self-hosted as “single binary or Docker.”
  Correction: Sentry’s official self-hosted distribution is the `getsentry/self-hosted` deployment stack and is documented as Docker/Docker Compose based. “Single binary” reads as a supported shipping mode, but that is not how current official self-hosted Sentry is packaged.

- Variant affected: self-hosted / on-prem scope
  What the doc says: [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:11) says “API version parity: cloud v0 == self-hosted.”
  Correction: Narrow this to path/version-prefix parity, not feature parity. The safe claim is that both SaaS and self-hosted use the `/api/0/` REST API prefix. Full parity is too strong because Sentry has SaaS-only and plan-gated capabilities, and self-hosted features can lag or require minimum releases.

- Variant affected: self-hosted / on-prem feature parity
  What the doc says: [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:11) implies cloud and self-hosted are effectively equivalent apart from hostname.
  Correction: Mark self-hosted as “feature-complete goal, but not guaranteed parity for every SaaS feature or for every release.” Sentry’s own self-hosted repo describes self-hosted as suitable for low-volume deployments and proofs-of-concept, which is a materially different operational posture from SaaS.

- Variant affected: self-hosted integration-platform minimum version
  What the doc says: [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:11) says Integration Platform support in self-hosted exists “as of Sentry 21.x+.”
  Correction: I could verify from current official docs that internal integrations are available for self-hosted, but I could not verify this exact `21.x+` floor from an official current source. Either remove the explicit minimum version or replace it with a cited release floor from Sentry release notes.

- Variant affected: self-hosted current release train
  What the doc says: [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:11) frames self-hosted around `21.x+`.
  Correction: That wording is stale in 2026. The current self-hosted release line is far ahead of 21.x. The review doc should advise recording connector assumptions against a currently supported self-hosted line, not a very old floor.

- Variant affected: SaaS vs self-hosted API versioning
  What the doc says: [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:11) and [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:13) correctly use `api/0` but do not explicitly say whether there is a cloud-vs-on-prem split.
  Correction: Make the versioning statement explicit: Sentry does not publish a Jira-style cloud-v3/server-v2 split here. Both cloud and self-hosted use REST `v0`; the important drift axis is release/version support and feature availability, not a separate major API family.

- Variant affected: regional deep links in webhook examples
  What the doc says: [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:126) and [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:127) use `https://sentry.io/...` and `https://example-org.sentry.io/...` in example payloads.
  Correction: For cloud examples this is acceptable as generic SaaS syntax, but the doc should explicitly say EU tenants may see `de.sentry.io` and connector code must treat returned URLs as authoritative rather than reconstructing them from a fixed host template.

- Variant affected: self-hosted feature matrix
  What the doc says: The document has no explicit feature matrix for SaaS vs self-hosted.
  Correction: Add one. At minimum it should separate:
  `REST API /api/0/` available on SaaS and self-hosted,
  internal integrations available on SaaS and current self-hosted,
  public integrations documented for `sentry.io`,
  SCIM as SaaS business-tier feature,
  version-gated self-hosted features where known.

- Variant affected: enterprise-only identity/admin features
  What the doc says: The document does not flag any SSO/SCIM/audit/admin capabilities as enterprise or business tier features.
  Correction: Even if auth is out of scope for the main review, the hosting-variants section should still flag enterprise-only admin APIs when they affect connector assumptions. Sentry’s SCIM docs explicitly state SaaS customers must be on a Business plan with SAML2 enabled. Do not imply that SCIM-like org automation exists uniformly across cloud and self-hosted.

- Variant affected: SaaS plan gating
  What the doc says: The document treats organizational capabilities as if they are universally available once the API exists.
  Correction: Add a note that some administrative or integration-adjacent features are plan gated on SaaS. The connector research doc should distinguish “API exists” from “available on all plans.” SCIM is the clearest documented example.

- Variant affected: self-hosted minimum-version gates
  What the doc says: [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:332) says priority is older-instance-sensitive, and [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:397) says it is available via API since `23.x`.
  Correction: These are exactly the kind of version-drift statements that need citations and a precise floor. I could not verify the `23.x` threshold from current official docs. Either cite a release note with the exact minimum supported self-hosted version or rewrite to “verify on the target self-hosted release.”

- Variant affected: self-hosted minimum-version gates
  What the doc says: [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:332) and [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:397) present priority support as settled.
  Correction: The safer review correction is: “Priority exists in current SaaS, but self-hosted support should be treated as release-gated unless we pin a minimum self-hosted version with evidence.”

- Variant affected: self-hosted minimum-version gates
  What the doc says: The doc contains no concrete self-hosted minimum-version note except the loose `21.x+` and `23.x` claims.
  Correction: Add a dedicated “minimum versions” subsection and only include items with evidence. One concrete example from current docs: full User Feedback functionality on self-hosted requires version `24.4.2+`. That shows the right pattern for documenting release-gated self-hosted features.

- Variant affected: deprecations and sunsets
  What the doc says: The doc does not list any concrete deprecations or sunset dates.
  Correction: Add an explicit “Deprecations / sunset status” note instead of staying silent. For this connector, I did not find evidence of a Sentry web API major-version sunset beyond “current version is v0,” so the right move is to say no dated REST-version sunset is documented, rather than leaving the impression that this was checked and clean.

- Variant affected: deprecations and beta surfaces
  What the doc says: The document reads as if all mentioned surfaces are stable long-term.
  Correction: It should separate stable REST `/api/0/` from beta endpoints or product areas where Sentry marks APIs as beta. The current doc never says whether the connector relies only on stable issue/comment APIs or whether any beta workflow surfaces are in play.

- Variant affected: regional/data-residency nuance
  What the doc says: [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:73) stores an optional tenant `region` of `us/de` but does not connect that to runtime URL selection rules.
  Correction: Add the implementation rule that the connector should prefer the host returned by Sentry payloads and configuration, and should generate outbound API URLs from the organization’s configured region-specific host where known. `region` cannot just be stored; it has to control URL construction.

- Variant affected: SaaS only vs on-prem assumptions
  What the doc says: The doc implicitly assumes webhook-backed internal integrations are the normal path everywhere.
  Correction: Rewrite to make the hosting split explicit:
  `sentry.io`: internal integrations + webhooks are standard and documented.
  self-hosted: internal integrations are available on current releases, but connector support must be validated against the deployed self-hosted version and network reachability because self-hosted customers own their own hostname, TLS, and upgrade state.

- Variant affected: self-hosted networking / reachability
  What the doc says: The doc treats self-hosted as just a host swap.
  Correction: Add the on-prem gotcha that self-hosted webhook and integration behavior depends on the tenant exposing a reachable base URL with valid routing/TLS. This is not an auth concern; it is a hosting-variant concern that affects whether inbound integrations work at all.

- Variant affected: feature matrix completeness
  What the doc says: The doc has no section for cloud-only, premium-only, or version-gated features.
  Correction: Add a compact matrix with these rows:
  `REST issue/comment APIs`: cloud + self-hosted
  `region-specific SaaS domains`: cloud only
  `internal integrations`: cloud + current self-hosted
  `public integrations`: cloud-first / documented on `sentry.io`
  `SCIM`: SaaS Business + SAML2 only
  `self-hosted release-gated features`: document exact minimum versions when known.

- Variant affected: terminology around “cloud”
  What the doc says: [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:10) collapses SaaS hosting into one “cloud” row.
  Correction: Split cloud into:
  generic SaaS docs/examples: `sentry.io`
  US residency endpoint: `us.sentry.io`
  DE residency endpoint: `de.sentry.io`
  This is important because the doc currently blurs marketing hostnames, console URLs, and API base domains.

- Variant affected: self-hosted support statement
  What the doc says: [docs/connectors/sentry.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/connectors/sentry.md:11) does not characterize self-hosted’s intended use.
  Correction: Include the official self-hosted repo positioning: feature-complete, but packaged for low-volume deployments and proofs-of-concept. That caveat matters for connector expectations around long-term parity and operational support.

- Variant affected: universal-support implication
  What the doc says: The document presents priorities, comments, and integration platform support as effectively universal once the connector uses `/api/0/`.
  Correction: Narrow claims to “supported on current SaaS” unless the self-hosted version floor is stated. The problem is not the endpoints themselves; it is the undocumented assumption that every currently deployed on-prem install exposes the same surface.

- Variant affected: breaking changes between major API versions
  What the doc says: The doc does not say whether there are any major API-version breaks to care about.
  Correction: State explicitly that Sentry’s public web API is still documented as `v0`, so there is no GitHub-style REST-v3 vs GraphQL-v4 or Jira Cloud-v3 vs Server-v2 split to model here. The real compatibility axis is release-by-release feature availability and beta/stable status.

- Variant affected: hosted mode coverage
  What the doc says: The doc covers `sentry.io` and on-prem, which is the right top-level hosting split.
  Correction: Keep that, but make the cloud row more precise by distinguishing generic `sentry.io` examples from US and DE region-specific domains. That is the main coverage gap, not the absence of extra product editions.

- Variant affected: regional documentation completeness
  What the doc says: The doc only names US and DE.
  Correction: Note that the currently documented SaaS data storage locations in the API docs are US and DE. If Support Agent later adds region routing logic, it should be driven by the active Sentry docs and tenant config rather than hardcoded assumptions about additional regions.

- Variant affected: deprecation hygiene
  What the doc says: The document gives dated-sounding release guidance like `21.x+` and `23.x` without any change-log references.
  Correction: This is high risk for drift. Replace uncited release floors with either:
  a verified minimum version and source,
  or a neutral statement that the feature must be checked against the tenant’s deployed self-hosted release.

# Net

- The doc correctly recognizes the only top-level hosting modes that matter for this connector: `sentry.io` SaaS and self-hosted/on-prem.
- The strongest corrections are:
  regional cloud hostname accuracy,
  removing the parity overclaim,
  removing or sourcing `21.x+` and `23.x` version floors,
  adding an explicit feature/tier/version matrix,
  adding a short deprecation/status note instead of implying that version drift was fully covered.

# Sources Checked

- Sentry API Reference: `https://docs.sentry.io/api/`
- Sentry API Authentication: `https://docs.sentry.io/api/auth/`
- Sentry Integration Platform: `https://docs.sentry.io/organization/integrations/integration-platform/`
- Sentry SCIM API: `https://docs.sentry.io/api/scim/`
- Sentry self-hosted docs: `https://develop.sentry.dev/self-hosted/`
- getsentry/self-hosted repository and current release line: `https://github.com/getsentry/self-hosted`
- Sentry User Feedback docs showing a concrete self-hosted minimum-version gate: `https://docs.sentry.io/platforms/apple/enriching-events/user-feedback/`
