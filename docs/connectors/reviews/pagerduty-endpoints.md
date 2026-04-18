# PagerDuty — API Endpoint Coverage Review

**Verdict: APPROVE with minor issues.** The documented endpoints are correct for the capabilities SupportAgent needs. Three findings below.

---

## Finding 1: `POST /incidents/{id}/snooze` — duration=0 does NOT escalate

**Affected**: Escalate Incident (§4, "To escalate, use")

**What the doc says** (line 335):
```
POST /incidents/{id}/snooze
Body: { "duration": 0 }  // Setting duration=0 immediately escalates
```

**What is actually correct**: The `snooze` endpoint silences an incident for a set duration. Passing `duration: 0` likely results in a validation error or snoozes for 0 seconds (immediate unsnooze), not an escalation. Escalation is handled by `POST /incidents/{id}/responder_requests`, which the doc also documents. Remove the `snooze` with `duration: 0` workaround, or mark it explicitly as unverified.

**Citation**: Per PagerDuty OpenAPI spec (`reference/REST/openapiv3.json`) — `POST /incidents/{id}/snooze` takes a `duration` (integer, seconds) parameter. No escalation semantics are defined for this endpoint.

---

## Finding 2: Dedicated status/reassign endpoints missing from outbound docs

**Affected**: §4 Outbound — Writing Back

**What the doc says**: Uses `PUT /incidents/{id}` with `status: "acknowledged"`, `status: "resolved"`, and `assignments` for all state transitions and reassignment.

**What is actually correct**: The OpenAPI spec defines three dedicated action endpoints that are the canonical approach for these operations:
- `POST /incidents/{id}/acknowledge` — no body required
- `POST /incidents/{id}/resolve` — no body required (response body can include `resolution` string)
- `POST /incidents/{id}/reassign` — body: `{ user_ids: ["<USER_ID>"] }` or `{ assignees: [{ user: { id: "...", type: "user_reference" } }] }`

The `PUT /incidents/{id}` approach works — PagerDuty accepts status and assignments via that path too. But the dedicated endpoints are the documented, idiomatic approach in the OpenAPI spec. The doc should at minimum mention them alongside the PUT approach.

**Citation**: Per PagerDuty OpenAPI spec (`reference/REST/openapiv3.json`) — dedicated paths exist for `acknowledge`, `resolve`, and `reassign` on incidents.

---

## Finding 3: `POST /incidents/{id}/reassign` body format is uncertain

**Affected**: §4 "Reassign to Escalation Policy" and Phase 2 escalation

**What the doc says** (line 296–296):
```json
"assignments": [
  { "assignee": { "id": "<USER_ID>", "type": "user_reference" } }
]
```

**What is actually correct**: The OpenAPI spec shows `POST /incidents/{id}/reassign` accepts `user_ids[]` at the top level, not `assignments`. The doc's `assignments` format matches the `PUT /incidents/{id}` body, not the dedicated reassign endpoint.

Recommendation: For MVP, stick with `PUT /incidents/{id}` with `assignments` — it works. If Phase 2 uses the dedicated endpoint, verify the body shape against the live API.

**Citation**: Per PagerDuty OpenAPI spec (`reference/REST/openapiv3.json`).

---

## Endpoints verified as correct

| Capability | Endpoint | Method | Status |
|---|---|---|---|
| List incidents | `/incidents` | GET | ✓ correct |
| Get one incident | `/incidents/{id}` | GET | ✓ implied, should be explicit |
| Create incident | `/incidents` | POST | ✓ correct |
| Update incident (status/assign) | `/incidents/{id}` | PUT | ✓ correct |
| List notes | `/incidents/{id}/notes` | GET | ✓ correct |
| Post note | `/incidents/{id}/notes` | POST | ✓ correct |
| Edit note | — | — | ✓ doc correctly says "does not exist" |
| Delete note | — | — | ✓ doc correctly says "does not exist" |
| Snooze | `/incidents/{id}/snooze` | POST | ✓ path correct (see Finding 1) |
| Escalate / request responder | `/incidents/{id}/responder_requests` | POST | ✓ correct |
| Add/remove tags | `/{entity_type}/{id}/change_tags` | POST | ✓ correct |
| List tags | `/{entity_type}/{id}/tags` | GET | ✓ correct |
| List priorities | `/priorities` | GET | ✓ correct |
| Set priority | via `PUT /incidents/{id}` body | — | ✓ correct approach |
| Get user | `/users/{id}` | GET | ✓ correct |
| Get current user | `/users/me` | GET | ✓ correct |
| Search user by email | `/users?query=` | GET | ✓ correct |
| List log entries (incident) | `/incidents/{id}/log_entries` | GET | ✓ correct |
| List log entries (account) | `/log_entries` | GET | ✓ correct |
| Register webhook | `/extensions` | POST | ✓ correct |
| List services | `/services` | GET | ✓ correct |
| List teams | `/teams` | GET | ✓ correct |
| List on-calls | `/oncalls` | GET | ✓ correct |
| Create tag | `/tags` | POST | ✓ correct |
| List tags | `/tags` | GET | ✓ correct |

---

## Not documented (but may be useful)

- `GET /incidents/{id}/alerts` — list alerts under an incident (from Events API v2)
- `GET /incidents/{id}/timelines/feed` — structured timeline view
- `POST /incidents/{id}/acknowledge` — dedicated ack endpoint
- `POST /incidents/{id}/resolve` — dedicated resolve endpoint
- `POST /incidents/{id}/reassign` — dedicated reassign endpoint

None of these are required for MVP or Phase 2 as scoped. Flagging for awareness.

---

## Overall Assessment

The endpoint surface is complete for the documented MVP and Phase 2 scope. All documented endpoints use correct HTTP methods and paths. The `From` header requirement is correctly called out. Request body fields are accurate. The doc correctly identifies append-only notes, plan-gated priorities, and per-service webhooks as design constraints.
