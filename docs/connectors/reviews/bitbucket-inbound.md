# Bitbucket Connector — Inbound Events Review

**Verdict**: APPROVED WITH NOTES — The webhook/event intake story is substantially correct and covers the necessary ground. Three significant gaps require documentation clarification, and several minor corrections are needed for accuracy.

---

## Critical Findings

### 1. Missing: Webhook Payload Envelope Structure

**Affected**: All webhook events
**Issue**: The document shows example payloads with the webhook data at the top level (e.g., `"type": "pullrequest"`, `"state": "OPEN"`), but Bitbucket webhooks wrap the actual data in nested objects.

**Correction**: Bitbucket Cloud webhook payloads have this envelope:
```json
{
  "event": "pullrequest:created",
  "actor": { "uuid": "{uuid}", "display_name": "..." },
  "repository": {
    "uuid": "{uuid}",
    "full_name": "{workspace}/{repo_slug}"
  },
  "pullrequest": { /* actual PR data here */ }
}
```

For issue events:
```json
{
  "event": "issue:created",
  "actor": { "uuid": "{uuid}", "display_name": "..." },
  "repository": { "uuid": "...", "full_name": "..." },
  "issue": { /* actual issue data here */ }
}
```

The `actor` field is essential for bot-loop prevention — must compare `actor.uuid` against configured bot UUID, not `pullrequest.author.uuid` or `issue.reporter.uuid`.

---

### 2. Missing: Replay Protection / Idempotency Guidance

**Affected**: All webhook events
**Issue**: Document states "Use idempotent webhook handlers (Bitbucket retries 3x)" but provides no mechanism for idempotency. Bitbucket does not enforce timestamp tolerance or provide replay protection — it relies entirely on the consumer.

**Required addition**: Document should specify:
- Bitbucket does NOT include a timestamp or nonce in webhooks
- Implement deduplication using the `X-Request-UUID` header (Bitbucket provides this)
- Store processed `X-Request-UUID` values with a TTL (recommend 24-48 hours)
- On duplicate delivery (same `X-Request-UUID`), return 200 OK but skip processing

---

### 3. Missing: Issue Assignee Change Detection Method

**Affected**: `issue:updated` events
**Issue**: Table 10.2 correctly notes "Issue assignee changes: Not a separate event — must detect via `issue:updated` + compare" but the document never explains HOW to compare. There's no `previous_assignee` field in the payload.

**Required addition**: Provide polling-based diff strategy:
1. Store `updated_on` timestamp and `assignee.uuid` for all tracked issues
2. On `issue:updated`, fetch current issue via API
3. Compare stored vs current `assignee.uuid`
4. If different and event timestamp > last-seen timestamp, treat as assignee change event

Same pattern applies to label changes (no field diff, requires snapshot comparison).

---

## Event Coverage Analysis

### Events Correctly Listed ✓

| Event | Status | Notes |
|-------|--------|-------|
| `pullrequest:created` | Correct | Fires on draft and non-draft PR creation |
| `pullrequest:updated` | Correct | Title, description, reviewer, source changes |
| `pullrequest:fulfilled` | Correct | Merge completion |
| `pullrequest:rejected` | Correct | PR declined |
| `pullrequest:comment_created` | Correct | General PR comments |
| `pullrequest:comment_updated` | Correct | Comment edited |
| `pullrequest:comment_deleted` | Correct | Comment deleted |
| `pullrequest:approved` | Correct | Approval added |
| `pullrequest:unapproved` | Correct | Approval removed |
| `pullrequest:request_change` | Correct | Changes requested |
| `issue:created` | Correct | Issue created |
| `issue:updated` | Correct | Any issue field change |
| `issue:comment_created` | Correct | Issue comment created |

### Events Missing / Incomplete

| Event | Status | Correction |
|-------|--------|------------|
| `pullrequest:needs_review` | Listed in Phase 2 | Correctly deferred; not MVP |
| Inline comment on PR | Partially covered | Document shows inline support in API but doesn't show inline flag in webhook payload — inline comments DO fire `pullrequest:comment_created` with `inline` object present |
| Issue label add/remove | Missing from triggers | Not a separate event. Detection requires polling (see section 3 above) |
| Issue assignee change | Missing from triggers | Not a separate event. Detection requires polling (see section 3 above) |

### Bot-Authored Content Filtering

**Issue**: The document mentions using `author.uuid` for loop prevention but doesn't clarify:
- For comments, check `comment.user.uuid` not `pullrequest.author.uuid`
- For issues, check `issue.reporter.uuid` not `issue.assignee.uuid`
- `actor.uuid` in webhook envelope is the correct field for webhook-level filtering

