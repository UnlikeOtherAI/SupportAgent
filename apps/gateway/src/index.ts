import { parseEnv } from '@support-agent/config';
import { createQueueAdapter, QUEUE_NAMES } from '@support-agent/queue';
import { type WorkerJob } from '@support-agent/contracts';
import { ConnectionManager } from './ws/connection-manager.js';
import { buildGatewayApp } from './app.js';

async function main() {
  const env = parseEnv();
  const connections = new ConnectionManager();
  const app = await buildGatewayApp(connections);

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
