# Microsoft Teams Connector — Operational Reliability Review

**Reviewer scope:** rate limits, pagination, retries, error handling, bulk operations.
**Source:** `docs/connectors/microsoft_teams.md`
**Reference:** Microsoft Graph throttling guidance (2025-01-14, updated 2025-08-06), JSON batching docs (2025-02-21), `channel-list-messages` API reference (updated 2026-04-10).

---

## Verdict

**Conditional pass.** The doc correctly surfaces the high-level patterns (429 + Retry-After, OData pagination via `@odata.nextLink`, batch semantics, delta queries). However, it contains specific factual errors in the rate-limit section (Section 8) and pagination max `$top` claims that will cause implementers to misconfigure their clients. The most critical gap is the missing global Graph API limit of 130,000 req/10s/app.

---

## Findings

### 1. Rate Limits — Missing Global Graph API Cap

**Area:** Section 8 (Rate Limits)

**Claim:** No mention of the global Microsoft Graph request ceiling.

**Correct behavior:** Microsoft Graph enforces a global limit of **130,000 requests per 10 seconds** per application across all tenants. This cap sits above per-workload limits. When hit, it returns HTTP 429 with a `Retry-After` header.

**Impact:** HIGH. An app operating across many tenants can exhaust the global cap without realizing it. The doc's "Context-dependent; implement exponential backoff" for messages is too vague to be actionable on its own — implementers need the global ceiling for capacity planning.

**Fix:** Add a "Global Graph API Limits" row at the top of the rate-limits table: `130,000 requests / 10 seconds` per app (all tenants combined).

---

### 2. Rate Limits — Teams Message Ops Have No Published Per-App-Per-Tenant Number

**Area:** Section 8, "Messages per app per tenant" row

**Claim:** "Context-dependent; implement exponential backoff."

**Correct behavior:** The Teams workload (as of the current service-specific throttling limits page) does **not** publish a fixed per-app-per-tenant number for message read/write operations. The guidance from Microsoft is exactly what the doc states: the limit is context-dependent and you must handle 429s. However, this vagueness should be explicit — the doc should state that **no specific Teams message rate limit is publicly documented** and that the actual threshold depends on tenant size, request type (read vs write), and concurrent load across the app's tenant footprint.

**Impact:** MEDIUM. The statement is technically accurate but could mislead an implementer into thinking there's a number they should find. Clarify that no fixed number exists and that the correct strategy is: receive 429, honor Retry-After, back off.

---

### 3. Rate Limits — Subscriptions Per-App Limit Is Wrong

**Area:** Section 8, "Subscriptions per app" row

**Claim:** "1 per resource path per tenant."

**Correct behavior:** The current guidance states **1 subscription per app per tenant per resource type** (not "per resource path"). For Teams, you can hold one subscription on `teams/{id}/channels/{id}/messages` per tenant. However, the more relevant limit is the **total subscription count per app per tenant**, which is tied to the app's permission scope and is not a hard "1" — you can have multiple subscriptions for different resource paths in the same tenant. The exact cap varies by permission level.

**Impact:** MEDIUM. The "1 per resource path" framing is imprecise. An implementer might incorrectly assume a hard cap of 1 total subscription, or might think they're safe holding one subscription per channel. Reality: one subscription per resource type per tenant, and the total count across all resource types is bounded by the app's registered permissions.

**Fix:** Clarify: "1 subscription per app per tenant per resource type (e.g., channel messages, chat messages, team membership). Multiple subscriptions across different resource types are permitted within a tenant."

---

### 4. Pagination — `$top` Max Is Wrong for Channel Messages

**Area:** Section 8 ("Max `$top`: often 999") and Section 9 ("`$top` supports up to 999 on most endpoints")

**Claim:** `$top` supports up to 999 on most endpoints. Default is 100.

**Correct behavior:** The `channel-list-messages` endpoint has a **default page size of 20** and a **maximum `$top` of 50** (not 999, not 100 default). This is per the official API reference, updated 2026-04-10. For chat messages, the limit may differ. For general OData endpoints, 999 is a common ceiling — but for Teams messages specifically, 50 is the cap.

**Impact:** HIGH. A connector configured to request `$top=100` or `$top=50` on this endpoint will get a 400 error. `$top=50` is the safe ceiling; default is 20. If the connector ever tries `$top=100` it will fail.

**Fix:** Split the claim. For `channel-list-messages`: default 20, max 50. For `chat-list-messages`: default 50, max 50 (verify). For general OData endpoints: default 100, max 999. Do not generalize "often 999" without calling out Teams messages explicitly.

---

### 5. Pagination — Delta Query Mechanics Are Correct

**Area:** Section 9 (Pagination & Search)

**Claim:** `@odata.deltaLink` stores the cursor; `@odata.nextLink` continues paging; delta tokens are used to resume incremental sync.

