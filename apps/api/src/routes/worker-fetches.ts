import { type FastifyInstance } from 'fastify';
import { verifyWorkerAuth } from '../plugins/worker-auth.js';
import { ExecutorService } from '../services/executor-service.js';
import { SkillService } from '../services/skill-service.js';

async function resolveWorkerTenantId(app: FastifyInstance, workflowRunId: string): Promise<string> {
  const run = await app.prisma.workflowRun.findUnique({
    where: { id: workflowRunId },
    select: { tenantId: true },
  });

  if (!run) {
    throw Object.assign(new Error('Workflow run not found'), { statusCode: 404 });
  }

  return run.tenantId;
}

export async function workerFetchRoutes(app: FastifyInstance) {
  const executorService = new ExecutorService(app.prisma);
  const skillService = new SkillService(app.prisma);

  app.addHook('onRequest', async (request) => {
    await verifyWorkerAuth(request, app);
  });

  app.get<{ Params: { key: string; contentHash: string } }>(
    '/executors/:key/by-hash/:contentHash',
    async (request, reply) => {
      const tenantId = await resolveWorkerTenantId(app, request.workerDispatch!.workflowRunId);
      const executor = await executorService.getByKeyAndHash(
        request.params.key,
        request.params.contentHash,
        tenantId,
      );

      if (!executor) {
        return reply.status(404).send({ error: 'Executor not found' });
      }

      return {
        key: executor.key,
        contentHash: executor.contentHash,
        yaml: executor.yaml,
        description: executor.description,
        source: executor.source,
        updatedAt: executor.updatedAt,
      };
    },
  );

  app.get<{ Params: { name: string; contentHash: string } }>(
    '/skills/:name/by-hash/:contentHash',
    async (request, reply) => {
      const tenantId = await resolveWorkerTenantId(app, request.workerDispatch!.workflowRunId);
      const skill = await skillService.getByNameAndHash(
        request.params.name,
        request.params.contentHash,
        tenantId,
      );

      if (!skill) {
        return reply.status(404).send({ error: 'Skill not found' });
      }

      return {
        name: skill.name,
        contentHash: skill.contentHash,
        description: skill.description,
        role: skill.role,
        body: skill.body,
        outputSchema: skill.outputSchema,
        source: skill.source,
        updatedAt: skill.updatedAt,
      };
    },
  );
}
