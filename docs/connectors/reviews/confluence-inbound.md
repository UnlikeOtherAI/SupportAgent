# Confluence Inbound Events Review

**Verdict: NEEDS REVISION** — Significant gaps in event coverage, incorrect comment polling endpoint, and missing critical event lifecycle details.

---

## Findings

### 1. Missing Webhook Events — Incomplete Event Catalog

**Affected**: Section 3 (Webhook Support)

**Problem**: The event list is incomplete. The Confluence Connect event catalog includes 58 total events. The document lists only ~20 events, missing many relevant ones.

**Missing page lifecycle events**:
- `page_viewed` — user viewed a page (useful for activity tracking)
- `page_published` — draft page was published (distinct from page_created)
- `page_trashed` — page moved to trash
- `page_restored` — page restored from trash
- `page_unarchived` — page unarchived
- `page_archived` — page archived
- `page_copied` — page was copied
- `page_moved` — page moved (already listed but verify exact name)
- `page_started` — page editing started
- `page_snapshotted` — page snapshot created

**Missing blog events**:
- `blog_trashed`, `blog_restored`, `blog_viewed` — blog post lifecycle

**Missing label events**:
- `label_created` — label created on content
- `label_deleted` — label deleted from content

**Missing content-level events**:
- `content_created` — generic content created event (covers pages, comments, blogposts)
- `content_updated` — generic content updated event
- `content_removed` — generic content removed event
- `content_trashed`, `content_restored` — content trash lifecycle

**Correction**: Update event list to match full catalog:
```
# Page events
page_created, page_updated, page_published, page_trashed, page_restored,
page_archived, page_unarchived, page_moved, page_copied, page_viewed

# Blog events
blog_created, blog_updated, blog_removed, blog_trashed, blog_restored, blog_moved

# Comment events
comment_removed  (no comment_created, no comment_updated — confirmed missing)

# Label events
label_added, label_removed, label_created, label_deleted

# Space events
space_created, space_updated, space_removed

# Attachment events
attachment_created, attachment_removed

# Content-level fallback
content_created, content_updated, content_removed
```

---

### 2. Incorrect Comment Polling Endpoint

**Affected**: Section 3 (Polling Fallback), Section 11 (Recommended Scope)

**Problem**: The document lists `GET /wiki/api/v2/pages/{pageId}/comments` as the comment polling endpoint. This is incorrect for Confluence REST API v2.

**Correct endpoints per API v2**:
- `GET /wiki/api/v2/pages/{id}/footer-comments` — footer comments on a page
- `GET /wiki/api/v2/pages/{id}/inline-comments` — inline comments on a page
- `GET /wiki/api/v2/footer-comments` — global footer comments (can filter by container)
- `GET /wiki/api/v2/inline-comments` — global inline comments (can filter)

**Correction**: Replace `/wiki/api/v2/pages/{pageId}/comments` with:
```
GET /wiki/api/v2/pages/{id}/footer-comments?limit=25&cursor=<cursor>
GET /wiki/api/v2/pages/{id}/inline-comments?limit=25&cursor=<cursor>
```

**Query parameters for filtering comments**:
- `body-format` — response body format (storage, atlas_doc_format)
- `status` — filter by comment status (current, historical)
- `sort` — sort order (created, -created)
- `cursor` — pagination cursor
- `limit` — page size (max 100)

---

### 3. Missing Payload Examples for Key Events

**Affected**: Section 3 (Payload example)

**Problem**: Only `page_created` payload is shown. Missing examples for:
- `comment_removed` — the only comment webhook event
- `label_added` / `label_removed` — for label trigger detection
- `content_created` / `content_updated` — generic fallback events

**Correction**: Add payload examples:

```json
// comment_removed payload
{
  "userAccountId": "...",
  "accountType": "customer",
  "comment": {
    "id": 123,
    "contentType": "comment",
    "self": "https://.../api/v2/footer-comments/123",
    "creatorAccountId": "...",
    "spaceKey": "SPACE",
    "creationDate": 1594752539309,
    "modificationDate": 1594752539309
  },
  "timestamp": 1594752539400
}

// label_added payload
{
  "userAccountId": "...",
  "accountType": "customer",
  "label": {
    "name": "important",
    "ownerId": 16777227,
    "ownerType": "page"
  },
  "timestamp": 1594752539400
}
```

---

### 4. Signature Verification — Missing Implementation Details

**Affected**: Section 3 (Signature verification)

**Problem**: Document correctly identifies JWT verification but lacks:
1. Exact header name for JWT token
2. Verification algorithm (what hash + what secret)
3. Which body bytes to sign

