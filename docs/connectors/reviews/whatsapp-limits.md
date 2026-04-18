# WhatsApp Business Connector — Operational Reliability Review

**Reviewer scope:** rate limits, pagination, retries, error handling, bulk operations.
**Source:** `docs/connectors/whatsapp.md`
**Reference:** WhatsApp Business Platform Cloud API Overview (2024, archived), WhatsApp Business Messaging Limits (2025, archived), Meta for Developers error codes.

---

## Verdict

**Conditional pass with corrections required.** The doc correctly identifies the absence of pagination, bulk endpoints, and message history APIs. Retry guidance and webhook delivery semantics are accurate. However, Section 8 (Rate Limits) contains a fundamentally wrong model: it describes a fictional "tier" system (Unverified/Verified/High Quality/Enterprise) and assigns incorrect numbers. The correct model is throughput-per-phone-number (80/1,000 mps) plus portfolio-level daily contact limits (250 → 2,000 → 10,000 → 100,000 → unlimited). These are separate concepts and should not be conflated.

---

## Findings

### 1. Rate Limits — Entire Section 8.1 Uses Wrong Model

**Area:** Section 8.1 (Limits by Tier)

**Claim:**
| Tier | Messages/second | Monthly sent limit |
|---|---|---|
| Unverified WABA | 20 | 250 |
| Verified WABA | 80 | 1,000 |
| High quality | 250 | 10,000 |
| Enterprise | 1,000 | Unlimited |

**Correct behavior:** WhatsApp does not use a tier system with these names. The doc conflates two separate concepts:

