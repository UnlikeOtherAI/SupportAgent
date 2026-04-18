# GitHub Wiki Connector — Inbound Events Audit Review

**Verdict:** CONDITIONAL PASS — `gollum` event coverage is accurate, but there are three accuracy issues and two documentation gaps that could cause implementation bugs.

---

## Findings

### 1. `pages[].sha` dedup key is insufficient for multi-page commits

**Event/flow:** `gollum` webhook processing
**Issue:** The document states dedup by `pages[].sha`, but a single `gollum` event with multiple `pages[]` entries will have the **same SHA** for all entries (one commit touching N pages). Using SHA alone as a dedup key would discard all but the first page entry.
**Correction:** Dedup key should be compound: `pages[].sha + pages[].page_name`. Alternatively, dedup at the commit level first (by SHA), then process all `pages[]` entries unconditionally. The current phrasing "dedup by `pages[].sha`" on line 46 and line 80 ("usable as dedup key") is misleading.

---

### 2. HMAC signature covers raw body bytes — correct, but not stated explicitly

**Event/flow:** `gollum` webhook verification
**Issue:** Document lists `X-Hub-Signature-256` header and HMAC-SHA256 algorithm (lines 23, 45) but never explicitly states **what bytes are signed**. Implementers who read this doc might attempt to sign JSON-parsed output or add extra whitespace, breaking verification.
**Correction:** Add one line: "The signature covers the raw request body bytes (no transformation). Compute `HMAC-SHA256(secret, raw_body)` and compare against `sha256=<hex>`." This is correct per GitHub's webhook spec and the doc is consistent, but the omission is a common implementation pitfall.

---

### 3. No timestamp header — replay protection works differently than stated

**Event/flow:** `gollum` webhook replay protection
**Issue:** The document does not mention replay protection at all, which is fine, but if the reviewer expected a "timestamp tolerance" note and found none, they should confirm this is intentional. GitHub webhooks have **no `X-GitHub-Timestamp` header** and no built-in timestamp-based replay window. GitHub's replay protection is implicit: the HMAC secret ensures only the legitimate sender can produce valid signatures, but there is no time-bounded window like Slack's 5-minute tolerance.
**Correction:** Either add a note "GitHub webhooks have no timestamp header. Replay protection relies solely on secret secrecy — do not log or expose webhook secrets" or confirm this gap is covered in the security review. The absence is not a bug but worth documenting to prevent implementers from looking for a timestamp field.

---

### 4. Eventual consistency gap not documented

**Event/flow:** Git-based content fetch after `gollum` event
**Issue:** The document correctly states body must be fetched via git (line 83), but does not note that git commit propagation to `https://` URLs is not instant. In rare high-latency scenarios (or on GitHub Enterprise with git daemon delays), `git show <sha>` or a shallow fetch of `<sha>` may fail immediately after the webhook fires.
**Correction:** Add to the content fetch workflow: "If the initial git fetch returns the SHA not found, retry with exponential backoff (1s, 2s, 4s) up to 3 attempts. GitHub's internal commit propagation typically completes within 1–2 seconds."

---

### 5. `pages[].action` values are correct; deletion edge case is understated

**Event/flow:** `gollum` webhook action classification
**Issue:** The document correctly lists `created` and `edited` as valid actions (line 59). However, line 41 states "does not fire on wiki page deletion" as a bullet point under "No webhook for: wiki page deletion". This is accurate but the severity is understated — page deletion via git is indistinguishable from any other commit-based change without also polling the full wiki git state. If a page is deleted, there is no `pages[].action = "deleted"` event, and the page will simply disappear from future `git log` outputs.
**Correction:** Upgrade the deletion note from a bullet to a separate callout: "**Critical:** Page deletion produces no `gollum` event. Detecting deletion requires periodically reconciling the wiki's full page list (via `git ls-tree HEAD wiki/`) against the stored page index. A missing page after a known-good SHA indicates deletion."

