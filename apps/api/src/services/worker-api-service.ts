import { type PrismaClient } from '@prisma/client';

export function createWorkerApiService(prisma: PrismaClient) {
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

    async postProgress(workflowRunId: string, stage: string, message: string) {
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

    async postLog(workflowRunId: string, streamType: string, message: string, stage?: string) {
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

    async uploadArtifact(workflowRunId: string, name: string, _data: Buffer) {
      // For now, store a reference. Real implementation would upload to GCS.
      const ref = `artifacts/${workflowRunId}/${name}`;
      // TODO: Upload to object storage
      return ref;
    },

    async submitReport(
      workflowRunId: string,
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
      const finalStatus = report.status === 'succeeded' ? 'succeeded' : 'failed';
      await prisma.workflowRun.update({
        where: { id: workflowRunId },
        data: {
          status: finalStatus as any,
          completedAt: new Date(),
        },
      });

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
