# Remote Runtime Daemon & Gateway — Design Draft

Status: draft, daemon/gateway/protocol/security half.
Companion: the admin-UI half is being drafted in parallel and will be merged into one combined plan.

This draft is opinionated. Where alternatives exist, the rejected option is named explicitly.

---

## 1. Goals & Non-Goals

### Goals

- One installable daemon that turns **any** Linux, Mac, or cloud VM into an attached SupportAgent runtime.
- Outbound-only network model: daemon dials a configurable gateway endpoint. No inbound ports required.
- Pair-by-code: launch container → operator pastes the printed code into the admin UI → machine is bound to a tenant/workspace.
- Linux daemons execute jobs as per-run Docker containers.
- Mac daemons execute jobs natively (iOS builds, simulator, app-reveal).
- Auto-provisioned ephemeral runtimes for GCP/AWS bursts, sharing the same daemon binary.
- Reuse existing `apps/gateway`, `apps/worker`, `packages/contracts`, `packages/executors-runtime`, `packages/skills-runtime`. No fork.
- Hosted SaaS, customer-private control plane, and on-prem deployments all use the same daemon and protocol.

### Non-Goals

- We are not building Kubernetes operators or Helm charts in MVP.
- We are not shipping a per-customer prebuilt image registry beyond two or three reference profiles.
- We are not building a multi-tenant scheduler inside the daemon; tenants own their daemons.
- We are not replacing HTTP API uploads for findings, artifacts, and final reports. WebSocket stays for control + log chunks only.
- We are not introducing a fourth top-level workflow type. Triage/build/merge stay canonical.

---

## 2. Topology

```
+--------------------+        outbound WSS         +-----------------+        bullmq / pubsub        +-----------+
|   daemon (any OS)  | <-------------------------> |   gateway       | <---------------------------- | dispatcher|
|   - registers      |   session_id + heartbeats   |   - WSS server  |   reverse-routes runs to ws   |  (in api) |
|   - capabilities   |   dispatch/log/cancel       |   - session reg |                                +-----------+
|   - exec adapter   |                             |   - reverse-dispatch                                  ^
|   - local sandbox  |                             |                                                       |
+--------------------+                             +-----------------+         HTTPS                +------+----+
        |                                                                                            |   API     |
        | per-job HTTPS (context fetch, artifact upload, final report, polling cancel)               |  Fastify  |
        +------------------------------------------------------------------------------------------> +-----------+
```

### Roles

- **daemon**: the installable thing. Either `worker` mode (executes jobs locally) or `gateway-pool` mode (delegates to a private worker pool). Default is `worker`.
- **gateway**: the SupportAgent-control-plane WebSocket termination point. Holds session state, routes dispatches, persists log chunks.
- **dispatcher**: in `apps/api`. Owns dispatch-attempt state, picks a session/provider, mints `workerSharedSecret`.
- **API**: source of truth, HTTP context/upload/report endpoints, polling cancel fallback.

### Where the gateway lives

Three deployment shapes, **one binary**:

1. **SaaS gateway** (default). Gateway runs in the SupportAgent cloud. Daemons everywhere dial it.
2. **Customer-private gateway**. Same binary, deployed inside the customer's VPC. Daemons in that VPC dial the customer gateway, which dials the SaaS API (or a customer-hosted API). Lets enterprises keep code, daemons, and live log chunks behind their own firewall while still using the hosted control plane.
3. **Per-machine local gateway**. The daemon embeds an in-process gateway when running in standalone-dev mode. Pure convenience for local dev. Not a production topology.

### When daemon and gateway are the same process

Only in mode 3 (local dev) and in deployments where one machine is the entire runtime and operator wants zero infra. For everything else, daemon and gateway are separate.

**Rejected alternative**: making the API itself the WebSocket terminator. The API is Cloud Run / horizontally scaled; long-lived WS sessions don't fit. The gateway is the dedicated session-bearing process — that's already the shape the repo started with.

---

## 3. Lifecycle

### Install

- Linux: `pnpm install -g @support-agent/runtime-cli` **or** `docker run ghcr.io/supportagent/runtime:<ver>`.
- Mac: `brew install supportagent/tap/runtime-cli` (native), or downloadable signed pkg. Docker not used for Mac job execution.
- Cloud auto-provisioned: image is the same Docker image as Linux; cloud plugin spawns and configures it.

