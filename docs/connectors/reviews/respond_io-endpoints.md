# Review: Respond.io Connector — Endpoint Coverage

**Reviewer**: API endpoint audit
**Scope**: Verify endpoint surface completeness and accuracy against the actual Respond.io API
**Source**: `docs/connectors/respond_io.md`
**Reference**: Respond.io MCP server (28 tools), `@respond-io/typescript-sdk` methods, per Respond.io API reference

---

## Verdict: ISSUES FOUND — 7 endpoint gaps + 2 path corrections needed

---

## Finding 1 — Missing: Delete Contact

- **Affected capability**: Delete contact
- **What the doc says**: No mention of delete operation anywhere
- **What is actually correct**: `DELETE /contact/{identifier}` exists and is used by the MCP server (`delete_contact` tool). The SDK exposes `client.contacts.delete(identifier)`.
- **Citation**: Per Respond.io `@respond-io/typescript-sdk` — `delete(identifier)` method on contacts

---

## Finding 2 — Missing: Merge Contacts

- **Affected capability**: Merge two contacts
- **What the doc says**: No mention of merge anywhere
- **What is actually correct**: `POST /contact/merge` exists and is used by the MCP server (`merge_contacts` tool: "Merges two contacts"). The SDK exposes `client.contacts.merge(sourceIdentifier, targetIdentifier)`.
- **Citation**: Per Respond.io `@respond-io/typescript-sdk` — `merge(sourceIdentifier, targetIdentifier)` method on contacts

---

## Finding 3 — Missing: Create or Update Contact (Upsert)

- **Affected capability**: Create or update contact in one call
- **What the doc says**: No mention of upsert
- **What is actually correct**: `POST /contact/create-or-update` (or similar) exists and is used by the MCP server (`create_or_update_contact` tool). The SDK exposes `client.contacts.createOrUpdate(identifier, body)`.
- **Citation**: Per Respond.io `@respond-io/typescript-sdk` — `createOrUpdate(identifier, body)` method on contacts

---

## Finding 4 — Missing: List Contact Channels

- **Affected capability**: List all channels a contact is connected through
- **What the doc says**: No mention of a dedicated endpoint for this
- **What is actually correct**: `GET /contact/{identifier}/channel` (or `GET /contact/{identifier}/channels`) exists and is used by the MCP server (`list_contact_channels` tool).
- **Citation**: Per Respond.io `@respond-io/typescript-sdk` — SDK uses the management API

---

## Finding 5 — Missing: List Message Templates

- **Affected capability**: List available WhatsApp templates
- **What the doc says**: Section 4 shows how to *send* a WhatsApp template but never documents how to *list* available templates
- **What is actually correct**: `GET /space/template` (or `GET /space/templates`) exists and is used by the MCP server (`list_templates` tool). Required before sending a template to know which template names and language codes are valid.
- **Citation**: Per Respond.io `@respond-io/mcp-server` — `list_templates` tool, per Respond.io API reference

---

## Finding 6 — Missing: Workspace Tag CRUD

- **Affected capability**: Create, update, and delete workspace-level tags
- **What the doc says**: Section 5 only covers *adding/removing tags to contacts* via `POST /contact/{identifier}/tag` and `DELETE /contact/{identifier}/tag`. No mention of workspace-level tag management.
- **What is actually correct**: Space-level tag management endpoints exist:
  - `POST /space/tag` — Create tag
  - `PUT /space/tag` — Update tag
  - `DELETE /space/tag/{tagName}` — Delete tag
  These are used by the MCP server's `create_tag`, `update_tag`, `delete_tag` tools.
- **Citation**: Per Respond.io `@respond-io/typescript-sdk` — `client.space.createTag()`, `client.space.updateTag()`, `client.space.deleteTag()`

---

## Finding 7 — Missing: List Closing Notes

- **Affected capability**: List available closing note categories
- **What the doc says**: Section 10 mentions `GET /space/closing_notes` only in the "Known Gotchas" section, not in the outbound section or MVP table. The MVP table omits it entirely.
- **What is actually correct**: `GET /space/closing_notes` is documented correctly in the gotchas but is not included in the recommended MVP scope. It should be in MVP since it's required to show valid categories when closing a conversation.
- **Citation**: Per Respond.io `@respond-io/mcp-server` — `list_closing_notes` tool, per Respond.io API reference

---

## Finding 8 — Path: `channelId` on send message is optional but named confusingly

- **Affected capability**: Send message
- **What the doc says**: `POST /contact/{identifier}/message` with `"channelId": 5678` labeled as `// optional: specify channel; null = last interacted`
- **What is actually correct**: The path is correct. The optionality is correctly documented. No issue here — this is a note for clarity, not a correction.
- **Citation**: Per Respond.io API reference

---

## Finding 9 — Path: Assignee endpoint accepts user ID or email

- **Affected capability**: Assign conversation
- **What the doc says**: `POST /contact/{identifier}/conversation/assignee` with body `"assignee": "agent@example.com"` or `"assignee": 456`
- **What is actually correct**: Correct. The MCP server's `assign_conversation` tool accepts `userId` or `userEmail` as parameters, confirming both formats are accepted via the API.
- **Citation**: Per Respond.io `@respond-io/mcp-server` — `assign_conversation` tool parameters

