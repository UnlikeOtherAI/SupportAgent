# Trello Connector Design

> **Platform key:** `trello`
> **Last reviewed:** 2026-04-18
> **Official docs:** https://developer.atlassian.com/cloud/trello/

## 1. Overview

**Category:** Project management / Kanban

**Cloud vs self-hosted:** Cloud only. Trello does not have a self-hosted/Data Center version. Enterprise workspaces use Atlassian Enterprise accounts but still hit the same cloud API.

**Official API reference:** `https://developer.atlassian.com/cloud/trello/rest/`

**Base URL:** `https://api.trello.com/1`

**Trello hierarchy:** Enterprise → Organization (Workspace) → Board → List → Card

Trello is Atlassian-owned. Integrations use either the REST API (API key + token) or the Power-Up model (embedded in Trello UI). SupportAgent will use the REST API since we need to operate externally.

---

## 2. Authentication

### 2.1 API Key + Token (recommended for MVP)

This is the simplest and most reliable method. All API operations use `key` and `token` query parameters.

**Token generation (3 ways):**
1. Manual: https://trello.com/app-key → generate token manually
2. Per-user OAuth1 flow: redirect to `https://trello.com/1/authorize`
3. OAuth2 3LO: new Atlassian OAuth2 flow (still transitioning from OAuth1)

**Token placement:**
- Query params: `?key={apiKey}&token={apiToken}` (all endpoints)
- OAuth header: `OAuth oauth_consumer_key="{apiKey}", oauth_token="{apiToken}"`

**Scopes (token-based):**
| Scope | Access |
|-------|--------|
| `read` | View boards, organizations, cards, lists |
| `write` | Modify boards, cards, lists, add comments |
| `account` | Access member email and notification settings |

**Token expiration options:** `1hour`, `1day`, `30days`, `never`

**MVP recommendation:** API key + long-lived token (`never` expiry). Store per-tenant credentials. Generate via https://trello.com/app-key.

### 2.2 OAuth2 3LO (Phase 2+)

Atlassian is transitioning to OAuth2 3LO. New scopes use `data` and `action` prefixes:
- `data:read`, `data:write` — access Trello data
- `action:read`, `action:write` — perform actions
- `account:read` — access account info

**Registration:** https://developer.atlassian.com/console/myapps/

### 2.3 Required scopes per operation

| Operation | Required scope |
|-----------|----------------|
| Read boards/lists/cards | `read` |
| Read actions/comments | `read` |
| Post/edit/delete comments | `write` |
| Create/update/archive cards | `write` |
| Add/remove labels | `write` |
| Manage webhooks | `write` |

### 2.4 Forge and OAuth2 app restriction

**Critical:** `GET /1/batch` and all `/webhooks/` endpoints (except those on tokens) are NOT accessible to Forge apps or OAuth2 apps. Standard API key+token auth is required for webhooks.

---

## 3. Inbound — Events and Intake

### 3.1 Webhook Support

**Yes.** Webhooks are the primary push mechanism.

**Registration:**
```
POST https://api.trello.com/1/tokens/{token}/webhooks/
  ?key={apiKey}
  &token={apiToken}
  &callbackURL=https://your-endpoint/trello
  &idModel={boardIdOrCardId}
  &description=SupportAgent Connector
```

**Required fields:**
- `callbackURL` — must be HTTPS, must return HTTP 200 on HEAD at creation time
- `idModel` — TrelloID of board, card, or member to watch

**Callback URL requirements:**
- Must return HTTP 200 on HEAD request during creation
- Invalid SSL certificates fail creation; missing SSL does not
- Requests originate from IP range `104.192.142.240/28`

**HMAC verification:**
- Header: `X-Trello-Webhook`
- Algorithm: base64(HMAC-SHA1(appSecret, JSON.stringify(body) + callbackURL))
- Compare to header value; reject if mismatch

