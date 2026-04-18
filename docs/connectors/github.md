# GitHub Connector — Design Document

## 1. Overview

- **Category**: Version control + Issue tracker (GitHub serves both roles; the connector must handle PRs and Issues)
- **Cloud**: github.com (REST API v3 + GraphQL API v4)
- **Self-hosted**: GitHub Enterprise Server (GHES) — same REST API v3 with `baseUrl` override
- **API reference**: https://docs.github.com/en/rest
- **Webhook reference**: https://docs.github.com/en/webhooks/webhook-events-and-payloads

### API Variants

| Variant | Base URL | Notes |
|---------|----------|-------|
| GitHub.com REST | `https://api.github.com` | Default |
| GitHub.com GraphQL | `https://api.github.com/graphql` | Used for GitHub Projects |
| GHES REST | `https://<hostname>/api/v3` | Configured via `baseUrl` |
| GHES GraphQL | `https://<hostname>/api/graphql` | Same pattern |

### Platform Quirks

- GitHub conflates Issues and Pull Requests in a single numbering scheme — `issue_number` is shared with PRs.
- PRs have additional event types (`pull_request.opened`, `pull_request.closed` with `merged: true`, `pull_request_review`, `pull_request_review_comment`).
- GitHub Apps (recommended for multi-tenant) require per-organization/per-user installation tokens, not a single PAT.
- Comments on PRs have two contexts: Issue-level comments (`issue_comment`) and Review-level comments (`pull_request_review_comment` with `path` + `line`).

---

## 2. Authentication

### Supported Mechanisms

#### A. Personal Access Token (PAT) — Recommended for MVP

- **Obtain**: Settings → Developer settings → Personal access tokens (classic or fine-grained)
- **Header**: `Authorization: Bearer <token>` or `X-GitHub-Token: <token>`
- **Required scopes** (classic PAT):

| Operation | Minimum Scope |
|-----------|---------------|
| Read issues / comments | `public_repo` or `repo` |
| Write issues / comments | `public_repo` or `repo` |
| Manage labels | `public_repo` or `repo` |
| Manage assignees | `public_repo` or `repo` |
| Create/update PRs | `public_repo` or `repo` |
| Merge PRs | `public_repo` or `repo` |
| Register webhooks | `admin:repo_hook` (repo) or `admin:org_hook` (org) |
| Read repo metadata | `public_repo` or `repo` |
| List org memberships | `read:org` |

- **Fine-grained PATs**: Support per-repo or per-org permission sets. More work to configure per-tenant but more secure.
- **Lifetime**: Classic PATs: no expiry (unless revoked). Fine-grained: configurable max 1 year.
- **Rate limit bonus**: 5,000 req/hour vs 60 req/hour for unauthenticated.

#### B. GitHub App + Installation Token — Recommended for Multi-Tenant

- **Obtain**: Register a GitHub App (Settings → Developer settings → GitHub Apps). Install it on target organizations/repos.
- **Header**: `Authorization: Bearer <installation_access_token>` (obtained from `POST /app/installations/{installation_id}/access_tokens`)
- **Required App permissions** (set in app manifest):

| Permission | Level |
|------------|-------|
| Issues | Read or Read & Write |
| Pull requests | Read or Read & Write |
| Contents | Read (for cloning) |
| Repository metadata | Read |
| Commit statuses | Read & Write (for PR status) |
| Deployments | Read (optional) |
| Members | Read (for @mention resolution) |
| Webhooks | Read & Write |

- **Token lifetime**: Installation tokens expire after 1 hour. SDK handles refresh automatically.
- **Multi-tenant advantage**: One app, many installations, each with its own token. No per-user token management.
- **Downside**: Requires OAuth flow to install the app; more complex setup than a PAT.

#### C. OAuth App — Not recommended for server-side connectors

- Requires redirect URI and client secret. Designed for user-facing web apps, not server-to-server.
- Equivalent to PAT for server use but with additional complexity.

#### D. `local_gh` (current implementation)

- Uses the `gh` CLI's stored auth (`~/.config/gh/hosts.yml`). No token management.
- Works only on hosts where a human has run `gh auth login`.
- **Not suitable for production multi-tenant deployment** — tokens are not portable.

### Recommendation for SupportAgent MVP

**Phase 1**: PAT (`token` auth mode) with a UI field for the token. Simple to set up, works on GitHub.com and GHES. Add `GH_HOST` / `GH_TOKEN` env var override for CI/prod.