### First run / pair

1. Daemon starts with no config. Generates a local node keypair stored in OS keychain (Mac) / `/var/lib/support-agent/node.key` (Linux, mode 0600, root-owned).
2. Daemon prints a **pairing code** to stdout and to a tail-friendly local file. The code is what the operator pastes into the admin UI.
3. Daemon opens an unauthenticated WSS to the configured gateway under path `/v1/pair`, presenting the pairing code and the node public key.
4. Once the admin UI claims the code, the gateway returns a long-lived `runtimeApiKey` (sealed to the node public key) plus a `runtimeId` and tenant scope.
5. Daemon drops the pair channel, persists the `runtimeApiKey` in OS-protected storage, and reconnects on the authenticated `/v1/session` endpoint.

### Online

- Maintains one persistent WSS session.
- Sends heartbeats every 15s. Gateway expects one within 45s.
- Sends `capabilities` on connect; re-advertises whenever toolchain detection re-runs (every 5 min while idle, plus after install of major tools).

### Capability re-advertise

- Daemon runs a periodic detector probe (node, docker, xcode-select, android-sdk, app-reveal, playwright binary, claude/codex CLI presence, GPU, RAM, free disk).
- Diff vs last advertised. If changed, send `capabilities.update` over the live session.

### Graceful drain

- Operator issues `runtime drain` over the admin UI (or local CLI `support-agent-cli drain`).
- Daemon flips advertised state to `draining` (gateway stops picking it for new dispatches).
- In-flight jobs complete normally.
- After last job exits, daemon either exits or stays connected as `idle-drained` until operator un-drains.

### Uninstall

- `support-agent-cli unregister` calls a control-plane revoke endpoint, wipes the local `runtimeApiKey` and node key.
- Local CLI also offers `--purge` to wipe `/var/lib/support-agent` and per-job workspace caches.

---

## 4. Pairing Protocol

### Code generation

- Generated by the daemon, not the server. Server generates nothing speculative.
- 128 bits of entropy, base32-Crockford, hyphenated into 4 groups of 6: `XXXXXX-XXXXXX-XXXXXX-XXXXXX`.
- TTL: 10 minutes. Single-use. Daemon refuses to print a second code while one is pending.

### Exchange flow — claim/accept split

We use a **two-phase claim/accept** flow so the operator confirmation gate is explicit and auditable.

1. Daemon dials `/v1/pair` and sends `pair.hello { pairingCode, nodePublicKey, osHint, hostnameHint, runtimeMode }`.
2. Gateway forwards this to the API and stores a `pairing_session` row (TTL 10 min, status `pending`).
3. Admin UI lists pending pairing sessions filtered by what the operator can see. Operator picks one, picks tenant + workspace + label + execution profiles, clicks **Accept**. API marks the row `claimed` and assigns scopes.
4. Gateway pushes `pair.accepted { runtimeId, sealedApiKey, tenantId, environment, allowedExecutionProfiles }` to the still-connected daemon over the pair channel.
5. Daemon decrypts the sealed key with its node private key, persists it, closes the pair channel, dials `/v1/session` with the new `runtimeApiKey`.

**Claim vs accept split**: the daemon's `pair.hello` is the **claim** (it claims a code it generated). The operator's UI confirmation is the **accept**. This prevents drive-by paste of leaked codes into the wrong tenant — the code without the holding socket is useless because the sealed key delivery requires the same active connection that posted `pair.hello`.

### Binding

- `pairing_session.acceptedTenantId` plus a one-shot `runtimeId` row inserted into `execution_provider_hosts` with `connection_mode=reverse_session`.
- Pairing is immutably scoped to that tenant. Re-tenanting requires unregister + re-pair.

### Audit

Every step (`pending`, `claimed`, `expired`, `rejected`, `accepted`, `key issued`) emits an `audit_events` row with the operator actor and the runtime fingerprint (hash of `nodePublicKey`).

### Rotation & revoke

- Rotate: operator clicks rotate in admin UI; gateway pushes `key.rotated { sealedApiKey }` over the live session; daemon writes the new key, ACKs, server marks old key revoked after ACK. Overlap window: 5 minutes.
- Revoke: server marks the key revoked, gateway force-closes the session, all subsequent connects with the old key are rejected. The local daemon then exits or enters re-pair mode.

