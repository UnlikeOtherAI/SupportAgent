# GitHub Projects v2 Connector — Authentication & Credentials Review

**Verdict**: AUDIT FAILED — 8 findings, 2 security-relevant, 3 functional

---

## Auth Mechanism Coverage

| Mechanism | Listed? | Header Correct? | Token Format Correct? | Obtain Location Accurate? |
|-----------|---------|-----------------|----------------------|---------------------------|
| Fine-grained PAT | ✅ | ✅ (`Bearer`) | ✅ | ✅ |
| Classic PAT | ✅ | ✅ (both `Bearer` / `token`) | ✅ | ✅ |
| GitHub App | ✅ | ✅ | ⚠️ (incomplete) | ✅ |
| OAuth App | ✅ (partial) | ✅ (`Bearer`) | ✅ | ✅ |
| Webhook HMAC-SHA256 | ✅ | ✅ (`X-Hub-Signature-256`) | ✅ (`sha256=...`) | ✅ |
| Replay protection | ❌ | — | — | — |
| Device Flow | ⚠️ (mentioned, not flagged) | — | — | — |

---

## Findings

### 1. [SECURITY] Fine-grained PAT expiration range is fabricated

**Issue**: Line 42 states fine-grained PAT lifetime as "30-365 days".

**Why it matters**: GitHub offers discrete options: 1 day, 7 days, 30 days, 90 days, or 1 year maximum. "30-365 days" implies any value in that range is valid, which is false. Users who expect a 60-day token will discover GitHub only offers 90 days (closest) or 1 year.

**Concrete correction**: Replace line 42 with:
> **Token lifetime**: Fixed options: 1 day, 7 days, 30 days, 90 days, or 1 year (maximum). No custom range between options.

---

### 2. [SECURITY] GitHub App JWT signing algorithm and JWT lifetime omitted

**Issue**: Section "GitHub App" (lines 45-54) describes the installation token as `Bearer <installation_access_token>` but omits:
- The JWT signing algorithm required to obtain the installation token (must be RS256)
- The app-level JWT lifetime (maximum 10 minutes; tokens with longer `exp` are rejected)

**Why it matters**: JWTs signed with the wrong algorithm (e.g., HS256) silently fail with `401`. JWTs with `exp > iat + 10 minutes` are also rejected with no descriptive error. Both are common setup failures that are hard to debug.

**Concrete correction**: Add after line 47:
> **JWT signing algorithm**: RS256 (RSA Signature with SHA-256). Use the app's private key in PEM format. Libraries: `jsonwebtoken` (Node), `jose` (universal).
> **App-level JWT lifetime**: Maximum 10 minutes. Set `exp` to `iat + 9 minutes` to allow clock drift tolerance.

---

### 3. [MEDIUM] OAuth App scopes for projects are listed incorrectly

**Issue**: Line 59 lists `read:project` and `write:project` as valid OAuth scopes for Projects v2.

**Why it matters**: These scope names are not valid for GitHub OAuth. GitHub OAuth uses `repo` (full private repo access) or no scope (public only). There are no dedicated `read:project` or `write:project` scopes. A connector builder who implements these scopes will fail — GitHub will either reject the scope request or grant a token that can't access projects.

**Concrete correction**: Replace line 59 with:
> **Scopes**: `repo` (full access) or `public_repo` (public repos only). No fine-grained project-only OAuth scopes exist — `repo` is the minimum for private project access.

---

### 4. [MEDIUM] Replay protection not documented for webhook verification

**Issue**: Section "Webhook Authentication" (lines 64-68) describes HMAC verification but omits replay protection. GitHub webhooks may redeliver the same event (same `X-GitHub-Delivery` ID) on failure.

**Why it matters**: Without deduplication on `X-GitHub-Delivery`, duplicate webhook deliveries cause duplicate item ingestion, duplicate state transitions, or double-posted comments. This is a real scenario — GitHub retries failed deliveries with identical delivery IDs.

**Concrete correction**: Add after line 66:
> **Replay protection**: Store processed `X-GitHub-Delivery` IDs in a short-lived cache (TTL: 5 min) and skip processing for IDs already seen. GitHub may redeliver failed webhooks with the same delivery ID.

---

### 5. [MEDIUM] Fine-grained PAT scopes use ambiguous formatting

**Issue**: Lines 37-40 list scopes as `organization_projects: read` (with a space before `read`).

**Why it matters**: Fine-grained PAT permission display names in the GitHub UI match the format `organization_projects: read` (with space). However, this is the UI display — the exact naming matters for any programmatic configuration. The correct format is `Organization projects: Read` / `Organization projects: Write` (title-cased) in the UI, and the permission keys use different naming in the API. Listing the scopes without clarifying that these are UI display names can cause confusion.

**Concrete correction**: Clarify the permission format:
> **Required permissions** (fine-grained PATs):
> - UI display: `Organization projects: Read` / `Organization projects: Write`
> - For repository-linked projects: `Repository projects: Read` / `Repository projects: Write`
> - Note: Permission names match the fine-grained PAT UI exactly. Verify against current GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens, as UI naming may change between releases.

---

### 6. [MEDIUM] OAuth App section does not explain limitations or deprecation risk

**Issue**: Line 60 says "OAuth app scopes for Projects are limited; prefer PAT or GitHub App" but does not explain why or what limitations apply. It also does not mention that GitHub deprecated the OAuth device flow on github.com.