**Webhook list/delete:**
```
GET /1/tokens/{token}/webhooks/?key={apiKey}&token={apiToken}
DELETE /1/webhooks/{id}/?key={apiKey}&token={apiToken}
```

**Retry semantics:**
- 3 retries: 30s, 60s, 120s (exponential backoff)
- Disabled after 30 consecutive failures (not 1000 — the changelog clarifies 30 days of failures)
- Failures include: non-2xx response, timeout, token losing model access

### 3.2 Webhook Event Types

**Action types we care about:**

| Event name | Description | Use case |
|------------|-------------|----------|
| `createCard` | Card created | New item inbound |
| `updateCard` | Card updated (any field) | Status change, field update |
| `deleteCard` | Card deleted | Archive detection |
| `commentCard` | Comment added | Inbound comment |
| `updateCheckItem` | Checklist item changed | Task progress |
| `addMemberToCard` | Member assigned | Assignee detection |
| `removeMemberFromCard` | Member removed | Assignee change |
| `addLabelToCard` | Label added | Label trigger |
| `removeLabelFromCard` | Label removed | Label trigger |
| `addAttachmentToCard` | Attachment added | File detection |
| `voteOnCard` | Vote added | Engagement signal |
| `copyCard` | Card copied | Duplication detection |
| `moveCardToList` | Card moved to list | Status transition |

**Event types NOT available:**
- Card due date changes (no specific `updateCard.due` event; must diff in `updateCard` action)
- List create/delete/rename — no webhook events at list level

### 3.3 Webhook Payload Shape

```json
{
  "action": {
    "id": "string",
    "idMemberCreator": "string",
    "data": {
      "card": { "id": "string", "name": "string", "shortLink": "string" },
      "board": { "id": "string", "name": "string" },
      "list": { "id": "string", "name": "string" },
      "text": "string (for commentCard)",
      "label": { "id": "string", "name": "string", "color": "string" },
      "member": { "id": "string", "username": "string", "fullName": "string" }
    },
    "type": "commentCard | createCard | updateCard | ...",
    "date": "2024-01-01T12:00:00.000Z",
    "display": {
      "translationKey": "string",
      "entities": { ... }
    }
  },
  "model": {
    "id": "string",
    "name": "string",
    "url": "string"
  },
  "webhook": {
    "id": "string",
    "description": "string"
  }
}
```

### 3.4 Polling Fallback

When webhooks fail or for reconciliation.

**Recommended cursor strategy:**
- `GET /1/boards/{boardId}/actions?limit=100&page=0&filter=createCard,commentCard,updateCard,addLabelToCard,removeLabelFromCard,addMemberToCard,removeMemberFromCard,moveCardToList`
- Actions have `date` field; use `since` param to filter by timestamp: `&since=2024-01-01T00:00:00.000Z`
- **Pagination:** `page` (0-indexed) + `limit` (max 1000 but default 50)
- Sort: reverse chronological (newest first)

**For full board state reconciliation:**
```
GET /1/boards/{boardId}/cards?filter=open
GET /1/boards/{boardId}/lists?filter=open
GET /1/boards/{boardId}/labels
GET /1/boards/{boardId}/actions?limit=1000&page=0
```

### 3.5 Payload Fields to Persist

**Card:**
- `id` (primary key — use this, not `idShort`)
- `name` (title)
- `desc` (description, markdown)
- `idList` (list/column ID — use for status)
- `idBoard` (board ID)
- `idMembers` (assignee array)
- `idLabels` (label IDs)
- `closed` (archived boolean)
- `pos` (position)
- `due`, `dueComplete` (due date)
- `shortUrl`, `url` (Trello card URL)
- `dateLastActivity` (last update timestamp)

**Comment (action):**
- `id` (action ID)
- `type: "commentCard"`
- `data.text` (comment body)
- `date` (created)
- `idMemberCreator` (author)