**Phase 2**: GitHub App (`github_app` auth mode). One app registration, per-tenant installation. Required for organization-wide webhook delivery and per-user acting.

---

## 3. Inbound — Events and Intake

### Webhook Support: Yes

GitHub delivers webhooks via POST to your configured URL. Events are delivered as JSON.

#### Relevant Event Types

| Event Name | Triggers When | Required For MVP |
|------------|---------------|
| `issues.opened` | New issue created | Yes |
| `issues.closed` | Issue closed/reopened | Yes |
| `issues.labeled` | Label added | Yes |
| `issues.unlabeled` | Label removed | Yes |
| `issues.assigned` | Issue assigned | Phase 2 |
| `issues.demilestoned` | Milestone changed | Phase 2 |
| `issue_comment.created` | Issue/PR comment posted | Yes |
| `issue_comment.edited` | Issue/PR comment edited | Yes |
| `issue_comment.deleted` | Issue/PR comment deleted | Phase 2 |
| `pull_request.opened` | PR opened | Yes |
| `pull_request.closed` | PR closed (check `pull_request.merged`) | Yes |
| `pull_request_review.submitted` | PR review submitted | Phase 2 |
| `pull_request_review_comment.created` | Inline/file comment on PR | Phase 2 |
| `pull_request_review_comment.edited` | Inline comment edited | Phase 2 |
| `pull_request_review_comment.deleted` | Inline comment deleted | Phase 2 |
| `check_run.created` | Check run started | Phase 3 |
| `check_run.completed` | Check run finished | Phase 3 |
| `release.published` | Release published | Phase 3 |
| `push` | Any push to a branch | Phase 2 (for CI triggers) |
| `ping` | Webhook registered/updated | Yes (health check) |

#### Signature Verification

- **Algorithm**: HMAC-SHA256
- **Header**: `X-Hub-Signature-256` (value: `sha256=<hex_digest>`)
- **Verification**: Compute `HMAC-SHA256(secret, raw_request_body)` and compare to the header value using constant-time comparison.
- **Secret provisioning**: Set when registering the webhook. Stored as `webhook_secret` in connector config.
- **Implementation**: Use `crypto.createHmac('sha256', secret)` in Node.js. Never use the legacy `X-Hub-Signature` (SHA-1).

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

function verifyWebhookSignature(
  payload: Buffer,
  signature: string,
  secret: string
): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

#### Delivery Semantics

- **Delivery headers**:
  - `X-GitHub-Hook-ID`: Webhook configuration ID
  - `X-GitHub-Event`: Event name (e.g., `issues.opened`)
  - `X-GitHub-Delivery`: UUID for deduplication
  - `X-Hub-Signature-256`: HMAC signature
  - `X-GitHub-Hook-Installation-Target-Type`: `repository` or `organization`
  - `X-GitHub-Hook-Installation-Target-ID`: ID of the repo or org
- **Retry behavior**: GitHub retries failed deliveries (non-2xx response or timeout >10s) with exponential backoff: ~5 retries over ~24 hours.
- **Deduplication**: Use `X-GitHub-Delivery` UUID as idempotency key.
- **Timeout**: Must respond with 2xx within 10 seconds. For long processing, respond 202 Accepted and process asynchronously.

#### Polling Fallback (Current Implementation)

The existing `github-cli` uses polling exclusively:

- `gh issue list --repo <owner>/<repo> --state open --json number,title,body,state,labels,assignees,url,createdAt,updatedAt` — list with `--since` for incremental sync
- `gh issue list --repo <owner>/<repo> --state closed --json ...` — closed issues
- `gh pr list --repo <owner>/<repo> --state open --json ...` — open PRs
- `gh pr list --repo <owner>/<repo> --state merged --limit 100 --json ...` — merged PRs
- `gh api /repos/<owner>/<repo>/issues?since=<ISO8601>&per_page=100` — raw API with `since` cursor

**Recommended cursor strategy**: Store `updated_at` of last processed item. On next poll, fetch `since=<last_updated_at>` to get only updated items.

#### Payload Fields to Persist

From `GET /repos/{owner}/{repo}/issues/{issue_number}`:

```json
{
  "id": 1,
  "number": 42,
  "title": "Bug: login fails on Safari",
  "body": "...",
  "state": "open",
  "state_reason": null,
  "html_url": "https://github.com/owner/repo/issues/42",
  "user": { "login": "octocat", "id": 1, "avatar_url": "..." },
  "labels": [{ "id": 1, "name": "bug", "color": "d73a4a" }],
  "assignees": [{ "login": "octocat", "id": 1 }],
  "milestone": { "id": 1, "number": 1, "title": "v1.0", "state": "open" },
  "comments": 5,
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-02T00:00:00Z",
  "closed_at": null,
  "pull_request": { "url": "...", "merged_at": null, "merged": false },
  "locked": false,
  "repository_url": "https://api.github.com/repos/owner/repo"
}
```

