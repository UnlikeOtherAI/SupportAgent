# PagerDuty Inbound Events Review

**Reviewer**: inbound-events auditor
**Source**: `docs/connectors/pagerduty.md`
**Scope**: webhook event completeness, payload shapes, signature verification, replay protection, delivery guarantees, polling fallback, mention detection. Excluded: auth, endpoint CRUD, rate limits.

---

## Verdict

**Review**: Mostly accurate. Three event types are missing or unconfirmed, one gap exists around response-management events, and replay protection is absent (by platform design — not a doc error). The event list and payload shapes are correct for what is documented.

---

## Findings

### 1. Missing event type: `incident.priority_update`

**Affected**: Priority-change detection, trigger mapping in §6.
**Problem**: The event table in §3 lists priority changes via `changed_fields` containing `"priority"` only. PagerDuty fires a dedicated `incident.priority_update` event (part of the response management webhook events) when a user manually changes priority. Relying solely on `changed_fields` for priority is fragile — `changed_fields` can be empty on first delivery (§10, gotcha: "changed_fields May Be Empty").
**Correction**: Add `incident.priority_update` to the webhook event table. The trigger mapping in §6 should read:

```
Priority change → event == "incident.priority_update" OR (changed_fields contains "priority" — fallback only)
```

The `changed_fields` fallback is acceptable but should be secondary.

---

### 2. Missing event types: response management

**Affected**: MVP scope in §11.
**Problem**: Several response-management event types exist and are relevant to SupportAgent's use case:

| Missing Event | When fired |
|---|---|
| `incident.refer` | Incident referred to another user or escalation policy |
| `incident.responder_declined` | A responder declined the request |
| `incident.responder_added` | A responder accepted and was added to the incident |

These are part of PagerDuty's responder request workflow. The MVP scope in §11 should note that these events may arrive and should be handled as informational (log or surface, no action required), even if not fully wired into the trigger engine.
**Correction**: Add these three event types to the webhook event table in §3 with a note that they are informational. Update §11 MVP scope to state that these are optional informational events.

---

### 3. `incident.delegate` — unconfirmed event name

**Affected**: Webhook event table in §3.
**Problem**: `incident.delegate` is listed as a distinct event type. PagerDuty's documented webhook event list does not include `incident.delegate` as a standalone event. Reassignment to a different escalation policy fires `incident.assign` (the incident's `escalation_policy` field changes, which is surfaced via `changed_fields`). "Delegate" may be the external name for a UI-level action that ultimately produces the same `incident.assign` event.
**Correction**: Confirm `incident.delegate` exists as an actual webhook event type by checking the PagerDuty Events API v2 webhook reference. If it does not exist, remove from the table. If it is an alias for `incident.assign`, note that in §3. Do not treat it as a distinct trigger without confirmation — it risks missing events if the actual event name differs.

---

### 4. `incident.annotate` payload — note content is correct

**Affected**: `incident.annotate` event, trigger mapping in §6.
**Problem**: None. The document correctly states that `log_entries[*].note` carries the note content for annotate events. The `log_entry.type` for notes is `notify_log_entry` (not `note` or `annotate`). Implementors should filter on `type == "notify_log_entry"` in addition to `event == "incident.annotate"` to avoid including system log entries.
**Correction**: Add a note in §3 that note-type log entries have `type: "notify_log_entry"`. The current payload example does not show this distinction.

---

### 5. Replay protection / timestamp tolerance — platform limitation

**Affected**: Signature verification section, §3.
**Problem**: The document does not address replay protection. PagerDuty does not enforce a timestamp window or provide a delivery timestamp header that can be used for replay detection. The top-level `created_on` field in the webhook payload is the webhook creation time, not a monotonic sequence number.
**Correction**: Add a note in the signature verification section:

> PagerDuty does not provide a timestamp header for replay protection. The webhook has no built-in mechanism to detect or reject delayed deliveries. The connector should rely on at-least-once delivery semantics (see §6) and idempotent processing (deduplicate by `id` of the webhook payload) rather than timestamp-based expiry.

This is not a doc error — it's a platform gap. Documenting it prevents implementors from building a protection that PagerDuty doesn't support.

---

### 6. No tag-change webhook confirmed

**Affected**: §10 gotcha, §6 trigger mapping.
**Problem**: None. The document correctly states that tag add/remove events are not sent via webhook and must be polled via `GET /incidents/{id}/tags`. This is accurate.
**Correction**: No change. The note in §10 ("Tags Are Not in Webhook Payloads") is correct. The workaround via polling is the right approach.

---

### 7. Mention detection — no native @mention system

