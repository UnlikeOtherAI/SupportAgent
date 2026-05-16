# Remote Runtime — Merged Design Plan

Status: merged synthesis of the daemon/gateway/protocol/security draft and the
admin-UI/Kelpie draft. Reviewers should resolve items in §16
"Conflicts & open questions" before this becomes the build spec.

Terminology: a `worker` executes a job; a `gateway` dispatches jobs to one or
more workers; an `execution provider` describes where a worker runs. The
operator-facing noun for the unit being managed in the admin app is a
**Machine**: a paired daemon (Mac mini, Linux box) or an auto-provisioned
ephemeral cloud VM. A Machine may host zero or more workers and may or may
not embed a local gateway. In API/contract terms we keep `runtimeId`.

---

## 1. Goals & non-goals

### Goals

- One installable daemon binary that turns **any** Linux, Mac, or cloud
  VM into an attached SupportAgent runtime.
- Outbound-only network model: daemon dials a configurable gateway
  endpoint; no inbound ports required on the daemon host.
- Pair-by-code, friction-free: launch container → operator pastes the
  printed code into the admin UI → machine bound to a tenant/workspace
  in < 60 s, no terminal copy-paste of long-lived API keys.
- Linux daemons execute jobs as per-run Docker containers; Mac daemons
  execute jobs natively (iOS builds, simulator, app-reveal).
- Auto-provisioned ephemeral runtimes for GCP/AWS bursts share the same
  daemon binary; opt-in, capped, visible in the admin app.
- A single glanceable place in the admin app shows every Machine the
  tenant is using and lets the operator target a specific Machine,
  pool, capability, or ephemeral provider per workflow step.
- Health, capability, and "current job" visibility must be live — not a
  refresh page.
- Kelpie ("LLM-first mobile browser") can be invoked from the admin UI
  to drive any visual setup that must happen on the daemon host
  (GitHub OAuth, Xcode login, App Store Connect, scan-pair-QR, etc.),
  then hand control back.
- Reuse existing `apps/gateway`, `apps/worker`, `packages/contracts`,
  `packages/executors-runtime`, `packages/skills-runtime`. No fork.
- Hosted SaaS, customer-private control plane, and on-prem deployments
  use the same daemon and protocol.

### Non-goals

- No Kubernetes operators or Helm charts in MVP (customers on EKS/GKE
  can run the daemon as a Deployment manually and pair it).
- No per-customer prebuilt image registry beyond two or three reference
  profiles.
- No multi-tenant scheduler inside the daemon; tenants own their daemons.
- HTTP API uploads for findings, artifacts, and final reports are not
  replaced — WebSocket stays for control + log chunks only.
- No fourth top-level workflow type — triage/build/merge stay canonical.
- No cross-tenant marketplace of shared machines.
- No bring-your-own Kubernetes operator for ephemerals; only
  Docker-on-VM ephemerals in v1.
- No full mobile admin app — pairing flow assists mobile via QR, but
  the authoring app stays desktop-CSR.
- The existing `/runtimes` route from `admin-ui.md` is not renamed
  conceptually — it is aliased to `/infrastructure/machines` (see §10).

---

## 2. Topology overview

```
+----------------+   outbound WSS     +-------------+   bullmq/pubsub   +-----------+
|  daemon (any   | <----------------> |  gateway    | <---------------- | dispatcher|
|   OS)          |  session_id +      |  WSS server |  reverse-routes   |  (in api) |
|  registers /   |  heartbeats /      |  session    |  runs to ws       +-----------+
|  capabilities  |  dispatch / log /  |  registry / |                          ^
|  exec adapter  |  cancel            |  reverse-   |        HTTPS             |
|  local sandbox |                    |  dispatch   |                   +------+----+
+----------------+                    +-------------+                   |    API    |
       |                                                                |  Fastify  |
       | per-job HTTPS (context, artifact upload, final report,         +-----------+
       |  polling cancel)                                                      ^
       +-----------------------------------------------------------------------+
```

### Roles

- **daemon** — the installable thing. Either `worker` mode (executes
  jobs locally) or `gateway-pool` mode (delegates to a private worker
  pool). Default `worker`. One binary, mode selected by config (§16 Q1).
- **gateway** — SupportAgent-control-plane WebSocket termination point;
  holds session state, routes dispatches, persists log chunks.
- **dispatcher** — in `apps/api`; owns dispatch-attempt state, picks a
  session/provider, mints `workerSharedSecret`.
- **API** — source of truth; HTTP context/upload/report endpoints,
  polling cancel fallback, admin app's read/write surface.

### Where the gateway lives

Three deployment shapes, **one binary**:

1. **SaaS gateway** (default) — gateway runs in the SupportAgent cloud;
   daemons everywhere dial it.
2. **Customer-private gateway** — same binary, deployed inside the
   customer's VPC; daemons in that VPC dial the customer gateway, which
   dials the SaaS API (or a customer-hosted API). Keeps code, daemons,
   and live log chunks behind the customer firewall while still using
   the hosted control plane.
3. **Per-machine local gateway** — the daemon embeds an in-process
   gateway when running `--standalone-dev`. Convenience for local dev;
   not a production topology.

For everything except mode 3, daemon and gateway are separate processes.

**Rejected**: making the API itself the WebSocket terminator. The API is
Cloud Run / horizontally scaled; long-lived WS sessions don't fit. The
gateway is the dedicated session-bearing process — already the shape
the repo started with.

---

## 3. Pairing protocol (daemon ↔ gateway ↔ admin UI, end-to-end)

The pairing flow has two halves that must agree:
the daemon-side cryptographic claim/accept exchange, and the operator-side
admin-app pairing modal experience. This section describes the unified flow.

### 3.1 Code generation

Code is **generated by the daemon**, not the server (no speculative
server generation). 128 bits of entropy, base32-Crockford, hyphenated
into 4 groups of 6: `XXXXXX-XXXXXX-XXXXXX-XXXXXX`. TTL 10 minutes,
single-use; daemon refuses to print a second code while one is pending.

> CONFLICT: code format & TTL. Daemon draft: 128-bit base32-Crockford,
> 4×6 groups, TTL 10 min. UI draft: human-readable wordlist + checksum
> (`BERLIN-OAK-9421-VIOLET`, "12 chars of entropy"), TTL 5 min. Rec:
> daemon's base32-Crockford format (more entropy, simpler validation
> regex), TTL 10 min — UI countdown should match whatever value lands.
> See §16 Q-A.

### 3.2 Operator script (target UX)

(1) Operator clicks `+ Pair Machine` on `/infrastructure/machines`.
(2) Modal opens; operator picks an OS / arch (macOS arm64, Linux x64,
Linux arm64); UI shows the exact `docker run …` or `npx
@supportagent/runtime register` one-liner with a copy button and an OS
picker tab strip. (3) Operator runs the command on the target host;
daemon prints a pairing code (format per §3.1) to stdout and to a
tail-friendly local file. (4) In the admin modal a live regex-validated
input with TTL countdown appears below the install snippet. (5) Operator
pastes the code; UI calls the claim endpoint (§3.5); admin subscribes
via the existing admin WebSocket until status transitions to `online`.
(6) Once `online`, the modal collapses into a success card with
editable machine name, default tags, default capability summary, and
two CTAs `Open machine` / `Configure auto-provisioning`.

### 3.3 Cryptographic exchange — claim/accept split

Two-phase claim/accept flow makes the operator confirmation gate
explicit and auditable. (1) Daemon dials `/v1/pair` (unauthenticated)
and sends `pair.hello { pairingCode, nodePublicKey, osHint,
hostnameHint, runtimeMode }`. (2) Gateway forwards to the API which
stores a `pairing_session` row (TTL per §3.1, status `pending`) — this
is the **claim**: daemon claims its own code while holding the live
socket open. (3) Admin UI lists pending pairing sessions visible to the
operator; operator picks one, picks tenant + workspace + label +
execution profiles, clicks **Accept** — API marks the row `claimed` and
assigns scopes (the **accept**). (4) Gateway pushes `pair.accepted {
runtimeId, sealedApiKey, tenantId, environment,
allowedExecutionProfiles }` to the still-connected daemon over the pair
channel. (5) Daemon decrypts the sealed key with its node private key,
persists it, closes the pair channel, dials `/v1/session` with the new
`runtimeApiKey`.