**Correction**: Add:
```
Headers received:
- Authorization: Bearer <jwt_token>  (NOT Basic auth, NOT HMAC)
- Atlassian-Connect-Version: "1.0"
- Content-Type: application/json

JWT verification requires:
1. Decode JWT header to get algorithm (typically HS256)
2. Verify signature using app's client secret from installation payload
3. Validate claims: iat (issued at), exp (expiration), iss (issuer: "ari:cloud:ecosystem")
4. DO NOT use X-Hub-Signature-256 — that is GitHub/Slack format
```

**Note**: For Connect apps, the installation payload contains `clientSecret`. The JWT must be verified, not just checked for presence.

---

### 5. No Replay Protection / Timestamp Tolerance

**Affected**: Section 3, Section 10

**Problem**: Confluence webhooks include a timestamp in the JWT (`iat` claim), but the document doesn't discuss:
- Recommended timestamp tolerance (typically 5-10 minutes)
- How to detect replayed events
- Whether Atlassian enforces timestamp expiry

**Correction**: Add to Section 10:
```
Replay protection:
- JWT iat claim contains Unix timestamp of when event was sent
- Reject requests with iat older than 5 minutes (configurable tolerance)
- Store processed event IDs to detect duplicates (at-least-once delivery)
- Confluence does NOT send a unique event ID field; use (pageId + timestamp + eventType) as deduplication key
```

---

### 6. No Mentions Detection Strategy

**Affected**: Section 3, Section 6

**Problem**: Document mentions "Search body content for @botName or `<ac:mention ac:uid="..."/>`" but:
- Doesn't explain how to detect bot mentions from webhook payload alone
- Doesn't address inline comments vs footer comments for mention context
- Doesn't specify ADF parsing approach for mentions

**Correction**: Add to Section 6:
```
Mention detection:

From webhook payload:
- NO direct "bot was mentioned" field in Confluence webhooks
- Must inspect page/comment body content post-delivery
- Inline comments have mention context; footer comments may not

From polling (required for new comments):
- Fetch comment body via GET /wiki/api/v2/footer-comments/{id}?body-format=storage
- Parse for: <ac:mention ac:uid="accountId"/> in storage format
- Parse for: { "type": "mention", "attrs": { "id": "accountId" } } in ADF
- Match accountId against bot's known accountId

For ADF parsing, extract all nodes where node.type === "mention":
```javascript
function extractMentions(adfBody) {
  const mentions = [];
  function traverse(node) {
    if (node.type === 'mention') {
      mentions.push(node.attrs.id);
    }
    if (node.content) {
      node.content.forEach(traverse);
    }
  }
  traverse(adfBody);
  return mentions;
}
```
```

---

### 7. Bot-Authored Content Loop Prevention

**Affected**: Section 7 (Identity Mapping)

**Problem**: Document mentions using `accountId` to detect own activity but doesn't cover:
- How to get bot's accountId at configuration time
- Whether Confluence provides an "excludeBot" filter
- Handling nested comment replies the bot authored

**Correction**: Add:
```
Loop prevention for bot-authored content:

1. At installation, store bot's accountId from the Connect installation payload
   or from the response to POST /wiki/api/v2/pages (createdBy.accountId)

2. On webhook receipt:
   - Check userAccountId === botAccountId
   - If match, skip processing

3. On polling:
   - Filter via CQL: NOT (creatorAccountId = botAccountId)
   - CQL: creatorAccountId != "bot-account-id"
   - For nested replies, also check parent comment creator

4. NO native "exclude bot" filter in Confluence API
   Must implement application-level filtering
```

---

### 8. Content-Level Events as Fallback

**Affected**: Section 3, Section 11

**Problem**: Document doesn't mention `content_created`, `content_updated`, `content_removed` as generic events that cover all content types.

**Correction**: Add to Section 3:
```
Alternative: content_* events (generic coverage):
- content_created — fires for pages, blogposts, comments, attachments
- content_updated — fires for any content modification
- content_removed — fires when any content is deleted/trashed

Use content_* events when you need coverage across all content types
without subscribing to each type-specific event. Payload structure
is similar but uses generic "content" object instead of type-specific one.
```

---

### 9. Webhook Delivery Guarantees — Insufficient Detail

**Affected**: Section 3, Section 10

**Problem**: Document mentions "best effort only" but doesn't explain retry behavior or dead-letter handling.

**Correction**: Add:
```
Webhook delivery guarantees:

1. At-least-once delivery attempt — if Confluence can reach your endpoint
2. NO automatic retry — if delivery fails (network, 5xx, timeout), event is LOST
3. No dead-letter queue — Atlassian does not maintain undelivered events
4. Retry window: ~0 (immediate attempt only)
5. Recommended: poll frequently to compensate for missed webhooks

Compensation strategy:
- Webhooks for near-real-time when successful
- Polling as backstop to catch missed events
- Minimum polling interval: every 60s for active spaces
- On webhook failure, next poll will capture missed changes via updatedAt/version
```

