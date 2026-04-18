# Review: GitHub Wiki Connector — Hosting Variants & Version Drift

**Reviewer:** variants & version-drift audit
**Source:** `docs/connectors/github_wiki.md`
**Scope:** Verify correct distinction between cloud vs self-hosted, API version differences, deprecations, regional gotchas. Ignore auth mechanics, endpoint shapes, rate-limit numbers.

---

## Verdict: PARTIAL — SIGNIFICANT GAPS

The doc correctly identifies the core constraint (no REST API for wiki content, git-backed model) and correctly notes that GitHub Enterprise wikis share the same git-backed model as cloud. However, it fails to cover the full hosting-variant surface for a GitHub Wiki connector, and it conflates or omits GitHub Enterprise Server (GHES) vs GitHub Enterprise Cloud distinctions that matter for connector authors.

---

## Findings

### 1. GitHub — GitHub Enterprise Server (GHES) variant is underspecified

**Variant affected:** GitHub Enterprise Server (self-hosted)

**What the doc says:**
> "Cloud GitHub.com only; GitHub Enterprise wikis share the same git-backed model"

**Problems:**
- Does not distinguish between GHES and GitHub Enterprise Cloud (the SaaS enterprise tier, formerly GHE.com). Both are "Enterprise" but have different deployment topologies.
- The wiki clone URL pattern `https://github.com/<owner>/<repo>.wiki.git` is cloud-only. On GHES, the hostname is `<enterprise-host>/<owner>/<repo>.wiki.git`. The doc does not provide the enterprise URL pattern or note that it differs.
- The doc acknowledges this gap as Open Question 2 and Open Question 5, but these should be resolved before the doc ships — not left as open questions. A connector design doc should not defer the base URL pattern to open questions.
- `repo:wiki` fine-grained PAT scope requires GHES 3.7+. Older GHES versions only support classic PATs with `repo` scope for wiki access. This version dependency is not mentioned.

**Correction:** Add a section or table row for GHES, stating:
- Base URL: `<enterprise-host>/<owner>/<repo>.wiki.git` (no `.wiki.git` suffix change on GHES; the hostname differs)
- Minimum version for `repo:wiki` fine-grained scope: GHES 3.7+
- For older GHES versions, use classic PAT with `repo` scope; `repo:wiki` is not available

---

### 2. GitHub — GitHub Enterprise Cloud variant is not addressed

**Variant affected:** GitHub Enterprise Cloud (enterprise.github.com, formerly GHE.com)

**What the doc says:**
No mention of this variant. The doc treats "Enterprise" as synonymous with self-hosted GHES.

**Problem:**
GitHub Enterprise Cloud is a separate offering from GHES. It uses the cloud API base (`api.github.com`) but with enterprise-level rate limits and audit features. The doc does not address:
- Base URL for wikis on Enterprise Cloud (same as cloud: `github.com`)
- Whether `gollum` webhook delivery behavior differs on Enterprise Cloud
- Enterprise-level features (audit logs, SCIM provisioning) that affect connector multi-tenancy

**Correction:** Add GitHub Enterprise Cloud to the hosting matrix as a separate row, noting it shares cloud API behavior and the same wiki URL pattern as github.com, but with enterprise-tier rate limits and admin controls.

---

### 3. Other platform wikis — not covered (but may be out of scope)

**Variant affected:** N/A (platform coverage gap)

**What the doc says:**
Only covers GitHub Wiki.

**Note:**
The review task asks to verify coverage of GitLab Wikis, Bitbucket Wikis, Jira Wikis, Confluence, etc. The doc title is "GitHub Wiki" and the scope appears to be GitHub only. If this doc is GitHub-only, other platforms are out of scope. However, the connector name and existing structure do not clearly scope to GitHub-only — it reads as a general wiki connector that happens to only cover GitHub. This creates a misleading impression that GitHub Wiki is the only wiki platform.

**Recommendation:** Clarify in the doc header that this covers **GitHub Wiki only**, and add a note that GitLab Wikis, Bitbucket Wikis, Confluence, and other wiki platforms are separate connectors with different API models (GitLab has a REST API for wikis, for example).

---

### 4. GitHub — `gollum` webhook coverage is correct across all variants