From `GET /repos/{owner}/{repo}/issues/{issue_number}/comments`:

```json
{
  "id": 1,
  "body": "Comment text",
  "user": { "login": "octocat", "id": 1 },
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z",
  "html_url": "https://github.com/owner/repo/issues/42#issuecomment-1"
}
```

---

## 4. Outbound — Writing Back

### Create Issue

```
POST /repos/{owner}/{repo}/issues
Authorization: Bearer <token>

{
  "title": "Issue title",
  "body": "Issue body (markdown)",
  "labels": ["bug", "priority-high"],
  "assignees": ["username"],
  "milestone": 1
}

Response: 201 Created — full Issue object
```

### Post Comment (Issue or PR)

```
POST /repos/{owner}/{repo}/issues/{issue_number}/comments
Authorization: Bearer <token>

{
  "body": "Comment body (markdown, supports @mentions)"
}

Response: 201 Created — full Comment object with `id`
```

**Note**: For PRs, this posts an issue-level comment. Use `pull_request_review` for inline comments.

### Edit Comment

```
PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}
Authorization: Bearer <token>

{
  "body": "Updated comment body"
}

Response: 200 OK
```

### Delete Comment

```
DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}
Authorization: Bearer <token>

Response: 204 No Content
```

### Close/Reopen Issue

```
PATCH /repos/{owner}/{repo}/issues/{issue_number}
Authorization: Bearer <token>

{ "state": "closed", "state_reason": "completed" | "not_planned" | "duplicate" }

or

{ "state": "open" }

Response: 200 OK
```

### Add/Remove Labels

```
POST   /repos/{owner}/{repo}/issues/{issue_number}/labels
DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}

Authorization: Bearer <token>

POST body: { "labels": ["bug", "help-wanted"] }
Response: 200 OK — array of Label objects

DELETE: Response 200 OK (removes single label)
```

**Replace all labels** (set exact label set):

```
PUT /repos/{owner}/{repo}/issues/{issue_number}/labels
{ "labels": ["bug", "priority-high"] }
```

### Add/Remove Assignees

```
POST   /repos/{owner}/{repo}/issues/{issue_number}/assignees
DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees

{ "assignees": ["username1", "username2"] }
```

### Set Milestone

```
PATCH /repos/{owner}/{repo}/issues/{issue_number}
{ "milestone": 1 }  // milestone number, or null to remove
```

### Lock/Unlock Issue (prevent comments)

```
PUT  /repos/{owner}/{repo}/issues/{issue_number}/lock
DELETE /repos/{owner}/{repo}/issues/{issue_number}/lock

{ "lock_reason": "off-topic" | "too heated" | "resolved" | "spam" }
```

### Mention User

In comment body: use `@username` syntax. GitHub renders it as a link and notifies the user. No special API field.

### Create PR

```
POST /repos/{owner}/{repo}/pulls
{
  "title": "PR title",
  "head": "feature-branch",
  "base": "main",
  "body": "PR description (markdown)",
  "draft": false,
  "maintainer_can_modify": true
}

Response: 201 Created
```

### Approve / Request Changes on PR

```
POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews
{
  "event": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "body": "Review comment body"
}
```

### Merge PR

```
PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge
{
  "merge_method": "merge" | "squash" | "rebase",
  "commit_title": "...",
  "commit_message": "..."
}

Response: 200 OK (or 405 if not mergeable)
```

### Add PR Reviewers

```
POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers
{ "reviewers": ["username1", "team-slug"] }
```

### Post Inline PR Review Comment

```
POST /repos/{owner}/{repo}/pulls/{pull_number}/comments
{
  "body": "Comment on specific lines",
  "commit_id": "<sha>",
  "path": "src/file.ts",
  "line": 42,
  "side": "RIGHT"  // or "LEFT" for old version
}

Response: 201 Created
```

---

## 5. Labels, Flags, Fields, Priorities

### Built-in Label Model

- Labels are global per repository (not per-project on v1 Projects).
- Label fields: `id`, `name`, `color` (6-char hex without `#`), `description`, `url`.
- Created via `POST /repos/{owner}/{repo}/labels`.
- List via `GET /repos/{owner}/{repo}/labels` (paginated, max 100/page).

