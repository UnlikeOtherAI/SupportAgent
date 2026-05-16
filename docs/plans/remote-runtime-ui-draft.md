# Remote Runtime UI & Kelpie Integration — Design Draft

> Companion draft. The daemon/gateway protocol, transport, and security model
> are owned by a sibling design pass. This document only covers operator UX,
> admin-app surfaces, and Kelpie integration. Where a behaviour depends on the
> protocol, it is marked as an **open question for protocol design**.

Terminology follows `docs/terminology.md`: a `worker` executes a job, a
`gateway` dispatches jobs to one or more workers, an `execution provider`
describes where a worker runs. In this doc we call the unit the operator
manages a **Machine** (a registered daemon — paired Mac mini, paired Linux box,
or an ephemeral cloud VM). A Machine may carry zero or more workers and may or
may not host a local gateway.

---

## 1. Goals & non-goals

### Goals
- A single, glanceable place where the operator sees every Machine the tenant
  is using (paired daemons and auto-provisioned ephemeral ones).
- Friction-free pairing of a new daemon: paste-code in < 60 s, no terminal
  copy-paste of API keys.
- The Workflow Designer can target a specific Machine, pool, capability, or
  ephemeral provider per step.
- Health, capability and "current job" visibility must be live, not a refresh
  page.
- Auto-provisioning of ephemeral Docker workers on GCP/AWS is opt-in,
  capped, and visible.
- Kelpie ("LLM-first mobile browser") can be invoked from the admin UI to
  drive any visual setup that must happen *on the daemon host* (GitHub OAuth,
  Xcode login, App Store Connect, etc.), then hand control back.

### Non-goals (this pass)
- Pairing transport, signing, key rotation cryptography → protocol pass.
- Secret storage internals (we only reference `connection_secrets`).
- Cross-tenant marketplace of shared machines.
- Bring-your-own Kubernetes operator — only Docker-on-VM ephemeral now.
- A full mobile admin app — pairing flow assists mobile via QR but the
  authoring app stays desktop-CSR.
- Renaming `/runtimes`. The existing route stays; this draft extends it
  rather than introducing a parallel concept.

---

## 2. Information architecture

### Decision: extend the existing **Infrastructure** sidebar section.

Today's sidebar (`apps/admin/src/components/layout/Sidebar.tsx`) already has:

- Overview: Dashboard, Jobs
- Configuration: Apps, Skills, Executors, Workflows, Channels
- **Infrastructure: Providers, API Keys, Review Profiles**
- System: Settings

`Providers` is currently *Execution Providers* — the where-it-runs model in
`docs/worker-deployment.md`. That same section is the right home for Machines.

Proposed final shape of `Infrastructure`:

- **Machines** (new — daemons, ephemeral VMs, paired Mac minis)
- **Providers** (existing — execution-provider templates, e.g. `gcp-vm`,
  `aws-batch`, `mac-reverse`, `local-docker`)
- **API Keys** (existing — runtime API keys used by the CLI on registration)
- **Review Profiles** (existing — stays where it is)

Why not a new top-level nav entry like "Runtimes" or "Fleet"?

- `admin-ui.md` already lists `/runtimes` in the route map and the Sidebar
  section header `Infrastructure` already maps to this concept. Adding a
  fifth nav block fragments the IA. Workers/gateways are infrastructure —
  they belong with Providers and API Keys.
- An operator pairing a Mac mini already has the mental model "I'm adding a
  machine to my infrastructure," not "I'm configuring an app." Keeping it
  beside Providers reuses that mental model.

Why not under Configuration?

- Configuration is configuration of *what the system does* (connectors,
  workflows, channels). Machines are *where it runs.* Keeping these apart
  matches the existing brief's split between connectors (configuration) and
  workers (infrastructure).

Why not split Mac-minis and ephemeral cloud onto separate pages?