**Affected**: Trigger mapping in §6.
**Problem**: PagerDuty notes have no native @mention syntax. There is no `mentions[]` array in the payload and no `@user` parsing convention. Bot mention detection is not possible from the webhook payload alone — it would require text-matching on `log_entries[*].note` against the bot's known user reference.
**Correction**: In §6 trigger mapping, remove the "mention" row (it does not apply to PagerDuty). Add a note:

> **Bot mention detection**: PagerDuty has no native @mention system. Notes are plain text. To detect whether SupportAgent was addressed, the connector should text-match note content against known bot user name or email patterns. This is unreliable for false-positive avoidance — treat as soft signal only.

This is not a doc error; the current document correctly omits a mentions trigger row. Flagging it ensures no future editor incorrectly adds one.

---

### 8. Polling fallback — note deduplication requirement

**Affected**: Polling fallback section, §3.
**Problem**: The polling strategy section correctly describes `GET /incidents` with `since` and `include[]=log_entries`. However, it does not specify how to deduplicate events found via polling vs. webhook delivery. Without deduplication, polling reconciliation could re-process incidents already handled via webhook.
**Correction**: Add to the polling fallback section:

> **Deduplication**: Polling results may include incidents already processed via webhook. Store the webhook payload `id` (the webhook event ID, not the incident ID) and skip processing if the webhook ID was already handled. The incident's `id` alone is not sufficient for deduplication because the same incident fires multiple webhook events over its lifecycle.

This is a common implementation error that this note prevents.

---

### 9. `incident_number` in webhook payload — confirmed present

**Affected**: Payload structure, §3.
**Problem**: None. The `incident.incident_number` field (integer, unique per account) is correctly listed in the payload example and in the "Key fields to persist" table. No correction needed.

---

### 10. `no_self_retrigger` via `agent.id` — correct approach

**Affected**: §6 trigger mapping, §11 recommended scope.
**Problem**: None. Using `log_entries[*].agent.id` to detect the bot's own actions is correct. PagerDuty records the acting user as the `agent` on log entries. The bot's PagerDuty user ID must be configured (stored as part of the connector setup) and compared against `agent.id` in each webhook.
**Correction**: No change. This is correctly documented.

---

### 11. Webhook delivery guarantees — at-least-once with ~24h retry

**Affected**: §3 delivery semantics.
**Problem**: None. The document correctly states: exponential backoff, ~24 hours, HTTP 2xx = success. This is accurate.
**Correction**: No change.

---

### 12. Eventual-consistency gap — `incident.annotate` timing

**Affected**: Polling fallback, §3.
**Problem**: When `incident.annotate` fires, the note content is in the webhook `log_entries` immediately. For polling fallback (reconciling via `GET /incidents/{id}/log_entries`), the note may not be readable for a brief window after the event fires. PagerDuty's log entries API is eventually consistent — a note posted synchronously may take a few seconds to appear in the API.
**Correction**: Add to the polling section:

> **Eventual consistency**: When reconciling via `GET /incidents/{id}/log_entries`, log entries may not be immediately readable after an incident is created or a note is posted. Retry with a short delay (1–2 seconds) or poll twice with a gap if detecting new notes is critical.

This applies only to polling fallback, not to webhook intake where the note is included directly.

---

## Summary of Corrections

| # | Section | Change |
|---|---|---|
| 1 | §3 event table, §6 trigger mapping | Add `incident.priority_update` event. Mark `changed_fields` as fallback only. |
| 2 | §3 event table | Add `incident.refer`, `incident.responder_declined`, `incident.responder_added` as informational. |
| 3 | §3 event table | Verify or remove `incident.delegate` — unconfirmed as distinct event type. |
| 4 | §3 annotate payload | Add note: note-type log entries have `type: "notify_log_entry"`. |
| 5 | §3 signature verification | Add replay protection gap note — PagerDuty has none, use idempotent processing. |
| 6 | (None — confirmed correct) | Tag-change webhook absence is correct. Polling workaround is right. |
| 7 | §6 trigger mapping | Remove mention row (not applicable). Add text-match note for bot mention detection. |
| 8 | §3 polling fallback | Add deduplication note using webhook `id`, not incident `id`. |
| 9 | (None — confirmed correct) | `incident_number` in webhook payload is accurate. |
| 10 | (None — confirmed correct) | `agent.id` for loop prevention is correct. |
| 11 | (None — confirmed correct) | At-least-once delivery semantics are accurate. |
| 12 | §3 polling fallback | Add eventual-consistency note for log entries API. |

---

## Out of Scope (other reviewers)

- **Auth**: API key format, `From` header, OAuth flow — covered by auth reviewer.
- **Endpoint CRUD**: `POST /extensions` registration, secret management — covered by endpoint reviewer.
- **Rate limits**: 1000/min standard, 250/min Lite, 429 handling — covered by rate limits reviewer.