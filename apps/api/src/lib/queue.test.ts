import { describe, it, expect, afterAll } from 'vitest';
import Redis from 'ioredis';
import { createBullMQAdapter, QUEUE_NAMES } from './queue.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

let redisAvailable = false;
try {
  const r = new Redis(REDIS_URL);
  await r.ping();
  redisAvailable = true;
  await r.quit();
} catch {
  /* Redis not reachable — integration tests will be skipped */
}

describe.skipIf(!redisAvailable)('BullMQ Queue Adapter', () => {
  const adapter = createBullMQAdapter(REDIS_URL);
  const processors: Array<{ stop: () => Promise<void> }> = [];

  afterAll(async () => {
    for (const p of processors) {
      await p.stop();
    }
  });

  it('enqueues and processes a message', async () => {
    const testQueue = 'test-queue-' + Date.now();
    const received: unknown[] = [];

    const processor = adapter.createProcessor<{ value: number }>(
      testQueue,
      async (payload) => {
        received.push(payload);
      },
      { concurrency: 1 },
    );
    processors.push(processor);
    processor.start();

    const jobId = await adapter.enqueue(testQueue, { value: 42 });
    expect(jobId).toBeTruthy();

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ value: 42 });
  }, 10000);

  it('QUEUE_NAMES has expected values', () => {
    expect(QUEUE_NAMES.WORKFLOW_JOBS).toBe('workflow-jobs');
    expect(QUEUE_NAMES.OUTBOUND_DELIVERY).toBe('outbound-delivery');
  });
});
