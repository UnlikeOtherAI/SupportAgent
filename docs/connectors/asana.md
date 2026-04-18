# Asana Connector — Design Document

## 1. Overview

**Category:** Project Management / Issue Tracker

**Cloud vs Self-Hosted:** Cloud-only. Asana does not offer a self-hosted deployment option. There are two data residency regions: US (default) and EU.

**Official API Reference:** https://developers.asana.com/reference

**Base URL:**
- US: `https://app.asana.com/api/1.0`
- EU: `https://app.asana.com/api/1.0` (same path; data residency configured at workspace level)

**API Versioning:** URL path versioning (`/1.0/`). Current stable is 1.0.

---

## 2. Authentication

### 2.1 Supported Mechanisms

| Method | Use Case | Token Lifetime |
|--------|----------|----------------|
| Personal Access Token (PAT) | Testing, single-user scripts | Long-lived (no expiry) |
| OAuth 2.0 | Multi-user production apps | Access tokens: 1hr; Refresh tokens: 30 days |
| Service Account | Machine-to-machine, org-wide access (Enterprise) | Long-lived (no expiry) |

### 2.2 Token Transport

All methods use the `Authorization` header:

```
Authorization: Bearer <token>
```

### 2.3 Required Scopes

Scopes follow `<resource>:<action>` format. Actions do NOT inherit (write does NOT grant read).

| Scope | Permissions | Required For |
|-------|-------------|--------------|
| `tasks:read` | Read tasks, subtasks, dependencies, search | Listing/reading tasks, webhook payloads |
| `tasks:write` | Create, update, duplicate, manage subtasks | Creating tasks, updating fields, transitions |
| `tasks:delete` | Delete tasks | (Optional for SupportAgent) |
| `projects:read` | Read projects, custom field settings | Reading project context |
| `projects:write` | Create/update projects, templates | (Optional for MVP) |
| `stories:read` | Read stories/events on tasks and goals | Reading comments and activity |
| `stories:write` | Create and update stories on tasks | Posting comments |
| `webhooks:read` | List/retrieve webhook subscriptions | Webhook management |
| `webhooks:write` | Create/update webhooks | Registering webhooks |
| `users:read` | User profiles, workspaces, memberships | User lookup, email resolution |

**MVP Required Scopes:** `tasks:read`, `tasks:write`, `stories:read`, `stories:write`, `webhooks:write`, `users:read`

### 2.4 OAuth Flow Details

1. Register app in Asana Developer Console
2. Request authorization with `scope` parameter (URL-encoded, space-separated)
3. Exchange authorization code for access + refresh tokens
4. Refresh tokens before expiry (30-day window)

```
https://app.asana.com/-/oauth_authorize?
  client_id=<client_id>&
  response_type=code&
  redirect_uri=<callback>&
  scope=tasks:read%20tasks:write%20stories:read%20stories:write%20webhooks:write%20users:read
```

### 2.5 Service Account (Enterprise)

- Enterprise-only feature
- Provides org-wide access without user delegation
- Scopes configured at creation time
- Recommended for multi-tenant SupportAgent deployment

### 2.6 Recommendation for SupportAgent MVP

**PAT for initial development/testing.** Migrate to OAuth with Service Accounts for production multi-tenant deployment.

**Rationale:**
- PAT is simpler to implement initially
- Service Accounts (OAuth) provide better multi-tenant isolation
- PAT-based actions are attributed to the generating user (not ideal for bot operations)

---

## 3. Inbound — Events and Intake

### 3.1 Webhook Support

**Yes.** Asana supports webhooks for real-time event delivery.

### 3.2 Webhook Creation

```
POST https://app.asana.com/api/1.0/webhooks
Authorization: Bearer <token>
Content-Type: application/json

{
  "data": {
    "resource": "<workspace_gid_or_project_gid>",
    "target": "https://<your-endpoint>/webhooks/asana"
  }
}
```

**Required scope:** `webhooks:write`

### 3.3 Webhook Confirmation Handshake (Critical)

Asana uses a two-phase handshake:

1. After creating webhook, Asana sends a `POST` to your target with:
   - Header: `X-Hook-Secret` containing a secret string
