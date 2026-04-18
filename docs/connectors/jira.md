# Jira Connector Design Document

**Platform:** Atlassian Jira
**Version:** 1.0
**Last Updated:** 2026-04-18

---

## 1. Overview

- **Category:** Issue Tracker / Project Management
- **Cloud Availability:** Yes (Jira Cloud)
- **Self-Hosted Availability:** Yes (Jira Data Center / Server)
- **Official API Reference:**
  - Cloud: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
  - Data Center: https://docs.atlassian.com/jira-software/REST/latest/ (redirects to Data Center docs)

### Jira Cloud vs Data Center Summary

| Feature | Jira Cloud | Jira Data Center |
|---------|------------|------------------|
| API Version | REST API v3 | REST API v8+ |
| Authentication | API Token, OAuth 2.0, Connect JWT | Basic Auth, PAT, OAuth 2.0 |
| Webhooks | Yes (native) | Yes (native) |
| Rate Limits | Yes (points-based) | No |
| Forge Apps | Yes | No |
| Connect Apps | Yes | No |

---

## 2. Authentication

### 2.1 Jira Cloud Authentication Methods

#### API Token (Recommended for MVP)

- **How to obtain:** https://id.atlassian.com/manage-profile/security/api-tokens
- **Format:** `Authorization: Basic base64(email:api_token)`
- **Example:**
  ```bash
  curl -X GET "https://your-domain.atlassian.net/rest/api/3/issue/PROJ-1" \
    -H "Authorization: Basic $(echo -n 'email@example.com:api_token' | base64)"
  ```
- **Required scopes for operations:**
  | Operation | Classic Scope | Granular Scope |
  |-----------|---------------|----------------|
  | Read issues | `read:jira-work` | `read:issue:jira` |
  | Read comments | `read:jira-work` | `read:comment:jira` |
  | Create/edit issues | `write:jira-work` | `write:issue:jira` |
  | Post comments | `write:jira-work` | `write:comment:jira` |
  | Manage webhooks | `manage:jira-configuration` | `manage:webhook:jira` |
  | Read projects | `read:jira-work` | `read:project:jira` |
  | Search users | `read:jira-user` | `read:user:jira` |

- **Token lifetime:** Tokens do not expire but can be revoked by user
- **MVP Recommendation:** API Token — simplest integration, no OAuth callback setup required

#### OAuth 2.0 (Authorization Code Grant)

- **Classic scopes** (recommended): `manage:jira-configuration`, `read:jira-work`, `write:jira-work`
- **Granular scopes:** Fine-grained `read:*/write:*/manage:*` per resource
- **Token lifetime:**
  - Access token: 1 hour
  - Refresh token: 90 days (until revoked)
- **Required for:** User impersonation, per-user webhooks

#### Atlassian Connect JWT

- **Used by:** Connect apps (marketplace apps)
- **Token format:** `Authorization: JWT <jwt_token>`
- **Claims required:**
  - `iss` (issuer) — app key
  - `iat` (issued at) — Unix timestamp
  - `exp` (expiration) — Unix timestamp (max 3 minutes from iat)
  - `qsh` (query string hash) — prevents URL tampering
- **QSH calculation:** `HMAC-SHA256(method&uri&query_string)`
- **Note:** Complex to implement; avoid unless building a marketplace app

#### Atlassian Forge