**Rejected alternative**: short-lived JWT runtime tokens with no long-lived key. Rejected because daemons run on home labs / Mac minis without an always-available secrets backend to refresh tokens. Long-lived sealed key + session-scoped ephemeral secret is the right balance.

---

## 5. WebSocket Protocol

### Transport

- WSS only. TLS 1.3.
- Daemon supports an optional `expectedServerSpki` config that pins the server's SubjectPublicKeyInfo hash. Recommended for customer-private gateways with internal CAs. Off by default for SaaS where PKI rotation needs flexibility.

### Mutual auth

Two-layer:

- **Long-lived**: `runtimeApiKey` (delivered during pairing). Used at session establishment.
- **Per-session ephemeral**: server issues `sessionToken` (10-minute TTL, refresh over the live session) after `runtimeApiKey` validates. The daemon then uses `sessionToken` for everything inside the session, including HTTP context fetches that need to be reverse-correlated.

The original `runtimeApiKey` is **never** sent on dispatch sub-protocol messages. Only at `/v1/session` connect. Session token gets refreshed; key only re-presented on reconnect.

### Framing

Every message is JSON, one message per WS frame, with a versioned envelope:

```json
{
  "v": 1,
  "id": "msg_<uuid>",
  "channel": "control" | "log" | "heartbeat",
  "type": "dispatch" | "dispatch.ack" | "progress" | "log.chunk" | "cancel_requested" | "cancel_force" | "capabilities.update" | "session.refresh" | "pong" | "ping" | "drain" | "key.rotated" | "error",
  "ts": "<iso8601>",
  "payload": { ... }
}
```

Rejected alternatives: protobuf (overkill for current message volume); SSE (one-direction only). Plain JSON envelope with `v` field is enough; we can swap to msgpack later behind the envelope.

### Channels

- **control**: dispatch, ack, cancel, capabilities, key rotation, drain. Strict ordering required.
- **log**: incremental log chunks, progress updates. Lossy on overload (backpressure rule below). Server persists each chunk to HTTP-backed `workflow_log_events` so reconnect doesn't lose history.
- **heartbeat**: `ping`/`pong` plus liveness counters. Separate channel so log-chunk backlog can never starve heartbeats.

Channel separation is logical (a `channel` field), not physical multiplexing. Single WS connection. The server reads heartbeats first when draining incoming buffers.

### Backpressure

- Daemon log chunk send buffer is bounded (default 4 MiB). When over high-water mark, daemon coalesces (newline-joins) and drops to the lowest-priority log level until drained. Critical events (`progress`, `dispatch.ack`, `error`) are never dropped — they go on the control channel.
- Server-side, if WS write buffer to a daemon backs up past 1 MiB, the gateway closes the connection with code 1008 and the daemon reconnects with the resumable session id.

### Reconnect with resumable session

- Daemon stores `sessionId` returned by the gateway at connect time.
- On reconnect, daemon presents `runtimeApiKey + lastSessionId + lastSeenServerMsgId`. Gateway will:
  - resume the session if the registry still owns it and TTL has not expired (default 60s);
  - re-deliver any unacked control messages since `lastSeenServerMsgId`;
  - or open a fresh session if the old one is gone, and tell the daemon `resumed=false` so it knows to re-handshake any in-flight job state via HTTP.

### Idle / dead detection

- Server: missing heartbeat for 45s → mark session `lost`. In-flight dispatch attempts attached to that session move to `lost` after a 30-second grace window so the daemon's resume attempt is honored if it reconnects.
- Daemon: missing `pong` for 60s after a `ping` → force-reconnect.

---

## 6. Job Dispatch Contract

The on-wire payload reuses `WorkerJobSchema` from `packages/contracts`. No fork.

### Sequence

1. Server → daemon: `control:dispatch { job, dispatchAttemptId, workerSharedSecret, sessionToken }`.
2. Daemon → server: `control:dispatch.ack { dispatchAttemptId, status: "accepted" | "rejected_busy" | "rejected_capability" | "rejected_drained" }`.
   - Server only marks the dispatch attempt `acknowledged` on `accepted`. Other statuses immediately fail the attempt and the dispatcher picks again.