- Both are Machines from the workflow author's viewpoint; only the
  provisioning lifecycle differs. Filtering by capability/origin is cheaper
  than splitting the route. See list view, section 5.

### Route map additions

```
/infrastructure/machines
/infrastructure/machines/pair          (modal-style route, supports deep link)
/infrastructure/machines/:machineId
/infrastructure/machines/:machineId/logs
/infrastructure/machines/:machineId/jobs
/infrastructure/auto-provisioning
/infrastructure/providers              (existing /providers, renamed for IA consistency)
```

`/providers` keeps a redirect to `/infrastructure/providers` to avoid breaking
deep links.

`/runtimes` from `admin-ui.md` is aliased to `/infrastructure/machines` — the
brief uses both terms; consolidate on "Machines" in the UI string and keep
"Runtime" in API/contract terms.

---

## 3. Pairing flow UX

### 3.1 Operator script (target)

1. Operator clicks `+ Pair Machine` on `/infrastructure/machines`.
2. Modal opens. Operator picks an OS / arch (macOS arm64, Linux x64,
   Linux arm64). UI shows the exact `docker run …` or
   `npx @supportagent/runtime register` one-liner. There is a copy button and
   an OS picker tab strip.
3. Operator runs the command on the target host. The daemon prints a
   six-segment human-readable pairing code, e.g. `BERLIN-OAK-9421-VIOLET`
   (Wordlist + checksum; 12 chars of entropy is enough because the code is
   one-time and TTL-bounded — see open questions).
4. In the admin modal, an input appears below the install snippet with a
   live regex-validated field and a TTL countdown (5 min default).
5. Operator pastes the code. UI calls `POST /v1/machines/claim {code}`. From
   that point, the admin polls (or subscribes via the existing admin
   WebSocket) until status transitions to `online`.
6. Once `online`, the modal collapses into a success card with: machine
   name (editable), default tags, default capability summary, and two CTAs:
   `Open machine` and `Configure auto-provisioning`.

### 3.2 Status states (UI states, not protocol states)

| UI label          | Operator meaning                                   | Visual                              |
| ----------------- | -------------------------------------------------- | ----------------------------------- |
| `waiting`         | Code generated, no daemon has claimed it yet       | Subtle pulse on code box            |
| `claimed`         | Daemon presented the code; awaiting handshake      | Spinner with "verifying…" hint      |
| `handshake`       | Capabilities/identity being negotiated             | Progress bar with capability bullets streaming in |
| `online`          | Daemon authenticated and heartbeating              | Green dot + slide to success state  |
| `code_expired`    | TTL hit before claim                               | Amber banner + `Regenerate` button  |
| `code_reused`     | Same code presented twice                          | Red banner + `Regenerate` button (security copy: "codes are single-use") |
| `network_lost`    | Browser lost ws connection mid-handshake           | Toast + manual `Resume` button that re-polls by request id |
| `verification_failed` | Daemon cert/identity mismatch                  | Red banner with "Contact support / regenerate" — never just retry silently |

The flow uses ONE request-correlated `pairingRequestId` so all states above
can be resumed even after a browser refresh. The protocol pass needs to
expose that id.

### 3.3 QR fallback (mobile-paired Mac minis)

Mac minis often live in a closet without a keyboard. The pairing modal
includes a `Show QR` toggle that renders the same code as a QR encoding
`supportagent-pair://CODE?req=<pairingRequestId>&host=<api-base>`.

The operator scans the QR with Kelpie on their phone (see section 9). Kelpie
opens its own tab navigated to a tiny `/pair-helper` page in the admin app
(JWT scoped to read-only pair status) that streams the pairing progress so
the operator can confirm success on the same phone they used to scan.

The actual code entry can also happen on the daemon side — the operator can
SSH and paste the code into the daemon's TTY prompt; the daemon then claims
the slot. We support both directions because some operators prefer one over
the other.

### 3.4 Inline help

