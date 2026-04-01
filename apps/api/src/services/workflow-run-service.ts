import { type WorkflowRunRepository } from '../repositories/workflow-run-repository.js';

const VALID_TRANSITIONS: Record<string, string[]> = {
  queued: ['blocked', 'dispatched', 'canceled'],
  blocked: ['queued', 'canceled'],
  dispatched: ['running', 'failed', 'lost', 'canceled'],
  running: ['awaiting_review', 'awaiting_human', 'succeeded', 'failed', 'lost', 'canceled'],
  awaiting_review: ['running', 'succeeded', 'failed', 'canceled'],
  awaiting_human: ['running', 'canceled'],
  failed: ['queued'],
  lost: ['queued'],
};

function assertValidTransition(from: string, to: string) {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    const err = new Error(`Invalid status transition: ${from} -> ${to}`);
    (err as any).statusCode = 409;
    throw err;
  }
}

export function createWorkflowRunService(repo: WorkflowRunRepository) {
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

      return repo.updateStatus(id, newStatus, updateExtra);
    },

    async cancelRun(id: string, tenantId: string) {
      return this.transitionStatus(id, tenantId, 'canceled');
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