- **Purpose:** Serverless app platform (Atlassian's recommended approach)
- **Authentication:** Built-in API authentication via `api.asApp()` or `api.asUser()`
- **Difference from Connect:** Runs in isolated tenant-secured container, stricter egress controls
- **Not recommended** for external integrations — designed for UI plugins

### 2.2 Jira Data Center Authentication

- **Personal Access Token (PAT):** Recommended for scripts/bots
  ```bash
  curl -X GET "https://dc-server.com/rest/api/3/issue/PROJ-1" \
    -H "Authorization: Bearer <pat_token>"
  ```
- **Basic Auth:** Only for scripts/bots (username:password)
- **OAuth 2.0:** Available
- **OAuth 1.0a:** Deprecated

---

## 3. Inbound — Events and Intake

### 3.1 Webhook Support

**Yes — native webhook system available**

#### Webhook Registration

**For admin-configured webhooks (recommended for external integrations):**
```
POST /rest/webhooks/1.0/webhook
```

```json
{
  "name": "SupportAgent Connector",
  "url": "https://your-endpoint.com/webhooks/jira",
  "events": [
    "jira:issue_created",
    "jira:issue_updated",
    "jira:issue_deleted",
    "comment_created",
    "comment_updated",
    "comment_deleted"
  ],
  "filters": {
    "issue-related-events-section": "project = SUPPORT"
  },
  "excludeBody": false,
  "secret": "your-webhook-secret"
}
```

**For OAuth/Connect apps:**
```
POST /rest/api/2/webhook
```

- **Limits:**
  - Connect apps: 100 webhooks per app per tenant
  - OAuth apps: 5 webhooks per app per user
- **Expiration:** 30 days, auto-extendable via API

#### Event Types

| Event Name | Description | Useful for SupportAgent |
|------------|-------------|------------------------|
| `jira:issue_created` | New issue created | Intake |
| `jira:issue_updated` | Issue field changed | Trigger matching |
| `jira:issue_deleted` | Issue deleted | Cleanup |
| `comment_created` | New comment | Two-way sync, intake |
| `comment_updated` | Comment edited | Two-way sync |
| `comment_deleted` | Comment removed | Two-way sync |
| `issuelink_created` | Issue linked | Context |
| `worklog_created` | Work logged | Tracking |
| `project_updated` | Project config changed | Admin alerts |

#### Signature Verification

- **Header:** `X-Hub-Signature` (format: `method=signature`)
- **Algorithm:** HMAC-SHA256
- **Secret provisioning:** Set `secret` field during webhook creation
- **Verification steps:**
  1. Extract signature method and value from header
  2. Compute HMAC of raw request body with your secret
  3. Compare using constant-time comparison

```
Example:
Secret: "It's a Secret to Everybody"
Payload: "Hello World!"
Method: sha256
Signature: sha256=a4771c39fbe90f317c7824e83ddef3caae9cb3d976c214ace1f2937e133263c9
```

#### Retry / Delivery Semantics

- **Retries:** Up to 5 retries with randomized back-off (5-15 minutes)
- **Trigger conditions:** HTTP 408, 409, 425, 429, 5xx, connection failures
- **Deduplication:** Use `X-Atlassian-Webhook-Identifier` header
- **Flow types:**
  - `Primary`: Within 30 seconds
  - `Secondary`: Within 15 minutes (cascade operations)
- **Concurrency limits:** 20 primary + 10 secondary webhooks per tenant/URL pair
- **Max payload:** 25MB

#### Polling Fallback Strategy

Use JQL with `ORDER BY updated` for reconciliation:

```
GET /rest/api/3/search/jql
  ?jql=updated >= '2024-01-01 00:00' ORDER BY updated ASC
  &fields=summary,status,priority,labels,assignee,comment
  &maxResults=100
  &startAt=0
```

- **Cursor strategy:** Use `updated` timestamp as cursor
- **Rate limit impact:** Minimize by using `updated >= lastSyncTimestamp` filter
- **Pagination:** `nextPageToken` for forward-only cursor pagination

### 3.2 Payload Fields to Persist

From webhook payloads and API responses:

```typescript
interface JiraIssue {
  id: string;           // Internal ID
  key: string;           // Human-readable key (e.g., "PROJ-123")
  self: string;          // API URL
  fields: {
    summary: string;     // Title
    description: object; // Atlassian Document Format (ADF)
    issuetype: { id: string; name: string };
    status: { id: string; name: string; statusCategory: {...} };
    priority: { id: string; name: string };
    labels: string[];
    assignee: User | null;
    reporter: User | null;
    created: string;     // ISO-8601
    updated: string;     // ISO-8601
    resolutiondate: string | null;
    [key: string]: any;  // Custom fields
  };
}

interface JiraComment {
  id: string;
  self: string;
  author: User;
  body: object;          // ADF format
  created: string;
  updated: string;
  visibility: { type: string; value: string };
}

interface User {
  accountId: string;    // Primary identifier (Cloud)
  displayName: string;
  emailAddress: string;  // May be hidden due to privacy
  active: boolean;
  avatarUrls: { [size: string]: string };
}
```

---

## 4. Outbound — Writing Back

### 4.1 Create Issue

```
POST /rest/api/3/issue
```

```json
{
  "fields": {
    "project": { "key": "SUPPORT" },
    "summary": "Issue title",
    "description": {
      "type": "doc",
      "version": 1,
      "content": [
        { "type": "paragraph", "content": [{ "type": "text", "text": "Description body" }] }
      ]
    },
    "issuetype": { "name": "Bug" },
    "priority": { "name": "High" },
    "labels": ["support-agent", "urgent"],
    "assignee": { "accountId": "abc123" }
  }
}
```

**Required:** `project.key`, `summary`, `issuetype.name`
**Optional:** Get available fields via `GET /rest/api/3/issue/createmeta`

### 4.2 Post Comment

```
POST /rest/api/3/issue/{issueIdOrKey}/comment
```

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "Comment with " },
          { "type": "mention", attrs: { "id": "accountId", "text": "@username" } },
          { "type": "text", "text": " mention" }
        ]
      }
    ]
  },
  "visibility": {
    "type": "role",
    "value": "Administrators"
  }
}
```

**Response:** 201 Created with Comment object

### 4.3 Edit Comment

```
PUT /rest/api/3/issue/{issueIdOrKey}/comment/{commentId}
```

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [...]
  }
}
```

