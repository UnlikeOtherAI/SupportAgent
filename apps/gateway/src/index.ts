import { parseEnv } from '@support-agent/config';
import { createQueueAdapter, QUEUE_NAMES } from '@support-agent/queue';
import { type WorkerJob } from '@support-agent/contracts';
import { ConnectionManager } from './ws/connection-manager.js';
import { buildGatewayApp } from './app.js';

async function main() {
  const env = parseEnv();
  // The Prisma client used by the ConnectionManager comes from the Fastify
  // plugin, but `dispatchJob` runs from a queue processor that does not
  // sit on the request lifecycle. The cleanest fit is to build the app
  // first, then inject app.prisma into the manager.
  const { PrismaClient } = await import('@prisma/client');
  const sharedPrisma = new PrismaClient();
  await sharedPrisma.$connect();
  const connections = new ConnectionManager(sharedPrisma, {
    maxPayloadBytes: env.GATEWAY_WS_MAX_PAYLOAD_BYTES,
    pingIntervalMs: env.GATEWAY_WS_PING_INTERVAL_MS,
    idleTimeoutMs: env.GATEWAY_WS_IDLE_TIMEOUT_MS,
    msgRateLimitPerMin: env.GATEWAY_WS_MSG_RATE_LIMIT_PER_MIN,
    maxConnPerTenant: env.GATEWAY_WS_MAX_CONN_PER_TENANT,
  });
  const app = await buildGatewayApp(connections, { env });

  const queue = await createQueueAdapter(env.QUEUE_BACKEND, {
    redisUrl: env.REDIS_URL,
    gcpProjectId: env.GCP_PROJECT_ID,
  });

  const processor = queue.createProcessor<WorkerJob>(
    QUEUE_NAMES.WORKFLOW_JOBS,
    async (job, jobId) => {
      console.log(
        `[gateway] Received job ${jobId} type=${job.workflowType}, routing to worker`,
      );
      await connections.dispatchJob(job);
      console.log(`[gateway] Job ${jobId} dispatched to worker`);
    },
  );

  await app.listen({ port: env.GATEWAY_PORT, host: '0.0.0.0' });
  processor.start();

  console.log(`[gateway] Listening on port ${env.GATEWAY_PORT}`);
  console.log(`[gateway] Queue backend: ${env.QUEUE_BACKEND}`);
}

main().catch((err) => {
  console.error('Failed to start gateway:', err);
  process.exit(1);
});
