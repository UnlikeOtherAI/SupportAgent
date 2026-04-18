import { type FastifyInstance } from 'fastify';
import { WorkflowRunStatus } from '@support-agent/contracts';
import { z } from 'zod';
import { createWorkflowRunRepository } from '../repositories/workflow-run-repository.js';
import { createDispatchCancelBroadcaster } from '../services/dispatch-cancel-broadcaster.js';
import { createWorkflowRunService } from '../services/workflow-run-service.js';

const ListQuerySchema = z
  .object({
    workflowType: z.enum(['triage', 'build', 'merge']).optional(),
    status: z.string().optional(),
    repositoryMappingId: z.string().uuid().optional(),
    workflowScenarioId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .partial();

const CreateRunBody = z.object({
  workflowType: z.enum(['triage', 'build', 'merge']),
  workItemId: z.string().uuid(),
  repositoryMappingId: z.string().uuid(),
  executionProfileId: z.string().uuid().optional(),
  orchestrationProfileId: z.string().uuid().optional(),
  reviewProfileId: z.string().uuid().optional(),
  workflowScenarioId: z.string().uuid().optional(),
  parentWorkflowRunId: z.string().uuid().optional(),
});

const TransitionBody = z.object({
  status: WorkflowRunStatus,
  blockedReason: z.string().optional(),
  providerExecutionRef: z.string().optional(),
  acceptedDispatchAttempt: z.string().uuid().optional(),
});

const CancelQuery = z.object({
  force: z.coerce.number().int().optional(),
});

export async function workflowRunRoutes(app: FastifyInstance) {
  const repo = createWorkflowRunRepository(app.prisma);
  const service = createWorkflowRunService(
    repo,
    app.prisma,
    createDispatchCancelBroadcaster(app.prisma, app.log),
  );

  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  // List runs
  app.get('/', async (request) => {
    const query = ListQuerySchema.parse(request.query);
    return service.listRuns({ tenantId: request.user.tenantId, ...query });
  });

  // Get run detail
  app.get<{ Params: { runId: string } }>('/:runId', async (request) => {
    return service.getRun(request.params.runId, request.user.tenantId);
  });

  // Create run
  app.post('/', async (request, reply) => {
    const body = CreateRunBody.parse(request.body);
    const run = await service.createRun({ tenantId: request.user.tenantId, ...body });
    return reply.status(201).send(run);
  });

  // Transition status
  app.post<{ Params: { runId: string } }>('/:runId/transition', async (request) => {
    const body = TransitionBody.parse(request.body);
    return service.transitionStatus(
      request.params.runId,
      request.user.tenantId,
      body.status,
      {
        blockedReason: body.blockedReason,
        providerExecutionRef: body.providerExecutionRef,
        acceptedDispatchAttempt: body.acceptedDispatchAttempt,
      },
    );
  });

  // Cancel run
  app.post<{ Params: { runId: string } }>('/:runId/cancel', async (request) => {
    const query = CancelQuery.parse(request.query ?? {});
    return service.cancelRun(request.params.runId, request.user.tenantId, query.force === 1);
  });

  // Retry run
  app.post<{ Params: { runId: string } }>('/:runId/retry', async (request) => {
    return service.retryRun(request.params.runId, request.user.tenantId);
  });
}
