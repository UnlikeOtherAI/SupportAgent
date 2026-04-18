import { Prisma, type PrismaClient } from '@prisma/client';
import {
  type SkillRunResult,
  SkillRunResultSchema,
  type StructuredFindings,
} from '@support-agent/contracts';
import { createDeliveryResolverService } from './delivery-resolver-service.js';
import { renderFindingsToComment } from './findings-renderer-service.js';
import { createProgressCommentService } from './progress-comment-service.js';

function pickFinalCommentBody(summary: string, leafOutputs: SkillRunResult[]) {
  for (const output of leafOutputs) {
    const commentOp = output.delivery.find(
      (op) => op.kind === 'comment' && (op.visibility ?? 'public') !== 'internal',
    );
    if (commentOp?.kind === 'comment') {
      return commentOp.body;
    }
  }
  return leafOutputs.length > 0 ? 'Completed without public output.' : summary;
}

function confidenceToNumeric(confidence: StructuredFindings['confidence']): number | null {
  switch (confidence) {
    case 'low':
      return 0.3;
    case 'medium':
      return 0.6;
    case 'high':
      return 0.85;
    default:
      return null;
  }
}

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value as Prisma.InputJsonValue;
}

function synthesizeDeliveryFromFindings(leafOutput: SkillRunResult): SkillRunResult {
  if (leafOutput.delivery.length > 0 || !leafOutput.findings) {
    return leafOutput;
  }

  return {
    ...leafOutput,
    delivery: [
      {
        kind: 'comment',
        body: renderFindingsToComment(leafOutput.findings, 'github'),
      },
    ],
  };
}

function mapFindingsToRowData(leafOutput: SkillRunResult) {
  const findings = leafOutput.findings;
  if (!findings) {
    return null;
  }

  return {
    summary: findings.summary ?? leafOutput.reportSummary ?? 'No findings summary provided',
    rootCauseHypothesis: findings.rootCause ?? null,
    confidence: confidenceToNumeric(findings.confidence),
    reproductionStatus: null,
    affectedAreas: toJsonValue(findings.affectedAreas),
    evidenceRefs: toJsonValue(findings.custom),
    recommendedNextAction: findings.proposedFix ?? null,
    outboundSummary:
      leafOutput.delivery.length === 0
        ? renderFindingsToComment(findings, 'github')
        : null,
    suspectFiles: toJsonValue(findings.affectedAreas),
    userVisibleImpact: findings.summary ?? null,
    designNotes: null,
  };
}

