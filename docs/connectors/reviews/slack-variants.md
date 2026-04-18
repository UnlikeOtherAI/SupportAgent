# Slack Connector — Hosting Variants & Version-Drift Review

**Reviewer**: Claude Code audit
**Source**: `docs/connectors/slack.md`
**Scope**: Hosting modes, API versions, deprecations, regional variants, enterprise-tier features

---

## Verdict

**APPROVED WITH FINDINGS** — The doc correctly identifies Slack as cloud-only with no self-hosted equivalent. Three substantive gaps require correction: an undocumented government variant (GovSlack/FedRAMP), enterprise-only API families that should be labeled as such, and a token-rotation scoping error.

---

## Findings

### 1. Missing Variant: GovSlack (US Government)

- **Variant affected**: GovSlack / Slack for Government (FedRAMP)
- **What the doc says**: No mention of GovSlack. The hosting table has two rows: "Slack cloud (default)" and "Enterprise Grid", with no sub-variants.
- **Correction**: Add a row for **GovSlack** (`slack.com` equivalent, US federal only). GovSlack is a separate deployment for US government agencies authorized under FedRAMP Moderate. It has the same API surface as standard Slack but operates under a different compliance boundary. Base URL is the same (`slack.com/api/*`), but the workspace/org isolation and procurement model differ. If SupportAgent ever targets government customers, this is a distinct onboarding path.

**Why it matters**: The doc implies all Slack cloud workspaces are the same. GovSlack workspaces exist in a separate authorization boundary. Token issuance, app review, and workspace management all go through gov.slack.com rather than slack.com.

---

### 2. Enterprise-only APIs Not Labeled

- **Variant affected**: Enterprise Grid (standard workspaces do not have these)
- **What the doc says**: The MVP endpoints list and Appendix A cover only methods available to any Slack app. No indication that several API families are gated behind Enterprise Grid tiers.
- **Correction**: Flag the following methods/families as **Enterprise Grid only**:
  - **Admin API** (`admin.*` methods) — workspace and user administration
  - **Audit Logs API** (`auditlogs.*`) — organization event monitoring
  - **SCIM API** (`scim.*`) — user provisioning and deprovisioning
  - **Legal Holds API** (`legalholds.*`) — eDiscovery hold management
  - **Functions API** — Slack Canvas / automated workflow functions (premium)

The doc mentions `team_join` and `channel_archive` events in Phase 2 without noting these are gated on the `admin` scope family, which requires Enterprise Grid. Apps without Enterprise Grid cannot subscribe to these events even with correct scopes.

---

### 3. Token Rotation Scoping Error

- **Variant affected**: Enterprise Grid (`xoxe-` tokens only)
- **What the doc says** (line 71-72):
  > Access tokens expire every **12 hours**
  > Refresh tokens (`xoxe-r-*`) are single-use

  This reads as applying to all token types, including `xoxb-` and `xoxp-`.

- **Correction**: Rewrite to clarify that **12-hour token expiration with refresh tokens applies only to Enterprise Grid org tokens (`xoxe-`)**. Standard `xoxb-` and `xoxp-` tokens are **indefinite by default** and only adopt the 12-hour rotation model when `"token_rotation_enabled": true` is set in the app manifest. The `xoxe-r-` prefix is exclusively for Enterprise Grid refresh tokens.

---

### 4. No Evidence of EU/AU Regional Endpoints

- **Variant affected**: None (no regional split exists)
- **What the doc says**: Correctly omits EU/AU endpoints — there are none for Slack. Unlike Jira (which has `atlassian.net` routed to EU or AU), Slack operates a single global API.
- **Status**: Accurate. No correction needed.

---

### 5. API Versioning: Single Version, No Drift

- **Variant affected**: All
- **What the doc says**: No explicit claim about API versions (correctly avoids claiming `v1`/`v2` versioning like Jira has).
- **Status**: Accurate. Slack does not version its REST API by hosting mode. All variants use `https://slack.com/api/*` with method names as the version boundary (e.g., `chat.postMessage` vs deprecated `chat.post`). No correction needed.

