# Review: custom_git_server.md — Hosting Variants & Version Drift

**Reviewer**: Claude
**Date**: 2026-04-18
**Source**: `docs/connectors/custom_git_server.md`
**Focus**: Cloud vs self-hosted coverage, API versions, deprecations, regional gotchas, feature tiering, breaking changes

---

## Verdict

**Conditionally accurate with major scope caveats.** The document accurately covers the platforms it explicitly targets (Gitea, Forgejo, Gogs, Bitbucket DC, GitLab self-managed, Azure DevOps Server, raw git) but makes two incorrect framing claims that could mislead implementers:

1. Claims all covered platforms are "self-hosted only" — GitLab Dedicated is managed.
2. Claims "no managed/Cloud variant for this connector class" — but doesn't clarify that Azure DevOps Services (cloud) and GitLab Dedicated (managed) are real products the project may need to address elsewhere.

Within its stated scope, the document has accurate webhook event maps and adapter architecture, but conflates edition-level features (CE vs EE) and is missing Bitbucket Server EOL notation.

---

## Findings

### 1. Framing: "Self-hosted only" claim is slightly wrong

**Affected**: GitLab self-managed variant coverage (Section 1.2)
**What the doc says**: "All platforms in this category are **self-hosted only**. There is no managed/Cloud variant for this connector class."
**Correction**: GitLab Dedicated is a fully-managed SaaS offering (runs on GitLab infrastructure, not the tenant's). It is not self-hosted. If the connector aims to support GitLab SM, it should explicitly clarify that "GitLab CE/EE self-managed" = tenant-runs-the-servers, while "GitLab Dedicated" is a separate managed product with potentially different API surface. Azure DevOps also has Azure DevOps Services (cloud) vs Azure DevOps Server (on-prem) — the doc covers only the Server variant but doesn't acknowledge the cloud variant exists.

**Recommendation**: Add a note in Section 1.2 clarifying that GitLab Dedicated and Azure DevOps Services are managed products outside this connector's scope, and reference where they are (or will be) documented.

---

### 2. Missing: Bitbucket Server EOL

**Affected**: Bitbucket Server/Data Center (Section 1.2, Table in Section 1, Section 3.1.3)
**What the doc says**: "Bitbucket Server/DC" listed as a platform with "Full REST" and "HMAC v8.0+". Section 3.1.3 says "Only v8.0+ has HMAC webhook verification. Earlier versions have no secret mechanism."
**Correction**: Bitbucket Server reached end of life on **2024-02-15** (Atlassian EOL announcement). Only Bitbucket Data Center receives updates. New deployments should use Data Center only. The connector should note this and could deprecate or drop Server support entirely. If keeping Server support, minimum version should be documented.

**Recommendation**: Update Section 1.2 table row from "Bitbucket Server/DC" to "Bitbucket Data Center (Server EOL 2024-02-15)". Add a note in Section 3.1.3 that Server is EOL and no longer receiving security patches — tenant warning should be surfaced in admin panel.

---

### 3. Missing: GitLab CE vs EE feature distinction

**Affected**: GitLab self-managed (Section 5.4, Section 11, Appendix C)
**What the doc says**: "GitLab CE/EE" treated as one platform with a unified API surface. Section 5.4 shows `opened`/`closed` as the status model. Section 11 Phase 3 mentions "Release management" and "Pipeline status" as GitLab SM features without edition qualification.
**Correction**: Several features in GitLab have edition restrictions:
- **Release API**: Available in GitLab **Premium and Ultimate only** (not CE/EE free tier). The doc shows `POST /projects/{id}/releases` as a Phase 3 feature without qualification.
- **Pipeline status**: `GET /projects/{id}/pipelines` is available in **Starter/Premium/Ultimate** — not free CE.
- **Epics**: GitLab **Premium only** — not in CE or EE free tier.
- **Time tracking** (spent/estimate): **Starter and above**.
- **Service Desk**: **Premium only**.

**Recommendation**: Flag these features in Section 11 Phase 3 with edition requirements: "Release management (GitLab Premium+)", "Pipeline status (GitLab Starter+)", etc. The connector should detect the GitLab edition via `/api/v4/version` and warn if a tenant tries to use a feature on an unsupported edition.

---

### 4. Accurate: Azure DevOps API version parameter

**Affected**: Azure DevOps throughout (Sections 4.1, 4.2, 4.3, 4.5, 4.9)
**What the doc says**: Uses `?api-version=7.0` consistently in outbound examples.
**Verdict**: Correct. Azure DevOps REST API uses query parameter versioning. Server 2020 Update 1+ uses `api-version=7.0`. Later Server versions increment to 7.1, 7.2, etc. The doc's use of 7.0 is a reasonable baseline for "current Server" at time of writing, but the connector should allow `requiredApiVersion` config (already in the spec at Section 10.5) to gate features.

---

### 5. Accurate: Gitea/Forgejo API compatibility

**Affected**: Gitea and Forgejo (Sections 1.2, 1.3, throughout)
**What the doc says**: "Forgejo is a Gitea fork, API-compatible." Header tables show both use `X-Gitea-Signature` and `X-Forgejo-Signature` with identical HMAC-SHA256.
**Verdict**: Correct. Forgejo forked from Gitea at 1.17 and maintains API compatibility. The two header variants (`X-Gitea-Signature` vs `X-Forgejo-Signature`) are correctly distinguished. However, the doc could note that Forgejo versions below **1.21** may lack certain webhook events that Gitea 1.21+ supports.

---

### 6. Missing: Gogs maintenance status

**Affected**: Gogs throughout
**What the doc says**: Gogs listed as a supported platform with "Partial REST" and webhook events.
**Correction**: Gogs has had minimal active development since ~2019. The community has largely moved to Gitea or Forgejo. For a new connector in 2026, Gogs support may be a liability — tenants running Gogs likely have outdated instances with inconsistent API behavior. The doc should flag Gogs as "legacy" and recommend Gitea for new deployments.

**Recommendation**: Add a note in Section 1.2 under the Gogs row: "Gogs: legacy, minimal active development since 2019. API may be inconsistent across versions. Prefer Gitea for new deployments."

---

### 7. Accurate: Bitbucket DC HMAC version gate

**Affected**: Bitbucket Server/DC (Section 3.1.3, Section 10.3)
**What the doc says**: "HMAC support: Only v8.0+ has HMAC webhook verification. Earlier versions have no secret mechanism."
**Verdict**: Correct. Bitbucket Server/DC added HMAC-SHA256 webhook signatures in version 8.0. Earlier versions have no secret mechanism. The doc correctly identifies this as a version-dependent feature gap and recommends logging which mechanism is active.

---

### 8. Accurate: GitLab uses plain shared secret, not HMAC

**Affected**: GitLab self-managed (Section 2.5, Section 3.1.4, Section 10.3)
**What the doc says**: "GitLab uses a plain shared secret (X-Gitlab-Token), not HMAC. There is no cryptographic signature — just a string comparison."
**Verdict**: Correct. GitLab's webhook token verification is a plain string comparison, not HMAC. This is documented clearly and the gotcha in Section 10.3 is accurate. Implementers should be aware this is less secure than HMAC and can't detect replay attacks.

---

### 9. Accurate: Base URL patterns

**Affected**: All platforms
**What the doc says**: Section 2 shows `baseUrl` example as `https://git.example.com`. Section 11 config shows same pattern. Each adapter references paths relative to baseUrl (e.g., `/repos/{owner}/{repo}/issues` for Gitea, `/{project}/_apis/wit/workitems` for Azure DevOps).
**Verdict**: Correct. Self-hosted platforms use tenant-configurable base URLs. Azure DevOps uses project-scoped paths which the doc correctly shows as `/{project}/_apis/...`.

---

### 10. Missing: Regional/data-residency variants

**Affected**: Global (None covered)
**What the doc says**: No mention of regional or data-residency variants for any platform in this connector.
**Correction**: None of the platforms in this connector (Gitea, Forgejo, Gogs, GitLab SM, Bitbucket DC, Azure DevOps Server) have official regional variants with different base URLs. Regional/data-residency is a concern for GitHub Enterprise Cloud, GitLab.com, Jira Cloud, and Sentry.io — which have their own connectors. This finding is **not a bug in this doc** but a confirmation that this section of the checklist is N/A for the custom git server connector.

**Recommendation**: Acknowledge in Section 1.2 that this connector covers exclusively self-hosted deployments with no regional URL variants. If a tenant runs a private cloud region with a custom CA, the `skipTlsVerification` and `sshKnownHosts` config fields cover the edge cases.

---

### 11. Accurate: GitLab v4 API

**Affected**: GitLab self-managed throughout
**What the doc says**: API reference linked to `https://docs.gitlab.com/ee/api/rest/` (which is the v4 API). Endpoint examples use `/api/v4/` paths implicitly.
**Verdict**: Correct. GitLab REST API is version 4. The doc's references to `GET /projects/{id}/issues`, `POST /projects/{id}/issues`, etc. are v4 paths. GitLab deprecated the v3 API path prefix in GitLab 16.0 — but `/api/v4/` is the current path. The connector should use `/api/v4/` explicitly rather than relying on the default (which still resolves but is deprecated).

---

### 12. Missing: Breaking change on comment timeline vs notes

**Affected**: GitLab self-managed (Sections 3.2, 4.2, 4.3)
**What the doc says**: "See gitlab.md Section 3.3" for comment fetching. Shows `GET /projects/{id}/issues/{iid}/notes` as the comments endpoint.
**Correction**: GitLab 16.0 introduced a new **Notes API v3** (`/api/v3/projects/{id}/notes`) with breaking changes from v4 notes. More importantly, GitLab 16.0 deprecated the notes endpoint in favor of the **Discussions API** (`/api/v4/projects/{id}/issues/{iid}/discussions`). The old notes endpoint still works (no breaking change for existing code) but is marked deprecated. If the connector targets GitLab 16.0+, it should prefer the discussions endpoint for new code.

**Recommendation**: Update Section 4.2 to note: "Prefer the Discussions API (`/api/v4/projects/{id}/issues/{iid}/discussions`) for new implementations. The Notes API (`/api/v4/projects/{id}/issues/{iid}/notes`) is deprecated in GitLab 16.0."

---

### 13. Accurate: Raw git limitations correctly stated

**Affected**: Raw git throughout
**What the doc says**: "Raw git: No API. No Webhooks. No Issue Tracker. HTTP(S) push/pull + SSH only."
**Verdict**: Correct. Raw git protocol has no API, no webhook capability, and no issue tracker. The doc correctly identifies this and provides fallback strategies (external triggers from CI, webhook from a hosting layer in front of raw git).

---

## Summary Table

| # | Platform/Variant | Issue | Severity |
|---|---|---|---|
| 1 | GitLab self-managed | "Self-hosted only" misses GitLab Dedicated (managed) | Medium |
| 2 | Bitbucket Server | EOL date (2024-02-15) not mentioned | High |
| 3 | GitLab SM | CE vs EE feature tiering not documented (Releases, Pipelines) | Medium |
| 4 | Azure DevOps | API version parameter correctly used | OK |
| 5 | Forgejo | API compatibility with Gitea correctly stated | OK |
| 6 | Gogs | Maintenance/dead project status not flagged | Low |
| 7 | Bitbucket DC | HMAC v8.0+ gate correctly documented | OK |
| 8 | GitLab SM | Plain shared secret (not HMAC) correctly documented | OK |
| 9 | All | Base URL pattern per variant is accurate | OK |
| 10 | All | Regional variants N/A for self-hosted — correctly N/A | OK |
| 11 | GitLab SM | v4 API correctly referenced | OK |
| 12 | GitLab SM | Notes API deprecation (16.0) not mentioned | Medium |

---

## Recommendations for Doc Updates

**High priority:**
- Add Bitbucket Server EOL note (Section 1.2, Section 3.1.3)
- Fix "self-hosted only" claim to acknowledge GitLab Dedicated / Azure DevOps Services exist but are out of scope

**Medium priority:**
- Add GitLab edition feature requirements (Section 11 Phase 3)
- Add GitLab Notes API deprecation note (Section 4.2)
- Flag Gogs as legacy (Section 1.2)

**Low priority:**
- Note Forgejo version floor for webhook event parity with Gitea
- Explicitly use `/api/v4/` prefix in GitLab examples
