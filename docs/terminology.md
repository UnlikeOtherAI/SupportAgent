# Terminology

## Worker

A `worker` is the execution runtime that actually performs one job.

A worker:

- receives a dispatch
- fetches context
- clones the repository
- runs `triage`, `build`, or `merge` work
- streams progress
- uploads artifacts
- submits the final report

One worker execution handles one job at a time.

## Gateway

A `gateway` is a dispatcher or manager that accepts jobs from the active Support Agent control plane and either forwards them to an existing worker pool or spawns workers on demand and then forwards the jobs to them.

A gateway:

- registers with Support Agent
- accepts upstream dispatches
- routes jobs to workers or a worker pool
- may create or spawn workers on demand
- preserves job identity and reporting contract
- sends normalized progress and results back upstream

A gateway does not perform the investigation itself unless it also embeds a worker.

## Reverse Connection Mode

`Reverse connection mode` is a connectivity pattern, not a separate runtime role.

In reverse connection mode, a private machine or server opens an outbound session to Support Agent so the cloud does not need direct inbound access.

Either a `worker` or a `gateway` can operate in reverse connection mode.

In that mode, the runtime:

- opens the outbound session to Support Agent
- registers capabilities
- receives control messages
- streams lightweight realtime updates back over the session

If the runtime is a worker, it executes jobs itself.

If the runtime is a gateway, it dispatches jobs to one or more workers.

## Host

A `host` is the concrete machine or runtime endpoint that provides execution capacity for a worker or gateway.

Examples:

- one local Linux machine
- one Mac mini
- one VM in a cloud provider
- one self-hosted CI runner

Hosts advertise capabilities, concurrency, and connection state to the control plane.

## app-reveal

`app-reveal` is a project dependency used for application interaction or inspection during supported reproduction flows, especially Android-capable runtime profiles.

In this project it should be treated as:

- optional tooling, not a core platform primitive
- capability-gated
- available only when the host or runtime profile actually has it installed
