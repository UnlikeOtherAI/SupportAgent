# GitHub Projects v2 Connector Design

> Research date: 2026-04-18. GitHub Projects v2 webhooks are in public preview and subject to change.

## 1. Overview

- **Category**: Project management / Issue tracking
- **Cloud vs self-hosted**: Cloud only (GitHub.com). Projects v2 webhooks are not available for GitHub Enterprise Server (GHES).
- **Official API reference**:
  - GraphQL: https://docs.github.com/en/graphql
  - REST (limited): https://docs.github.com/rest/projects-v2

### Classic Projects vs Projects v2

| Aspect | Classic Projects (deprecated) | Projects v2 (current) |
|--------|------------------------------|----------------------|
| API | REST only | GraphQL primary, REST limited |
| Custom fields | Fixed (assignee, milestone, labels, due date) | Text, number, date, single-select, iteration, assignees, labels, milestone |
| Item types | Issues + PRs | Draft issues, Issues, PRs |
| Views | Board, table | Board, table, roadmap |
| Status | Columns (fixed) | Single-select custom field |
| Availability | Deprecated, still functional | Current product |
| Webhooks | `project_card`, `project_column`, `project` | `projects_v2`, `projects_v2_item` (org-level only) |

**This document covers Projects v2 only.** Classic Projects endpoints are deprecated and will be removed.

---

## 2. Authentication

### Supported Mechanisms

#### Personal Access Token (PAT)

- **Obtain**: GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens or Classic tokens
- **Header**: `Authorization: Bearer <token>` (GraphQL) or `Authorization: token <token>` (REST)
- **Required scopes** (fine-grained PATs):
  - Read items: `organization_projects: read` or `repository_projects: read`
  - Write items: `organization_projects: write` or `repository_projects: write`
  - For organization-level projects: `organization_projects` permission
  - For repository-linked projects: `repository_projects` permission
- **Token lifetime**: User-defined (classic: 30 days / 1 year; fine-grained: 30-365 days)
- **Recommendation for MVP**: PAT with `organization_projects: write` scope

#### GitHub App

- **Obtain**: GitHub App registration with required permissions
- **Header**: `Authorization: Bearer <installation_access_token>` (via JWT flow)
- **Required permissions**:
  - Organization projects: `organization_projects: read` / `write`
  - Repository projects: `repository_projects: read` / `write`
  - Content (for issues/PRs): `contents: read`
- **Token lifetime**: Installation access tokens expire after 1 hour; auto-refresh via SDK
- **Recommendation for Phase 2+**: GitHub App for multi-tenant, per-installation access

#### OAuth App

- **Header**: `Authorization: Bearer <oauth_token>`
- **Scopes**: `repo` (full), `read:project`, `write:project` (public-only)
- **Note**: OAuth app scopes for Projects are limited; prefer PAT or GitHub App

### Webhook Authentication

- **HMAC verification**: HMAC-SHA256
- **Header**: `X-Hub-Signature-256` (format: `sha256=<hex_digest>`)
- **Verification**: Compute HMAC of raw payload with webhook secret; compare using constant-time comparison
- **Legacy header**: `X-Hub-Signature` (HMAC-SHA1) — supported but not recommended

### Recommendation for SupportAgent MVP

**Use fine-grained PATs** with `organization_projects: write` scope. GitHub Apps add complexity (JWT exchange, installation tokens) and are only needed for:
- Acting on behalf of multiple organizations
- Avoiding per-user token management
- Accessing private repos without user context

---

## 3. Inbound — Events and Intake

### Webhook Support

- **Yes**: `projects_v2` and `projects_v2_item` events (organization-level only)
- **No webhook support for user-level projects** — must poll

### Webhook Events

#### `projects_v2`

| Action | Description |
|--------|-------------|
| `created` | New project created |
| `edited` | Project settings changed |
| `closed` | Project closed |
| `reopened` | Project reopened |
| `deleted` | Project deleted |

#### `projects_v2_item`

| Action | Description |
|--------|-------------|
| `created` | Item added to project |
| `edited` | Item field value changed |
| `archived` | Item archived |
| `restored` | Item restored from archive |
| `converted` | Draft issue converted to issue |
| `deleted` | Item removed from project |
| `reordered` | Item position changed |

### Payload Structure

