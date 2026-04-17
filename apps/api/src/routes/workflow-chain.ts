import { type FastifyInstance } from 'fastify';
import { createWorkflowChainService } from '../services/workflow-chain-service.js';

export async function workflowChainRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    await request.authenticate();
    if (request.user.role !== 'admin' && request.user.role !== 'system') {
      throw Object.assign(new Error('Insufficient permissions'), { statusCode: 403 });
    }
  });

  const chain = createWorkflowChainService(app.prisma);

  // POST /v1/workflow-chain/chain-next — chain all pending transitions
  app.post('/chain-next', async () => {
    const result = await chain.chainAll();
    return {
      status: 'ok',
      triageChained: result.triageChained,
      buildChained: result.buildChained,
    };
  });

  // POST /v1/workflow-chain/trigger-build/:runId — chain triage → build for a specific run
  app.post<{ Params: { runId: string } }>('/trigger-build/:runId', async (request) => {
    const result = await chain.chainTriageToBuild(request.params.runId);
    if (!result) {
      return { status: 'skipped', message: 'Run not eligible for chaining' };
    }
    return { status: 'chained', buildRunId: result.buildRunId };
  });

  // POST /v1/workflow-chain/trigger-merge/:runId — chain build → merge for a specific run
  // Bypasses the autoMergeOnSuccess gate — this is an explicit operator action.
  app.post<{ Params: { runId: string } }>('/trigger-merge/:runId', async (request) => {
    const result = await chain.chainBuildToMerge(request.params.runId, { force: true });
    if (!result) {
      return { status: 'skipped', message: 'Run not eligible for chaining (no PR reference?)' };
    }
    return { status: 'chained', mergeRunId: result.mergeRunId };
  });

  // GET /v1/workflow-chain/status — summary of all pending chain items
  app.get('/status', async () => {
    const [pendingTriage, pendingBuild] = await Promise.all([
      app.prisma.workflowRun.findMany({
        where: {
          workflowType: 'triage',
          status: 'succeeded',
          childWorkflowRuns: { none: {} },
        },
        select: { id: true, workItemId: true, createdAt: true },
      }),
      app.prisma.workflowRun.findMany({
        where: {
          workflowType: 'build',
          status: 'succeeded',
          childWorkflowRuns: { none: {} },
          providerExecutionRef: { startsWith: 'pr:' },
        },
        select: { id: true, workItemId: true, providerExecutionRef: true, createdAt: true },
      }),
    ]);

    return {
      pendingTriageChain: pendingTriage.length,
      pendingBuildChain: pendingBuild.length,
      triageRuns: pendingTriage,
      buildRuns: pendingBuild,
    };
  });
}