2. Your endpoint MUST respond with:
   - Same `X-Hook-Secret` value in the response header
   - HTTP 200 or 204
3. If handshake not acknowledged, webhook creation fails

```typescript
// Webhook confirmation handler
app.post('/webhooks/asana', (req, res) => {
  if (req.headers['x-hook-secret']) {
    // First request: complete handshake
    res.set('X-Hook-Secret', req.headers['x-hook-secret']);
    res.sendStatus(200);
  }
});
```

### 3.4 Webhook Signature Verification

Asana does NOT use HMAC signatures on individual events. Instead:
- Webhook secret is established during handshake
- All subsequent requests from this webhook share that secret
- Verify by matching `X-Hook-Secret` header OR by re-registering webhook

**Note:** Asana docs mention HMAC but the actual implementation uses the handshake secret. Store the `X-Hook-Secret` value from the handshake response.

### 3.5 Webhook Retry Semantics

- Asana retries failed deliveries with exponential backoff
- If endpoint fails 3 times, webhook is automatically disabled
- Check `last_success_at`, `last_failure_at`, `last_failure_content` fields

### 3.6 Webhook Event Types

Asana does not send named event types. Instead, events are represented as **Stories** attached to resources.

**Story `type` values on tasks:**

| Story Type | Description | Useful For |
|------------|-------------|------------|
| `comment` | New comment posted | Inbound comments |
| `added_to_project` | Task added to project | Intake trigger |
| `removed_from_project` | Task removed from project | |
| `changed_status` | Status changed (workflow) | Status transition triggers |
| `marked_complete` | Task marked complete | Close trigger |
| `marked_incomplete` | Task reopened | |
| `assigned` | Assignee changed | Assignee triggers |
| `unassigned` | Assignee removed | |
| `added_follower` | Follower added | |
| `removed_follower` | Follower removed | |
| `renamed` | Task name changed | |
| `changed_description` | Description changed | |
| `changed_due_date` | Due date changed | |
| `created` | Task created | Intake trigger |
| `deleted` | Task deleted | |

### 3.7 Webhook Payload Structure

```json
{
  "events": [
    {
      "action": "changed",
      "resource": {
        "gid": "1234567890",
        "name": "Bug: Login fails on Safari",
        "resource_type": "task"
      },
      "parent": null,
      "created_at": "2024-01-15T10:30:00.000Z",
      "user": {
        "gid": "111222333",
        "name": "John Smith"
      },
      "change": {
        "field": "status",
        "action": "changed",
        "new_value": "In Review"
      }
    }
  ]
}
```

**Important:** Comments arrive as stories with `type: "comment"`. The comment body is in `story.text`.

```json
{
  "events": [
    {
      "action": "added",
      "resource": {
        "gid": "9876543210",
        "resource_type": "story",
        "name": ""
      },
      "parent": {
        "gid": "1234567890",
        "resource_type": "task"
      },
      "created_at": "2024-01-15T10:35:00.000Z",
      "user": {
        "gid": "111222333",
        "name": "Jane Doe"
      },
      "story": {
        "type": "comment",
        "text": "This is the comment body"
      }
    }
  ]
}
```

### 3.8 Polling Fallback Strategy

If webhooks are unreliable, poll using `modified_since`:

```
GET https://app.asana.com/api/1.0/tasks?workspace=<workspace_gid>&modified_since=2024-01-15T00:00:00Z&limit=100
```

**Recommended strategy:**
1. Store `sync_cursor` as ISO timestamp
2. Poll with `modified_since` for delta sync
3. Fall back to full sync daily/weekly

### 3.9 Payload Fields to Persist

| Field | Source | Notes |
|-------|--------|-------|
| `gid` | `resource.gid` | Primary identifier |
| `name` | `resource.name` | Task title |
| `notes` | GET /tasks/{gid} | Task description |
| `completed` | `task.completed` | Boolean completion status |
| `assignee.name` | `task.assignee.name` | Assignee display name |
| `assignee.gid` | `task.assignee.gid` | Assignee ID |
| `created_at` | `task.created_at` | ISO timestamp |
| `modified_at` | `task.modified_at` | ISO timestamp |
| `due_on` | `task.due_on` | Due date (YYYY-MM-DD) |
| `projects` | `task.projects[]` | Project memberships |
| `tags` | `task.tags[]` | Tags/labels |
| `custom_fields` | `task.custom_fields[]` | Custom field values |
| `external_url` | Constructed | `https://app.asana.com/0/<project_gid>/<task_gid>` |
| `workspace.gid` | `task.workspace` | Workspace ID |