The claim/accept split prevents drive-by paste of leaked codes into the
wrong tenant — the code without the holding socket is useless because
sealed-key delivery requires the same active connection that posted
`pair.hello`.

### 3.4 UI pairing states

- `waiting` — code generated, no daemon has claimed it yet. Visual:
  subtle pulse on code box.
- `claimed` — daemon presented the code; awaiting handshake. Visual:
  spinner with "verifying…" hint.
- `handshake` — capabilities/identity being negotiated. Visual:
  progress bar with capability bullets streaming in.
- `online` — daemon authenticated and heartbeating. Visual: green dot
  + slide to success state.
- `code_expired` — TTL hit before claim. Visual: amber banner +
  `Regenerate` button.
- `code_reused` — same code presented twice. Visual: red banner +
  `Regenerate` button ("codes are single-use").
- `network_lost` — browser lost WS mid-handshake. Visual: toast +
  manual `Resume` button that re-polls by request id.
- `verification_failed` — daemon cert/identity mismatch. Visual: red
  banner "Contact support / regenerate" — never silent retry.

The flow uses one request-correlated `pairingRequestId` so all states
can be resumed even after a browser refresh.

### 3.5 API endpoints for pairing

> CONFLICT: endpoint naming.
> Daemon draft references `POST /v1/admin/pairings/{id}/accept`,
> `GET /v1/admin/pairings`.
> UI draft references `POST /v1/machines/pair`, `POST /v1/machines/claim`.
> Recommend unifying on `/v1/admin/pairings/*` for operator-visible accept
> endpoints (consistent with audit), and adding `POST /v1/machines/claim`
> as the admin-UI's code-paste call, which the API resolves into the
> matching `pairing_session`. See §16 Q-B.

### 3.6 QR fallback (mobile-paired Mac minis)

Mac minis often live in a closet without a keyboard. The pairing modal
includes a `Show QR` toggle rendering the pairing code as a QR encoding
`supportagent-pair://CODE?req=<pairingRequestId>&host=<api-base>`. The
operator scans the QR with Kelpie on their phone (see §11); Kelpie
opens its own tab navigated to a tiny `/pair-helper` page in the admin
app (JWT scoped to read-only pair status) streaming the pairing
progress so the operator confirms success on the same phone they
scanned with. Code entry can also happen daemon-side — the operator
can SSH and paste the code into the daemon's TTY prompt; the daemon
then claims the slot. Both directions are supported.

### 3.7 Binding & audit

`pairing_session.acceptedTenantId` plus a one-shot `runtimeId` row in
`execution_provider_hosts` with `connection_mode=reverse_session`.
Pairing is immutably scoped to that tenant; re-tenanting requires
unregister + re-pair. Every step (`pending`, `claimed`, `expired`,
`rejected`, `accepted`, `key issued`, plus UI-side states like
`code_reused`) emits an `audit_events` row with operator actor and
runtime fingerprint (hash of `nodePublicKey`).

### 3.9 Rotation & revoke

**Rotate**: operator clicks rotate in admin UI; gateway pushes
`key.rotated { sealedApiKey }` over the live session; daemon writes the
new key, ACKs, server marks old key revoked after ACK. Overlap window 5
min. UI shows a progress modal and the rotated fingerprint. **Revoke**:
server marks the key revoked, gateway force-closes the session, all
subsequent connects with the old key rejected; daemon then exits or
enters re-pair mode.

**Rejected**: short-lived JWT runtime tokens with no long-lived key —
daemons run on home labs / Mac minis without an always-available
secrets backend to refresh tokens; long-lived sealed key +
session-scoped ephemeral secret is the right balance.

### 3.10 Failure recovery & inline help

Codes are single-use **and** tied to a `pairingRequestId`; reuse must
fail loudly with an audit entry. An expired code is **not**
auto-regenerated — operator clicks Regenerate (auto-regen creates a UX
trap where stale daemons claim surprise slots). Network failure during
handshake: the daemon's claim is already server-side; UI re-subscribes
to status by `pairingRequestId`, no second claim needed.

Inline help: each OS tab links to a short doc snippet on prerequisites
(Docker Desktop, Xcode CLT for `mac-repro`, etc.); a "Why a code, not an
API key?" inline help explains the runtime API key is provisioned
silently on first handshake — the operator never copy-pastes long
secrets; an `Already have a daemon running? Use code` link switches the
modal to pure code-paste mode without the install snippet.

---

## 4. WebSocket protocol

### 4.1 Transport

WSS only. TLS 1.3 minimum. Daemon supports optional `expectedServerSpki`
config pinning the server's SubjectPublicKeyInfo hash — recommended for
customer-private gateways with internal CAs; off by default for SaaS
where PKI rotation needs flexibility.

### 4.2 Mutual auth — two-layer

**Long-lived**: `runtimeApiKey` (delivered during pairing) — used at
session establishment only. **Per-session ephemeral**: server issues
`sessionToken` (10-minute TTL, refresh over the live session) after
`runtimeApiKey` validates; daemon uses `sessionToken` for everything
inside the session, including HTTP context fetches that need
reverse-correlation. `runtimeApiKey` is **never** sent on dispatch
sub-protocol messages — only at `/v1/session` connect. Session token
refreshes; key only re-presented on reconnect.

### 4.3 Framing

JSON, one message per WS frame, with a versioned envelope:

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

Rejected alternatives: protobuf (overkill for current message volume); SSE
(one-direction only). Plain JSON envelope with `v` field is enough; we can
swap to msgpack later behind the envelope.

### 4.4 Channels

**control** — dispatch, ack, cancel, capabilities, key rotation, drain;
strict ordering required. **log** — incremental log chunks, progress
updates; lossy on overload (see backpressure); server persists each
chunk to HTTP-backed `workflow_log_events` so reconnect doesn't lose
history. **heartbeat** — `ping`/`pong` plus liveness counters, separate
so log-chunk backlog can never starve heartbeats. Channel separation is
logical (a `channel` field), not physical multiplexing — single WS
connection. Server reads heartbeats first when draining incoming
buffers.

### 4.5 Backpressure

Daemon log chunk send buffer is bounded (default 4 MiB); when over the
high-water mark, daemon coalesces (newline-joins) and drops to the
lowest-priority log level until drained — critical events (`progress`,
`dispatch.ack`, `error`) are never dropped (control channel).
Server-side, if WS write buffer to a daemon backs up past 1 MiB, the
gateway closes the connection with code 1008 and the daemon reconnects
with the resumable session id.

### 4.6 Reconnect with resumable session

Daemon stores `sessionId` returned by the gateway at connect time. On
reconnect, daemon presents `runtimeApiKey + lastSessionId +
lastSeenServerMsgId`. Gateway either: resumes the session if the
registry still owns it and TTL has not expired (default 60s) and
re-delivers any unacked control messages since `lastSeenServerMsgId`;
or opens a fresh session if the old one is gone and tells the daemon
`resumed=false` so it knows to re-handshake any in-flight job state via
HTTP.

### 4.7 Idle / dead detection

Heartbeats every 15s; server expects one within 45s. Server: missing
heartbeat for 45s → session `lost`; in-flight dispatch attempts attached
to that session move to `lost` after a 30s grace window so the daemon's
resume attempt is honored if it reconnects. Daemon: missing `pong` for
60s after a `ping` → force-reconnect.

---

## 5. Job dispatch contract

The on-wire payload reuses `WorkerJobSchema` from `packages/contracts`. No
fork.

### 5.1 Sequence

(1) Server → daemon: `control:dispatch { job, dispatchAttemptId,
workerSharedSecret, sessionToken }`. (2) Daemon → server:
`control:dispatch.ack { dispatchAttemptId, status: "accepted" |
"rejected_busy" | "rejected_capability" | "rejected_drained" }` —
server only marks the attempt `acknowledged` on `accepted`; other
statuses immediately fail the attempt and the dispatcher picks again.
(3) Daemon executes (Docker for Linux, native for Mac): workspace,
secret injection, run, log capture. (4) While running:
`log:log.chunk { workflowRunId, stage, level, lines[] }` —
fire-and-forget, persisted server-side as `workflow_log_events`;
`control:progress { workflowRunId, currentStage, message }` —
checkpoint-safe progress, durable. (5) Final report and bulky artifacts
go over **HTTPS** to the API directly, signed with `workerSharedSecret`
— not over WS. (6) Daemon → server: `control:dispatch.complete {
dispatchAttemptId, terminalStatus: "succeeded" | "failed" | "canceled",
stderrSummary }`.

