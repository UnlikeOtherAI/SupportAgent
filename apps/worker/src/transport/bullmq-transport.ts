import { Worker, type Job } from 'bullmq';
import { type WorkerJob } from '@support-agent/contracts';
import { type JobTransport } from './transport.js';

export function createBullMQTransport(
  redisUrl: string,
  concurrency = 1,
): JobTransport {
  let worker: Worker | null = null;

  return {
    start(handler) {
      worker = new Worker(
        'workflow-jobs',
        async (job: Job) => {
          console.log(
            `[bullmq] Received job ${job.id} type=${job.data.workflowType}`,
          );
          await handler(job.data as WorkerJob);
          console.log(`[bullmq] Completed job ${job.id}`);
        },
        {
          connection: { url: redisUrl },
          concurrency,
        },
      );

      worker.on('failed', (job, err) => {
        console.error(`[bullmq] Job ${job?.id} failed:`, err.message);
      });

      worker.on('ready', () => {
        console.log(
          '[bullmq] Ready and listening for jobs on queue: workflow-jobs',
        );
      });
    },

    async stop() {
      if (worker) {
        await worker.close();
        worker = null;
      }
    },
  };
}