**Correction**: Add explicit guidance in section 3.1 or triggers section:
```
Bot loop prevention — check these fields in order:
1. Webhook envelope: actor.uuid === bot.uuid → skip
2. Comment: comment.user.uuid === bot.uuid → skip
3. Issue create: issue.reporter.uuid === bot.uuid → skip
4. PR create: pullrequest.author.uuid === bot.uuid → skip
```

---

## Signature Verification — Corrections Needed

### Header Names

**Issue**: Document states two headers for Cloud: `X-Hub-Signature` and `X-Hub-Signature-256`. This is slightly misleading.

**Correction**: Both headers may be present, but:
- `X-Hub-Signature-256` is preferred (more explicit)
- Both contain identical format: `sha256={hex_digest}`
- Compare against `X-Hub-Signature-256` first; fall back to `X-Hub-Signature` if only that exists
- Data Center (v8.0+) only sends `X-Hub-Signature`

### Body Verification

**Correct as documented**: `HMAC-SHA256(secret, raw_request_body)` — verify using raw bytes, not parsed JSON.

---

## Polling Fallback — Accuracy Check

### Endpoints Listed ✓

- `GET /2.0/repositories/{workspace}/{repo}/pullrequests` — correct
- `GET /2.0/repositories/{workspace}/{repo}/issues` — correct
- `GET /2.0/repositories/{workspace}/{repo}/pullrequests/{id}/activity` — correct for detecting PR-level changes
- `GET /2.0/repositories/{workspace}/{repo}/issues/{id}/comments` — correct

### Missing: Comment Detection on Existing Items

**Issue**: Document shows `GET .../issues/{id}/comments` for polling but doesn't explain how to detect NEW comments during reconciliation.

**Required addition**: Use `GET /2.0/repositories/{workspace}/{repo}/issues/{id}/activity` instead:
```json
{
  "values": [
    { "comment": { "id": 123, "created_on": "..." } },
    { "comment": { "id": 124, "created_on": "..." } }
  ]
}
```

Same pattern for PR comments: `GET .../pullrequests/{id}/activity` returns all activity including comments, reactions, approvals.

### Cursor Strategy

**Correct as documented**: Use `updated_on` as cursor. Bitbucket sorts by `updated_on` when `sort=-updated_on` is specified. Cursor should be the last-seen `updated_on` timestamp.

---

## Mention Detection

### Status: No Native Webhook Indication

**Issue**: Document correctly notes parsing `comment.content.raw` for mentions but doesn't emphasize this is the ONLY way to detect mentions.

**Bitbucket behavior**: Mentions in content are rendered as `@{username}` in raw text. The webhook payload provides no `mentioned_users` array or similar indicator.

**Recommendation**: Document should explicitly state:
- No webhook field indicates who was mentioned
- Must parse `@{username}` patterns from `content.raw`
- Bot username must be known in advance (stored in config as `botUsername`)
- Regex pattern: `@{botUsername}` or `@[~]{botUsername}`

---

## Eventual Consistency Gaps — Correctly Noted ✓

Table 10.3 correctly identifies:
- Webhook vs API lag: 1-2s delay before API reflects change
- Comment propagation: inline comments may not appear in list immediately
- Merge detection: `pullrequest:fulfilled` may fire before final state update

**Suggested addition**: Add guidance for handling lag:
```typescript
// After receiving webhook, wait 2 seconds before fetching via API
// Or: fetch immediately, retry once after 1 second if data missing
```

---

## Summary of Required Changes

| Priority | Section | Change |
|----------|---------|--------|
| High | Section 3.1 | Add webhook envelope structure with `actor`, `repository`, nested data object |
| High | Section 3.1 or 10.3 | Add replay protection: use `X-Request-UUID` for deduplication |
| High | Section 6.2 | Add assignee/label change detection via polling + snapshot comparison |
| Medium | Section 3.1 | Clarify `X-Hub-Signature-256` preference over `X-Hub-Signature` |
| Medium | Section 6.1/6.2 | Add explicit bot-loop prevention field priority list |
| Medium | Section 3.2 | Add `GET .../issues/{id}/activity` as comment polling endpoint |
| Low | Section 3 | Add 2-second delay guidance after webhook before API fetch |
| Low | Section 3.1 | Clarify inline comment payload includes `inline` object in webhook |
| Low | Section 6 | Add mention detection regex pattern |