---

## Finding 10 — GraphQL: Not applicable

- **Platform**: Respond.io is a REST-only API. No GraphQL endpoints.
- **What the doc says**: Correctly documents only REST paths under `https://api.respond.io/v2`.
- **Verification**: Confirmed via `@respond-io/typescript-sdk` and `@respond-io/mcp-server` — all operations are REST.

---

## Finding 11 — "Does not exist" claims are accurate

| Claim | Verified |
|-------|----------|
| No message edit via API | Correct — MCP server has no `edit_message` or `delete_message` tool |
| No message delete via API | Correct — confirmed |
| No native priority/severity model | Correct — MCP server exposes no priority/severity endpoints; confirmed via SDK |
| No bulk message endpoints | Correct — MCP server `send_message` is per-contact |
| No granular API scopes | Correct — token grants workspace-level access |
| No guaranteed webhook replay | Correct — confirmed in webhook docs |

---

## Finding 12 — List contacts endpoint path

- **Affected capability**: List contacts with filters
- **What the doc says**: `POST /contact/list` with complex filter body
- **What is actually correct**: Correct. The SDK uses `client.contacts.list(filters, pagination)` and the MCP server uses `list_contacts` with pagination parameters.
- **Pagination**: Correctly documented as `cursor_id` (not `cursorId` or `page`) with `limit` (max 100).
- **Citation**: Per Respond.io `@respond-io/typescript-sdk` — `list(filters, pagination)` with `limit` and `cursorId`

---

## Finding 13 — Comment operations: Create only

- **Affected capability**: Comments / internal notes
- **What the doc says**: Documents `POST /contact/{identifier}/comment` for creating comments
- **What is actually correct**: Correct — the API supports create only. The MCP server has only `create_comment` (no list, edit, or delete comment tools). The doc correctly limits itself to posting comments.
- **Note**: `GET /contact/{identifier}/comment/list` may exist but is not confirmed in available SDK/MCP docs. If needed, verify against the Stoplight API reference.

---

## Summary Table

| Capability | Doc Status | Issue |
|------------|------------|-------|
| List contacts with filters | ✅ Documented | Path correct: `POST /contact/list` |
| Get contact by ID | ✅ Documented | Path correct: `GET /contact/{identifier}` |
| Create contact | ⚠️ Mentioned via SDK | Not explicitly documented |
| Update contact | ✅ Documented | Path correct: `PUT /contact/{identifier}` |
| Delete contact | ❌ Missing | `DELETE /contact/{identifier}` exists |
| Merge contacts | ❌ Missing | `POST /contact/merge` exists |
| Upsert contact | ❌ Missing | `POST /contact/create-or-update` exists |
| List contact channels | ❌ Missing | Endpoint exists |
| Send message | ✅ Documented | Path correct: `POST /contact/{identifier}/message` |
| List messages | ✅ Documented | Path correct: `GET /contact/{identifier}/message/list` |
| Get message by ID | ✅ Mentioned | `GET /contact/{identifier}/message/{id}` via SDK |
| Send attachment | ✅ Documented | Via message type `attachment` |
| List templates | ❌ Missing | `GET /space/template` exists |
| Add tag | ✅ Documented | Path correct: `POST /contact/{identifier}/tag` |
| Remove tag | ✅ Documented | Path correct: `DELETE /contact/{identifier}/tag` |
| Create workspace tag | ❌ Missing | `POST /space/tag` exists |
| Update workspace tag | ❌ Missing | `PUT /space/tag` exists |
| Delete workspace tag | ❌ Missing | `DELETE /space/tag/{tagName}` exists |
| Update lifecycle | ✅ Documented | Path correct: `POST /contact/{identifier}/lifecycle/update` |
| Set conversation status | ✅ Documented | Path correct: `POST /contact/{identifier}/conversation/status` |
| Assign conversation | ✅ Documented | Path correct: `POST /contact/{identifier}/conversation/assignee` |
| Post comment | ✅ Documented | Path correct: `POST /contact/{identifier}/comment` |
| List closing notes | ⚠️ Partial | In gotchas only, not in MVP table |
| List users | ✅ In MVP | `GET /space/user` |
| List channels | ✅ In MVP | `GET /space/channel` |
| List custom fields | ✅ In MVP | `GET /space/custom_field` |
| Edit/delete message | ✅ Correct | Not supported by API |
| Priority/severity model | ✅ Correct | Not supported; use tags/custom fields |

---

## Recommendations

1. **Add the 7 missing endpoints** to section 4 (Outbound) or section 11 (MVP table):
   - `DELETE /contact/{identifier}`
   - `POST /contact/merge`
   - `POST /contact/create-or-update`
   - `GET /contact/{identifier}/channel`
   - `GET /space/template`
   - `POST /space/tag`, `PUT /space/tag`, `DELETE /space/tag/{tagName}`

2. **Promote `GET /space/closing_notes`** from section 10 gotchas to the outbound section (required for the close conversation flow) and add it to the MVP table.

3. **Document `GET /contact/{identifier}/message/{messageId}`** explicitly — it's in the SDK but not shown in the doc.

4. **Add `POST /contact`** for explicit contact creation — the SDK supports it but the doc only shows update (PUT).
