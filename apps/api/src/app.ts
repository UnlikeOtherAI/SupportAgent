import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { getEnv } from '@support-agent/config';
import { prismaPlugin } from './plugins/prisma.js';
import { errorHandler } from './plugins/error-handler.js';
import { authPlugin } from './plugins/auth.js';
import { workerAuthPlugin } from './plugins/worker-auth.js';
import { healthRoutes } from './routes/health.js';
import { connectorRoutes } from './routes/connectors.js';
import { workflowRunRoutes } from './routes/workflow-runs.js';
import { repositoryMappingRoutes } from './routes/repository-mappings.js';
import { workerApiRoutes } from './routes/worker-api.js';
import { webhookRoutes } from './routes/webhooks.js';
import { findingRunRoutes, findingDetailRoutes } from './routes/findings.js';
import {
  outboundDestinationRoutes,
  deliveryAttemptRunRoutes,
} from './routes/outbound-destinations.js';
import { dispatcherRoutes } from './routes/dispatcher.js';
import { authRoutes } from './routes/auth.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  const env = getEnv();

  // CORS: in production use CORS_ORIGIN + ADMIN_APP_URL; in dev allow all
  const hasConfiguredCorsOrigin =
    process.env.CORS_ORIGIN !== undefined || env.CORS_ORIGIN !== 'http://localhost:5173';
  let corsOrigin: string | string[] | boolean;
  if (hasConfiguredCorsOrigin) {
    const origins = [env.CORS_ORIGIN];
    if (env.ADMIN_APP_URL && env.ADMIN_APP_URL !== env.CORS_ORIGIN) {
      origins.push(env.ADMIN_APP_URL);
    }
    corsOrigin = origins;
  } else {
    corsOrigin = env.NODE_ENV === 'production' ? false : true;
  }

  await app.register(cors, { origin: corsOrigin });
  await app.register(prismaPlugin);
  await app.register(authPlugin);
  await app.register(workerAuthPlugin);
  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.register(connectorRoutes, { prefix: '/v1/connectors' });
  await app.register(workflowRunRoutes, { prefix: '/v1/runs' });
  await app.register(findingRunRoutes, { prefix: '/v1/runs' });
  await app.register(deliveryAttemptRunRoutes, { prefix: '/v1/runs' });
  await app.register(findingDetailRoutes, { prefix: '/v1/findings' });
  await app.register(outboundDestinationRoutes, { prefix: '/v1/outbound-destinations' });
  await app.register(repositoryMappingRoutes, { prefix: '/v1/repository-mappings' });
  await app.register(
    async function workerScope(instance) {
      instance.addContentTypeParser(
        'application/octet-stream',
        { parseAs: 'buffer' },
        (_req, body, done) => {
          done(null, body);
        },
      );
      await instance.register(workerApiRoutes);
    },
    { prefix: '/worker/jobs' },
  );
  await app.register(dispatcherRoutes, { prefix: '/v1/dispatcher' });

  // Webhook routes use a custom JSON parser (parseAs: string) for signature
  // verification. Registered in an encapsulated scope so it does not affect
  // other routes.
  await app.register(
    async function webhookScope(instance) {
      instance.addContentTypeParser(
        'application/json',
        { parseAs: 'string' },
        (_req, body, done) => {
          done(null, body);
        },
      );
      await instance.register(webhookRoutes);
    },
    { prefix: '/webhooks' },
  );

  return app;
}
