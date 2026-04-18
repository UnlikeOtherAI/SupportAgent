import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createWorkflowRunRepository } from '../repositories/workflow-run-repository.js';
import { createWorkflowRunService } from '../services/workflow-run-service.js';

const CancelQuery = z.object({
  force: z.coerce.number().int().optional(),
});

export async function workflowRunControlRoutes(app: FastifyInstance) {
  const repo = createWorkflowRunRepository(app.prisma);
  const service = createWorkflowRunService(repo, app.prisma);

  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  app.get<{ Params: { runId: string } }>('/:runId/checkpoints', async (request) => {
    return service.listRunCheckpoints(request.params.runId, request.user.tenantId);
  });

  app.post<{ Params: { runId: string } }>('/:runId/cancel', async (request) => {
    const query = CancelQuery.parse(request.query ?? {});
    return service.cancelRun(request.params.runId, request.user.tenantId, query.force === 1);
  });
}
