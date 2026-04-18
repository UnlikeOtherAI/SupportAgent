# GitHub Issues Connector Design

> Version: 1.0 | Last updated: 2026-04-18

## 1. Overview

- **Category**: Issue tracker (distinct from GitHub's version-control/PR workflow)
- **Cloud vs self-hosted**: GitHub.com (cloud) + GitHub Enterprise Server (GHES) — same REST API, different base URLs
- **Official API reference**: https://docs.github.com/en/rest/issues/issues
- **API version header**: `X-GitHub-Api-Version: 2022-11-28` (current) — update as needed
- **Accept header required**: `Accept: application/vnd.github+json`

### Cloud vs Enterprise Differences

| Feature | GitHub.com | GHES |
|---------|-----------|------|
| Base URL | `https://api.github.com` | `https://<host>/api/v3` |
| Webhooks | Full support | Full support (since GHES 2.20) |
| Fine-grained PATs | Yes | Yes (GHES 3.4+) |
| GraphQL | Yes | Yes (GHES 3.0+) |
| Projects v2 | Yes | Yes (GHES 3.4+) |

---

## 2. Authentication

### PAT (Personal Access Token) — MVP Recommended

**Obtain**: GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens (recommended)

**Header**:
```
Authorization: Bearer <token>
```

**Required repository permissions** (fine-grained PAT):
| Capability | Permission |
|------------|------------|
| Read issues | Issues: Read |
| Create/update issues | Issues: Write |
| Read comments | Issues: Read |
| Post/edit/delete comments | Issues: Write |
| Manage labels | Issues: Write |
| Manage assignees | Issues: Write |
| Read repository metadata | Contents: Read |
| Read webhook events | Webhooks: Read (for subscription setup) |

**Token lifetime**: Non-expiring by default (unless org enforces expiration)

### OAuth App

**Flow**: Standard OAuth 2.0 three-legged flow
- Authorization URL: `https://github.com/login/oauth/authorize`
- Token URL: `https://github.com/login/oauth/access_token`

**Required scopes**:
| Capability | Scope |
|------------|-------|
| Read issues | `repo` (full) or `read:issues` (granular) |
| Write issues/comments | `repo` (full) or `write:issues` (granular) |

**Token lifetime**: 8 hours, refreshable

### GitHub App (Recommended for Multi-tenant / Org-level)

**Setup**: GitHub App registration → Install per organization

**Authentication**:
1. Generate JWT using app's private key
2. Exchange JWT for installation access token
3. Use installation token for API calls

**Headers**:
```
Authorization: Bearer <installation_access_token>
```

**Installation token lifetime**: 1 hour (auto-refresh via new JWT exchange)

**Required app permissions**:
| Capability | Permission |
|------------|------------|
| Issues | Read & write |
| Repository metadata | Read-only |
| Webhooks | Read & write (for subscription management) |

### Webhook HMAC Verification

**Algorithm**: HMAC-SHA256

**Header**: `X-Hub-Signature-256`

**Format**: `sha256=<hex_digest>`

**Secret provisioning**: Configured when creating webhook; stored as `webhook_secret` in connector config

**Verification** (pseudocode):
```typescript
const crypto = await import('crypto');
const expected = `sha256=${crypto
  .createHmac('sha256', webhookSecret)
  .update(rawBody)
  .digest('hex')}`;
const isValid = timingSafeEqual(
  Buffer.from(signature),
  Buffer.from(expected)
);
```

### Recommendation for MVP

**Use Fine-grained PAT** — simpler to implement, no OAuth callback handling, sufficient for single-org/multi-repo support. Graduate to GitHub App when:
- Multi-tenant (multiple GitHub orgs)
- SAML SSO orgs (PATs require per-org authorization)
- Installation-scoped access needed

---

## 3. Inbound — Events and Intake

### Webhook Support: Yes

#### Event Types

| Event | Actions | SupportAgent Use |
|-------|---------|------------------|
| `issues` | `opened`, `closed`, `reopened`, `labeled`, `unlabeled`, `assigned`, `unassigned`, `edited`, `deleted`, `transferred`, `pinned`, `unpinned`, `locked`, `unlocked`, `milestoned`, `demilestoned` | Primary intake |
| `issue_comment` | `created`, `edited`, `deleted` | Comment sync |
| `label` | `created`, `deleted`, `edited` | Label management |
| `issue_dependencies` | `blocking_added`, `blocking_removed`, `blocked_by_added`, `blocked_by_removed` | Dependency tracking |

#### Webhook Delivery Semantics

- **Delivery ID header**: `X-GitHub-Delivery` (UUID)
- **Event type header**: `X-GitHub-Event`
- **Signature header**: `X-Hub-Signature-256`
- **Actor header**: `X-GitHub-Hook-Execution-GitHub-User-Login` (bot user for bot-triggered events)

**Retry behavior**:
- GitHub retries failed deliveries up to **5 times** with exponential backoff
- Delivery timeouts: ~10 seconds
- Manual re-delivery available via GitHub UI or API

**Webhook endpoint requirement**: Must return `200` within 10s or GitHub marks as failed

#### Polling Fallback

**Primary endpoint**:
```
GET /repos/{owner}/{repo}/issues
```

**Key query parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `since` | ISO 8601 timestamp | Return issues updated after this time |
| `state` | `open`, `closed`, `all` | Filter by state |
| `labels` | comma-separated | Filter by labels |
| `per_page` | integer (max 100) | Items per page |
| `page` | integer | Page number |

**Recommended polling strategy**:
1. Store last-checked timestamp per repo
2. Use `since=<last_timestamp>` for incremental sync
3. Fall back to full sync on cache miss

**Comments polling**:
```
GET /repos/{owner}/{repo}/issues/{issue_number}/comments
GET /repos/{owner}/{repo}/issues/comments?since=<timestamp>
```

#### Payload Fields to Persist

**Issue object**:
```typescript
interface GitHubIssue {
  id: number;                    // Unique integer ID
  node_id: string;               // Base64-encoded gid
  number: number;                // Human-readable number
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  state_reason: 'completed' | 'not_planned' | 'reopened' | null;
  user: { login: string; id: number; avatar_url: string; type: 'User' | 'Bot' };
  labels: Array<{ id: number; name: string; color: string; description: string }>;
  assignees: Array<{ login: string; id: number }>;
  milestone: { id: number; number: number; title: string } | null;
  comments: number;               // Count only
  pull_request: { url: string; html_url: string } | null;  // null for issues
  closed_at: string | null;
  created_at: string;             // ISO 8601
  updated_at: string;             // ISO 8601
  url: string;                   // API URL
  html_url: string;               // Web URL
  locked: boolean;
  author_association: 'NONE' | 'COLLABORATOR' | 'CONTRIBUTOR' | 'MEMBER' | 'OWNER';
}
```

**Issue comment object**:
```typescript
interface GitHubIssueComment {
  id: number;
  node_id: string;
  body: string;
  user: { login: string; id: number; type: 'User' | 'Bot' };
  created_at: string;
  updated_at: string;
  url: string;
  html_url: string;
  author_association: string;
}
```

**Webhook-specific payload**:
```typescript
interface GitHubWebhookPayload {
  action: string;
  issue: GitHubIssue;
  repository: { id: number; full_name: string; html_url: string };
  sender: { login: string; id: number; type: 'User' | 'Bot' };
  label?: { id: number; name: string; color: string };
  assignee?: { login: string; id: number };
  comment?: GitHubIssueComment;
}
```

---

## 4. Outbound — Writing Back

### Create Issue

```
POST /repos/{owner}/{repo}/issues
```

**Request body**:
```json
{
  "title": "Issue title (required)",
  "body": "Issue body text",
  "milestone": 1,
  "labels": ["bug", "enhancement"],
  "assignees": ["username1", "username2"]
}
```

**Response**: `201 Created` with full Issue object

### Post Comment on Issue

```
POST /repos/{owner}/{repo}/issues/{issue_number}/comments
```

**Request body**:
```json
{
  "body": "Comment body with @mention support"
}
```

**Response**: `201 Created` with full Comment object

### Edit Comment

```
PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}
```

**Request body**:
```json
{
  "body": "Updated comment body"
}
```

**Response**: `200 OK` with updated Comment object

### Delete Comment

```
DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}
```

**Response**: `204 No Content`

### Change State

```
PATCH /repos/{owner}/{repo}/issues/{issue_number}
```

**Request body**:
```json
{
  "state": "closed",
  "state_reason": "completed" | "not_planned"
}
```

**Response**: `200 OK` with updated Issue object

### Add Labels

```
POST /repos/{owner}/{repo}/issues/{issue_number}/labels
```

**Request body**:
```json
{
  "labels": ["bug", "high-priority"]
}
```

**Response**: `200 OK` with array of Label objects

### Remove Label

```
DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}
```

**Response**: `200 OK` with remaining labels

### Replace All Labels

```
PUT /repos/{owner}/{repo}/issues/{issue_number}/labels
```

**Request body**:
```json
{
  "labels": ["bug"]  // Empty array removes all labels
}
```

### Add/Remove Assignees

```
POST /repos/{owner}/{repo}/issues/{issue_number}/assignees
```

**Request body**:
```json
{
  "assignees": ["username1"]
}
```

### Lock Issue (Prevent Further Comments)

```
PUT /repos/{owner}/{repo}/issues/{issue_number}/lock
```

**Request body**:
```json
{
  "lock_reason": "off-topic" | "too heated" | "resolved" | "spam"
}
```

### Unlock Issue

```
DELETE /repos/{owner}/{repo}/issues/{issue_number}/lock
```

### Create Label

```
POST /repos/{owner}/{repo}/labels
```

**Request body**:
```json
{
  "name": "severity-high",
  "color": "D93F0B",
  "description": "High severity issue"
}
```

### Mention User

Use `@username` syntax in issue body or comment body. GitHub auto-links and notifies mentioned users.

### Attach File

GitHub Issues doesn't support direct file uploads via API. Options:
1. **Use GitHub Releases**: Upload as release asset, link in issue
2. **Use Gist**: Create gist, link in issue
3. **External hosting**: Link to externally hosted files

---

## 5. Labels, Flags, Fields, Priorities

### Built-in Label Model

**Repository labels**:
```typescript
interface GitHubLabel {
  id: number;
  node_id: string;
  name: string;
  color: string;           // 6-char hex (e.g., "D93F0B")
  description: string;
  default: boolean;        // Is this a default label?
}
```

**List repo labels**:
```
GET /repos/{owner}/{repo}/labels?per_page=100
```

**Default labels on new repos**: `bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`

### Custom Field Support

GitHub Issues does **not** have native custom fields. Workarounds:

| Approach | Description |
|----------|-------------|
| **Labels as tags** | Use label naming convention (e.g., `priority:high`, `severity:critical`) |
| **Projects v2** | Use project boards with custom fields (single-select, text, number, date, iteration, etc.) |
| **Milestones** | Group into milestones for rough categorization |
| **Issue body templates** | Structured templates with checkbox/field-like sections |

### Projects v2 (Recommended for Structured Data)

**API for Projects v2**:
```
GET /orgs/{org}/projectsV2
GET /repos/{owner}/{repo}/projectsV2
```

**Item management**:
```
POST /projects/{project_id}/items          # Add issue to project
PATCH /projects/items/{item_id}             # Update item
DELETE /projects/items/{item_id}            # Remove item
```

**Field values**:
```
PATCH /projects/items/{item_id}
{
  "field_id": "field_id",
  "value": "option_name"  // or string/number for other types
}
```

### Status Model

GitHub Issues use simple `state` field:
- `open` — Issue is open
- `closed` — Issue is closed with optional `state_reason`:
  - `completed` — Resolved
  - `not_planned` — Won't fix/declined

**No workflow/column model** in base Issues — use Projects v2 for Kanban-style workflows.

### Priority Model

GitHub has no native priority field. Use labels:
- `priority:critical`, `priority:high`, `priority:medium`, `priority:low`
- Or use Projects v2 with single-select Priority field

### Severity Model

No native severity. Use labels:
- `severity:critical`, `severity:high`, `severity:medium`, `severity:low`

---

## 6. Triggers We Can Match On

### Label Triggers

```typescript
// Issue labeled with specific label
{ trigger: 'label_added', value: 'bug' }

// Issue unlabeled
{ trigger: 'label_removed', value: 'triaged' }

// Label matches pattern
{ trigger: 'label_matches', value: /^severity-.*$/ }
```

### Status Triggers

```typescript
// Issue opened
{ trigger: 'action', value: 'opened' }

// Issue closed
{ trigger: 'action', value: 'closed' }

// Issue reopened
{ trigger: 'action', value: 'reopened' }
```

### Mention Triggers

```typescript
// Mention of bot user in issue body or comment
{ trigger: 'mention', value: 'support-agent[bot]' }
```

### Comment Body Triggers

```typescript
// Regex match on comment body
{ trigger: 'comment_matches', value: '/help|support|bug/i' }
```

### Assignee Triggers

```typescript
// Assigned to specific user
{ trigger: 'assigned', value: 'username' }

// Assigned to anyone (or bot)
{ trigger: 'assigned', value: 'support-agent[bot]' }
```

### Repository/Scope Triggers

```typescript
// Scoped to specific repo
{ trigger: 'repository', value: 'owner/repo' }

// Or wildcard
{ trigger: 'repository', value: 'owner/*' }
```

### Title/Body Triggers

```typescript
// Title matches pattern
{ trigger: 'title_matches', value: '/\[urgent\]/i' }

// Body matches pattern
{ trigger: 'body_matches', value: '/crash|error|fail/i' }
```

### Creator Triggers

```typescript
// Issue created by specific user
{ trigger: 'creator', value: 'username' }
```

---

## 7. Identity Mapping

### User ID Shape

| Field | Type | Example |
|-------|------|---------|
| `id` | integer | `12345678` |
| `login` | string | `johndoe` |
| `node_id` | string (base64 gid) | `U_kgDOBXABC` |

**For external ID**: Use `id` (integer) as primary, `login` as display key

### Resolving User Identity

**GET user info**:
```
GET /users/{username}
```

**Response**:
```json
{
  "id": 12345678,
  "login": "johndoe",
  "avatar_url": "https://avatars.githubusercontent.com/u/12345678",
  "email": "john@example.com",        // May be null if no public email
  "name": "John Doe",
  "type": "User"
}
```

**For email**: `email` field requires `user:email` scope or `read:user` scope with public email setting

### Bot Identity (no_self_retrigger)

**Bot detection methods**:
1. `sender.type === 'Bot'` on webhook payload
2. Bot login suffix: `<name>[bot]` (e.g., `support-agent[bot]`)
3. `author_association === 'NONE'` + bot user type

**Identifying our connector's posts**:
- Use `sender.login` from webhook payload
- Store bot's GitHub login during connector setup
- Filter: `sender.type === 'Bot' && sender.login === configured_bot_login`

### Author Field on Posted Comments

When we post a comment, the `user` field of the returned Comment object is our bot user:
```json
{
  "id": 98765432,
  "login": "support-agent[bot]",
  "type": "Bot"
}
```

Use this to populate `author_association` and verify self-triggers.

---

## 8. Rate Limits

### REST API Rate Limits

| Request Type | Limit |
|--------------|-------|
| Authenticated (core API) | 5,000/hour |
| Authenticated (Search API) | 30/min |
| Unauthenticated | 60/hour |

### Rate Limit Headers

```
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4999
X-RateLimit-Reset: 1672531200
X-RateLimit-Used: 1
X-RateLimit-Resource: core
```

**Retry-After**: GitHub may return `Retry-After` header on 403 responses when secondary limits hit

### Secondary Rate Limits

GitHub enforces additional limits:
- **Concurrent requests**: Limit on simultaneous API calls
- **POST request volume**: Limits on number of creates/updates per minute
- **Search rate limits**: Stricter limits on `/search/*` endpoints

### Mitigation Strategies

1. **Conditional requests**: Use `If-None-Match` / `ETag` headers for caching
2. **Batch via GraphQL**: Single GraphQL query can replace multiple REST calls
3. **Search API separate limit**: Track separately from core API
4. **Exponential backoff**: Implement 1s base delay with jitter on 403/429

### Bulk/Batch Endpoints

**GraphQL API** (`POST /graphql`):
- Fetch issue + labels + comments + assignees in single query
- Significantly reduces call count

**Example GraphQL query**:
```graphql
query GetIssue($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      title
      body
      state
      labels(first: 10) { nodes { name color } }
      assignees(first: 10) { nodes { login } }
      comments(first: 100) {
        nodes { id body author { login } createdAt }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}
```

---

## 9. Pagination & Search

### Pagination Style

**Page-based** (not cursor-based):
```
GET /repos/{owner}/{repo}/issues?per_page=100&page=1
```

### Link Header Format

```http
Link: <https://api.github.com/repositories/1300192/issues?per_page=1&page=2>; rel="next",
      <https://api.github.com/repositories/1300192/issues?per_page=1&page=14817>; rel="last",
      <https://api.github.com/repositories/1300192/issues?per_page=1&page=1>; rel="first",
      <https://api.github.com/repositories/1300192/issues?per_page=1&page=14816>; rel="prev"
```

**Parse for `rel="next"` to iterate pages**

### Max Page Size

- Default: 30
- Max: 100 per page

### Search API

```
GET /search/issues
```

**Query syntax**:
```
GET /search/issues?q=is:issue+state:open+label:bug+assignee:username
```

**Available qualifiers**:
| Qualifier | Example |
|------------|---------|
| `is:issue` | Issues only (exclude PRs) |
| `is:pr` | PRs only |
| `state:open` | Open issues |
| `state:closed` | Closed issues |
| `label:name` | Has label |
| `assignee:user` | Assigned to user |
| `author:user` | Created by user |
| `mentions:user` | Mentions user |
| `created:>YYYY-MM-DD` | Created after date |
| `updated:>YYYY-MM-DD` | Updated after date |
| `milestone:number` | In milestone |
| `repo:owner/repo` | Specific repo |
| `org:org` | Org-scoped search |

**Search rate limit**: 30 requests/minute (authenticated)

**Search pagination**: Same page-based with `per_page` (max 100)

---

## 10. Known Gotchas

### Features by Plan

| Feature | Free | Pro | Team | Enterprise |
|---------|------|-----|------|------------|
| Assignees | Yes | Yes | Yes | Yes |
| Labels | Yes | Yes | Yes | Yes |
| Projects v1 | Yes | Yes | Yes | Yes |
| Projects v2 | Yes | Yes | Yes | Yes |
| Milestones | Yes | Yes | Yes | Yes |
| Webhooks | Yes | Yes | Yes | Yes |
| Fine-grained PATs | Yes | Yes | Yes | Yes (GHES 3.4+) |

### Webhook Gotchas

1. **Issue/PR disambiguation**: `issues.opened` fires for both issues and PRs (PRs are issues under the hood). Check `issue.pull_request` to distinguish.

2. **Comment webhook scope**: `issue_comment` fires for both issue comments and PR review comments. Check `issue.pull_request` presence.

3. **Label webhook per-issue**: `issues.labeled` action fires for label changes on issues. `label` event is for repository label CRUD, not per-issue labels.

4. **Eventual consistency**: Webhook delivery may lag; use `GET /repos/{owner}/{repo}/issues/{issue_number}` to verify current state.

5. **Delivery failures**: GitHub marks delivery as failed if endpoint doesn't return 2xx within 10 seconds. Implement async processing: acknowledge immediately, process in background.

### API Gotchas

1. **Issue vs PR duality**: PRs share the Issues API. To exclude PRs:
   ```typescript
   // Filter out PRs
   if (issue.pull_request) return; // This is a PR, skip
   ```

2. **Comments count vs list**: `issue.comments` is a **count**, not a list. Fetch separately.

3. **Timeline API vs Events API**:
   - `GET /repos/{owner}/{repo}/issues/{issue_number}/timeline` — comprehensive events feed
   - `GET /repos/{owner}/{repo}/issues/{issue_number}/events` — limited, deprecated

4. **Labels endpoint inconsistency**: `DELETE /issues/{issue_number}/labels/{name}` uses issue number in path, but `POST /repos/{owner}/{repo}/labels` uses repo scope.

5. **Pagination on timeline**: Timeline uses cursor-based pagination internally but exposes page-based API. Be aware of potential duplicates.

6. **Empty arrays vs null**: `issue.labels` returns array, never null. `issue.milestone` returns `null` if no milestone.

7. **State reason**: When reopening a `closed` issue with `state_reason: "not_planned"`, must provide `state_reason: "reopened"`.

### Multi-tenant Gotchas

1. **Per-org webhook requirement**: Each GitHub organization needs its own webhook subscription. PATs from one org cannot receive webhooks for another.

2. **SAML SSO PATs**: Fine-grained PATs require per-organization SAML authorization. May need GitHub App for seamless multi-org access.

3. **Rate limit per-token**: Each PAT/GitHub App has its own rate limit pool. Aggregate across tenants requires careful tracking.

---

## 11. Recommended SupportAgent Connector Scope

### MVP (Minimum to Be Useful)

**Endpoints to wrap**:
```
GET    /repos/{owner}/{repo}/issues?since=<timestamp>&state=open&per_page=100
GET    /repos/{owner}/{repo}/issues/{issue_number}
POST   /repos/{owner}/{repo}/issues
PATCH  /repos/{owner}/{repo}/issues/{issue_number}
GET    /repos/{owner}/{repo}/issues/{issue_number}/comments?per_page=100
POST   /repos/{owner}/{repo}/issues/{issue_number}/comments
PATCH  /repos/{owner}/{repo}/issues/comments/{comment_id}
DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}
POST   /repos/{owner}/{repo}/issues/{issue_number}/labels
DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}
GET    /repos/{owner}/{repo}/labels?per_page=100
POST   /repos/{owner}/{repo}/labels
GET    /repos/{owner}/{repo}/milestones?per_page=100
GET    /users/{username}
GET    /user
```

**Webhook events to handle**:
- `issues.opened`
- `issues.closed`
- `issues.reopened`
- `issues.labeled`
- `issues.unlabeled`
- `issue_comment.created`
- `issue_comment.edited`
- `issue_comment.deleted`

**Webhook handling**:
- HMAC-SHA256 signature verification (`X-Hub-Signature-256`)
- Reject non-2xx responses after 10s timeout
- Async processing queue for inbound events

**Admin panel config fields**:
```typescript
{
  key: 'access_token',
  label: 'Personal Access Token',
  type: 'password',
  required: true,
  secretType: 'api_key'
},
{
  key: 'api_base_url',
  label: 'API Base URL',
  type: 'url',
  placeholder: 'https://api.github.com',
  required: false
},
{
  key: 'webhook_secret',
  label: 'Webhook Secret',
  type: 'password',
  required: false,
  secretType: 'webhook_secret'
},
{
  key: 'repo_owner',
  label: 'Default Repository Owner',
  type: 'text',
  required: false
},
{
  key: 'repo_name',
  label: 'Default Repository Name',
  type: 'text',
  required: false
},
{
  key: 'bot_login',
  label: 'Bot Username',
  type: 'text',
  helpText: 'Username of the bot account for no_self_retrigger filtering',
  required: false
}
```

### Phase 2 (Parity with Existing GitHub Connector)

**Additional endpoints**:
```
PATCH  /repos/{owner}/{repo}/issues/{issue_number}
       - Update: state (close/reopen), milestone, assignees
POST   /repos/{owner}/{repo}/issues/{issue_number}/assignees
DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees/{assignee}
PUT    /repos/{owner}/{repo}/issues/{issue_number}/labels
GET    /repos/{owner}/{repo}/issues/{issue_number}/timeline?per_page=100
GET    /search/issues?q=...
POST   /projects/{project_id}/items
PATCH  /projects/items/{item_id}
```

**Webhook events**:
- `issues.assigned` / `issues.unassigned`
- `issues.transferred`
- `issues.edited`

**Trigger matchers to enable**:
- Label add/remove
- Status transitions
- Assignee changes
- Mentions of bot user
- Comment body regex
- Creator/author filters

### Phase 3 (Advanced)

**Features unique to GitHub**:
```
# Projects v2 integration
GET    /orgs/{org}/projectsV2
GET    /repos/{owner}/{repo}/projectsV2
POST   /projects/{project_id}/items
PATCH  /projects/items/{item_id}
GET    /projects/{project_id}/fields
POST   /projects/{project_id}/fields

# Dependency tracking
GET    /repos/{owner}/{repo}/issues/{issue_number}/dependents
       - Show dependent repositories/packages

# Lock/unlock
PUT    /repos/{owner}/{repo}/issues/{issue_number}/lock
DELETE /repos/{owner}/{repo}/issues/{issue_number}/lock

# Pin/unpin comments
PUT    /repos/{owner}/{repo}/issues/comments/{comment_id}/pin
DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}/pin

# Sub-issues (beta)
GET    /repos/{owner}/{repo}/issues/{issue_number}/sub_issues
```

**GraphQL API** for efficient bulk fetches

---

## 12. Dependencies

### Official SDK

**Package**: `@octokit/rest`
- npm: `https://www.npmjs.com/package/@octokit/rest`
- Supports all REST API endpoints
- Built-in pagination, authentication, retry logic
- TypeScript support

**Alternative**: `@octokit/action` — adds throttling and retry via `@octokit/plugin-throttling`

### Recommendation: Raw `fetch` vs SDK

**Use raw `fetch`** for MVP because:
1. GitHub REST is simple and well-documented
2. Reduces bundle size (no Octokit dependency)
3. Native TypeScript types from our contracts package
4. We control retry/backoff logic explicitly
5. SDK adds complexity without significant benefit for this use case

**Consider `@octokit/rest`** if:
- We need built-in OAuth flow handling
- GraphQL queries are complex
- Bundle size isn't a concern

### CLI Parity: gh CLI

The existing `packages/github-cli` provides:
- `gh issue view <number>` — fetch issue with JSON
- `gh issue list` — list issues
- `gh issue close` / `gh issue reopen`
- `gh api repos/{owner}/{repo}/issues/{issue_number}/comments` — direct API calls
- `gh label create` — label management

**Recommendation**: Maintain `github-cli` as a shell-out option for admin/CLI workflows. Connector uses native `fetch` for programmatic API access.

---

## 13. Open Questions

1. **Single vs Multi-repo scope**: Should MVP support one default repo per connector instance, or should it poll multiple repos?

2. **GitHub App vs PAT for multi-tenant**: Do we need GitHub App support for tenants with SAML SSO? Current platform registry shows `supportsOAuth: true` for github_issues.

3. **Projects v2 scope**: Should MVP include Projects v2 field updates, or defer to Phase 2?

4. **Search API usage**: For reconciliation, should we use `GET /search/issues` (30/min limit) or paginate `GET /repos/{owner}/{repo}/issues` (5000/hr limit)?

5. **Comment sync direction**: For two-way sync, do we need to handle comments from external users on our bot's posts?

6. **Rate limit monitoring**: Should we expose rate limit status in admin panel?

7. **GHES compatibility**: Any tenants on GitHub Enterprise Server versions < 3.4 (lacks fine-grained PATs)?

8. **Webhook URL provisioning**: Do we provide the webhook endpoint URL, or does the tenant configure it manually in GitHub settings?

---

## Appendix A: Reference Response Shapes

### Issue Response

```json
{
  "id": 1,
  "node_id": "MDU6SXNzdWUx",
  "number": 1,
  "title": "Issue title",
  "state": "open",
  "state_reason": null,
  "body": "Issue body text",
  "user": {
    "login": "octocat",
    "id": 1,
    "avatar_url": "https://github.com/images/error/octocat_happy.gif",
    "type": "User"
  },
  "labels": [
    {
      "id": 208045946,
      "node_id": "MDU6TGFiZWwyMDgwNDU5NDY=",
      "name": "bug",
      "color": "f29513",
      "description": "Bug reported by user",
      "default": true
    }
  ],
  "assignees": [
    {
      "login": "octocat",
      "id": 1
    }
  ],
  "milestone": {
    "id": 1002604,
    "number": 1,
    "title": "v1.0",
    "description": "Tracking milestone for version 1.0"
  },
  "comments": 0,
  "created_at": "2011-04-22T13:33:48Z",
  "updated_at": "2011-04-22T13:33:48Z",
  "closed_at": null,
  "url": "https://api.github.com/repos/octocat/Hello-World/issues/1",
  "html_url": "https://github.com/octocat/Hello-World/issues/1",
  "pull_request": null,
  "locked": false,
  "author_association": "OWNER"
}
```

### Webhook Payload (issues.opened)

```json
{
  "action": "opened",
  "issue": { /* full issue object */ },
  "repository": {
    "id": 1296269,
    "full_name": "octocat/Hello-World"
  },
  "sender": {
    "login": "octocat",
    "id": 1,
    "type": "User"
  }
}
```

### Webhook Payload (issue_comment.created)

```json
{
  "action": "created",
  "issue": { /* full issue object */ },
  "comment": {
    "id": 1,
    "node_id": "IC_kwDOA6kYnMAAABKAAAB",
    "body": "Comment body",
    "user": {
      "login": "octocat",
      "id": 1,
      "type": "User"
    },
    "created_at": "2011-04-22T13:33:48Z",
    "updated_at": "2011-04-22T13:33:48Z",
    "url": "https://api.github.com/repos/octocat/Hello-World/issues/comments/1",
    "html_url": "https://github.com/octocat/Hello-World/issues/1#issuecomment-1"
  },
  "repository": { /* repository object */ },
  "sender": { /* sender object */ }
}
```

## Appendix B: Standard Headers for All Requests

```http
Accept: application/vnd.github+json
Authorization: Bearer <token>
X-GitHub-Api-Version: 2022-11-28
```

## Appendix C: Error Response Shape

```json
{
  "message": "Validation Failed",
  "documentation_url": "https://docs.github.com/rest/issues/issues#create-an-issue",
  "errors": [
    {
      "resource": "Issue",
      "field": "title",
      "code": "custom",
      "message": "title is too short"
    }
  ],
  "status": "422"
}
```

Common error codes:
- `401` — Bad credentials
- `403` — Forbidden (rate limited or insufficient permissions)
- `404` — Not found
- `410` — Resource removed
- `422` — Validation failed
- `503` — Service unavailable (GitHub maintenance)