```json
{
  "action": "created",
  "projects_v2_item": {
    "id": "PVTI_1234567890",
    "database_id": 12345,
    "type": "ISSUE",
    "is_archived": false
  },
  "changes": {
    "field": {
      "field_id": "PVTFSL_xxx",
      "field_name": "Status",
      "was": "Backlog",
      "is_now": "In Progress"
    }
  },
  "organization": { "login": "org", "id": 12345 },
  "sender": { "login": "username", "id": 67890 },
  "installation": { "id": 123456 }
}
```

### Payload Fields to Persist

| Field | Source | Notes |
|-------|--------|-------|
| `id` | `projects_v2_item.id` | Global ID (use for API calls) |
| `database_id` | `projects_v2_item.database_id` | Numeric ID |
| `type` | `projects_v2_item.type` | `DRAFT_ISSUE`, `ISSUE`, `PULL_REQUEST` |
| `is_archived` | `projects_v2_item.is_archived` | |
| `project_id` | `projects_v2_item.project_id` or from URL | |
| `content_id` | Nested in content object | Issue/PR/draft issue ID |
| `content_type` | Nested in content object | e.g., "Issue" |
| `content_title` | Nested in content object | |
| `content_number` | Nested in content object | Issue/PR number (null for draft) |
| `content_url` | Nested in content object | REST URL for content |
| `changes` | `changes` object | Field change details |
| `sender` | `sender.login` | Actor who triggered event |

### Webhook Gotchas

1. **Organization-level only**: `projects_v2` and `projects_v2_item` webhooks only fire for organization-owned projects. User-owned projects have no webhooks.
2. **Public preview**: These webhook events are in public preview; schema may change.
3. **No per-item field values in webhook**: The webhook payload does not include full field values; must fetch via GraphQL after receiving event.
4. **Missing content details**: Payload includes item ID but not full content details (title, body, author, labels); must query separately.
5. **No `assigned` event for items**: GitHub Projects v2 items don't have a separate assignment webhook; listen to `issues.assigned` for issue assignee changes.

### Polling Fallback

Required for:
- User-level projects (no webhooks)
- Fetching full item details after webhook
- Reconciliation

**GraphQL query for recent items**:

```graphql
query OrganizationProjects($org: String!, $first: Int, $after: String) {
  organization(login: $org) {
    projectsV2(first: $first, after: $after) {
      nodes {
        id
        title
        items(first: 100) {
          nodes {
            id
            type
            isArchived
            content {
              ... on Issue {
                id
                number
                title
                assignees(first: 10) { nodes { login } }
                labels(first: 20) { nodes { name } }
              }
              ... on PullRequest {
                id
                number
                title
              }
            }
            fieldValues(first: 10) {
              nodes {
                field { ... on ProjectV2FieldConfiguration { name } }
                value
              }
            }
          }
        }
      }
    }
  }
}
```

**Cursor strategy**: Store `pageInfo.endCursor` from each query. Poll with `after: <last_cursor>` and `first: 100`. Filter by `updatedAt` in application code.

---

## 4. Outbound — Writing Back

### GraphQL-Only API

Projects v2 is **primarily a GraphQL API**. The REST API is extremely limited (list/get projects only).

### Key Mutations

#### Create Draft Issue

```graphql
mutation AddProjectV2DraftIssue($input: AddProjectV2DraftIssueInput!) {
  addProjectV2DraftIssue(input: $input) {
    projectItem {
      id
      type
    }
  }
}

# Variables
{
  "input": {
    "projectId": "PVT_kwHOADBzBc4AAAABJmFxYg",
    "title": "Draft issue title",
    "body": "Draft issue body",
    "assigneeIds": ["MDQ6VXNlcjY3ODkw"]  // optional
  }
}
```

#### Add Existing Issue/PR to Project

```graphql
mutation AddProjectV2ItemById($input: AddProjectV2ItemByIdInput!) {
  addProjectV2ItemById(input: $input) {
    item {
      id
    }
  }
}

# Variables
{
  "input": {
    "projectId": "PVT_kwHOADBzBc4AAAABJmFxYg",
    "contentId": "I_kwDOGvty8s5M"
  }
}
```

#### Set Field Value

```graphql
mutation SetIssueFieldValue($input: SetIssueFieldValueInput!) {
  setIssueFieldValue(input: $input) {
    projectV2Item {
      id
    }
  }
}

# Variables for single-select
{
  "input": {
    "issueId": "PVTI_xxx",
    "issueField": {
      "fieldId": "PVTSSF_xxx",
      "singleSelectOptionId": "PVTF_xxx"
    }
  }
}

# Variables for text field
{
  "input": {
    "issueId": "PVTI_xxx",
    "issueField": {
      "fieldId": "PVTF_xxx",
      "textValue": "Some text"
    }
  }
}
```