### GitHub Projects (v2) — Custom Fields

- Projects (beta/classic) have typed custom fields: `Title`, `Text`, `Number`, `Date`, `Single-select`, `Multi-select`, `Iteration`, `Relation`, `Assignee`, `Linked Pull Requests`.
- Accessed via **GraphQL API only** (not REST).
- GraphQL endpoint: `POST https://api.github.com/graphql`
- Documented in `docs/github-projects-integration.md` (specced, not implemented).

### Status Model

GitHub issues have a flat `state` (`open` | `closed`). Closures have a `state_reason` (`completed`, `not_planned`, `duplicate`, `reopened`).

GitHub Projects (v2) have a `Status` single-select field with user-defined options — no fixed values.

### Priority Model

No native priority field. Use labels: `priority:critical`, `priority:high`, `priority:medium`, `priority:low`.

Current `github-cli` uses the set: `severity-critical`, `severity-high`, `severity-medium`, `severity-low`, `severity-unknown`.

### Severity Model

Same as priority — implemented as labels. No native severity field.

---

## 6. Triggers We Can Match On

From inbound event payloads and polling results:

| Trigger | Payload Field | Operator |
|---------|---------------|----------|
| `github.issue.opened` | `action === 'opened'` | event match |
| `github.issue.closed` | `action === 'closed'` | event match |
| `github.issue.reopened` | `action === 'reopened'` | event match |
| `github.issue.labeled` | `action === 'labeled'` + `label.name` | event match |
| `github.issue.unlabeled` | `action === 'unlabeled'` + `label.name` | event match |
| `github.issue.assigned` | `action === 'assigned'` + `assignee.login` | event match |
| `github.issue.comment` | `action === 'created'` on `issue_comment` | event match |
| `github.pr.opened` | `action === 'opened'` + `issue.pull_request` present | event match |
| `github.pr.merged` | `action === 'closed'` + `pull_request.merged === true` | event match |
| `github.pr.review` | `action === 'submitted'` on `pull_request_review` | event match |
| Label exact-set | `issue.labels[].name` | `contains_any` / `contains_all` |
| Status transition | `issue.state` changes | `state === 'closed'` |
| Mention of bot | `comment.body` contains `@<bot_login>` | regex |
| Comment body regex | `comment.body` | regex |
| Assignee change | `issue.assignees[].login` | `added_to` / `removed_from` |
| Repo scope | `repository.full_name` | exact match (filtering) |
| Org scope | `organization.login` | exact match (filtering) |
| Author | `issue.user.login` | exact match |
| Milestone | `issue.milestone.number` | exact match |
| Custom field (Projects v2) | GraphQL `ProjectV2ItemField` | via GraphQL |

---

## 7. Identity Mapping

### User ID Shape

- `id`: Integer (e.g., `583231`)
- `login`: String handle (e.g., `octocat`)
- `node_id`: Base64-encoded global ID (e.g., `MDExOlB1bGxSZXF1ZXN0Mg==`)
- **Primary key**: `id` (integer) is stable globally. `login` is stable per-user but changes if a user renames their account.

### Resolve User → Email

- REST API does **not** expose private email. Requires `user:email` scope for `GET /user/emails` (only for the authenticated user).
- For others: no email via API. Use `@mention` which GitHub handles internally.

### Bot Identity (no_self_retrigger)

- Bot users look like regular users in payloads — `user.login`, `user.id`.
- Bot identity is determined by which token made the API call.
- **Pattern**: Store `ghGetAuthenticatedLogin()` result at startup. Filter events where `payload.sender.id === bot_user_id` or `payload.sender.login === bot_login`.
- **Webhook path**: `X-GitHub-Event-Installation` events also include `sender` — same pattern.
- **Current implementation**: `ghGetAuthenticatedLogin()` called at dispatcher startup. Correct — no change needed.

### Author Field on Posted Comments

- When we POST a comment, the response includes `"user": { "login": "...", "id": ... }` — the authenticated user (bot).
- GitHub does **not** expose a separate "author" vs "actor" distinction on comments — the `user` field always reflects the API token's identity.
- This is sufficient for `no_self_retrigger`: if `comment.user.id === bot_user_id`, it's our own comment.

---

## 8. Rate Limits

### Default Limits

| Auth Level | Requests/Hour |
|------------|---------------|
| Unauthenticated | 60 |
| PAT (authenticated) | 5,000 |
| GitHub App installation token | 5,000 (base) + 0.5× installs bonus |
| Search API | 30 (authenticated) |