---

## 4. Outbound — Writing Back

### 4.1 Create Task

```
POST https://app.asana.com/api/1.0/tasks
Authorization: Bearer <token>
Content-Type: application/json

{
  "data": {
    "name": "New Task Title",
    "notes": "Task description",
    "workspace": "<workspace_gid>",
    "projects": ["<project_gid>"],
    "assignee": "<user_gid>",
    "due_on": "2024-02-01"
  }
}
```

**Response:** `201 Created` with full task object including `gid`.

### 4.2 Post Comment

```
POST https://app.asana.com/api/1.0/tasks/<task_gid>/stories
Authorization: Bearer <token>
Content-Type: application/json

{
  "data": {
    "text": "Comment body with @mention support",
    "is_pinned": true
  }
}
```

**Note:** Comments are stories of type `comment`. The `text` field contains the comment body.

**Important:** When posting as a bot, the comment will be attributed to the Service Account or OAuth user. The `user` field in the story response indicates who posted it.

### 4.3 Edit Comment

```
PUT https://app.asana.com/api/1.0/stories/<story_gid>
Authorization: Bearer <token>
Content-Type: application/json

{
  "data": {
    "text": "Updated comment body"
  }
}
```

**Constraint:** Can only edit comments posted by the authenticated user (or Service Account).

### 4.4 Delete Comment

```
DELETE https://app.asana.com/api/1.0/stories/<story_gid>
Authorization: Bearer <token>
```

**Constraint:** Can only delete comments posted by the authenticated user.

### 4.5 Change Status / Transition

Asana uses workflow-based statuses, not fixed fields. Status changes are task field updates:

```
PUT https://app.asana.com/api/1.0/tasks/<task_gid>
Authorization: Bearer <token>
Content-Type: application/json

{
  "data": {
    "completed": true
  }
}
```

**Or update custom field for workflow status:**

```
{
  "data": {
    "custom_fields": {
      "<custom_field_gid>": "<enum_option_gid>"
    }
  }
}
```

**Note:** To get valid enum options, fetch the custom field definition first:
```
GET https://app.asana.com/api/1.0/custom_fields/<custom_field_gid>
```

### 4.6 Add/Remove Tag

```
POST https://app.asana.com/api/1.0/tasks/<task_gid>/addTag
Authorization: Bearer <token>
Content-Type: application/json

{
  "data": {
    "tag": "<tag_gid>"
  }
}
```

```
POST https://app.asana.com/api/1.0/tasks/<task_gid>/removeTag
Authorization: Bearer <token>
Content-Type: application/json

{
  "data": {
    "tag": "<tag_gid>"
  }
}
```

### 4.7 Set Assignee

```
PUT https://app.asana.com/api/1.0/tasks/<task_gid>
Authorization: Bearer <token>
Content-Type: application/json

{
  "data": {
    "assignee": "<user_gid>"
  }
}
```

### 4.8 Mention User

Use `@user_id` syntax in comment text:

```
POST https://app.asana.com/api/1.0/tasks/<task_gid>/stories
Authorization: Bearer <token>
Content-Type: application/json

{
  "data": {
    "text": "Hey @111222333, can you review this?"
  }
}
```

Asana will convert `@user_id` to a user mention link in the UI.

### 4.9 Close / Resolve Task

```
PUT https://app.asana.com/api/1.0/tasks/<task_gid>
Authorization: Bearer <token>
Content-Type: application/json

{
  "data": {
    "completed": true
  }
}
```

Or set workflow status via custom field (see 4.5).

### 4.10 Attach File / Screenshot

Asana supports attachments via:
1. **Upload endpoint** (multipart form):
```
POST https://app.asana.com/api/1.0/tasks/<task_gid>/attachments
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <binary data>
```