**Label:**
- `id` (primary key)
- `idBoard` (board)
- `name` (display name)
- `color` (blue, green, orange, red, purple, pink, lime, sky, grey)

---

## 4. Outbound — Writing Back

All endpoints use: `https://api.trello.com/1`

### 4.1 Create Card

```
POST /1/cards
  ?key={apiKey}&token={apiToken}
  &idList={listId}        (required)
  &name={cardTitle}
  &desc={description}
  &pos=top|bottom|{position}
  &due={ISO8601}
  &dueComplete={boolean}
  &idMembers={commaSepMemberIds}
  &idLabels={commaSepLabelIds}
```

**Response:** Card object with `id`, `shortUrl`, `url`.

### 4.2 Post Comment

```
POST /1/cards/{cardId}/actions/comments
  ?key={apiKey}&token={apiToken}
  &text={commentText}
```

**Response:** Action object.

**Markdown support:** Yes — Trello supports basic markdown in comments.

### 4.3 Edit Comment

Not directly supported. Comments are `commentCard` actions. There's no standalone edit endpoint. Workaround: delete + recreate, or use `text` update within the action (limited).

### 4.4 Delete Comment

```
DELETE /1/actions/{actionId}
  ?key={apiKey}&token={apiToken}
```

**Constraint:** Can only delete own comments.

### 4.5 Change Status (Move to List)

```
PUT /1/cards/{cardId}
  ?key={apiKey}&token={apiToken}
  &idList={listId}
```

**List names are per-board, not global.** Status matching requires board-specific list names.

### 4.6 Add/Remove Label

```
POST /1/cards/{cardId}/labels
  ?key={apiKey}&token={apiToken}
  &color={colorName}&name={labelName}  (for new)
  OR
  &color={colorName}  (for existing — use color or name)
```

**Remove label:**
```
DELETE /1/cards/{cardId}/labels/{labelId}
  ?key={apiKey}&token={apiToken}
```

### 4.7 Set Priority/Severity

No built-in priority model. Options:
1. **Labels** — assign a priority label (e.g., "P1", "Critical")
2. **Custom fields** — if board has custom field enabled
3. **List position** — move card to "In Progress / P1" list
4. **Cover color** — set card cover (limited)

**Add priority label:**
```
POST /1/cards/{cardId}/labels
  ?key={apiKey}&token={apiToken}
  &color=red
```

### 4.8 Assign User

```
POST /1/cards/{cardId}/members
  ?key={apiKey}&token={apiToken}
  &value={memberId}
```

**Remove assignee:**
```
DELETE /1/cards/{cardId}/members/{memberId}
  ?key={apiKey}&token={apiToken}
```

### 4.9 Mention User

**Syntax:** `@{username}` or `@{fullName}`

In comments:
```
POST /1/cards/{cardId}/actions/comments
  &text=@bentleycook please review
```

### 4.10 Close/Archive Card

```
PUT /1/cards/{cardId}
  ?key={apiKey}&token={apiToken}
  &closed=true
```

**Unarchive:**
```
PUT /1/cards/{cardId}
  ?key={apiKey}&token={apiToken}
  &closed=false
```

### 4.11 Attach File/Screenshot

Trello supports attachments via URL or file upload.

**URL attachment:**
```
POST /1/cards/{cardId}/attachments
  ?key={apiKey}&token={apiToken}
  &url={fileUrl}
  &name={attachmentName}
```

**File upload:** Requires `multipart/form-data` with `file` field. Max 10MB per file. Max 4 attachments per card.

---

## 5. Labels, Flags, Fields, Priorities

### 5.1 Built-in Label Model

- **Per-board labels** — labels are board-scoped, not workspace-wide
- 10 colors: `blue`, `green`, `orange`, `red`, `purple`, `pink`, `lime`, `sky`, `black`, `yellow`
- Name + color (name optional for colored labels)
- 50 labels per board

**List board labels:**
```
GET /1/boards/{boardId}/labels?limit=1000
```