---

### 6. Self-Hosted Variant: Correctly Absent

- **Variant affected**: N/A
- **What the doc says**: "No self-hosted / No equivalent to GitHub Enterprise Server"
- **Status**: Accurate. Slack has never shipped a self-hosted/on-premise variant. No correction needed.

---

### 7. Enterprise Grid Token Prefix: `xoxe-` vs `xoxr-`

- **Variant affected**: Enterprise Grid
- **What the doc says** (line 44):
  > `xoxe-` | Enterprise token | Org-wide access | Only on Enterprise Grid; `xoxe-r-` for refresh tokens

- **Correction**: The refresh token prefix should be `xoxr-`, not `xoxe-r-`. Enterprise Grid refresh tokens start with `xoxr-`. The `xoxe-` prefix denotes an **access token** (org token), not a refresh token. The refresh flow is: use `xoxr-*` to obtain a new `xoxe-*` access token via `POST /api/oauth.v2.access` with `grant_type=refresh_token`. The `xoxe-r-` notation conflates the two concepts.

---

### 8. Deprecations: Accurate

- **Variant affected**: All
- **What the doc says**: Mentions `conversations.replies` rate limit change post-May 2025, `files.uploadV2` replacing `files.upload`, and `chat.postMessage` 1/sec per-channel limit.
- **Status**: Accurate. Notable Slack deprecations that are correctly absent (and could optionally be added):
  - `files.upload` deprecated in favor of `files.uploadV2` (2023)
  - `im.open` replaced by `conversations.open` (2022)
  - Classic Slack apps deprecated; all new apps must use Granular Permissions (2022+)

No correction required, but these are useful additions for a "Known Deprecations" section.

---

### 9. Slack Connect: Under-specified

- **Variant affected**: Slack Connect (cross-workspace channels)
- **What the doc says**: Mentions Slack Connect briefly in the platform model (line 22) and Phase 3 (line 475) but does not address API differences for cross-workspace channels.
- **Correction**: No breaking API difference exists for Slack Connect — the same `conversations.*` methods work. However, the token model differs: apps need to be installed in **each participating workspace**, and channel membership across workspaces requires the app to be added to each. The `team_id` in events identifies the source workspace. This is worth a note in the "Multi-workspace" section (currently line 426) rather than deferring entirely to Phase 3.

---

## Summary Table

| Finding | Severity | Affects | Action |
|---------|----------|---------|--------|
| GovSlack missing from hosting table | Medium | GovSlack deployments | Add row |
| Enterprise-only APIs not labeled | Medium | Enterprise Grid planning | Add labels to MVP/Phase lists |
| Token rotation scoping error | Low | Implementers of Enterprise token rotation | Fix `xoxe-r-` → `xoxr-`, clarify scope |
| `xoxr-` vs `xoxe-` prefix confusion | Low | Enterprise token rotation code | Fix refresh token prefix |
| Slack Connect underspecified | Low | Multi-workspace design | Add note to multi-workspace section |
| EU/AU regional endpoints | N/A | — | No action needed |
| Self-hosted variant | N/A | — | No action needed |
| API versioning drift | N/A | — | No action needed |

---

## Recommended Additions

1. **Hosting table** — Add GovSlack row with FedRAMP note.
2. **Enterprise-only badge** — Prefix `admin.*`, `auditlogs.*`, `scim.*`, `legalholds.*` methods in Phase 2/3 lists with `(Enterprise Grid)` label.
3. **Token rotation section** — Split into two paragraphs: one for standard `xoxb-`/`xoxp-` rotation opt-in, one for `xoxe-`/`xoxr-` Enterprise Grid rotation.
4. **Refresh token prefix** — Change `xoxe-r-*` to `xoxr-*` throughout.
5. **Known Deprecations section** — Add `files.upload`, `im.open`, and classic app migration timeline.
6. **Slack Connect note** — Add one-paragraph note on multi-workspace token and `team_id` handling.