#### Clear Field Value

```graphql
mutation ClearProjectV2ItemFieldValue($input: ClearProjectV2ItemFieldValueInput!) {
  clearProjectV2ItemFieldValue(input: $input) {
    projectV2Item {
      id
    }
  }
}

# Variables
{
  "input": {
    "projectId": "PVT_xxx",
    "itemId": "PVTI_xxx",
    "fieldId": "PVTF_xxx"
  }
}
```

#### Archive/Unarchive Item

```graphql
mutation ArchiveProjectV2Item($input: ArchiveProjectV2ItemInput!) {
  archiveProjectV2Item(input: $input) {
    item {
      id
      isArchived
    }
  }
}
```

#### Convert Draft Issue to Issue

```graphql
mutation ConvertDraftIssueToIssue($input: ConvertProjectV2DraftIssueItemToIssueInput!) {
  convertProjectV2DraftIssueItemToIssue(input: $input) {
    item {
      id
      type
      content {
        ... on Issue {
          id
          number
        }
      }
    }
  }
}
```

### REST API (Limited)

The REST API for Projects v2 is minimal:

| Endpoint | Method | Use |
|----------|--------|-----|
| `GET /orgs/{org}/projects/{project_id}` | GET | Get project details |
| `GET /orgs/{org}/projects` | GET | List organization projects |
| `PATCH /orgs/{org}/projects/{project_id}` | PATCH | Update project (title, public, closed) |
| `DELETE /orgs/{org}/projects/{project_id}` | DELETE | Delete project |

**Note**: REST API does NOT support:
- Adding items to projects
- Setting field values
- Creating draft issues

**Use GraphQL for all item operations.**

---

## 5. Labels, Flags, Fields, Priorities

### Built-in Field Types

| Field Type | GraphQL Type | Can Set Value |
|------------|--------------|---------------|
| Title | Built-in | Read-only |
| Assignees | `ProjectV2ItemFieldUserValue` | Yes (via assigneeIds) |
| Labels | `ProjectV2ItemFieldLabelValue` | Yes (via `addLabelsToLabelable`) |
| Milestone | `ProjectV2ItemFieldMilestoneValue` | Yes (via `setMilestone`) |
| Status | `ProjectV2ItemFieldSingleSelectValue` | Yes |
| Due Date | `ProjectV2ItemFieldDateValue` | Yes |
| Priority | Custom single-select | Yes |
| Severity | Custom single-select | Yes |
| Estimate | Custom number field | Yes |

### Custom Fields (GraphQL)

#### Querying Fields

```graphql
query GetProjectFields($projectId: ID!) {
  node(id: $projectId) {
    ... on ProjectV2 {
      fields(first: 20) {
        nodes {
          ... on ProjectV2FieldConfiguration {
            id
            name
            dataType
          }
          ... on ProjectV2SingleSelectFieldConfiguration {
            id
            name
            dataType
            options {
              id
              name
              color
            }
          }
          ... on ProjectV2IterationFieldConfiguration {
            id
            name
            dataType
            iterations {
              id
              title
              duration
              startDate
            }
          }
        }
      }
    }
  }
}
```

#### Field Data Types

| `dataType` enum | Description |
|-----------------|-------------|
| `TEXT` | Free-form text |
| `NUMBER` | Numeric value |
| `DATE` | Date picker |
| `SINGLE_SELECT` | Dropdown with options |
| `ITERATION` | Time-based iteration (sprints) |
| `TRUTHY` | Boolean (checkbox) |
| `ASSIGNEE` | User picker |
| `LABEL` | Label picker |
| `MILESTONE` | Milestone picker |

### Status Model

- **No built-in status**: Status is implemented as a custom single-select field
- **Naming varies**: Projects can name the status field anything (e.g., "Status", "Sprint Status", "Pipeline")
- **Querying available statuses**: Must fetch the single-select field configuration to get options

### Priority/Severity Model

- No built-in priority or severity fields
- Must create custom single-select fields ("Priority", "Severity") with options
- Options have `id` (used for updates) and `name` (human-readable)

### Listing Available Values