### 5.2 `workerSharedSecret` binding

Minted by the dispatcher per `dispatchAttemptId`, stored in
`worker_dispatches.workerSharedSecretRef` (hashed). TTL =
`runTimeoutSeconds + 15 min` so post-run final-report uploads complete.
Bound to `(tenantId, workflowRunId, dispatchAttemptId)`; API rejects it
on any other run id or attempt id. Travels **inside the dispatch
envelope**, never in URL, never in logs; daemon holds it in process
memory only (no disk) and zeroes on dispatch completion. Stale-on-retry:
when dispatcher creates `attemptNumber+1`, the older secret is revoked
atomically with the new mint — the old worker can keep running but its
API writes are 401'd.

### 5.3 Cancel — two-phase

Reuses existing `cancel_requested` / `cancel_force` semantics from
`gateway-protocol.ts`. `cancel_requested` over WS → daemon sets a
checkpoint flag readable by the executor adapter (Docker or native);
adapter checks at safe points and exits gracefully. `cancel_force` over
WS → daemon sends `SIGTERM` to the executor subprocess, escalates to
`SIGKILL` after 10s grace (Docker: `docker kill --signal=TERM` then
`--signal=KILL`; native Mac: same lifecycle on the spawned process
group). **HTTP fallback** (authoritative until API ↔ gateway session
bridge exists): worker also polls `GET /v1/dispatch/{attemptId}/control`
returning `{ status, cancelForceRequestedAt }` — canonical cancel
transport per docs/contracts, source of truth. WS path is best-effort
fast cancel; HTTP poll is durable. When both fire, daemon honors
whichever arrives first and ignores duplicates.

---

## 6. Execution adapters

### 6.1 Docker adapter (Linux daemons, default)

One container per dispatch attempt — no reuse across runs. Image is one
of the prebuilt runtime profiles (`worker-core`, `worker-web`,
`worker-android`); daemon picks the smallest profile satisfying
`executionProfile`. Per-run ephemeral workspace mounted at `/workspace`,
host-side at `/var/lib/support-agent/workspaces/<runId>`; `tmpfs` for
`/tmp` inside the container. Resource limits per execution profile —
defaults: 4 vCPU, 8 GiB RAM, 4096 pids. Network: containers attach to a
dedicated bridge with an explicit egress allowlist (§9); no host network
mode. Lifecycle: `docker run --rm` with the run-config; daemon
supervises stdout/stderr → log chunks; on cancel, signal escalation as
above; on exit, daemon collects exit code, posts final report, then
`docker rm` (via `--rm` for normal flow). Image signing: daemon refuses
unsigned images — Cosign signature with the SupportAgent public key,
verified before container start; customer-pinned alternative keys
allowed via config.

### 6.2 Native adapter (Mac daemons)

No Docker. Jobs run as child processes of the daemon under a dedicated
unprivileged macOS user (`_supportagent`), sandboxed with `sandbox-exec`
profile allowing: project workspace dir, `xcrun`, `xcode-select`,
`xcodebuild`, simulator helpers, `gh`, network egress per allowlist.
Per-run workspace under `/Users/_supportagent/workspaces/<runId>`,
cleaned on exit. Keychain integration: daemon stores its `runtimeApiKey`
in the user keychain of a service account, not in a flat file.

### 6.3 iOS specifics

iOS toolchain detection at capability advertise time: `xcode-select -p`
must succeed; `xcrun simctl list devices` must enumerate at least one
simulator runtime if `executionProfile=ios-repro`; `xcrun --find
xcodebuild` must succeed; `xcrun altool` or `xcrun notarytool` present
for signed build profiles. App-reveal detection: `app-reveal` binary on
PATH and runnable `--version`. Simulator availability re-checked when
the daemon receives a job for `ios-repro` (cheap call, sub-100ms),
refusing the dispatch if changed since last advertise.

**Rejected alternative**: Linux-style Docker on Mac via Docker Desktop
for iOS jobs. Cannot build iOS inside Docker. Native is mandatory.

---

## 7. Capability advertisement schema

```jsonc
{
  "type": "capabilities.update",
  "payload": {
    "runtimeId": "rt_...",
    "advertisedAt": "<iso8601>",
    "advertisementId": "<uuid>",
    "os": { "kind": "linux"|"darwin"|"windows", "version": "...", "arch": "x86_64"|"arm64" },
    "hardware": {
      "cpuCores": 16, "ramBytes": 34359738368, "diskFreeBytes": 500000000000,
      "gpu": { "present": true, "vendor": "nvidia", "model": "L4", "memoryBytes": 24000000000 } | null
    },
    "toolchains": {
      "node":       { "present": true,  "version": "20.18.0" },
      "docker":     { "present": true,  "version": "27.1.1", "engine": "docker"|"podman"|"containerd" },
      "xcode":      { "present": true,  "version": "16.0", "selectedPath": "...", "iosSdks": ["18.0"] } | { "present": false },
      "androidSdk": { "present": true,  "buildToolsVersion": "34.0.0", "platforms": ["android-34"] } | { "present": false },
      "playwright": { "present": true,  "browsers": ["chromium","firefox","webkit"] },
      "appReveal":  { "present": false },
      "claude":     { "present": true,  "cliVersion": "1.0.x" },
      "codex":      { "present": true,  "cliVersion": "..." },
      "gh":         { "present": true,  "authenticated": true, "scopes": ["repo","read:org"] },
      "kelpie":     { "present": true,  "mcpEndpoint": "...", "mcpVersion": "..." } | { "present": false }
    },
    "executionProfiles": ["analysis-only","web-repro","android-repro"],
    "maxConcurrency": 2, "currentLoad": 0,
    "network": { "egressAllowlistEnforced": true, "publicIngressOpen": false },
    "modelAccess": { "mode": "proxy"|"tenant-provider", "proxyReachable": true },
    "daemonVersion": "0.4.2",
    "fingerprint": "<sha256 of nodePublicKey>"
  }
}
```

Rule: only advertise toolchains the daemon has just verified runnable
— if `docker info` failed in the last detection, `docker.present=false`
(no optimistic claims). The dispatcher's provider selection consumes
this directly; `executionProfiles` is the join key against
`execution_profiles`. Re-advertise cadence: daemon runs a periodic
detector probe every 5 min while idle, plus after install of major
tools; diff vs last advertised — if changed, send `capabilities.update`
over the live session.

> EDITORIAL: `toolchains.kelpie` is added by the merger to wire UI
> draft §11.1 (daemon reports advertised Kelpie services through its
> capability heartbeat) into the daemon's capability schema. Reviewers
> should confirm.

---

## 8. Auto-provisioning path

A separate code path from manually-paired daemons. Same daemon binary,
different lifecycle.

### 8.1 Shape

A `cloud-provisioner` service inside `apps/api` (or co-located with the
dispatcher) implements:

```ts
interface CloudProvisionerPlugin {
  key: string; // "gcp-compute", "aws-fargate", "fly-machines", ...
  canSatisfy(profile: ExecutionProfile, hints: ProviderHints): boolean;
  spawn(spec: EphemeralRuntimeSpec): Promise<EphemeralRuntimeHandle>;
  terminate(handle: EphemeralRuntimeHandle): Promise<void>;
}
```

When the dispatcher has a queued run and no idle paired daemon matches,
it asks each enabled plugin in priority order whether it can satisfy
the profile.

### 8.2 Spawn sequence

(1) Dispatcher mints a **pre-claimed pairing code** (server-side,
exception to §3 — auto-provisioned daemons skip the operator-accept
step because the server itself is the acceptor). (2) Plugin launches a
container/VM/Fargate task with env: `SUPPORT_AGENT_PAIRING_CODE`,
`SUPPORT_AGENT_API_BASE_URL`, `SUPPORT_AGENT_GATEWAY_URL`,
`SUPPORT_AGENT_EPHEMERAL=1`, `SUPPORT_AGENT_BOUND_RUN_ID=<workflowRunId>`.
(3) Daemon boots, sees `SUPPORT_AGENT_EPHEMERAL=1`, runs the pair flow
non-interactively — the pre-claimed code is auto-accepted because it
was server-minted and `pairing_session.autoProvisioned=true`. (4)
Daemon connects, advertises capabilities, is immediately dispatched the
bound run. (5) On run completion (or timeout), daemon sends
`drain.complete` and exits 0; plugin reaps the container.

