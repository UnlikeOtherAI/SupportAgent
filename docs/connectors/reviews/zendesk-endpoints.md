# Zendesk Endpoints Review

**Verdict: Needs correction.** 4 material issues found. Most endpoints are correct; the main problems are a hallucinated DELETE comments endpoint and an inverted tag-additive vs tag-replace operation.

---

## Findings

### 1. DELETE comments — hallucinated endpoint

- **Endpoint affected:** Delete comment / internal note
- **What the doc says (line 209-211):**
  ```
  DELETE /api/v2/tickets/{ticket_id}/comments/{comment_id}.json
  ```
- **What is actually correct:** No DELETE endpoint exists for ticket comments (public or internal). The Ticket Comments API has no delete endpoint at all. The only available comment-modification operations are redaction (`PUT /api/v2/tickets/{ticket_id}/comments/{ticket_comment_id}/redact`) and make-private (`PUT /api/v2/tickets/{ticket_id}/comments/{ticket_comment_id}/make_private`). The doc's DELETE line is hallucinated.
- **Citation:** per Zendesk API reference — Ticket Comments endpoint list at `https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_comments/`

### 2. Tag operations — PUT and POST semantics inverted

- **Endpoint affected:** Add/remove tags
- **What the doc says (line 233-247):**
  - `PUT /api/v2/tickets/{id}.json` with `tags` array for add/remove
  - "Incremental tag operations are not available; must replace full tag set"
  - Phase 2 says `(no such endpoint; implement tag merge)` for `/api/v2/tickets/{id}/tags`
- **What is actually correct:** Zendesk provides dedicated tag endpoints:
  - `PUT /api/v2/tickets/{ticket_id}/tags` — **adds** tags incrementally
  - `DELETE /api/v2/tickets/{ticket_id}/tags` — **removes** tags incrementally
  - `POST /api/v2/tickets/{ticket_id}/tags` — **replaces/sets** full tag set
  - `GET /api/v2/tickets/{ticket_id}/tags` — lists tags for a ticket
  - `GET /api/v2/tags` — lists all tags in the account

  The doc has it backwards: POST sets (replace), PUT adds (incrementally), DELETE removes. The Phase 2 comment `(no such endpoint; implement tag merge)` is also wrong — the dedicated endpoint exists and does incremental add/remove already.
- **Citation:** per Zendesk API reference — Tags endpoint list at `https://developer.zendesk.com/api-reference/ticketing/ticket-management/tags/`

### 3. Attachment upload — path should not include `.json`

- **Endpoint affected:** Attach file / upload
- **What the doc says (line 319):**
  ```
  POST /api/v2/uploads.json
  ```
- **What is actually correct:** The path is `POST /api/v2/uploads` (no `.json` extension). The `filename` is a required query parameter: `POST /api/v2/uploads?filename=attachment.pdf`. The header should be `Content-Type: application/binary` (multipart form upload). The doc's path with `.json` is wrong.
- **Citation:** per Zendesk API reference — Ticket Attachments at `https://developer.zendesk.com/api-reference/ticketing/tickets/ticket-attachments/`

### 4. Delete ticket — not documented

- **Endpoint affected:** Delete / close ticket
- **What the doc says:** No mention of a delete endpoint
- **What is actually correct:** `DELETE /api/v2/tickets/{ticket_id}` is a valid endpoint (no `.json` suffix). The doc lists close/resolve via status change but omits the actual delete operation. Low impact since SupportAgent likely never deletes tickets, but worth noting for completeness.
- **Citation:** per Zendesk API reference — Tickets endpoint list at `https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/`

---

## Capabilities: All Others Verified Correct

| Capability | Endpoint | Method | Status |
|------------|----------|--------|--------|
| List tickets | `/api/v2/tickets` | GET | OK — doc shows both cursor (`page[size]`) and offset pagination |
| Get ticket | `/api/v2/tickets/{id}` | GET | OK |
| Create ticket | `/api/v2/tickets` | POST | OK — `comment` is required body field, correct |
| Update ticket | `/api/v2/tickets/{id}` | PUT | OK |
| Post comment | `/api/v2/tickets/{id}` | PUT with `ticket.comment` | OK — correctly notes comments are created via Tickets API |
| Edit comment | — | — | OK — correctly states no edit endpoint |
| Delete comment | — | — | OK in conclusion (line 205) but line 210 shows a DELETE path that doesn't exist |
| List comments | `/api/v2/tickets/{id}/comments` | GET | OK |
| Add tags | `/api/v2/tickets/{id}/tags` | PUT | **Wrong** — see finding #2 |
| Remove tags | `/api/v2/tickets/{id}/tags` | DELETE | **Wrong** — see finding #2 |
| Set tags | `/api/v2/tickets/{id}/tags` | POST | **Wrong** — see finding #2 |
| Change priority | `/api/v2/tickets/{id}` with `priority` | PUT | OK |
| Change status | `/api/v2/tickets/{id}` with `status` | PUT | OK |
| Assign user | `/api/v2/tickets/{id}` with `assignee_id` | PUT | OK |
| Mention user | `@{user_name}` in comment body | — | OK — plain text mention, resolves in UI |
| Attach file | `/api/v2/uploads` with `filename` query param | POST | **Wrong path** — see finding #3 |
| Delete ticket | `/api/v2/tickets/{id}` | DELETE | **Missing** — see finding #4 |
| Search tickets | `/api/v2/search?query=` | GET | OK |
| User lookup | `/api/v2/users/{id}` | GET | OK |

---

## Minor Notes

- **Upload path format:** Zendesk APIs accept both `/api/v2/uploads` and `/api/v2/uploads.json` in practice, but the canonical form per official docs is without `.json`. Using the non-canonical form may work but risks future breakage.
- **Search pagination:** Official docs confirm search uses offset pagination (`per_page`, `page`) with a max of 100 per page and 1,000 total results. The doc correctly shows this. Note: there is also a `GET /api/v2/search/export` with cursor pagination for bulk exports.
- **Optimistic locking (409):** The doc correctly calls out the May 2025 breaking change. This is accurate.
- **GraphQL:** Zendesk is REST-only for the Support API. No GraphQL concerns.