3. Daemon executes (Docker for Linux, native for Mac). Workspace, secret injection, run, log capture.
4. While running:
   - `log:log.chunk { workflowRunId, stage, level, lines[] }` — fire-and-forget, persisted server side as `workflow_log_events`.
   - `control:progress { workflowRunId, currentStage, message }` — checkpoint-safe progress, durable.
5. Final report and bulky artifacts go over **HTTPS** to the API directly, signed with `workerSharedSecret`. Not over WS. This rule is explicit in existing docs and we preserve it.
6. Daemon → server: `control:dispatch.complete { dispatchAttemptId, terminalStatus: "succeeded" | "failed" | "canceled", stderrSummary }`.

### `workerSharedSecret` binding

- Minted by the dispatcher per `dispatchAttemptId`. Stored in `worker_dispatches.workerSharedSecretRef` (hashed).
- TTL: `runTimeoutSeconds + 15 min` so post-run final report uploads complete.
- Bound to `(tenantId, workflowRunId, dispatchAttemptId)`. API rejects the secret on any other run id or attempt id.
- The secret travels **inside the dispatch envelope**, never in the URL, never in logs. Daemon stores it in process memory only (no disk) and zeroes it on dispatch completion.
- Stale on retry: when the dispatcher creates `attemptNumber+1`, the older secret is revoked atomically with the new mint. The old worker process can keep running, but API writes from it are 401'd.

### Cancel — two-phase

Reuses existing `cancel_requested` / `cancel_force` semantics from `gateway-protocol.ts`.

- `cancel_requested` over WS → daemon sets a checkpoint flag readable by the executor adapter (Docker or native). The adapter checks at safe points and exits gracefully.
- `cancel_force` over WS → daemon sends `SIGTERM` to the executor subprocess. After a 10-second grace, escalates to `SIGKILL`. For Docker: `docker kill --signal=TERM` then `--signal=KILL`. For native Mac: same lifecycle on the spawned process group.
- HTTP fallback (authoritative until API ↔ gateway session bridge exists): worker also polls a `GET /v1/dispatch/{attemptId}/control` endpoint that returns `{ status, cancelForceRequestedAt }`. This is the canonical cancel transport per docs/contracts and stays the source of truth.

The WS path is best-effort fast cancel; the HTTP poll is durable. When both fire, daemon honors whichever arrives first and ignores duplicates.

---

## 7. Local Execution Adapters

### Docker adapter (Linux daemons, default)

- One container per dispatch attempt. No reuse across runs.
- Image is one of the prebuilt runtime profiles: `worker-core`, `worker-web`, `worker-android`. Daemon picks the smallest profile that satisfies `executionProfile`.
- Per-run ephemeral workspace mounted at `/workspace`, host-side at `/var/lib/support-agent/workspaces/<runId>`. `tmpfs` for `/tmp` inside the container.
- Resource limits: CPU shares, memory limit, pids limit, configurable per execution profile. Defaults: 4 vCPU, 8 GiB RAM, 4096 pids.
- Network: containers attach to a dedicated bridge with an explicit egress allowlist (see §10). No host network mode.
- Lifecycle: `docker run --rm` with the run-config; daemon supervises stdout/stderr → log chunks; on cancel, signal escalation as above; on exit, daemon collects exit code, posts final report, then `docker rm` (rm via `--rm` for normal flow).
- Image signing: daemon refuses to run unsigned images. Cosign signature with the SupportAgent public key, verified before container start. Customer-pinned alternative keys allowed via config.

### Native adapter (Mac daemons)

- No Docker. Jobs run as child processes of the daemon under a dedicated unprivileged macOS user (`_supportagent`), sandboxed with `sandbox-exec` profile that allows: project workspace dir, `xcrun`, `xcode-select`, `xcodebuild`, simulator helpers, `gh`, network egress per allowlist.
- Per-run workspace under `/Users/_supportagent/workspaces/<runId>`. Cleaned on exit.
- iOS toolchain detection at capability advertise time:
  - `xcode-select -p` must succeed.
  - `xcrun simctl list devices` must enumerate at least one simulator runtime if `executionProfile=ios-repro`.
  - `xcrun --find xcodebuild` must succeed.
  - `xcrun altool` or `xcrun notarytool` presence for signed build profiles.
