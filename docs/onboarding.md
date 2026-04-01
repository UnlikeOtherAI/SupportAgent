# Operator Onboarding

## Purpose

This document defines the minimum operator path from zero setup to the first successful workflow run.

## First Successful Triage Path

1. create or connect the tenant workspace
   if customer-hosted control plane mode is used, this means the customer-hosted Support Agent deployment
2. choose the product mode
   standalone SaaS, standalone enterprise, or integrated mode
3. choose the control-plane hosting mode
4. choose the human-auth path
   Support Agent login, enterprise SSO, or integration token exchange from the parent product
5. choose the execution mode
6. choose the model-access mode
7. choose the output-return policy
8. create connector credentials
9. create the inbound connector
10. run capability discovery
11. confirm webhook or polling mode
12. create the repository mapping
13. choose execution, orchestration, and review defaults
14. register a worker or gateway runtime
15. verify runtime capabilities and connection health
16. create trigger policies
17. bind a workflow scenario
18. send a test inbound event
19. verify the `workflowRun` reaches `succeeded` and outbound delivery completes

## First Successful Build Path

After the first successful triage path works:

1. configure outbound PR capability
2. configure build trigger policy or manual build action
3. configure review profile precedence
4. trigger a build run
5. verify branch push and outbound PR creation

## First Successful Merge Path

After the first successful build path works:

1. configure merge policy
2. configure merge trigger path
3. verify rebase, validation, review, and merge execution on a test branch

## Rule

Do not consider a tenant onboarded until:

- one inbound connector works
- one repository mapping works
- one runtime works
- one `triage` run succeeds end to end
- the product mode, hosting mode, human-auth path, model-access mode, and output policy are explicitly recorded