### 4.4 Delete Comment

```
DELETE /rest/api/3/issue/{issueIdOrKey}/comment/{commentId}
```

**Response:** 204 No Content

### 4.5 Change Status / Transition

**Step 1 — Get available transitions:**
```
GET /rest/api/3/issue/{issueIdOrKey}/transitions
```

**Response:**
```json
{
  "transitions": [
    {
      "id": "3",
      "name": "To Do",
      "to": { "id": "10001", "name": "To Do" },
      "fields": { "priority": { "required": false } }
    },
    {
      "id": "4",
      "name": "Done",
      "to": { "id": "10002", "name": "Done" }
    }
  ]
}
```

**Step 2 — Transition issue:**
```
POST /rest/api/3/issue/{issueIdOrKey}/transitions
```

```json
{
  "transition": { "id": "3" },
  "fields": {
    "resolution": { "name": "Fixed" }
  },
  "update": {
    "comment": [
      {
        "add": {
          "body": "Marking as done"
        }
      }
    ]
  }
}
```

### 4.6 Add/Remove Labels

```
PUT /rest/api/3/issue/{issueIdOrKey}
```

```json
{
  "update": {
    "labels": [
      { "add": "new-label" },
      { "remove": "old-label" }
    ]
  }
}
```

### 4.7 Set Priority

```
PUT /rest/api/3/issue/{issueIdOrKey}
```

```json
{
  "fields": {
    "priority": { "id": "3" }
  }
}
```

Or by name:
```json
{
  "fields": {
    "priority": { "name": "High" }
  }
}
```

### 4.8 Assign User

```
PUT /rest/api/3/issue/{issueIdOrKey}
```

```json
{
  "fields": {
    "assignee": { "accountId": "abc123" }
  }
}
```

To unassign:
```json
{
  "fields": {
    "assignee": { "name": null }
  }
}
```

### 4.9 Mention User

In ADF body format:
```json
{
  "type": "mention",
  "attrs": {
    "id": "accountId-of-user",
    "text": "display-name"
  }
}
```

### 4.10 Close/Resolve Issue

Transition to a "Done" or "Resolved" status:
```
POST /rest/api/3/issue/{issueIdOrKey}/transitions
```

```json
{
  "transition": { "id": "<done-transition-id>" },
  "fields": {
    "resolution": { "name": "Fixed" }
  }
}
```

### 4.11 Attach File

```
POST /rest/api/3/issue/{issueIdOrKey}/attachments
Content-Type: multipart/form-data
X-Atlassian-Token: no-check
```

**Form field:** `file` (multipart file upload)
**Max size:** Check via `GET /rest/api/3/attachment/meta`
**Response:** 200 OK with array of Attachment objects

---

## 5. Labels, Flags, Fields, Priorities

### 5.1 Labels

- **Model:** Global label pool, freely addable to any issue
- **List all labels:**
  ```
  GET /rest/api/3/label?startAt=0&maxResults=50
  ```
- **Issue labels:** Stored in `labels` array on issue

### 5.2 Custom Fields

- **Per-project configuration:** Yes, via field configuration schemes
- **Field types supported:**
  - Text (single line)
  - Text area (multi-line, supports ADF)
  - Number
  - Select (single/multi)
  - Date/DateTime
  - User picker
  - Project picker
  - Version
  - Labels
  - Checkboxes
  - Radio buttons
  - Cascading select