- Each OS tab links to a short doc snippet describing prerequisites (Docker
  Desktop, Xcode CLT for `mac-repro`, etc.).
- A "Why a code, not an API key?" inline help explains that the runtime API
  key for the *machine* is provisioned silently on first handshake — the
  operator never copy-pastes long secrets.
- A link `Already have a daemon running? Use code` switches the modal to
  pure code-paste mode without the install snippet.

### 3.5 Failure recovery rules

- Codes are single-use *and* tied to a pairingRequestId. Reuse must fail
  loudly with audit log entry.
- A code that expires is **not** auto-regenerated; the operator must click
  Regenerate. Auto-regen creates a UX trap where stale daemons claim
  surprise slots.
- Network failure during handshake: the daemon's claim has already been
  accepted server-side; the UI just re-subscribes to status by
  `pairingRequestId`. No second claim is needed.

---

## 4. Machine detail page (`/infrastructure/machines/:machineId`)

Two-column layout: left = facts panel, right = activity stream.

### Header band
- Name (inline editable)
- Status dot + label (`online`, `idle`, `busy`, `draining`, `offline`,
  `unpairing`)
- Origin badge: `paired` | `ephemeral:gcp-vm` | `ephemeral:aws-fargate`
- Tags (chip list, edit in place)
- Primary actions: `Drain`, `Unpair`, `Rotate Key`, `Open Logs`

### Left column — Identity & Capabilities

- **Identity**: machine id, hostname, OS/arch, daemon version, kernel,
  fingerprint of public key (truncated, with copy).
- **Owner**: who paired it (user id + email), when, from which client.
- **Capabilities** (advertised by daemon, see protocol doc):
  - toolchains: `xcode 16.4`, `node 22`, `docker 27`, `android-sdk 35`, …
  - runtime profiles satisfied: `worker-core`, `worker-web`,
    `worker-android`, `worker-mac` (see `worker-deployment.md`).
  - max concurrency advertised.
  - network egress hints (proxy, vpn, none).
- **Scope**: tenant + optional pool tag (e.g. `pool: ios-shared`).
- **Auto-provisioning** (only for ephemeral): provider, instance type,
  spawned-by-rule, idle TTL remaining.

### Right column — Activity

- **Current job** card (workflow run link, stage, % progress, eta).
- **Recent jobs** table (last 20, with status, duration, run id link).
- **Logs**: tail of daemon stdout/stderr (NOT job logs — those live on the
  run detail page). Same `LogViewer` component used by run detail.
- **Heartbeat & metrics**: rolling chart of last 10 min of heartbeats, last
  CPU/mem hint (if daemon advertises), API ping rtt.

### Destructive actions

- **Drain**: stops accepting new dispatches; finishes the current one. UI
  badge changes to `draining`. Cancel-drain available until empty.
- **Unpair**: requires a typed confirmation of the machine name. Server
  rejects unpair while a job is in flight unless `--force`.
- **Rotate Key**: triggers a new key on the daemon (protocol detail).
  In the UI this shows a progress modal and the rotated fingerprint.

### Empty / degraded states
- `offline`: amber band across the header explaining "Last heartbeat 3 min
  ago. Workflows targeting this machine will fail until reconnected."
- `lost`: red band, `Mark unhealthy` action.

---

## 5. Machine list view (`/infrastructure/machines`)

Table-first, with filter chips at the top. Same pattern as `RunsPage` and
`ProvidersPage`.

### Columns
- Name (link)
- Status (dot + label)
- Origin (`paired` / `ephemeral:<provider>`)
- Capabilities (capability pills — first 3 + `+N`)
- Tags
- Current job (run number link or `—`)
- Last heartbeat (relative)
- Owner

### Filters (top of card)
- Capability multi-select: `xcode`, `docker`, `android-sdk`, `playwright`,
  `worker-core`, `worker-web`, `worker-android`, `worker-mac`, `worker-ci`.
