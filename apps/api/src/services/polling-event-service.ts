import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

export type PollingEvent =
  | {
      kind: 'github.issue.opened';
      connectorId: string;
      repositoryMappingId: string;
      issue: PolledIssuePayload;
    }
  | {
      kind: 'github.issue.labeled';
      connectorId: string;
      repositoryMappingId: string;
      label: string;
      issue: PolledIssuePayload;
    }
  | {
      kind: 'github.pull_request.opened';
      connectorId: string;
      repositoryMappingId: string;
      pr: PolledPrPayload;
    }
  | {
      kind: 'github.pull_request.comment';
      connectorId: string;
      repositoryMappingId: string;
      pr: PolledPrPayload;
      comment: PolledPrCommentPayload;
    }
  | {
      kind: 'github.pull_request.merged';
      connectorId: string;
      repositoryMappingId: string;
      pr: PolledPrPayload;
    }
  | {
      kind: 'github.issue.closed_comment';
      connectorId: string;
      repositoryMappingId: string;
      issue: PolledIssuePayload;
      comment: PolledPrCommentPayload;
    };

export interface PolledIssuePayload {
  body: string | null;
  comments: Array<{
    author: string;
    body: string;
    createdAt: string;
    id: string;
    url?: string;
  }>;
  labels: string[];
  number: number;
  state: string;
  title: string;
  updatedAt?: string;
  url: string;
}

export interface PolledPrPayload {
  body: string | null;
  number: number;
  state: string;
  title: string;
  updatedAt?: string;
  url: string;
  headSha?: string;
  headRef?: string;
  baseRef?: string;
}

export interface PolledPrCommentPayload {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
}

export type EnqueueOutcome =
  | { status: 'created'; workItemId: string; workflowRunId: string }
  | { status: 'duplicate'; workItemId: string; workflowRunId: string | null };

function workflowTypeForAction(actionKind: string): 'triage' | 'build' | 'review' | null {
  if (actionKind === 'workflow.triage') return 'triage';
  if (actionKind === 'workflow.build') return 'build';
  if (actionKind === 'workflow.review') return 'review';
  return null;
}

export function dedupeKeyForEvent(event: PollingEvent, scenarioId: string, repositoryUrl: string) {
  if (event.kind === 'github.issue.opened') {
    return `scn:${scenarioId}:${repositoryUrl}:issue-opened:${event.issue.number}`;
  }
  if (event.kind === 'github.issue.labeled') {
    // updatedAt is the preferred discriminator: removing and re-adding a label
    // bumps updatedAt on the issue, producing a fresh dedupe key so the scenario
    // can fire again. When updatedAt is absent (e.g. webhook payloads that omit
    // it) we derive a stable identity from the event's observable content —
    // label name, issue number, sorted labels array, and state. This stays
    // constant across polls of the same state and changes when the labels or
    // state actually change, so dedupe still works correctly.
    const discriminator =
      event.issue.updatedAt ??
      createHash('sha1')
        .update(event.label)
        .update(':')
        .update(String(event.issue.number))
        .update(':')
        .update(JSON.stringify([...event.issue.labels].sort()))
        .update(':')
        .update(event.issue.state)
        .digest('hex')
        .slice(0, 16);
    return `scn:${scenarioId}:${repositoryUrl}:issue-labeled:${event.label}:${event.issue.number}:${discriminator}`;
  }
  if (event.kind === 'github.pull_request.opened') {
    return `scn:${scenarioId}:${repositoryUrl}:pr-opened:${event.pr.number}`;
  }
  if (event.kind === 'github.pull_request.merged') {
    return `scn:${scenarioId}:${repositoryUrl}:pr-merged:${event.pr.number}`;
  }
  if (event.kind === 'github.issue.closed_comment') {
    return `scn:${scenarioId}:${repositoryUrl}:issue-closed-comment:${event.issue.number}:${event.comment.id}`;
  }
  return `scn:${scenarioId}:${repositoryUrl}:pr-comment:${event.pr.number}:${event.comment.id}`;
}

