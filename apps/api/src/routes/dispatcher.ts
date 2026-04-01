import { type FastifyInstance } from 'fastify';
import { createDispatcherService } from '../services/dispatcher-service.js';
import { createLocalHostProvider } from '../services/execution-provider.js';
import { createBullMQAdapter } from '../lib/queue.js';
import { getEnv } from '@support-agent/config';

export async function dispatcherRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    await request.authenticate();
    if (request.user.role !== 'admin' && request.user.role !== 'system') {
      throw Object.assign(new Error('Insufficient permissions'), { statusCode: 403 });
    }
  });

  const env = getEnv();
  const queue = createBullMQAdapter(env.REDIS_URL);
  const localProvider = createLocalHostProvider((name, payload) =>
    queue.enqueue(name, payload),
  );
  const dispatcher = createDispatcherService(app.prisma, [localProvider], env.API_BASE_URL);

  // Dispatch next queued run
  app.post('/dispatch-next', async (_request) => {
    const result = await dispatcher.dispatchNext();
    if (!result) return { status: 'idle', message: 'No queued runs' };
    return { status: 'dispatched', ...result };
  });

  // Dispatch all queued runs
  app.post('/dispatch-all', async (_request) => {
    const count = await dispatcher.dispatchAll();
    return { status: 'ok', dispatched: count };
  });
}