- App-reveal detection: presence of `app-reveal` binary on PATH and a runnable `--version`.
- Simulator availability is re-checked when the daemon receives a job for `ios-repro` (cheap call, sub-100ms), refusing the dispatch if it has changed since last advertise.
- Keychain integration: the daemon stores its `runtimeApiKey` in the user keychain of a service account, not in a flat file.

**Rejected alternative**: Linux-style Docker on Mac via Docker Desktop for iOS jobs. Cannot build iOS inside Docker. Native is mandatory.

---

## 8. Capability Advertisement Schema

```json
{
  "type": "capabilities.update",
  "payload": {
    "runtimeId": "rt_...",
    "advertisedAt": "<iso8601>",
    "advertisementId": "<uuid>",
    "os": { "kind": "linux" | "darwin" | "windows", "version": "...", "arch": "x86_64" | "arm64" },
    "hardware": {
      "cpuCores": 16,
      "ramBytes": 34359738368,
      "diskFreeBytes": 500000000000,
      "gpu": { "present": true, "vendor": "nvidia", "model": "L4", "memoryBytes": 24000000000 } | null
    },
    "toolchains": {
      "node": { "present": true, "version": "20.18.0" },
      "docker": { "present": true, "version": "27.1.1", "engine": "docker" | "podman" | "containerd" },
      "xcode": { "present": false } | { "present": true, "version": "16.0", "selectedPath": "/Applications/Xcode.app/Contents/Developer", "iosSdks": ["18.0"] },
      "androidSdk": { "present": false } | { "present": true, "buildToolsVersion": "34.0.0", "platforms": ["android-34"] },
      "playwright": { "present": true, "browsers": ["chromium", "firefox", "webkit"] },
      "appReveal": { "present": false },
      "claude": { "present": true, "cliVersion": "1.0.x" },
      "codex": { "present": true, "cliVersion": "..." },
      "gh": { "present": true, "authenticated": true, "scopes": ["repo", "read:org"] }
    },
    "executionProfiles": ["analysis-only", "web-repro", "android-repro"],
    "maxConcurrency": 2,
    "currentLoad": 0,
    "network": {
      "egressAllowlistEnforced": true,
      "publicIngressOpen": false
    },
    "modelAccess": { "mode": "proxy" | "tenant-provider", "proxyReachable": true },
    "daemonVersion": "0.4.2",
    "fingerprint": "<sha256 of nodePublicKey>"
  }
}
```

Rule: only advertise toolchains the daemon has just verified runnable. If `docker info` failed in the last detection, `docker.present=false`. No optimistic claims.

The dispatcher's provider selection consumes this directly. `executionProfiles` is the join key against `execution_profiles`.

---

## 9. Auto-Provisioning

This is a separate code path from manually-paired daemons. Same daemon binary, different lifecycle.

### Shape

- A `cloud-provisioner` service inside `apps/api` (or co-located with the dispatcher) implements `CloudProvisionerPlugin` interface:
  ```ts
  interface CloudProvisionerPlugin {
    key: string; // "gcp-compute", "aws-fargate", "fly-machines", ...
    canSatisfy(profile: ExecutionProfile, hints: ProviderHints): boolean;
    spawn(spec: EphemeralRuntimeSpec): Promise<EphemeralRuntimeHandle>;
    terminate(handle: EphemeralRuntimeHandle): Promise<void>;
  }
  ```
- When the dispatcher has a queued run and no idle paired daemon matches, it asks each enabled plugin in priority order whether it can satisfy the profile.

### Spawn sequence

1. Dispatcher mints a **pre-claimed pairing code** (server-side, exception to §4 — auto-provisioned daemons skip the operator-accept step because the server itself is the acceptor).
2. Plugin launches a container/VM/Fargate task with env: `SUPPORT_AGENT_PAIRING_CODE`, `SUPPORT_AGENT_API_BASE_URL`, `SUPPORT_AGENT_GATEWAY_URL`, `SUPPORT_AGENT_EPHEMERAL=1`, `SUPPORT_AGENT_BOUND_RUN_ID=<workflowRunId>`.
3. Daemon boots, sees `SUPPORT_AGENT_EPHEMERAL=1`, runs the pair flow non-interactively: the pre-claimed code is auto-accepted because it was server-minted and `pairing_session.autoProvisioned=true`.
4. Daemon connects, advertises capabilities, is immediately dispatched the bound run.
5. On run completion (or timeout), daemon sends `drain.complete` and exits 0. Plugin reaps the container.