**Create label:**
```
POST /1/labels
  ?key={apiKey}&token={apiToken}
  &idBoard={boardId}
  &name={labelName}
  &color={color}
```

**Update label:**
```
PUT /1/labels/{labelId}
  ?key={apiKey}&token={apiToken}
  &name={newName}
  &color={newColor}
```

### 5.2 Custom Fields

Trello supports custom fields on boards (Power-Up required).

**Get custom fields:**
```
GET /1/boards/{boardId}/customFields
```

**Custom field types:** `text`, `number`, `date`, `checkbox`, `select`, `rating`

**Get card custom fields:**
```
GET /1/cards/{cardId}?customFieldItems=true
```

**Update custom field:**
```
PUT /1/cards/{cardId}/customField/{customFieldId}/item
  ?key={apiKey}&token={apiToken}
  &value={jsonValue}  e.g., "{\"text\":\"value\"}" or "{\"number\":5}"
```

**Note:** Custom fields are a Power-Up feature. The base Trello API supports them but boards must have the feature enabled.

### 5.3 Status Model

No built-in status model. Status is represented by:
1. **List membership** — card's `idList` (most common)
2. **Card state** — `closed=true` (archived)
3. **Custom field** — some boards use a "Status" custom field

**Workflow:** Lists are ordered columns. Common: "Backlog", "To Do", "In Progress", "Review", "Done".

### 5.4 Priority / Severity

No built-in model. Workarounds:
1. Dedicated priority labels (e.g., P1=red, P2=orange)
2. Card cover colors
3. Custom field with select/rating type
4. Specific "Priority" list

### 5.5 List Available Labels/Fields

```
GET /1/boards/{boardId}/labels
GET /1/boards/{boardId}/lists
GET /1/boards/{boardId}/customFields
GET /1/boards/{boardId}/members
```

---

## 6. Triggers We Can Match On

From webhook payloads and polling:

| Trigger | Source field | Notes |
|---------|-------------|-------|
| New card | `action.type === "createCard"` | Card created |
| Card comment | `action.type === "commentCard"` | Check `action.data.text` for regex |
| Card moved to list | `action.type === "moveCardToList"` | `action.data.listAfter` has destination list |
| Label added | `action.type === "addLabelToCard"` | `action.data.label` has label details |
| Label removed | `action.type === "removeLabelToCard"` | — |
| Member assigned | `action.type === "addMemberToCard"` | `action.data.member` has member info |
| Member removed | `action.type === "removeMemberFromCard"` | — |
| Card updated | `action.type === "updateCard"` | Check `action.data.old` vs current for field changes |
| Card archived | `action.type === "updateCard"` + `data.card.closed=true` | — |
| Checklist item checked | `action.type === "updateCheckItem"` + `data.checkItem.state="complete"` | — |
| Due date set | `action.type === "updateCard"` + `data.card.due` changed | — |
| Mention of bot | `action.data.text` contains `@{botUsername}` | — |
| Board scope | `model.id` | Filter by board ID |

**Important:** `action.data` contains `card`, `board`, `list`, `member` depending on action type. Always check action type first.

---

## 7. Identity Mapping

### 7.1 User ID Shape

- **TrelloID:** 24-char hex string (e.g., `5abbe4b7ddc1b351ef961414`)
- **Username:** unique handle (e.g., `bentleycook`)
- **Full name:** display name (e.g., `Bentley Cook`)

### 7.2 Resolve User Identity

```
GET /1/members/{idOrUsername}
  ?key={apiKey}&token={apiToken}
  &fields=id,username,fullName,email,avatarUrl,confirmed
```

**Email:** Requires `account` scope and user consent. Not reliably available.

**Stable external ID:** Use `id` (TrelloID) as primary key. Username can change; ID is immutable.

### 7.3 Bot Identity

**Our connector's identity in payloads:**
- `action.idMemberCreator` — the Trello member who performed the action
- When we post a comment as the connector, `idMemberCreator` is the user whose token we used