2. **External attachment** (URL reference):
```
POST https://app.asana.com/api/1.0/tasks/<task_gid>/attachments
Authorization: Bearer <token>
Content-Type: application/json

{
  "data": {
    "resource_type": "external",
    "external": {
      "url": "https://example.com/screenshot.png",
      "name": "screenshot.png"
    }
  }
}
```

**Required scope:** `stories:write` or `tasks:write`

---

## 5. Labels, Flags, Fields, Priorities

### 5.1 Built-in Label/Tag Model

Asana uses **Tags** for labeling:
- Tags are workspace-level resources
- Tasks can have multiple tags
- Tags have `name` and `color`

**API:**
```
GET /tags?workspace=<workspace_gid>
POST /tags
GET /tasks/<task_gid>/tags
```

### 5.2 Custom Field Support

Asana supports custom fields at the **project level**:

**Field Types:**
- `text` — Free-form text
- `enum` — Dropdown with options
- `number` — Numeric values
- `date` — Date picker
- `people` — User assignment
- `checkbox` — Boolean

**Fetching custom field definitions:**
```
GET /projects/<project_gid>?opt_fields=name,custom_fields.name,custom_fields.enum_options.name,custom_fields.custom_label,custom_fields.type
```

**Reading custom field values on tasks:**
```
GET /tasks/<task_gid>?opt_fields=name,custom_fields.name,custom_fields.display_value,custom_fields.enum_value.name
```

**Writing custom field values:**
```
PUT /tasks/<task_gid>
{
  "data": {
    "custom_fields": {
      "<field_gid>": "<value>"  // string for text, gid for enum
    }
  }
}
```

### 5.3 Status Model

Asana does NOT have a built-in status field. Status is implemented via:
1. **Completion boolean** (`completed: true/false`)
2. **Custom field** (enum type) for workflow stages like "Inbox", "In Progress", "In Review", "Done"

**Recommendation:** Detect if workspace uses a status custom field on projects and use that for status transitions.

### 5.4 Priority Model

Asana has NO built-in priority field. Implement via:
1. **Custom field** (enum) for priority levels
2. **Numeric custom field** for severity scores

**Recommendation:** Support reading/writing priority via custom field when present.

### 5.5 Listing Available Labels/Statuses/Fields

```
GET /tags?workspace=<workspace_gid>
GET /projects/<project_gid>?opt_fields=name,custom_fields.*
GET /custom_fields/<field_gid>?opt_fields=name,enum_options.name,enum_options.color
```

---

## 6. Triggers We Can Match On

### 6.1 Label/Tag Triggers

- **Tag added:** Story `type: "added_to_project"` (note: not tag, see below)
- **Tag added (actual):** Story events on tag membership
- **Trigger config:** Monitor specific tag GIDs, match on `stories` events

**Implementation:** Fetch task tags on intake, store tag GIDs. Trigger fires on tag match.

### 6.2 Status Transitions

- **Story type:** `changed_status`, `marked_complete`, `marked_incomplete`
- **Story change field:** `field: "custom_field.<field_gid>"` or `field: "completed"`
- **Trigger config:** Monitor for specific enum values or completion state

### 6.3 Mentions of Bot User

- **Detection:** When Asana user mentions our bot (`@<bot_user_gid>`) in comment
- **Story payload:** `story.text` contains the mention string
- **Trigger config:** Parse `story.text` for bot user mention pattern

### 6.4 Comment Body Regex

- **Source:** `story.text` on `type: "comment"` stories
- **Implementation:** Regex match on comment body text
- **Trigger config:** Store regex pattern, match against incoming `story.text`

### 6.5 Assignee Change

- **Story type:** `assigned`, `unassigned`
- **Story parent:** Task GID
- **Story resource:** User GID
- **Trigger config:** Monitor for specific assignee GID

### 6.6 Project/Team Scope

- **Source:** Task's `projects[]` array
- **Webhook scope:** Register webhook on specific project GID or workspace GID
- **Trigger config:** Filter by project GID membership

### 6.7 Custom Field Values

