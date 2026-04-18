import { type PrismaClient } from '@prisma/client';
import type { DeliveryOp, SkillRunResult } from '@support-agent/contracts';
import {
  ghAddIssueComment,
  ghAddPRComment,
  ghApprovePR,
  ghCloseIssue,
  ghCreatePR,
  ghEditIssueLabels,
  ghMergePR,
  ghReopenIssue,
  ghRequestChangesPR,
  parseGitHubRef,
} from '@support-agent/github-cli';

type DeliveryTargetKind = 'source_connector' | 'repository_provider';

type SourceTarget =
  | { kind: 'issue'; number: number; owner: string; repo: string }
  | { kind: 'pr'; number: number; owner: string; repo: string };

type ConnectorTarget = {
  connectorId: string;
  kind: DeliveryTargetKind;
  owner: string;
  platformKey: string;
  repo: string;
};

function buildOutputSummary(op: DeliveryOp) {
  switch (op.kind) {
    case 'comment':
      return op.body.slice(0, 280);
    case 'labels':
      return `labels:add=${(op.add ?? []).join(',')} remove=${(op.remove ?? []).join(',')}`;
    case 'state':
      return `state:${op.change}`;
    case 'pr':
      return op.spec.title;
  }
}

function readDeliveryVisibility(op: DeliveryOp): 'public' | 'internal' {
  return op.visibility ?? 'public';
}

function applyPreviousValues(op: DeliveryOp, previousValues: Record<string, string>): DeliveryOp {
  if (op.kind !== 'comment') {
    return op;
  }

  const body = op.body.replaceAll('${prev.prUrl}', previousValues.prUrl ?? '');
  return { ...op, body };
}

function readSourceTarget(run: {
  repositoryMapping: { repositoryUrl: string };
  workItem: {
    externalItemId: string;
    reviewTargetNumber: number | null;
    reviewTargetType: string | null;
    workItemKind: string;
  };
}): SourceTarget {
  const { owner, repo } = parseGitHubRef(run.repositoryMapping.repositoryUrl);
  const number = run.workItem.reviewTargetNumber ?? Number.parseInt(run.workItem.externalItemId, 10);

  if (!Number.isFinite(number)) {
    throw new Error(`Workflow run ${'id' in run ? (run as { id: string }).id : 'unknown'} is missing a numeric source item reference`);
  }

  if (run.workItem.workItemKind === 'review_target' || run.workItem.reviewTargetType === 'pull_request') {
    return { kind: 'pr', number, owner, repo };
  }

  return { kind: 'issue', number, owner, repo };
}

function resolveConnectorTarget(
  op: DeliveryOp,
  run: {
    repositoryMapping: { connectorId: string; repositoryUrl: string; connector: { platformType: { key: string } } };
    workItem: { connectorInstanceId: string };
  },
): ConnectorTarget {
  if (op.kind === 'pr') {
    const { owner, repo } = parseGitHubRef(run.repositoryMapping.repositoryUrl);
    return {
      connectorId: run.repositoryMapping.connectorId,
      kind: 'repository_provider',
      owner,
      platformKey: run.repositoryMapping.connector.platformType.key,
      repo,
    };
  }

  const { owner, repo } = parseGitHubRef(run.repositoryMapping.repositoryUrl);
  return {
    connectorId: run.workItem.connectorInstanceId,
    kind: 'source_connector',
    owner,
    platformKey: run.repositoryMapping.connector.platformType.key,
    repo,
  };
}

async function dispatchGitHubOp(args: {
  op: DeliveryOp;
  codeHostTarget: ConnectorTarget;
  sourceTarget: SourceTarget;
}): Promise<{ externalRef?: string; producedValues?: Record<string, string> }> {
  const { op, codeHostTarget, sourceTarget } = args;

  switch (op.kind) {
    case 'comment': {
      const created =
        sourceTarget.kind === 'pr'
          ? await ghAddPRComment(sourceTarget.owner, sourceTarget.repo, sourceTarget.number, op.body)
          : await ghAddIssueComment(sourceTarget.owner, sourceTarget.repo, sourceTarget.number, op.body);
      return { externalRef: created.url };
    }
    case 'labels':
      await ghEditIssueLabels(sourceTarget.owner, sourceTarget.repo, sourceTarget.number, {
        add: op.add,
        remove: op.remove,
      });
      return {};
    case 'state':
      if (op.change === 'close') {
        await ghCloseIssue(sourceTarget.owner, sourceTarget.repo, sourceTarget.number);
        return {};
      }
      if (op.change === 'reopen') {
        await ghReopenIssue(sourceTarget.owner, sourceTarget.repo, sourceTarget.number);
        return {};
      }
      if (op.change === 'merge') {
        if (sourceTarget.kind !== 'pr') {
          throw new Error('Cannot merge a non-PR source target');
        }
        await ghMergePR(codeHostTarget.owner, codeHostTarget.repo, sourceTarget.number);
        return {};
      }
      if (sourceTarget.kind !== 'pr') {
        throw new Error(`State change ${op.change} requires a PR source target`);
      }
      if (op.change === 'approve') {
        await ghApprovePR(sourceTarget.owner, sourceTarget.repo, sourceTarget.number);
        return {};
      }
      await ghRequestChangesPR(sourceTarget.owner, sourceTarget.repo, sourceTarget.number);
      return {};
    case 'pr': {
      const created = await ghCreatePR(
        codeHostTarget.owner,
        codeHostTarget.repo,
        op.spec.title,
        op.spec.body,
        op.spec.branch,
        op.spec.base ?? 'main',
        { draft: op.spec.draft },
      );
      return {
        externalRef: created.url,
        producedValues: {
          prUrl: created.url,
        },
      };
    }
  }
}