### Ephemeral vs paired distinction

Stored on the runtime registration:
- `runtimes.lifecycle = "paired" | "ephemeral"`
- `runtimes.boundWorkflowRunId` is set for ephemeral. Dispatcher will not assign any other run to an ephemeral runtime.
- TTL: ephemeral runtimes auto-revoke their `runtimeApiKey` after the bound run finishes or after `runTimeoutSeconds + 15 min`, whichever comes first.

### MVP plugins

Pick **two** for v1:
- `gcp-compute` (Compute Engine instance with the daemon image, MIG-friendly).
- `aws-fargate` (ECS Fargate task running the daemon image).

Reject Kubernetes-operator-driven provisioning in MVP. The whole point is "I don't want a control plane to operate." If a customer is on EKS/GKE, they can run the daemon as a Deployment manually and pair it.

---

## 10. Security

### TLS

- TLS 1.3 minimum.
- SPKI pinning option per `expectedServerSpki` in daemon config. Off in SaaS, recommended in customer-private gateway.

### `runtimeApiKey` storage

- Mac: macOS Keychain in a service account namespace (`com.supportagent.runtime.<runtimeId>`).
- Linux: `/var/lib/support-agent/api-key` mode 0400, owned by `support-agent` user (created at install). Optional integration with HashiCorp Vault / GCP Secret Manager / AWS Secrets Manager via daemon-side `--secret-source` flag.
- Never in environment variables for long-lived daemons. Pairing flow returns the key sealed-to-node-public-key so it can be safely transported once and persisted only by the daemon.

### Egress allowlist

Daemon enforces an outbound egress allowlist on job containers (Linux) and via macOS Network Extension / `pf` rules (Mac). Default allowlist:

- SupportAgent API and gateway URLs.
- Repository hosts the run is allowed to clone from (per `execution_profile.allowedRepoHosts`).
- Package registries declared in execution profile (npmjs, pypi, maven, etc.).
- Model provider endpoints **only** in `tenant-provider` mode (since proxy mode goes back through the gateway).

Operator can override the allowlist per execution profile.

### Image signing for spawned Docker job containers

- Cosign keyless or keyful signature required.
- Daemon refuses to `docker run` an image whose signature doesn't verify against the configured public key.
- Customer-built runtime images are signed by the customer; the customer pushes their public key into their tenant config.

### Secret injection (one-time per-job)

This is the rule: **the daemon must never permanently hold secrets that workflows need.**

- `workerSharedSecret`: in-memory only, lifetime = dispatch attempt.
- Repository credentials, model-provider credentials, connector tokens: fetched from API at job start by the in-container worker process, using `workerSharedSecret`. Stored only in the per-run container filesystem (or per-run native workspace) and shredded at job end.
- Long-lived runtime credentials are only `runtimeApiKey` (registration) and the node keypair. Nothing else.

**Rejected alternative**: pushing repo tokens into the daemon at pair time so it can pre-stage them. Rejected because it makes the daemon a target — compromise of one runtime should never leak more than its own session credentials.

---

## 11. Observability

### Structured logs

- Daemon emits NDJSON to stdout (so `docker logs` / `journalctl -u support-agent` Just Works) plus a rolling file under `/var/log/support-agent/` (Linux) / `~/Library/Logs/support-agent/` (Mac).
- Fields: `ts`, `level`, `event`, `runtimeId`, `sessionId`, `dispatchAttemptId?`, `workflowRunId?`, `msg`, `error?`.

### Local-only health endpoint

- Daemon binds `127.0.0.1:7311/health` (configurable, never default-bound to 0.0.0.0).
- Returns: `{ status, runtimeId, sessionConnected, sessionId, currentLoad, lastHeartbeatAt, capabilitiesAdvertisedAt, daemonVersion }`.
- No auth, but localhost-only.
- Optional Prometheus endpoint at `127.0.0.1:7312/metrics` with the same scope rules.