- **Source:** Task's `custom_fields[]` array
- **Trigger:** Fire when specific custom field equals specific value
- **Implementation:** Poll or evaluate on webhook receipt

---

## 7. Identity Mapping

### 7.1 User ID Shape

Asana uses **string GIDs** (numeric IDs as strings):
- Example: `"111222333"` or `"123456789012345678"`
- Format: Pure numeric string, variable length
- Not UUIDs

### 7.2 Resolving User to Email

**Requires `users:read` scope.**

```
GET https://app.asana.com/api/1.0/users/<user_gid>?opt_fields=name,email
```

**Response:**
```json
{
  "data": {
    "gid": "111222333",
    "name": "John Smith",
    "email": "john.smith@example.com"
  }
}
```

**Note:** Email access requires user consent. Users can opt out of email exposure via Asana privacy settings.

### 7.3 Bot Identity Detection

**For webhook self-retrigger prevention:**

1. **Store bot's own user GID** (from Service Account or OAuth app credentials)
2. **On webhook event:** Check `event.user.gid`
3. **If `event.user.gid === bot_gid`:** Skip processing (self-trigger)

**Note:** When posting as Service Account, the `user` field in the story will be the Service Account's user.

### 7.4 Author Attribution on Comments We Post

When posting a comment:
```json
{
  "data": {
    "text": "Our response",
    "is_pinned": true
  }
}
```

Response includes:
```json
{
  "data": {
    "gid": "<story_gid>",
    "created_at": "...",
    "created_by": {
      "gid": "<bot_user_gid>",
      "name": "SupportAgent Bot"
    }
  }
}
```

**Important:** Use `created_by.gid` to identify our own comments for `no_self_retrigger`.

---

## 8. Rate Limits

### 8.1 Rate Limit Details

| Limit Type | Value |
|------------|-------|
| Global (per token) | ~1,500 requests/minute |
| Burst | Up to 2,000 requests/minute for short periods |
| Pagination | Max 100 items per page |

### 8.2 Rate Limit Headers

Asana does NOT return explicit rate limit headers. If you exceed limits:

**Response:** `429 Too Many Requests`

**Mitigation:**
1. Implement exponential backoff
2. Monitor response times for degradation
3. Use bulk/batch endpoints where available

### 8.3 Bulk/Batch Endpoints

Asana provides a batch endpoint:

```
POST https://app.asana.com/api/1.0/batch
Authorization: Bearer <token>
Content-Type: application/json

{
  "data": {
    "actions": [
      { "method": "GET", "relative_path": "/tasks/123" },
      { "method": "GET", "relative_path": "/tasks/456" }
    ]
  }
}
```

- Accepts up to 10 actions per request
- Executes in parallel
- Returns results array

**Use case:** Reduce API calls when fetching multiple tasks.

### 8.4 Pagination

**Offset-based pagination:**
```
GET /tasks?workspace=<gid>&limit=100&offset=<next_offset>
```

- `limit`: 1-100 (default 20)
- `next_page.offset`: Token for next page
- `next_page`: `null` when done

**Important:** Offset tokens expire as underlying data changes. Process pages promptly.

---

## 9. Pagination & Search

### 9.1 Pagination Style

Offset-based with `next_page` token.

```json
{
  "data": [...],
  "next_page": {
    "offset": "abc123xyz",
    "path": "/tasks?...",
    "uri": "https://app.asana.com/api/1.0/tasks?..."
  }
}
```

### 9.2 Max Page Size

- **With pagination:** 100 items
- **Without pagination (legacy):** ~1,000 items (deprecated behavior)

### 9.3 Search Endpoints

**Task Search:**
```
GET /workspaces/<workspace_gid>/tasks/search?text=<query>&projects=<project_gid>&assignee=<user_gid>&completed=false
```

**Parameters:**
- `text`: Full-text search
- `projects`: Filter by project
- `assignee`: Filter by assignee
- `completed`: Filter by completion
- `modified_since`: Filter by modification date
- `opt_fields`: Include additional fields

**Use case:** Reconciliation, finding tasks by criteria.

---

## 10. Known Gotchas

### 10.1 Cloud-Only Platform