### Rate Limit Headers

```
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4999
X-RateLimit-Reset: 1672531200        // Unix timestamp when limit resets
X-RateLimit-Used: 1
X-RateLimit-Resource: core
```

### Check via API

```
GET /rate_limit
Response: { "rate": { "limit": 5000, "remaining": 4999, "reset": 1672531200, "used": 1 } }
```

### Retry Semantics

- When `X-RateLimit-Remaining === 0`: check `X-RateLimit-Reset` header. Wait until that Unix timestamp, then retry.
- GitHub returns `403 Forbidden` with `Retry-After: <seconds>` header when rate limited.
- **@octokit/rest**: built-in throttling plugin. Set `throttle: { onRateLimit, onAbuseLimit }` in constructor options.

### Bulk/Batch Endpoints

- `GET /repos/{owner}/{repo}/issues` — up to 100 per page (vs 30 default). Use `per_page=100`.
- `GET /search/issues` — search across multiple repos (but rate-limited at 30/min).
- **No batch mutation endpoint** — each POST/PATCH is one operation.

---

## 9. Pagination & Search

### Pagination Style

GitHub uses **page number pagination** (not cursor-based) for most endpoints:

```
GET /repos/owner/repo/issues?page=2&per_page=100

Link header:
<https://api.github.com/repositories/1/issues?page=2&per_page=100>; rel="next",
<https://api.github.com/repositories/1/issues?page=3&per_page=100>; rel="last"
```

- `per_page` max: 100 (most endpoints), 1000 (search)
- Default `per_page`: 30
- `page` starts at 1. Use `rel="next"` from Link header to determine when to stop.

### List Endpoints with Filtering

| Endpoint | Filter Params |
|----------|---------------|
| `GET /repos/{owner}/{repo}/issues` | `state`, `labels`, `sort`, `direction`, `since`, `milestone`, `assignee`, `creator`, `mentioned`, `per_page`, `page` |
| `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` | `since`, `per_page`, `page` |
| `GET /repos/{owner}/{repo}/pulls` | `state`, `head`, `base`, `sort`, `direction`, `per_page`, `page` |
| `GET /repos/{owner}/{repo}/issues/comments` | `issue_number` filter not supported — iterate per issue |

### Search API

```
GET /search/issues
?q=is:issue is:open label:bug repo:owner/repo&sort=created&order=desc&per_page=100
```

Qualifiers: `is:issue`, `is:pr`, `is:open`, `is:closed`, `label:name`, `repo:owner/repo`, `author:username`, `assignee:username`, `mentions:username`, `created:>2024-01-01`, `updated:>2024-01-01`, `comments:>5`.

**Rate limited**: 30 requests/minute for authenticated search.

### Incremental Sync (Cursor Strategy)

For polling, use `GET /repos/{owner}/{repo}/issues?since=<ISO8601>&per_page=100` — returns issues updated since the given timestamp. Store `updated_at` of last processed item.

---

## 10. Known Gotchas

### Cloud vs Enterprise

- **GHES versioning**: Different GHES versions have different API feature sets. API deprecation warnings appear 1 year before removal. GHES 3.x matches GitHub.com API v3 closely; GHES 2.x has more gaps.
- **GitHub Apps on GHES**: GHES 2.19+ supports GitHub Apps. Set `baseUrl` to `https://<hostname>/api/v3` in SDK config.
- **Webhook delivery on GHES**: Same `X-Hub-Signature-256` pattern. GHES supports the same event types but may lag in new additions.

### Webhook Delivery

- **Timeout**: Must respond within 10s or GitHub marks as failed and retries. Long processing must be async — respond 202 immediately.
- **Eventual consistency**: Webhook delivery and API read consistency are not guaranteed. After receiving `issues.opened`, a subsequent `GET /repos/{owner}/{repo}/issues/{issue_number}` may return 404 briefly. Retry with backoff.
- **Duplicate delivery**: `X-GitHub-Delivery` UUID allows idempotency. Store processed delivery IDs in Redis with 24h TTL.

### Comments Are Dual-Context

- Issue-level comments (`issue_comment`) live on the issue/PR itself.
- Review-level comments (`pull_request_review_comment`) are attached to a specific review and/or file+line.
- The existing `github-cli` only handles issue-level comments via `gh api repos/.../issues/<n>/comments`.
- The `ghGetPRFiles()` and `ghGetPRDiff()` functions exist for PR review context but are read-only.

