# Support Agent Brief

Terminology: [terminology.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/terminology.md). In this project, a `worker` executes one job, and a `gateway` dispatches jobs to one or more workers.

## Summary

Support Agent will be a reusable system for managing incoming issues, triaging them, investigating them, and eventually creating pull requests from them. It should accept issues from reporting tools such as Sentry and from customer support or issue trackers such as GitHub Issues.

At the product boundary, Support Agent is the orchestrator. Customer-owned runtimes provide execution capacity and local toolchains. Support Agent should give them typed workflow instructions and manifests, not require customers to encode our business logic in their own infrastructure.

The runtime CLI should be the canonical prompt-execution and connection layer for both workers and gateways.
For admin implementation, each page should be scaffolded with `wf` CLI and verified with a Playwright clickthrough before the next page is started.
The API must keep the connector platform catalog available from the shared registry at startup so the admin Apps page does not depend on a separate manual seed run.
The first Apps page is a registry-backed install surface over connector and communication-channel records; it does not require a separate `apps` table.
Communication-channel setup belongs under the admin Configuration area with connectors, repositories, and routing targets. Runtime conversation history should be shown as run, channel, delivery, or audit context rather than as a separate top-level Communication section.
Workflow setup should expose a visual designer under Configuration so operators can create saved workflows by connecting incoming triggers, middle actions, and outputs on a canvas. The saved workflow should be listed after leaving the designer and should map to the same workflow scenario model used by automation.
Action nodes in that designer should bind a concrete executor key and task prompt so scenarios can route into the skills-and-executors runtime without hardcoded worker handlers.
Scenario detail should expose a trigger allowlist for GitHub actors so operators can default a scenario to allow-all or deny-unless-listed with explicit user and team entries.
Workflow run detail should expose checkpoint-backed loop convergence history and a two-phase stop control so operators can request cancel first and escalate to force-stop only when the worker does not stop cleanly.

Reference scenario: [use-cases.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/use-cases.md)
Reference configurable scenario model: [workflow-scenarios.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/workflow-scenarios.md)
Reference automation composition model: [automation-composition.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/automation-composition.md)
Reference core contracts: [contracts.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/contracts.md)
Reference review process: [review-process.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/review-process.md)
Reference operator onboarding: [onboarding.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/onboarding.md)
Reference deployment and auth modes: [deployment-modes.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/deployment-modes.md)
Reference identity provider facade: [identity-providers.md](/System/Volumes/Data/.internal/projects/Projects/SupportAgent/docs/identity-providers.md)

## Core Goals

- Ingest issue data from multiple external platforms.
- Map each issue source to the correct repository and project context.
- Run a repeatable triage workflow against the target codebase.
- Run instruction-driven `triage`, `build`, and `merge` workflows against the target codebase.
- Send findings back to the source system or another configured destination.
- Progress from issue intake to investigation and, later, automated PR creation.
- Support inbound repository events such as new PRs so the system can run automated review and validation jobs.
- Support enterprise deployments without requiring direct codebase access by the hosted Support Agent control plane.
- Support both hosted SaaS and customer-hosted on-prem control-plane deployments.
- Support embedded or integrated use inside another product such as `docgen` without forcing a second login flow.

## Product Modes

Support Agent should support three product-facing modes:

1. standalone SaaS
2. standalone enterprise
3. integrated mode

Standalone SaaS should use Support Agent-managed login.

Standalone enterprise should support tenant-scoped enterprise SSO and customer-executed runtimes by default.

Integrated mode should allow a parent product such as `docgen` to establish user identity first and then exchange that identity into a local Support Agent session without reusing a raw shared secret as the API credential.

## Ingestion and Connectors

The system needs connectors that can integrate with supported platforms either through webhooks or polling. A platform may be:

- inbound only,
- outbound only,
- or both inbound and outbound.

Initial examples:

- Sentry and Crashlytics are primarily inbound error-reporting sources.
- Linear, GitHub Issues, Jira, and Trello are examples of platforms that can work as both inbound and outbound connectors.
- GitHub, GitLab, Bitbucket, and similar code-hosting platforms should also be able to send inbound PR or merge-request events for automated review workflows.

Each source integration must support:

- Receiving and normalizing issue data.
- Registering which repository the issue belongs to.
- Registering where updates, findings, and comments should be sent back.
- Commenting back into the source system when supported.
- Reading comments and comment threads where the source platform exposes them.
- Detecting when the bot is explicitly addressed in comments, such as `@{bot_name}`, and responding when policy allows it.
- Reading and using platform taxonomy such as tags, labels, categories, projects, boards, or issue types where relevant.
- Creating or updating downstream issues in the correct category, project, board, or label set where relevant.
- Reading and honoring dependency metadata where the source platform exposes it reliably.
- Reading attachments and images where supported, and using an LLM to describe relevant images so they can inform triage or delivery workflows.