- Status: online / idle / busy / draining / offline.
- Origin: paired / ephemeral / all.
- Tag combobox (free + suggest from existing tags).
- Tenant-scope selector (admin only — most tenants only see their own).

### Bulk actions
- Drain selected
- Tag selected
- Unpair selected (gated, multi-step confirm)

### Pool concept (lightweight, not its own page)
"Pool" is a tag with a convention prefix `pool:`. Filtering by `pool:ios`
shows everything in that pool. No CRUD for pools — they're emergent from
tags. We chose tags-as-pools to avoid building a parallel grouping model;
if pools later need explicit policy (capacity caps, owner), promote them to
a first-class record at that point. See section 13 (open questions).

---

## 6. Workflow Designer integration

The designer (`apps/admin/src/features/workflow-designer/*`) currently has
trigger, action, output node types. Action nodes today only carry
`executorKey` and `taskPrompt`. We add a **placement** facet to action and
review nodes.

### Per-step "execute on" picker

In the right-hand inspector (`WorkflowDesignerInspector`), action nodes gain
an `Execute on` section with four modes:

1. **Any matching machine** (default) — solver picks the best-fit online
   machine satisfying declared capabilities.
2. **Specific pool** (tag-based) — e.g. `pool:ios-shared`.
3. **Specific machine** (pinned) — choose one machine. UI warns this reduces
   resilience.
4. **Ephemeral cloud** — pick a provider (`gcp-vm`, `aws-fargate`,
   `local-docker`) from the auto-provisioning page. Choosing ephemeral
   greys out the manual machine pickers and shows the cost/timeout caps that
   would apply.

### Capability requirements on the step

Each action node has a `Required capabilities` multi-select using the same
capability vocabulary as the machine list. Required capabilities power:

- Designer-time warning: "No online machine matches `xcode + node 22`. 0
  machines online, 2 paired but offline."
- Live preview panel: a tiny list under the inspector shows the first 3
  machines that *currently* satisfy the step, each as a clickable chip that
  opens the machine detail in a side drawer.

### Designer validation

- On save, the API runs a feasibility check: "every step has at least one
  candidate machine *or* is set to ephemeral." Warnings (not errors) when
  the only candidates are offline.
- Workflow run dispatch records the chosen machine on the workflow run, so
  the run detail page can show "ran on `mac-mini-studio-a`."

### Why this design vs. global pool defaults

We rejected a single "tenant default machine pool" knob because the same
workflow often has heterogeneous steps (`triage` on cheap Linux, `build`
on Mac, `merge` on cheap Linux). Per-step placement matches reality.

We did keep a workflow-level *fallback* default: a workflow can declare a
default pool that applies to any step not overriding it. This avoids
re-picking on every action.

---

## 7. Auto-provisioning settings (`/infrastructure/auto-provisioning`)

A single page, tabbed by provider.

### Per-provider section
- Status badge (`enabled` / `disabled` / `credentials missing`).
- Credentials: read-only reference to `connection_secrets` entry. Edit link
  goes to the secrets editor; this page never holds raw secrets.
- Capability profile mapping: which runtime profiles this provider can
  satisfy (`worker-core`, `worker-web`, `worker-android`). Mac is excluded.
- **Caps**:
  - Max concurrent ephemeral machines (default 3)
  - Per-job hard timeout (default 60 min)
  - Daily spend cap with currency picker (informational; we don't bill —
    just stop spawning when hit)
- **Idle TTL**: how long an ephemeral stays alive after its last job
  completes before teardown (default 5 min).
- **Spawn rules**: a small list of "When [step requires capability X] and
  [no paired machine available within Y seconds], spawn ephemeral here."
- **Audit**: recent spawn / teardown events.

### Defaults
- Auto-provisioning ships **disabled**. Operators must opt in per provider.
- "Mac" is conspicuously absent — Mac minis must be paired. The page shows
  an inline explanation linking to the pairing flow.

