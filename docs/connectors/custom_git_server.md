# Custom Git Server Connector — Design Document

> **Last updated**: 2026-04-18
> **Platform**: Custom / BYO git servers — Gitea, Forgejo, Gogs, Bitbucket Server/Data Center, GitLab CE/EE self-managed, Azure DevOps Server, raw git (no UI)

---

## 1. Overview

### 1.1 Category

**Version control** (primary) + **issue-tracker** (varies by platform, optional for raw git).

### 1.2 Cloud vs Self-Hosted Availability

All platforms in this category are **self-hosted only**. There is no managed/Cloud variant for this connector class (unlike GitHub.com, GitLab.com, or Bitbucket Cloud).

| Platform | Issue Tracker | REST API | Webhooks | Notes |
|---|---|---|---|---|
| **Gitea** | Yes (built-in) | Full REST | Yes (structured) | Go, SQLite/MySQL/Postgres |
| **Forgejo** | Yes (built-in) | Full REST | Yes (structured) | Gitea fork, API-compatible |
| **Gogs** | Yes (built-in) | Partial REST | Yes (basic) | Go, lightweight |
| **Bitbucket Server/DC** | Yes (per-repo) | Full REST | Yes (v8.0+ HMAC) | See [bitbucket.md](./bitbucket.md) |
| **GitLab CE/EE** | Yes (full-featured) | Full REST | Yes | See [gitlab.md](./gitlab.md) |
| **Azure DevOps Server** | Yes (Work Items) | Full REST | Yes (HMAC) | TFS evolution |
| **Raw git** | No | No | No | HTTP(S) push/pull + SSH only |

### 1.3 Official API References

| Platform | API Reference |
|---|---|
| Gitea | https://docs.gitea.com/development/api-usage |
| Forgejo | https://forgejo.org/docs/next/developer/ |
| Gogs | https://gogs.io/docs/features/API |
| Bitbucket Server/DC | https://developer.atlassian.com/server/bitbucket/ |
| GitLab Self-Managed | https://docs.gitlab.com/ee/api/rest/ |
| Azure DevOps Server | https://learn.microsoft.com/en-us/rest/api/azure/devops/ |

### 1.4 Platform Variability: What vs What Must Be Configured

This is the core design challenge. Unlike GitHub or GitLab.com where the API surface is known, a "custom git server" covers platforms with radically different capabilities. The connector must distinguish between:

**Assumed to exist (MVP baseline):**
- HTTPS clone/pull for public and authenticated repos
- Webhook delivery to a configurable endpoint
- At minimum one event type: push

