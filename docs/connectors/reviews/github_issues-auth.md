# GitHub Issues Connector — Auth Review

**Verdict**: AUDIT FAILED — 5 findings, 2 of which are security-relevant

---

## Findings

### 1. [MEDIUM] OAuth App section missing device flow

**Issue**: Section 2 documents only the standard 3-legged OAuth flow (`/authorize` → `/access_token`). GitHub also supports a device authorization flow for CLIs and TV apps (`/device/code`), which is a distinct auth path.

**Why it matters**: If a future integrator reads this doc expecting full OAuth coverage, they may implement the wrong flow or miss the device flow entirely. The device flow is the only option for headless/non-browser scenarios.

**Concrete correction**: Add device flow to the OAuth App section:
```markdown
**Device Flow** (for CLI, TV apps):
- Device code URL: `https://github.com/login/device/code`
- Token URL: `https://github.com/login/oauth/access_token`
- Scopes: Same as above
```
Or mark which OAuth variant(s) are supported.

---

### 2. [MEDIUM] Fine-grained PAT permission names unverified

**Issue**: Section 2's fine-grained PAT permission table uses "Issues: Read" / "Issues: Write". GitHub's fine-grained PAT permission model uses resource:access format, but the exact strings need confirmation — GitHub docs may use "Issues" (no colon), "Repository issues", or another variant.

**Why it matters**: If the permission name doesn't match what GitHub actually shows in the UI or accepts in API responses, a user configuring a fine-grained PAT will pick the wrong permission and the connector will fail silently with 403.

**Concrete correction**: Verify exact permission display names against current GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens UI, then update the table. At minimum, add a note: "Permission names match the fine-grained PAT UI exactly — verify against current GitHub UI as naming may change."

---

### 3. [MEDIUM] GitHub App permissions too vague — repository vs org level unspecified

**Issue**: Section 2's GitHub App permission table says "Issues: Read & write" and "Webhooks: Read & write". These are ambiguous — GitHub Apps can be granted permissions at both the repository and organization level, and the permission names differ between the two scopes.

**Why it matters**: A user registering a GitHub App who picks "Issues: Read & write" at org level may still need separate repository-level permission grants. The wrong permission level causes 403s on API calls.

**Concrete correction**: Clarify the permission scope:
```markdown
| Capability | Repository Permission | Organization Permission |
|------------|----------------------|------------------------|
| Issues | Repository: Issues: Read & write | Organization: Issues: Read & write |
| Repository metadata | Repository: Contents: Read | Organization: Members: Read-only |
| Webhooks | Repository: Admin repository hooks: Read & write | (same at org level) |
```

---

### 4. [LOW] Replay protection for webhooks not mentioned

**Issue**: Section 2 describes HMAC signature verification but omits replay protection. GitHub's webhook system delivers each event with a unique `X-GitHub-Delivery` header but does NOT enforce delivery uniqueness — the same delivery ID can theoretically be delivered multiple times across retries.

**Why it matters**: Without deduplication on `X-GitHub-Delivery`, a replayed webhook (e.g., network-induced duplicate delivery) could cause duplicate ingestion, duplicate comments, or double state transitions.

**Concrete correction**: Add a note under webhook verification:
```markdown
**Replay protection**: Store processed `X-GitHub-Delivery` IDs in a short-lived set (TTL: 5 min) and skip processing for seen IDs. GitHub may redeliver failed webhooks with the same delivery ID.
```

---

### 5. [LOW] Platform-registry `supportsOAuth: true` vs MVP-only PAT — no explanation

**Issue**: The platform-registry entry for `github_issues` has `supportsOAuth: true`, and Section 2 documents OAuth App and GitHub App in detail. However, the admin panel config (Section 11) shows only `access_token` (PAT), `webhook_secret`, and no OAuth callback fields. The MVP does not implement OAuth.

**Why it matters**: A reader integrating this connector who sees `supportsOAuth: true` in the registry will expect OAuth support. They will be surprised when the admin UI only accepts a raw PAT.

**Concrete correction**: Either:
- Add a note to the MVP config section: "OAuth App flow (Section 2.2) is documented for reference; implementation deferred to Phase 2."
- Or update the platform-registry entry to `supportsOAuth: false` until OAuth is wired into the admin UI.

---

## Auth Mechanism Coverage

| Mechanism | Listed? | Header Correct? | Token Format Correct? | Location Accurate? |
|-----------|---------|------------------|----------------------|---------------------|
| Fine-grained PAT | ✅ | ✅ (`Bearer`) | ✅ | ✅ |
| Classic PAT | ❌ | (inherited from PAT) | (inherited) | ❌ (no obtain path) |
| OAuth App | ✅ (partial) | ✅ (`Bearer`) | ✅ | ✅ |
| GitHub App | ✅ | ✅ (`Bearer` for install token) | ✅ | ✅ |
| Webhook HMAC | ✅ | ✅ (`X-Hub-Signature-256`) | ✅ (`sha256=...`) | ✅ |
| Device Flow | ❌ | — | — | — |

## Scope Coverage

| Capability | Fine-grained PAT | OAuth Scope |
|-----------|-----------------|-------------|
| Read issues | Listed | Listed |
| Write issues | Listed | Listed |
| Read comments | Listed (implied) | Listed (implied) |
| Manage labels | Listed | Listed |
| Register webhooks | Listed | Not listed |
| Read repo metadata | Listed | Not listed |

OAuth scope for webhook registration (`webhooks: write` or similar) is not listed in the OAuth section.

## Correct Items

- PAT header `Authorization: Bearer <token>` — **correct** (both `Bearer` and `token` prefix are accepted by GitHub; `Bearer` is the documented default)
- Installation token lifetime "1 hour" — **correct**
- HMAC-SHA256 algorithm, `sha256=<hex>` format — **correct**
- `timingSafeEqual` usage in pseudocode — **correct** (prevents timing attacks)
- PAT non-expiring by default — **correct** (orgs can enforce expiration)
- Fine-grained PATs on GHES 3.4+ — **correct**
- Secret types `api_key` and `webhook_secret` — **correct** (match platform-registry)
- MVP recommendation (PAT first, graduate to GitHub App) — **reasonable** given OAuth callback overhead

## Security Checklist

- [x] No hardcoded secrets in examples
- [x] `timingSafeEqual` used for signature comparison
- [x] `webhook_secret` classified as `webhook_secret`, not `api_key`
- [x] No advice to store tokens in plain text or environment-unencrypted storage
- [x] No advice to over-scope PATs to `repo` when `read:issues` suffices (the doc recommends fine-grained PATs)
- [⚠️] OAuth section doesn't mention HTTPS requirement for token transmission (implicit in HTTPS but worth stating)
- [⚠️] Fine-grained PATs are non-expiring by default; document notes this but doesn't advise on org-level expiration policies

## Verdict Breakdown

| Severity | Count |
|----------|-------|
| Security | 0 |
| Functional | 3 (device flow missing, permission names unverified, org vs repo permission confusion) |
| Correctness | 2 (replay protection missing, OAuth registry mismatch) |
