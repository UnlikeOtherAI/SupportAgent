import { SkillRunResultSchema } from '@support-agent/contracts';
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyWorkerAuth } from '../plugins/worker-auth.js';
import { createWorkerApiService } from '../services/worker-api-service.js';

const DispatchAttemptCheckpointBodySchema = z.object({
  kind: z.enum(['stage_complete', 'iteration_complete']),
  iteration: z.number().int().optional(),
  stageId: z.string().optional(),
  payload: z.array(SkillRunResultSchema),
});

export async function dispatchAttemptCheckpointRoutes(app: FastifyInstance) {
  const service = createWorkerApiService(app.prisma);

  app.addHook('onRequest', async (request) => {
    await verifyWorkerAuth(request, app);
  });

  app.post<{ Params: { id: string } }>('/:id/checkpoints', async (request, reply) => {
    if (request.params.id !== request.workerDispatch?.id) {
      throw Object.assign(new Error('Dispatch attempt mismatch'), { statusCode: 403 });
    }

    const body = DispatchAttemptCheckpointBodySchema.parse(request.body);
    await service.postCheckpoint(
      request.workerDispatch.workflowRunId,
      request.workerDispatch.id,
      body,
    );

    return reply.status(204).send();
  });
}