Asana has NO self-hosted option. All tenants are cloud-only. No v1/v2 API distinction.

### 10.2 EU Data Residency

Tenants can choose EU data residency. The API endpoint is the same (`app.asana.com/api/1.0`), but workspace data stays in EU. Verify tenant's data residency for compliance.

### 10.3 Webhook Scope

Webhooks must be registered at **workspace or project level**, not task level. You'll receive events for all tasks in the scope.

### 10.4 Webhook Event Filtering

Asana webhooks do NOT support event type filtering at registration. You receive all events on the resource and filter client-side.

### 10.5 Story vs Comment

- "Stories" in Asana are the activity log
- Comments are stories of type `comment`
- The `story.text` field contains the comment body
- Other story types have different field structures

### 10.6 No Built-in Status/Priority

Asana has NO built-in status or priority fields. You MUST:
1. Use `completed` boolean for simple open/done
2. Use custom fields for workflow statuses and priority levels
3. Inventory custom fields on first sync to know what fields exist

### 10.7 Email Access Requires Consent

User email is only accessible if user has consented. Use `users:read` scope and handle `403` on users who opted out.

### 10.8 Service Account Scope Granularity

Service Accounts in Enterprise have fine-grained scopes configured at creation. Ensure the Service Account has all required scopes.

### 10.9 Comment Editing/Deletion

Can only edit/delete comments posted by the authenticated user (or Service Account). Other users' comments cannot be modified.

### 10.10 Large Task List Errors

Queries on large result sets may return `400` with truncation message. Workaround: filter by hierarchy (team, project, section).

### 10.11 Rate Limit Observation

Asana doesn't provide explicit rate limit headers. Monitor response times and implement backoff proactively.

### 10.12 Pagination Token Expiry

Offset tokens expire when underlying data changes. Don't cache tokens; fetch fresh for each page iteration.

---

## 11. Recommended SupportAgent Connector Scope

### 11.1 MVP (Minimum Viable Product)

**Endpoints to wrap:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/tasks` | POST | Create task |
| `/tasks/{gid}` | GET | Get task details |
| `/tasks/{gid}` | PUT | Update task |
| `/tasks/{gid}/stories` | GET | List comments/activity |
| `/tasks/{gid}/stories` | POST | Post comment |
| `/stories/{gid}` | PUT | Edit comment |
| `/stories/{gid}` | DELETE | Delete comment |
| `/webhooks` | POST | Register webhook |
| `/webhooks/{gid}` | GET | Check webhook status |
| `/webhooks/{gid}` | DELETE | Remove webhook |
| `/users/{gid}` | GET | Resolve user email |
| `/workspaces/{gid}/tasks/search` | GET | Search/reconcile |
| `/tags` | GET | List available tags |
| `/projects/{gid}` | GET | Get project with custom fields |

**Webhook events to handle:**

| Event | Story Type | Trigger |
|-------|------------|---------|
| New task | `created` | Intake |
| New comment | `comment` | Inbound comment |
| Status change | `changed_status`, `marked_complete` | Status triggers |
| Assignee change | `assigned`, `unassigned` | Assignee triggers |

**Admin panel config fields:**

```typescript
interface AsanaConfig {
  accessToken: string;        // PAT or OAuth token
  workspaceGid: string;       // Workspace to operate in
  projectGids: string[];      // Projects to monitor
  botUserGid: string;         // For self-retrigger detection
  statusFieldGid?: string;    // Custom field GID for workflow status
  priorityFieldGid?: string;  // Custom field GID for priority
}
```

### 11.2 Phase 2 (Parity with GitHub Connector)

- Tag add/remove operations
- Attachment uploads (file and external URL)
- Bulk operations via batch endpoint
- Delta sync polling fallback
- Full custom field CRUD

**Additional endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/tasks/{gid}/addTag` | POST | Add tag |
| `/tasks/{gid}/removeTag` | POST | Remove tag |
| `/tasks/{gid}/attachments` | POST | Upload attachment |
| `/batch` | POST | Batch requests |
| `/custom_fields/{gid}` | GET | Get custom field definition |

### 11.3 Phase 3 (Advanced Features)