### Uplink metrics

Daemon sends a `metrics.snapshot` control message every 60s with: CPU/RAM usage of host, current job count, queued log chunks, last-100s log-chunk drop count, docker / native adapter health. Persisted server-side for the admin UI dashboard.

### Version reporting & self-update

- Daemon reports `daemonVersion` on every capability advertise.
- Server returns `latestStableVersion` and `latestSupportedMinVersion` in the session response.
- Daemon prints a banner if outdated. **Auto-update is opt-in.** When enabled (`--auto-update=stable`), daemon downloads a signed binary from the SaaS update channel and swaps it in on next idle window. Signed with the same image-signing key.
- Rejected: forced auto-update. Some customers will run daemons in air-gapped envs; we can't yank versions.

---

## 12. Failure Modes & Recovery

| Failure | What happens | Recovery |
|---|---|---|
| Network partition mid-job | WS drops. Daemon keeps running the job locally. Job logs queue in daemon buffer (capped, oldest-dropped). Final report still goes to API over HTTPS — that path may also fail and gets retried with jittered backoff up to 30 min. | Daemon reconnects with `lastSessionId`. If resumed, re-sends queued progress and pending complete. If not resumed, daemon polls `GET /v1/dispatch/{attemptId}` to learn whether the dispatcher already marked the run `lost` and the run was retried elsewhere. If `lost`, daemon discards local results (no double-write) and zeroes secrets. |
| Daemon crash mid-job | OS service manager restarts the daemon. Daemon on boot scans `/var/lib/support-agent/in-flight/` for state files (one per attempt). For Docker: container is still running, daemon re-attaches via container id. For native: process likely died with the daemon, run is marked failed locally and reported on next connect. | Idempotent re-attach via container id. If the daemon can't re-attach, it marks the local attempt failed and lets the dispatcher's `lost` logic + retry policy handle it. |
| Gateway crash | All sessions drop. Daemons reconnect with backoff (1s, 2s, 4s, 8s, capped at 30s, jittered). Sessions resume if the gateway's session registry is durable (Redis or Postgres-backed). | We make session registry Redis-backed, mirrored to Postgres for cold-start recovery. Lost in-flight runs go to dispatcher `lost` logic. |
| Dispatcher session loss to gateway | Internal queue, not WS — handled by `bullmq` / Pub/Sub retry. | Standard. |
| Duplicate dispatch protection | Each `dispatchAttemptId` is unique. Daemon rejects a dispatch whose `dispatchAttemptId` it has already accepted (idempotent ACK). Server checks `attemptNumber` against `worker_dispatches`. `acceptedDispatchAttempt` on `workflow_runs` is the only one whose final report wins. | Stale secrets are revoked atomically on new attempt mint. |

---

## 13. Open Questions / Decisions for Review

1. **Single daemon binary vs split worker/gateway-pool**. Recommendation: single binary, mode selected by config. Confirm.
2. **Session registry backing store**. Redis (fast, easy) vs Postgres-only (one fewer dependency). Recommendation: Redis with Postgres mirror. Confirm.
3. **macOS daemon distribution**. Homebrew tap vs signed pkg vs both. Recommendation: both, with Homebrew as primary.
4. **Cosign vs Docker Content Trust** for image signing. Recommendation: Cosign (modern, sigstore-friendly).
5. **Embedded gateway in daemon for local dev**. Yes/no. Recommendation: yes, gated behind `--standalone-dev`.
6. **Auto-update channel**. Stable / beta / pinned. Confirm we want three.
7. **Should we allow pairing without operator confirmation when the request comes from a known internal IP range (auto-provisioner shortcut)?** Recommendation: only the server-minted code path skips operator confirmation; raw IP-based shortcuts are rejected.
8. **`workerSharedSecret` delivery** — currently inside the WS dispatch envelope. Alternative: deliver via short HTTPS handshake the daemon makes immediately after dispatch.ack. Recommendation: keep inside the WS envelope; the envelope is already TLS-protected and not logged.
9. **Per-run network namespace on Linux**. Use `docker run --network=<per-run-net>` or accept the bridge default. Recommendation: dedicated bridge per profile, not per run.
10. **GPU jobs** — out of scope for MVP? Recommendation: declare capability, but don't dispatch GPU-required jobs until v1.

