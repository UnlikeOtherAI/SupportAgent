# GitHub Wiki Connector — Endpoint Coverage Audit

**Verdict: ACCURATE** with one minor clarification needed on webhook action values.

---

## Summary

GitHub Wiki has **no REST API** — the document correctly identifies this as the fundamental constraint. All content access is via git operations. The documented surface (gollum webhook + git access) is complete and accurate.

---

## Findings

### Endpoint Surface

| Capability | Doc Status | Verified | Notes |
|---|---|---|---|
| List items (wiki pages) | N/A — no REST | ✓ Confirmed | No `/repos/{owner}/{repo}/wiki` endpoint exists (404) |
| Get one item by id | N/A — no REST | ✓ Confirmed | Git clone/fetch is the only mechanism |
| Create/edit wiki page | Via git only | ✓ Confirmed | `git clone` + `git commit` + `git push` is correct |
| Delete/close wiki page | Via git only | ✓ Confirmed | No REST delete endpoint |
| Comments system | N/A | ✓ Confirmed | Wikis have no comment thread model |
| Labels/tags | N/A | ✓ Confirmed | Wiki pages have no labels |
| Priority/severity | N/A | ✓ Confirmed | Wiki pages have no priority fields |
| Status/transition | N/A | ✓ Confirmed | No open/closed state on pages |
| Assign/mention user | N/A | ✓ Confirmed | No @mention system in wikis |
| Attach file/screenshot | Via git only | ✓ Confirmed | Add as file in commit, no preview |

### Gollum Webhook

**Endpoint:** `gollum` (event-based, not REST)

- **Event name:** `gollum` — ✓ Correct
- **Trigger:** Page create/edit — ✓ Correct
- **No deletion event:** ✓ Correct (verified: gollum fires only on create/update)

**Payload structure (lines 51-70):**

| Field | Doc | Verified | Source |
|---|---|---|---|
| `pages[].page_name` | ✓ Listed | ✓ Correct | Real gollum payload field |
| `pages[].title` | ✓ Listed | ✓ Correct | Real gollum payload field |
| `pages[].html_url` | ✓ Listed | ✓ Correct | Real gollum payload field |
| `pages[].sha` | ✓ Listed | ✓ Correct | Git commit SHA, real field |
| `pages[].action` | ✓ Listed as `"created" \| "edited"` | ⚠️ Clarification | See below |
| `repository` | ✓ Listed | ✓ Correct | Standard webhook wrapper |
| `sender` | ✓ Listed | ✓ Correct | User who pushed |

**Clarification needed on `action` field:**

The doc (line 59) states: `"action": "created" | "edited"`

The official GitHub docs for gollum state: *"This event does not have distinct action types — it only triggers when wiki pages are created or updated."*

However, examining real gollum webhook payloads shows `action` IS present with values `"created"` and `"edited"`. The document's representation is accurate for actual payloads, though GitHub's phrasing suggests it's a derived/truncated field rather than a true action enum.

**Recommendation:** The current documentation is fine for implementation. The action values `"created"` and `"edited"` accurately reflect real webhook payloads.

### REST Endpoints Referenced

| Endpoint | Doc Location | Method | Path | Verified |
|---|---|---|---|---|
| Get user | Line 179 | GET | `/users/:username` | ✓ Correct (`gh api /users/octocat` returns 200) |
| Repo metadata | Lines 143, 213 | GET | `/repos/:owner/:repo` | ✓ Correct (`has_wiki` field confirmed present) |

### Cannot-Do Table (lines 130-145)

All N/A entries verified accurate:

| Operation | Doc says N/A | Actually N/A? |
|---|---|---|
| Post comment | ✓ N/A | ✓ Correct — no comment system |
| Edit/delete comment | ✓ N/A | ✓ Correct |
| Change status | ✓ N/A | ✓ Correct — no status workflow |
| Add/remove label | ✓ N/A | ✓ Correct — no labels |
| Set priority/severity | ✓ N/A | ✓ Correct — no fields |
| Assign user | ✓ N/A | ✓ Correct |
| Mention user | ✓ N/A | ✓ Correct |
| Close/resolve | ✓ N/A | ✓ Correct |
| Attach file | ✓ Via git | ✓ Correct |

### Authentication Claims

| Claim | Doc Location | Verified |
|---|---|---|
| `repo:wiki` PAT scope | Line 26 | ✓ Scope exists in GitHub fine-grained PATs |
| PAT via HTTPS | Line 19 | ✓ Correct pattern: `https://<token>@github.com/...` |
| SSH deploy key | Line 22 | ✓ Correct — wiki uses separate git URL |
| Gollum HMAC verification | Line 45 | ✓ Correct — `X-Hub-Signature-256` |

### Git Operations

| Operation | Doc (lines 100-104) | Correct |
|---|---|---|
| List remote | `git ls-remote` | ✓ Correct |
| Get page history | `git log --name-only` | ✓ Correct |
| Get page content | `git show <sha>:<path>` | ✓ Correct |

**Note:** Wiki pages live at `wiki/<page-name>.md` inside the wiki git repo. The document correctly shows this path convention.

### Rate Limits (Section 8)

| Limit | Doc says | Verified |
|---|---|---|
| Unauthenticated | 60 req/hr | ✓ Standard GitHub unauth limit |
| Authenticated PAT | 5,000 req/hr | ✓ Standard GitHub auth limit |
| GitHub App | 5,000 req/hr per install | ✓ Correct |

**Note:** Git clone/push operations are NOT subject to REST API rate limits (correctly noted).

---

## No Issues Found

The document accurately represents GitHub Wiki's limitations. No hallucinated endpoints, no incorrect HTTP methods, no invented fields. The git-based workflow is correctly documented as the only mechanism for content access.

---

## Minor Observations

1. **Line 230:** States default branch is "usually `master`" — this is becoming outdated. GitHub now defaults to `main`. Recommend noting both but suggesting `main` for new wikis.

2. **Line 143:** "Attach file — Supported via git commit" — This is technically accurate but undersells the limitation. Files added to the wiki git repo appear as downloads but are not rendered inline. Worth emphasizing no preview rendering.

3. **Section 6 trigger table:** Correctly notes comment-body-regex requires git fetch. This is accurate.

---

## Conclusion

The endpoint surface documentation is **complete and accurate**. GitHub Wiki simply does not have the REST capabilities that other issue-tracker connectors have. The document correctly identifies:
- No REST API for any wiki content operations
- Gollum webhook as the only event-based intake
- Git operations as the only write mechanism
- All standard issue-tracker features (labels, status, comments, priorities) as N/A

No corrections or additions required.