export function createWorkerApiService(prisma: PrismaClient) {
  const deliveryResolver = createDeliveryResolverService(prisma);
  const progressCommentService = createProgressCommentService(prisma);

  async function assertAcceptedDispatchAttempt(workflowRunId: string, dispatchId: string) {
    const run = await prisma.workflowRun.findUnique({
      where: { id: workflowRunId },
      select: { acceptedDispatchAttempt: true },
    });
    if (!run) throw Object.assign(new Error('Run not found'), { statusCode: 404 });
    if (run.acceptedDispatchAttempt !== dispatchId) {
      throw Object.assign(new Error('Stale dispatch attempt'), { statusCode: 403 });
    }
  }

  return {
    async getJobContext(workflowRunId: string) {
      const run = await prisma.workflowRun.findUnique({
        where: { id: workflowRunId },
        include: {
          workItem: true,
          repositoryMapping: { include: { connector: true } },
          dispatches: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      if (!run) throw Object.assign(new Error('Run not found'), { statusCode: 404 });

      return {
        jobId: run.dispatches[0]?.id ?? run.id,
        workflowRunId: run.id,
        workflowType: run.workflowType,
        targetRepo: run.repositoryMapping?.repositoryUrl ?? '',
        targetBranch: run.repositoryMapping?.defaultBranch ?? 'main',
        executionProfile: 'analysis-only',
        workItem: run.workItem,
        repositoryMapping: run.repositoryMapping,
      };
    },

    async postProgress(
      workflowRunId: string,
      dispatchId: string,
      stage: string,
      message: string,
    ) {
      await assertAcceptedDispatchAttempt(workflowRunId, dispatchId);

      await prisma.workflowRun.update({
        where: { id: workflowRunId },
        data: { currentStage: stage },
      });

      await prisma.workflowLogEvent.create({
        data: {
          workflowRunId,
          timestamp: new Date(),
          streamType: 'progress',
          stage,
          message,
        },
      });
    },

    async postLog(
      workflowRunId: string,
      dispatchId: string,
      streamType: string,
      message: string,
      stage?: string,
    ) {
      await assertAcceptedDispatchAttempt(workflowRunId, dispatchId);

      await prisma.workflowLogEvent.create({
        data: {
          workflowRunId,
          timestamp: new Date(),
          streamType,
          stage,
          message,
        },
      });
    },

    async uploadArtifact(
      workflowRunId: string,
      dispatchId: string,
      name: string,
      _data: Uint8Array,
    ) {
      await assertAcceptedDispatchAttempt(workflowRunId, dispatchId);

      // For now, store a reference. Real implementation would upload to GCS.
      const ref = `artifacts/${workflowRunId}/${name}`;
      // TODO: Upload to object storage
      return ref;
    },

    async postCheckpoint(
      workflowRunId: string,
      dispatchId: string,
      checkpoint: {
        kind: 'stage_complete' | 'iteration_complete';
        iteration?: number;
        stageId?: string;
        payload: SkillRunResult[];
      },
    ) {
      await assertAcceptedDispatchAttempt(workflowRunId, dispatchId);

      await prisma.dispatchAttemptCheckpoint.create({
        data: {
          dispatchAttemptId: dispatchId,
          kind: checkpoint.kind,
          iteration: checkpoint.iteration ?? null,
          stageId: checkpoint.stageId ?? null,
          payload: checkpoint.payload as any,
        },
      });
    },

    async postIterationState(
      workflowRunId: string,
      dispatchId: string,
      iterationState: {
        iteration: number;
        stages: Record<string, { spawn_outputs: SkillRunResult[] }>;
      },
    ) {
      await assertAcceptedDispatchAttempt(workflowRunId, dispatchId);

      await prisma.workflowRunIteration.create({
        data: {
          workflowRunId,
          iteration: iterationState.iteration,
          stages: iterationState.stages as any,
        },
      });
    },

    async submitReport(
      workflowRunId: string,
      dispatchId: string,
      report: {
        status: string;
        summary: string;
        stageResults?: Array<{
          stage: string;
          status: string;
          summary?: string;
          durationMs?: number;
        }>;
        findingsRef?: string;
        leafOutputs?: SkillRunResult[];
      },
    ) {
      await assertAcceptedDispatchAttempt(workflowRunId, dispatchId);

      const finalStatus =
        report.status === 'succeeded'
          ? 'succeeded'
          : report.status === 'canceled'
            ? 'canceled'
            : 'failed';
      const updated = await prisma.workflowRun.updateMany({
        where: {
          id: workflowRunId,
          status: { notIn: ['succeeded', 'failed', 'canceled', 'lost'] },
        },
        data: {
          status: finalStatus as any,
          completedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        throw Object.assign(new Error('Run is already in a terminal state'), {
          statusCode: 409,
        });
      }

      await prisma.workflowLogEvent.create({
        data: {
          workflowRunId,
          timestamp: new Date(),
          streamType: 'report',
          stage: 'final',
          message: report.leafOutputs
            ? `${report.summary}\n\nleafOutputs=${JSON.stringify(report.leafOutputs)}`
            : report.summary,
        },
      });

      const parsedLeafOutputs = (report.leafOutputs ?? []).map((output) =>
        SkillRunResultSchema.parse(output),
      );
      const leafOutputs = parsedLeafOutputs.map(synthesizeDeliveryFromFindings);

      try {
        await progressCommentService.finalize(
          workflowRunId,
          pickFinalCommentBody(report.summary, leafOutputs),
        );
      } catch (error) {
        console.warn('[worker-api] Failed to finalize progress comment', {
          workflowRunId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      for (const leafOutput of parsedLeafOutputs) {
        const findingRowData = mapFindingsToRowData(leafOutput);
        if (!findingRowData) {
          continue;
        }

        await prisma.finding.create({
          data: {
            workflowRun: { connect: { id: workflowRunId } },
            ...findingRowData,
          },
        });
      }

      if (leafOutputs.length > 0 && finalStatus === 'succeeded') {
        await deliveryResolver.resolveDelivery({
          workflowRunId,
          leafOutputs,
        });
      }

      return { status: 'accepted' };
    },
  };
}

export type WorkerApiService = ReturnType<typeof createWorkerApiService>;