export function createPollingEventService(prisma: PrismaClient) {
  async function loadScenario(scenarioId: string, tenantId: string) {
    const scenario = await prisma.workflowScenario.findFirst({
      where: { id: scenarioId, tenantId, isEnabled: true },
    });
    if (!scenario) {
      throw Object.assign(new Error('Scenario not found or disabled'), { statusCode: 404 });
    }
    return scenario;
  }

  async function loadMapping(repositoryMappingId: string, tenantId: string, connectorId: string) {
    const mapping = await prisma.repositoryMapping.findFirst({
      where: { id: repositoryMappingId, tenantId, connectorId },
      include: { connector: { include: { platformType: true } } },
    });
    if (!mapping) {
      throw Object.assign(new Error('Repository mapping not found'), { statusCode: 404 });
    }
    return mapping;
  }

  return {
    async enqueueEvent(
      tenantId: string,
      input: { scenarioId: string; actionKind: string; event: PollingEvent },
    ): Promise<EnqueueOutcome> {
      const scenario = await loadScenario(input.scenarioId, tenantId);
      const mapping = await loadMapping(
        input.event.repositoryMappingId,
        tenantId,
        input.event.connectorId,
      );
      const workflowType = workflowTypeForAction(input.actionKind);
      if (!workflowType) {
        throw Object.assign(new Error(`Unsupported action: ${input.actionKind}`), {
          statusCode: 400,
        });
      }

      const dedupeKey = dedupeKeyForEvent(input.event, scenario.id, mapping.repositoryUrl);

      return prisma.$transaction(
        async (tx) => {
          const existing = await tx.inboundWorkItem.findFirst({ where: { dedupeKey } });
          if (existing) {
            const existingRun = await tx.workflowRun.findFirst({
              where: { workItemId: existing.id, workflowType },
              orderBy: { createdAt: 'desc' },
            });
            return {
              status: 'duplicate' as const,
              workItemId: existing.id,
              workflowRunId: existingRun?.id ?? null,
            };
          }

          const workItem = await tx.inboundWorkItem.create({
            data: buildWorkItemData({
              event: input.event,
              dedupeKey,
              mapping,
              platformKey: mapping.connector.platformType.key,
            }),
          });

          const run = await tx.workflowRun.create({
            data: {
              tenantId,
              workflowType,
              status: 'queued',
              workItemId: workItem.id,
              repositoryMappingId: mapping.id,
              workflowScenarioId: scenario.id,
            },
          });

          return {
            status: 'created' as const,
            workItemId: workItem.id,
            workflowRunId: run.id,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },
  };
}

function buildWorkItemData(input: {
  event: PollingEvent;
  dedupeKey: string;
  mapping: { id: string; repositoryUrl: string; connectorId: string };
  platformKey: string;
}) {
  const { event, dedupeKey, mapping, platformKey } = input;

  if (
    event.kind === 'github.issue.opened' ||
    event.kind === 'github.issue.labeled' ||
    event.kind === 'github.issue.closed_comment'
  ) {
    const issueComments =
      event.kind === 'github.issue.closed_comment'
        ? ([
            {
              author: event.comment.author,
              body: event.comment.body,
              commentId: event.comment.id,
              createdAt: event.comment.createdAt,
            },
          ] as Prisma.InputJsonValue)
        : (event.issue.comments.map((comment) => ({
            author: comment.author,
            body: comment.body,
            commentId: comment.id,
            createdAt: comment.createdAt,
          })) as Prisma.InputJsonValue);

    return {
      connectorInstanceId: mapping.connectorId,
      platformType: platformKey,
      workItemKind: 'issue' as const,
      externalItemId: String(event.issue.number),
      externalUrl: event.issue.url,
      title: event.issue.title,
      body: event.issue.body ?? undefined,
      status: event.issue.state.toLowerCase(),
      comments: issueComments,
      dedupeKey,
      repositoryMappingId: mapping.id,
      repositoryRef: mapping.repositoryUrl,
    };
  }

  return {
    connectorInstanceId: mapping.connectorId,
    platformType: platformKey,
    workItemKind: 'review_target' as const,
    reviewTargetType: 'pull_request',
    reviewTargetNumber: event.pr.number,
    externalItemId: String(event.pr.number),
    externalUrl: event.pr.url,
    title: event.pr.title,
    body: event.pr.body ?? undefined,
    status: event.pr.state.toLowerCase(),
    dedupeKey,
    repositoryMappingId: mapping.id,
    repositoryRef: mapping.repositoryUrl,
    ...(event.kind === 'github.pull_request.comment'
      ? {
          comments: [
            {
              author: event.comment.author,
              body: event.comment.body,
              commentId: event.comment.id,
              createdAt: event.comment.createdAt,
            },
          ] as Prisma.InputJsonValue,
        }
      : {}),
  };
}

export type PollingEventService = ReturnType<typeof createPollingEventService>;