### 8.3 Paired vs ephemeral distinction

Stored on the runtime registration: `runtimes.lifecycle = "paired" |
"ephemeral"`; `runtimes.boundWorkflowRunId` is set for ephemeral
(dispatcher will not assign any other run to an ephemeral runtime); TTL
— ephemeral runtimes auto-revoke their `runtimeApiKey` after the bound
run finishes or after `runTimeoutSeconds + 15 min`, whichever comes
first.

### 8.4 MVP plugins

Pick **two** for v1: `gcp-compute` (Compute Engine instance with the
daemon image, MIG-friendly); `aws-fargate` (ECS Fargate task running
the daemon image). Reject Kubernetes-operator-driven provisioning in
MVP — the whole point is "I don't want a control plane to operate."
Customers on EKS/GKE can run the daemon as a Deployment manually and
pair it.

### 8.5 Operator-facing controls

See §10.4 (`/infrastructure/auto-provisioning`) for the UI surface. Per
provider: status badge (`enabled` / `disabled` / `credentials missing`);
credentials (read-only reference to `connection_secrets`, edit link to
the secrets editor — this page never holds raw secrets); capability
profile mapping (which runtime profiles this provider satisfies, Mac
excluded); caps (max concurrent ephemeral machines default 3; per-job
hard timeout default 60 min; daily spend cap with currency picker —
informational, we don't bill, just stop spawning when hit); idle TTL
(default 5 min); spawn rules ("when step requires capability X and no
paired machine available within Y seconds, spawn ephemeral here"); audit
list of recent spawn / teardown events.

Auto-provisioning ships **disabled**. Operators opt in per provider. Mac
is conspicuously absent (Mac minis must be paired); the page links to the
pairing flow with that explanation.

---

## 9. Security model

### 9.1 TLS

TLS 1.3 minimum. SPKI pinning option per `expectedServerSpki` in daemon
config — off in SaaS, recommended in customer-private gateway.

### 9.2 `runtimeApiKey` storage

Mac: macOS Keychain in a service account namespace
(`com.supportagent.runtime.<runtimeId>`). Linux:
`/var/lib/support-agent/api-key` mode 0400, owned by `support-agent`
user (created at install); optional integration with HashiCorp Vault /
GCP Secret Manager / AWS Secrets Manager via daemon `--secret-source`
flag. Never in environment variables for long-lived daemons. Pairing
flow returns the key sealed-to-node-public-key so it is safely
transported once and persisted only by the daemon.

### 9.3 Secret injection (one-time per-job)

Rule: **the daemon must never permanently hold secrets that workflows
need.** `workerSharedSecret`: in-memory only, lifetime = dispatch
attempt. Repository credentials, model-provider credentials, connector
tokens: fetched from API at job start by the in-container worker
process using `workerSharedSecret`, stored only in the per-run container
filesystem (or per-run native workspace), shredded at job end.
Long-lived runtime credentials are only `runtimeApiKey` (registration)
and the node keypair. Nothing else.

**Rejected alternative**: pushing repo tokens into the daemon at pair
time so it can pre-stage them — makes the daemon a target; compromise
of one runtime should never leak more than its own session credentials.

### 9.4 Image signing for spawned Docker job containers

Cosign keyless or keyful signature required. Daemon refuses to `docker
run` an image whose signature doesn't verify against the configured
public key. Customer-built runtime images are signed by the customer;
customer pushes their public key into their tenant config.

### 9.5 Egress allowlist

Daemon enforces an outbound egress allowlist on job containers (Linux)
and via macOS Network Extension / `pf` rules (Mac). Default allowlist:
SupportAgent API and gateway URLs; repository hosts the run is allowed
to clone from (per `execution_profile.allowedRepoHosts`); package
registries declared in execution profile (npmjs, pypi, maven, etc.);
model provider endpoints **only** in `tenant-provider` mode (proxy mode
goes back through the gateway). Operator can override per execution
profile.

### 9.6 Audit

Every pairing, unpairing, key rotation, drain, ceremony start/result,
and auto-provisioning settings change emits an audit event via the
existing `audit.record` action contract from
`automation-composition.md`. These land in `/settings/audit-log`.

### 9.7 Permissions

Extends the existing role model (`docs/identity-providers.md` actors):
`machine:read` (view list & detail; default for all operators);
`machine:pair` (start pairing; default for `admin` and `runtime-admin`);
`machine:unpair` (destructive; admin only); `machine:rotate_key`
(admin); `machine:drain` (admin + runtime-admin); `machine:tag` (admin
+ runtime-admin); `auto_provisioning:read` (operator);
`auto_provisioning:write` (admin only — touches spend caps);
`ceremony:run` (operator, per ceremony, with risk class). Visibility
per-tenant by default; list and detail pages enforce tenant scope at
the API; multi-tenant admins (Support Agent ops) see a tenant column.

---

## 10. Admin UI surfaces

### 10.1 Information architecture

Extend the existing **Infrastructure** sidebar section
(`apps/admin/src/components/layout/Sidebar.tsx`). Final shape of
`Infrastructure`:

- **Machines** (new — daemons, ephemeral VMs, paired Mac minis)
- **Providers** (existing — execution-provider templates: `gcp-vm`,
  `aws-batch`, `mac-reverse`, `local-docker`)
- **API Keys** (existing — runtime API keys used by the CLI on
  registration)
- **Review Profiles** (existing — stays where it is)

Rejected IA alternatives: (a) a fifth top-level nav (Runtimes/Fleet) —
`admin-ui.md` already lists `/runtimes` and Infrastructure already maps
to the concept; an operator pairing a Mac mini thinks "adding machine to
infrastructure," not "configuring an app." (b) Under Configuration —
Configuration is *what the system does* (connectors, workflows,
channels); Machines are *where it runs* (matches connectors-vs-workers
split in the brief). (c) Split Mac-minis and ephemeral cloud onto
separate pages — both are Machines from the workflow author's viewpoint;
only the provisioning lifecycle differs. Filter by capability/origin is
cheaper than splitting the route.

Route map additions:

```
/infrastructure/machines
/infrastructure/machines/pair          (modal-style route, supports deep link)
/infrastructure/machines/:machineId
/infrastructure/machines/:machineId/logs
/infrastructure/machines/:machineId/jobs
/infrastructure/auto-provisioning
/infrastructure/providers              (existing /providers, renamed for IA consistency)
```

`/providers` keeps a redirect to `/infrastructure/providers` to avoid
breaking deep links. `/runtimes` from `admin-ui.md` is aliased to
`/infrastructure/machines` — the UI string is "Machines"; "Runtime" stays in
API/contract terms.

### 10.2 Machine list (`/infrastructure/machines`)

Table-first, with filter chips at the top. Same pattern as `RunsPage` and
`ProvidersPage`.

Columns: Name (link), Status (dot + label), Origin
(`paired` / `ephemeral:<provider>`), Capabilities (pills — first 3 + `+N`),
Tags, Current job (run link or `—`), Last heartbeat (relative), Owner.

Filters (top of card): capability multi-select (`xcode`, `docker`,
`android-sdk`, `playwright`, `worker-core`, `worker-web`,
`worker-android`, `worker-mac`, `worker-ci`); status (online / idle /
busy / draining / offline); origin (paired / ephemeral / all); tag
combobox (free + suggest from existing tags); tenant-scope selector
(admin only — most tenants only see their own).

Bulk actions: Drain selected, Tag selected, Unpair selected (gated,
multi-step confirm).

**Pool concept (lightweight, not its own page)**: "Pool" is a tag with a
convention prefix `pool:`. Filtering by `pool:ios` shows everything in
that pool. No CRUD — emergent from tags. Tags-as-pools avoids a
parallel grouping model; promote to first-class records when explicit
policy (capacity caps, owner) is needed (see §16).

ASCII wireframe:

```
+------------------------------------------------------------------+
|  Machines                                  [ + Pair Machine ]   |
+------------------------------------------------------------------+
|  [ Capability v ] [ Status v ] [ Origin v ] [ Tag v ]  Search…  |
+------------------------------------------------------------------+
| ● Name              Origin     Capabilities         Current Job |
|------------------------------------------------------------------|
| ●  mac-mini-studio  paired     xcode, node22  +2    run #4821   |
| ●  ci-linux-01      paired     docker, node22       —           |
| ◉  ephem-build-9f   ephemeral  worker-web           run #4822   |
| ○  android-tower-a  paired     android-sdk, jdk21   —           |
| ○  ci-linux-02      paired     docker               (offline)   |
+------------------------------------------------------------------+
|                                              Showing 5 of 5    |
+------------------------------------------------------------------+
```

Legend: ● = online, ◉ = busy, ○ = offline.

### 10.3 Machine detail (`/infrastructure/machines/:machineId`)

Two-column layout: left = facts panel, right = activity stream.

**Header band**: name (inline editable), status dot + label
(`online | idle | busy | draining | offline | unpairing`), origin badge
(`paired` | `ephemeral:gcp-vm` | `ephemeral:aws-fargate`), tags chip list
(edit in place), primary actions `Drain | Unpair | Rotate Key | Open Logs`.

**Left column — Identity & Capabilities**: identity (machine id,
hostname, OS/arch, daemon version, kernel, fingerprint of public key —
truncated, with copy); owner (who paired it, when, from which client);
capabilities advertised by daemon (§7) — toolchains (`xcode 16.4`,
`node 22`, `docker 27`, `android-sdk 35`, …), runtime profiles
(`worker-core`, `worker-web`, `worker-android`, `worker-mac`), max
concurrency advertised, network egress hints (proxy, vpn, none); scope
(tenant + optional pool tag, e.g. `pool: ios-shared`);
auto-provisioning (ephemeral only): provider, instance type,
spawned-by-rule, idle TTL remaining.

**Right column — Activity**: current job card (workflow run link, stage,
% progress, eta); recent jobs table (last 20, with status, duration,
run id link); logs (tail of daemon stdout/stderr — NOT job logs, those
live on the run detail page; same `LogViewer` as run detail); heartbeat
& metrics (rolling chart of last 10 min of heartbeats, last CPU/mem
hint if advertised, API ping rtt).

**Destructive actions**: Drain stops accepting new dispatches and
finishes the current one (UI flips to `draining`, cancel-drain available
until empty); Unpair requires typed confirmation of the machine name
(server rejects while a job is in flight unless `--force`); Rotate Key
triggers a new key on the daemon (protocol per §3.9), UI shows a progress
modal and the rotated fingerprint.

**Empty / degraded states**: `offline` shows amber band "Last heartbeat 3
min ago. Workflows targeting this machine will fail until reconnected";
`lost` shows red band with `Mark unhealthy` action.

ASCII wireframe:

```
+------------------------------------------------------------------+
| ● mac-mini-studio-a   [paired] [ tags: pool:ios, mac ]          |
|                       [ Drain ][ Unpair ][ Rotate Key ]         |
+----------------------------------+-------------------------------+
| IDENTITY                          | ACTIVITY                     |
|  id      machine_01H…            |                              |
|  host    studio-a.lan            |  Current Job                 |
|  os      macOS 15.4 arm64        |  ┌─────────────────────────┐ |
|  daemon  v0.4.1                  |  │ Run #4821 build          │ |
|  fp      a3:4f:c2:…              |  │ stage: simulator-boot    │ |
|  owner   ondrej@…                |  │ 38%   eta 4m            │ |
|                                   |  └─────────────────────────┘ |
| CAPABILITIES                      |                              |
|  xcode 16.4    ✓                 |  Recent jobs (last 20)        |
|  node 22.4     ✓                 |  #4820 build  succeeded 12m   |
|  worker-mac    ✓                 |  #4815 triage succeeded 1h    |
|  worker-core   ✓                 |  …                            |
|                                   |                              |
| AUTO-PROVISIONING                 |  Daemon logs ►               |
|  origin   paired (not ephemeral) |  Heartbeat (last 10m) ─────  |
+----------------------------------+-------------------------------+
```

### 10.4 Auto-provisioning (`/infrastructure/auto-provisioning`)

Single page, tabbed by provider. Controls per provider are detailed in
§8.5. Each ephemeral on the machine list carries its cost-so-far estimate
when the provider supports it; the list view sums them in a small stat
card.

### 10.5 Workflow Designer integration

The designer (`apps/admin/src/features/workflow-designer/*`) currently has
trigger, action, output node types. Action nodes today only carry
`executorKey` and `taskPrompt`. We add a **placement** facet to action and
review nodes.

In the right-hand inspector (`WorkflowDesignerInspector`), action nodes
gain an `Execute on` section with four modes: (1) **Any matching
machine** (default) — solver picks the best-fit online machine
satisfying declared capabilities; (2) **Specific pool** (tag-based,
e.g. `pool:ios-shared`); (3) **Specific machine** (pinned) — choose
one, UI warns this reduces resilience; (4) **Ephemeral cloud** — pick a
provider (`gcp-vm`, `aws-fargate`, `local-docker`); choosing ephemeral
greys out the manual machine pickers and shows the cost/timeout caps
that would apply.

Each action node has a `Required capabilities` multi-select using the
machine-list vocabulary. Required capabilities power: designer-time
warning ("No online machine matches `xcode + node 22`. 0 online, 2
paired but offline."); live preview panel (tiny list under the
inspector shows the first 3 machines that *currently* satisfy the step,
each a clickable chip that opens the machine detail in a side drawer).

Designer validation: on save, API runs a feasibility check — every step
has at least one candidate machine **or** is set to ephemeral; warnings
(not errors) when the only candidates are offline. Workflow run dispatch
records the chosen machine on the workflow run, so the run detail page
can show "ran on `mac-mini-studio-a`."

Rejected: single "tenant default machine pool" knob — workflows often
have heterogeneous steps (`triage` on cheap Linux, `build` on Mac,
`merge` on cheap Linux); per-step placement matches reality. We did keep
a workflow-level **fallback** default: a workflow can declare a default
pool that applies to any step not overriding it.

ASCII wireframe:

```
+----------------------------+
|  Run build action          |
+----------------------------+
|  Executor:    triage-default
|  Prompt:      [ multi-line ]
|                            |
|  Execute on                |
|  ( ) Any matching machine   |
|  (•) Pool: [ pool:ios v ]   |
|  ( ) Specific machine: …    |
|  ( ) Ephemeral: gcp-vm      |
|                            |
|  Required capabilities      |
|  [xcode][node22][+]        |
|                            |
|  Would run on (now):        |
|   • mac-mini-studio-a       |
|   • mac-mini-studio-b (busy)|
+----------------------------+
```

### 10.6 Pairing modal wireframe

```
+----------------------------------------------------+
|  Pair a new Machine                          ✕     |
+----------------------------------------------------+
|  [ macOS arm64 ] [ Linux x64 ] [ Linux arm64 ]    |
|                                                    |
|  Run this on the target host:                      |
|   ┌────────────────────────────────────────────┐   |
|   │  npx @supportagent/runtime register \       │   |
|   │    --host https://api.example.com        ⎘ │   |
|   └────────────────────────────────────────────┘   |
|                                                    |
|  Enter the code shown by the daemon:               |
|   ┌────────────────────────────────────────────┐   |
|   │  ____-____-____-______                      │   |
|   └────────────────────────────────────────────┘   |
|   ⏳ Code valid for 4:53                            |
|                                                    |
|   [ Show QR for Kelpie ]                           |
|                                                    |
|   Status: waiting…                                 |
+----------------------------------------------------+
```

### 10.7 Empty, error, and accessibility states

**Empty**: no machines paired and auto-provisioning disabled → centered
`Pair your first machine` card with two paths (paired daemon / enable
cloud), reusing `EmptyState`; no machines satisfy a designer step's
capability → tinted banner inside the inspector with `Pair a machine` and
`Enable ephemeral` CTAs.

**Error**: daemon refuses handshake → red toast with the raw daemon error
code (no silent retry), audit row; provider creds missing → yellow
callout on the auto-provisioning tab; heartbeat gap → amber row with
"last seen 3m ago" (stale rows do not vanish — they sort to the bottom
of the `online` filter).

**Accessibility**: all status dots have `aria-label` of the textual
status, color is never the only signal (shape — dot / ring /
dashed-ring — varies by state); pairing code input is a single field
with `inputMode="text"` and `aria-describedby` pointing to the TTL
countdown; modal traps focus, ESC cancels, first focusable is the OS
picker; all tables and chip filters are keyboard-navigable (covered by
existing `DataTable`); reduced motion uses `prefers-reduced-motion` for
the pulsing pairing-code box.

---

## 11. Kelpie integration

Kelpie is an LLM-first mobile browser. It advertises an MCP server over
mDNS on the local network. Inside SupportAgent we use Kelpie for any
**visual setup that must happen with a real browser on the operator's
device**: log in to GitHub on the daemon host (via a remote browser frame
or via the operator's own phone), pass an OAuth flow, complete an App
Store Connect prompt, scan a QR for pairing, etc.

### 11.1 Discovery flow

The admin app does **not** do mDNS (browsers can't). The operator's own
daemon (the runtime CLI) discovers Kelpie over mDNS on its LAN and
reports advertised services through its capability heartbeat
(`toolchains.kelpie.mcpEndpoint`, `toolchains.kelpie.mcpVersion`). For
mobile-only operators (no paired daemon yet), the admin shows an "Open
in Kelpie" button using a `kelpie://` deep link — if Kelpie is
installed the OS opens it, otherwise "Install Kelpie" doc link. We do
not try to magic-detect Kelpie from the browser.

### 11.2 UI states for Kelpie availability

- `available` — at least one paired daemon reports a Kelpie endpoint,
  OR the operator's phone OS supports `kelpie://`. UI: "Open in Kelpie"
  CTA on relevant flows.
- `unavailable_lan` — no paired daemon sees Kelpie; operator on
  desktop. UI: "Kelpie not detected on the network. Install Kelpie on
  your phone or pair a daemon that can reach it."
- `mismatch` — Kelpie MCP version too old for the requested ceremony.
  UI: "Update Kelpie to vX.Y to continue".

### 11.3 Ceremony abstraction

A ceremony is a typed, declarative, machine-readable script of MCP
calls Kelpie executes, e.g. `daemon-host-github-login`,
`verify-mac-mini-workflow`, `scan-pair-qr`.

SupportAgent admin tells the backend "start ceremony X targeting
machine Y." The backend writes a ceremony record with a signed callback
URL. Then either: the daemon on machine Y (if it sees Kelpie locally)
is told over the daemon protocol to instruct its local Kelpie MCP to
run the ceremony; OR the operator's phone is sent a
`kelpie://run-ceremony?id=…&token=…` deep link (push notification, QR,
or signed URL in the admin). Kelpie executes the MCP call sequence
(open URL, fill form, verify success criteria, capture screenshot for
audit), then hits the callback URL with the result envelope. Admin
subscribes to ceremony status via the same admin WS used for runs and
machines.

This keeps SupportAgent in charge of *what the ceremony is* while
Kelpie is in charge of *how to execute it*. Raw MCP traffic does not
stream through the admin UI.

### 11.4 Use case A — one-time browser-based auth on a daemon

Operator pairs a Linux daemon that runs GitHub-CLI flows; the daemon needs
a logged-in `gh` session. Operator opens daemon detail → `Sign in to
GitHub on this machine`. Admin starts `daemon-host-github-login` for that
machine. Daemon launches a headless browser bound to a local-only port or
opens a device-flow URL — the interactive part lives in Kelpie. Operator
completes GitHub OAuth on phone (or wherever Kelpie runs); Kelpie's
success criteria check confirms the redirect URL contains the success
token. Kelpie callback fires; admin shows `Signed in as @ondrej-rafaj` on
the machine detail page. The daemon now holds the session and writes it
to `connection_secrets`.

### 11.5 Use case B — verifying a workflow runs on a paired Mac mini

After pairing a Mac mini for iOS work, operator clicks `Verify workflow`
on the Mac mini detail. Admin starts `verify-mac-mini-workflow`, which
runs a throwaway `triage` workflow run pinned to that machine. While
executing, Kelpie may optionally open the run detail page on the
operator's phone and stream progress — useful when the operator is
physically near the Mac mini but away from their desk. Thin convenience
layer, not part of verification. Result is a green `Verified ✓` badge on
the machine, with a "View run" link.

### 11.6 Pair-via-Kelpie

Recommended best-practice flow: operator runs `npx @supportagent/runtime
register` on the new daemon; daemon shows a pairing code; operator opens
the admin pairing modal in their existing desktop session and clicks
"Pair via Kelpie" instead of typing. Admin generates the pairing QR
(same `supportagent-pair://` deep link from §3.6). Operator scans with
Kelpie on their phone; Kelpie's `pair-machine` ceremony reads the code,
calls the admin claim endpoint, waits for handshake, and shows success
on the phone. Desktop admin page (subscribed to `pairingRequestId`)
flips to `online` at the same time. Faster than copy-paste; attractive
in datacenter rack environments.

### 11.7 Open questions on Kelpie's MCP surface

- **Ceremony spec format**: structured ceremonies vs SupportAgent
  translating to a stream of `open URL`, `fill`, `assert` MCP calls each
  time. Preferred: ceremonies live in SupportAgent; Kelpie exposes
  primitive MCP surface (`browser.open`, `browser.fill`,
  `browser.assert_visible`, `browser.capture`, `callback.post`).
- **Result signing**: Kelpie must include a signed payload (signed by
  Kelpie or by the operator's identity) so the callback can't be forged
  from the LAN. Needs Kelpie team negotiation.
- **Audit screenshots**: capture + upload redacted-by-Kelpie screenshot?
  Yes for high-risk (`unpair`, `rotate_key`), no for low-risk.
- **Multi-tab orchestration**: a ceremony may need >1 tab (OAuth popup +
  parent); does Kelpie return a stable tab id across MCP calls?
- **Cancellation**: operator-initiated cancel from admin → Kelpie —
  propagation and granularity (per ceremony, per call)?

---

## 12. Realtime & observability

### 12.1 Admin-facing realtime

Uses the existing backend-to-admin WebSocket from `docs/dashboard.md`. No
second realtime transport. Machine events fan out the same way run events
do. Heartbeat indicator: green within `heartbeatWindow`, amber within
`2 × heartbeatWindow`, red past `2 ×`. Per-machine inline sparkline in
list view (last 30 heartbeats) shows flapping without opening detail.
Lost-session banner: when the admin's own WS to the API drops, a thin
top-banner replaces the per-row live dot with "(reconnecting…)" — never
show stale-but-claimed green dots. Job-in-flight indicator: a machine
running a job has an animated outer ring on its row's status dot, and
the `Current job` cell becomes a run link; `RunDetailPage` gains a
"Machine" chip in the header band linking back to machine detail.

### 12.2 Daemon-side structured logs

Daemon emits NDJSON to stdout (so `docker logs` / `journalctl -u
support-agent` Just Works) plus a rolling file under
`/var/log/support-agent/` (Linux) / `~/Library/Logs/support-agent/`
(Mac). Fields: `ts`, `level`, `event`, `runtimeId`, `sessionId`,
`dispatchAttemptId?`, `workflowRunId?`, `msg`, `error?`.

### 12.3 Local-only health endpoint

Daemon binds `127.0.0.1:7311/health` (configurable, never default-bound
to 0.0.0.0). Returns `{ status, runtimeId, sessionConnected, sessionId,
currentLoad, lastHeartbeatAt, capabilitiesAdvertisedAt, daemonVersion
}`. No auth, but localhost-only. Optional Prometheus endpoint at
`127.0.0.1:7312/metrics` with the same scope rules.

### 12.4 Uplink metrics

Daemon sends a `metrics.snapshot` control message every 60s with:
CPU/RAM usage of host, current job count, queued log chunks, last-100s
log-chunk drop count, docker / native adapter health. Persisted
server-side for the admin UI dashboard.

### 12.5 Version reporting & self-update

Daemon reports `daemonVersion` on every capability advertise. Server
returns `latestStableVersion` and `latestSupportedMinVersion` in the
session response. Daemon prints a banner if outdated. Auto-update is
**opt-in**: when enabled (`--auto-update=stable`), daemon downloads a
signed binary from the SaaS update channel and swaps it in on next idle
window (signed with the same image-signing key). Rejected: forced
auto-update — some customers run daemons in air-gapped envs; we can't
yank versions.

---

## 13. Failure modes & recovery

- **Network partition mid-job.** WS drops; daemon keeps running locally;
  logs queue in capped buffer (oldest-dropped); HTTPS final-report path
  may also fail, retried with jittered backoff up to 30 min. Recovery:
  daemon reconnects with `lastSessionId`. If resumed, re-sends queued
  progress and pending complete. If not resumed, polls
  `GET /v1/dispatch/{attemptId}` to learn whether dispatcher marked the
  run `lost` and retried elsewhere. If `lost`, daemon discards local
  results (no double-write) and zeroes secrets.
- **Daemon crash mid-job.** OS service manager restarts the daemon; on
  boot it scans `/var/lib/support-agent/in-flight/` per-attempt state.
  Docker: container is still running, daemon re-attaches via container
  id. Native: process likely died with daemon, run marked failed locally
  and reported on next connect. Recovery: idempotent re-attach via
  container id; otherwise mark attempt failed and let dispatcher `lost`
  logic + retry policy handle it.
- **Gateway crash.** All sessions drop. Daemons reconnect with backoff
  (1s, 2s, 4s, 8s, capped at 30s, jittered). Sessions resume if registry
  is durable. Recovery: Redis-backed registry, mirrored to Postgres for
  cold-start recovery. Lost in-flight runs go to dispatcher `lost` logic.
- **Dispatcher session loss to gateway.** Internal queue, not WS — handled
  by `bullmq` / Pub/Sub retry. Standard.
- **Duplicate dispatch protection.** Each `dispatchAttemptId` is unique.
  Daemon rejects a dispatch whose `dispatchAttemptId` it has already
  accepted (idempotent ACK). Server checks `attemptNumber` against
  `worker_dispatches`. `acceptedDispatchAttempt` on `workflow_runs` is
  the only one whose final report wins. Stale secrets revoked atomically
  on new attempt mint.
- **Draining machine + daemon crash.** UI must show the run as `lost`
  and the machine as `offline`, not both `draining` and `busy` (see
  §16). Dispatcher reroutes the run.

### 13.1 Lifecycle: install, drain, uninstall

**Install** — Linux: `pnpm install -g @support-agent/runtime-cli` or
`docker run ghcr.io/supportagent/runtime:<ver>`. Mac: `brew install
supportagent/tap/runtime-cli` (native), or downloadable signed pkg.
Docker not used for Mac job execution. Cloud auto-provisioned uses the
same Docker image as Linux; cloud plugin spawns and configures it.
**First run / pair** — daemon starts with no config, generates a local
node keypair in OS keychain (Mac) / `/var/lib/support-agent/node.key`
(Linux, mode 0600, root-owned), prints pairing code, dials `/v1/pair`
(see §3). **Online** — maintains one persistent WSS session, heartbeats
every 15s, sends `capabilities` on connect; re-advertises on probe diff.
**Graceful drain** — operator issues `runtime drain` over the admin UI
(or local CLI `support-agent-cli drain`); daemon flips advertised state
to `draining` (gateway stops picking it for new dispatches); in-flight
jobs complete normally; after last job exits, daemon either exits or
stays connected as `idle-drained` until operator un-drains.
**Uninstall** — `support-agent-cli unregister` calls a control-plane
revoke endpoint, wipes the local `runtimeApiKey` and node key; local
CLI also offers `--purge` to wipe `/var/lib/support-agent` and per-job
workspace caches.

---

## 14. Phased rollout

Combines both drafts' phase lists. Where the drafts allocated the same item
to different phases, the merger keeps the more conservative placement and
flags it in §16.

### 14.1 MVP (target: 4–6 weeks; first paired Mac mini in production)

**Backend / daemon / gateway**: new `packages/runtime-cli` and
`packages/reverse-connection`; pairing flow (operator-accept) for Linux
Docker daemons; capability advertise (subset: os, arch, docker, node,
ram, executionProfiles); WSS session with v1 envelope, heartbeats,
resume, dispatch, cancel (two-phase), log chunks; Docker adapter for one
profile (`worker-core`) with Cosign verify required; reuse
`workerSharedSecret` and HTTP final-report paths verbatim; no
auto-provisioning, no Mac, no tenant-provider model mode wiring (proxy
only); audit on pair/unpair.

**Admin UI**: `/infrastructure/machines` list (paired only, no
ephemeral); pair modal with code paste (no QR, no Kelpie); machine
detail with identity, capabilities, current job, recent jobs, drain,
unpair; Workflow Designer `Execute on` with two modes only (`Any
matching` and `Specific machine`); live status via existing admin
WebSocket; no auto-provisioning page.

### 14.2 v1 (target: ~6 weeks after MVP; ephemeral Docker + capability matching)

**Backend / daemon / gateway**: Mac native adapter with iOS toolchain
detection and `app-reveal`; `worker-web` and `worker-android` Docker
profiles; auto-provisioning `gcp-compute` plugin; key rotation and
revoke flow end-to-end; egress allowlist enforcement; customer-private
gateway deployment guide.

> CONFLICT: AWS Fargate timing. Daemon draft v1 only ships
> `gcp-compute`; AWS Fargate slips to v2. UI draft v1 ships both GCP VM
> and AWS Fargate providers. Recommend: bring up `gcp-compute` first,
> then `aws-fargate` as fast-follow inside v1 if capacity allows. See
> §16 Q-C.

**Admin UI**: auto-provisioning page with provider tabs; Designer
`Specific pool` and `Ephemeral cloud` modes; capability requirements +
candidate-preview in inspector; Rotate Key in UI (matches backend
rotation flow); tag bulk actions; QR pairing; stat-card summary on list
view.

### 14.3 v2 (Kelpie + advanced ops)

**Backend**: `aws-fargate` plugin (if not already in v1 per conflict
resolution); self-update channel; GPU capability declaration & dispatch
(declared in MVP but not dispatched until v2 unless overridden — see
§16 Q10); optional Vault / Secret Manager integration for daemon key
storage; image signing key delegation (customer-built images, customer
key); approval-gated runtime rotation for high-security tenants.

**Admin UI**: Kelpie ceremony abstraction and the GitHub-login /
verify-workflow / pair-via-Kelpie ceremonies; daemon-reported Kelpie
discovery via heartbeat; pool promotion to first-class records (only if
needed by a real policy); cost summary across providers; ceremony audit
screenshots; multi-tenant view for Support Agent ops.

---

## 15. Reuse map

### 15.1 Packages to add (new)

- `packages/runtime-cli` — installable daemon. Imports
  `@support-agent/contracts`, `@support-agent/config`. Provides
  `support-agent-runtime` and `support-agent-cli` binaries.
- `packages/reverse-connection` — extracted WS protocol layer used by
  both `apps/gateway` and `packages/runtime-cli`. Move
  `gateway-protocol.ts` envelope helpers here and add session-resume
  logic. Reuses, not forks.

### 15.2 Existing packages to extend

- `packages/contracts/src/gateway-protocol.ts` — extend with the v1
  envelope (`v`, `id`, `channel`, `ts`), session-resume messages,
  `capabilities.update`, `key.rotated`, `drain`, `metrics.snapshot`.
  Keep current message types as v0 dialect for backward compat during
  rollout.
- `packages/contracts/src/worker-job.ts` — no schema change required.
- `packages/contracts` — gains `Machine`, `MachineCapability`,
  `MachineOrigin`, `PairingRequest`, `Ceremony`, `AutoProvisioningRule`
  (mirror daemon protocol; UI only consumes read DTOs).
- `apps/gateway/src/ws/connection-manager.ts` — refactor to consume
  `packages/reverse-connection`; add session registry, resume, channel
  separation, capability persistence into `execution_provider_hosts`;
  replace ad-hoc heartbeat with envelope heartbeats.
- `apps/gateway/src/app.ts` — add `/v1/pair` and `/v1/session` routes;
  keep `/health`.
- `apps/worker/src/transport/ws-transport.ts` — superseded by
  `packages/runtime-cli`; `apps/worker` becomes a thin shell that uses
  `runtime-cli` internals in dev mode so we don't have two parallel WS
  clients.
- `apps/api` — add `pairing_session` table + endpoints
  (`POST /v1/admin/pairings/{id}/accept`, `GET /v1/admin/pairings`),
  `cloud_provisioner` module, runtime audit endpoints.
- `apps/worker` — keep as the in-container job executor invoked by the
  Docker adapter (per-run process, not the daemon); rename conceptually
  to "job runner" in docs.

### 15.3 Existing admin pages extended

- `Sidebar.tsx` — add `Machines` and `Auto-provisioning` rows to
  Infrastructure.
- `/runtimes/*` (admin-ui.md route map, not yet built) — replaced by
  `/infrastructure/machines/*`; keep `runtimeId` in API contracts.
- `ProvidersPage` and detail — kept; auto-provisioning page links here
  for capability/profile editing.
- `RunDetailPage` — add `Machine` chip in header linking to machine
  detail.
- `WorkflowDesignerInspector` — extended with `Execute on` block and
  `Required capabilities` selector.
- `/settings/api-keys` — gains `runtime` keys section (already present
  via `providersApi.listApiKeys`; no change).

### 15.4 Reused components from `apps/admin/src/components/ui/*`

`DataTable` (machine list), `Card` + `CardHeader` (grouped sections on
detail), `PageShell` (every new route), `Badge`/`TypePill` (status,
origin, capabilities), `SearchableMultiSelect` (capability filter, tag
picker), `SearchableSelect` (provider picker, machine picker in
inspector), `EmptyState` (empty machine list / no-candidate steps),
`Pagination` (list), `StatCard` (daily-spend / online-count summary on
`/infrastructure/machines`).

### 15.5 New components (necessary; minimal additions)

- `MachineStatusDot` — standardized shape+color+label.
- `CapabilityChip` — pill with toolchain icon, used in list and detail.
- `PairingCodeInput` — segmented input with TTL countdown.
- `CeremonyProgress` — generic ceremony-status renderer reused by Kelpie.
- `MachinePicker` — combobox used in workflow designer inspector.

### 15.6 API surface (UI side)

`GET /v1/machines`, `GET /v1/machines/:id`; `POST /v1/machines/pair`,
`POST /v1/machines/claim`; `POST /v1/machines/:id/drain`, `/unpair`,
`/rotate-key`, `/tags`; `GET /v1/auto-provisioning`, `PUT
/v1/auto-provisioning/:provider`; `POST /v1/ceremonies`, `GET
/v1/ceremonies/:id`. WebSocket fan-out events: `machine.upserted`,
`machine.deleted`, `pairing.updated`, `ceremony.updated`.

### 15.7 What does **not** move

`packages/skills-runtime`, `packages/executors-runtime`,
`packages/skills-executor-runtime`, executor and skill content delivery
via authenticated by-hash API endpoints — unchanged. HTTP final-report
and artifact paths — unchanged. HTTP polling cancel fallback in
`apps/worker/src/lib/dispatch-control.ts` — unchanged (new WS cancel is
supplementary, not replacement).

---

## 16. Conflicts & open questions for review

> CONFLICTS surfaced by the merger (must be resolved before build):

- **Q-A. Pairing code format & TTL.** Daemon draft: 128-bit base32-Crockford
  `XXXXXX-XXXXXX-XXXXXX-XXXXXX`, TTL 10 min. UI draft: wordlist+checksum
  `BERLIN-OAK-9421-VIOLET`, TTL 5 min default. Merger recommendation:
  daemon format wins (entropy + simpler validation regex); pick a single
  TTL value and align UI countdown.
- **Q-B. Pairing endpoint naming.** Daemon: `/v1/admin/pairings/{id}/accept`,
  `GET /v1/admin/pairings`. UI: `POST /v1/machines/pair`,
  `POST /v1/machines/claim`. Merger recommendation: keep
  `/v1/admin/pairings/*` for the audit-bound accept action; add
  `POST /v1/machines/claim` as the operator-facing code-paste call that
  the API resolves into the matching `pairing_session`.
- **Q-C. AWS Fargate phase.** Daemon v1 = `gcp-compute` only;
  `aws-fargate` to v2. UI v1 = both providers. Recommendation: v1 ships
  GCP first, AWS Fargate fast-follow inside v1 if capacity allows;
  otherwise slips to v2.

> Open questions inherited from the daemon draft:

1. Single daemon binary vs split worker/gateway-pool. Rec: single
   binary, mode selected by config.
2. Session registry backing store: Redis vs Postgres-only. Rec: Redis
   with Postgres mirror.
3. macOS daemon distribution: Homebrew tap vs signed pkg vs both. Rec:
   both, Homebrew primary.
4. Cosign vs Docker Content Trust for image signing. Rec: Cosign.
5. Embedded gateway in daemon for local dev. Rec: yes, gated behind
   `--standalone-dev`.
6. Auto-update channel: stable / beta / pinned. Confirm we want three.
7. Allow pairing without operator confirmation from a known internal IP
   range (auto-provisioner shortcut)? Rec: only the server-minted code
   path skips operator confirmation; raw IP-based shortcuts rejected.
8. `workerSharedSecret` delivery — currently inside the WS dispatch
   envelope. Alternative: short HTTPS handshake after `dispatch.ack`.
   Rec: keep inside the WS envelope (TLS-protected, not logged).
9. Per-run network namespace on Linux: `docker run
   --network=<per-run-net>` vs accept the bridge default. Rec:
   dedicated bridge per profile, not per run.
10. GPU jobs — out of scope for MVP? Rec: declare capability but don't
    dispatch GPU-required jobs until v1 or v2 (see phasing).

> Open questions inherited from the UI draft:

11. Pool model: tags-as-pools (rec) vs first-class pool records;
    promote on first cap-policy use case.
12. One pairing code, many machines (batch pairing for fleet rollouts)?
    Default no — single-use only; revisit if enterprise asks.
13. Mobile operator pairing on mobile: full modal vs only QR path.
    Default QR path; full mobile authoring is out of scope.
14. Cost data: ephemeral providers always return per-job cost estimate?
    AWS Fargate yes, GCP needs pricing config. Open with protocol pass.
15. Auto-provisioning rule shape: structured fields now vs a DSL. Rec:
    structured fields.
16. Kelpie deep-link scheme: `kelpie://` vs universal links. Needs
    Kelpie team confirmation.
17. Ceremony catalog in `packages/contracts` so MCP can also start
    ceremonies? Rec: yes.
18. "Labels" vs "tags": pick one term. Rec: `tags` (Workflow Designer
    already uses it).
19. Worker concurrency advertised by daemon vs imposed by SupportAgent.
    Rec: both, with `min(daemon-cap, server-cap)`.
20. Review-loop steps placed independently of parent triage step? Rec:
    yes — a build step on Mac can have a review-loop pass on Linux.
21. In-flight jobs on a draining machine when the daemon crashes — UI
    shows run as `lost` and machine as `offline`, not both `draining`
    and `busy`. Confirm.
22. GDPR / audit for Kelpie screenshots: redact PII before upload? Yes.
    Implementation owned by Kelpie.
23. Kelpie MCP surface questions (ceremony spec format, result signing,
    audit screenshots, multi-tab orchestration, cancellation) — see §11.7.

---

## Appendix A — Why these stances

- **One binary, two modes** — two binaries doubles release + signing +
  update cost for marginal benefit.
- **Server-issued sealed key, not JWT** — daemons live on hardware we
  don't control; they need an offline-capable credential.
- **HTTP for bulky uploads stays** — WS is not the right transport for
  finals.
- **Operator-accept pairing** — mis-paired daemon (wrong tenant,
  exfiltrating source) cost is too high to skip the human step;
  auto-provisioned is the only exception (server mints the pre-accepted
  code).
- **No Kubernetes operator in MVP** — goal is "install daemon on any
  computer"; Kubernetes is niche.
- **Tags-as-pools** — avoids parallel grouping until a real policy
  forces promotion.
- **Per-step placement** — heterogeneous workflows (triage on cheap
  Linux, build on Mac, merge on cheap Linux) make a single
  tenant-default pool the wrong abstraction.

*End of merged plan.*
