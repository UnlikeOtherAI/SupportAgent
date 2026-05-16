# Security Review — Input Validation Completeness & Injection-Class Vulnerabilities

Scope: REST routes in `apps/api`, webhook intake, polling intake, gateway WS, worker shell/CLI integrations, connector HTTP clients, admin React surface, SSO/OAuth callbacks. Sources verified by direct read at the cited line numbers.

## 1. Executive Summary

The codebase is mostly well-shielded at the API boundary — Zod is applied to every authenticated REST route I inspected, the polling intake uses discriminated unions, worker-API bodies are validated and authenticated, the dispatcher's single `$queryRawUnsafe` call is a static literal, and the admin React app has no unsafe raw-HTML sink or markdown renderer. Worker auth hashes its bearer token with SHA-256 before lookup, and the SSO callback redirects to a fixed admin URL (the `next` query param is captured into the signed state cookie but never read back, so there is no open-redirect surface).

However, several high-impact gaps remain:

- **Gateway WebSocket has no authentication.** Any TCP-reachable client can register as a worker and steal the next dispatched job (including its embedded secrets and source code).
- **Webhook signature verification is optional.** When `connector.webhookSecret` is null/empty (the test seed and onboarding default), the API accepts unsigned payloads — anyone who learns a connector UUID can inject work items and trigger build/triage runs.
- **Pervasive shell-string concatenation in `packages/github-cli`.** Issue titles, label names, branch names, repository URLs, review comment bodies, and `file.path` values flow into the shell through template literals with at best double-quote-only escaping. Combined with the unsigned-webhook gap, an attacker can reach a build worker through a Linear/Jira/GitHub webhook and inject arbitrary shell via subshell or backtick syntax (which the escape regex does not handle).
- **Operator-controlled `baseUrl` SSRF** in `packages/jira-client` and `packages/respondio-client`; both `fetch()` to whatever URL the connector record holds, with no allowlist or link-local blocklist.
- **Path traversal in `ghCommitFiles`**: `path.join(workDir, file.path)` with no containment check; AI-generated `file.path` can escape the work directory and overwrite host files.

Top risks below are ordered by exploitability times blast radius.

## 2. Critical / High

