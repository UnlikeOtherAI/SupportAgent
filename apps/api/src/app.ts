import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { prismaPlugin } from './plugins/prisma.js';
import { errorHandler } from './plugins/error-handler.js';
import { authPlugin } from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { connectorRoutes } from './routes/connectors.js';
import { workflowRunRoutes } from './routes/workflow-runs.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(prismaPlugin);
  await app.register(authPlugin);
  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(connectorRoutes, { prefix: '/v1/connectors' });
  await app.register(workflowRunRoutes, { prefix: '/v1/runs' });

  return app;
}
