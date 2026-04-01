import { Queue, Worker, type Job } from 'bullmq';

export interface QueueAdapter {
  enqueue<T>(
    queueName: string,
    payload: T,
    opts?: { jobId?: string; priority?: number; delay?: number },
  ): Promise<string>;
  createProcessor<T>(
    queueName: string,
    handler: (payload: T, jobId: string) => Promise<void>,
    opts?: { concurrency?: number },
  ): QueueProcessor;
}

export interface QueueProcessor {
  start(): void;
  stop(): Promise<void>;
}

export function createBullMQAdapter(redisUrl: string): QueueAdapter {
  const connection = { url: redisUrl } as any;
  const queues = new Map<string, Queue>();

  function getOrCreateQueue(name: string): Queue {
    let queue = queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection });
      queues.set(name, queue);
    }
    return queue;
  }

  return {
    async enqueue<T>(
      queueName: string,
      payload: T,
      opts?: { jobId?: string; priority?: number; delay?: number },
    ): Promise<string> {
      const queue = getOrCreateQueue(queueName);
      const job = await queue.add(queueName, payload, {
        jobId: opts?.jobId,
        priority: opts?.priority,
        delay: opts?.delay,
      });
      return job.id!;
    },

    createProcessor<T>(
      queueName: string,
      handler: (payload: T, jobId: string) => Promise<void>,
      opts?: { concurrency?: number },
    ): QueueProcessor {
      let worker: Worker | null = null;

      return {
        start() {
          worker = new Worker(
            queueName,
            async (job: Job) => {
              await handler(job.data as T, job.id!);
            },
            {
              connection,
              concurrency: opts?.concurrency ?? 1,
            },
          );
        },
        async stop() {
          if (worker) {
            await worker.close();
            worker = null;
          }
        },
      };
    },
  };
}

export const QUEUE_NAMES = {
  WORKFLOW_JOBS: 'workflow-jobs',
  OUTBOUND_DELIVERY: 'outbound-delivery',
} as const;