| id | file:line | problem | impact | fix |
|----|-----------|---------|--------|-----|
| C-1 | `apps/gateway/src/app.ts:11` + `apps/gateway/src/ws/connection-manager.ts:28-49` | `GET /ws` is registered with no auth hook; first `register` message blindly trusts a JSON-supplied `workerId` and `capabilities`. No Zod, no token, no TLS-client check. | Anyone who can reach the gateway port can register as a worker and receive the next `dispatch` payload — which carries the full `WorkerJob` body (repository ref, branch, prompt manifests, signed worker secrets). Equivalent to RCE-at-rest: the attacker can also send `job-completed` to free a real worker and observe successive jobs. | Require the same per-dispatch shared secret the API issues (already SHA-256 stored in DB). On connect, demand a hello frame with `{workerId, dispatchAttemptId, secret}` validated by Zod, looked up via `findFirst({ workerSharedSecret: sha256(secret) })`, and rejected after one bad attempt. Bind the socket to that worker identity and ignore client-supplied `workerId` thereafter. |
| C-2 | `packages/github-cli/src/index.ts:283,289,399,632,637,653,681,692,704` | Multiple shell commands built by template-literal interpolation into the child-process shell. Where escaping exists it only handles the double-quote char, leaving subshell, backtick, semicolon, double-ampersand, pipe, and newline characters unescaped. Inputs include `title` (line 399), `body` (lines 681/692/704), `label` and `definition.description` (line 632), `labels.join(',')` (lines 637/653), commit `message` (lines 283/289). Caller `apps/worker/src/handlers/build-handler.ts:362` constructs `prTitle` from `issueTitle` — webhook-supplied — and passes it through. | Code execution on the worker host. PoC: Linear/Jira/GitHub webhook (potentially unsigned — see H-1) with title containing a subshell expansion. After triage promotes the run, build-handler builds `prTitle` and `ghCreatePR` runs `gh pr create … --title "<payload>"` — the substitution is evaluated by the shell. Same path works through PR review/status bodies and label names. | Switch each `gh`/`git` invocation to argv form (`spawn(cmd, [...args], { shell: false })`) so positional args bypass the shell entirely; or, at minimum, route every dynamic value through `shellQuote` from `apps/worker/src/executors/cli-executor.ts:47` (it already escapes the dollar and backtick characters). Prefer the structural fix — `gh` and `git` accept argv natively. |
| H-1 | `apps/api/src/services/intake-service.ts:51-59` | Signature verification is gated on `if (connector.webhookSecret) { ... }`. When the field is null/empty (the default in `apps/api/src/routes/webhooks.test.ts:47`, and the path during onboarding before an operator pastes a secret), HMAC is skipped and any caller with the connector UUID can POST. Headers are not Zod-checked either — the route accepts whichever of four header names appears (`apps/api/src/routes/webhooks.ts:14`). | Spoofed work items and workflow runs. An attacker who learns or guesses a connector UUID injects arbitrary issue payloads, which then drive triage and (via C-2) build-handler shell injection. Even without C-2 this is unauthenticated state mutation. | Require `webhookSecret` to be set on the connector before the webhook route accepts traffic for it (reject with 401 when null). Add the secret at connector creation time and surface it once in the admin. Optionally Zod-parse the normalized payload in each `normalize()` so downstream `as any` casts are removed. |
| H-2 | `packages/github-cli/src/index.ts:271-285` (`ghCommitFiles`) | `const filePath = path.join(workDir, file.path)` followed by `fs.writeFile(filePath, …)`. No check that `filePath.startsWith(workDir + path.sep)`. `git add ${file.path}` also goes through the shell unquoted (subsumed under C-2). | AI-generated or operator-supplied parent-relative `file.path` writes outside the workspace, and a `file.path` containing shell metacharacters reaches the shell via `git add`. Privilege depends on the worker process user. | Resolve `path.resolve(workDir, file.path)` and assert it starts with `path.resolve(workDir) + path.sep`; reject absolute paths and parent traversal segments. Pass `git add -- <file>` via argv. |
| H-3 | `apps/api/src/routes/repository-mappings.ts:8,18` | `repositoryUrl: z.string().min(1)` — no `z.string().url()` or pattern check. The value is later passed to `ghCloneRepo(repoUrl)` (`packages/github-cli/src/index.ts:244-260`) and embedded into `git clone … ${remoteUrl} .`. The `https://` branch parses a regex; the `else` branch wraps anything in `git@github.com:${value.replace(/\.git$/, '')}`. | A malicious value under the fallback branch becomes `git@github.com:foo;…` — still ends up in a shell concat with `git clone`. Combined with C-2, an authenticated tenant admin can run arbitrary shell on a worker via the next build run. Even without that, malformed URLs cause silent breakage downstream. | Tighten the schema to a URL/owner-repo regex (`^(https://github.com/|git@github.com:)?[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(\\.git)?$`), and pass to argv-mode `git clone`. |

PoC sketches:

- **C-1**: `wscat -c ws://gateway:3030/ws` then send a `register` JSON message. The next `dispatchJob` call from the API delivers the `WorkerJob` to the attacker.
- **C-2**: file a Linear issue whose title contains a subshell expansion and add the trigger label `needs PR`. Build-handler eventually invokes `ghCreatePR` with the title; the worker's shell evaluates the substitution.
- **H-1**: with no webhook secret, POST a forged payload to `/webhooks/github/<UUID>` — accepted, work item created.
- **H-2**: model output with a parent-traversal `path` field, then `ghCommitFiles` writes outside the workspace if the worker has permissions.
- **H-3**: tenant admin POSTs a `repositoryUrl` containing shell metacharacters to `/v1/repository-mappings`; next build run executes the command on the worker.

