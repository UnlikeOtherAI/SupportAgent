# Linear Connector — Endpoint Coverage Review

**Reviewer**: API endpoint auditor
**Source**: `/docs/connectors/linear.md`
**Reference**: Linear GraphQL schema v82.0.0 (master branch, `packages/sdk/src/schema.graphql`)
**Verdict**: APPROVED WITH CORRECTIONS — 7 findings requiring fixes

---

## Findings

### 1. `IssueCreateInput` — `teamId` missing from example

**Affected**: Create Issue example
**Doc says**: Example `input` object does not include `teamId`
**Actually correct**: `teamId: String!` is a **required** field (non-null) in `IssueCreateInput`
**Severity**: High — creating an issue without `teamId` will fail at runtime

```graphql
# schema says:
input IssueCreateInput {
  teamId: String!   # required
  title: String     # NOT required per schema (but likely enforced by API)
  ...
}
```

---

### 2. `IssueCreateInput` — `title` not marked required

**Affected**: Create Issue example, "Required body fields" claim
**Doc says**: `title` shown as present, implied required
**Actually correct**: Schema defines `title: String` (nullable) — not enforced as non-null by GraphQL
**Note**: The API likely requires it anyway, but the schema does not enforce it. Document this ambiguity.
**Severity**: Low — API behavior likely requires it anyway

---

### 3. `AttachmentCreateInput` — `archivable` field does not exist

**Affected**: Attach file / screenshot section
**Doc says**:
```json
{ "input": { "issueId": "...", "url": "...", "archivable": true } }
```
**Actually correct**: Schema defines no `archivable` field on `AttachmentCreateInput`. Available fields are: `issueId!`, `url!`, `title!`, `subtitle`, `metadata`, `commentBody`, `iconUrl`, `groupBySource`, `id`, `createAsUser`
**Severity**: High — the example body contains a hallucinated field that will be silently ignored or rejected

---

### 4. `IssuePayload` — response shape is nested, not flat

**Affected**: Create Issue return value description
**Doc says**: "Returns `IssuePayload` with `id`, `identifier`, `url`"
**Actually correct**: `IssuePayload` returns `issue: Issue!` — you must request nested fields:
```graphql
issueCreate(input: $input) {
  success
  issue { id identifier title url }   # must access .issue.*
}
```
**Severity**: Medium — documentation is misleading about the response shape

---

### 5. Issue body field — `body` vs `description`

**Affected**: Payload Fields to Persist — Issue section
**Doc says**: `"body" (HTML/Rich text)` and `"description" (markdown)` are both present
**Actually correct**: `Issue` type has `description: String` only. It does NOT have a `body` field. The rich-text equivalent is `descriptionData: JSON`. Comments DO have `body: String!`
**Severity**: Medium — field name confusion could cause implementation bugs

---

### 6. Issue `priority` — schema type is `Float`, not `Int`

**Affected**: Set Priority section, Payload fields
**Doc says**: `priority: 1` (integer), priority integers listed
**Actually correct**: `Issue.priority: Float!`, `IssueUpdateInput.priority: Int`. The API accepts integers and coerces to float. This is acceptable but imprecise in the doc
**Severity**: Low — API handles coercion correctly

---

### 7. Comments query — wrong signature

**Affected**: MVP endpoints list, Section 11
**Doc says**: `comments(issueId, first, after)`
**Actually correct**: There is no `comments(issueId: ...)` query. Comments are fetched via:
- `issue(id: "...") { comments(first: 50, after: null) { nodes { ... } } }`
- Or top-level `comments(filter: { issue: { id: { eq: "..." } } })`

The `comments` connection lives on the `Issue` type, not as a root query with `issueId` arg
**Severity**: High — the documented query signature will fail

---

### 8. `issueLabels(teamId)` and `workflowStates(teamId)` — wrong signatures

**Affected**: MVP endpoints list, Section 11
**Doc says**: `issueLabels(teamId)` and `workflowStates(teamId)`
**Actually correct**: Both root queries take a `filter` argument, not `teamId`. To scope by team:
```graphql
issueLabels(filter: { team: { id: { eq: "team-uuid" } } })
workflowStates(filter: { team: { id: { eq: "team-uuid" } } })
```
**Severity**: High — documented args don't exist

---

### 9. `IssueWebhookPayload` — `botActor` is `String`, not object