### Label Operations

- `POST /repos/{owner}/{repo}/issues/{issue_number}/labels` adds labels without replacing existing ones.
- `PUT /repos/{owner}/{repo}/issues/{issue_number}/labels` **replaces** the entire label set.
- `DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}` removes a single label.
- **No partial update**: Must read current labels, compute diff, then PUT full set if you need atomicity.

### Issue vs PR Number Collisions

- GitHub uses a unified number counter per repository. Issue #42 and PR #42 are mutually exclusive.
- The `pull_request` field on an Issue object is `null` for issues and non-null for PRs.

### Fine-Grained PATs

- Require explicit permission per repo or org.
- May expire (configurable max 1 year).
- When listing org memberships, `read:org` scope is needed.

### Multi-Tenant Webhook Setup

- GitHub App webhooks arrive at a single URL per app installation. GitHub appends `X-GitHub-Installation-Id` to identify which installation the event belongs to.
- PAT-based webhooks are per-repo or per-org. Each tenant's repo needs its own webhook registration.
- GitHub.com supports organization-level webhooks that cover all repos in the org.

### GitHub Projects (v2)

- **REST API**: No support. Only GraphQL (`POST /graphql`).
- **GraphQL schema**: `ProjectV2` and `ProjectV2Item` types. Querying items requires `projectV2` field on `Repository`.
- **Specced** in `docs/github-projects-integration.md` but **zero code** implemented.

### Repository Visibility

- PAT must have access to the repository (public = no auth needed for read, private = auth required).
- Listing repos requires `repo` scope or membership in the org.

---

## 11. Recommended SupportAgent Connector Scope

### MVP (Minimum to Be Useful)

**Endpoints to wrap**:
- `GET /repos/{owner}/{repo}/issues` — poll open/closed issues
- `GET /repos/{owner}/{repo}/issues/{issue_number}` — single issue
- `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` — comments
- `POST /repos/{owner}/{repo}/issues` — create issue
- `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` — post comment
- `PATCH /repos/{owner}/{repo}/issues/{issue_number}` — close/reopen, edit title/body, set labels/assignees
- `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}` — edit comment
- `DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}` — delete comment
- `GET /repos/{owner}/{repo}/pulls` — list PRs
- `GET /repos/{owner}/{repo}/pulls/{pull_number}` — single PR
- `POST /repos/{owner}/{repo}/pulls` — create PR
- `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` — approve/request-changes
- `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge` — merge PR
- `GET /repos/{owner}/{repo}/labels` — list available labels
- `GET /user` — bot identity
- `GET /user/orgs` — list orgs (for discovery)
- `GET /orgs/{org}/repos` — list repos per org (for discovery)
- `GET /repos/{owner}/{repo}` — repo metadata

**Webhook events to handle**:
- `issues.opened`, `issues.closed`, `issues.reopened`
- `issues.labeled`, `issues.unlabeled`
- `issue_comment.created`, `issue_comment.edited`
- `pull_request.opened`, `pull_request.closed` (with merged detection)
- `ping` (health check)
- `installation`, `installation_repositories` (GitHub App events)

**Webhook signature verification**:
- HMAC-SHA256 via `X-Hub-Signature-256` header

**Admin panel config fields**:
- `auth_mode`: `token` | `github_app` (MVP: `token` only)
- `access_token`: string (PAT)
- `repo_owner`: string
- `repo_name`: string
- `api_base_url`: string (default `https://api.github.com`)
- `webhook_secret`: string
- `bot_login`: string (resolved from `/user`)

**Auth modes to implement**:
- `token`: PAT with `Authorization: Bearer` header
- `local_gh`: keep existing `gh` CLI wrapper for dev/CI (falls back to PAT in prod)

### Phase 2 (Parity with GitHub Connector)

**Additional endpoints**:
- `POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers` — request review
- `DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers` — remove reviewer
- `GET /search/issues` — cross-repo or complex-label search
- `POST /repos/{owner}/{repo}/issues/{issue_number}/labels` — add labels (without replacing)
- `DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}` — remove label
- `PUT /repos/{owner}/{repo}/issues/{issue_number}/lock` — lock conversation
- `DELETE /repos/{owner}/{repo}/issues/{issue_number}/lock` — unlock
- `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments` — inline PR comments
- `GET /rate_limit` — check before heavy sync