```graphql
# Get status field options
query GetProjectFields($projectId: ID!) {
  node(id: $projectId) {
    ... on ProjectV2 {
      fields(first: 50) {
        nodes {
          ... on ProjectV2SingleSelectFieldConfiguration {
            id
            name
            options {
              id
              name
              color
            }
          }
        }
      }
    }
  }
}
```

---

## 6. Triggers We Can Match On

From inbound webhook payloads and GraphQL queries:

### Available Trigger Conditions

| Trigger | Source | Notes |
|---------|--------|-------|
| Item added to project | `projects_v2_item.action == "created"` | |
| Item field changed | `projects_v2_item.action == "edited"` | See `changes` object |
| Item archived | `projects_v2_item.action == "archived"` | |
| Draft issue converted | `projects_v2_item.action == "converted"` | |
| Item deleted | `projects_v2_item.action == "deleted"` | |
| Issue/PR created | `issues.opened`, `pull_request.opened` | Combined with project check |
| Issue/PR closed | `issues.closed`, `pull_request.closed` | Combined with project check |
| Label added/removed | `issues.labeled`, `issues.unlabeled` | Combined with project check |
| Assignee added/removed | `issues.assigned`, `issues.unassigned` | Combined with project check |

### Field Change Detection

The `changes` object in `projects_v2_item.edited` events:

```json
{
  "changes": {
    "field": {
      "field_id": "PVTSSF_xxx",
      "field_name": "Status",
      "was": "Backlog",
      "is_now": "In Progress"
    }
  }
}
```

### Field Value Queries

For full field values, query after webhook:

```graphql
query GetItemFieldValues($itemId: ID!) {
  node(id: $itemId) {
    ... on ProjectV2Item {
      fieldValues(first: 20) {
        nodes {
          field { ... on ProjectV2FieldConfiguration { name } }
          ... on ProjectV2ItemFieldSingleSelectValue {
            name
            field { ... on ProjectV2SingleSelectFieldConfiguration { name } }
          }
          ... on ProjectV2ItemFieldTextValue {
            text
            field { ... on ProjectV2FieldConfiguration { name } }
          }
        }
      }
    }
  }
}
```

### Limitations

- **Regex on body**: No webhook fires on body edit. Must poll or check on `projects_v2_item.edited`.
- **No field-specific webhooks**: Cannot subscribe to only status changes; all item edits fire `projects_v2_item.edited`.
- **No per-field webhooks**: Must filter in application code.

---

## 7. Identity Mapping

### User ID Shape

| ID Type | Format | Example |
|---------|--------|---------|
| Global ID (GID) | Base64-encoded type+ID | `MDQ6VXNlcjY3ODkw` |
| Numeric ID | Integer | `67890` |
| Login | String (username) | `octocat` |

Global IDs are URL-safe Base64. Decode: `atob("MDQ6VXNlcjY3ODkw")` → `User:67890`.

### Resolving User Identity

```graphql
query GetUser($userId: ID!) {
  node(id: $userId) {
    ... on User {
      login
      name
      email
      avatarUrl
    }
  }
}
```

Note: **Email requires `user:email` scope** and may be null if user hasn't made it public.

### Bot Identity

- **GitHub App bots**: Sender type is `Bot`; `sender.login` is `app[bot]` format
- **Detection**: Check `sender.type == "Bot"` or `sender.login.startsWith("app[bot]")`
- **No-self-retrigger**: Store the GitHub App's `installation_id` and compare against `installation.id` in payload

### Author Field on Posted Items

- **When creating draft issues**: No separate author field; bot becomes the author
- **When adding existing issues**: Author remains the original issue author
- **Bot identification**: The `sender` field on webhook indicates who performed the action

---

## 8. Rate Limits

### GraphQL API (Primary)

| Limit Type | Standard | Enterprise |
|------------|----------|------------|
| Points per hour | 5,000 | 10,000 |
| Points per minute | 2,000 | (not specified) |
| Concurrent requests | 100 (shared) | 100 (shared) |
| CPU time | 90s per 60s | (not specified) |

**Point calculation**: Each connection field = 1 request. Divide total by 100, round up (min 1 point).

Example: Fetching project with 10 items, each with 5 fields = ~55 points per query.

### REST API (Limited Use)

| Limit Type | Authenticated |
|------------|---------------|
| Requests per hour | 5,000 |
| Concurrent | 100 (shared) |

### Headers

```
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4999
X-RateLimit-Reset: 1713465600
X-RateLimit-Used: 1
X-RateLimit-Resource: graphql
```