### Cost guard UX
- Each ephemeral on the machine list carries its cost-so-far estimate (when
  the provider supports it). The list view sums them in a small stat card.

---

## 8. Live status surfaces

### Heartbeat indicator
- Status dot semantic: green = heartbeat within `heartbeatWindow`, amber =
  late but within `2 × heartbeatWindow`, red = past `2 ×`.
- A small per-machine inline sparkline in the list view (last 30 heartbeats)
  gives operators a sense of flapping without opening the detail page.

### Lost-session banner
- When the admin's own WS to the API drops, a thin top-banner replaces the
  per-row live dot with "(reconnecting…)". We never show stale-but-claimed
  green dots.

### Job-in-flight indicator
- A machine running a job has an animated outer ring on its row's status
  dot, and the `Current job` cell becomes a run link.
- The workflow run detail page (`RunDetailPage`) gains a "Machine" chip in
  the header band that links back to the machine detail.

### Realtime transport
- Uses the existing backend-to-admin WebSocket from `docs/dashboard.md`. No
  second realtime transport. Machine events fan out the same way run events
  do.

---

## 9. Kelpie integration

Kelpie is an LLM-first mobile browser. It advertises an MCP server over
mDNS on the local network. Inside SupportAgent we use Kelpie for any
**visual setup that must happen with a real browser on the operator's
device**: log in to GitHub on the daemon host (via a remote browser frame
or via the operator's own phone), pass an OAuth flow, complete an App Store
Connect prompt, scan a QR for pairing, etc.

### 9.1 Discovery flow

- The admin app does not directly do mDNS — browsers can't. Instead, the
  **operator's own daemon** (the runtime CLI) discovers Kelpie over mDNS
  on its LAN and reports advertised services through its capability
  heartbeat (`kelpie.mcp.endpoint`, `kelpie.mcp.version`).
- For mobile-only operators (no paired daemon yet), the admin shows a small
  "Open in Kelpie" button that uses a `kelpie://` deep link. If the user
  has Kelpie installed, the OS opens it. Otherwise we show "Install
  Kelpie" doc link. We do not try to magic-detect Kelpie from the browser.

### 9.2 UI states for Kelpie availability

| State | Trigger | UI |
| ----- | ------- | -- |
| `available` | At least one paired daemon reports a Kelpie endpoint, OR the operator's phone OS supports `kelpie://` | "Open in Kelpie" CTA on relevant flows |
| `unavailable_lan` | No paired daemon sees Kelpie; operator is on desktop | "Kelpie not detected on the network. Install Kelpie on your phone or pair a daemon that can reach it." |
| `mismatch` | Kelpie MCP version too old for the requested ceremony | "Update Kelpie to vX.Y to continue" |

### 9.3 Orchestration pattern

We use a small **ceremony** abstraction. A ceremony is a typed,
declarative, machine-readable script of MCP calls that Kelpie will execute,
e.g. `daemon-host-github-login`, `verify-mac-mini-workflow`,
`scan-pair-qr`.

SupportAgent admin tells the backend "start ceremony X targeting machine
Y." The backend writes a ceremony record with a callback URL signed for
that ceremony. Then either:

- the daemon on machine Y (if it sees Kelpie locally) is told over the
  daemon protocol to instruct its local Kelpie MCP to run the ceremony, OR
- the operator's phone is sent a `kelpie://run-ceremony?id=…&token=…`
  deep link (push notification, QR, or signed URL in the admin).

Kelpie executes the ceremony's MCP call sequence (open URL, fill form,
verify success criteria, capture screenshot for audit), then hits the
callback URL with the result envelope. The admin subscribes to ceremony
status via the same admin WS used for runs and machines.

This keeps SupportAgent in charge of *what the ceremony is* while Kelpie is
in charge of *how to execute it*. We do not stream raw MCP traffic through
the admin UI.

