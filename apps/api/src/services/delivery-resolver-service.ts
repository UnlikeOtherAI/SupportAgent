import { type PrismaClient } from '@prisma/client';
import type { DeliveryOp, SkillRunResult } from '@support-agent/contracts';
import {
  ghAddIssueComment,
  ghAddPRComment,
  ghApprovePR,
  ghCloseIssue,
  ghCreatePR,
  ghEditIssueLabels,
  ghListOpenPRsForBranch,
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
      const existing = await ghListOpenPRsForBranch(
        codeHostTarget.owner,
        codeHostTarget.repo,
        op.spec.branch,
      );
      if (existing.length > 0) {
        return {
          externalRef: existing[0].url,
          producedValues: {
            prUrl: existing[0].url,
          },
        };
      }

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
  type ExistingOutputRecord = NonNullable<Awaited<ReturnType<typeof findExistingOutput>>>;

  async function createReconciliationAttempt(args: {
    actionOutputId: string;
    destinationId: string;
    destinationType: DeliveryTargetKind;
    externalRef?: string;
    response: Record<string, unknown>;
    tenantId: string;
    workflowRunId: string;
  }) {
    return prisma.actionDeliveryAttempt.create({
      data: {
        tenantId: args.tenantId,
        workflowRunId: args.workflowRunId,
        actionOutputId: args.actionOutputId,
        destinationType: args.destinationType,
        destinationId: args.destinationId,
        status: 'succeeded',
        attemptNumber: 1,
        externalRef: args.externalRef,
        response: args.response as unknown as object,
        completedAt: new Date(),
      },
    });
  }

  async function reconcileInFlightOutput(args: {
    actionOutput: ExistingOutputRecord;
    codeHostTarget: ConnectorTarget;
    firstCommentHandledByProgressComment: boolean;
    op: DeliveryOp;
    run: Awaited<ReturnType<typeof prisma.workflowRun.findUnique>> & { progressCommentId: string | null; tenantId: string; id: string };
    sourceTarget: SourceTarget;
  }): Promise<{
    externalRef?: string;
    producedValues?: Record<string, string>;
    reconciled: boolean;
  }> {
    const latestAttempt = args.actionOutput?.deliveryAttempts[0];

    if (latestAttempt?.status === 'succeeded') {
      const externalRef = latestAttempt.externalRef ?? undefined;
      return {
        externalRef,
        producedValues:
          args.op.kind === 'pr' && externalRef
            ? { prUrl: externalRef }
            : undefined,
        reconciled: true,
      };
    }

    if (args.op.kind === 'comment' || args.op.kind === 'labels' || args.op.kind === 'state') {
      if (args.op.kind === 'comment' && args.firstCommentHandledByProgressComment && args.run.progressCommentId) {
        return {
          externalRef: args.run.progressCommentId,
          reconciled: true,
        };
      }

      return { reconciled: true };
    }

    const existing = await ghListOpenPRsForBranch(
      args.codeHostTarget.owner,
      args.codeHostTarget.repo,
      args.op.spec.branch,
    );
    if (existing.length > 0) {
      return {
        externalRef: existing[0].url,
        producedValues: {
          prUrl: existing[0].url,
        },
        reconciled: true,
      };
    }

    throw new Error(
      `In-flight PR delivery for branch "${args.op.spec.branch}" could not be reconciled safely`,
    );
  }

  async function findExistingOutput(idempotencyKey: string) {
    return prisma.actionOutput.findUnique({
      where: { idempotencyKey },
      include: {
        deliveryAttempts: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  }

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

      for (const [leafIndex, leafOutput] of args.leafOutputs.entries()) {
        let skipRemainingOps = false;

        for (const [opIndex, rawOp] of leafOutput.delivery.entries()) {
          const op = applyPreviousValues(rawOp, previousValues);
          const idempotencyKey = `${run.id}:${leafIndex}:${opIndex}`;

          if (skipRemainingOps) {
            const existingOutput = await findExistingOutput(idempotencyKey);
            if (existingOutput) {
              await prisma.actionOutput.update({
                where: { id: existingOutput.id },
                data: {
                  deliveryStatus: 'skipped_after_failure',
                  payload: op as unknown as object,
                  summary: buildOutputSummary(op),
                },
              });
            } else {
              await prisma.actionOutput.create({
                data: {
                  tenantId: run.tenantId,
                  workflowRunId: run.id,
                  idempotencyKey,
                  outputType: op.kind,
                  deliveryStatus: 'skipped_after_failure',
                  payload: op as unknown as object,
                  summary: buildOutputSummary(op),
                },
              });
            }
            persisted += 1;
            continue;
          }

          const existingOutput = await findExistingOutput(idempotencyKey);
          if (existingOutput?.deliveryStatus === 'sent' || existingOutput?.deliveryStatus === 'suppressed_internal') {
            if (op.kind === 'comment' && firstCommentHandledByProgressComment) {
              firstCommentHandledByProgressComment = false;
            }
            if (op.kind === 'pr') {
              const externalRef = existingOutput.deliveryAttempts[0]?.externalRef;
              if (externalRef) {
                previousValues.prUrl = externalRef;
              }
            }
            continue;
          }

          const connectorTarget = resolveConnectorTarget(op, run);
          const visibility = readDeliveryVisibility(op);
          if (existingOutput?.deliveryStatus === 'in_flight') {
            try {
              const reconciliation = await reconcileInFlightOutput({
                actionOutput: existingOutput,
                codeHostTarget: connectorTarget,
                firstCommentHandledByProgressComment,
                op,
                run,
                sourceTarget,
              });
              Object.assign(previousValues, reconciliation.producedValues);
              await createReconciliationAttempt({
                actionOutputId: existingOutput.id as string,
                destinationId: connectorTarget.connectorId,
                destinationType: connectorTarget.kind,
                externalRef: reconciliation.externalRef,
                response: {
                  reconciled: reconciliation.reconciled,
                  retryDisposition: 'skipped_existing_in_flight',
                },
                tenantId: run.tenantId,
                workflowRunId: run.id,
              });
              await prisma.actionOutput.update({
                where: { id: existingOutput.id as string },
                data: {
                  deliveryStatus: 'sent',
                  payload: op as unknown as object,
                  summary: buildOutputSummary(op),
                },
              });
              persisted += 1;
              if (op.kind === 'comment' && firstCommentHandledByProgressComment) {
                firstCommentHandledByProgressComment = false;
              }
              continue;
            } catch (error) {
              await prisma.actionDeliveryAttempt.create({
                data: {
                  tenantId: run.tenantId,
                  workflowRunId: run.id,
                  actionOutputId: existingOutput.id as string,
                  destinationType: connectorTarget.kind,
                  destinationId: connectorTarget.connectorId,
                  status: 'failed',
                  attemptNumber: 1,
                  error: error instanceof Error ? error.message : String(error),
                  completedAt: new Date(),
                },
              });
              await prisma.actionOutput.update({
                where: { id: existingOutput.id as string },
                data: {
                  deliveryStatus: 'failed',
                  payload: op as unknown as object,
                  summary: buildOutputSummary(op),
                },
              });
              persisted += 1;
              skipRemainingOps = true;
              continue;
            }
          }

          const actionOutput = existingOutput
            ? await prisma.actionOutput.update({
                where: { id: existingOutput.id },
                data: {
                  deliveryStatus: visibility === 'internal' ? 'suppressed_internal' : 'in_flight',
                  payload: op as unknown as object,
                  summary: buildOutputSummary(op),
                },
              })
            : await prisma.actionOutput.create({
                data: {
                  tenantId: run.tenantId,
                  workflowRunId: run.id,
                  idempotencyKey,
                  outputType: op.kind,
                  deliveryStatus: visibility === 'internal' ? 'suppressed_internal' : 'in_flight',
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
            skipRemainingOps = true;
          }
        }
      }

      return { persisted, dispatched };
    },
  };
}

export type DeliveryResolverService = ReturnType<typeof createDeliveryResolverService>;