### Retry Semantics

1. **On primary limit (rate limit exhausted)**: Wait until `X-RateLimit-Reset` epoch seconds
2. **On secondary limit (CPU/timeout)**: Check `Retry-After` header; exponential backoff

### Optimization Strategies

1. **Fetch only needed fields**: Avoid `*` queries
2. **Limit pagination**: Use `first: 100` max; paginate as needed
3. **Batch queries**: Combine multiple queries in single request
4. **Cache field metadata**: Cache project field configurations; refresh hourly

---

## 9. Pagination & Search

### GraphQL Cursor Pagination

All connections use cursor-based pagination:

```graphql
{
  organization(login: "myorg") {
    projectsV2(first: 100, after: "Y3Vyc29yOnYyOpK5") {
      nodes { id title }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
```

**Parameters**:
- `first: Int` — Forward pagination (use `after`)
- `last: Int` — Backward pagination (use `before`)
- `after: String` — Cursor from previous `pageInfo.endCursor`
- `before: String` — Cursor for backward pagination

### Search

No native search on Projects v2. Use GitHub Search API for issues/PRs:

```graphql
query SearchIssues($query: String!) {
  search(query: $query, type: ISSUE, first: 100) {
    nodes {
      ... on Issue {
        id
        number
        title
        projectsV2(first: 10) {
          nodes { id title }
        }
      }
    }
  }
}
```

---

## 10. Known Gotchas

### Cloud-Only Limitations

1. **No webhook for user projects**: Only organization-level projects have `projects_v2` and `projects_v2_item` webhooks
2. **No GHES support**: Projects v2 webhooks unavailable on GitHub Enterprise Server
3. **No Projects v2 REST for items**: REST only covers project CRUD; item operations require GraphQL

### Webhook Limitations

1. **Missing full payload**: `projects_v2_item` webhook doesn't include full field values or content details
2. **No per-field webhooks**: Cannot subscribe to specific field changes; receive all `edited` events
3. **Preview API**: Webhook schema may change; handle unknown fields gracefully
4. **No `item.edited` for assignees/labels**: Must listen to `issues.*` and `pull_request.*` events separately

### Eventual Consistency

1. **Webhook delay**: Events may arrive 1-30 seconds after action
2. **API staleness**: Immediate post-webhook API calls may return stale data; add retry with backoff

### API Quirks

1. **Global IDs everywhere**: All IDs are Base64-encoded GIDs; cannot use numeric IDs in GraphQL
2. **Field type unions**: Must use inline fragments (`... on ProjectV2SingleSelectFieldConfiguration`)
3. **No bulk mutations**: Each item operation is a separate mutation

### Multi-Tenant Considerations

1. **Per-organization PATs required**: Fine-grained PATs are scoped to specific organizations
2. **GitHub App installations**: One app installation per organization; manage tokens per installation
3. **No cross-org queries**: Cannot query multiple organizations in single GraphQL request

---

## 11. Recommended SupportAgent Connector Scope

### MVP (Minimum Viable Product)

**Endpoints to wrap** (GraphQL):

```graphql
# Queries
organization(login: $org).projectsV2(first: 100)
node(id: $projectId)  # Get project details
node(id: $itemId)      # Get item with fieldValues

# Mutations
addProjectV2DraftIssue
addProjectV2ItemById
setIssueFieldValue
clearProjectV2ItemFieldValue
archiveProjectV2Item
unarchiveProjectV2Item
```

**Webhook events to handle**:
- `projects_v2_item.created` — New item added
- `projects_v2_item.edited` — Field value changed
- `projects_v2_item.archived` / `.restored`
- `issues.opened` / `issues.closed` (for issue tracking)
- `issues.labeled` / `issues.unlabeled`

**Minimum config fields**:
- `owner` (organization or user login)
- `projectId` (ProjectV2 GID)
- `githubToken` (PAT with `organization_projects: write` scope)
- `webhookSecret` (for HMAC verification)
- `fieldMappings` (map SupportAgent fields to ProjectV2 fields by name/ID)

**Trigger matchers**:
- Item added to project
- Field value changed (specific field)
- Field value set to specific option (status = "In Progress")
- Item archived/restored

### Phase 2 (Parity with GitHub Connector)

**Additional endpoints**:
- `convertProjectV2DraftIssueItemToIssue` — Convert draft to issue
- `deleteProjectV2Item` — Remove item from project
- Full issue/PR query support for content details

