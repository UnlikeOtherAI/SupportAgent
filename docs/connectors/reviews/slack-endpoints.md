# Slack Connector Endpoint Review

## Verdict: MAJOR ISSUES FOUND

The document has multiple HTTP method errors and one hallucinated endpoint. Most GET methods are documented as POST.

---

## Findings

### 1. `conversations.list` — HTTP method wrong

**Doc says:** `POST /api/conversations.list`
**Actual:** `GET /api/conversations.list`
**Source:** [conversations.list](https://docs.slack.dev/reference/methods/conversations.list)

The doc correctly documents the URL but uses wrong HTTP method throughout Appendix A.

---

### 2. `conversations.history` — HTTP method wrong

**Doc says:** `POST /api/conversations.history`
**Actual:** `GET /api/conversations.history`
**Source:** [conversations.history](https://docs.slack.dev/reference/methods/conversations.history)

---

### 3. `conversations.replies` — HTTP method wrong

**Doc says:** `POST /api/conversations.replies`
**Actual:** `GET /api/conversations.replies`
**Source:** [conversations.replies](https://docs.slack.dev/reference/methods/conversations.replies)

Also, the doc uses `timestamp` in the body example but `conversations.replies` takes `ts` as the required parameter, not `timestamp`.

---

### 4. `bots.info` — HTTP method wrong

**Doc says:** `POST /api/bots.info` (Appendix A)
**Actual:** `GET /api/bots.info`
**Source:** [bots.info](https://docs.slack.dev/reference/methods/bots.info)

---

### 5. `search.messages` — HTTP method wrong

**Doc says:** `POST /api/search.messages`
**Actual:** `GET /api/search.messages`
**Source:** [search.messages](https://docs.slack.dev/reference/methods/search.messages)

Rate limit is Tier 2 (20+/min), not special tier. The doc doesn't specify rate limit for this endpoint in the main body.

---

### 6. `views.open` — HTTP method wrong

**Doc says:** `POST /api/views.open` (Appendix A)
**Actual:** `GET /api/views.open`
**Source:** [views.open](https://docs.slack.dev/reference/methods/views.open)

Also, `views.open` requires a `trigger_id` parameter, not just `view`. The `trigger_id` is passed via the event/interaction payload and must be used within 3 seconds.

---

### 7. `files.uploadV2` — Does not exist

**Doc says:** `POST /api/files.uploadV2`
**Actual:** Endpoint does not exist. `files.upload` is deprecated (sunset: November 12, 2025). The replacement is a two-step process:
1. `POST /api/files.getUploadURLExternal` — get a pre-signed URL
2. `POST /api/files.completeUploadExternal` — complete the upload and optionally share to channels
**Source:** [files.upload](https://docs.slack.dev/reference/methods/files.upload), [files.getUploadURLExternal](https://docs.slack.dev/reference/methods/files.getUploadURLExternal), [files.completeUploadExternal](https://docs.slack.dev/reference/methods/files.completeUploadExternal)

This is a significant omission. The file upload flow requires:
- `files.getUploadURLExternal`: `filename`, `length` (bytes), `title` (optional) → returns `upload_url`, `file_id`
- Upload file content to `upload_url` via HTTP PUT
- `files.completeUploadExternal`: `files` array with `id` and optional `title` → optionally `channels` to share

---

### 8. `users.list` — HTTP method unspecified

**Doc says:** Not explicitly stated
**Actual:** `GET /api/users.list`
**Source:** [users.list](https://docs.slack.dev/reference/methods/users.list)

---

### 9. `users.info` — HTTP method wrong

**Doc says:** `GET /api/users.info` (Appendix A) — this is correct
**Actual:** `GET /api/users.info`
**Source:** [users.info](https://docs.slack.dev/reference/methods/users.info)

Actually correct. No change needed.

---

### 10. `files.list` — HTTP method unspecified

**Doc says:** Not documented
**Actual:** `GET /api/files.list`
**Source:** [files.list](https://docs.slack.dev/reference/methods/files.list)

---

### 11. `conversations.info` — HTTP method unspecified

**Doc says:** Not documented
**Actual:** `GET /api/conversations.info`
**Source:** [conversations.info](https://docs.slack.dev/reference/methods/conversations.info)

---

### 12. `usergroups.list` — HTTP method unspecified

**Doc says:** Not documented
**Actual:** `GET /api/usergroups.list`
**Source:** [usergroups.list](https://docs.slack.dev/reference/methods/usergroups.list)

---

### 13. `usergroups.users.list` — HTTP method unspecified

**Doc says:** Not documented
**Actual:** `GET /api/usergroups.users.list`
**Source:** [usergroups.users.list](https://docs.slack.dev/reference/methods/usergroups.users.list)

---

### 14. `reactions.add` — parameter name clarification

**Doc says:** `{ "name": "thumbsup", "channel": "C123ABC456", "timestamp": "123456.789" }`
**Actual:** Parameters are `name`, `channel`, and `timestamp`. Correct.
**Source:** [reactions.add](https://docs.slack.dev/reference/methods/reactions.add)

---

### 15. `reactions.remove` — parameter validation nuance

**Doc says:** Not documented in detail
**Actual:** Requires `name` plus either `file`, `file_comment`, OR `channel`+`timestamp`. Cannot use `timestamp` alone.
**Source:** [reactions.remove](https://docs.slack.dev/reference/methods/reactions.remove)

---

### 16. `auth.test` — HTTP method

**Doc says:** `POST /api/auth.test`
**Actual:** `POST /api/auth.test` — correct
**Source:** [auth.test](https://docs.slack.dev/reference/methods/auth.test)

---

### 17. `chat.postMessage` — missing text requirement

**Doc says:** `text` is listed as a body field
**Actual:** `text` is optional when `blocks` are provided. Both `blocks` and `attachments` are optional. The doc's example is valid.
**Source:** [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage)

---

## Missing Capabilities (Platform Limitations — Correctly Stated)

The following are correctly documented as not existing in Slack:

| Capability | Slack Reality | Status |
|------------|---------------|--------|
| Labels/tags | Emoji reactions only | Correct |
| Priority/severity | Not natively supported | Correct |
| Status/workflow states | Not natively supported | Correct |
| Issue/card creation | Channel messages only | Correct |
| Comments on items | Thread replies (proxy) | Correct |

---

## Summary of Required Fixes

| Endpoint | Fix |
|----------|-----|
| `conversations.list` | Change POST → GET |
| `conversations.history` | Change POST → GET |
| `conversations.replies` | Change POST → GET; `ts` param, not `timestamp` |
| `bots.info` | Change POST → GET |
| `search.messages` | Change POST → GET |
| `views.open` | Change POST → GET; add `trigger_id` requirement |
| `files.uploadV2` | Replace with `files.getUploadURLExternal` + `files.completeUploadExternal` two-step flow |
| Add `users.list` | GET |
| Add `files.list` | GET |
| Add `conversations.info` | GET |
| Add `usergroups.list` | GET |
| Add `usergroups.users.list` | GET |

---

## Reference: Correct HTTP Methods

| Method | HTTP |
|--------|------|
| `auth.test` | POST |
| `bots.info` | GET |
| `users.list` | GET |
| `users.info` | GET |
| `conversations.list` | GET |
| `conversations.info` | GET |
| `conversations.history` | GET |
| `conversations.replies` | GET |
| `conversations.create` | POST |
| `conversations.open` | POST |
| `conversations.archive` | POST |
| `conversations.unarchive` | POST |
| `chat.postMessage` | POST |
| `chat.postEphemeral` | POST |
| `chat.update` | POST |
| `chat.delete` | POST |
| `reactions.add` | POST |
| `reactions.remove` | POST |
| `reactions.list` | GET |
| `files.list` | GET |
| `search.messages` | GET |
| `views.open` | GET |
| `usergroups.list` | GET |
| `usergroups.users.list` | GET |