---

## 14. Integration With Existing Code

### Packages to add (new)

- `packages/runtime-cli` — the installable daemon. New package. Imports `@support-agent/contracts`, `@support-agent/config`. Provides `support-agent-runtime` and `support-agent-cli` binaries.
- `packages/reverse-connection` — extracted WS protocol layer used by both `apps/gateway` and `packages/runtime-cli`. Move `gateway-protocol.ts` envelope helpers here and add session-resume logic. Reuses, not forks.

### Existing packages to extend

- `packages/contracts/src/gateway-protocol.ts` — extend with the v1 envelope (`v`, `id`, `channel`, `ts`), session-resume messages, capabilities.update, key.rotated, drain, metrics.snapshot. Keep current message types as the v0 dialect for backward compat during rollout.
- `packages/contracts/src/worker-job.ts` — no schema change required.
- `apps/gateway/src/ws/connection-manager.ts` — refactor to consume `packages/reverse-connection`. Add session registry, resume, channel separation, capability persistence into `execution_provider_hosts`. Replace ad-hoc heartbeat with envelope heartbeats.
- `apps/gateway/src/app.ts` — add `/v1/pair` route and `/v1/session` route. Keep `/health`.
- `apps/worker/src/transport/ws-transport.ts` — superseded by `packages/runtime-cli`. The existing `apps/worker` becomes a thin shell that uses `runtime-cli` internals in dev mode, so we don't have two parallel WS clients.
- `apps/api` — add `pairing_session` table + endpoints (`POST /v1/admin/pairings/{id}/accept`, `GET /v1/admin/pairings`), `cloud_provisioner` module, runtime audit endpoints.
- `apps/worker` — keep as the in-container job executor invoked by the Docker adapter. It's the per-run process, not the daemon. We rename it conceptually to "job runner" in docs.

### What does **not** move

- `packages/skills-runtime`, `packages/executors-runtime`, `packages/skills-executor-runtime`, executor and skill content delivery via authenticated by-hash API endpoints — unchanged.
- HTTP final-report and artifact paths — unchanged.
- HTTP polling cancel fallback in `apps/worker/src/lib/dispatch-control.ts` — unchanged. The new WS cancel is supplementary, not replacement.

---

## 15. Phased Rollout

### MVP (4–6 weeks)

- New `packages/runtime-cli` and `packages/reverse-connection` packages.
- Pairing flow (operator-accept) for Linux Docker daemons.
- Capability advertise (subset: os, arch, docker, node, ram, executionProfiles).
- WSS session with v1 envelope, heartbeats, resume, dispatch, cancel (two-phase), log chunks.
- Docker adapter for one profile: `worker-core`. Cosign verify required.
- Admin UI pairing pages (the parallel UI half handles this).
- Reuse `workerSharedSecret` and HTTP final-report paths verbatim.
- No auto-provisioning. No Mac. No tenant-provider model mode wiring (proxy only).

### v1 (next ~6 weeks)

- Mac native adapter with iOS toolchain detection and `app-reveal`.
- `worker-web` and `worker-android` Docker profiles.
- Auto-provisioning: `gcp-compute` plugin.
- Key rotation and revoke flow end-to-end.
- Egress allowlist enforcement.
- Customer-private gateway deployment guide.

### v2

- `aws-fargate` plugin.
- Self-update channel.
- GPU capability declaration & dispatch.
- Optional Vault / Secret Manager integration for daemon key storage.
- Image signing key delegation (customer-built images, customer key).
- Approval-gated runtime rotation for high-security tenants.

---

## Appendix A — Why these stances

- **One binary, two modes**. Two binaries doubles release + signing + update cost for marginal benefit.
- **Server-issued sealed key, not server-issued JWT**. Daemons live on hardware we don't control. They need an offline-capable credential.
- **HTTP for bulky uploads stays**. The existing model is correct; WS is not the right transport for finals.
- **Operator-accept pairing**. The cost of a mis-paired daemon (wrong tenant, exfiltrating source) is too high to skip the explicit human step. Auto-provisioned is the only exception, and the server is the one minting the pre-accepted code.
- **No Kubernetes operator in MVP**. The goal is "install daemon on any computer." Kubernetes is a niche subset; it can wait.