**Additional webhooks**:
- `pull_request.opened` / `closed`
- `pull_request.merged`
- `issues.assigned` / `issues.unassigned`

**Additional triggers**:
- Issue/PR linked to project
- Assignee changed (via `issues.assigned`)
- Label changed (via `issues.labeled`)

**Delivery operations**:
- Post comment on linked issue (via GitHub Issues connector)
- Add labels to issue (via `addLabelsToLabelable`)

### Phase 3 (Advanced)

- GitHub App authentication for multi-org support
- Custom field creation (`createProjectV2Field`)
- Iteration field management
- Status update creation (`createProjectV2StatusUpdate`)
- Project template management
- Cross-project queries for reporting

---

## 12. Dependencies

### Official SDKs

| Package | npm | Use |
|---------|-----|-----|
| `@octokit/graphql` | https://www.npmjs.com/package/@octokit/graphql | GraphQL client (recommended) |
| `@octokit/graphql-schema` | https://www.npmjs.com/package/@octokit/graphql-schema | TypeScript types |
| `@octokit/rest` | https://www.npmjs.com/package/@octokit/rest | REST API (limited use) |
| `@octokit/app` | https://www.npmjs.com/package/@octokit/app | GitHub App JWT handling |

### Recommendation

**Use `@octokit/graphql`** for all Projects v2 operations because:

1. **Built for GitHub**: Handles authentication, rate limits, error handling
2. **TypeScript support**: Generated types from schema
3. **Variable injection**: Safer than template literals
4. **Enterprise support**: `baseUrl` config for GHES

**Avoid raw `fetch`**: GraphQL bodies are verbose; SDK handles serialization, headers, and errors.

### GitHub CLI Parity

GitHub CLI (`gh`) does **not** have native Projects v2 commands. The `gh project` CLI is limited to Projects (classic). No parity needed with `@support-agent/github-cli`.

---

## 13. Open Questions

1. **Cloud vs Enterprise**: Will all tenants use GitHub.com cloud, or do we need GHES support? GHES lacks Projects v2 webhooks.

2. **Organization vs User projects**: Are all target projects organization-level (for webhooks), or do we need user project support (requires polling)?

3. **GitHub App vs PAT**: Should MVP use PATs (simpler) or GitHub Apps (better for multi-tenant)?

4. **Field name stability**: Projects can rename custom fields. Should we use field names or field IDs for mappings? (IDs are stable but require extra queries.)

5. **Status field detection**: Status is a custom single-select field. How should we auto-detect which field is "status" for workflow operations?

6. **Webhook reliability**: GitHub webhook delivery is at-least-once. Do we need idempotency handling for `edited` events?

7. **Multi-project support**: Can one SupportAgent workspace connect to multiple Projects v2 in the same org?

8. **Issue vs Draft Issue creation**: Should MVP support creating draft issues only, or also linking existing issues?

---

## Appendix: Quick Reference

### GraphQL Endpoint

```
POST https://api.github.com/graphql
Authorization: Bearer <token>
Content-Type: application/json
```

### Node IDs (Global IDs)

```typescript
// Decode GID to type and numeric ID
function decodeGid(gid: string): { type: string; id: number } {
  const decoded = Buffer.from(gid, 'base64').toString('utf-8');
  const [type, id] = decoded.split(':');
  return { type, id: parseInt(id, 10) };
}

// Encode numeric ID to GID
function encodeGid(type: string, id: number): string {
  return Buffer.from(`${type}:${id}`).toString('base64');
}
```

### Rate Limit Headers

```
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4999
X-RateLimit-Reset: 1713465600
X-RateLimit-Used: 1
```

### Webhook Headers

```
X-Hub-Signature-256: sha256=abc123...
X-Hub-Signature: sha1=def456...  # legacy
X-GitHub-Event: projects_v2_item
X-GitHub-Delivery: 72d3162e-cc78-11e3-81ab-4c9367dc0958
X-GitHub-Enterprise-Host: github.mycompany.com  # if GHES
```

### Common Field DataTypes

```graphql
enum ProjectV2FieldType {
  TEXT
  NUMBER
  DATE
  SINGLE_SELECT
  ITERATION
  TRUTHY
  ASSIGNEE
  LABEL
  MILESTONE
}
```

### Item Types

```graphql
enum ProjectV2ItemType {
  DRAFT_ISSUE
  ISSUE
  PULL_REQUEST
  REDACTED
}
```
