# Custom Git Server Connector — SDK & Implementation Review

**Reviewer scope:** npm package existence, SDK capability accuracy, raw-fetch-vs-SDK coherence, build plan realism, config field alignment, cross-connector consistency.
**Source:** `docs/connectors/custom_git_server.md`
**Date:** 2026-04-18

---

## Verdict: APPROVED WITH CORRECTIONS

The document is technically well-researched and the adapter-pattern approach is architecturally sound. Build plan phase ordering is correct. No phantom npm packages — both `gitea-js` and `azure-devops-node-api` exist with TypeScript types. Two structural issues need resolution before implementation: the `OutboundCapability` interface is missing `attachFile`, and the doc overlaps with the GitLab SM connector in a way that conflicts with the migration recommendation.

---

## Findings

### 1. npm Package Existence — ALL VERIFIED

| Package | Version | Status | Notes |
|---|---|---|---|
| `gitea-js` | 1.23.0 | ✅ Exists | Community SDK, has TypeScript types (`./dist/index.d.ts`), no official Gitea SDK exists |
| `azure-devops-node-api` | 15.1.2 | ✅ Exists | Official Microsoft SDK, TypeScript types included (`./WebApi.d.ts`) |

The doc correctly marks Gitea/Forgejo as "No official SDK — use `gitea-js` (community) or raw `fetch`." `gitea-js` is a community package maintained by `anbraten`, not the official Gitea project. This distinction matters: the package tracks Gitea releases but may lag behind new API versions. The doc's "raw `fetch` with typed wrapper functions" recommendation (Section 12.2) is the safer choice for a new connector.

The doc correctly lists GitLab SM as "See gitlab.md" — `@gitbeaker/rest` is referenced there, not here.

**No phantom packages found.**

---

### 2. SDK Capabilities — VERIFIED

**gitea-js:** Ships TypeScript types (`types: "./dist/index.d.ts"`), wraps the Gitea REST API, no separate `@types/*` package needed. The doc correctly recommends raw `fetch` over this for the connector since the adapter pattern is already an abstraction layer.

**azure-devops-node-api:** Official Microsoft SDK (`WebApi.js` entry point, `WebApi.d.ts` types). Wraps Azure DevOps REST APIs including Work Item tracking. However: the package has a non-trivial dependency tree (includes `typed-rest-client`, `osrt`, `azure-devops-utility-functions`). For a worker that may run in a lightweight context, raw `fetch` for Azure DevOps is defensible — the Azure DevOps REST API is well-documented and the work item patch format is straightforward JSON.

**Webhook helpers:** Correctly absent from both packages. No SDK among these platforms provides webhook signature verification helpers. All HMAC verification is manual via `crypto.createHmac` — this is correctly documented.

**Pagination helpers:** The doc correctly notes offset pagination for Gitea/Forgejo/Gogs and keyset for GitLab. No SDK provides pagination helpers for Gitea/Gogs/Forgejo. The doc's cursor strategy in Section 9 is correct.

**Retry handling:** Correctly absent from all packages. Manual retry with backoff is the right approach.

---

### 3. Raw Fetch vs SDK Recommendation — COHERENT

Section 12.2 recommends raw `fetch` with typed wrapper functions for this connector. The rationale is sound:

1. No official SDK for primary targets (Gitea/Forgejo/Gogs)
2. `gitea-js` is community-maintained — adding it on top of the adapter pattern adds indirection
3. The connector wraps only ~10 endpoints, not a full API surface
4. Webhook handling is platform-specific and SDK-independent anyway

This is internally consistent. The trade-off the doc implicitly makes is correctness over convenience — for 10 endpoints, handwritten typed wrappers are maintainable.

