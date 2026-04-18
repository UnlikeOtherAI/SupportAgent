# Bitbucket Connector Design Document

> **Last updated**: 2026-04-18
> **Platform**: Bitbucket Cloud (bitbucket.org) + Bitbucket Data Center/Server

---

## 1. Overview

| Attribute | Bitbucket Cloud | Bitbucket Data Center/Server |
|-----------|-----------------|------------------------------|
| **Category** | Version control (Git) + Issue tracking | Version control (Git) + Issue tracking |
| **Cloud** | Yes (bitbucket.org) | N/A |
| **Self-hosted** | N/A | Yes (Data Center, Server EOL) |
| **API Reference** | [developer.atlassian.com/cloud/bitbucket](https://developer.atlassian.com/cloud/bitbucket/rest/) | [developer.atlassian.com/server/bitbucket](https://developer.atlassian.com/server/bitbucket/) |
| **API Base URL** | `https://api.bitbucket.org/2.0` | `https://{host}:{port}/{context}/rest/api/{version}` |
| **Webhook Base URL** | Per-repo or per-workspace | Per-repo or per-project |

### Key Differences: Cloud vs Data Center/Server

| Feature | Cloud | Data Center/Server |
|---------|-------|-------------------|
| API versioning | `/2.0` (stable) | `/rest/api/1.0`, `/rest/api/latest` |
| Issue tracker | Built-in per-repo | Built-in per-repo (similar model) |
| OAuth | OAuth 2.0 (3LO) | OAuth 1.0a + Basic Auth + PAT |
| Webhook secret | Yes (HMAC-SHA256) | No (until v8.0+) |
| Workspace concept | Yes (organizational) | Projects + Repos (hierarchical) |
| User identity | UUID-based | Internal user IDs |

### Bitbucket Cloud API Version

- **2.0 API**: `https://api.bitbucket.org/2.0` — current, stable
- **1.0 API**: `https://api.bitbucket.org/1.0` — deprecated, avoid

---

## 2. Authentication

### Bitbucket Cloud

#### 2.1.1 Personal Access Token (PAT)

| Attribute | Value |
|-----------|-------|
| **Header** | `Authorization: Bearer {token}` |
| **Or** | `Authorization: Basic {base64(user:token)}` with App Password |
| **Token creation** | [bitbucket.org/account/settings/app-passwords](https://bitbucket.org/account/settings/app-passwords) |
| **Scopes** | Granular per-scope selection |
| **Lifetime** | Non-expiring (until revoked) |
| **Recommendation** | **MVP preferred** |

**Required scopes for MVP:**

| Operation | Required Scope |
|-----------|----------------|
| Read repositories | `repository:read` |
| Read pull requests | `pullrequest:read` |
| Write pull request comments | `pullrequest:write` |
| Read issues | `issue:read` |
| Write issues/comments | `issue:write` |
| Read workspace/webhooks | `webhook` |
| Read user info | `account:read` |

#### 2.1.2 OAuth 2.0 (3LO)

| Attribute | Value |
|-----------|-------|
| **Flow** | Authorization Code Grant |
| **Token endpoint** | `POST https://bitbucket.org/site/oauth2/access_token` |
| **Refresh token** | Yes (with `offline_access` scope) |
| **Token lifetime** | 1-2 hours (access), refresh valid until revoked |
| **Required for** | Third-party apps, marketplace apps |

**OAuth Scopes (Cloud):**
```
repository:read          # Read repositories
repository:write         # Write to repositories
pullrequest:read        # Read pull requests
pullrequest:write        # Comment, approve, merge
issue:read               # Read issues
issue:write              # Create/update issues
webhook                  # Manage webhooks
account:read             # Read user profile
```

#### 2.1.3 App Passwords (Cloud)

| Attribute | Value |
|-----------|-------|
| **Header** | `Authorization: Basic {base64(email:app_password)}` |
| **Creation** | Per-user, per-account settings |
| **Lifetime** | Until user revokes |
| **Scopes** | Fine-grained selection |

#### 2.1.4 Bot Identity (Cloud)

For bot accounts:
1. Create a dedicated workspace member account
2. Generate an App Password with required scopes
3. Use `Authorization: Basic {base64(email:app_password)}` header
4. The `author` field in comments will show the bot's UUID

---

### Bitbucket Data Center/Server

#### 2.2.1 Personal Access Token (PAT)

| Attribute | Value |
|-----------|-------|
| **Header** | `Authorization: Bearer {token}` |
| **Or** | `Authorization: Basic {base64(user:token)}` |
| **Token creation** | User profile → HTTP Access Tokens |
| **Scopes** | Project-level or repository-level permissions |
| **Permission levels** | `REPO_ADMIN`, `PROJECT_READ`, `REPO_READ`, `REPO_WRITE` |

**Endpoint**: `POST /rest/access-tokens/latest/` (Data Center 10.0+)

#### 2.2.2 Basic Authentication

| Attribute | Value |
|-----------|-------|
| **Header** | `Authorization: Basic {base64(user:password)}` |
| **Required for** | Admin operations, older instances |
| **Recommendation** | Use PAT over Basic Auth |

#### 2.2.3 OAuth 1.0a (Server)

| Attribute | Value |
|-----------|-------|
| **Protocol** | OAuth 1.0a (3-legged) |
| **Application links** | Configured in admin UI |
| **Recommendation** | PAT preferred for simpler integrations |

---

## 3. Inbound — Events and Intake

### 3.1 Webhook Support

**Cloud**: Yes — repo-level and workspace-level webhooks
**Data Center**: Yes — repo-level and project-level (v8.0+ with HMAC)

#### 3.1.1 Webhook Registration

**Cloud (Repository)**:
```
POST /2.0/repositories/{workspace}/{repo_slug}/hooks
{
  "url": "https://your-webhook-endpoint.com/webhook",
  "events": ["pullrequest:created", "pullrequest:comment_created", ...],
  "description": "SupportAgent Connector",
  "secret": "your-hmac-secret"
}
```

**Cloud (Workspace)**:
```
POST /2.0/workspaces/{workspace}/hooks
```

**Data Center (Repository)**:
```
POST /rest/api/latest/projects/{projectKey}/repos/{repo_slug}/webhooks
```

#### 3.1.2 Webhook Events

**Pull Request Events (Cloud)**:
| Event Name | Description |
|------------|-------------|
| `pullrequest:created` | PR opened |
| `pullrequest:updated` | PR updated (title, description, reviewers) |
| `pullrequest:fulfilled` | PR merged |
| `pullrequest:rejected` | PR declined |
| `pullrequest:comment_created` | Comment on PR |
| `pullrequest:comment_updated` | Comment edited |
| `pullrequest:comment_deleted` | Comment deleted |
| `pullrequest:approved` | PR approved |
| `pullrequest:unapproved` | Approval removed |
| `pullrequest:needs_review` | PR requires review |
| `pullrequest:request_change` | Changes requested |

**Issue Events (Cloud)**:
| Event Name | Description |
|------------|-------------|
| `issue:created` | Issue created |
| `issue:updated` | Issue updated |
| `issue:comment_created` | Comment on issue |
| `issue:comment_updated` | Comment edited |
| `issue:comment_deleted` | Comment deleted |

**Repository Events (Cloud)**:
| Event Name | Description |
|------------|-------------|
| `repo:push` | Code pushed |
| `repo:fork` | Repository forked |
| `repo:updated` | Repository settings updated |

**Data Center Events** (subset, similar naming):
- `pr:opened`, `pr:modified`, `pr:merged`, `pr:declined`
- `pr:comment:created`, `pr:comment:edited`, `pr:comment:deleted`
- `pr:reviewer:approved`, `pr:reviewer:unapproved`, `pr:reviewer:needs_work`
- `repo:refs_changed` (push equivalent)

#### 3.1.3 Webhook Signature Verification

**Cloud** (HMAC-SHA256):
```
X-Hub-Signature: sha256={hmac_hex_digest}
X-Hub-Signature-256: sha256={hmac_hex_digest}
```
- Secret provisioned at webhook creation
- Compute: `HMAC-SHA256(secret, request_body)`
- Compare hex digests

**Data Center** (v8.0+):
```
X-Hub-Signature: sha256={hmac_hex_digest}
```
- Similar HMAC-SHA256 verification
- **Note**: Earlier versions (v7.x) do not support webhook secrets

#### 3.1.4 Webhook Retry Semantics

| Attribute | Bitbucket Cloud | Data Center |
|-----------|-----------------|-------------|
| **Retries** | 3 attempts (automatic) | Configurable (admin) |
| **Retry delay** | Exponential backoff | Configurable |
| **Timeout** | 30 seconds | 10 seconds (default) |
| **Dead letter** | Discarded after retries | Logged in UI |
| **Verification** | `ping` event for testing | Same |

#### 3.1.5 Polling Fallback Strategy

If webhook delivery fails or for reconciliation:

**Cloud - Pull Requests**:
```
GET /2.0/repositories/{workspace}/{repo}/pullrequests
  ?state=OPEN&state=MERGED&state=DECLINED
  &sort=-updated_on
  &pagelen=50
```

**Cloud - Issues**:
```
GET /2.0/repositories/{workspace}/{repo}/issues
  ?state=open&state=closed
  &sort=-updated_on
  &pagelen=50
```

**Cloud - Recent Activity**:
```
GET /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/activity
GET /2.0/repositories/{workspace}/{repo}/issues/{id}/comments
```

**Use `updated_on` / `updatedAt` as cursor for incremental polling**

---

### 3.2 Payload Fields to Persist

#### Pull Request Payload (Cloud)

```json
{
  "id": 1,
  "type": "pullrequest",
  "uuid": "{uuid}",
  "title": "Fix authentication bug",
  "description": "This PR addresses...",
  "state": "OPEN",
  "author": {
    "uuid": "{uuid}",
    "account_id": "uuid-string",
    "display_name": "Jane Developer",
    "nickname": "jane",
    "links": { "avatar": { "href": "..." } }
  },
  "source": {
    "branch": { "name": "feature/auth-fix" },
    "commit": { "hash": "abc123" }
  },
  "destination": {
    "branch": { "name": "main" },
    "commit": { "hash": "def456" }
  },
  "reviewers": [
    { "uuid": "{uuid}", "display_name": "..." }
  ],
  "created_on": "2024-01-15T10:30:00.000000+00:00",
  "updated_on": "2024-01-16T14:22:00.000000+00:00",
  "links": {
    "html": { "href": "https://bitbucket.org/..." },
    "self": { "href": "https://api.bitbucket.org/..." }
  }
}
```

#### Comment Payload (Pull Request)

```json
{
  "id": 123,
  "type": "pullrequest_comment",
  "created_on": "2024-01-15T10:35:00.000000+00:00",
  "updated_on": "2024-01-15T11:00:00.000000+00:00",
  "content": {
    "raw": "This looks good!",
    "html": "<p>This looks good!</p>",
    "markup": "markdown"
  },
  "user": {
    "uuid": "{uuid}",
    "display_name": "Reviewer"
  },
  "pullrequest": {
    "id": 1,
    "type": "pullrequest"
  },
  "links": {
    "html": { "href": "https://bitbucket.org/..." }
  }
}
```

#### Issue Payload (Cloud)

```json
{
  "id": 5,
  "type": "issue",
  "priority": "major",
  "status": "open",
  "kind": "bug",
  "title": "Login fails with special characters",
  "content": {
    "raw": "When entering a password with...",
    "html": "<p>When entering a password with...</p>"
  },
  "reporter": {
    "uuid": "{uuid}",
    "display_name": "Reporter Name"
  },
  "assignee": {
    "uuid": "{uuid}",
    "display_name": "Assignee Name"
  },
  "created_on": "2024-01-10T09:00:00.000000+00:00",
  "updated_on": "2024-01-12T16:30:00.000000+00:00",
  "labels": ["security", "authentication"],
  "links": {
    "html": { "href": "https://bitbucket.org/..." }
  }
}
```

---

## 4. Outbound — Writing Back

### 4.1 Create Pull Request

**Cloud**:
```
POST /2.0/repositories/{workspace}/{repo}/pullrequests
Content-Type: application/json

{
  "title": "Fix bug",
  "source": { "branch": { "name": "feature-branch" } },
  "destination": { "branch": { "name": "main" } },
  "description": "This PR fixes...",
  "reviewers": [
    { "uuid": "{reviewer-uuid}" }
  ]
}
```

**Data Center**:
```
POST /rest/api/latest/projects/{projectKey}/repos/{repo}/pull-requests
{
  "title": "Fix bug",
  "fromRef": { "id": "refs/heads/feature-branch", "repository": { "slug": "{repo}", "project": { "key": "{projectKey}" } } },
  "toRef": { "id": "refs/heads/main" },
  "description": "..."
}
```

### 4.2 Post Comment on Pull Request

**Cloud**:
```
POST /2.0/repositories/{workspace}/{repo}/pullrequests/{pull_request_id}/comments
Content-Type: application/json

{
  "content": {
    "raw": "This is a comment with @mention to @username",
    "markup": "markdown"
  },
  "inline": {
    "to": { "commit": "{commit_hash}", "path": "src/file.ts" },
    "from": { "commit": "{commit_hash}", "path": "src/file.ts" },
    "outdated": false
  }
}
```

**Data Center**:
```
POST /rest/api/latest/projects/{projectKey}/repos/{repo}/pull-requests/{id}/comments
{
  "text": "This is a comment",
  "anchor": {
    "commitId": "{commit_hash}",
    "path": "src/file.ts",
    "line": 42,
    "lineType": "ADDED"
  }
}
```

### 4.3 Edit Comment

**Cloud**:
```
PUT /2.0/repositories/{workspace}/{repo}/pullrequests/{pull_request_id}/comments/{comment_id}
{
  "content": {
    "raw": "Updated comment text",
    "markup": "markdown"
  }
}
```

**Data Center**:
```
PUT /rest/api/latest/projects/{projectKey}/repos/{repo}/pull-requests/{id}/comments/{commentId}
{
  "text": "Updated comment text",
  "version": 1
}
```

### 4.4 Delete Comment

**Cloud**:
```
DELETE /2.0/repositories/{workspace}/{repo}/pullrequests/{pull_request_id}/comments/{comment_id}
```

**Data Center**:
```
DELETE /rest/api/latest/projects/{projectKey}/repos/{repo}/pull-requests/{id}/comments/{commentId}
```

### 4.5 Resolve/Unresolve Thread

**Cloud**:
```
POST /2.0/repositories/{workspace}/{repo}/pullrequests/{pull_request_id}/comments/{comment_id}/resolve
DELETE /2.0/repositories/{workspace}/{repo}/pullrequests/{pull_request_id}/comments/{comment_id}/resolve
```

### 4.6 Change Status / Transition

**Cloud - Issue Status**:
```
PUT /2.0/repositories/{workspace}/{repo}/issues/{issue_id}
{
  "state": "resolved",
  "status": "resolved"
}
```

**Available states (Cloud)**: `new`, `open`, `on hold`, `resolved`, `duplicate`, `wontfix`, `closed`

**Data Center - Issue Status**:
```
PUT /rest/api/latest/projects/{projectKey}/repos/{repo}/issues/{issueId}
{
  "state": { "id": 3 }
}
```

### 4.7 Add/Remove Label

**Cloud - Issue Labels**:
```
POST /2.0/repositories/{workspace}/{repo}/issues/{issue_id}
{
  "type": "update",
  "labels": [
    { "name": "support", "add": true },
    { "name": "needs-info", "remove": true }
  ]
}
```

**Cloud - PR Labels (not directly supported)**:
- Labels are repo-level metadata
- Use `PUT /2.0/repositories/{workspace}/{repo}/pullrequests/{id}` with custom `labels` field (if enabled)

### 4.8 Assign User

**Cloud - Issue**:
```
PUT /2.0/repositories/{workspace}/{repo}/issues/{issue_id}
{
  "assignee": { "uuid": "{user-uuid}" }
}
```

**Data Center - Issue**:
```
PUT /rest/api/latest/projects/{projectKey}/repos/{repo}/issues/{issueId}
{
  "assignee": { "name": "username" }
}
```

### 4.9 Mention User

**Syntax**: `@{username}` in markdown/raw content

**Example**:
```
"content": {
  "raw": "Hey @jane.doe, can you review this?",
  "markup": "markdown"
}
```

### 4.10 Merge / Decline Pull Request

**Cloud - Merge**:
```
POST /2.0/repositories/{workspace}/{repo}/pullrequests/{pull_request_id}/merge
{
  "message": "Merged by SupportAgent",
  "type": "merge"
}
```

**Cloud - Decline**:
```
POST /2.0/repositories/{workspace}/{repo}/pullrequests/{pull_request_id}/decline
{
  "message": "Declined by SupportAgent"
}
```

**Data Center**:
```
POST /rest/api/latest/projects/{projectKey}/repos/{repo}/pull-requests/{id}/merge
POST /rest/api/latest/projects/{projectKey}/repos/{repo}/pull-requests/{id}/decline
```

### 4.11 Approve / Unapprove Pull Request

**Cloud**:
```
POST /2.0/repositories/{workspace}/{repo}/pullrequests/{pull_request_id}/approve
DELETE /2.0/repositories/{workspace}/{repo}/pullrequests/{pull_request_id}/approve
```

### 4.12 Attach File

**Cloud**:
```
POST /2.0/repositories/{workspace}/{repo}/issues/{issue_id}/attachments
Content-Type: multipart/form-data

--form-data--
file=@screenshot.png
```

**Response**: Returns attachment link in `Location` header

---

## 5. Labels, Flags, Fields, Priorities

### 5.1 Issue Labels

**Cloud**:
- Labels are free-form strings per repository
- No type system, no enum validation
- API: Array of `{name: string}` in issue object

**Data Center**:
- Similar free-form labels
- Can be configured with auto-complete

### 5.2 Priority Model

**Cloud Priorities** (ordered):
| ID | Name |
|----|------|
| `trivial` | Trivial |
| `minor` | Minor |
| `major` | Major |
| `critical` | Critical |
| `blocker` | Blocker |

**Data Center Priorities**:
- Admin-configurable (default: Blocker, Critical, Major, Minor, Trivial)
- Stored as `{id: number, name: string}`

### 5.3 Status Model

**Cloud Issue States**:
| State | Description |
|-------|-------------|
| `new` | Newly created |
| `open` | Being worked on |
| `on hold` | Waiting on something |
| `resolved` | Fixed |
| `closed` | Completed/archived |
| `duplicate` | Duplicate of another |
| `wontfix` | Won't be fixed |

**Data Center Issue States**:
- Workflow-driven (configurable)
- Stored as `{id: number, name: string, color: {...}}`

### 5.4 Kind Model (Cloud)

Issue kinds (like issue types):
| Kind | Description |
|------|-------------|
| `bug` | Bug report |
| `enhancement` | Feature request |
| `proposal` | Proposal for discussion |
| `task` | Task to be done |
| `question` | Question |

### 5.5 Listing Available Values

**Cloud - Issue Components**:
```
GET /2.0/repositories/{workspace}/{repo}/issues/components
```

**Cloud - Issue Milestones**:
```
GET /2.0/repositories/{workspace}/{repo}/issues/milestones
```

**Cloud - Issue Versions**:
```
GET /2.0/repositories/{workspace}/{repo}/issues/versions
```

---

## 6. Triggers We Can Match On

### 6.1 From Pull Request Events

| Trigger | Source Field | Notes |
|---------|-------------|-------|
| PR opened | `event == pullrequest:created` | New PR detection |
| PR title match | `pullrequest.title` | Regex on title |
| PR description match | `pullrequest.description` | Regex on body |
| Author by UUID | `pullrequest.author.uuid` | Filter by user |
| Reviewer added | `pullrequest.reviewers` diff | Compare reviewer lists |
| Branch pattern | `pullrequest.source.branch.name` | Match `feature/*`, `fix/*` |
| Target branch | `pullrequest.destination.branch.name` | e.g., `main`, `release/*` |
| Label added | Not natively supported on PRs | Workaround: check via activity |
| Status change | `event == pullrequest:fulfilled` | Merge detection |
| Comment body match | `comment.content.raw` | Regex on comment text |
| Mention of bot | Parse `comment.content.raw` | Check for `@bot-username` |
| Approval | `event == pullrequest:approved` | |
| Changes requested | `event == pullrequest:request_change` | |

### 6.2 From Issue Events

| Trigger | Source Field | Notes |
|---------|-------------|-------|
| Issue created | `event == issue:created` | |
| Issue title match | `issue.title` | Regex |
| Issue body match | `issue.content.raw` | Regex |
| Reporter by UUID | `issue.reporter.uuid` | Filter by user |
| Assignee change | Compare `issue.assignee` | Before/after |
| Label added | `issue.labels` | Work with label array |
| Label removed | `issue.labels` | Compare arrays |
| Priority change | Compare `issue.priority` | |
| Status transition | Compare `issue.state` | |
| Comment match | `comment.content.raw` | Regex |
| Mention of bot | Parse `comment.content.raw` | Check for `@bot-username` |

### 6.3 Scope Matching

| Scope | Cloud Field | Data Center Field |
|-------|-------------|-------------------|
| Workspace | URL path `{workspace}` | Project + Repository |
| Repository | URL path `{repo}` | `projectKey` + `repoSlug` |
| User | `user.uuid` | `user.name` or `user.id` |

---

## 7. Identity Mapping

### 7.1 User ID Shapes

| Platform | ID Type | Example |
|----------|---------|---------|
| **Cloud** | UUID (with hyphens) | `{d2230c91-7bc1-4abc-9d2c-1234567890ab}` |
| **Cloud** | Account ID | `~1234567890abcdef1234567890abcdef` (legacy) |
| **Data Center** | Internal integer | `12345` |
| **Data Center** | Username | `jdoe` (not stable for display) |

### 7.2 Resolving User Identity

**Cloud - Get User by UUID**:
```
GET /2.0/users/{uuid}
Response: {
  "uuid": "{uuid}",
  "display_name": "Jane Doe",
  "nickname": "jane",
  "account_id": "12345678:...",
  "created_on": "...",
  "links": { "avatar": {...}, "html": {...} }
}
```

**Cloud - Get User Emails** (requires `account:read` + `email` scope):
```
GET /2.0/user/emails
```

**Cloud - Current User**:
```
GET /2.0/user
```

**Data Center - Get User**:
```
GET /rest/api/latest/users/{username}
```

### 7.3 Bot Identity

**Cloud**:
- Bot posts comments under the authenticated user's identity
- `author.uuid` field shows the bot account's UUID
- Use this UUID for `no_self_retrigger` detection

**Data Center**:
- Same behavior — comments authored by service account
- `author.name` contains the username

### 7.4 Author Field on Comments We Post

**Cloud**:
```json
{
  "user": {
    "uuid": "{bot-uuid}",
    "display_name": "SupportAgent Bot",
    "type": "user"
  }
}
```

**Data Center**:
```json
{
  "author": {
    "name": "support-agent",
    "displayName": "SupportAgent Bot",
    "id": 12345,
    "type": "user"
  }
}
```

---

## 8. Rate Limits

### 8.1 Bitbucket Cloud Rate Limits

| Tier | Limit |
|------|-------|
| **Unauthenticated** | 60 requests/hour |
| **Authenticated (free)** | 60 requests/hour |
| **Authenticated (paid workspace)** | 1000 requests/hour |
| **OAuth app** | Based on workspace plan |

**Headers**:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1609459200
```

**When exceeded**:
- Response: `429 Too Many Requests`
- `Retry-After` header present (seconds until reset)
- Exponential backoff recommended

### 8.2 Bitbucket Data Center Rate Limits

| Setting | Default |
|---------|---------|
| **Per-user rate limit** | Admin-configurable (default: unlimited) |
| **Global rate limit** | Admin-configurable |
| **Endpoint `/rest/api/1.0/admin/rate-limit/settings`** | Configurable |

**Note**: Data Center rate limits are enterprise-configurable, not enforced by default.

### 8.3 Bulk/Batch Endpoints

| Endpoint | Use Case |
|----------|----------|
| `POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments` | Batch comments |
| `GET /2.0/repositories/{workspace}/{repo}/pullrequests` with `pagelen=100` | Bulk PR fetch |
| `GET /2.0/workspaces/{workspace}/members` | Batch member fetch |

**No true batch API** — must make individual requests per resource.

---

## 9. Pagination & Search

### 9.1 Pagination Style

**Cloud** — Cursor-based with `page` parameter:
```
GET /2.0/repositories/{workspace}/{repo}/pullrequests
  ?page=1
  &pagelen=50
```

Response:
```json
{
  "pagelen": 50,
  "page": 1,
  "values": [...],
  "next": "https://api.bitbucket.org/2.0/...?page=2"
}
```

**Data Center** — Offset-based with `limit` and `start`:
```
GET /rest/api/latest/projects/{projectKey}/repos/{repo}/pull-requests
  ?limit=25
  &start=0
```

Response:
```json
{
  "limit": 25,
  "size": 25,
  "start": 0,
  "isLastPage": false,
  "nextPageStart": 25,
  "values": [...]
}
```

### 9.2 Max Page Size

| Platform | Max `pagelen`/`limit` |
|----------|----------------------|
| **Cloud** | 100 |
| **Data Center** | 1000 (configurable) |

### 9.3 Search Endpoints

**Cloud - Code Search**:
```
GET /2.0/repositories/{workspace}/{repo}/search/code
  ?search_query=auth+AND+path:src
  &pagelen=50
```

**Cloud - Workspace Search**:
```
GET /2.0/workspaces/{workspace}/search
  ?search_query=type:pullrequest+state:open
```

**Data Center - Search**:
```
GET /rest/api/latest/search
  ?search_query=...&entity=...
```

**Filters on List Endpoints**:

Cloud PRs:
```
GET /2.0/repositories/{workspace}/{repo}/pullrequests
  ?state=OPEN
  &state=MERGED
  &sort=-updated_on
  &role=MEMBER
```

Cloud Issues:
```
GET /2.0/repositories/{workspace}/{repo}/issues
  ?state=open
  &priority=critical
  &kind=bug
  &assignee={uuid}
```

---

## 10. Known Gotchas

### 10.1 Cloud-Only or Enterprise-Only Features

| Feature | Availability |
|---------|---------------|
| OAuth 2.0 (3LO) | Cloud only |
| Workspaces | Cloud only |
| Atlassian Connect / Forge | Cloud + Data Center 7.17+ |
| Webhook HMAC secrets | Cloud + Data Center 8.0+ |
| Issue tracker labels | Cloud + Data Center |
| Branch restrictions | Cloud + Data Center |

### 10.2 Missing/Broken Webhook Events

| Issue | Description |
|-------|-------------|
| **PR label changes** | No native `pullrequest:label_changed` event — use `pullrequest:updated` and diff reviewers |
| **Issue assignee changes** | Not a separate event — must detect via `issue:updated` + compare |
| **Comment reactions** | No webhook event for reactions (must poll) |
| **Draft PR visibility** | `pullrequest:created` fires for drafts, `pullrequest:updated` for publish |
| **Webhook ordering** | Events not guaranteed ordered — use `updated_on` for sorting |

### 10.3 Eventual Consistency

| Issue | Impact |
|-------|--------|
| **Webhook vs API lag** | Webhook may deliver before API reflects change — add 1-2s delay before fetching |
| **Comment propagation** | Inline comments may not appear in list immediately |
| **Merge detection** | `pullrequest:fulfilled` may fire before `pullrequest:updated` with final state |

### 10.4 Multi-Tenant Considerations

| Concern | Recommendation |
|---------|----------------|
| **Per-tenant OAuth** | Each tenant needs own OAuth app registration for workspace-level webhooks |
| **Repository access** | PAT can access repos the user has access to (use workspace membership API to validate) |
| **Webhook uniqueness** | Use `repository:full` scope to register webhooks on any accessible repo |
| **User identity** | UUIDs are global (work across workspaces), usernames are per-workspace |

### 10.5 API Deprecations

| Deprecated | Replacement | Sunset |
|------------|-------------|--------|
| `/1.0/api/*` | `/2.0/*` | End of life announced |
| `account_id` (legacy) | `uuid` | Migrate to `uuid` |
| `~{user_id}` format | `uuid` | Legacy accounts only |

### 10.6 Bitbucket Data Center-Specific

| Concern | Impact |
|---------|--------|
| **Project/Repo hierarchy** | Must know `projectKey` + `repoSlug` — not just workspace/repo |
| **No workspace concept** | Use projects as organizational units |
| **Permission inheritance** | Project-level permissions cascade to repos |
| **Case sensitivity** | `repoSlug` is lowercase-only |
| **Webhook URL** | Must be publicly accessible for Cloud; internal OK for Data Center |

---

## 11. Recommended SupportAgent Connector Scope

### MVP (Minimum to be useful)

**Endpoints to wrap:**
```
# Authentication
POST /2.0/user                            # Verify token
GET  /2.0/user/emails                     # Get user email

# Pull Requests
GET  /2.0/repositories/{workspace}/{repo}/pullrequests
GET  /2.0/repositories/{workspace}/{repo}/pullrequests/{id}
POST /2.0/repositories/{workspace}/{repo}/pullrequests
PUT  /2.0/repositories/{workspace}/{repo}/pullrequests/{id}
POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/merge
POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/decline

# PR Comments
GET  /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments
POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments
PUT  /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments/{comment_id}
DELETE /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments/{comment_id}
POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/comments/{comment_id}/resolve

# PR Reviews
POST /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/approve
DELETE /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/approve

# Issues
GET  /2.0/repositories/{workspace}/{repo}/issues
GET  /2.0/repositories/{workspace}/{repo}/issues/{id}
POST /2.0/repositories/{workspace}/{repo}/issues
PUT  /2.0/repositories/{workspace}/{repo}/issues/{id}

# Issue Comments
GET  /2.0/repositories/{workspace}/{repo}/issues/{id}/comments
POST /2.0/repositories/{workspace}/{repo}/issues/{id}/comments
PUT  /2.0/repositories/{workspace}/{repo}/issues/{id}/comments/{comment_id}
DELETE /2.0/repositories/{workspace}/{repo}/issues/{id}/comments/{comment_id}

# Webhooks
GET  /2.0/repositories/{workspace}/{repo}/hooks
POST /2.0/repositories/{workspace}/{repo}/hooks
DELETE /2.0/repositories/{workspace}/{repo}/hooks/{uid}

# Users
GET  /2.0/users/{uuid}
GET  /2.0/workspaces/{workspace}/members
```

**Webhook events to handle:**
- `pullrequest:created`
- `pullrequest:updated`
- `pullrequest:fulfilled`
- `pullrequest:rejected`
- `pullrequest:comment_created`
- `pullrequest:comment_updated`
- `pullrequest:comment_deleted`
- `pullrequest:approved`
- `pullrequest:request_change`
- `issue:created`
- `issue:updated`
- `issue:comment_created`

**Admin panel config fields:**
```typescript
interface BitbucketConfig {
  authType: 'pat' | 'oauth';          // MVP: PAT only
  accessToken: string;                  // Encrypted PAT
  workspaceSlug: string;               // Workspace or project key
  defaultRepoSlug?: string;            // Default repository
  webhookSecret?: string;              // HMAC secret for verification
  botUsername?: string;                // For no_self_retrigger
}
```

---

### Phase 2 (Parity with GitHub connector)

**Additional endpoints:**
```
# Repository
GET  /2.0/repositories/{workspace}/{repo}
GET  /2.0/repositories/{workspace}/{repo}/pipelines

# Activity
GET  /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/activity
GET  /2.0/repositories/{workspace}/{repo}/issues/{id}/activity

# Users - Full resolution
GET  /2.0/users/{uuid}                 // Get user details
GET  /2.0/workspaces/{workspace}/permissions/repositories

# Attachments
POST /2.0/repositories/{workspace}/{repo}/issues/{id}/attachments
```

**Additional webhook events:**
- `pullrequest:needs_review`
- `repo:push` (for branch-based triggers)

**Additional trigger matchers:**
- Branch pattern matching (`source.branch.name`)
- Target branch matching (`destination.branch.name`)
- Reviewer change detection
- Priority/label change on issues

---

### Phase 3 (Advanced)

**Features unique to Bitbucket:**
```
# Branch restrictions
GET  /2.0/repositories/{workspace}/{repo}/branch-restrictions
POST /2.0/repositories/{workspace}/{repo}/branch-restrictions

# Commit statuses (CI/CD integration)
GET  /2.0/repositories/{workspace}/{repo}/commit/{hash}/statuses
POST /2.0/repositories/{workspace}/{repo}/commit/{hash}/statuses

# Pipelines
GET  /2.0/repositories/{workspace}/{repo}/pipelines
GET  /2.0/repositories/{workspace}/{repo}/pipelines/{id}

# Deployments
GET  /2.0/repositories/{workspace}/{repo}/deployments
```

**Advanced capabilities:**
- Branch protection management
- CI/CD status reporting
- Deployment tracking
- Multi-repo workspace scanning

---

## 12. Dependencies

### 12.1 Official SDK Availability

| Package | Status | Notes |
|---------|--------|-------|
| `@atlassian/bitbucket` | Not available | No official npm SDK |
| `bitbucket` | Community (atlassian) | Partial coverage, may be outdated |
| `bitbucket-rest` | Community | Basic REST wrapper |

**No official Atlassian SDK for Bitbucket REST API** — unlike `@linear/sdk` for Linear.

### 12.2 Recommended Approach

**Use raw `fetch`** with typed wrappers:

```typescript
// Recommended: typed fetch wrapper
class BitbucketClient {
  constructor(private baseUrl: string, private token: string) {}

  async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw new RateLimitError(parseInt(retryAfter || '60') * 1000);
    }

    if (!response.ok) {
      throw new BitbucketError(response.status, await response.json());
    }

    return response.json();
  }
}
```

**Why not an SDK:**
1. No official Atlassian SDK for Bitbucket
2. Community SDKs may be unmaintained
3. REST API is well-documented and straightforward
4. Webhook handling is custom anyway

### 12.3 CLI Parity

| CLI | Status | Notes |
|-----|--------|-------|
| `gh` | N/A | GitHub only |
| `bb` (Bitbucket) | Available | Server-side, for Data Center |

**For Data Center parity with `@support-agent/github-cli`:**
- Consider wrapping `git` + API calls for operations
- No equivalent `bb` CLI for Cloud
- Use REST API as single source of truth

---

## 13. Open Questions

### 13.1 Tenant-Specific Questions

| Question | Why It Matters |
|----------|----------------|
| Does tenant use **Cloud** or **Data Center/Server**? | Determines API base URL, auth method, webhook capabilities |
| Is this a **workspace admin** PAT or **user** PAT? | Workspace PAT can register workspace-level webhooks |
| Do they use **issues** or only **pull requests**? | Scope MVP endpoints |
| Are they on **free** or **paid** Bitbucket plan? | Affects rate limits (60 vs 1000/hr) |

### 13.2 Technical Questions

| Question | Answer Needed For |
|----------|-------------------|
| Do we need **multi-repo** support per tenant? | Webhook vs polling strategy |
| Should we support **private repos** in personal workspaces? | Auth scope determination |
| Do they use **branch restrictions**? | Phase 3 scope |
| Is **Bitbucket Data Center** on-prem? | Webhook URL reachability |

### 13.3 Implementation Questions

| Question | Decision |
|----------|----------|
| Support **inline code comments** on PRs? | Adds complexity to comment handling |
| Sync **reactions** (thumbs up, etc.)? | Requires polling, no webhook |
| **Retry failed webhooks** from our side? | Idempotency considerations |
| Store **raw markdown** or **rendered HTML**? | Display/storage strategy |

---

## Appendix A: Quick Reference

### Bitbucket Cloud API Base

```
Base URL:    https://api.bitbucket.org/2.0
Auth:        Authorization: Bearer {token}
             or Basic {base64(email:app_password)}
```

### Bitbucket Data Center API Base

```
Base URL:    https://{host}:{port}/{context}/rest/api/latest
Auth:        Authorization: Bearer {token}
             or Basic {base64(user:password)}
```

### Key Differences Summary

| Aspect | Cloud | Data Center |
|--------|-------|-------------|
| User ID | UUID | Integer/Username |
| Org unit | Workspace | Project |
| Auth | OAuth 2.0 + PAT + App Password | Basic Auth + PAT + OAuth 1.0a |
| Webhooks | Full HMAC | v8.0+ only |
| Issues | Per-repo tracker | Per-repo tracker |
| Rate limits | Enforced | Configurable |
| API versioning | `/2.0` | `/rest/api/latest` |

---

## Appendix B: Webhook Security Checklist

- [ ] Verify HMAC-SHA256 signature on every webhook request (Cloud + DC 8.0+)
- [ ] Reject requests without valid signature (return 401)
- [ ] Store webhook secrets encrypted
- [ ] Use HTTPS for webhook endpoints
- [ ] Implement idempotent webhook handlers (Bitbucket retries 3x)
- [ ] Log webhook delivery failures for debugging
- [ ] Consider webhook signature algorithm preference (`sha256` over `sha1`)
