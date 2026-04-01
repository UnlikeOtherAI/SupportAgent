import { Worker } from 'bullmq';
import { parseEnv } from '@support-agent/config';
import { type WorkerJob } from '@support-agent/contracts';
import { processJob } from './worker.js';

const env = parseEnv();

const worker = new Worker(
  'workflow-jobs',
  async (job) => {
    console.log(`[worker] Received job ${job.id} type=${job.data.workflowType}`);
    await processJob(job.data as WorkerJob);
    console.log(`[worker] Completed job ${job.id}`);
  },
  {
    connection: { url: env.REDIS_URL },
    concurrency: 1,
  },
);

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err.message);
});

worker.on('ready', () => {
  console.log('[worker] Ready and listening for jobs on queue: workflow-jobs');
});

console.log('[worker] Starting...');
