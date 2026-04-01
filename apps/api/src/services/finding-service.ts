import { type FindingRepository } from '../repositories/finding-repository.js';
import { type PrismaClient } from '@prisma/client';

export function createFindingService(repo: FindingRepository, prisma: PrismaClient) {
  return {
    async listFindings(workflowRunId: string, tenantId: string) {
      const run = await prisma.workflowRun.findFirst({
        where: { id: workflowRunId, tenantId },
      });
      if (!run) throw Object.assign(new Error('Workflow run not found'), { statusCode: 404 });
      return repo.listByRunId(workflowRunId);
    },

    async getFinding(id: string) {
      const finding = await repo.getById(id);
      if (!finding) throw Object.assign(new Error('Finding not found'), { statusCode: 404 });
      return finding;
    },

    async createFinding(
      workflowRunId: string,
      tenantId: string,
      input: {
        summary: string;
        rootCauseHypothesis?: string;
        confidence?: number;
        reproductionStatus?: string;
        affectedAreas?: unknown;
        evidenceRefs?: unknown;
        recommendedNextAction?: string;
        outboundSummary?: string;
        suspectCommits?: unknown;
        suspectFiles?: unknown;
        userVisibleImpact?: string;
        designNotes?: string;
      },
    ) {
      const run = await prisma.workflowRun.findFirst({
        where: { id: workflowRunId, tenantId },
      });
      if (!run) throw Object.assign(new Error('Workflow run not found'), { statusCode: 404 });

      return repo.create({
        summary: input.summary,
        rootCauseHypothesis: input.rootCauseHypothesis,
        confidence: input.confidence,
        reproductionStatus: input.reproductionStatus,
        affectedAreas: input.affectedAreas ?? undefined,
        evidenceRefs: input.evidenceRefs ?? undefined,
        recommendedNextAction: input.recommendedNextAction,
        outboundSummary: input.outboundSummary,
        suspectCommits: input.suspectCommits ?? undefined,
        suspectFiles: input.suspectFiles ?? undefined,
        userVisibleImpact: input.userVisibleImpact,
        designNotes: input.designNotes,
        workflowRun: { connect: { id: workflowRunId } },
      });
    },
  };
}

export type FindingService = ReturnType<typeof createFindingService>;