## 3. Medium

| id | file:line | problem | impact | fix |
|----|-----------|---------|--------|-----|
| M-1 | `packages/jira-client/src/index.ts:11-17,57-60` and `packages/respondio-client/src/index.ts:14-19` | `baseUrl` (operator-controlled connector field) is fed straight into `fetch()` with no scheme, host, or allowlist check. No block on `127.0.0.1`, `169.254.169.254`, `localhost`, `file:` scheme, or RFC1918 ranges. | SSRF: a tenant admin sets `baseUrl` to a link-local metadata endpoint and exfiltrates GCP instance metadata via the next Jira/Respond.io call (response body becomes a connector error or appears in logs). | Validate `baseUrl` at write time: parse URL, require `https:`, hostname must match a per-platform allowlist (`*.atlassian.net`, `api.respond.io`). Reject everything else. |
| M-2 | `apps/api/src/services/normalizers/{github,linear,jira,sentry}-normalizer.ts` | None of the normalizers Zod-parse the inbound payload; they cast `rawPayload as any`. Many fields land directly in Prisma writes (`apps/api/src/services/intake-service.ts:80-105`) including JSON columns. | Malformed or hostile payloads can poison `taxonomy`/`attachments`/`comments` JSON and confuse downstream consumers; no defense in depth if a future field is rendered into a shell command. | Define per-platform Zod schemas for the subset of fields each normalizer actually reads, parse once, and remove the `as any`. |
| M-3 | `apps/api/src/routes/auth.ts:419-428` | JWT is returned via query string (`/auth/callback?token=…`) so it lands in browser history, referer headers, and any front-end log. The cookie path (`STATE_COOKIE`) is only used for the PKCE state, not the session. | Token leakage to third-party referrers or to logs of any intermediary the admin app links to. | Set the session JWT as an `HttpOnly; Secure; SameSite=Lax; Path=/` cookie on the callback response and redirect to `/auth/callback` without query params; let the admin app pull `/v1/auth/me` instead. |
| M-4 | `apps/api/src/routes/auth.ts:347-353` | UOA `access_token` is decoded with `decodeJwt` only — signature is not verified. The inline comment states this is intentional (UOA holds the HMAC secret). | If the operator-channel TLS-pinned trust assumption ever breaks (compromised mirror, mis-configured `SSO_BASE_URL`, MITM via DNS), the API will accept attacker-controlled claims as identity. Defense in depth missing. | Have UOA publish a JWKS or HS256 secret to relying parties; verify before trust. Until then, at least bind `sub`/`email` to the org membership returned in `firstLogin` and refuse mismatches. |
| M-5 | `apps/api/src/routes/webhooks.ts:14-18` | Signature header is selected by best-effort header presence with no Zod validation; a request may supply no signature header at all and pass through the `webhookSecret == null` branch. Header is then handed to per-platform `verifySignature`, which only Buffer-equals lengths after stripping a `sha256=` prefix. | Two failure modes: (1) bypass via missing header when secret is null (covered by H-1); (2) length-mismatched buffers silently caught by the surrounding `try/catch` — fine, but `Buffer.from(sig, 'utf8')` could mis-pad hex if the platform ever changes to base64. | When `webhookSecret` is set, also require the platform-appropriate header to be present and reject otherwise; decode hex/base64 deliberately per-platform. |

## 4. Low / Hygiene