### 9.4 Use case A — one-time browser-based auth on a daemon

Operator pairs a Linux daemon that will run GitHub-CLI flows. The daemon
needs a logged-in `gh` session.

1. Operator opens daemon detail, clicks `Sign in to GitHub on this machine`.
2. Admin starts the `daemon-host-github-login` ceremony for that machine.
3. The daemon launches a headless browser bound to a local-only port, OR
   opens a device-flow URL — either way the *interactive* part lives in
   Kelpie.
4. Kelpie tab opens. Operator completes GitHub OAuth on their phone or
   wherever Kelpie is running. Kelpie's success criteria check confirms the
   redirect URL contains the success token.
5. Kelpie callback fires. Admin shows `Signed in as @ondrej-rafaj` on the
   machine detail page. The daemon now holds the session and writes it to
   `connection_secrets`.

### 9.5 Use case B — verifying a workflow runs on a paired Mac mini

After pairing a Mac mini for iOS work, the operator wants to confirm the
end-to-end pipeline (build + simulator boot + screenshot) works.

1. Operator clicks `Verify workflow` on the Mac mini machine detail.
2. Admin starts `verify-mac-mini-workflow` ceremony, which actually runs a
   throwaway `triage` workflow run pinned to that machine.
3. While the run executes, Kelpie can be optionally invoked to open the
   admin's run detail page on the operator's phone and stream progress —
   useful when the operator is physically near the Mac mini but away from
   their desk. This is a thin convenience layer, not part of the actual
   verification.
4. Result is a green `Verified ✓` badge on the machine, with a "View run"
   link.

### 9.6 Pairing-end-to-end with Kelpie

Recommended best-practice flow:

1. Operator runs `npx @supportagent/runtime register` on the new daemon.
2. Daemon shows a pairing code; operator opens the admin pairing modal in
   their existing desktop session.
3. Instead of typing the code, operator clicks "Pair via Kelpie."
4. Admin generates the pairing QR (same `supportagent-pair://` deep link
   format from section 3.3).
5. Operator scans with Kelpie on their phone. Kelpie's `pair-machine`
   ceremony reads the code, calls the admin claim endpoint, waits for
   handshake, and shows success on the phone.
6. Desktop admin page (which is subscribed to `pairingRequestId`) flips to
   `online` at the same time.

This is faster than copy-paste and avoids the operator having to type a
long code, especially attractive in datacenter rack environments.

### 9.7 Open questions on Kelpie's MCP surface

- **Ceremony spec format** — does Kelpie accept structured ceremonies, or
  does SupportAgent need to translate them into a stream of `open URL`,
  `fill`, `assert` MCP calls each time? Preferred: ceremonies live in
  SupportAgent and Kelpie exposes a small primitive MCP surface
  (`browser.open`, `browser.fill`, `browser.assert_visible`,
  `browser.capture`, `callback.post`).