The connector model must support cases such as:

- Linear issue comes in -> a `triage` workflow run starts -> comment is posted back to the same Linear issue.
- Sentry issue comes in -> a `triage` workflow run starts -> a new ticket is created in a configured outbound system such as Linear, GitHub Issues, Jira, or Trello.
- Linear support ticket comes in -> a `triage` workflow run with reproduction starts -> developer gets notified in Slack -> developer requests a PR.
- Jira ticket with screenshots and follow-up comments comes in -> attachments are described -> comment context is included -> bot replies when explicitly mentioned.

The whole connector setup must be configurable over MCP as well as through the admin UI. MCP configuration must support multiple inbound connectors, multiple outbound connectors, repository mappings, and routing rules.

Every connector should also expose trigger settings in the admin panel and MCP so operators can define what starts triage, build, and merge work.

GitHub and GitHub Issues connectors must also support a local-machine `gh` authentication mode in the admin UI for operator-run environments. That mode should:

- reuse the logged-in GitHub CLI session on the machine that runs the worker and cron loop,
- default to polling every 5 minutes while allowing the operator to change the interval,
- load the repository selector from the authenticated `gh` account and org access rather than asking the operator to type repository URLs manually.

The local runtime or gateway owns that polling loop. The API stores the interval and repository scope, receives observed issue events as connector polling `AutomationEvent` payloads, and performs trigger matching centrally.

Those triggers may include:

- status changes
- labels or tags
- issue type
- project or board placement
- comments or bot mentions
- epic readiness markers such as `AI ready`

Build triggers should support both:

- fix-oriented implementation
- feature-oriented implementation

Those triggers should feed one or more configured workflow scenarios rather than one global hard-coded automation path.

Those workflow scenarios should remain instruction-driven. The preferred extension model is that Support Agent sends typed instructions or manifests to the runtime rather than requiring customers to write custom automation code.

The system must also detect real platform capabilities for the connected account where possible. If a platform supports webhooks in general but the current account or tariff does not, Support Agent should detect that and fall back to polling when supported.

The same rule applies to dependency handling. If a platform exposes issue dependencies and the connected account can read them reliably, Support Agent should be able to hold blocked work until prerequisites are complete. If the platform does not expose this clearly, the system should not guess.

The same preference applies to comment and mention handling. If a connector platform can deliver comments, replies, or bot mentions through webhooks, Support Agent should prefer webhooks over polling.

For local-`gh` GitHub issue polling, the polling path must only queue triage for open issues that do not already have both:

- the Support Agent discovery comment marker,
- the `triaged` issue label.

When triage completes for that path, Support Agent must post the discovery comment first, then ensure the required GitHub labels exist, then apply the `triaged` and severity labels so the next poll cycle skips the issue deterministically.

The implementation direction should follow the already-proven pattern from `../KiloSupport`: source-specific intake at the edge, a normalized workflow run in the core system, and source-specific outbound delivery after the investigation is complete.

Integrated delivery should follow the same rule. A parent product such as `docgen` should call Support Agent through an explicit integration boundary and receive normalized workflow results back rather than duplicating Support Agent orchestration logic inside the parent product.

## Communication Channels

Support Agent should also support communication channels that let people talk to the control-plane operator assistant and receive updates outside the dashboard.

That control-plane operator assistant should be understood as:

- it runs in the Support Agent control plane
- it interprets allowed operator requests
- it may trigger workflow actions through the same backend action model as the dashboard and MCP
- it is separate from the worker-side Claude or Codex execution inside customer runtimes

Initial channels should include:

- Slack
- Microsoft Teams
- business WhatsApp

These channels are separate from issue connectors. They should let operators or customers:

- ask the bot to triage something
- ask what a run found
- request a PR when allowed
- receive notifications and summaries

They must still operate through the same permission and action model as the admin app and MCP. Chat should be another control surface, not a bypass around policy.

WhatsApp should support pairing a business number or conversation to the correct tenant, team, connector scope, or repository scope. If the platform supports group chats, the system should support a team conversation model as well.

For high-urgency incidents, communication channels should be able to act as the first alert surface. A WhatsApp alert for a critical crash should arrive while triage is already being created, not after the investigation is finished.

## Top-Level Workflow Types

The platform should standardize on three top-level workflow types:

- `triage`
- `build`
- `merge`

`Review` should not be treated as a separate top-level workflow type. Internal review loops should be able to run inside any of the three workflow types when the configured policy requires them.

## First Major Workflow: Triage

The first implemented workflow will be triage.

Triage should:

1. Receive an issue from a connected source.
2. Resolve which repository is associated with that source.
3. Clone the repository into a worker environment.
4. Inspect the codebase and the reported issue details.
5. Attempt to locate the likely cause in the codebase.
6. Optionally attempt to reproduce the issue, depending on source type and configuration.
7. Produce a written finding that explains what appears to be wrong.
8. Send the finding back to the configured destination.

If the inbound item is blocked by a trusted dependency relationship exposed by the connector, triage should be held in a blocked state until the dependency policy allows it to run.

The worker should fetch its full context from the API on startup, upload artifacts back to the API, and post a structured report when complete. No direct database access from the worker.
For skills-and-executors dispatches, the worker should also fetch the pinned executor YAML and each referenced `SKILL.md` body from authenticated by-hash API endpoints so mid-run admin edits cannot change the active revision.

For direct cloud workers, the standard contract should remain API-driven.
For reverse-connected workers or gateways, WebSocket may also be used for control messages, heartbeats, and incremental live log chunks, while final reports and bulky outputs still go through HTTP API calls.
Reverse-connected cancel remains a two-phase contract: `cancel_requested` is checkpoint-safe, while `cancel_force` terminates the active subprocess on the worker. Until the API has a direct API-to-gateway session bridge, control-plane cancel broadcasts may be logged as intent and the worker must keep the HTTP status polling fallback.

For support-ticket-driven flows, triage should be able to boot the application environment and use tools such as Playwright to reproduce the reported issue before handing the result to a developer.

## Reproduction Strategy

Reproduction should be configurable per source or per issue type. Some issue sources should trigger an attempt to reproduce the issue, while others may skip that step.

Current expected reproduction capabilities:

- Android apps can be built and run on Linux.
- Web apps can be exercised with Playwright.
- `app-reveal` can be used with Android emulator flows.
- iOS reproduction is limited because it requires a Mac, although `app-reveal` can support it where the required environment exists.

This means the system should support a capability-aware reproduction layer that works with the environments and tooling actually available.

## Investigation Output

When an issue is reproduced or otherwise understood, the system should inspect the codebase and write up what is wrong. Crash-style reports may arrive directly from systems like Sentry, while customer-reported issues may need more interpretation and reproduction effort before a useful finding can be produced.

The output of triage should be a structured investigation result that can later feed `build` and `merge` work.
Leaf outputs may also include internal-only delivery operations for audit purposes. These should be stored in `action_outputs` but suppressed from connector delivery.

That investigation result must be routable either back to the original platform or to a different configured outbound platform, depending on the connector setup.

## Build Workflow

After triage completes, the system should support a separate `build` workflow.

This workflow should allow:

- manual PR creation from the dashboard,
- connector-triggered PR requests using labels or tags where the platform supports them,
- optional `auto-pr` mode so build starts automatically after triage.

`Build` should generally be treated as the workflow that produces the branch, validation artifacts, and eventual PR candidate. PR creation should generally be treated as an outbound capability, because the PR usually needs to be opened in the code-hosting system rather than in the inbound issue source.

The system should also support internal review before and during build work.

For selected high-confidence or incident-response projects, `auto-pr` should be able to produce a PR before the operator manually opens the dashboard, leaving the human to validate, merge, and deploy.

That internal review should support multi-round critique and revision loops. The prompts and review policy for those loops should be controlled by the Support Agent control plane so review quality can improve without requiring customer runtime changes.

## Merge Workflow

The platform should also support a separate `merge` workflow.

`Merge` means:

- sync the generated branch with the latest base branch
- perform a rebase or equivalent update
- detect and attempt to resolve straightforward conflicts
- rerun the required validation and internal review loops
- merge when policy allows it

Merge should be triggerable by:

- dashboard action
- connector label or tag
- connector comment such as `@{bot_name} merge`
- communication-channel request from Slack, Teams, or WhatsApp when policy allows it
- workflow scenario settings such as explicit auto-merge rules

## Internal Review

Internal review should be treated as a cross-cutting capability that may run inside:

- triage
- build
- merge

Support Agent should decide when those review loops run by policy and manifest. Customer runtimes should execute the loops locally from Support Agent instructions rather than inventing local workflow logic.
Those runtime review loops must stay bounded by review-profile stop rules. Infinite automated review is not allowed.

## Multi-Ticket Feature Delivery Workflow