- `apps/api/src/services/intake-service.ts:84-95` — `workItemKind: normalized.workItemKind as any` and several `as Prisma.InputJsonValue | undefined` casts. Tighten via the normalizer schemas (M-2).
- `apps/api/src/routes/auth.ts:232,242-246` — `next` is stored in the signed state cookie but never consumed on callback (line 419 redirects to a fixed path). Either honor it with an explicit same-origin check or drop the field to avoid future open-redirect risk.
- `packages/github-cli/src/index.ts:399` body is delivered via `--body-file` (good), but `--title`, `--head`, `--base` are still interpolated. Keep `--body-file` and extend the pattern to argv form for all positional values.
- `apps/api/src/services/normalizers/jira-normalizer.ts:30-33`, `linear-normalizer.ts:11-16`: `timingSafeEqual` is called on raw hex strings of potentially different lengths. The `try/catch` makes it functionally safe, but converting both sides via `Buffer.from(x, 'hex')` of fixed length is cleaner.
- Headers are read with `as string` casts in `apps/api/src/routes/webhooks.ts:15-18`; Fastify can return string, string-array, or undefined. Defensive `Array.isArray` handling avoids accidentally hashing the wrong type.
- `apps/api/src/services/dispatcher-service.ts:238` uses `$queryRawUnsafe` with a static literal — safe but unnecessary; `Prisma.sql` would document intent.
- `packages/github-cli/src/index.ts:280` shell-runs `git add ${file.path}`; even with C-2/H-2 fixed, prefer `git add --` argv form to prevent option-injection from a filename starting with a dash.

## 5. Verified-Good

- **Polling intake** (`apps/api/src/routes/polling.ts`): every event kind goes through a `z.discriminatedUnion`; tenant context is enforced before write.
- **Worker API** (`apps/api/src/routes/worker-api.ts`) and **worker auth plugin** (`apps/api/src/plugins/worker-auth.ts`): Zod-validated bodies, jobId/route param match check, bearer hashed with SHA-256 before lookup, legacy plaintext path documented and bounded.
- **Webhook scope isolation** (`apps/api/src/app.ts:107-119`): raw-body parser is registered inside an encapsulated Fastify scope, so the rest of the API still gets proper JSON parsing.
- **CLI executor escaping** (`apps/worker/src/executors/cli-executor.ts:47`): `shellQuote` escapes the double-quote, backslash, dollar, and backtick characters — adequate for the prompt argument it wraps. This is the model the gh-cli package should adopt (C-2).
- **Codex spawn** (`apps/worker/src/utils/codex-exec.ts:22`): argv-mode child process with `shell: false`.
- **Admin XSS surface**: ripgrep across `apps/admin/src` for the raw-HTML React sink, `ReactMarkdown`, and `innerHTML` assignment returned zero matches.
- **Auth plugin** (`apps/api/src/plugins/auth.ts`): standard `@fastify/jwt` with `env.JWT_SECRET`; no custom verifier.
- **SSO state cookie** (`apps/api/src/routes/auth.ts:242-256`): HS256-signed via JOSE with `JWT_SECRET`, sent `HttpOnly; Secure; SameSite=Lax`, scoped path.
- **Dispatcher `$queryRawUnsafe`** (`apps/api/src/services/dispatcher-service.ts:238`): the only call site uses a string literal with no interpolation — SQLi-safe.
- **Connector-OAuth route, settings, executors, skills, workflow-* routes** all Zod-validate bodies and call `request.authenticate()` in an `onRequest` hook.

## Resolution notes

Closed on branch `security-fix/gateway-ws-auth-5f82736` (2026-05-16).

- **C-1 (gateway WS upgrade unauthenticated).** Resolved alongside H-1
  in `security-network-and-container.md`. `GET /ws` now runs a
  `preValidation` hook (`apps/gateway/src/app.ts:39`) that calls
  `authorizeUpgrade` (`apps/gateway/src/ws/upgrade-auth.ts:50`) to
  enforce `Origin` allowlist + presented `runtimeApiKey`. The first
  `register` message is Zod-validated by
  `WorkerToGatewayMessage.safeParse`
  (`apps/gateway/src/ws/connection-manager.ts:188`); the
  client-supplied `workerId` must be scoped to the runtime key's
  tenant (`workerIdMatchesScope`,
  `apps/gateway/src/ws/runtime-key-auth.ts:106`) or the socket is
  closed 1008. Every accepted/rejected upgrade and every dispatch is
  audited (`apps/gateway/src/ws/audit.ts:31`).