**`no_self_retrigger` strategy:**
1. Store the `idMemberCreator` from our own comment/activity actions
2. On webhook receipt, check `action.idMemberCreator` against stored bot member IDs
3. Reject if it matches our own actions

**Identifying our bot member ID:**
```
GET /1/tokens/{token}/member
  ?key={apiKey}&token={apiToken}
  &fields=id,username,fullName
```

### 7.4 Author Field on Posted Comments

Yes — `action.idMemberCreator` on `commentCard` actions reliably identifies who posted the comment.

---

## 8. Rate Limits

**Official limits:**

| Limit type | Value |
|------------|-------|
| Requests per second | 200 |
| Requests per token per 10 seconds | 100 |
| Requests per API key per 10 seconds | 300 |
| Batch requests per call | 10 |

**Headers:** Trello does NOT return rate limit headers. There is no `X-RateLimit-*` header.

**Retry strategy:** No headers means no adaptive throttling. Use fixed conservative delays (100ms between writes, 50ms between reads).

**Burst:** Max 200/s but sustained at 100/token/10s = 10/s sustained per token.

**Multi-tenant implications:** Each tenant gets their own token. No cross-tenant rate limit sharing.

---

## 9. Pagination & Search

### 9.1 Pagination Style

**Offset-based (page + limit):**
```
GET /1/boards/{id}/actions?limit=100&page=0
GET /1/search?query=...&page=0
```

**Parameters:**
- `limit` — max per page (actions max 1000, default varies)
- `page` — 0-indexed page number
- `since` — ISO8601 timestamp for actions filtering
- `before` — ISO8601 timestamp for actions filtering

**Sorting:** Actions are always reverse chronological (newest first). No ascending sort option.

### 9.2 Max Page Size

- Actions: 1000 (with `limit=1000`)
- Cards on board: varies (no pagination param — returns all open cards)
- Labels: 1000
- Members: varies

### 9.3 Search Endpoints

**Global search:**
```
GET /1/search
  ?key={apiKey}&token={apiToken}
  &query={query}
  &idBoards={commaSepBoardIds}
  &modelTypes=boards,cards,organizations,members
  &cards_limit=100
  &boards_limit=50
```

**Member search:**
```
GET /1/search/members
  ?key={apiKey}&token={apiToken}
  &query={query}
  &idBoard={boardId}  (optional, limits to board members)
  &limit=10
```

### 9.4 Batch Endpoint

```
GET /1/batch?urls={url1},{url2},...
```

- Max 10 URLs per batch
- Rate limit impact: counts as N requests toward limit
- Forge/OAuth2 apps CANNOT access this endpoint

---

## 10. Known Gotchas

### 10.1 Cloud-only API

- **No self-hosted option.** Trello is cloud-only. If tenants need self-hosted, this connector cannot serve them.

### 10.2 `idShort` Regeneration

- `idShort` (the short number like `#42`) regenerates when a card moves between boards (since Aug 2024)
- **Always use `id` as the stable identifier, never `idShort`**

### 10.3 Labels Are Board-Scoped

- Labels are per-board, not per-workspace
- Label colors are duplicated across boards (same color = different labels)
- Label matching for triggers must include board context

### 10.4 No List-Level Webhooks

- Trello does not fire webhooks for list create/delete/rename
- Only card-level and board-level events
- Can't detect list creation via webhooks

### 10.5 No Native Priority/Severity

- No built-in priority model — must use labels or custom fields
- Custom fields require the board to have the Power-Up enabled

### 10.6 Comment Editing Limited

- No `PUT` endpoint for comment actions
- Can delete + recreate but loses edit history

### 10.7 `card_pluginData` Not Accessible

- `card_pluginData` is hidden from API
- Custom fields set via Power-Up UI may not be readable via REST in some configurations

### 10.8 Webhook Registration Constraints

