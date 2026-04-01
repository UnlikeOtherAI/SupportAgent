import { type QueueAdapter } from './types.js';

export { type QueueAdapter, type QueueProcessor, QUEUE_NAMES } from './types.js';

export type QueueBackend = 'bullmq' | 'pubsub';

export async function createQueueAdapter(
  backend: QueueBackend,
  config: { redisUrl?: string; gcpProjectId?: string },
): Promise<QueueAdapter> {
  switch (backend) {
    case 'pubsub': {
      if (!config.gcpProjectId) {
        throw new Error('GCP_PROJECT_ID required for pubsub queue backend');
      }
      const { createPubSubAdapter } = await import('./pubsub.js');
      return createPubSubAdapter(config.gcpProjectId);
    }
    case 'bullmq':
    default: {
      if (!config.redisUrl) {
        throw new Error('REDIS_URL required for bullmq queue backend');
      }
      const { createBullMQAdapter } = await import('./bullmq.js');
      return createBullMQAdapter(config.redisUrl);
    }
  }
}