- **List all fields:**
  ```
  GET /rest/api/3/field
  ```

- **List fields for project:**
  ```
  GET /rest/api/3/field/search?projectIds=10000,10001
  ```

- **Get create metadata:**
  ```
  GET /rest/api/3/issue/createmeta?projectKeys=SUPPORT&issuetypeNames=Bug
  ```

### 5.3 Status Model

- **Workflow-based:** Statuses are defined by workflows, not fixed values
- **Categories:** To Do, In Progress, Done
- **List all statuses:**
  ```
  GET /rest/api/3/status
  GET /rest/api/3/statuscategory
  ```

### 5.4 Priority Model

- **System priorities:** Defined per instance (typically: Highest, High, Medium, Low, Lowest)
- **List priorities:**
  ```
  GET /rest/api/3/priority
  ```
- **Set via:** `fields.priority` on issue (by id or name)

### 5.5 Severity Model

- Not built-in by default; implemented via custom field
- Typically a select field named "Severity" with values: Critical, Major, Minor, Trivial

---

## 6. Triggers We Can Match On

### 6.1 Supported Trigger Attributes

| Trigger Type | JQL Equivalent | Example |
|--------------|----------------|---------|
| Label add/remove | `labels was "foo"` / `labels was not "foo"` | Match on label changes |
| Status transition | `status was "Open"` | Match on status changes |
| Priority change | `priority changed` | Match on priority updates |
| Assignee change | `assignee was "user@example.com"` | Match on assignment |
| Project scope | `project = "SUPPORT"` | Filter by project |
| Issue type | `issuetype = "Bug"` | Filter by type |
| Mention | Match on `comment.body` containing mention ADF node | Detect @-mentions |
| Body regex | Match on `comment.body` text content | Pattern matching in comments |
| Created date | `created >= "-1d"` | New issues |
| Updated date | `updated >= "-1h"` | Recent changes |
| Custom field | `cf[12345] = "value"` | Match custom field values |
| Reporter | `reporter = "user@example.com"` | Filter by reporter |
| Expression | `issue.function()` | Advanced Jira Expressions |

### 6.2 Webhook JQL Filtering

Webhook registration supports JQL filters to reduce event volume:
```json
{
  "filters": {
    "issue-related-events-section": "project = SUPPORT AND priority in (High, Highest)"
  }
}
```

### 6.3 Event Field Availability

| Event | Available Fields |
|-------|------------------|
| `jira:issue_created` | Full issue object |
| `jira:issue_updated` | Issue object + `changelog` with changed fields |
| `comment_created` | Comment object + issue key |
| `comment_updated` | Comment object + issue key + changelog |

---

## 7. Identity Mapping

### 7.1 User ID Shape

- **Cloud:** `accountId` (Atlassian account ID, e.g., `712020:abc123...`)
- **Data Center:** `key` (e.g., `jira-username`) or `accountId` (if migrated)
- **Deprecated:** `username` field (removed from most endpoints in Cloud)

### 7.2 Resolve User Identity

```
GET /rest/api/3/user?accountId=712020:abc123...
```

```json
{
  "accountId": "712020:abc123-def456",
  "accountType": "atlassian",
  "displayName": "John Doe",
  "emailAddress": "john@example.com",  // May be hidden
  "active": true,
  "avatarUrls": { "48x48": "https://..." }
}
```

**Notes:**
- Email may be hidden based on user privacy settings
- `accountType` values: `atlassian` (regular user), `app` (bot/app user), `customer` (portal user in Jira Service Management)

### 7.3 Bot/System Identity

- **App users:** Have `accountType: "app"`
- **Detect our connector:** Use `author.accountId` from comment/issue payloads
- **External user (Jira Service Management):** `accountType: "customer"`

### 7.4 Our Authored Comments

When posting as the connector (API token auth):
- `author.accountId` = API token owner's account ID
- Comments appear as posted by that user

When using OAuth user context:
- Comments appear as posted by the authorized user

---

## 8. Rate Limits

### 8.1 Jira Cloud Rate Limits

**Three independent mechanisms:**

| Limit Type | Details |
|------------|---------|
| **Hourly Points** | Default: 65,000 points/hour globally |
| **Per-Second Burst** | GET: 100 RPS, POST: 100 RPS, PUT: 50 RPS, DELETE: 50 RPS |
| **Per-Issue Writes** | 20 writes/2 seconds, 100 writes/30 seconds per issue |

