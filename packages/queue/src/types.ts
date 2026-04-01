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

export const QUEUE_NAMES = {
  WORKFLOW_JOBS: 'workflow-jobs',
  OUTBOUND_DELIVERY: 'outbound-delivery',
} as const;
