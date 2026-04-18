import { type PrismaClient } from '@prisma/client';
import { type WorkflowRunRepository } from '../repositories/workflow-run-repository.js';

const VALID_TRANSITIONS: Record<string, string[]> = {
  queued: ['blocked', 'dispatched', 'cancel_requested', 'canceled'],
  blocked: ['queued', 'cancel_requested', 'canceled'],
  dispatched: ['running', 'failed', 'lost', 'cancel_requested', 'canceled'],
  running: ['awaiting_review', 'awaiting_human', 'succeeded', 'failed', 'lost', 'cancel_requested', 'canceled'],
  cancel_requested: ['canceled', 'failed', 'lost'],
  awaiting_review: ['running', 'succeeded', 'failed', 'cancel_requested', 'canceled'],
  awaiting_human: ['running', 'cancel_requested', 'canceled'],
  failed: ['queued'],
  lost: ['queued'],
};

const CANCELABLE_STATUSES = [
  'queued',
  'blocked',
  'dispatched',
  'running',
  'awaiting_review',
  'awaiting_human',
  'cancel_requested',
] as const;

const TERMINAL_STATUSES = ['succeeded', 'failed', 'canceled', 'lost'] as const;

function assertValidTransition(from: string, to: string) {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    const err = new Error(`Invalid status transition: ${from} -> ${to}`);
    (err as any).statusCode = 409;
    throw err;
  }
}

export function createWorkflowRunService(
  repo: WorkflowRunRepository,
  prisma: PrismaClient,
) {
  return {
    async listRuns(filters: Parameters<typeof repo.list>[0]) {
      return repo.list(filters);
    },

    async getRun(id: string, tenantId: string) {
      const run = await repo.getById(id, tenantId);
      if (!run) {
        throw Object.assign(new Error('Workflow run not found'), { statusCode: 404 });
      }
      return run;
    },

    async listRunCheckpoints(id: string, tenantId: string) {
      await this.getRun(id, tenantId);
      return repo.listCheckpoints(id, tenantId);
    },

    async createRun(input: {
      tenantId: string;
      workflowType: string;
      workItemId: string;
      repositoryMappingId: string;
      executionProfileId?: string;
      orchestrationProfileId?: string;
      reviewProfileId?: string;
      workflowScenarioId?: string;
      parentWorkflowRunId?: string;
    }) {
      const workItem = await prisma.inboundWorkItem.findFirst({
        where: {
          id: input.workItemId,
          connector: { tenantId: input.tenantId },
        },
        select: { id: true },
      });
      if (!workItem) {
        throw Object.assign(new Error('Work item not found'), { statusCode: 400 });
      }

      const repoMapping = await prisma.repositoryMapping.findFirst({
        where: { id: input.repositoryMappingId, tenantId: input.tenantId },
        select: { id: true },
      });
      if (!repoMapping) {
        throw Object.assign(new Error('Repository mapping not found'), {
          statusCode: 400,
        });
      }

      return repo.create({
        tenantId: input.tenantId,
        workflowType: input.workflowType as any,
        status: 'queued',
        workItem: { connect: { id: input.workItemId } },
        repositoryMapping: { connect: { id: input.repositoryMappingId } },
        ...(input.executionProfileId && {
          executionProfile: { connect: { id: input.executionProfileId } },
        }),
        ...(input.orchestrationProfileId && {
          orchestrationProfileId: input.orchestrationProfileId,
        }),
        ...(input.reviewProfileId && {
          reviewProfileId: input.reviewProfileId,
        }),
        ...(input.workflowScenarioId && {
          workflowScenario: { connect: { id: input.workflowScenarioId } },
        }),
        ...(input.parentWorkflowRunId && {
          parentWorkflowRun: { connect: { id: input.parentWorkflowRunId } },
        }),
      });
    },

    async transitionStatus(
      id: string,
      tenantId: string,
      newStatus: string,
      extra?: Record<string, any>,
    ) {
      const run = await this.getRun(id, tenantId);
      assertValidTransition(run.status, newStatus);

      const updateExtra: Record<string, any> = { ...extra };
      // If retrying (failed/lost -> queued), increment attempt
      if ((run.status === 'failed' || run.status === 'lost') && newStatus === 'queued') {
        updateExtra.attemptNumber = run.attemptNumber + 1;
        updateExtra.startedAt = null;
        updateExtra.completedAt = null;
      }

      return repo.updateStatusConditional(id, run.status, newStatus, updateExtra);
    },

    async cancelRun(id: string, tenantId: string, force = false) {
      const run = await this.getRun(id, tenantId);
      if (TERMINAL_STATUSES.includes(run.status as (typeof TERMINAL_STATUSES)[number])) {
        throw Object.assign(
          new Error(`Cannot cancel run in status: ${run.status}`),
          { statusCode: 409 },
        );
      }

      if (force) {
        const forced = await repo.requestForceCancel(
          id,
          [...CANCELABLE_STATUSES],
          new Date(),
        );
        if (!forced) {
          throw Object.assign(new Error('Concurrent status change detected'), {
            statusCode: 409,
          });
        }
        if (forced.status !== 'cancel_requested') {
          const requested = await repo.requestCancel(id, [...CANCELABLE_STATUSES]);
          return requested ?? forced;
        }
        return forced;
      }

      if (run.status === 'cancel_requested') {
        return run;
      }

      const canceled = await repo.requestCancel(id, [...CANCELABLE_STATUSES]);
      if (!canceled) {
        throw Object.assign(new Error('Concurrent status change detected'), {
          statusCode: 409,
        });
      }

      return canceled;
    },

    async retryRun(id: string, tenantId: string) {
      const run = await this.getRun(id, tenantId);
      if (run.status !== 'failed' && run.status !== 'lost') {
        throw Object.assign(
          new Error(`Cannot retry run in status: ${run.status}`),
          { statusCode: 409 },
        );
      }
      return this.transitionStatus(id, tenantId, 'queued');
    },

    async updateStage(id: string, tenantId: string, stage: string) {
      await this.getRun(id, tenantId);
      return repo.updateStage(id, stage);
    },
  };
}

export type WorkflowRunService = ReturnType<typeof createWorkflowRunService>;