**Why it matters**: OAuth tokens expire, require client secrets, and need browser-based authorization — making them unsuitable for server-side connectors. Without this context, a future integrator may choose OAuth App thinking it's equivalent to PAT. The deprecated device flow is an additional trap.

**Concrete correction**: Replace lines 56-61 with:
> **OAuth App — Not suitable for SupportAgent**
> - Requires user browser redirect for authorization; not usable in headless/server contexts.
> - Tokens expire and require refresh with client secret.
> - No dedicated project-only scopes; requires `repo` for private projects.
> - **Deprecated**: GitHub disabled the OAuth device flow on github.com (2024). Only browser-based flow remains.
> - Not recommended for SupportAgent connectors.

---

### 7. [LOW] Webhook secret type and format not specified

**Issue**: The "Webhook Authentication" section describes HMAC verification but does not specify:
- The secret format (any string — GitHub stores it as-is, no encoding)
- The `webhook_secret` field classification (which is correct per platform-registry, but worth confirming)
- Whether the secret is entered per-repo or per-org (it's per-repo or per-app, not per-org for projects)

**Why it matters**: Confusion about where to configure the webhook secret causes support tickets. For Projects v2 webhooks, the secret is configured at the repository or organization webhook level, not tied to the GitHub App.

**Concrete correction**: Add to webhook section:
> **Secret configuration**: Enter any random string as the webhook secret. Stored as-is by GitHub (no encoding). For Projects v2 webhooks, configure the secret at the repository level (for repo-linked projects) or organization level.
> **Secret type**: `webhook_secret` — correct per platform-registry.

---

### 8. [LOW] Missing coverage of GitHub App permissions for content access

**Issue**: Line 52 lists `contents: read` as a GitHub App permission for "Content (for issues/PRs)" but does not clarify whether this is required for all content operations on linked issues/PRs.

**Why it matters**: Projects v2 items can reference issues and PRs. Reading the content of those issues/PRs (title, body, labels) requires appropriate repository permissions in addition to project permissions. The document does not make this dependency explicit, so a connector builder may grant only `organization_projects: write` and then fail to read issue content.

**Concrete correction**: Add to GitHub App section:
> **Content access**: To read issue/PR content (title, body, labels, assignees), additional repository permissions are required:
> - `issues: Read` / `write` — for issue content
> - `pull_requests: Read` / `write` — for PR content
> - `contents: read` — for repository access needed for label/assignee queries
>
> Without these, queries for item content via GraphQL will return 403 on private repositories.

---

## Correct Items

- PAT header `Authorization: Bearer <token>` for GraphQL — correct
- PAT header `Authorization: token <token>` for REST — correct (legacy but still accepted)
- Classic PAT lifetime ("user-defined" with 30 days / 1 year for fine-grained; no expiry for classic unless revoked) — correct
- GitHub App installation token lifetime (1 hour) — correct
- HMAC-SHA256 algorithm, `sha256=<hex>` format — correct
- Constant-time comparison for signature verification — correct
- Legacy header `X-Hub-Signature` (SHA1) — correct to note as not recommended
- `webhook_secret` classification — correct per platform-registry
- PAT recommendation for MVP — justified (setup friction is ~2 min vs ~30 min for GitHub App)
- Multi-tenant consideration (per-org PATs, per-installation tokens) — correctly covered
- No self-retrigger via `installation.id` comparison — correctly noted

---

## Security Checklist

- [x] No hardcoded secrets in examples
- [x] `timingSafeEqual` / constant-time comparison used for signature verification
- [x] `webhook_secret` classified as `webhook_secret`, not `api_key`
- [x] No advice to over-scope PATs to `repo` when `organization_projects: write` suffices
- [x] No advice to store tokens in plain text or unencrypted storage
- [x] Classic PAT noted as still functional despite deprecation of classic projects
- [⚠️] Fine-grained PAT expiration range is inaccurate (finding #1)
- [⚠️] GitHub App JWT algorithm and lifetime missing (finding #2)
- [⚠️] Replay protection not documented (finding #4)

---

## Secret Classification

| Field | Source Doc | Platform Registry | Consistent? |
|-------|-----------|-------------------|-------------|
| PAT | `githubToken` | `api_key` | ✅ |
| Webhook secret | `webhookSecret` | `webhook_secret` | ✅ |

GitHub does not have a "service_account" concept — GitHub Apps fill that role. App-level credentials (app ID + private key) are correctly deferred to Phase 2.

---

## MVP Recommendation Verdict

**PAT for MVP — Justified.**

The recommendation holds because:
1. GitHub.com fine-grained PAT setup: Settings → Developer settings → Fine-grained tokens → Generate. ~2 minutes.
2. GitHub App requires: App registration → private key generation → per-org installation. ~30 minutes minimum.
3. `organization_projects: write` scope grants exactly the minimum needed for MVP item operations.
4. Fine-grained PATs are organization-scoped, which is the right model for a single-org MVP.

Migration to GitHub App is correctly targeted for Phase 2 when multi-organization support is needed.

---

## Verdict Breakdown

| Severity | Count | Items |
|----------|-------|-------|
| Security | 2 | JWT algorithm/lifetime missing, fine-grained PAT expiration range fabricated |
| Functional | 3 | OAuth scopes incorrect, replay protection missing, fine-grained PAT format ambiguous |
| Correctness | 3 | OAuth limitations unstated, webhook secret location unspecified, content permissions omitted |
