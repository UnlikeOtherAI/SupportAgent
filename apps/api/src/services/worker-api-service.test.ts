import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerApiService } from './worker-api-service.js';

const resolveDelivery = vi.fn();
const finalize = vi.fn();

vi.mock('./delivery-resolver-service.js', () => ({
  createDeliveryResolverService: () => ({
    resolveDelivery,
  }),
}));

vi.mock('./progress-comment-service.js', () => ({
  createProgressCommentService: () => ({
    finalize,
  }),
}));

function createPrismaMock() {
  return {
    workflowRun: {
      findUnique: vi.fn().mockResolvedValue({ acceptedDispatchAttempt: 'dispatch-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    workflowLogEvent: {
      create: vi.fn().mockResolvedValue(undefined),
    },
    finding: {
      create: vi.fn().mockResolvedValue(undefined),
    },
    workflowRunIteration: {
      create: vi.fn().mockResolvedValue(undefined),
    },
  } as any;
}

describe('createWorkerApiService.submitReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('synthesizes a comment from findings and persists one finding row per leaf', async () => {
    const prisma = createPrismaMock();
    const service = createWorkerApiService(prisma);

    await service.submitReport('run-1', 'dispatch-1', {
      status: 'succeeded',
      summary: 'Run summary',
      leafOutputs: [
        {
          delivery: [],
          findings: {
            summary: 'Summary',
            rootCause: 'Root cause',
            reproductionSteps: '1. Reproduce',
            proposedFix: '1. Fix it',
            affectedAreas: ['src/a.ts'],
            severity: 'high',
            confidence: 'medium',
            custom: {
              severityJustification: 'Breaks the main flow',
              confidenceReason: 'Code path matches the report',
              logsExcerpt: 'stack trace',
              sources: ['src/a.ts'],
            },
          },
          reportSummary: 'Leaf summary',
        },
      ],
    });

    expect(prisma.finding.create).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith(
      'run-1',
      expect.stringContaining('## Summary'),
    );
    expect(resolveDelivery).toHaveBeenCalledWith({
      workflowRunId: 'run-1',
      leafOutputs: [
        expect.objectContaining({
          delivery: [
            expect.objectContaining({
              kind: 'comment',
              body: expect.stringContaining('## Summary'),
            }),
          ],
        }),
      ],
    });
  });

  it('does nothing extra when findings are absent', async () => {
    const prisma = createPrismaMock();
    const service = createWorkerApiService(prisma);

    await service.submitReport('run-1', 'dispatch-1', {
      status: 'succeeded',
      summary: 'Run summary',
      leafOutputs: [
        {
          delivery: [],
          reportSummary: 'Leaf summary',
        },
      ],
    });

    expect(prisma.finding.create).not.toHaveBeenCalled();
    expect(resolveDelivery).toHaveBeenCalledWith({
      workflowRunId: 'run-1',
      leafOutputs: [
        {
          delivery: [],
          reportSummary: 'Leaf summary',
        },
      ],
    });
  });

  it('does not synthesize a comment when findings already have explicit delivery', async () => {
    const prisma = createPrismaMock();
    const service = createWorkerApiService(prisma);

    await service.submitReport('run-1', 'dispatch-1', {
      status: 'succeeded',
      summary: 'Run summary',
      leafOutputs: [
        {
          delivery: [{ kind: 'comment', body: 'Explicit comment body' }],
          findings: {
            summary: 'Summary',
          },
        },
      ],
    });

    expect(prisma.finding.create).toHaveBeenCalledTimes(1);
    expect(resolveDelivery).toHaveBeenCalledWith({
      workflowRunId: 'run-1',
      leafOutputs: [
        {
          delivery: [{ kind: 'comment', body: 'Explicit comment body' }],
          findings: {
            summary: 'Summary',
          },
        },
      ],
    });
  });

  it('finalizes the placeholder with the first public comment body', async () => {
    const prisma = createPrismaMock();
    const service = createWorkerApiService(prisma);

    await service.submitReport('run-1', 'dispatch-1', {
      status: 'succeeded',
      summary: 'Run summary',
      leafOutputs: [
        {
          delivery: [
            { kind: 'comment', body: 'Internal note', visibility: 'internal' },
            { kind: 'comment', body: 'Public note' },
          ],
        },
      ],
    });

    expect(finalize).toHaveBeenCalledWith('run-1', 'Public note');
  });

  it('uses a neutral placeholder message when only internal comments exist', async () => {
    const prisma = createPrismaMock();
    const service = createWorkerApiService(prisma);

    await service.submitReport('run-1', 'dispatch-1', {
      status: 'succeeded',
      summary: 'Run summary',
      leafOutputs: [
        {
          delivery: [
            { kind: 'comment', body: 'Internal note', visibility: 'internal' },
          ],
        },
      ],
    });

    expect(finalize).toHaveBeenCalledWith('run-1', 'Completed without public output.');
  });
});
