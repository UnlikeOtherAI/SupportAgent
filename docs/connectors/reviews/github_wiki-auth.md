# GitHub Wiki Connector — Auth Review

**Verdict**: AUDIT FAILED — 4 findings, 1 security-relevant

---

## Findings

### 1. [HIGH] `repo:wiki` fine-grained PAT scope does not exist

**Issue**: Section 2's PAT scope table lists `repo:wiki` as a valid fine-grained PAT scope that "only grants wiki read/write."

**Why it matters**: GitHub's fine-grained PAT permission model does not have a `repo:wiki` scope. Fine-grained PATs grant repository-level permissions (Contents, Issues, Pull requests, etc.) but wikis are git-backed and sit in a separate bare repo (`<repo>.wiki.git`). Fine-grained PATs cannot be scoped to wiki access alone — the nearest grant is `Contents: Read & write` on the parent repository, which implies wiki access but is not explicitly wiki-scoped. Documenting a non-existent scope misleads tenants into believing they can configure a minimally-scoped fine-grained PAT; the actual permission they need to pick is unclear.

**Concrete correction**: Replace the `repo:wiki` scope entry:

```markdown
**Required scopes (PAT):**
- Classic PAT: `repo` (full) — grants read/write to all repos including wikis
- Fine-grained PAT: `Contents: Read & write` on the parent repository — this is the minimum scope needed for wiki clone/push; note that fine-grained PATs cannot be scoped to wiki alone, only to the parent repo's contents permission
```

Or add a note: "Fine-grained PATs do not have a wiki-specific scope. Use `Contents: Read & write` on the parent repository."

---

### 2. [MEDIUM] Deploy key for wiki access — unverified and potentially incorrect

**Issue**: Section 2's auth table lists "Deploy key" with "Yes — same key to wiki (git:// URL, not HTTPS)." This implies the same deploy key added to the parent repo can be reused for the wiki. GitHub's deploy key documentation only describes attaching keys to a single repository, not to the associated wiki. Wikis are separate bare git repos. In practice, deploy keys are scoped per-repo and a key added to `<owner>/<repo>` cannot be used for `<owner>/<repo>.wiki` without also adding it to the wiki.

**Why it matters**: If the deploy key approach described is wrong, a tenant following this guide will configure a key they believe works but won't have wiki access. This causes silent failure in git clone/push operations.

**Concrete correction**: Clarify the deploy key behavior:

```markdown
| Deploy key | Repo settings → deploy keys | SSH key pair | Yes — add the same SSH key as a deploy key to the wiki repo in addition to the parent repo; deploy keys are per-repo |
```

Or remove deploy key from the table if it cannot be confirmed as a working path.

---

### 3. [MEDIUM] Replay protection for `gollum` webhook not mentioned

**Issue**: Section 3's webhook section describes HMAC signature verification and at-least-once delivery semantics but does not mention that GitHub also sends a unique `X-GitHub-Delivery` header per delivery attempt — and that deduplication must be done using this ID, not the `pages[].sha`. The doc says "dedup by `pages[].sha`" which is incorrect: the SHA is per-page content, but the same page edited multiple times will produce different SHAs. A page edited, then a network retry of the same delivery event, will have a different SHA but the same `X-GitHub-Delivery` ID.

