import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyWorkerAuth } from '../plugins/worker-auth.js';
import { createProgressCommentService } from '../services/progress-comment-service.js';

export async function workflowRunProgressCommentRoutes(app: FastifyInstance) {
  const progressCommentService = createProgressCommentService(app.prisma);

  app.addHook('onRequest', async (request) => {
    await verifyWorkerAuth(request, app);
  });

  app.post<{ Params: { runId: string } }>('/:runId/progress-comment', async (request, reply) => {
    if (request.workerDispatch?.workflowRunId !== request.params.runId) {
      throw Object.assign(new Error('Run ID mismatch'), { statusCode: 403 });
    }

    const body = z.object({ body: z.string().min(1) }).parse(request.body);
    await progressCommentService.updateProgress(request.params.runId, body.body);
    return reply.status(204).send();
  });
}