- **Result signing** — Kelpie must include a signed payload (signed by
  Kelpie or by the operator's identity) so the callback can't be forged
  from the LAN. Needs negotiation with Kelpie team.
- **Audit screenshots** — should ceremonies capture and upload a
  redacted-by-Kelpie screenshot for audit? Preferred yes for high-risk
  ceremonies (`unpair`, `rotate_key`), no for low-risk.
- **Multi-tab orchestration** — a ceremony may need >1 tab (OAuth popup +
  parent). Does Kelpie return a stable tab id we can refer to across MCP
  calls?
- **Cancellation** — operator-initiated cancel from admin → Kelpie. How is
  it propagated and at what granularity (per ceremony, per call)?

---

## 10. Permissions

We extend the existing role model (`docs/identity-providers.md` actors).
Capabilities we need:

- `machine:read` — view list & detail. Default for all operators.
- `machine:pair` — start the pairing flow. Default for `admin` and
  `runtime-admin` roles.
- `machine:unpair` — destructive. Admin only.
- `machine:rotate_key` — admin only.
- `machine:drain` — admin + runtime-admin.
- `machine:tag` — admin + runtime-admin.
- `auto_provisioning:read` — operator.
- `auto_provisioning:write` — admin only (since this touches spend caps).
- `ceremony:run` — operator (per ceremony, with risk class).

### Audit
Every pairing, unpairing, rotation, drain, ceremony start/result, and
auto-provisioning settings change emits an audit event using the existing
`audit.record` action contract from `automation-composition.md`. These
land in `/settings/audit-log`.

### Visibility
Per-tenant by default. The list and detail pages enforce tenant scope at
the API. Multi-tenant admins (Support Agent ops) see a tenant column.

---

## 11. Empty, error, accessibility

### Empty states
- No machines paired and auto-provisioning disabled: a centered card
  prompting `Pair your first machine` with the two paths (paired daemon /
  enable cloud). Same `EmptyState` component already in use.
- No machines satisfy a designer step's capability requirement: a tinted
  banner inside the inspector with two CTAs: `Pair a machine` and `Enable
  ephemeral`.

### Error states
- Daemon refuses handshake: red toast with the raw daemon error code (no
  silent retry). Audit row.
- Provider creds missing: yellow callout on the auto-provisioning tab.
- Heartbeat gap: amber row with "last seen 3m ago." Stale rows do not
  vanish — they sort to the bottom of `online` filter.

### Accessibility
- All status dots have an `aria-label` of the textual status. Color is
  never the only signal: shape (dot / ring / dashed-ring) varies by state.
- Pairing code input is a single field with `inputMode="text"` and an
  `aria-describedby` pointing to the TTL countdown.
- Modal traps focus; ESC cancels; first focusable is the OS picker.
- All tables and chip filters keyboard-navigable; same `DataTable`
  component used elsewhere already covers this.
- Reduced motion: pulsing pairing-code box uses `prefers-reduced-motion`.

---

## 12. Wireframe sketches (ASCII)

### 12.1 Machine list

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

### 12.2 Pairing modal

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

### 12.3 Machine detail

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

### 12.4 Designer inspector — execute-on

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

---

## 13. Open questions / decisions for review

1. **Pool model**: tags as pools (recommended) vs first-class pool records.
   Promote when first cap-policy use case appears.
2. **One pairing code, many machines**: should we support batch pairing
   codes for fleet rollouts? Default no — single-use only. Revisit if
   enterprise asks.
3. **Operator on mobile pairing on mobile**: do we render the entire
   pairing modal in a mobile-friendly layout, or only the QR path? Default
   QR path; full mobile authoring is out of scope.
4. **Cost data**: do ephemeral providers always return a per-job cost
   estimate? AWS Fargate yes, GCP VMs need pricing config. Open with
   protocol pass on whether the daemon reports this.
5. **Auto-provisioning rule shape**: structured fields now vs a small
   DSL? Recommended structured fields to start.
6. **Kelpie deep-link scheme**: `kelpie://` vs universal links. Needs
   Kelpie team confirmation.
7. **Ceremony catalog**: do we keep it in `packages/contracts` so MCP can
   also start ceremonies? Recommended yes.
8. **Machine "labels" vs "tags"**: pick one term. Recommended `tags`
   because Workflow Designer already uses that word.
9. **Worker concurrency advertised by daemon vs imposed by SupportAgent**:
   recommended both, with min(daemon-cap, server-cap).
10. **Are review-loop steps placed independently of their parent triage
    step?** Recommend yes — a build step on Mac can have a review-loop
    pass on Linux.
11. **What happens to in-flight jobs on a draining machine when the daemon
    crashes?** Protocol question; UI must show the run as `lost` and the
    machine as `offline`, not as both `draining` and `busy`.
12. **GDPR / audit for Kelpie screenshots**: redact PII before upload?
    Yes. Implementation owned by Kelpie.

---

## 14. Reuse map

### Existing admin pages extended
- `Sidebar.tsx` — add `Machines` and `Auto-provisioning` rows to
  Infrastructure section.
- `/runtimes/*` (in `admin-ui.md` route map but not yet built) — replaced
  by `/infrastructure/machines/*`. Keep `runtimeId` in API contracts.
- `ProvidersPage` and detail — kept; auto-provisioning page links into it
  for capability/profile editing.
- `RunDetailPage` — add `Machine` chip in the header linking to machine
  detail.
- `WorkflowDesignerInspector` — extended with `Execute on` block and
  `Required capabilities` selector.
- `/settings/api-keys` — gains a `runtime` keys section if not already
  present (today it does, see `providersApi.listApiKeys`). No change.

### Reused components from `apps/admin/src/components/ui/*`
- `DataTable` for machine list.
- `Card` + `CardHeader` for grouped sections on detail pages.
- `PageShell` for every new route.
- `Badge`, `TypePill` for status, origin, capabilities.
- `SearchableMultiSelect` for capability filter and tag picker.
- `SearchableSelect` for provider picker and machine picker in inspector.
- `EmptyState` for empty machine list / no-candidate steps.
- `Pagination` for the list.
- `StatCard` for the daily-spend / online-count summary on
  `/infrastructure/machines`.

### New components (necessary; minimal additions)
- `MachineStatusDot` — small standardized shape+color+label.
- `CapabilityChip` — pill with toolchain icon, used in list and detail.
- `PairingCodeInput` — segmented input with TTL countdown.
- `CeremonyProgress` — generic ceremony-status renderer reused by Kelpie
  flows.
- `MachinePicker` — combobox used in workflow designer inspector.

### Shared schemas
- `packages/contracts` gains: `Machine`, `MachineCapability`,
  `MachineOrigin`, `PairingRequest`, `Ceremony`, `AutoProvisioningRule`.
  These mirror what the daemon protocol pass will define; UI only consumes
  read DTOs.

### API surface
- `GET /v1/machines`, `GET /v1/machines/:id`
- `POST /v1/machines/pair`, `POST /v1/machines/claim`
- `POST /v1/machines/:id/drain`, `/unpair`, `/rotate-key`, `/tags`
- `GET /v1/auto-provisioning`, `PUT /v1/auto-provisioning/:provider`
- `POST /v1/ceremonies`, `GET /v1/ceremonies/:id`
- WebSocket fan-out events: `machine.upserted`, `machine.deleted`,
  `pairing.updated`, `ceremony.updated`.

---

## 15. Phased rollout

### MVP (target: first paired Mac mini in production)
- `/infrastructure/machines` list (paired only, no ephemeral).
- Pair modal with code paste; no QR, no Kelpie.
- Machine detail with identity, capabilities, current job, recent jobs,
  drain, unpair.
- Workflow Designer: `Execute on` with two modes only — `Any matching` and
  `Specific machine`.
- Live status via existing admin WebSocket.
- No auto-provisioning page.
- Audit on pair/unpair.

### v1 (target: ephemeral Docker + capability matching)
- Auto-provisioning page; GCP VM and AWS Fargate providers.
- Designer: `Specific pool` and `Ephemeral cloud` modes.
- Capability requirements + candidate-preview in inspector.
- Rotate key.
- Tag bulk actions.
- QR pairing.
- Stat-card summary on list view.

### v2 (target: Kelpie + advanced ops)
- Kelpie ceremony abstraction and the GitHub-login / verify-workflow /
  pair-via-Kelpie ceremonies.
- Daemon-reported Kelpie discovery via heartbeat.
- Pool promotion to first-class records (only if needed by a real policy).
- Cost summary across providers.
- Ceremony audit screenshots.
- Multi-tenant view for Support Agent ops.

---

*End of draft.*