**Why it matters**: Without replay protection using `X-GitHub-Delivery`, network-induced duplicate deliveries (or GitHub's own retry policy with exponential backoff) can cause duplicate ingestion of the same event, resulting in duplicate content fetches and stale content being stored if the retry arrives before the new content is committed.

**Concrete correction**: Add to the webhook section:

```markdown
**Replay protection**: Store processed `X-GitHub-Delivery` header values in a short-lived set (TTL: 5 minutes). Skip processing for any delivery ID already seen. Do NOT use `pages[].sha` as a deduplication key — it changes with each commit, so the same delivery retried after a new commit will have a different SHA.
```

And update the "Must handle" MVP list:

```markdown
- `gollum` webhook handler (verify HMAC, dedup by `X-GitHub-Delivery`, store event)
```

---

### 4. [LOW] Fine-grained PAT expiration description is ambiguous

**Issue**: Section 2 says "PATs: user-configurable, up to 1 year; default 30 days for classic, configurable for fine-grained." The phrasing implies fine-grained PATs are also user-configurable to 1 year, but fine-grained PATs can be set with a specific expiration (up to 1 year) or with no expiration depending on the org policy. The exact fine-grained PAT lifetime defaults depend on the owner's GitHub plan and org settings.

**Why it matters**: Minor accuracy issue. A reader may incorrectly assume fine-grained PATs default to 30 days like classic PATs, or assume they are always non-expiring.

**Concrete correction**: Separate the two PAT types clearly:

```markdown
**Token lifetime:**
- Classic PATs: default 30 days (user can extend to 1 year); org admins can enforce expiration
- Fine-grained PATs: configurable expiration up to 1 year, or non-expiring depending on org policy; verify with the token settings
- GitHub App install tokens: 1-hour TTL, auto-refreshed by the App SDK
```

---

## Auth Mechanism Coverage

| Mechanism | Listed? | Header Correct? | Token Format Correct? | Location Accurate? |
|-----------|---------|-----------------|----------------------|--------------------|
| Classic PAT | ✅ | ✅ (`Authorization: Bearer`) | ✅ (`ghp_` prefix) | ✅ |
| Fine-grained PAT | ⚠️ (wrong scope name) | ✅ | ✅ (`github_pat_` prefix) | ✅ |
| GitHub App install token | ✅ | ✅ (`Authorization: Bearer`) | ✅ | ✅ |
| OAuth App token | ✅ | ✅ (`Authorization: Bearer`) | ✅ | ✅ |
| Deploy key | ⚠️ (unverified per-wiki scope) | ✅ (SSH) | ✅ | ⚠️ |
| Webhook HMAC | ✅ | ✅ (`X-Hub-Signature-256`) | ✅ (`sha256=...`) | ✅ |
| Device flow | ❌ | — | — | — |

Note: Device flow is not applicable for GitHub wiki operations since wiki access is git-only (no REST API), but it is listed as "N/A" rather than explicitly excluded.

## Scope Coverage

| Capability | PAT | Fine-grained PAT | OAuth Scope |
|-----------|-----|-----------------|-------------|
| Read wiki pages | ✅ `repo` | ⚠️ `Contents: Read` (parent repo) | ✅ `repo` |
| Write wiki pages | ✅ `repo` | ⚠️ `Contents: Read & write` (parent repo) | ✅ `repo` |
| Receive `gollum` webhook | ❌ (not a scope — requires repo webhook write access) | — | ❌ |
| Manage repo webhooks | ✅ `admin:repo_hook` | ⚠️ (per-repo, no explicit webhook scope) | ✅ `admin:repo_hook` |

## Correct Items

- PAT auth header `Authorization: Bearer <token>` via HTTPS — **correct**
- HMAC-SHA256 algorithm, `sha256=<hex>` format, `X-Hub-Signature-256` header — **correct**
- GitHub App install token 1-hour TTL — **correct**
- Classic PAT `ghp_` prefix — **correct** (matches current GitHub format)
- Manual webhook secret provisioning (no API to register) — **correct**
- Multi-tenant implication (each repo/wiki pair needs own credential) — **correct**
- MVP recommendation (PAT first) — **reasonable** given git-only access model; no OAuth overhead to justify

## Secret Type Classification

| Field | Type Used in Doc | Correct per platform-registry? |
|-------|-----------------|-------------------------------|
| `auth_token` | PAT / install token | `api_key` — matches `github` and `github_issues` entries ✅ |
| `webhook_secret` | HMAC secret | `webhook_secret` — matches `github` and `github_issues` entries ✅ |

Both secret types are consistent with the registry. No `github_wiki` entry exists in the registry — confirm whether a separate registry entry is needed or if the wiki connector reuses the `github` entry.

## Security Checklist

- [x] No hardcoded secrets in examples (all use `<token>` / `<sha>` placeholders)
- [x] `webhook_secret` classified as `webhook_secret`, not `api_key`
- [x] No advice to over-scope PATs to `repo` when `Contents: Read` suffices (doc actually recommends `repo:wiki` but that scope doesn't exist)
- [⚠️] `repo:wiki` scope is a false precision — recommends a scope that does not exist, potentially leading to a misconfigured token
- [⚠️] Replay protection not mentioned — duplicate deliveries could cause stale content overwrite
- [x] No advice to store tokens in plain text or environment-unencrypted storage
- [x] Constant-time comparison implied by HMAC verification (not explicitly stated but consistent with github_issues review pattern)

## Verdict Breakdown

| Severity | Count |
|----------|-------|
| Security | 1 (wrong scope → tenant configures a non-existent scope, may panic to `repo` full) |
| Functional | 1 (deploy key wiki access unverified) |
| Correctness | 2 (replay protection missing, fine-grained PAT expiration ambiguous) |