---

### 6. Poll-and-diff cursor strategy needs clarification on shallow fetch

**Event/flow:** Polling fallback (lines 96–108)
**Issue:** The document recommends shallow fetch (`--depth=1` with known SHA) but `git ls-remote` returns refs, not commit SHAs. The cursor strategy described ("store last-seen SHA per tenant per repo") is correct for the git log approach, but `git ls-remote` alone cannot determine which SHAs are new — you need `git log` to enumerate commits between cursors.
**Correction:** The polling section should clarify the two-step approach:
```
# Step 1: Get all SHAs since last cursor
git fetch --depth=1 <last_cursor_sha>
git log --format="%H" <last_cursor_sha>..HEAD

# Step 2: For each new SHA, get affected pages
git show --name-only --format="" <sha> | grep "^wiki/"
```

---

### 7. Multi-tenant webhook secret management note is incomplete

**Event/flow:** Webhook provisioning (line 209)
**Issue:** The document correctly flags "must set webhook secret in repo settings" and "not tenant-configurable via API" (lines 209, 261). However, it does not note that GitHub's webhook secret is set **per webhook, not per event type**. If a tenant already has other webhooks configured on the same repo, they must either reuse the existing secret (security implications for multi-tenant) or add a new webhook endpoint that receives all events and routes internally.
**Correction:** Add to the provisioning UX note: "If the tenant repo already has webhooks, the SupportAgent webhook must be added as a separate endpoint (different callback URL). Do not ask tenants to reuse existing webhook secrets across multiple consumers."

---

### 8. Bot-authored content filter — document is correct but brief

**Event/flow:** Self-retrigger prevention (line 180)
**Issue:** The document says to store the PAT token's associated user login and compare against `sender.login`. This is correct — there is no bot-specific field in `gollum` payload. However, if SupportAgent's PAT is a GitHub App install token, the `sender.login` will be the GitHub App bot user (e.g., `[app-name][bot]`), not the installing user's login. Implementers using a GitHub App should compare against the app's bot username, not an individual's login.
**Correction:** Add to the bot detection note: "If using a GitHub App install token, the bot username follows the pattern `<app-slug>[bot]` and can be retrieved from the App's metadata endpoint. Compare `sender.login` against the app's bot login, not a user PAT's associated login."

---

## Summary Table

| Finding | Severity | Fix Required |
|---------|----------|--------------|
| Compound dedup key needed for multi-page commits | **High** | Yes — lines 46, 80 |
| Raw body bytes for HMAC not explicit | Medium | Recommended — add after line 45 |
| No timestamp header / replay protection gap | Low | Document — add note or confirm N/A |
| Eventual consistency git propagation gap | Medium | Recommended — add retry logic |
| Page deletion detection gap understated | Medium | Yes — upgrade to callout |
| Polling shallow fetch workflow unclear | Medium | Yes — clarify two-step fetch |
| Multi-tenant webhook secret reuse risk | Medium | Recommended — add guidance |
| GitHub App bot login format for self-detect | Low | Recommended — add clarification |

---

## Verified Correct Items

- `gollum` event name — correct (GitHub fires exactly `gollum`, not `wiki`, `wiki_page`, etc.)
- `X-Hub-Signature-256` header name — correct
- `sha256=<hex>` HMAC format — correct
- `pages[].action` values `created` / `edited` — correct and complete
- `pages[].sha` is commit SHA — correct; usable for content lookup
- `pages[].html_url` field name — correct
- `sender.login` for author — correct; GitHub does not put bot info in `sender`
- At-least-once delivery with 5 retries — correct per GitHub webhook docs
- No REST API for wiki content — correct and documented
- No comment system in wikis — correct; `issue_comment` webhook does not apply
- No labels, status, assignees in wikis — correct
- No `@mention` system in wikis — correct
- Multi-page entries in single event — correct; documented well
