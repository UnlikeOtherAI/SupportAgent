import { describe, it, expect } from 'vitest';
import { QUEUE_NAMES, createQueueAdapter } from './queue.js';

describe('Queue re-exports', () => {
  it('QUEUE_NAMES has expected values', () => {
    expect(QUEUE_NAMES.WORKFLOW_JOBS).toBe('workflow-jobs');
    expect(QUEUE_NAMES.OUTBOUND_DELIVERY).toBe('outbound-delivery');
  });

  it('createQueueAdapter is a function', () => {
    expect(typeof createQueueAdapter).toBe('function');
  });
});