**Additional webhook events**:
- `pull_request_review.submitted`
- `pull_request_review_comment.created`, `edited`, `deleted`
- `issues.assigned`, `issues.demilestoned`
- `check_run.created`, `check_run.completed`
- `release.published`

**GitHub App auth mode**:
- Implement GitHub App registration + installation OAuth flow
- Store `app_id`, `private_key`, `installation_id` per tenant
- Generate and cache installation tokens (1h TTL, refresh automatically)

**Additional trigger matchers**:
- `github.pr.review` (submitted review)
- `github.pr.review_requested`
- `github.issue.assigned`
- `github.check_run` (Phase 3 for triage automation)

### Phase 3 (Advanced)

**GitHub Projects (v2) via GraphQL**:
- `GET /graphql` — query `ProjectV2` items, status, custom fields
- Write status via GraphQL mutation `updateProjectV2ItemFieldValue`
- Documented in `docs/github-projects-integration.md`

**Check Runs / Check Suites**:
- `GET /repos/{owner}/{repo}/commits/{ref}/check-runs`
- `POST /repos/{owner}/{repo}/check-runs` — create check run
- `PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}` — update check run
- Useful for CI/CD triage automation

**Deployments**:
- `GET /repos/{owner}/{repo}/deployments`
- `GET /repos/{owner}/{repo}/deployment-statuses`
- Trigger on deployment success/failure

**GraphQL for complex queries**:
- Use GraphQL for cross-repo queries, complex search, and Projects v2.

---

## 12. Dependencies

### Official SDK

**Package**: `@octokit/rest`

- **npm**: `https://www.npmjs.com/package/@octokit/rest`
- **TypeScript**: Built-in types
- **Auth**: Supports `auth: 'token'`, `auth: { token }`, `auth: createAppAuth()` (GitHub App), `auth: createOAuthAppAuth()` (OAuth)
- **Throttling**: Built-in throttle plugin with `onRateLimit` and `onAbuseLimit` callbacks
- **Pagination**: Built-in pagination helpers (page-number based)
- **GHES**: Pass `baseUrl: 'https://<hostname>/api/v3'` for Enterprise Server
- **GraphQL**: `@octokit/graphql` or use `octokit.graphql()` from the same package
- **Bundle size**: Tree-shakeable, ~200KB min

**Alternative**: `@octokit/action` — wraps `@octokit/rest` with retry + cache middleware. Good for serverless. Not needed if we implement our own throttle/retry layer.

### Recommendation: Migrate from `gh` CLI to `@octokit/rest`

**Keep `local_gh` for**:
- Dev environments where `gh` is already authenticated
- CI/CD where `GH_TOKEN` is set in environment