**Point costs (examples):**
- GET requests: ~1 point
- POST/PUT requests: ~10 points
- Bulk operations: ~10 points per item

### 8.2 Response Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642533600
X-RateLimit-NearLimit: false
RateLimit-Reason: jira-burst-based
Retry-After: 30
```

### 8.3 Retry Semantics

- On 429: Honor `Retry-After` header
- Use exponential backoff with jitter
- Scope awareness: quota errors block all calls; burst errors block that endpoint only

### 8.4 Jira Data Center

- **No rate limits** enforced

---

## 9. Pagination & Search

### 9.1 Pagination Style

**Offset-based with `startAt`:**
```
GET /rest/api/3/search?jql=project=SUPPORT&startAt=0&maxResults=50
```

**Response:**
```json
{
  "startAt": 0,
  "maxResults": 50,
  "total": 1234,
  "isLast": false,
  "values": [...]
}
```

**Cursor pagination (nextPageToken):**
```
GET /rest/api/3/search?jql=project=SUPPORT&startAt=0&maxResults=50&nextPageToken=eyJz...
```

### 9.2 Max Page Size

- Default: 50
- Maximum: 100

### 9.3 Search/Filter Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /rest/api/3/search/jql` | JQL search with field projection |
| `GET /rest/api/3/issue/{key}/changelog` | Full change history |
| `POST /rest/api/3/comment/list` | Get comments by IDs |
| `GET /rest/api/3/project/search` | List projects |
| `GET /rest/api/3/issue/createmeta` | Available fields for creation |

### 9.4 JQL Search

**Example — Issues updated since last sync:**
```
project = SUPPORT AND updated >= "2024-01-15 09:00" ORDER BY updated ASC
```

**Fields that can be searched:**
- Standard fields: `summary`, `description`, `status`, `priority`, `labels`, `created`, `updated`, `resolutiondate`
- User fields: `assignee`, `reporter`, `creator`
- Custom fields: `cf[12345]` or `customfield_12345`

---

## 10. Known Gotchas

### 10.1 Cloud vs Data Center Differences

- **API base:** Cloud uses `/rest/api/3`, Data Center may use `/rest/api/2` or `/rest/api/3`
- **Authentication:** Cloud supports API tokens and OAuth 2.0; Data Center uses PAT and Basic Auth
- **Rate limits:** Cloud only
- **Connect/Forge:** Cloud only
- **User identity:** Cloud uses `accountId`; Data Center may use `key`/`username`

### 10.2 User Identity Migration

- `username` field is deprecated in Cloud; use `accountId`
- Data Center still supports `key` for backward compatibility
- Email access requires `ACCESS_EMAIL_ADDRESSES` scope or admin

### 10.3 ADF Body Format

- Comments and descriptions use Atlassian Document Format (ADF)
- **Must be object format, not plain text:**
  ```json
  {
    "type": "doc",
    "version": 1,
    "content": [
      { "type": "paragraph", "content": [{ "type": "text", "text": "Hello" }] }
    ]
  }
  ```
- Single-line text fields (`textfield`) accept plain strings
- Multi-line text fields (`textarea`) accept ADF

### 10.4 Webhook Limitations

- Project deletion does not trigger `issue_deleted` webhooks
- Cascade operations delivered via Secondary flow (up to 15 minutes delay)
- Payloads >25MB are not delivered
- 30-day expiration requires renewal via API

### 10.5 API Quirks

- **Transitions:** Use dedicated `/transitions` endpoint, not `PUT /issue`
- **Bulk operations:** `POST /rest/api/3/issue/bulk` accepts max 50 issues
- **Attachments:** Require `X-Atlassian-Token: no-check` header (not a CSRF token)
- **Custom fields:** IDs vary per installation; use names or get via createmeta

### 10.6 Multi-Tenant Considerations

- Each tenant needs their own Jira Cloud instance URL
- OAuth apps: 5 webhook limit per user (may need admin webhooks)
- API tokens: One per user, tied to that user's permissions
- Webhook secrets: Generated per webhook, not per tenant globally

### 10.7 Visibility Restrictions

- Comments may have visibility restrictions (project role, group)
- User cannot see comments they don't have visibility for
- SupportAgent may need elevated permissions to see all comments