The platform should also support a longer-running feature delivery workflow driven by epics or parent work items in systems such as Jira.

This workflow should be able to:

- ingest an epic and its child tickets
- read acceptance criteria and design assets
- read ticket comments and bot-directed follow-up questions
- validate dependencies
- run independent tickets in parallel where safe
- assemble the combined work onto a feature branch
- produce a detailed PR
- optionally publish a review build such as TestFlight or a preview environment

This is a separate orchestration mode from single-ticket triage. It should be policy-driven and opt-in.

## Inbound PR Review Workflow

The platform should also support inbound repository review events.

Examples:

- new GitHub pull request
- updated pull request
- merge request marked ready for review
- label or review-trigger on a PR

These events should create a repository-review scenario that can:

- inspect the diff
- build the project if the runtime supports it
- run tests
- launch the app where appropriate
- validate implementation against a linked issue or specification
- return review findings through the configured outbound or communication channels

That scenario should start as a normalized `triage` workflow run with `workItemKind=review_target` and an attached review profile. If the scenario needs build or merge validation, it should create separate `build` or `merge` child runs from the triage result rather than introducing a fourth top-level workflow type.

## Execution Environment

Hosted-control-plane-managed execution should initially run on an external server instance in Google Cloud. That instance should be launched from a prebuilt image that already contains the required tooling.

The environment is expected to include:

- the code analysis and automation tooling needed for repository work,
- Claude Code with supplied API credentials,
- runtime and build tooling needed for supported targets,
- logging that can be surfaced through the system and forwarded elsewhere.

Worker execution should be universal. The control-plane dispatcher takes queued jobs and assigns them to configured execution providers. A customer-managed gateway may then route assigned work to one or more workers inside the customer's environment, as long as the gateway and workers conform to the unified runtime contract.

For enterprise customers, the default model should be customer-executed workers in the customer's environment so repository access does not need to be granted directly to the hosted Support Agent control plane.

The standard enterprise connection model should be a customer-installed runtime CLI package that registers to the active Support Agent control plane using a customer-scoped API key and operates as a worker or gateway.

Inside that customer runtime, Support Agent should assume a local orchestrator layer that drives Claude, Codex, or both according to the job profile and centrally managed prompt manifests.

The default model-access path should be through the active Support Agent control-plane proxy.

For selected customers, the platform may allow customer-provided Claude or Codex credentials, but Support Agent should still own prompts, manifests, orchestration policy, and review policy.

The product should also support customer-hosted control-plane deployments for enterprises that need to host the API, admin app, and orchestration plane on-prem or in their own cloud accounts.

## Product Surface

The product needs:

- one domain for the application,
- one API subdomain or equivalent `/api` routing setup,
- the main app running at the root domain,
- an admin panel built as a fully CSR application,
- styling built with Tailwind.

## Admin Panel Requirements

The admin panel should manage the operational side of the system, including:

- connector configuration,
- communication channel configuration under the same Configuration area as connectors and routing,
- visual workflow designer for trigger-action-output workflows,
- source-to-repository mapping,
- inbound and outbound connector role selection,
- trigger policy configuration for triage, build, and merge work,
- workflow scenario configuration,
- reproduction settings,
- workflow-run status visibility,
- logs and findings,
- outbound routing and callback destinations,
- build workflow controls,
- merge workflow controls,
- internal review visibility,
- auto-PR settings.

The admin panel must include a live jobs dashboard. Operators need to see all active and historical workflow runs, and when opening a run they need to see the full available log stream and progress in real time, subject to output-visibility policy.

It should also expose connector-level taxonomy and capability settings such as:

- label and tag mappings,
- project, category, or board targets,
- webhook availability,
- polling configuration,
- account capability test results.

The Configuration area should also expose communication-channel settings such as:

- Slack or Teams channel pairing,
- WhatsApp conversation pairing,
- allowed actions from chat,
- notification subscriptions,
- linked run or team context.

The same configuration model must also be available through MCP so the system can be set up and maintained programmatically.

For enterprise customers, the product should also expose a machine-oriented build specification under `docs/llm/` so coding agents can build compatible worker or gateway runtimes in the customer's own infrastructure.

That machine-facing documentation should cover:

- how to install and configure workers and gateways
- hosting guidance for local and server deployments
- runtime API key handling and rotation
- good practices for capability declaration, cleanup, logging, and result return

## Implementation Direction

The system should be built in a reusable way rather than as a one-off workflow for a single source. Skills should be used to build the implementation where available. If a required implementation skill is missing, that gap should be identified early so it can be added before development proceeds.