- 1 webhook per token per model is a common misunderstanding — actually, you can have multiple webhooks per token, but each must have unique `callbackURL + idModel`
- The callback URL must be reachable at creation time (HEAD check)
- Webhooks on tokens — not on API keys

### 10.9 SCIM API Deprecated

- SCIM endpoints (`/scim/v2/users`, `/scim/v2/groups`) deprecated Dec 10, 2025
- Migrate to REST equivalents

### 10.10 Member Privacy Endpoint Changed

- `PUT /application/:id/compliance/memberPrivacy` removed after Sep 8, 2025
- Use `PUT /plugin/:id/compliance/memberPrivacy` instead

### 10.11 Label Names Endpoint Deprecated

- `PUT board/:id/labelNames` deprecated Aug 18, 2025
- Use `POST /labels` (create) and `PUT /labels/:id` (update) instead

### 10.12 Multi-tenant Webhook Setup

- Each tenant needs their own Trello API key + token
- Webhooks must be registered per token, per board
- No "org-wide" webhook — must register on each board

### 10.13 Webhook Source IP

- Requests come from `104.192.142.240/28`
- Whitelist this IP range for webhook endpoints

---

## 11. Recommended SupportAgent Connector Scope

### 11.1 MVP (Minimum Viable Product)

**Endpoints to wrap:**
```
GET    /1/boards/{boardId}?actions=all&lists=open&cards=open&labels=all
GET    /1/boards/{boardId}/actions?limit=100&page=0&filter=...
GET    /1/boards/{boardId}/labels
GET    /1/boards/{boardId}/lists
GET    /1/boards/{boardId}/members
GET    /1/cards/{cardId}
POST   /1/cards
PUT    /1/cards/{cardId}
POST   /1/cards/{cardId}/actions/comments
DELETE /1/actions/{actionId}
POST   /1/cards/{cardId}/labels
DELETE /1/cards/{cardId}/labels/{labelId}
POST   /1/cards/{cardId}/members
DELETE /1/cards/{cardId}/members/{memberId}
GET    /1/members/{id}
POST   /1/tokens/{token}/webhooks
DELETE /1/webhooks/{webhookId}
GET    /1/tokens/{token}/webhooks
```

**Webhook events to handle:**
- `createCard` — new item
- `commentCard` — inbound comment
- `updateCard` — status change, field update
- `addLabelToCard`, `removeLabelFromCard` — label triggers
- `addMemberToCard`, `removeMemberFromCard` — assignee triggers
- `moveCardToList` — explicit list move

**Minimum admin panel config:**
- `apiKey` (string)
- `apiToken` (string, sensitive)
- `boardIds` (string[], boards to monitor)
- `listNameToStatus` (map: listName → canonical status)
- `labelNameToPriority` (map: labelName → canonical priority)
- `botUsername` (string, for no_self_retrigger)
- `webhookCallbackUrl` (string, your endpoint)
- `enabled` (boolean)

### 11.2 Phase 2 (Parity with GitHub connector)

**Additional endpoints:**
- Custom fields: `GET /1/boards/{boardId}/customFields`, `PUT /1/cards/{cardId}/customField/{id}/item`
- Checklists: `POST /1/cards/{cardId}/checklists`, `POST /1/checklists/{id}/checkItems`
- Attachments: `POST /1/cards/{cardId}/attachments`
- Batch: `GET /1/batch?urls=...`
- Search: `GET /1/search`, `GET /1/search/members`
- Organizations: `GET /1/organizations/{id}`
- Enterprise: `GET /1/enterprises/{id}/members` (if on Atlassian Enterprise)

**Additional triggers:**
- Checklist item completion
- Due date changes
- Card archive/unarchive

**Delivery ops:**
- Archive/unarchive card
- Attach file from URL
- Create checklist
- Update custom fields

### 11.3 Phase 3 (Advanced)