---

## 11. Recommended SupportAgent Connector Scope

### MVP (Minimum to Be Useful)

**Endpoints to wrap:**
- `GET /rest/api/3/search` — JQL search for polling
- `GET /rest/api/3/issue/{key}` — Get issue details
- `POST /rest/api/3/issue` — Create issue
- `PUT /rest/api/3/issue/{key}` — Update issue fields
- `GET /rest/api/3/issue/{key}/comment` — Get comments
- `POST /rest/api/3/issue/{key}/comment` — Add comment
- `PUT /rest/api/3/issue/{key}/comment/{id}` — Edit comment
- `GET /rest/api/3/issue/{key}/transitions` — Get available transitions
- `POST /rest/api/3/issue/{key}/transitions` — Transition issue
- `POST /rest/api/3/webhooks/1.0/webhook` — Register webhook
- `DELETE /rest/api/3/webhooks/1.0/webhook/{id}` — Remove webhook
- `GET /rest/api/3/issue/createmeta` — Get project metadata

**Webhook events to handle:**
- `jira:issue_created`
- `jira:issue_updated`
- `comment_created`
- `comment_updated`
- `comment_deleted`

**Trigger matchers to implement:**
- Label add/remove/exact
- Status transition (from/to)
- Issue type filter
- Project scope filter
- Assignee change
- Priority change

**Config fields required:**
- `baseUrl` — Jira Cloud instance URL (e.g., `https://company.atlassian.net`)
- `email` — Account email for API token
- `apiToken` — Jira API token
- `defaultProject` — Default project key for issue creation
- `webhookSecret` — Secret for signature verification
- `jqlFilter` — Optional JQL to filter webhook events

### Phase 2 (Parity with GitHub Connector)

**Additional endpoints:**
- `POST /rest/api/3/issue/bulk` — Bulk create
- `GET /rest/api/3/project/search` — List projects
- `GET /rest/api/3/user/search` — User search
- `GET /rest/api/3/priority` — List priorities
- `GET /rest/api/3/status` — List statuses
- `POST /rest/api/3/issue/{key}/attachments` — Upload attachments

**Additional trigger matchers:**
- Mention detection (in comment body)
- Comment body regex
- Custom field value matching
- Created/updated date ranges
- Reporter filter

**Delivery ops:**
- Mention users in comments
- Assign/unassign users
- Set priority
- Attach files
- Worklog (track time spent)

### Phase 3 (Advanced)

**Features unique to Jira:**
- Workflow-based automation (trigger on specific workflow transitions)
- Jira Expressions for complex matching
- Service Management portal integration (customer tickets)
- SLA calculation and tracking
- Project roles and permissions checking
- Issue links and relationships
- Sprint/Board integration (if Agile workflows needed)
- Audit log access for compliance

---

## 12. Dependencies

### 12.1 Official SDK

- **No official Atlassian SDK for Node.js/TypeScript**
- No `@atlassian/jira-sdk` or similar

### 12.2 Community SDKs