1. **Throughput (messages per second):** Per business phone number. Default: **80 mps**. After automatic upgrade eligibility: **1,000 mps**. This is the correct per-second number. Source: [Cloud API Overview](https://web.archive.org/web/2025/https://developers.facebook.com/docs/whatsapp/cloud-api/overview):
   > "For each registered business phone number, Cloud API supports up to 80 messages per second (mps) by default, and up to 1,000 mps by automatic upgrade."

2. **Messaging limits (daily unique contacts):** Per business portfolio. Not monthly. These are the maximum unique WhatsApp user phone numbers you can message outside customer service windows in a rolling 24-hour period:
   - Initial: **250** (newly created portfolios)
   - After scaling path: **2,000**
   - After automatic scaling: **10,000 → 100,000 → Unlimited**
   Source: [Messaging Limits](https://web.archive.org/web/2025/https://developers.facebook.com/docs/whatsapp/api/rate-limits)

The "monthly sent limit" numbers (250, 1,000, 10,000) appear to be misremembered daily contact limits. The 80 mps default is correct but belongs in the throughput bucket, not under "Verified WABA."

**Impact:** HIGH. An implementer reading this will plan capacity around the wrong numbers. The "Unverified WABA = 20 msg/sec" claim has no basis in current documentation.

**Fix:** Rewrite Section 8.1 entirely. Separate into two tables:
- **Throughput:** Default 80 mps per phone number; upgradeable to 1,000 mps per phone number (requires Medium+ quality rating, unlimited daily contacts eligibility).
- **Daily Contact Limit:** 250 → 2,000 → 10,000 → 100,000 → unlimited at portfolio level (shared across all phone numbers).

---

### 2. Rate Limits — Per-Conversation Limit Is Mischaracterized

**Area:** Section 8.2 (Per-Conversation Limits)

**Claim:** "Session messages: 15 messages/minute per conversation"

**Correct behavior:** The official docs do not document a 15 msg/min per-conversation limit for the Cloud API. The doc may be confusing this with WhatsApp's anti-spam pair rate limit (see below) or with user-facing restrictions.

The most relevant per-conversation limit is the **pair rate limit** documented in the Cloud API Overview:
- 1 message every 6 seconds to the same WhatsApp user (~0.17 mps, ~10 msg/min, ~600 msg/hour).
- Can burst up to 45 messages within 6 seconds, but then must wait proportionally.

Error code for pair rate limit: **131056** (not to be confused with the throughput limit 130429).

Source: [Cloud API Overview](https://web.archive.org/web/2025/https://developers.facebook.com/docs/whatsapp/cloud-api/overview):
> "Business phone numbers are limited to sending 1 message every 6 seconds to the same WhatsApp user phone number (0.17 messages/second). This is roughly equivalent to 10 messages per minute, or 600 messages per hour."

**Impact:** MEDIUM. The 15 msg/min claim is undocumented and may not reflect real API behavior. The pair rate limit is the actual constraint for repeated messages to the same user.

**Fix:** Replace the "15 messages/minute per conversation" claim with the documented pair rate limit: 1 msg per 6 sec to the same user (~10 msg/min, 600/hr), burst up to 45 within 6 sec, then proportionally gated.

---

### 3. Rate Limits — Error Code 131030 vs 130429

**Area:** Section 8.3 (How Rate-Limit Info is Exposed)

**Claim:** Error code `131030` for rate limit exceeded:
```json
"error": {
  "code": 131030,
  "error_data": {
    "details": "Rate limit exceeded for phone number ID"
  }
}
```

**Correct behavior:** The Cloud API Overview (2024) documents error code **130429** for throughput limit exceeded:
> "If you attempt to send more messages than your current throughput level allows, the API will return error code 130429 until you are within your allowed level again."

Error code **131056** is for pair rate limit exceeded.

Error code **131030** may be a legacy code or a different category. The doc's example body structure (with `error_data.details`) may also differ from the actual response.

**Impact:** MEDIUM. If the wrong error code is used in the connector's detection logic, rate limit errors may be missed or misclassified.

**Fix:** Use error code **130429** for throughput limits and **131056** for pair rate limits. Verify the actual response body schema against a live 429 response.

---

### 4. Rate Limits — No Retry-After Header Mentioned

**Area:** Section 8.3

**Claim:** "No `Retry-After` header in the traditional sense."

**Correct behavior:** This is correct — WhatsApp does not include a `Retry-After` header in rate limit responses. The exponential backoff recommendation (1s, 2s, 4s, 8s, 16s, max 30s) is sound. For pair rate limit bursts specifically, Meta recommends: try again after `4^X` seconds, where X increments on each failed attempt until success.

Source: Cloud API Overview:
> "If necessary, you can send up to 45 messages within 6 seconds as a burst. If you send a burst, you are essentially borrowing against your pair rate limit, so you will be prevented from sending subsequent messages to the same user until the amount of time it would normally take to send that many 'non-burst' messages to the user has passed. To avoid having to calculate post-burst message wait times, we recommend that if a message send request fails after sending a burst, you try again 4^X seconds later."

**Impact:** LOW. The recommendation is correct. The additional guidance on burst backoff would improve robustness.

**Fix:** Add the 4^X backoff guidance for pair rate limit scenarios.

---

### 5. Pagination — Correctly Identified as Absent

**Area:** Section 9.1

**Claim:** "WhatsApp Cloud API does not support pagination for message history."

**Correct behavior:** Correct. The Cloud API has no cursor-based pagination, no page tokens, and no offset/limit pagination for messages. The `/messages` endpoint does not return lists of messages. The only read capability is single-message lookup by ID: `GET /{message-id}?phone_number_id={phone-number-id}`.

Source: Cloud API Overview confirms no message history endpoint exists.

**Impact:** None. This is correctly documented.

---

### 6. Bulk/Batch Endpoints — Correctly Identified as Absent

**Area:** Section 8.5

**Claim:** "No batch message endpoint exists. Each message is a separate API call."

**Correct behavior:** Correct. WhatsApp Cloud API does not support batch sending. Every `POST /{phone-number-id}/messages` sends exactly one message. This is confirmed by the API reference.

**Correct mitigation suggestions in doc:**
- Use interactive list/buttons to collect multiple pieces of information in one exchange
- Send media links instead of uploading per-message
- Webhooks are free (no limit on inbound)

**Impact:** None. This is correctly documented.

---

### 7. Error Response Shape — Partially Correct

**Area:** Section 8.3 and Appendix B

**Claim:** Rate limit error uses OAuthException type with code 131030.

**Correct behavior:** The Graph API (which underpins WhatsApp Cloud API) returns errors in a nested structure. The exact shape varies by endpoint. Based on Cloud API Overview, the throughput error is code 130429 (not 131030). The pair rate limit is code 131056.

**Appendix B correctly lists:** `131030` — "Too many requests" — but this code should be verified against live API responses.

**Impact:** LOW. The error structure is broadly correct (Graph API error format), but specific codes should be verified.

**Fix:** Cross-reference error codes against actual API responses. Prefer codes 130429 (throughput) and 131056 (pair rate).

---

### 8. Template Message Limits — Correct Direction, Unclear Scope

**Area:** Section 8.4

**Claim:** "Marketing templates: 1 contact per day per template (unless customer opts in). Utility templates: Higher frequency allowed. Authentication templates: Highest frequency."

**Correct behavior:** The daily contact limit applies at the **portfolio level**, not per template. Within a 24-hour period, you can message a given contact once with a given template outside the session window. The doc's framing of "1 contact per day per template" is directionally correct but imprecise — it's "1 per contact per template per 24-hour window," and this is shared quota against the portfolio's daily contact limit.

**Impact:** LOW. The direction is right; the framing could cause confusion about whether the limit is per-template or per-contact.

**Fix:** Clarify: "Marketing templates can be sent to a given contact once per 24-hour window outside session, subject to the portfolio's daily contact limit. Utility and authentication templates have higher frequency allowances."

---

### 9. Retry Semantics — Webhook Delivery Correct

**Area:** Section 3.3

**Claim:** "Meta retries webhook delivery up to 7 times with exponential backoff if your endpoint returns non-2xx."

**Correct behavior:** Correct. Cloud API Overview states:
> "We will attempt to re-deliver failed webhooks for up to 7 days, with exponential backoff."

The doc says 7 retries (not 7 days) — the retry duration is actually up to 7 days, not 7 attempts. The distinction matters for reliability planning.

**Impact:** MEDIUM. The doc understates the retry window. Meta retries for up to 7 days, not 7 times.

**Fix:** Change "up to 7 times" to "for up to 7 days, with exponential backoff."

---

### 10. Throughput Upgrade Eligibility — Missing From Doc

**Area:** Section 8 (should be added)

**Claim:** Not mentioned.

**Correct behavior:** To be upgraded from 80 mps to 1,000 mps, the business phone number must meet eligibility requirements:
- Able to initiate conversations with unlimited unique customers in a rolling 24-hour period (i.e., unlimited daily contact tier)
- Registered for Cloud API (not On-Premises)
- Medium quality rating or higher
- Upgrade takes up to 1 minute; during upgrade, API returns error code 131057

Source: [Cloud API Overview](https://web.archive.org/web/2025/https://developers.facebook.com/docs/whatsapp/cloud-api/overview)

**Impact:** MEDIUM. An implementer won't know what triggers the throughput upgrade, or why their 1,000 mps limit might not activate.

**Fix:** Add eligibility requirements for 1,000 mps upgrade.

---

### 11. Webhook Capacity Planning — Correct

**Area:** Section 3 (implied)

**Claim:** Not explicitly stated in rate limits section.

**Correct behavior:** Cloud API Overview provides webhook capacity guidance:
> "Your webhook servers should be able to withstand 3x the capacity of outgoing message traffic and 1x the capacity of expected incoming message traffic."

Latency standards:
- Median latency: ≤250ms
- Less than 1% latency exceeds 1s

**Impact:** LOW. This guidance should be in the doc for operational planning.

**Fix:** Add webhook capacity planning guidance.

---

### 12. Concurrency Recommendation — Absent

**Area:** Section 8 (should be added)

**Claim:** Not mentioned.

**Correct behavior:** Given the 80/1,000 mps per-phone-number throughput and the lack of published per-request concurrency limits, a sensible concurrency model is:
- Per phone number: cap concurrent outbound message requests at ~10-20 (to stay well within throughput headroom)
- Per conversation (same user): max 1 in-flight request (respecting the pair rate limit of 1 msg/6s)
- Use a message queue to smooth burst sends

**Impact:** MEDIUM. Without concurrency guidance, implementers may either under-utilize capacity or accidentally exceed throughput limits.

**Fix:** Add concurrency guidance: cap concurrent sends per phone number, max 1 concurrent send per contact.

---

## Summary Table

| # | Area | Severity | Claim in Doc | Correct Value |
|---|---|---|---|---|
| 1 | Rate limit model | HIGH | "Tier" system (Unverified 20/250, Verified 80/1K, etc.) | Separate throughput (80/1,000 mps per phone) and daily contact limits (250→unlimited per portfolio) |
| 2 | Per-conversation limit | MEDIUM | "15 messages/minute per conversation" | Pair rate limit: 1 msg/6s to same user (~10/min, 600/hr); burst up to 45 then gated |
| 3 | Rate limit error code | MEDIUM | Error code 131030 | Throughput limit: 130429; Pair rate limit: 131056 |
| 4 | Retry-After header | LOW | No Retry-After header (correct) | Correct; add 4^X backoff for pair limit bursts |
| 5 | Pagination | — | None (correct) | Correct: no pagination for message history |
| 6 | Bulk endpoints | — | None (correct) | Correct: no batch send endpoint |
| 7 | Error response shape | LOW | OAuthException with code 131030 | Verify against live 429 response; codes are 130429/131056 |
| 8 | Template limits framing | LOW | "1 contact per day per template" | Shared quota: 1 per contact per template per 24h, against portfolio limit |
| 9 | Webhook retry window | MEDIUM | "Up to 7 times" | Up to 7 days, with exponential backoff |
| 10 | Throughput upgrade eligibility | MEDIUM | Not mentioned | Requires: unlimited daily contacts tier, Medium+ quality, Cloud API registration |
| 11 | Webhook capacity | LOW | Not mentioned | 3x outbound traffic capacity; 1x inbound; median latency ≤250ms |
| 12 | Concurrency guidance | MEDIUM | Not mentioned | Cap concurrent sends per phone number (~10-20); max 1 per contact |

---

## Recommendations (Priority Order)

1. **Rewrite Section 8.1 entirely.** Replace the fictional tier table with two separate tables: throughput (80/1,000 mps per phone) and daily contact limits (250→unlimited per portfolio).
2. **Replace 15 msg/min claim** with the documented pair rate limit (1 msg/6s, ~10/min, ~600/hr, burst 45).
3. **Fix error codes:** 130429 for throughput, 131056 for pair rate limit. Verify response body schema.
4. **Fix webhook retry duration:** "7 days" not "7 times."
5. **Add throughput upgrade eligibility** (unlimited daily contacts + Medium+ quality).
6. **Add concurrency guidance:** concurrent cap per phone, max 1 per contact.
7. **Add webhook capacity planning** (3x outbound, 1x inbound, ≤250ms median latency).
8. **Add 4^X backoff guidance** for pair rate limit burst recovery.
