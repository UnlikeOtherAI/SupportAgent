import { type PrismaClient } from '@prisma/client';

export function createWorkerApiService(prisma: PrismaClient) {
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
      },
    ) {
      await assertAcceptedDispatchAttempt(workflowRunId, dispatchId);

      const finalStatus = report.status === 'succeeded' ? 'succeeded' : 'failed';
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
          message: report.summary,
        },
      });

      return { status: 'accepted' };
    },
  };
}

export type WorkerApiService = ReturnType<typeof createWorkerApiService>;