---

### 10. Eventual Consistency Gap Not Documented

**Affected**: Section 3, Section 10

**Problem**: Confluence may have a consistency delay between webhook firing and content being readable via API. Document doesn't warn about this.

**Correction**: Add to Section 10:
```
Eventual consistency:

Confluence webhooks may fire BEFORE the content is fully indexed and
readable via REST API. This can cause:
- Webhook received for page_created, but GET /wiki/api/v2/pages/{id} returns 404
- Comment created webhook fires, but comment not yet in poll results

Workaround:
1. On webhook receipt, wait 1-2 seconds before fetching via API
2. Implement exponential backoff retry for 404 on newly-created content
3. Poll again after short delay to verify content exists
4. Log consistency gaps for monitoring

```javascript
async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    await sleep(1000 * (i + 1));  // 1s, 2s, 3s backoff
    const response = await fetch(url);
    if (response.ok) return response.json();
    if (response.status === 404 && i < maxRetries - 1) continue;
    throw new Error(`Failed after ${maxRetries} attempts`);
  }
}
```
```

---

### 11. Inline vs Footer Comments Ambiguity

**Affected**: Section 3, Section 10

**Problem**: Confluence has two comment types (inline and footer) but document treats comments as a single type.

**Correction**: Clarify in Section 3:
```
Comment types in Confluence v2:

1. Footer comments — traditional page-level comments at the bottom
   - Endpoint: GET /wiki/api/v2/pages/{id}/footer-comments
   - Suitable for: SupportAgent replies, threaded discussions

2. Inline comments — anchored to specific text/range in the page
   - Endpoint: GET /wiki/api/v2/pages/{id}/inline-comments
   - Can be marked "resolved" via PUT /wiki/api/v2/inline-comments/{id} with resolved: true
   - Suitable for: review feedback, suggestions

Webhook coverage:
- comment_removed fires for BOTH inline and footer comments when deleted
- No distinction in webhook payload — must fetch to determine type
- comment_created and comment_updated do NOT exist for either type
```

---

### 12. Missing `page_published` vs `page_created` Distinction

**Affected**: Section 3, Section 11

**Problem**: Document treats `page_created` as the primary event but doesn't explain `page_published` (for draft workflows).

**Correction**: Add:
```
Page lifecycle events:

page_created — fires when page is first created (may be in draft state)
page_published — fires when draft page is published/made live

For SupportAgent monitoring:
- Use page_created to detect new pages (draft or published)
- Use page_published to detect pages entering public/visible state
- page_trashed/page_restored for deletion/recovery

Not all pages go through draft state — some are created directly as published.
page_created fires for both draft and published pages.
```

---

## Summary of Required Changes

| # | Section | Severity | Issue |
|---|---------|----------|-------|
| 1 | 3 | HIGH | Incomplete event catalog — missing 30+ events |
| 2 | 3, 11 | HIGH | Wrong comment polling endpoint (v2 uses footer-comments) |
| 3 | 3 | MEDIUM | Missing payload examples for label, comment_removed |
| 4 | 3 | MEDIUM | Signature verification needs exact header/algorithm |
| 5 | 3, 10 | MEDIUM | No replay protection / timestamp tolerance documented |
| 6 | 3, 6 | MEDIUM | No mention detection strategy for ADF parsing |
| 7 | 7 | MEDIUM | Bot loop prevention needs more detail |
| 8 | 3, 11 | LOW | Missing content_* events as generic fallback |
| 9 | 3, 10 | MEDIUM | Webhook delivery guarantees need retry/dead-letter note |
| 10 | 3, 10 | MEDIUM | Eventual consistency gap not documented |
| 11 | 3 | MEDIUM | Inline vs footer comments not distinguished |
| 12 | 3, 11 | LOW | page_published vs page_created not explained |

---

## Verified Correct

The following items in the document ARE accurate:

- [x] Confluence Cloud webhook support (Data Center webhooks added in v7.13+)
- [x] No `comment_created` or `comment_updated` webhook — only `comment_removed` exists
- [x] Best-effort webhook delivery with no retry
- [x] JWT token signature verification (not HMAC-SHA256)
- [x] Basic Auth + API token for Cloud (MVP)
- [x] CQL filtering for polling queries
- [x] Cursor-based pagination in v2 API
- [x] AccountId vs userKey distinction for Cloud vs Data Center
- [x] Status model (current, draft, trashed)
- [x] No custom fields (wiki platform, not issue tracker)