**Correct behavior:** Correct. Delta queries return `@odata.nextLink` for continuing within the current sync round and `@odata.deltaLink` when the sync is complete (stores the next sync's starting point). The doc's description of delta query mechanics is accurate.

**Note:** Delta query history has a practical retention window (Microsoft does not publish an exact duration). If a delta token is used after the data window closes, the API returns an error. The connector should handle this gracefully by falling back to a full sync with deduplication.

**Impact:** LOW. The mechanics are correct; the delta token expiry risk should be called out as a gotcha.

---

### 6. Retry Semantics — Correct

**Area:** Section 8 (429 + Retry-After)

**Claim:** "Microsoft Graph returns HTTP 429 with a Retry-After header (seconds to wait)."

**Correct behavior:** Correct. The 429 response body also includes `"error": { "code": "TooManyRequests", "message": "Please retry again later." }` with an `innerError` containing the request-id and timestamp. The `Retry-After` header value is an integer representing seconds.

**Correct backoff:** The doc recommends using the Graph SDK (handles Retry-After automatically) or, if no Retry-After is present, implementing exponential backoff. This is the right guidance. The doc correctly notes that "avoiding immediate retries" is critical because all requests accrue against usage limits.

**Impact:** LOW. The retry guidance is sound.

---

### 7. Batching — Max Request Count Is Exactly 20, Not "~20"

**Area:** Section 8 and Section 12

**Claim:** "combine up to ~20 requests per batch."

**Correct behavior:** The batch limit is **exactly 20** individual requests per JSON batch. There is no "up to approximately 20" — it is a hard cap of 20. The batching docs (updated 2025-02-21) state this as a fixed limit.

**Impact:** MEDIUM. Using "~20" suggests flexibility that doesn't exist. If an implementer batches 21 requests, the 21st will be silently dropped or cause a 400. Use "up to 20" not "~20".

**Also correct:** Per-batch throttling evaluation is correctly described. Individual requests within a batch that hit rate limits return 429 in their individual response slot; the batch HTTP response itself is 200 OK. The batch itself does not fail atomically — you must inspect each response's status code.

---

### 8. Error Response Shape — Correct

**Area:** Section 8

**Claim:** Implicit throughout (referenced via 429 example).

**Correct behavior:** Graph API returns `application/json` with an `error` object containing `code`, `message`, and `innerError`. Not RFC 7807 Problem Details. The doc's implicit characterization is consistent with reality.

**Impact:** None. Correct.

---

### 9. Concurrency Recommendation — Sound But Incomplete

**Area:** Section 8 (Best practice)

**Claim:** "Use a message queue to smooth bursty sends, use delta queries instead of full-list polling."

**Correct behavior:** Correct advice. Additionally, the doc should recommend a **concurrency cap of 1 in-flight request per app per tenant per resource type** when writing messages, given that no published per-request limit exists for Teams message POSTs. For reads, 3-5 concurrent requests per tenant is a reasonable starting point, monitored and backed off on 429.

**Impact:** MEDIUM. The concurrency guidance would benefit from concrete numbers. Recommend: 1 concurrent write per tenant, 3-5 concurrent reads per tenant, back off to 1 on any 429.

---

### 10. Subscription Expiration — Correct

**Area:** Section 8 ("Subscription max lifetime: 4230 minutes (~3 days)")

**Claim:** "4230 minutes (~3 days)."

**Correct behavior:** Correct. 4230 minutes = 70.5 hours ≈ 3 days. This is the current maximum subscription lifetime for Teams change notifications.

**Impact:** None. Correct.

---

## Summary Table

| # | Area | Severity | Claim in Doc | Correct Value |
|---|---|---|---|---|
| 1 | Global Graph limit | HIGH | Not mentioned | 130,000 req/10s/app (all tenants) |
| 2 | Teams message rate limit | MEDIUM | "Context-dependent" | No fixed number published; 429 + Retry-After is correct strategy |
| 3 | Subscription per-app limit | MEDIUM | "1 per resource path per tenant" | 1 per app per tenant per resource type; total bounded by permissions |
| 4 | Channel message `$top` max | HIGH | "999" | 50 for channel messages (default: 20) |
| 5 | Delta query mechanics | LOW | Correct with minor gap | Correct; add delta token expiry as gotcha |
| 6 | Retry-After semantics | LOW | Correct | Correct |
| 7 | Batch max size | MEDIUM | "~20" | Exactly 20 (hard cap) |
| 8 | Error response shape | LOW | Correct | Correct (application/json + error object) |
| 9 | Concurrency limits | MEDIUM | "message queue" | Add concrete numbers: 1 write/tenant, 3-5 reads/tenant |
| 10 | Subscription lifetime | LOW | Correct | 4230 minutes (~3 days) |

---

## Recommendations (Priority Order)

1. **Add global Graph cap** to Section 8: `130,000 requests / 10 seconds` per app across all tenants.
2. **Fix `$top` max** for channel messages to 50 (not 999) in Sections 8 and 9. Separate from general OData defaults.
3. **Clarify subscription limit** wording from "1 per resource path" to "1 per resource type per tenant."
4. **Change "~20" to "up to 20"** for batch limits.
5. **Add concrete concurrency numbers** to the best-practice paragraph: 1 concurrent write per tenant, 3-5 reads per tenant.
6. **Add delta token expiry handling** as a known gotcha (fall back to full sync + dedup when token is stale).