**However, one clarification is needed in Section 12.2:** If an implementor chooses `gitea-js` for Gitea (it's the most feature-complete community option), the adapter should wrap only the specific endpoints needed, not expose the full `gitea-js` API surface. The doc should note this constraint.

---

### 4. CLI Parity — INCOMPLETE

Section 12.3 states:
> "No equivalent CLI exists for Gitea/Forgejo/Gogs that matches `gh` or `glab`."

Two issues:

**`glab` naming conflict:** `glab` exists on npm (v1.0.2) but is an abandoned package (last published 2022-06-18). The actual GitLab CLI is [`glab`](https://github.com/provolotools/glab) (Go-based, actively maintained) and is installable via Homebrew (`brew install glab`). The npm `glab` package is unrelated. The doc correctly identifies "no equivalent CLI" for scripting — the Go `glab` is for local developer workflows, not server-side API scripting — but the statement is ambiguous. Clarify: "No server-side CLI exists for Gitea/Forgejo/Gogs. The GitLab CLI (`glab`) does not apply to self-hosted instances."

**gitea CLI:** The doc mentions `gitea admin` for admin operations. `gitea` CLI is available via official binary releases (download gitea.com/gitea/cli) or as a systemd service binary — not via npm. The claim that it "covers admin operations but not issue/PR management from a scripting perspective" is accurate. The CLI is for instance administration, not API automation. This should be noted as a distinction: "The `gitea` binary is an instance admin tool, not an API client."

---

### 5. Build Plan Phase Ordering — REALISTIC

| Phase | Blocking on OAuth? | Status |
|---|---|---|
| MVP: PAT + webhook registration | No — PAT is static | ✅ Correctly ordered |
| Phase 2: PR support, comment editing, label/assignee mgmt | No — same auth, additional API surface | ✅ Correctly ordered |
| Phase 3: Azure DevOps custom fields, pipeline status, code review | No — platform-specific additions | ✅ Correctly ordered |

The phase ordering is correct. All MVP operations use PAT auth (static, non-expiring unless revoked). No OAuth redirect flow is required for any phase. Webhook registration is a single API call per platform. Phase 3 features (Azure DevOps custom fields, GitLab pipeline status) are explicitly platform-specific — no cross-platform complexity.

---

### 6. Config Field Alignment — INCOMPLETE

**Doc (Section 11) defines these fields:**
```
platform, baseUrl, authType, username, token, sshPrivateKey, sshKnownHosts,
owner, repo, webhookSecret, webhookSignAlgorithm, botUsername,
projectKey, webhookUrl, skipTlsVerification, requestTimeout
```

**Missing from the doc but implied by the adapter:**
| Field | Where It Matters | Status |
|---|---|---|
| `botUserId` | Section 7.3 (`no_self_retrigger`) — bot detection uses `botUserId` alongside `botUsername` | ❌ Listed in Section 2 config example but absent from Section 11 MVP config |
| `platform` variant for `raw_git` | Section 1 lists `raw_git` as a platform; Section 11 config type excludes it | ⚠️ Inconsistency: TypeScript interface lists 6 platforms; Section 1 table shows 7 (includes raw git) |
| `azureDevOpsProject` | Azure DevOps-specific project scope, distinct from `projectKey` | ⚠️ `projectKey` is used for Bitbucket; Azure DevOps uses `{project}/_apis/...` paths |

**OutboundCapability mismatch:**
```typescript
// Appendix B defines OutboundCapability with these fields:
createItem, postComment, editComment, deleteComment, updateStatus,
updateLabels, setAssignee, mentionUser, attachFile
```

But `attachFile` is **missing** from `OutboundCapability`. The adapter documents `attachFile` as a capability in Section 4.9 (Gitea attachment upload, Azure DevOps attachment upload), but the interface in Appendix B omits it. This is a doc bug — the interface must be updated.

---

### 7. Cross-Connector Consistency — OVERLAP CONFLICT

**Critical conflict in Section 13.6 (Migration Path):**

The doc recommends:
> "Keep separate connectors for GitLab.com/self-managed and Bitbucket Cloud/DC."

Yet the doc explicitly covers **GitLab SM** as a supported platform:
- Section 1 table: GitLab CE/EE self-managed
- Section 3.1.4: GitLab SM webhook events
- Section 3.2: GitLab SM polling fallback
- Section 4 outbound: GitLab SM endpoints
- Section 11 MVP endpoint table: GitLab SM column
- Appendix A: GitLab SM response shape

If GitLab SM stays in a separate connector, it cannot be used through the Custom Git Server adapter. The doc must choose one:

**Option A:** Remove GitLab SM from this connector. It becomes a Gitea/Forgejo/Gogs/Azure DevOps Server/raw git connector only. Update:
- Section 1 table: remove GitLab SM row
- Section 3.1.4: remove or mark as "see gitlab.md"
- All GitLab SM endpoint references in sections 3, 4, 9, 11, Appendix A

**Option B:** Accept that this connector handles GitLab SM but shares architecture with the dedicated GitLab connector. The CustomGitServer adapter for GitLab SM would duplicate code from `gitlab.md`. This is worse than Option A.

**Recommendation:** Option A. The Custom Git Server connector covers the "catch-all" platforms that don't have dedicated connectors: Gitea, Forgejo, Gogs, Azure DevOps Server, raw git. GitLab SM has its own design doc and should have its own connector.

**Azure DevOps Server vs Azure DevOps Service:** The doc covers Azure DevOps Server (self-hosted TFS evolution). The same adapter could theoretically work for Azure DevOps Service (cloud) with minor auth changes (AAD vs PAT), but they should remain separate connectors. The doc should explicitly note: "This connector covers Azure DevOps Server (TFS). Azure DevOps Service (cloud) would be a separate connector with Entra ID / OAuth2 support."

---

### 8. `azure-devops-node-api` Transitive Deps — FLAG

The doc lists `azure-devops-node-api` as "TypeScript" but does not mention its dependency footprint. At v15.x this package has non-trivial transitive dependencies including `osrt` and `typed-rest-client`. For a connector that may be deployed as a lightweight worker, raw `fetch` is the safer recommendation.

**Recommendation:** Section 12.2 should explicitly state:
> "For Azure DevOps Server: use raw `fetch` unless the full Azure DevOps Node API feature set is required. The `azure-devops-node-api` package carries transitive dependencies that may not be needed for a connector wrapping only work item + PR endpoints."

This is consistent with the overall raw-fetch recommendation and makes the trade-off explicit.

---

### 9. Open Questions — APPROPRIATE

| Question | Status |
|---|---|
| Platform identification (which platform + version) | ✅ Correct — determines adapter selection |
| Feature scope (issues vs PRs only) | ✅ Correct — MVP scope gating |
| Webhook reachability from internal networks | ✅ Correct — `skipTlsVerification` depends on this |
| Identity resolution (platform usernames vs email) | ✅ Correct — Gitea/Forgejo email privacy |
| Multi-instance support | ✅ Correct — affects `baseUrl` vs `repositories[]` |
| Migration path from GitLab/Bitbucket connectors | ✅ Correct — but needs resolution (see finding #7) |

All questions are legitimate operational blockers. None are design-level flaws.

**Missing open question:** "Does the tenant run a version with HMAC webhook support?" Section 10.3 flags Bitbucket DC < v8.0 and GitLab SM (plain token only) as HMAC gaps, but the open questions don't list this as a deployment question. This affects the webhook verification implementation choice.

---

### 10. Adapter Interface — `InboundEvent.itemId` Type Mismatch

Appendix B defines:
```typescript
interface InboundEvent {
  itemId: string;  // string type
  ...
}
```

But Azure DevOps uses GUIDs for work item IDs:
```typescript
resource: {
  id: 123,           // numeric in payload
  workItemId: 123,   // numeric
}
```

And Gitea uses integer `number` for issue numbers. The doc's `itemId: string` is correct as a wrapper type — string accommodates both integer IDs from Gitea/GitLab/Gogs and GUID strings from Azure DevOps. No change needed; this is correctly abstracted.

---

## Summary of Required Changes

| # | Location | Issue | Severity |
|---|---|---|---|
| 1 | Section 13.6 (Open Questions) | Resolve migration path: either remove GitLab SM from this connector or document that it shares code with `gitlab.md` | **High** — current state is contradictory |
| 2 | Appendix B (`OutboundCapability`) | Add `attachFile: boolean` — the adapter documents this capability but the interface omits it | **High** — interface is incomplete |
| 3 | Section 12.3 (CLI Parity) | Clarify that the npm `glab` package is unrelated to the Go-based GitLab CLI; clarify `gitea` binary is an admin tool, not an API client | Medium |
| 4 | Section 1 + Section 11 | Align `platform` type: remove `raw_git` from the TypeScript type or explicitly include it in the MVP config | Medium |
| 5 | Section 12.2 | Add explicit note: `azure-devops-node-api` has transitive deps; use raw `fetch` for lightweight deployments | Low |
| 6 | Section 2 config example | Ensure `botUserId` appears in the MVP config fields list (it appears in Section 2 but not in Section 11's MVP list) | Low |
| 7 | Section 13 (Open Questions) | Add "Does the tenant's version support HMAC webhook verification?" as an open question | Low |

---

## Verdict Notes

The document's technical foundation is sound. The adapter pattern correctly handles platform variability. No phantom packages, no false SDK capability claims, phase ordering is realistic, and the raw-fetch approach is coherent for the target platforms.

The two high-severity items (GitLab SM overlap, `OutboundCapability` missing `attachFile`) are doc inconsistencies, not architectural flaws. Resolving them produces a clean, focused "catch-all" git server connector covering Gitea/Forgejo/Gogs/Azure DevOps Server/raw git.