**Features unique to Trello:**
- **Board templates** — create new boards from templates
- **Power-Up capabilities** — if Trello introduces AI/automation Power-Ups, integrate
- ** Butler automation** — Trello's built-in automation (rule-based actions)
- **Card coverage/visuals** — set card cover images
- **Board backgrounds** — per-board customization

---

## 12. Dependencies

### 12.1 Official SDK

**npm:** No official Atlassian SDK. Third-party options exist:
- `trello` — minimal REST wrapper
- `trello-api-client` — basic client

**Recommendation:** Use raw `fetch` with typed helpers. No compelling SDK — the API is simple REST with query params.

### 12.2 Why Raw Fetch

1. No official Atlassian Trello SDK — third-party packages are thin wrappers with low maintenance
2. API is straightforward REST — query params for everything, JSON responses
3. Custom types are minimal — Card, List, Board, Action, Label, Member, Webhook
4. Batch endpoint `GET /1/batch` is simple URL encoding

**Implementation approach:**
- One `trelloFetch.ts` helper: adds auth params, base URL, error handling
- Typed request functions per resource group (cards.ts, boards.ts, webhooks.ts)
- Zod schemas for response validation

### 12.3 CLI Parity

- No `trello` CLI equivalent to `gh` (GitHub CLI)
- Trello has no server-side CLI for webhook management
- Our connector must manage webhooks via API

---

## 13. Open Questions

### Q1: Do tenants use Trello with Power-Ups for custom fields?
Custom fields are a Power-Up. If tenants rely on custom fields for priority/severity, we need to verify those boards have the feature enabled. If not, fall back to labels.

### Q2: How many boards per tenant?
Webhook registration is per-board. If tenants have 50+ boards, we need to discuss webhook management strategy (register on all? register on organization-level?).

### Q3: Do tenants need multi-workspace support?
Trello organizations (workspaces) contain boards. A single API token can access all boards the user has access to. Clarify if tenants need multi-org隔离.

### Q4: Label color vs name for matching?
Labels are identified by `id` (stable), `color` (not unique), or `name` (user-editable). For trigger matching, prefer `id` (stored from board labels list) over color/name.

### Q5: Token provisioning UX?
MVP approach: user generates token manually at trello.com/app-key. Phase 2: OAuth2 3LO flow for in-app authorization. Which approach for Phase 1?

### Q6: Comment edit support?
Trello has no edit-comment endpoint. We can delete+recreate but lose edit history. Is this acceptable or do we need a workaround?

### Q7: Do we need to support Trello Business Class / Atlassian Enterprise?
Enterprise features include SCIM (deprecated), additional member roles, and org-wide settings. If yes, need to handle enterprise-specific endpoints.

---

## Quick Reference

**Auth:** `?key={apiKey}&token={apiToken}` on all requests

**Base URL:** `https://api.trello.com/1`

**Webhook HMAC:** base64(HMAC-SHA1(appSecret, body + callbackURL)) in `X-Trello-Webhook`

**Webhook IPs:** `104.192.142.240/28`

**Webhook retry:** 3x (30s, 60s, 120s), auto-disable after 30 consecutive failures

**Rate limit:** ~100 req/10s per token, 200 req/s burst — no headers

**Pagination:** `page` + `limit` (offset-based, 0-indexed)

**ID shape:** 24-char hex string (e.g., `5abbe4b7ddc1b351ef961414`)

**Board hierarchy:** Enterprise → Organization → Board → List → Card

**Comment endpoint:** `POST /1/cards/{id}/actions/comments?text=...`

**Card create:** `POST /1/cards?idList={listId}&name={title}`

**Member identify:** `GET /1/members/{id}` → `id`, `username`, `fullName`, `email`

**Label list:** `GET /1/boards/{boardId}/labels`

**List list:** `GET /1/boards/{boardId}/lists`

**Search:** `GET /1/search?query={q}&idBoards={ids}`

**No self-hosted:** Trello is cloud-only
