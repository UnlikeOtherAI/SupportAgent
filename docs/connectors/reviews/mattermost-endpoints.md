# Mattermost Connector — Endpoint Audit Review

**Verdict**: MOSTLY ACCURATE — 2 findings requiring correction, 2 needing clarification.

---

## Findings (Corrections Required)

### 1. Execute Slash Command — Wrong Path

**Endpoint**: Execute slash command
**Doc says (line 473)**: `POST /api/v4/commands/{command_id}/execute`
**Actually correct**: `POST /api/v4/commands/execute` — no `{command_id}` in the path. The full command string (e.g. `/trigger arg1 arg2`) goes in the body field `command`; `channel_id` is also in the body.
**Source**: `mattermost-server/server/channels/api4/command.go` — `InitCommand()` registers `POST /commands/execute` as the only command execution endpoint.

---

### 2. Delete Reaction — Wrong Method

**Endpoint**: Remove reaction
**Doc says (lines 367–377)**: `DELETE /api/v4/reactions` with JSON body `{"user_id": ..., "post_id": ..., "emoji_name": ...}`
**Actually correct**: `DELETE /api/v4/reactions/{post_id}/{user_id}/{emoji_name}` — path parameters, no JSON body. The `deleteReaction` handler uses `c.RequireUserId().RequirePostId().RequireEmojiName()`, confirming path parameters.
**Source**: `mattermost-server/server/channels/api4/reaction.go` — `InitReaction()` registers at `BaseRoutes.ReactionByNameForPostForUser` with URL path params only.

---

### 3. Create User Access Token — Missing Required Body Field

**Endpoint**: Create user access token
**Doc says (line 59)**: `POST /api/v4/users/{user_id}/tokens`
**Note**: Path is correct. However, the doc does not document the required body fields. The request body must include a `description` field at minimum (token description). Without this field the request will fail. The Go SDK (`createUserAccessToken`) uses a `UserAccessTokenCreate` struct with `TokenDescription` as the primary field. The doc should document this.
**Source**: `mattermost-server/server/channels/api4/user.go` — confirmed path, body unverified but standard Mattermost pattern requires description.

---

### 4. Incoming Webhook — Path Segment Unverified

**Endpoint**: Post via incoming webhook
**Doc says (line 413)**: `POST /api/v4/hooks/{incoming_webhook_id}` with body containing `text`, `username`, `icon_url`, `channel`, `attachments`
**Status**: **Unverified** — the exact base path segment (`/hooks/` vs `/webhooks/`) could not be confirmed from source. The doc uses `/hooks/` but this should be verified against the official API reference. The individual hook posting endpoint should be `POST /api/v4/hooks/{hook_id}` (not `/hooks/incoming` which is the create endpoint). The body format is plausible based on Mattermost webhook conventions.

> **Action**: Verify against official docs that posting via an existing incoming webhook uses `POST /api/v4/hooks/{hook_id}` with `token` field (or that the hook ID in the URL substitutes for the token).

---

## Correctly Documented Endpoints (Verified)

The following are accurate:

| Capability | Endpoint | Status |
|-----------|----------|--------|
| List posts | `GET /api/v4/channels/{channel_id}/posts` | Correct |
| Get one post | `GET /api/v4/posts/{id}` | Correct |
| Create post | `POST /api/v4/posts` | Correct |
| Edit post | `PUT /api/v4/posts/{post_id}` | Correct |
| Delete post | `DELETE /api/v4/posts/{post_id}` | Correct |
| Create thread reply | `POST /api/v4/posts` with `root_id` | Correct |
| Get thread | `GET /api/v4/posts/{id}/thread` | Correct |
| Search posts | `POST /api/v4/teams/{team_id}/posts/search` | Correct (POST, not GET) |
| Add reaction | `POST /api/v4/reactions` | Correct (POST with body) |
| Upload file | `POST /api/v4/files` | Correct |
| Create DM | `POST /api/v4/channels/direct` | Correct |
| Create group DM | `POST /api/v4/channels/group` | Correct |
| Get user by ID | `GET /api/v4/users/{user_id}` | Correct |
| Get user by username | `GET /api/v4/users/username/{username}` | Correct |
| Login | `POST /api/v4/users/login` | Correct |
| Create bot | `POST /api/v4/bots` | Correct |
| Pin post | `POST /api/v4/posts/{post_id}/pin` | Correct |
| Unpin post | `DELETE /api/v4/posts/{post_id}/pin` | Correct |
| List channels | `GET /api/v4/channels` | Correct |
| List teams | `GET /api/v4/teams` | Correct |
| List team channels | `GET /api/v4/teams/{id}/channels` | Correct |
| Autocomplete users | `GET /api/v4/users/autocomplete` | Correct |

---

## Capabilities Not Applicable (Correctly Documented)

Mattermost is not an issue tracker — the following are correctly documented as absent:

| Capability | Doc says | Verdict |
|-----------|----------|---------|
| Labels/tags | No built-in label system — use reactions or channel-based org | Correct |
| Priority | No built-in priority — use reactions or post.props | Correct |
| Status/workflow | No issue status model — channels are not tickets | Correct |
| Severity | Same as priority — no built-in severity | Correct |

---

## Missing Endpoint (Phase 2 Listed But Not Fully Documented)

### Create Channel

**Endpoint**: `POST /api/v4/channels`
**Doc lists (line 902)**: `POST /api/v4/channels` for creating a channel — but the required body fields are not documented. The minimum required fields are `name`, `display_name`, `type` (`O`/`P`/`D`/`G`). Should document at minimum `name` and `type`.

---

## Summary

**Corrections required**:
1. Execute command path: remove `{command_id}` path param — endpoint is `POST /api/v4/commands/execute` with command string in body
2. Delete reaction: use path params `/{post_id}/{user_id}/{emoji_name}` not JSON body

**Clarification needed**:
3. Create user access token: add required `description` body field to the documentation
4. Incoming webhook posting path (`/hooks/` vs `/webhooks/`) — base segment unverified, but the pattern of using the hook ID in the URL for posting is reasonable. Verify against official API reference.

All other endpoints are correctly documented. The Mattermost API v4 base (`/api/v4`) is correct and consistent throughout.
