# GitHub Wiki — Connector Design Document

> **Fundamental constraint:** GitHub Wiki has **no REST API** for content. Wikis are git-backed.
> Everything—page creation, editing, deletion—goes through git commits. There are no webhooks for wiki comments (wikis don't support threaded comment threads).

## 1. Overview

- **Category:** documentation / knowledge-base (not an issue tracker or project-management tool)
- **Cloud vs self-hosted:** Cloud GitHub.com only; GitHub Enterprise wikis share the same git-backed model
- **Official API reference:** No REST endpoint covers wiki content. The [About wikis](https://docs.github.com/en/communities/documenting-your-project-with-wikis/about-wikis) docs confirm git-backed access.
- **SDK:** No `@github/wiki` SDK. Use `@octokit/rest` for repo-level operations only; wiki access requires raw `git` CLI or a git library (e.g., `simple-git`, `isomorphic-git`).

## 2. Authentication

GitHub Wiki is a bare git repo. Authenticate the same way you authenticate to Git:

| Mechanism | How to obtain | Header/transport | Wiki access? |
|---|---|---|---|
| **Personal Access Token (PAT)** | Settings → Developer settings → Personal access tokens | `Authorization: Bearer <token>` via HTTPS | Yes — clone/push with `https://<token>@github.com/<owner>/<repo>.wiki.git` |
| **GitHub App** | App installation → generate JWT, then install token | `Authorization: Bearer <install_token>` | Yes — same URL pattern, token carries repo + wiki scope |
| **OAuth App token** | OAuth flow → user token | `Authorization: Bearer <token>` | Yes, if user has write access to the repo |
| **Deploy key** | Repo settings → deploy keys | SSH key pair | Yes — add same key to wiki (git:// URL, not HTTPS) |
| **Webhook HMAC** | Repo settings → webhooks | `X-Hub-Signature-256: sha256=<sig>` | N/A — for receiving events, not wiki writes |

**Required scopes (PAT):**
- `repo` (full) or `repo:wiki` scope (fine-grained, only grants wiki read/write)
- `notifications` for inbox-style ops (not wiki-relevant)

**Token lifetime:**
- PATs: user-configurable, up to 1 year; default 30 days for classic, configurable for fine-grained
- GitHub App install tokens: 1-hour TTL, auto-refreshed by the App SDK

**Recommendation for SupportAgent MVP:** PAT with `repo:wiki` scope. The webhook HMAC is used only for receiving `gollum` events — the PAT/SSH key is for outbound reads/writes.

**Multi-tenant implication:** Each tenant configures their own PAT or App installation. There is no org-level wiki token; each repo/wiki pair needs its own credential.

## 3. Inbound — Events and Intake

### Webhooks

**`gollum`** is the only wiki-related webhook. It fires on wiki page creation and editing. It does **not** fire on wiki deletion (no `pages[].action` = "removed" — deletion events are not delivered).

- **Event name:** `gollum`
- **Trigger:** Someone creates or edits a wiki page
- **Signature verification:** `X-Hub-Signature-256` HMAC-SHA256, header format `sha256=<hex>`. Secret provisioned in repo webhook settings.
- **Delivery semantics:** GitHub retries 5 times with exponential backoff over ~25 minutes. Delivery is **at-least-once** — dedup by `pages[].sha`.
- **No webhook for:** wiki page deletion, wiki access/permission changes, wiki sidebar/footer edits via settings

#### Gollum payload structure

```jsonc
{
  "pages": [
    {
      "page_name": "Home",           // page title
      "title": "Home",               // same as page_name
      "html_url": "https://github.com/<owner>/<repo>/wiki/Home",
      "sha": "92ebefa4b...",          // git commit SHA — usable as dedup key
      "action": "created" | "edited" // "created" only on first-ever creation
    }
  ],
  "repository": {
    "id": 123,
    "full_name": "<owner>/<repo>"
  },
  "sender": {                        // the user who made the edit
    "login": "octocat",
    "id": 1
  }
}
```

- **Flat structure:** No comment thread model. Wiki pages are single documents; there is no "comment" concept within wikis.
- **Multi-page edits:** A single commit touching multiple pages produces one webhook event with `pages[]` containing all changed pages.

#### Persist these fields from `gollum`

| Field | Source | Notes |
|---|---|---|
| `id` | `pages[].sha` | Stable content hash; not a sequential integer |
| `external_url` | `pages[].html_url` | GitHub wiki URL |
| `title` | `pages[].page_name` | Page name / title |
| `body` | Must fetch via git | Webhook has no body — you must `git show <sha>` to get content |
| `author` | `sender.login` | User who pushed the commit |
| `created_at` | Must fetch via git log | Commit date, not API-generated |
| `updated_at` | Must fetch via git log | Commit date of latest commit on the page |
| `labels` | N/A | Wikis have no native label system |
| `project/team` | N/A | One wiki per repository; no sub-projects |

**Critical gap:** The `gollum` webhook does not include page **content**. To get body text you must:

1. Clone the wiki repo (or shallow-fetch the specific page's file)
2. Parse the content (Markdown or AsciiDoc format)
3. Extract plain text for trigger matching

### Polling fallback

No GitHub API endpoint returns wiki content. Polling requires git operations:

```
git ls-remote https://<token>@github.com/<owner>/<repo>.wiki.git
git log --format="%H %ai %s" --name-only -- wiki/<page>.md
git show <sha>:wiki/<page>.md
```

- **Cursor strategy:** Use commit SHAs as cursors. Store last-seen SHA per tenant per repo.
- **Disadvantage:** Git clones are heavyweight. Wikis are bare git repos; there's no pagination API.
- **Recommendation:** Poll only if webhook delivery fails, and use shallow fetch (`--depth=1` with the known SHA) to minimize bandwidth.

## 4. Outbound — Writing Back

**No REST API.** All writes are git commits.

### Create/edit wiki page

```
# Clone the wiki
git clone https://<token>@github.com/<owner>/<repo>.wiki.git
# Edit or create a file
echo "# My Page" > wiki/My-Page.md
git add wiki/My-Page.md
git commit -m "Update from SupportAgent"
git push
```

- **No API endpoint** for create/update/delete of individual wiki pages.
- **Atomicity:** A single `git commit` can modify multiple pages. A failed push rolls back cleanly.
- **Content format:** Markdown (`.md`) or AsciiDoc (`.adoc`) — configured per wiki in repo settings.

### Cannot do (no equivalent exists)

| Operation | GitHub Wiki equivalent |
|---|---|
| Post comment on item | N/A — wikis have no comments |
| Edit comment | N/A |
| Delete/hide comment | N/A |
| Change status | N/A — wikis have no status workflow |
| Add/remove label | N/A — wikis have no labels |
| Set priority/severity | N/A |
| Assign user | N/A |
| Mention user | N/A — no `@mention` system in wikis |
| Close/resolve | N/A |
| Attach file | Supported via git commit (add as file in repo), but no preview rendering in wiki |
| Create item | Create a new wiki page via git |

**Conclusion:** GitHub Wiki is essentially **read-only** from SupportAgent's perspective except for creating/editing wiki pages via git. There is no outbound write operation that maps to issue-tracker behavior.

## 5. Labels, Flags, Fields, Priorities

**None of these exist in GitHub Wiki.**

- No labels, tags, or custom fields
- No status workflow (no "open/closed", no "in progress")
- No priority or severity
- No assignees
- No project/team scoping beyond "which repository's wiki"

The only organizing principle is the page hierarchy (sidebar navigation), which is also managed via git commits to `_Sidebar.md`, `_Footer.md`, etc.

## 6. Triggers We Can Match On

Because the only inbound event is `gollum` with no content in the payload:

| Trigger type | Supported? | How |
|---|---|---|
| Label add/remove/exact-set | No | Wiki has no labels |
| Status transition | No | Wiki has no status |
| Mention of bot user | No | Wiki has no `@mention` system |
| Comment body regex | **Indirectly** | Must fetch page content via git after webhook fires, then match |
| Author change | Yes | `sender.login` in gollum payload |
| Project/team scope | Yes | Repo full_name identifies scope |
| Custom field values | No | No custom fields |

**Trigger recommendation:** Support only repo-scope matching and, for Phase 2, fetch-and-match on page content via git after a `gollum` event. Real-time trigger matching on content is not possible without pulling the full page diff.

## 7. Identity Mapping

- **User id shape:** `login` string (e.g., `"octocat"`). Not numeric. Not UUID.
- **Email resolution:** No API to resolve `login` → email. Use `GET /users/:username` which returns public email (may be null/hidden).
- **Bot identity:** No bot user field on `gollum`. `sender` is the human user who pushed. To detect self-retrigger, store the PAT token's associated user login and compare against `sender.login`.
- **Author field on outbound comments:** N/A — no comment system.

## 8. Rate Limits

No REST API means no REST rate limits apply to wiki git operations.

- **Git clone/push:** Constrained by GitHub's git protocol limits. Undocumented but reasonable for normal use.
- **Webhook delivery:** GitHub applies standard webhook retry semantics (5 retries, exponential backoff).
- **GitHub API (for user lookup, repo metadata):** Standard API rate limits apply:
  - Unauthenticated: 60 req/hr
  - Authenticated (PAT): 5,000 req/hr (GitHub Enterprise: higher)
  - GitHub App: 5,000 req/hr per installation

## 9. Pagination & Search

- **No REST API pagination** applies to wiki content.
- **Git log pagination:** Use `--skip` and `--max-count` flags for manual cursor pagination.
- **Search:** No API. Wiki-wide search requires cloning the entire wiki and grepping locally.
- **GitHub's own wiki search UI:** Uses search.github.com which is not an API. No programmatic equivalent.

## 10. Known Gotchas

1. **No REST API for wiki content** — This is the primary constraint. All content access is via git.
2. **No webhook for wiki page deletion** — `gollum` fires only on create/edit. No event for page removal.
3. **No comment system** — Wikis do not support threaded comments. `issue_comment` and `pull_request_review_comment` webhooks do not apply to wikis.
4. **`gollum` payload contains no body** — Must fetch content via git after each event.
5. **No labels, status, priority, or severity** — Wiki pages are flat documents. SupportAgent's trigger matching on labels/status has no target.
6. **Multi-page single event** — One git commit touching 5 pages produces one event with 5 `pages[]` entries. Handle each entry separately.
7. **Webhook secret provisioning** — Must set the webhook secret in repo settings. Not tenant-configurable via API — each tenant must manually configure the webhook HMAC secret.
8. **Git clone for content fetch** — Every inbound event requiring body content needs a git clone (or shallow fetch). High-volume wiki activity can overwhelm git operations.
9. **Authentication granularity** — `repo:wiki` PAT scope grants wiki access but not necessarily repo-level webhook management. The token holder must also have webhook write access.
10. **No native search API** — Reconciling wiki state without cloning the entire wiki is not feasible.

## 11. Recommended SupportAgent Connector Scope

### MVP

GitHub Wiki as an **inbound-only** feed with no meaningful outbound actions. Realistically, a SupportAgent connector for GitHub Wiki is low-value.

**Must handle:**
- `gollum` webhook handler (verify HMAC, dedup by `pages[].sha`, store event)
- Git-based content fetch: `git clone` / shallow fetch to extract page body after event
- Page title, URL, author, timestamp extraction
- Webhook secret provisioning guide for tenant admin

**Minimum config fields:**
- `wiki_url` (derived from `owner/repo`, or custom for enterprise)
- `auth_token` (PAT or App install token)
- `webhook_secret`
- `default_branch` (usually `master`, configurable for wikis using `main`)

### Phase 2

- Poll-and-diff: scheduled git log fetch for non-event-driven reconciliation
- Content-trigger matching: fetch page content, run regex/body match on page diff
- Outbound write: create/edit wiki pages via git commit from SupportAgent actions

### Phase 3

- Full wiki clone + index for semantic search
- Multi-page commit coordination
- Sidebar/navigation management via `_Sidebar.md` edits

**Recommendation:** Do not build a GitHub Wiki connector as a first-class platform connector. It lacks issue-tracker semantics (no comments, no labels, no status, no priority), making it poorly suited for the triage automation use case. The `gollum` event is useful only for monitoring wiki changes — not for actionable support-queue integration.

If wiki monitoring is needed (e.g., a team uses wiki pages as support articles and wants to know when they're updated), a lightweight integration is feasible. But it should not be treated as parity with the GitHub Issues connector.

## 12. Dependencies

- **SDK:** `@octokit/rest` for repo-level webhook verification and user lookup. No dedicated wiki SDK.
- **Git library (Node.js):** `simple-git` or `isomorphic-git` for cloning and reading wiki content.
  - `simple-git` is simpler for shallow fetches; `isomorphic-git` works in browser environments but git credential handling is harder.
- **CLI fallback:** `gh` CLI has no wiki-specific subcommand. Wiki access requires standard `git`.
- **Decision:** Use `simple-git` for server-side wiki operations. Use raw `fetch` for all GitHub REST API calls.

## 13. Open Questions

1. **Use case validation:** What is the intended SupportAgent use case for wiki monitoring? If it's support-queue triage, wiki is the wrong target. Confirm the team has a specific wiki-monitoring need before building this connector.
2. **Enterprise wikis:** Does any tenant use GitHub Enterprise with a wiki behind a different hostname? Wiki URLs may differ in enterprise mode.
3. **Content format:** Does the tenant wiki use Markdown or AsciiDoc? The git file extension differs (`.md` vs `.adoc`), which affects content parsing.
4. **Webhook provisioning UX:** How should the admin panel guide tenants to set up the `gollum` webhook? They must manually configure it in repo settings — there is no API to register webhooks.
5. **Rate limit for content fetch:** If a tenant's wiki is highly active, git clone per event could be rate-limited. Is there a cached git daemon option for high-volume wikis?
6. **Self-hosted GitHub Enterprise:** Some tenants may use GitHub Enterprise Server (GHES) which has the same wiki model but may require different git URLs (e.g., `wiki.git` may not exist on older GHES versions). Confirm GHES version parity.

---

## Sources

- [GitHub Webhooks — gollum event](https://docs.github.com/en/webhooks/webhook-events-and-payloads/gollum)
- [About wikis](https://docs.github.com/en/communities/documenting-your-project-with-wikis/about-wikis)
- [Managing repository settings — wikis](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/about-wikis)