**Platform-dependent (must be configured):**
- Issue tracker API (Gitea/Forgejo/Gogs have one; raw git doesn't)
- Comment threading
- Label/priority models
- User identity resolution
- Webhook schema and event names
- Rate limits (none enforced on self-managed by default)

**Design implication:** The connector must be structured around an **adapter pattern** where platform-specific behavior is injected via config, not assumed.

---

## 2. Authentication

Authentication schemes vary dramatically across platforms. SupportAgent must support multiple mechanisms and detect which one to use from config.

### 2.1 HTTP(S) Basic Auth

**Supported by:** All platforms (Gitea, Forgejo, Gogs, Bitbucket DC, GitLab SM, Azure DevOps, raw git)

```
Authorization: Basic {base64(user:password)}
```

- Simple to configure: `username` + `password_or_token`
- For Git hosting, many platforms accept a PAT as the password in Basic Auth
- For raw git over HTTPS: `https://user:token@git.example.com/repo.git`

**Recommendation:** Use as a fallback or for platforms without better options. Store as `username` + `password` (token treated as password).

### 2.2 Personal Access Token (PAT) / API Key

**Supported by:** Gitea, Forgejo, Gogs, Bitbucket DC, GitLab SM, Azure DevOps

**Header formats by platform:**

| Platform | Header |
|---|---|
| Gitea | `Authorization: token {token}` |
| Forgejo | `Authorization: token {token}` |
| Gogs | `Authorization: token {token}` |
| Bitbucket DC | `Authorization: Bearer {token}` |
| GitLab SM | `Authorization: Bearer {token}` or `PRIVATE-TOKEN: {token}` |
| Azure DevOps | `Authorization: Basic {base64(user:PAT)}` |

**Scopes by platform:**

| Platform | Scope Name | Notes |
|---|---|---|
| Gitea/Forgejo | `repo`, `read:user`, `write:repository` | Token-scoped permissions |
| Gogs | `repo`, `user` | Simpler scope model |
| Bitbucket DC | `REPO_READ`, `REPO_WRITE`, `PROJECT_ADMIN` | Permission levels |
| GitLab SM | `api`, `read_api`, `admin_api` | Admin scope for server admin actions |
| Azure DevOps | `vso.code`, `vso.work`, `vso.project` | Full namespaced scopes |

**Token lifetime:**
- Gitea/Forgejo: configurable (default 30 days), supports never-expire with admin setting
- Gogs: configurable per token
- Bitbucket DC: configurable per token (admin-defined)
- GitLab SM: configurable per token, can be never-expire
- Azure DevOps: non-expiring unless revoked

### 2.3 Git SSH Key

**Supported by:** All platforms (universal git transport)

```
git@git.example.com:owner/repo.git
```

- Configured at the **host level** (not per-request header)
- SupportAgent would use an SSH key for git clone/push operations
- Not used for REST API calls
- **Recommendation:** Support for raw git scenarios where no API exists

### 2.4 OAuth2 (Self-Managed)

**Supported by:** Gitea, Forgejo, GitLab SM

Not relevant for a server-side connector. Each tenant would need to register their own OAuth application in their self-hosted instance. OAuth adds complexity without benefit over PAT for server-side integrations.

### 2.5 Webhook Secret / HMAC

| Platform | Header | Algorithm |
|---|---|---|
| Gitea | `X-Gitea-Signature` (or `X-Gogs-Signature`) | HMAC-SHA256 |
| Forgejo | `X-Forgejo-Signature` | HMAC-SHA256 |
| Gogs | `X-Gogs-Signature` | HMAC-SHA256 |
| Bitbucket DC | `X-Hub-Signature` (v8.0+) | HMAC-SHA256 |
| GitLab SM | `X-Gitlab-Token` | Plain shared secret (not HMAC) |
| Azure DevOps | `Authorization` header signature | HMAC-SHA256 |

### 2.6 Token Recommendations for MVP

**MVP Priority:**
1. **PAT via Bearer header** — works across Gitea/Forgejo/Gogs/GitLab/Bitbucket DC
2. **HTTP Basic with PAT as password** — fallback for any platform
3. **SSH key** — for raw git scenarios (no REST API)

**Admin panel config fields:**
```typescript
interface CustomGitServerConfig {
  // Core
  platform: 'gitea' | 'forgejo' | 'gogs' | 'bitbucket_dc' | 'gitlab_sm' | 'azure_devops' | 'raw_git';
  baseUrl: string;                    // e.g. https://git.example.com
  authType: 'pat' | 'basic' | 'ssh_key' | 'none';

  // PAT / Basic Auth
  username?: string;
  token?: string;                       // PAT or password (encrypted at rest)

  // SSH
  sshPrivateKey?: string;              // PEM-encoded private key
  sshKnownHosts?: string;              // Known hosts for host key verification

  // Webhook
  webhookSecret?: string;              // HMAC shared secret
  webhookSignAlgorithm?: 'sha256' | 'sha1';

  // Bot identity (for no_self_retrigger)
  botUsername?: string;                // Platform username of bot account
  botUserId?: string;                  // Platform numeric/string ID of bot

  // Repository (for platforms with repo-level scoping)
  defaultOwner?: string;               // Owner/org path
  defaultRepo?: string;                // Repository slug
}
```

---

## 3. Inbound — Events and Intake

### 3.1 Webhook Support: Partial

**Supported by:** Gitea, Forgejo, Gogs, Bitbucket DC, GitLab SM, Azure DevOps
**Not supported:** Raw git

Webhooks are the primary inbound mechanism for platforms that have them. Each platform has a different schema and event naming.

#### 3.1.1 Gitea / Forgejo Webhook Events

Both Gitea and Forgejo share a compatible webhook API (Forgejo is a Gitea fork). Event types:

| Header Value | Event | SupportAgent Relevance |
|---|---|---|
| `push` | Push to repo | Low — push-based triggers not primary |
| `create` | Branch/tag created | Optional |
| `delete` | Branch/tag deleted | Optional |
| `fork` | Repo forked | Optional |
| `issues` | Issue opened/closed/updated | **Primary** |
| `issue_comment` | Comment on issue | **Primary** |
| `pull_request` | PR opened/closed/updated | **Primary** |
| `pull_request_comment` | Comment on PR | **Primary** |
| `release` | Release published | Optional |
| `repository` | Repo created/deleted/renamed | Optional |

**Webhook registration (Gitea/Forgejo):**
```
POST /repos/{owner}/{repo}/webhooks
{
  "type": "gitea",
  "config": {
    "url": "https://your-endpoint.com/webhook",
    "secret": "{webhook_secret}",
    "content_type": "json"
  },
  "events": ["issues", "issue_comment", "pull_request", "pull_request_comment"],
  "active": true
}
```

**Signature verification (Gitea):**
```
X-Gitea-Signature: sha256={hmac_hex_digest}
```
Compute: `HMAC-SHA256(secret, raw_body)`. Compare hex digests.

**Signature verification (Forgejo):**
```
X-Forgejo-Signature: sha256={hmac_hex_digest}
```
Same algorithm as Gitea.

#### 3.1.2 Gogs Webhook Events

| Event | Notes |
|---|---|
| `push` | Push to repo |
| `create` | Branch/tag created |
| `delete` | Branch/tag deleted |
| `fork` | Repo forked |
| `issues` | Issue events |
| `issue_comment` | Issue comment events |
| `pull_request` | PR events |
| `release` | Release events |

**Signature verification:**
```
X-Gogs-Signature: sha256={hmac_hex_digest}
```
Same HMAC-SHA256 pattern.

**Note:** Gogs has a more limited webhook API than Gitea. Some features (e.g., fine-grained event selection) may not be available.

#### 3.1.3 Bitbucket Server/Data Center

See [bitbucket.md](./bitbucket.md) Section 3.1 for webhook event names and registration.

Key events: `pr:opened`, `pr:modified`, `pr:merged`, `pr:declined`, `pr:comment:created`, `pr:comment:edited`, `pr:comment:deleted`, `repo:refs_changed`.

**HMAC support:** Only v8.0+ has HMAC webhook verification. Earlier versions have no secret mechanism.

#### 3.1.4 GitLab Self-Managed

See [gitlab.md](./gitlab.md) Section 3.1 for webhook events.

Key events: `Issue Hook` (object_kind: `issue`), `Merge Request Hook`, `Note Hook`.

**Important:** GitLab uses a plain shared secret (`X-Gitlab-Token`), not HMAC. There is no cryptographic signature — just a string comparison.

#### 3.1.5 Azure DevOps Server Webhook Events

Uses **Service Hooks** for event delivery. Events are delivered as POST to configured URL.

| Event | Description |
|---|---|
| `ms.vss.code.git.push` | Git push |
| `ms.vss.code.git.pullrequest.created` | PR created |
| `ms.vss.code.git.pullrequest.updated` | PR updated |
| `ms.vss.code.git.pullrequest.merged` | PR merged |
| `ms.vss.code.workitem.updated` | Work item updated |
| `ms.vss.work.workitem.created` | Work item created |
| `ms.vss.work.workitem.commented` | Work item comment |

**Signature verification:**
Azure DevOps uses a shared secret configured at the subscription level. The signature is computed as HMAC-SHA256 of the raw body with the secret, and is sent as `Authorization` header:
```
Authorization: HmacSHA256={base64_hmac}
```

### 3.2 Polling Fallback Strategy

When webhooks are unavailable (raw git, or for reconciliation):

**Gitea/Forgejo — Issues:**
```
GET /repos/{owner}/{repo}/issues?state=open&sort=updated&direction=desc&limit=50
GET /repos/{owner}/{repo}/issues?state=all&since={timestamp}&limit=50
```

**Gitea/Forgejo — Pull Requests:**
```
GET /repos/{owner}/{repo}/pulls?state=open&sort=updated&direction=desc&limit=50
```

**Gitea/Forgejo — Comments:**
```
GET /repos/{owner}/{repo}/issues/{index}/comments?limit=50
GET /repos/{owner}/{repo}/pulls/{index}/comments?limit=50
```

**GitLab Self-Managed:** See [gitlab.md](./gitlab.md) Section 3.4.

**Bitbucket DC:** See [bitbucket.md](./bitbucket.md) Section 3.5.

**Azure DevOps:**
```
GET /{project}/_apis/wit/workitems?$top=50&updatedAfter={timestamp}
GET /{project}/_apis/git/pullrequests?searchCriteria.status=open
```

**Raw git:** No API. Polling is not possible. SupportAgent would need to rely on:
1. Webhooks from a git hosting layer in front of raw git (e.g., Gitea's webhook on push)
2. External triggers (e.g., a CI system that detects push and calls SupportAgent's API)

### 3.3 Payload Fields to Persist

#### Gitea/Forgejo Issue Payload (`issue` event)

```json
{
  "action": "opened",
  "issue": {
    "id": 12345,
    "number": 42,
    "title": "Bug in login flow",
    "body": "Description text...",
    "state": "open",
    "labels": [{"name": "bug"}, {"name": "high-priority"}],
    "assignees": [{"login": "username", "id": 1}],
    "milestone": null,
    "pull_request": null,
    "created_at": "2026-04-18T10:00:00Z",
    "updated_at": "2026-04-18T10:00:00Z",
    "closed_at": null,
    "url": "https://git.example.com/owner/repo/issues/42"
  },
  "repository": {
    "id": 1,
    "name": "repo",
    "full_name": "owner/repo",
    "html_url": "https://git.example.com/owner/repo"
  },
  "sender": {
    "login": "alice",
    "id": 1
  }
}
```

#### Gitea/Forgejo Issue Comment Payload (`issue_comment` event)

```json
{
  "action": "created",
  "comment": {
    "id": 999,
    "body": "Comment text...",
    "created_at": "2026-04-18T10:05:00Z",
    "updated_at": "2026-04-18T10:05:00Z",
    "html_url": "https://git.example.com/owner/repo/issues/42#issuecomment-999"
  },
  "issue": {
    "id": 12345,
    "number": 42,
    "title": "Bug in login flow"
  },
  "repository": {...},
  "sender": {...}
}
```

#### Azure DevOps Work Item Payload

```json
{
  "eventType": "ms.vss.work.workitem.updated",
  "resource": {
    "id": 123,
    "workItemId": 123,
    "rev": 5,
    "fields": {
      "System.Title": "Work item title",
      "System.State": "Active",
      "System.AssignedTo": { "displayName": "User", "uniqueName": "user@example.com" },
      "Microsoft.VSTS.Common.Priority": 2
    },
    "changedFields": {
      "System.State": { "oldValue": "New", "newValue": "Active" }
    },
    "url": "https://azure.example.com/{project}/_apis/wit/workItems/123"
  },
  "subscriptionId": "...",
  "resourceVersion": "..."
}
```

---

## 4. Outbound — Writing Back

### 4.1 Create Issue

**Gitea/Forgejo:**
```
POST /repos/{owner}/{repo}/issues
{
  "title": "Issue title",
  "body": "Issue body (Markdown)",
  "assignees": ["username1"],
  "labels": ["bug", "high-priority"]
}
```

**Gogs:** Similar to Gitea but fewer fields supported.

**Azure DevOps:**
```
POST /{project}/_apis/wit/workitems?api-version=7.0
[
  { "op": "add", "path": "/fields/System.Title", "value": "Work item title" },
  { "op": "add", "path": "/fields/System.Description", "value": "Description" },
  { "op": "add", "path": "/fields/System.WorkItemType", "value": "Bug" }
]
```
Uses OData-style patch operations (not plain JSON body).

**GitLab SM:** See [gitlab.md](./gitlab.md) Section 4.1.

### 4.2 Post Comment on Issue

**Gitea/Forgejo:**
```
POST /repos/{owner}/{repo}/issues/{index}/comments
{ "body": "Comment text (Markdown)" }
```

**Gogs:** Same endpoint, fewer options.

**Azure DevOps:**
```
POST /{project}/_apis/wit/workitems/{id}/comments?api-version=7.0
{ "text": "Comment text" }
```

**GitLab SM:** See [gitlab.md](./gitlab.md) Section 4.3.

**Bitbucket DC:** See [bitbucket.md](./bitbucket.md) Section 4.4.

### 4.3 Edit Comment

**Gitea/Forgejo:**
```
PATCH /repos/{owner}/{repo}/issues/{index}/comments/{id}
{ "body": "Updated comment text" }
```

**Azure DevOps:**
```
PATCH /{project}/_apis/wit/workitems/{id}/comments/{commentId}?api-version=7.0
{ "text": "Updated comment text" }
```

### 4.4 Delete Comment

**Gitea/Forgejo:**
```
DELETE /repos/{owner}/{repo}/issues/{index}/comments/{id}
```

### 4.5 Change Status / Transition

**Gitea/Forgejo — Close/Reopen Issue:**
```
PATCH /repos/{owner}/{repo}/issues/{index}
{ "state": "closed" }
```
Valid states: `open`, `closed`.

**Gitea/Forgejo — Close/Reopen PR:**
```
PATCH /repos/{owner}/{repo}/pulls/{index}
{ "state": "closed" }
```

**Azure DevOps — Change Work Item State:**
```
PATCH /{project}/_apis/wit/workitems/{id}?api-version=7.0
[
  { "op": "replace", "path": "/fields/System.State", "value": "Closed" }
]
```

### 4.6 Add/Remove Label

**Gitea/Forgejo:**
```
POST /repos/{owner}/{repo}/issues/{index}/labels
{ "name": "needs-info" }
```
Create label if not exists: `POST /repos/{owner}/{repo}/labels`.

Remove label: `DELETE /repos/{owner}/{repo}/issues/{index}/labels/{name}`.

**Gogs:** Limited label API. May need to use issue update endpoint.

### 4.7 Set Assignee

**Gitea/Forgejo:**
```
PATCH /repos/{owner}/{repo}/issues/{index}
{ "assignees": ["username1", "username2"] }
```
To unassign: `PATCH /repos/{owner}/{repo}/issues/{index}` with `assignees: []`.

### 4.8 Mention User

**Gitea/Forgejo:** `@username` in Markdown body.

**Azure DevOps:** `@{user}` in work item comments.

### 4.9 Attach File / Screenshot

**Gitea/Forgejo:**
```
POST /repos/{owner}/{repo}/attachments
Content-Type: multipart/form-data
file=@screenshot.png
```
Response: `{ "attachments": [{ "name": "screenshot.png", "download_url": "..." }] }`
Reference in comment: `![screenshot.png](/owner/repo/media/{attachment_hash}/screenshot.png)`

**Azure DevOps:** Upload via Git attachment API:
```
POST /{project}/_apis/wit/attachments?fileName={name}&api-version=7.0
Content-Type: multipart/form-data
```

### 4.10 Threaded Comments (Two-Way Sync)

**Gitea/Forgejo:** Use the `comments` endpoint with `issue_index` and `timeline` for threaded views. No separate thread model — comments are flat but can be replied to in order.

**Azure DevOps:** Comments have a thread structure:
```
POST /{project}/_apis/wit/workitems/{id}/comments?api-version=7.0
{
  "text": "comment",
  "parentCommentId": 123,   // For reply
  "commentsType": 1         // Type 1 = thread, Type 2 = reply
}
```

---

## 5. Labels, Flags, Fields, Priorities

### 5.1 Gitea/Forgejo Label Model

- Labels are **per-repository**
- Fields: `id`, `name`, `color` (hex), `description`, `url`
- Listing: `GET /repos/{owner}/{repo}/labels`
- No custom fields — use labels as metadata

### 5.2 Gogs Label Model

- Similar to Gitea but API may be more limited
- No label description or color management in older versions

### 5.3 Azure DevOps Work Item Fields

Rich field system — not labels-as-tags like GitHub:

| Field | Type | Notes |
|---|---|---|
| `System.Title` | string | Required |
| `System.State` | picklist | Workflow-driven values |
| `System.AssignedTo` | identity | Resolvable to user |
| `System.AreaPath` | tree path | Project area |
| `System.IterationPath` | tree path | Sprint/iteration |
| `Microsoft.VSTS.Common.Priority` | integer | 1-4 (1=critical) |
| `Microsoft.VSTS.Common.Severity` | picklist | Bug severity |
| `System.Tags` | string[] | Semi-colon separated, like labels |

**Custom fields:** Yes — tenants can define custom work item types and fields. Must query field metadata via `GET /_apis/wit/workitemtypes/{type}/fields`.

### 5.4 Status Model by Platform

| Platform | Status Shape | Notes |
|---|---|---|
| Gitea/Forgejo | `open` / `closed` | Binary |
| Gogs | `open` / `closed` | Binary |
| GitLab SM | `opened` / `closed` | Binary |
| Bitbucket DC | Configurable workflow | Per-project states |
| Azure DevOps | Workflow-driven picklist | `Bug`, `Task`, `Epic` have different workflows |

### 5.5 Priority / Severity

| Platform | Priority | Severity |
|---|---|---|
| Gitea/Forgejo | No built-in | No built-in (use labels) |
| Gogs | No built-in | No built-in |
| Azure DevOps | `Priority` (1-4) | `Severity` picklist |

---

## 6. Triggers We Can Match On

### 6.1 Gitea/Forgejo Webhook Triggers

From `push` events: not primary for SupportAgent use cases.

From `issues` events (`action` field):
- `opened` → new issue
- `closed` → issue closed
- `reopened` → issue reopened
- `edited` → issue edited (body, title, assignees, labels)
- `assigned` → assignee added
- `unassigned` → assignee removed
- `label_added` → label added (in `changes` object)
- `label_removed` → label removed

From `issue_comment` events:
- `created` → new comment
- `edited` → comment edited
- `deleted` → comment deleted

From `pull_request` events:
- `opened` → new PR
- `closed` → PR closed/merged
- `edited` → PR edited
- `approved` → PR approved
- `rejected` → PR changes requested
- `synchronized` → PR updated (new commits)

**Matchable fields:**
- `action` (event type)
- `issue.labels[].name` (exact label, added, removed)
- `issue.assignees[].login` (assignee change)
- `issue.body` regex (body content)
- `comment.body` regex (comment text)
- `sender.login` (author of action)
- `repository.full_name` (project scope)

### 6.2 Azure DevOps Work Item Triggers

From `ms.vss.work.workitem.updated`:
- `resource.changedFields` — diff of changed fields
- `resource.fields.System.State` — status transitions
- `resource.fields.System.AssignedTo` — assignee changes
- `resource.fields.System.Tags` — tag changes

**Matchable fields:**
- `eventType` (event type)
- `resource.fields.*` (any work item field, including custom)
- `resource.changedFields.*` (delta — what changed)
- `resource.workItemId` (item ID)

### 6.3 Trigger Matcher Coverage

| Trigger | Gitea/Forgejo | Gogs | Bitbucket DC | GitLab SM | Azure DevOps |
|---|---|---|---|---|---|
| **Label added** | `changes.labels.current` diff | Limited | Not native event | `changes.labels.current` diff | `changedFields` on `System.Tags` |
| **Label removed** | `changes.labels.previous` diff | Limited | Not native event | `changes.labels.previous` diff | Same |
| **Status → closed** | `action === "closed"` | `action === "closed"` | `event === "pr:merged"` / `pr:declined` | `objectAttributes.action === "close"` | `changedFields.System.State` |
| **Mention of bot** | Parse `body` for `@bot` | Parse `body` | Parse `comment.raw` | Parse `body` for `@bot` | Parse `text` for `@{user}` |
| **Comment body regex** | `comment.body` | `comment.body` | `comment.content.raw` | `objectAttributes.body` | `text` |
| **Assignee change** | `changes.assignees` | `issue.assignee` | Not native | `changes.assignees` | `changedFields.System.AssignedTo` |
| **Project scope** | `repository.full_name` | `repo.name` | `projectKey/repoSlug` | `project.id` | `project` name |
| **Custom field** | No | No | No | No (via labels) | `resource.fields.Custom.*` |

---

## 7. Identity Mapping

### 7.1 User ID Shapes by Platform

| Platform | ID Type | Example |
|---|---|---|
| Gitea | Integer | `12345` |
| Forgejo | Integer | `12345` |
| Gogs | Integer | `12345` |
| Bitbucket DC | Integer | `12345` |
| GitLab SM | Integer | `12345678` |
| Azure DevOps | GUID | `{a1b2c3d4-...}` |

### 7.2 Resolve User → Email or Stable External ID

**Gitea/Forgejo:**
```
GET /users/{username}
GET /repos/{owner}/{repo}/collaborators
```
Returns: `{ id, login, full_name, email, avatar_url }`.
Email requires `read:user` scope and user must have public email set.

**Azure DevOps:**
```
GET /_apis/graph/users/{userDescriptor}
GET /{project}/_apis/work/teammembers
```
Returns: `{ descriptor, principalName, displayName, mailAddress }`.
Email is reliably available for Azure AD / Entra ID integrated instances.

### 7.3 Bot Identity — `no_self_retrigger`

All platforms expose `sender` / `author` on webhook payloads and API responses. The connector stores the bot's username and ID (if available), then checks inbound events.

**Gitea/Forgejo:**
- `sender.login` (username string — stable)
- `sender.id` (integer — stable)
- `author.login` on comment responses
- No `system` field like GitLab — all comments look like regular user comments

**Azure DevOps:**
- `resource.fields.System.CreatedBy` (identity reference)
- `resource.fields.System.ChangedBy` (identity reference)
- Identity has `uniqueName` and `displayName`

**Detection strategy:**
1. Store bot's username (`botUsername`) and ID (`botUserId`) from config
2. On every inbound event, check if `payload.sender?.login === botUsername`
3. For comment events, additionally check `payload.comment?.author?.login === botUsername`
4. For Azure DevOps, check `payload.resource?.fields?.System.ChangedBy?.uniqueName`

### 7.4 Author Field on Comments We Post

All platforms return the comment author in API responses.

**Gitea/Forgejo:**
```json
{
  "id": 999,
  "body": "Our comment...",
  "user": { "id": 1, "login": "support-bot", "full_name": "Support Agent" },
  "created_at": "2026-04-18T10:00:00Z"
}
```

---

## 8. Rate Limits

### 8.1 Overview

**All self-hosted platforms default to no rate limits.** Admins can configure limits, but the default is unlimited. This differs sharply from cloud platforms (GitHub.com, GitLab.com, Bitbucket Cloud) which enforce strict limits.

| Platform | Default Limits | Configurable |
|---|---|---|
| Gitea | None | Per-instance config (rate limit settings) |
| Forgejo | None (inherits Gitea) | Same as Gitea |
| Gogs | None | Not configurable |
| Bitbucket DC | None | Per-user configurable |
| GitLab SM | None | Admin-configurable per-user and global |
| Azure DevOps Server | None | Per-collection, per-user configurable |
| Raw git | N/A | N/A |

**Connector behavior:** Do not assume rate limit headers exist. When they do exist, respect them. When they don't, use conservative backoff for repeated errors.

### 8.2 How Rate Limits Are Exposed

| Platform | Header/Response |
|---|---|
| Gitea | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (if enabled) |
| Forgejo | Same as Gitea |
| Gogs | None |
| GitLab SM | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (per endpoint) |
| Bitbucket DC | `X-RateLimit-Limit`, `X-RateLimit-Remaining` (if configured) |
| Azure DevOps | No standard rate limit headers. Use `Retry-After` on 429. |

### 8.3 Bulk / Batch Endpoints

None of the self-hosted platforms have batch APIs. Single-request-per-resource is the norm.

**Optimization strategies:**
- Use `per_page` / `limit` params to fetch multiple items per request
- Use keyset/offset pagination to batch page fetches
- Cache resolved user identities (email → platform user ID)

---

## 9. Pagination & Search

### 9.1 Pagination Styles by Platform

| Platform | Style | Max Page Size |
|---|---|---|
| Gitea | Offset: `page`, `limit` | Default 20, max 100 |
| Forgejo | Offset: `page`, `limit` | Default 20, max 100 |
| Gogs | Offset: `page`, `limit` | Default 20 |
| GitLab SM | Offset: `page`, `per_page` OR Keyset: `order_by`, `sort` | Max 100 |
| Bitbucket DC | Offset: `start`, `limit` | Max 1000 (configurable) |
| Azure DevOps | Continuation token (OData `$skip`, `$top`) | Max 200 per page |

### 9.2 Search Endpoints

| Platform | Endpoint | Notes |
|---|---|---|
| Gitea/Forgejo | `GET /repos/{owner}/{repo}/issues/search?q={query}` | Search issues by keyword |
| Gitea/Forgejo | `GET /repos/{owner}/{repo}/issues?labels={label}` | Filter by label |
| Gitea/Forgejo | `GET /repos/{owner}/{repo}/issues?state={open/closed}` | Filter by state |
| GitLab SM | `GET /projects/{id}/issues?search={q}&in=title,description` | Full-text search |
| Azure DevOps | `GET /{project}/_apis/wit/workitems?$filter=...` | OData-style filter |
| Azure DevOps | `GET /{project}/_apis/wit/workitems?$search=...` | Full-text search |

### 9.3 Reconciliation Strategy

For reconciliation across all platforms:

```
# Use updated_at as cursor
GET /issues?state=all&since={lastSyncTimestamp}&limit=100

# For comments, check issue's updated_at and fetch comments if issue was updated
GET /issues/{id}/comments?since={lastSyncTimestamp}
```

---

## 10. Known Gotchas

### 10.1 Webhook Schema Fragmentation

**Critical:** Each platform has a completely different webhook payload schema. A single "custom git server" connector cannot use a shared event handler — it must apply platform-specific parsing logic.

| Platform | Issue Event Shape | Comment Event Shape |
|---|---|---|
| Gitea | `{ action, issue, repository, sender }` | `{ action, comment, issue, sender }` |
| Forgejo | Same as Gitea | Same as Gitea |
| Gogs | Similar to Gitea (may be less complete) | Similar to Gitea |
| GitLab SM | `{ object_kind, object_attributes, project, user }` | `{ object_kind, object_attributes, project, user }` |
| Bitbucket DC | `{ actor, pullRequest, event }` | Same |
| Azure DevOps | `{ eventType, resource, detailedMessage }` | `{ eventType, resource }` |

**Implication:** The connector needs a platform-specific event parser per config. Cannot generalize across payloads.

### 10.2 Webhook Event Gaps

| Platform | Missing Events |
|---|---|
| Gitea/Forgejo | No `assignee_changed` event — must detect via issue edit + compare |
| Gitea/Forgejo | No `priority_changed` event — detect via issue edit |
| Gogs | Even more limited than Gitea — fewer event types |
| Bitbucket DC | No PR label change events (see [bitbucket.md](./bitbucket.md) Section 10.2) |
| Azure DevOps | Work item comment edited/deleted events may be missing |

### 10.3 Missing Webhook HMAC on Older Versions

| Platform | HMAC Required | Earliest Version |
|---|---|---|
| Gitea | Yes | All versions (HMAC-SHA256) |
| Forgejo | Yes | All versions (HMAC-SHA256) |
| Gogs | Yes | All versions |
| Bitbucket DC | No (added v8.0) | Versions < 8.0 have no webhook secret |
| GitLab SM | No (plain token only) | All versions |

**Recommendation:** Support both HMAC and plain-token verification. Log which mechanism is being used. For Bitbucket DC < v8.0, no verification is possible — document this limitation.

### 10.4 Issue Tracker Availability

| Platform | Has Issue Tracker | Notes |
|---|---|---|
| Gitea | Yes | Full-featured |
| Forgejo | Yes | Full-featured |
| Gogs | Yes | Basic |
| Bitbucket DC | Yes | Per-repo |
| GitLab SM | Yes | Full-featured |
| Azure DevOps | Yes | Work Items (richer than issue tracker) |
| Raw git | No | No API; only push/pull |

**Implication:** The connector must gracefully handle platforms without issue trackers. For raw git, only webhook delivery of push events is possible.

### 10.5 Self-Managed Instance Availability

SupportAgent must handle:
- Instance downtime (webhook delivery fails, polling fails)
- Network isolation (webhook endpoint must be reachable from the git server)
- TLS certificate validation (self-signed certs on internal networks)
- Version drift (tenants may run very old versions)

**Recommended config fields:**
```typescript
{
  skipTlsVerification?: boolean;  // For self-signed certs on internal networks
  timeout?: number;                 // Request timeout in ms (default 30000)
  requiredApiVersion?: string;     // Enforce minimum API version
}
```

### 10.6 Multi-Tenant Isolation Challenges

Unlike GitHub.com (where OAuth app installation is centralized), self-managed platforms have different isolation models:

| Platform | Isolation Model | Challenge |
|---|---|---|
| Gitea | Per-instance | Single instance = single tenant (natural isolation) |
| Forgejo | Per-instance | Same |
| GitLab SM | Group/Project hierarchy | Multi-group isolation possible |
| Azure DevOps | Collection/Project hierarchy | Multi-project isolation via PAT scopes |
| Raw git | None | No isolation mechanism |

**For raw git:** Each tenant gets a separate git host URL. No shared infrastructure.

### 10.7 User Identity Resolution Gaps

| Platform | Email Available via API? | Notes |
|---|---|---|
| Gitea/Forgejo | Only if user set public email | Privacy-protected |
| Gogs | Only if user set public email | Privacy-protected |
| Azure DevOps | Yes (if integrated with Entra ID) | Best for identity resolution |
| GitLab SM | Only if user set public email | Privacy-protected |

**Recommendation:** Don't rely on email for user identity. Use platform-native IDs (`login` for Gitea/Gogs, `uniqueName` for Azure DevOps, `username` for GitLab).

### 10.8 Platform-Specific Field Names

Many platforms share field names but with different casing/spelling:

| Field | Gitea | GitLab | Azure DevOps |
|---|---|---|---|
| Issue ID | `id` / `number` | `id` / `iid` | `id` / `workItemId` |
| Status | `state` | `state` | `System.State` |
| Assignee | `assignees[]` (array) | `assignees[]` (array) | `System.AssignedTo` (single) |
| Labels/Tags | `labels[]` (array of objects) | `labels[]` (string array) | `System.Tags` (semicolon string) |
| Title | `title` | `title` | `System.Title` |

---

## 11. Recommended SupportAgent Connector Scope

### MVP — Minimum to Be Useful

**Assumes platform has:**
- A REST API
- At minimum a webhook system that delivers push or issue events

**Endpoints to wrap (platform-agnostic abstraction):**

| Operation | Gitea/Forgejo/Gogs | GitLab SM | Azure DevOps | Bitbucket DC |
|---|---|---|---|---|
| List items | `GET /repos/{owner}/{repo}/issues` | `GET /projects/{id}/issues` | `GET /{project}/_apis/wit/workitems` | `GET /rest/api/latest/projects/{key}/repos/{repo}/issues` |
| Get item | `GET /repos/{owner}/{repo}/issues/{index}` | `GET /projects/{id}/issues/{iid}` | `GET /{project}/_apis/wit/workitems/{id}` | `GET /rest/api/latest/projects/{key}/repos/{repo}/issues/{id}` |
| Create item | `POST /repos/{owner}/{repo}/issues` | `POST /projects/{id}/issues` | `POST /{project}/_apis/wit/workitems?$type={type}` | `POST /rest/api/latest/projects/{key}/repos/{repo}/issues` |
| List comments | `GET /repos/{owner}/{repo}/issues/{index}/comments` | `GET /projects/{id}/issues/{iid}/notes` | `GET /{project}/_apis/wit/workitems/{id}/comments` | `GET /rest/api/latest/projects/{key}/repos/{repo}/issues/{id}/comments` |
| Post comment | `POST /repos/{owner}/{repo}/issues/{index}/comments` | `POST /projects/{id}/issues/{iid}/notes` | `POST /{project}/_apis/wit/workitems/{id}/comments` | `POST /rest/api/latest/projects/{key}/repos/{repo}/issues/{id}/comments` |
| Update item | `PATCH /repos/{owner}/{repo}/issues/{index}` | `PUT /projects/{id}/issues/{iid}` | `PATCH /{project}/_apis/wit/workitems/{id}` | `PUT /rest/api/latest/projects/{key}/repos/{repo}/issues/{id}` |
| List labels | `GET /repos/{owner}/{repo}/labels` | `GET /projects/{id}/labels` | `GET /{project}/_apis/wit/fields` (custom fields) | `GET /rest/api/latest/projects/{key}/repos/{repo}/labels` |
| Webhook registration | `POST /repos/{owner}/{repo}/hooks` | `POST /projects/{id}/integrations/webhooks` | Via Service Hooks API | `POST /rest/api/latest/projects/{key}/repos/{repo}/webhooks` |

**Webhook events to handle:**

| Platform | Primary Events |
|---|---|
| Gitea/Forgejo | `issues`, `issue_comment`, `pull_request`, `pull_request_comment` |
| Gogs | `issues`, `issue_comment`, `pull_request` |
| GitLab SM | `Issue Hook`, `Merge Request Hook`, `Note Hook` |
| Azure DevOps | `ms.vss.work.workitem.created`, `ms.vss.work.workitem.updated`, `ms.vss.work.workitem.commented` |
| Bitbucket DC | `pr:opened`, `pr:modified`, `pr:merged`, `pr:comment:created` |

**Minimum admin panel config fields:**

```typescript
interface CustomGitServerConfig {
  platform: string;                   // 'gitea' | 'forgejo' | 'gogs' | 'gitlab_sm' | 'bitbucket_dc' | 'azure_devops'
  baseUrl: string;                     // https://git.example.com

  // Auth
  authType: 'pat' | 'basic' | 'ssh_key';
  username?: string;
  token?: string;                      // PAT (Bearer) or password for Basic

  // SSH (for raw git or git operations)
  sshPrivateKey?: string;
  sshKnownHosts?: string;

  // Repository
  owner: string;                       // owner/org/user path
  repo: string;                        // repo name

  // Webhook
  webhookSecret?: string;              // HMAC secret or plain token
  webhookSignAlgorithm?: 'sha256' | 'plain';

  // Bot identity (no_self_retrigger)
  botUsername?: string;

  // Platform-specific
  projectKey?: string;                // Bitbucket DC / Azure DevOps project
  webhookUrl?: string;                // Register webhook at this URL

  // Safety
  skipTlsVerification?: boolean;
  requestTimeout?: number;             // ms, default 30000
}
```

### Phase 2 — Parity with GitHub Connector

**Additional capabilities:**
- PR/pull request support (for platforms with PRs: Gitea/Forgejo/Gogs/GitLab/Bitbucket DC)
- Comment editing and deletion
- Label management (create, list)
- Assignee management
- Threaded discussions (where supported)
- OAuth2 flow (if needed for user-delegated actions — adds significant complexity)
- Platform-specific field metadata (Azure DevOps custom fields)

**Trigger matchers to enable:**
- Label add/remove (via `changes` diff on Gitea, `changedFields` on Azure DevOps)
- Status transitions (state diff)
- Comment body regex (platform-agnostic text scan)
- Assignee change (diff of assignee list)
- Project/team scope (via owner/repo or project path in config)

### Phase 3 — Advanced

**Features unique to specific platforms:**

| Feature | Platform | Implementation |
|---|---|---|
| Custom work item fields | Azure DevOps | Query `/fields` metadata, support custom field updates |
| Work item types (Bug/Task/Epic) | Azure DevOps | Specify `System.WorkItemType` on create |
| Branch/tag operations | Gitea/Forgejo/Gogs | `POST /repos/{owner}/{repo}/git/trees` |
| Release management | GitLab SM / Gitea | `POST /projects/{id}/releases` |
| Pipeline status | GitLab SM | `GET /projects/{id}/pipelines` |
| Code review comments | Bitbucket DC | `POST /rest/api/latest/projects/{key}/repos/{repo}/pull-requests/{id}/comments` (inline) |

---

## 12. Dependencies

### 12.1 SDK Availability

| Platform | SDK | Notes |
|---|---|---|
| Gitea | No official SDK | Use `gitea-js` (community) or raw `fetch` |
| Forgejo | No official SDK | API-compatible with Gitea — use Gitea client or raw fetch |
| Gogs | No official SDK | Raw `fetch` only |
| GitLab SM | `@gitbeaker/rest` | See [gitlab.md](./gitlab.md) |
| Bitbucket DC | No official SDK | Raw `fetch` only |
| Azure DevOps | No official SDK | Raw `fetch` or `azure-devops-node-api` (TypeScript) |

### 12.2 Recommended Approach

**Use raw `fetch` with typed wrapper functions** for this connector. Rationale:

1. **No official SDK** for most platforms (Gitea/Forgejo/Gogs are the primary targets)
2. **Platform adapter pattern** means the connector is already a thin wrapper — adding another SDK layer adds indirection without value
3. **Webhook handling** is platform-specific anyway — no SDK helps here
4. **Minimal surface area** — the connector wraps only 8-12 endpoints, not a full API surface

**Implementation approach:**
```typescript
// One adapter per platform, selected at runtime from config.platform
interface GitServerAdapter {
  // Auth
  authHeaders(): Record<string, string>;

  // Inbound
  parseWebhookEvent(payload: unknown, headers: Headers): InboundEvent | null;
  listItems(opts: ListOpts): Promise<ItemList>;
  getItem(id: string): Promise<Item>;
  listComments(itemId: string): Promise<Comment[]>;

  // Outbound
  createItem(body: CreateItemBody): Promise<Item>;
  postComment(itemId: string, body: string): Promise<Comment>;
  updateItem(itemId: string, updates: ItemUpdates): Promise<Item>;

  // Admin
  registerWebhook(url: string, events: string[]): Promise<void>;
  listWebhooks(): Promise<Webhook[]>;
}
```

### 12.3 CLI Tool Parity

No equivalent CLI exists for Gitea/Forgejo/Gogs that matches `gh` or `glab`. The `gitea` CLI (`gitea admin`) covers admin operations but not issue/PR management from a scripting perspective.

**For raw git scenarios:** Shell out to `git` for clone/push operations. No API-based alternative.

---

## 13. Open Questions

### 13.1 Platform Identification

| Question | Why It Matters |
|---|---|
| Which platform does the tenant run (Gitea, Forgejo, GitLab SM, Azure DevOps, other)? | Determines adapter selection and API surface |
| What version of the platform? | Affects webhook HMAC support, API endpoint availability |
| Is TLS verification needed (self-signed certs)? | Adds `rejectUnauthorized` config |

### 13.2 Feature Scope

| Question | Why It Matters |
|---|---|
| Does the tenant need issue tracker support or only code review (PRs)? | Determines which adapter methods to implement |
| Do they use pull requests (MRs) or only issues? | Adds PR event handling and threading |
| Are they on GitLab SM, Gitea, or Azure DevOps specifically? | Each has a very different API — one adapter doesn't cover all |
| Do they need Azure DevOps Work Item custom fields? | Requires querying `/fields` metadata |

### 13.3 Webhook Reachability

| Question | Why It Matters |
|---|---|
| Is the SupportAgent webhook endpoint reachable from the git server? | If not, must use polling fallback |
| Does the git server run in a private network? | May need `skipTlsVerification` or VPN tunneling |
| Can the tenant configure webhooks on their instance? | Some platforms require admin to register webhooks |

### 13.4 Identity Resolution

| Question | Why It Matters |
|---|---|
| Can the tenant accept using platform usernames as identity (no email mapping)? | Simplifies identity model |
| Is Azure DevOps integrated with Entra ID? | Would provide reliable email/identity via Entra |

### 13.5 Multi-Instance Support

| Question | Why It Matters |
|---|---|
| Does the tenant run a single git instance or multiple (e.g., one per team)? | Affects whether `baseUrl` is per-tenant or per-request |
| Do tenants need to watch multiple repositories? | May need array of `repositories[]` in config |

### 13.6 Migration Path from GitLab/Bitbucket Connectors

Since GitLab and Bitbucket Server have their own connectors, should the custom git server connector be:
- **A separate connector** with its own adapter, used only for non-GitLab/Bitbucket platforms?
- **A unified adapter** that can serve GitLab and Bitbucket as well, with a config switch?

**Recommendation:** Keep separate connectors for GitLab.com/self-managed and Bitbucket Cloud/DC (they have more complex feature sets and existing design docs). The Custom Git Server connector covers Gitea/Forgejo/Gogs/raw git as the "catch-all" for platforms not covered by the specialized connectors.

---

## Appendix A: Platform API Schema Comparison

### Issue List Endpoint Comparison

| Platform | Path | Response Shape |
|---|---|---|
| Gitea | `GET /repos/{owner}/{repo}/issues?state=open` | `{ data: Issue[], meta: pagination }` |
| Forgejo | Same as Gitea | Same |
| Gogs | `GET /repos/{owner}/{repo}/issues` | `{ issues: Issue[], count: number }` |
| GitLab SM | `GET /projects/{id}/issues` | Array of issue objects with `iid`, `title`, etc. |
| Bitbucket DC | `GET /rest/api/latest/projects/{key}/repos/{repo}/issues` | `{ values: Issue[], size: number, isLastPage: bool }` |
| Azure DevOps | `GET /{project}/_apis/wit/workitems?$top=50` | `{ value: WorkItem[], count: number }` |

### Webhook Event Name Comparison

| Platform | Header | Example Event Name |
|---|---|---|
| Gitea | `X-Gitea-Event` | `issues`, `issue_comment` |
| Forgejo | `X-Forgejo-Event` | Same as Gitea |
| Gogs | `X-Gogs-Event` | `push`, `issues`, `issue_comment` |
| GitLab SM | `X-Gitlab-Event` | `Issue Hook`, `Merge Request Hook`, `Note Hook` |
| Bitbucket DC | `X-Event-Key` | `pr:opened`, `repo:refs_changed` |
| Azure DevOps | `eventType` (in body) | `ms.vss.work.workitem.created` |

---

## Appendix B: Adapter Interface Sketch

```typescript
// Core domain types (platform-agnostic)
interface InboundEvent {
  id: string;
  platform: string;
  eventType: 'item.created' | 'item.updated' | 'comment.created' | 'comment.updated';
  itemId: string;
  itemExternalUrl: string;
  authorId: string;
  authorUsername: string;
  title?: string;
  body?: string;
  labels?: string[];
  status?: string;
  createdAt: string;
  updatedAt: string;
}

interface OutboundCapability {
  createItem: boolean;
  postComment: boolean;
  editComment: boolean;
  deleteComment: boolean;
  updateStatus: boolean;
  updateLabels: boolean;
  setAssignee: boolean;
  mentionUser: boolean;
  attachFile: boolean;
}

// Adapter registry
const ADAPTERS: Record<string, () => GitServerAdapter> = {
  gitea: () => new GiteaAdapter(config),
  forgejo: () => new ForgejoAdapter(config),    // Delegates to Gitea
  gogs: () => new GogsAdapter(config),
  gitlab_sm: () => new GitLabAdapter(config),
  bitbucket_dc: () => new BitbucketDCAdapter(config),
  azure_devops: () => new AzureDevOpsAdapter(config),
};

// Connector initialization
function createConnector(config: CustomGitServerConfig): GitServerAdapter {
  const adapterFactory = ADAPTERS[config.platform];
  if (!adapterFactory) {
    throw new Error(`Unsupported platform: ${config.platform}. Supported: ${Object.keys(ADAPTERS).join(', ')}`);
  }
  return adapterFactory();
}
```

---

## Appendix C: Quick Reference Card

| Aspect | Gitea/Forgejo | Gogs | GitLab SM | Azure DevOps |
|---|---|---|---|---|
| **Auth header** | `Authorization: token {token}` | `Authorization: token {token}` | `Authorization: Bearer {token}` | `Authorization: Basic {base64(user:PAT)}` |
| **Webhook HMAC** | `X-Gitea-Signature: sha256=...` | `X-Gogs-Signature: sha256=...` | `X-Gitlab-Token: {plain}` (not HMAC) | `Authorization: HmacSHA256={base64}` |
| **Issue endpoint** | `POST /repos/{owner}/{repo}/issues` | Same | `POST /projects/{id}/issues` | `PATCH /{project}/_apis/wit/workitems?$type=Bug` |
| **Comment endpoint** | `POST /repos/{owner}/{repo}/issues/{index}/comments` | Same | `POST /projects/{id}/issues/{iid}/notes` | `POST /{project}/_apis/wit/workitems/{id}/comments` |
| **Rate limits** | None (configurable) | None | None (configurable) | None (configurable) |
| **User ID shape** | Integer | Integer | Integer | GUID |
| **Issue numbering** | `number` (per-repo) | `number` | `iid` (per-project) | `id` (global in project) |