**Migrate to `@octokit/rest` for**:
- Production multi-tenant deployments
- Full webhook support (requires a proper HTTP server anyway)
- GitHub App auth (requires JWT + token exchange, can't use `gh` CLI)
- GHES support (current `github-cli` never passes `--hostname`)
- Rate limit awareness and retry (current `github-cli` has no retry logic)

**Migration strategy**:
1. Add `@octokit/rest` as a new dependency in `packages/github-api` (new package).
2. Port the existing `ghListReposForOwner`, `ghAddIssueComment`, etc., to REST calls.
3. Add webhook receiver in `apps/api/src/routes/webhooks.ts` using `verifyWebhookSignature`.
4. Keep `@support-agent/github-cli` as a thin wrapper over `gh` CLI for dev/CI only.
5. Phase out `github-cli` dependency in workers once `github-api` is stable.

**Do NOT use `gh` CLI in production**:
- `gh` CLI is a user-facing tool, not a library. Its output format can change between versions.
- No programmatic error handling, retry, or rate limit management.
- Cannot be used for GitHub App authentication (JWT issuance requires the `jwt` npm package, not the CLI).

---

## 13. Open Questions

1. **Does any tenant use GitHub Enterprise Server?** The current connector has `api_base_url` in config but never uses it. If no GHES tenant exists, deprioritize `baseUrl` injection. If GHES is needed, test against a real GHES instance (the `gh` CLI's `--hostname` flag works; SDK's `baseUrl` works the same way).

2. **GitHub App vs PAT for multi-tenant**: PATs are simpler to implement. GitHub Apps require OAuth redirect flow, JWT signing, and installation token management. Should we support both (MVP: PAT, Phase 2: App) or go straight to App?

3. **How are existing runs deduplicated when switching from polling to webhooks?** The current polling approach uses `updated_at` as a cursor. When webhooks take over, we need to ensure no events are missed between the last poll and the webhook registration timestamp. Solution: run a final reconciliation poll after registering the webhook.

4. **Comment threading**: GitHub supports threaded conversations (replies to comments). Do we need to track parent comment IDs for reply context, or can we treat all comments as flat? The current `github-cli` ignores threading.

5. **Rate limit budget for polling**: If webhooks fail or are unavailable, the polling fallback consumes API budget. What's the acceptable poll interval and max per-tenant rate budget?

6. **Organization vs repository webhooks**: Should we support org-level webhook registration (covers all repos) or only per-repo? Org webhooks require `admin:org_hook` permission and GitHub App installation at org level.

7. **GitHub Projects integration priority**: The spec exists in `docs/github-projects-integration.md`. Is this Phase 2 or Phase 3? Projects v2 GraphQL is significantly more complex than REST.

---

## Appendix A: Current `github-cli` Implementation Map

Functions in `packages/github-cli/src/index.ts` → REST API equivalents:

| `github-cli` Function | REST API Equivalent |
|------------------------|----------------------|
| `ghGetIssue()` | `GET /repos/{owner}/{repo}/issues/{issue_number}` |
| `ghListOpenIssues()` | `GET /repos/{owner}/{repo}/issues?state=open` |
| `ghListClosedIssues()` | `GET /repos/{owner}/{repo}/issues?state=closed` |
| `ghAddIssueComment()` | `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` |
| `ghAddIssueLabels()` | `POST /repos/{owner}/{repo}/issues/{issue_number}/labels` + `POST /repos/{owner}/{repo}/labels` |
| `ghEditIssueLabels()` | `PUT /repos/{owner}/{repo}/issues/{issue_number}/labels` |
| `ghCloseIssue()` / `ghReopenIssue()` | `PATCH /repos/{owner}/{repo}/issues/{issue_number}` (state) |
| `ghGetPR()` | `GET /repos/{owner}/{repo}/pulls/{pull_number}` |
| `ghGetPRFiles()` | `GET /repos/{owner}/{repo}/pulls/{pull_number}/files` |
| `ghGetPRDiff()` | `GET /repos/{owner}/{repo}/pulls/{pull_number}` with `Accept: application/vnd.github.v3.diff` |
| `ghListOpenPRs()` | `GET /repos/{owner}/{repo}/pulls?state=open` |
| `ghListMergedPRs()` | `GET /repos/{owner}/{repo}/pulls?state=closed` + filter `merged:true` |
| `ghAddPRComment()` | `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` |
| `ghListPrComments()` | `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` |
| `ghCreatePR()` | `POST /repos/{owner}/{repo}/pulls` |
| `ghMergePR()` | `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge` |
| `ghApprovePR()` / `ghRequestChangesPR()` | `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` |
| `ghGetComment()` / `ghEditComment()` | `GET /repos/{owner}/{repo}/issues/comments/{id}` / `PATCH ...` |
| `ghGetAuthenticatedLogin()` | `GET /user` |
| `ghGetOrganizations()` | `GET /user/orgs` |
| `ghListReposForOwner()` | `GET /repos/{owner}` |
| `ghCanListReposForOwner()` | `GET /repos/{owner}` (single-item canary) |
| `ghCloneRepo()` / `ghCreateBranch()` / `ghCommitAll()` | Git operations (no REST equivalent) |

**Missing from `github-cli`** (not mapped — need new implementation):
- Webhook signature verification
- Webhook event routing (`github_issues` trigger dispatch)
- Issue assignee management
- Issue milestone management
- Issue lock/unlock
- PR reviewer management
- Inline PR comments
- GitHub App auth (JWT + installation token)
- GHES `baseUrl` injection
- Rate limit handling / retry

---

## Appendix B: Relevant Documentation Links

- REST API reference: https://docs.github.com/en/rest
- Webhook events: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- Rate limits: https://docs.github.com/en/rest/rate-limit
- REST API authentication: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-githubs-rest-api
- GitHub App authentication: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app
- PAT scopes: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token
- @octokit/rest: https://github.com/octokit/octokit.js
- Octokit pagination: https://github.com/octokit/plugin-paginate-rest.js
- Octokit throttle: https://github.com/octokit/plugin-throttling-rest.js
- GitHub GraphQL API: https://docs.github.com/en/graphql
- GitHub Projects (GraphQL): https://docs.github.com/en/issues/planning-and-tracking-with-projects/using-the-api-that-supports-projects-v2
- GHES API compatibility: https://docs.github.com/en/enterprise-server@latest/rest/overview/api-versioning