**Affected**: no_self_retrigger section, Payload fields comment section
**Doc says**: `botActor.id` is set on comments, compare `botActor.id` against app user ID
**Actually correct**: `IssueWebhookPayload.botActor: String` and `CommentWebhookPayload.botActor: String` — both are plain strings, not objects with an `.id` field
**For no_self_retrigger**: The doc's guidance to compare `botActor.id` is wrong. The webhook `botActor` is a string. The `Comment.type` object does have `botActor: ActorBot` with `.id`, but this is not exposed in webhook payloads
**Severity**: High — the detection mechanism described won't work as documented

---

### 10. `CommentWebhookPayload` — `creator`, `updatedAt` missing

**Affected**: Payload Fields — Comment section
**Doc says**: `creator: { id, name, email }`, `updatedAt`
**Actually correct**: `CommentWebhookPayload` has `externalUser: ExternalUserChildWebhookPayload` and `externalUserId: String`, but NO `creator` (User) or `updatedAt` field. It has `createdAt: String!` and `editedAt: String`
**Severity**: Medium — these fields won't be available from webhook payloads

---

### 11. Status transition triggers — `fromState`/`toState` not in webhook

**Affected**: Triggers We Can Match On table
**Doc says**: "Status transition: `IssueWebhookPayload.state` / `fromState` / `toState`"
**Actually correct**: `fromState` and `toState` exist on `IssueHistory`, not `IssueWebhookPayload`. The webhook payload only has `state: WorkflowStateChildWebhookPayload!` and `stateId: String!`. To detect transitions, compare `state` / `stateId` in consecutive update events or query `IssueHistory`
**Severity**: Medium — the trigger won't fire on webhook events as described

---

## Verified Correct

The following are accurate against the schema:

| Capability | Status |
|---|---|
| GraphQL-only (no REST) | Verified |
| Endpoint `https://api.linear.app/graphql/v1` | Verified |
| `issueCreate` mutation | Verified |
| `issueUpdate` mutation | Verified |
| `issueArchive` mutation | Verified |
| `issueDelete` mutation | Verified |
| `commentCreate` mutation | Verified |
| `commentUpdate` mutation | Verified |
| `commentDelete` mutation | Verified |
| `attachmentCreate` mutation | Verified |
| `issueLabelCreate` mutation | Verified |
| `issueLabelDelete` mutation | Verified |
| `issueUpdate` with `stateId` for status | Verified |
| `issueUpdate` with `priority` | Verified |
| `issueUpdate` with `assigneeId` | Verified |
| `issueUpdate` with `labelIds` (replace) | Verified |
| `issueUpdate` with `addedLabelIds` / `removedLabelIds` | Verified |
| Cursor-based pagination (Relay Connections) | Verified |
| `first: Int` (max 250) | Verified |
| `filter` argument with rich predicates | Verified |
| `updatedAt` filter for polling | Verified |
| Priority scale: 0=no, 1=urgent, 2=high, 3=medium, 4=low | Verified |
| Priority is `Float!` on Issue, `Int` on update | Verified |
| Issue has `description`, not `body` | Verified |
| Comment has `body: String!` | Verified |
| Comment `parentId` for threading | Verified |
| `@[Name](user:user-uuid)` mention syntax | (not verifiable from schema alone) |
| Issue `archivedAt`, `completedAt`, `canceledAt`, `dueDate` | Verified |
| Label model flat (no hierarchy) | Verified |
| State UUIDs are team-scoped | Verified |
| File attachments are URL-only (no binary upload) | Verified |

---

## Recommendations

1. **Fix example bodies** — add `teamId` to IssueCreateInput, remove `archivable` from AttachmentCreateInput
2. **Fix query signatures** — `comments(issueId, ...)` should be `issue(id) { comments(...) }`, add filter syntax for labels and states
3. **Clarify `botActor`** — the webhook `botActor` is a String; self-retrigger detection may need a different approach (check if externalUser is set on CommentWebhookPayload, or compare creator ID against stored app user ID)
4. **Remove `body` from Issue fields** — use `description` only
5. **Document `fromState`/`toState` limitation** — state transitions via webhook need manual comparison or IssueHistory queries
6. **Remove `creator` and `updatedAt` from Comment webhook fields** — not available in `CommentWebhookPayload`
