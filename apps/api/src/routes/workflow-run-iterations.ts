import { SkillRunResultSchema } from '@support-agent/contracts';
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyWorkerAuth } from '../plugins/worker-auth.js';
import { createWorkerApiService } from '../services/worker-api-service.js';

const IterationStateBodySchema = z.object({
  iteration: z.number().int().positive(),
  stages: z.record(
    z.object({
      spawn_outputs: z.array(SkillRunResultSchema),
    }),
  ),
});

export async function workflowRunIterationRoutes(app: FastifyInstance) {
  const service = createWorkerApiService(app.prisma);

  app.addHook('onRequest', async (request) => {
    await verifyWorkerAuth(request, app);
  });

  app.post<{ Params: { runId: string } }>('/:runId/iterations', async (request, reply) => {
    if (request.workerDispatch?.workflowRunId !== request.params.runId) {
      throw Object.assign(new Error('Run ID mismatch'), { statusCode: 403 });
    }

    const body = IterationStateBodySchema.parse(request.body);
    await service.postIterationState(
      request.params.runId,
      request.workerDispatch.id,
      body,
    );

    return reply.status(204).send();
  });
}