- **jira.js** (https://github.com/MrBomberman/jira.js)
  - TypeScript-first
  - Supports REST API v2 and v3
  - Active maintenance
  - **Recommended for MVP**

- **@x-ray/jira** — Older, less maintained

- **node-jira** — Legacy, v2 API only

### 12.3 Recommendation

**Use `jira.js` over raw `fetch`:**

Pros:
- Type-safe models for all entities
- Handles pagination utilities
- Automatic retry with backoff
- Covers v2 and v3 endpoints

Cons:
- Additional dependency
- May lag behind latest API changes

**For MVP with minimal dependencies:** Use raw `fetch` with typed response interfaces you define. This avoids SDK lag and keeps bundle size small.

### 12.4 No CLI Parity

Unlike GitHub's `gh` CLI, there is no official Jira CLI for integrations. However:
- **Atlassian CLI** (by Adaptavist) — Third-party, not official
- Not recommended for production integrations

---

## 13. Open Questions

1. **Hosting model:** Does the tenant use Jira Cloud or Jira Data Center?
   - If Data Center: Which version? (affects API compatibility)
   - If Cloud: Need to know if they have multiple sites/instances

2. **Authentication choice:**
   - API Token: Simpler MVP, tied to one user's permissions
   - OAuth 2.0: Per-user permissions, more complex setup
   - Recommend: Start with API Token, migrate to OAuth if needed

3. **Webhook registration:**
   - Admin webhooks (no OAuth): Who has admin access to register?
   - OAuth app webhooks: 5 limit per app per user — sufficient?

4. **User email access:**
   - Required for identity mapping?
   - Are user email addresses visible (not hidden by privacy)?

5. **Custom fields:**
   - Which custom fields exist in their projects?
   - Need to dynamically fetch via `createmeta` or static mapping?

6. **Workflow complexity:**
   - Simple workflows (To Do → In Progress → Done)?
   - Complex multi-step workflows with conditions?

7. **Jira Service Management vs Jira Software:**
   - Software: Internal project management
   - Service Management: Customer support portal with different user types

8. **Multi-project support:**
   - Single project or multiple projects need integration?
   - Different webhook configs per project?

9. **Outbound user identity:**
   - Should comments appear as SupportAgent bot or actual agent user?
   - Need to impersonate different agents?

10. **Rate limit tier:**
    - Free/standard Cloud tier: 65K points/hour
    - Enterprise: Higher limits available
    - Affects polling frequency and batch size

---

## Appendix A: Quick Reference — Minimal API Client

```typescript
// types.ts
interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, any>;
}

// Minimal client
class JiraClient {
  constructor(private config: JiraConfig) {}

  private authHeader(): string {
    const credentials = Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString('base64');
    return `Basic ${credentials}`;
  }

  async getIssue(key: string): Promise<JiraIssue> {
    const res = await fetch(`${this.config.baseUrl}/rest/api/3/issue/${key}`, {
      headers: { Authorization: this.authHeader() }
    });
    return res.json();
  }

  async search(jql: string, fields: string[] = ['summary', 'status']): Promise<{ issues: JiraIssue[] }> {
    const params = new URLSearchParams({ jql, fields: fields.join(','), maxResults: '50' });
    const res = await fetch(`${this.config.baseUrl}/rest/api/3/search?${params}`, {
      headers: { Authorization: this.authHeader() }
    });
    return res.json();
  }

  async addComment(issueKey: string, body: object): Promise<void> {
    await fetch(`${this.config.baseUrl}/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ body })
    });
  }
}
```

---

## Appendix B: Webhook Payload Example

```json
{
  "timestamp": 1642533600000,
  "webhookEvent": "jira:issue_updated",
  "user": {
    "accountId": "712020:abc123...",
    "displayName": "John Doe"
  },
  "issue": {
    "id": "10001",
    "key": "SUPPORT-123",
    "self": "https://company.atlassian.net/rest/api/3/issue/10001",
    "fields": {
      "summary": "Cannot login",
      "status": { "name": "In Progress" },
      "labels": ["urgent", "customer"]
    }
  },
  "changelog": {
    "id": "12345",
    "items": [
      {
        "field": "status",
        "fieldtype": "jira",
        "from": "10000",
        "fromString": "To Do",
        "to": "10001",
        "toString": "In Progress"
      }
    ]
  }
}
```

---

## Appendix C: Atlassian Document Format (ADF) Examples

**Simple text comment:**
```json
{
  "type": "doc",
  "version": 1,
  "content": [
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "Hello, world!" }]
    }
  ]
}
```

**Comment with mention:**
```json
{
  "type": "doc",
  "version": 1,
  "content": [
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "text": "Hi " },
        {
          "type": "mention",
          "attrs": { "id": "712020:abc123", "text": "@John" }
        },
        { "type": "text", "text": ", checking on this now." }
      ]
    }
  ]
}
```

**Comment with code block:**
```json
{
  "type": "doc",
  "version": 1,
  "content": [
    {
      "type": "codeBlock",
      "attrs": { "language": "javascript" },
      "content": [{ "type": "text", "text": "console.log('Hello');" }]
    }
  ]
}
```

---

**Sources:**
- [Jira Cloud REST API v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
- [Jira Webhooks](https://developer.atlassian.com/cloud/jira/platform/webhooks/)
- [Jira Rate Limiting](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)
- [Atlassian Connect JWT](https://developer.atlassian.com/cloud/jira/platform/understanding-jwt-for-connect-apps/)
- [Forge Platform](https://developer.atlassian.com/platform/forge/)
- [Jira Data Center REST API](http://docs.atlassian.com/jira-software/REST/latest/)