**Variant affected:** github.com, GitHub Enterprise Cloud, GHES

**What the doc says:**
`gollum` webhook fires on cloud and Enterprise wikis with the same structure.

**Assessment:** Correct. The `gollum` event is a repository-level webhook that fires for wiki create/edit on all GitHub variants. The payload structure is identical.

---

### 5. GitHub — No API versioning applies (correct)

**Variant affected:** All

**What the doc says:**
No API version is relevant because there is no REST API for wiki content.

**Assessment:** Correct. GitHub REST API versioning (v3) does not apply to wiki content. The doc accurately avoids discussing API versions since none apply.

---

### 6. GitHub — Content format correctly identified

**Variant affected:** All

**What the doc says:**
GitHub wikis support Markdown (`.md`) and AsciiDoc (`.adoc`).

**Assessment:** Correct. However, the doc does not address that enterprise wikis can have the format locked by repo admins — some wikis are Markdown-only or AsciiDoc-only and do not accept the other format. Open Question 3 touches this but should be elevated to a known constraint.

---

### 7. Search — no programmatic search (correct)

**Variant affected:** All

**What the doc says:**
No search API; wiki search requires local cloning.

**Assessment:** Correct. This is true for all variants (cloud, Enterprise Cloud, GHES). No correction needed.

---

### 8. Missing: webhook secret provisioning differs on GHES

**Variant affected:** GHES (self-hosted)

**What the doc says:**
Section 10, gotcha 7: "Webhook secret provisioning — Must set the webhook secret in repo settings. Not tenant-configurable via API"

**Assessment:** Accurate. But on GHES specifically, enterprise admins can disable webhook delivery entirely via site admin settings. A tenant whose GHES instance has webhook delivery disabled cannot use the `gollum` connector at all. This is a connectivity-mode constraint the doc does not mention.

**Correction:** Add a note that on GHES, webhook delivery must be enabled at the site-admin level, and that some enterprise deployments disable it.

---

### 9. Missing: deprecation / sunset for wiki webhooks

**Variant affected:** All

**What the doc says:**
No deprecation notices.

**Assessment:** There are no current deprecations for the `gollum` webhook or the git-backed wiki model. This is accurate. GitHub has not announced any sunset for wiki functionality.

---

### 10. Missing: regional data-residency considerations

**Variant affected:** GitHub Enterprise Cloud (EU/US regions)

**What the doc says:**
No regional considerations.

**Assessment:** GitHub Enterprise Cloud supports EU data residency. Wiki clone URLs and webhook delivery hosts may differ for EU-hosted instances. The doc does not mention this because it doesn't address Enterprise Cloud at all — this is covered under finding #2.

---

## Summary

| Category | Status |
|---|---|
| Hosting variant coverage | Partial — GHES underspecified, Enterprise Cloud missing |
| API versioning | N/A (correct — no wiki REST API) |
| Base URL patterns | Partial — cloud pattern only, GHES/Enterprise Cloud missing |
| Feature matrix | Partial — correctly notes no labels/status, but doesn't cross-reference with GHES feature parity |
| Deprecations | Clean — none exist |
| Regional/gov variants | Not covered (tied to Enterprise Cloud gap) |
| Breaking changes between API versions | N/A |

---

## Required Corrections (priority order)

1. **Add GHES base URL pattern** — `<enterprise-host>/<owner>/<repo>.wiki.git`, note that hostname differs from cloud, add note on `repo:wiki` scope availability (GHES 3.7+)
2. **Add GitHub Enterprise Cloud as separate variant** — same URL as cloud, enterprise-tier rate limits, enterprise admin controls
3. **Clarify doc scope** — add header or note that this covers GitHub Wiki only; other wiki platforms (GitLab, Bitbucket, Confluence) are separate connectors
4. **Add GHES webhook-delivery site-admin constraint** — note that GHES site admins can disable webhook delivery, which blocks the connector entirely
5. **Elevate content format constraint** — wikis can be locked to Markdown or AsciiDoc by repo admins; this is a known constraint, not an open question
6. **Resolve Open Questions 2 and 5 before shipping** — base URL for enterprise wikis and GHES version parity are not optional; they are required for any tenant using GHES