- Goal/OKR integration (separate resource type)
- Portfolio tracking
- Workflow automation triggers
- User mention detection
- Multi-workspace support

---

## 12. Dependencies

### 12.1 Official SDK

**npm package:** `asana`

```bash
npm install asana
```

**Usage:**
```typescript
import { Asana } from 'asana';

const client = Asana.Client.create().useAccessToken('<token>');

// List tasks
const tasks = await client.tasks.getTasks({
  workspace: '<workspace_gid>',
  limit: 20
});

// Create task
const newTask = await client.tasks.create({
  name: 'New Task',
  workspace: '<workspace_gid>'
});
```

**SDK Features:**
- Automatic pagination handling
- Token refresh for OAuth
- TypeScript definitions
- Error parsing

### 12.2 SDK vs Raw Fetch

**Recommendation: Use the official `asana` SDK.**

**Rationale:**
- Handles pagination automatically
- Provides TypeScript types
- OAuth token refresh built-in
- Consistent error handling
- Official client libraries support pagination by default (per Asana docs)

### 12.3 CLI Parity

No official Asana CLI equivalent to GitHub's `gh`. The SDK is the primary integration path.

---

## 13. Open Questions

### 13.1 Multi-Tenant Architecture

**Q:** Should each tenant use their own Service Account (Enterprise) or share one OAuth app with per-user tokens?

**Recommendation:** Use Service Accounts for Enterprise tenants. For non-Enterprise, use PATs or per-user OAuth.

### 13.2 EU Data Residency

**Q:** Do any tenants use EU data residency? This affects data handling and compliance.

**Action:** Ask tenant during onboarding. EU tenants need confirmation of data residency compliance.

### 13.3 Custom Field Discovery

**Q:** How to handle workspaces with different custom field schemas?

**Recommendation:** On first sync, inventory custom fields for all monitored projects. Cache field GIDs and types. Handle missing fields gracefully.

### 13.4 Status Field Identification

**Q:** Which custom field (if any) represents workflow status?

**Recommendation:** Prompt tenant to select status field from discovered custom fields. Default to `completed` boolean if no custom field selected.

### 13.5 Priority Field Support

**Q:** Do tenants use priority fields? Which custom field?

**Recommendation:** Make priority optional. Support multiple priority fields if needed.

### 13.6 Webhook Reliability

**Q:** Are webhooks reliable enough for production, or do we need robust polling fallback?

**Recommendation:** Implement webhook primary with polling fallback. Monitor webhook health via `last_success_at` / `last_failure_at` fields.

---

## 14. Quick Reference

### 14.1 API Base URL

```
https://app.asana.com/api/1.0
```

### 14.2 Key Headers

```
Authorization: Bearer <token>
Content-Type: application/json
```

### 14.3 Authentication Scopes (MVP)

```
tasks:read tasks:write stories:read stories:write webhooks:write users:read
```

### 14.4 Important GIDs

- Task GID: `/tasks/{gid}`
- Project GID: `/projects/{gid}`
- Workspace GID: `/workspaces/{gid}`
- User GID: `/users/{gid}`
- Story GID: `/stories/{gid}`
- Webhook GID: `/webhooks/{gid}`

### 14.5 External URL Pattern

```
https://app.asana.com/0/<project_gid>/<task_gid>
```

---

## Sources

- [Asana API Reference](https://developers.asana.com/reference)
- [Asana Authentication Docs](https://developers.asana.com/docs/authentication)
- [Asana OAuth Scopes](https://developers.asana.com/docs/oauth-scopes)
- [Asana Webhooks Guide](https://developers.asana.com/docs/webhooks)
- [Asana Pagination Guide](https://developers.asana.com/docs/pagination)
- [Asana Bulk Requests](https://developers.asana.com/docs/bulk-requests-and-batches)
- [Asana Error Handling](https://developers.asana.com/docs/errors)
- [Asana Workspaces, Projects, Tasks](https://developers.asana.com/docs/organizations-and-workspaces)
- [Asana Service Accounts](https://developers.asana.com/docs/service-accounts)
- [Asana Client Libraries](https://developers.asana.com/docs/client-libraries)
