import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyWorkerAuth } from '../plugins/worker-auth.js';
import { createWorkerApiService } from '../services/worker-api-service.js';

export async function workerApiRoutes(app: FastifyInstance) {
  const service = createWorkerApiService(app.prisma);

  // Worker auth hook (NOT JWT)
  app.addHook('onRequest', async (request) => {
    await verifyWorkerAuth(request, app);
  });

  // Get job context
  app.get<{ Params: { jobId: string } }>('/:jobId/context', async (request) => {
    const runId = request.workerDispatch!.workflowRunId;
    return service.getJobContext(runId);
  });

  // Post progress
  app.post<{ Params: { jobId: string } }>('/:jobId/progress', async (request, reply) => {
    const body = z
      .object({ stage: z.string(), message: z.string() })
      .parse(request.body);
    await service.postProgress(
      request.workerDispatch!.workflowRunId,
      body.stage,
      body.message,
    );
    return reply.status(204).send();
  });

  // Post logs
  app.post<{ Params: { jobId: string } }>('/:jobId/logs', async (request, reply) => {
    const body = z
      .object({
        streamType: z.string(),
        message: z.string(),
        stage: z.string().optional(),
      })
      .parse(request.body);
    await service.postLog(
      request.workerDispatch!.workflowRunId,
      body.streamType,
      body.message,
      body.stage,
    );
    return reply.status(204).send();
  });

  // Upload artifact
  app.post<{ Params: { jobId: string } }>('/:jobId/artifacts', async (request) => {
    const name = (request.headers['x-artifact-name'] as string) ?? 'unnamed';
    const data = request.body as Buffer;
    const artifactRef = await service.uploadArtifact(
      request.workerDispatch!.workflowRunId,
      name,
      data,
    );
    return { artifactRef };
  });

  // Submit final report
  app.post<{ Params: { jobId: string } }>('/:jobId/report', async (request) => {
    const body = z
      .object({
        status: z.string(),
        summary: z.string(),
        stageResults: z
          .array(
            z.object({
              stage: z.string(),
              status: z.string(),
              summary: z.string().optional(),
              durationMs: z.number().optional(),
            }),
          )
          .optional(),
        findingsRef: z.string().optional(),
      })
      .parse(request.body);
    return service.submitReport(request.workerDispatch!.workflowRunId, body);
  });
}