export function createDeliveryResolverService(prisma: PrismaClient) {
  return {
    async resolveDelivery(args: {
      workflowRunId: string;
      leafOutputs: SkillRunResult[];
    }): Promise<{ persisted: number; dispatched: number }> {
      const run = await prisma.workflowRun.findUnique({
        where: { id: args.workflowRunId },
        include: {
          repositoryMapping: {
            include: {
              connector: {
                include: {
                  platformType: true,
                },
              },
            },
          },
          workItem: true,
        },
      });

      if (!run) {
        throw Object.assign(new Error('Workflow run not found'), { statusCode: 404 });
      }

      const sourceTarget = readSourceTarget(run);
      const previousValues: Record<string, string> = {};
      let persisted = 0;
      let dispatched = 0;
      let firstCommentHandledByProgressComment = Boolean(run.progressCommentId);

      for (const leafOutput of args.leafOutputs) {
        for (const rawOp of leafOutput.delivery) {
          const op = applyPreviousValues(rawOp, previousValues);
          const connectorTarget = resolveConnectorTarget(op, run);
          const visibility = readDeliveryVisibility(op);
          const actionOutput = await prisma.actionOutput.create({
            data: {
              tenantId: run.tenantId,
              workflowRunId: run.id,
              outputType: op.kind,
              deliveryStatus: visibility === 'internal' ? 'suppressed_internal' : 'pending',
              payload: op as unknown as object,
              summary: buildOutputSummary(op),
            },
          });
          persisted += 1;

          if (visibility === 'internal') {
            continue;
          }

          const attempt = await prisma.actionDeliveryAttempt.create({
            data: {
              tenantId: run.tenantId,
              workflowRunId: run.id,
              actionOutputId: actionOutput.id,
              destinationType: connectorTarget.kind,
              destinationId: connectorTarget.connectorId,
              status: 'pending',
              attemptNumber: 1,
            },
          });

          if (connectorTarget.platformKey !== 'github' && connectorTarget.platformKey !== 'github_issues') {
            await prisma.actionDeliveryAttempt.update({
              where: { id: attempt.id },
              data: {
                status: 'failed',
                error: `Unsupported connector platform: ${connectorTarget.platformKey}`,
                completedAt: new Date(),
              },
            });
            await prisma.actionOutput.update({
              where: { id: actionOutput.id },
              data: { deliveryStatus: 'failed' },
            });
            continue;
          }

          if (op.kind === 'comment' && firstCommentHandledByProgressComment) {
            await prisma.actionDeliveryAttempt.update({
              where: { id: attempt.id },
              data: {
                status: 'succeeded',
                externalRef: run.progressCommentId,
                completedAt: new Date(),
              },
            });
            await prisma.actionOutput.update({
              where: { id: actionOutput.id },
              data: { deliveryStatus: 'sent' },
            });
            firstCommentHandledByProgressComment = false;
            dispatched += 1;
            continue;
          }

          try {
            const result = await dispatchGitHubOp({
              op,
              codeHostTarget: connectorTarget,
              sourceTarget,
            });
            Object.assign(previousValues, result.producedValues);
            await prisma.actionDeliveryAttempt.update({
              where: { id: attempt.id },
              data: {
                status: 'succeeded',
                externalRef: result.externalRef,
                completedAt: new Date(),
              },
            });
            await prisma.actionOutput.update({
              where: { id: actionOutput.id },
              data: { deliveryStatus: 'sent' },
            });
            dispatched += 1;
          } catch (error) {
            await prisma.actionDeliveryAttempt.update({
              where: { id: attempt.id },
              data: {
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
                completedAt: new Date(),
              },
            });
            await prisma.actionOutput.update({
              where: { id: actionOutput.id },
              data: { deliveryStatus: 'failed' },
            });
          }
        }
      }

      return { persisted, dispatched };
    },
  };
}

export type DeliveryResolverService = ReturnType<typeof createDeliveryResolverService>;
