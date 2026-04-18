import { type FastifyInstance } from 'fastify';
import { resolveTenantId } from '../lib/resolve-tenant-id.js';
import { ExecutorService } from '../services/executor-service.js';

export async function executorRoutes(app: FastifyInstance) {
  const service = new ExecutorService(app.prisma);

  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  app.get('/', async (request) => {
    return service.list(resolveTenantId(request));
  });

  app.get<{ Params: { executorId: string } }>('/:executorId', async (request, reply) => {
    const executor = await service.getById(request.params.executorId, resolveTenantId(request));
    if (!executor) {
      return reply.status(404).send({ error: 'Executor not found' });
    }

    return executor;
  });

  app.post('/', async (request, reply) => {
    try {
      const executor = await service.clone(request.body, resolveTenantId(request));
      return reply.status(201).send(executor);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to clone executor';
      return reply.status(/already exists/i.test(message) ? 409 : 400).send({ error: message });
    }
  });

  app.put<{ Params: { executorId: string } }>('/:executorId', async (request, reply) => {
    try {
      const executor = await service.update(
        request.params.executorId,
        request.body,
        resolveTenantId(request),
      );

      if (!executor) {
        return reply.status(404).send({ error: 'User executor not found' });
      }

      return executor;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update executor';
      return reply.status(/already exists/i.test(message) ? 409 : 400).send({ error: message });
    }
  });
}
