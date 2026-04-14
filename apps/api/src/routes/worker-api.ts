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

  function assertJobIdMatch(request: import('fastify').FastifyRequest<{ Params: { jobId: string } }>) {
    if (request.params.jobId !== request.workerDispatch!.id) {
      throw Object.assign(new Error('Job ID mismatch'), { statusCode: 403 });
    }
  }

  // Get job context
  app.get<{ Params: { jobId: string } }>('/:jobId/context', async (request) => {
    assertJobIdMatch(request);
    const runId = request.workerDispatch!.workflowRunId;
    return service.getJobContext(runId);
  });

  // Post progress
  app.post<{ Params: { jobId: string } }>('/:jobId/progress', async (request, reply) => {
    assertJobIdMatch(request);
    const body = z
      .object({ stage: z.string(), message: z.string() })
      .parse(request.body);
    await service.postProgress(
      request.workerDispatch!.workflowRunId,
      request.workerDispatch!.id,
      body.stage,
      body.message,
    );
    return reply.status(204).send();
  });

  // Post logs
  app.post<{ Params: { jobId: string } }>('/:jobId/logs', async (request, reply) => {
    assertJobIdMatch(request);
    const body = z
      .object({
        streamType: z.string(),
        message: z.string(),
        stage: z.string().optional(),
      })
      .parse(request.body);
    await service.postLog(
      request.workerDispatch!.workflowRunId,
      request.workerDispatch!.id,
      body.streamType,
      body.message,
      body.stage,
    );
    return reply.status(204).send();
  });

  // Upload artifact
  app.post<{ Params: { jobId: string } }>('/:jobId/artifacts', async (request) => {
    assertJobIdMatch(request);
    const name = (request.headers['x-artifact-name'] as string) ?? 'unnamed';
    const data = request.body as Buffer;
    const artifactRef = await service.uploadArtifact(
      request.workerDispatch!.workflowRunId,
      request.workerDispatch!.id,
      name,
      data,
    );
    return { artifactRef };
  });

  // Submit final report
  app.post<{ Params: { jobId: string } }>('/:jobId/report', async (request) => {
    assertJobIdMatch(request);
    const body = z
      .object({
        status: z.enum(['succeeded', 'failed']),
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
    return service.submitReport(
      request.workerDispatch!.workflowRunId,
      request.workerDispatch!.id,
      body,
    );
  });

  // ── Worker-accessible run data routes ─────────────────────────────────

  // GET /worker/jobs/:jobId/run — get current job's run details
  app.get<{ Params: { jobId: string } }>('/:jobId/run', async (request) => {
    assertJobIdMatch(request);
    const run = await app.prisma.workflowRun.findUnique({
      where: { id: request.workerDispatch!.workflowRunId },
      include: {
        workItem: true,
        repositoryMapping: true,
        parentWorkflowRun: true,
      },
    });
    return run;
  });

  // GET /worker/run/:runId — get any run by ID (worker auth only, no JWT)
  app.get<{ Params: { runId: string } }>('/run/:runId', async (request) => {
    const run = await app.prisma.workflowRun.findUnique({
      where: { id: request.params.runId },
      include: {
        workItem: true,
        repositoryMapping: true,
        parentWorkflowRun: true,
      },
    });
    return run ?? { error: 'not_found' };
  });

  // GET /worker/jobs/:jobId/run/findings — get findings for the parent triage run
  app.get<{ Params: { jobId: string; runId: string } }>('/:jobId/run/:runId/findings', async (request) => {
    // Allow workers to look up any run's findings (for build/merge to find triage findings)
    const findings = await app.prisma.finding.findMany({
      where: { workflowRunId: request.params.runId },
      orderBy: { createdAt: 'desc' },
    });
    return findings;
  });

  // POST /worker/jobs/:jobId/findings — submit findings for this run
  app.post<{ Params: { jobId: string } }>('/:jobId/findings', async (request, reply) => {
    assertJobIdMatch(request);
    const body = z.object({
      summary: z.string().min(1),
      rootCauseHypothesis: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
      reproductionStatus: z.string().optional(),
      affectedAreas: z.unknown().optional(),
      evidenceRefs: z.unknown().optional(),
      recommendedNextAction: z.string().optional(),
      suspectFiles: z.unknown().optional(),
    }).parse(request.body);

    const finding = await app.prisma.finding.create({
      data: {
        workflowRunId: request.workerDispatch!.workflowRunId,
        summary: body.summary,
        rootCauseHypothesis: body.rootCauseHypothesis,
        confidence: body.confidence ?? null,
        reproductionStatus: body.reproductionStatus,
        affectedAreas: body.affectedAreas as any,
        evidenceRefs: body.evidenceRefs as any,
        recommendedNextAction: body.recommendedNextAction,
        suspectFiles: body.suspectFiles as any,
      },
    });
    return reply.status(201).send(finding);
  });

  // PATCH /worker/jobs/:jobId/run — update run metadata (e.g. PR reference)
  app.patch<{ Params: { jobId: string } }>('/:jobId/run', async (request) => {
    assertJobIdMatch(request);
    const body = z.object({
      providerExecutionRef: z.string().optional(),
      currentStage: z.string().optional(),
    }).parse(request.body);

    const run = await app.prisma.workflowRun.update({
      where: { id: request.workerDispatch!.workflowRunId },
      data: body,
    });
    return run;
  });
}
