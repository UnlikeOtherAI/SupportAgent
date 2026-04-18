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
  const runRecord = {
    acceptedDispatchAttempt: 'dispatch-1',
    repositoryMapping: {
      connector: {
        platformType: {
          key: 'github',
        },
      },
    },
    workItem: {
      platformType: 'github',
    },
  };
  return {
    workflowRun: {
      findUnique: vi.fn().mockImplementation(async (args?: { select?: Record<string, unknown> }) => {
        if (args?.select?.acceptedDispatchAttempt) {
          return { acceptedDispatchAttempt: runRecord.acceptedDispatchAttempt };
        }

        return runRecord;
      }),
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

  it('does not synthesize a comment when explicit delivery is already present', async () => {
    const prisma = createPrismaMock();
    const service = createWorkerApiService(prisma);

    await service.submitReport('run-1', 'dispatch-1', {
      status: 'succeeded',
      summary: 'Run summary',
      leafOutputs: [
        {
          delivery: [{ kind: 'comment', body: 'Explicit comment body' }],
        },
      ],
    });

    expect(prisma.finding.create).not.toHaveBeenCalled();
    expect(resolveDelivery).toHaveBeenCalledWith({
      workflowRunId: 'run-1',
      leafOutputs: [
        {
          delivery: [{ kind: 'comment', body: 'Explicit comment body' }],
        },
      ],
    });
  });

  it('does not mutate the original leaf output when synthesizing delivery from findings', async () => {
    const prisma = createPrismaMock();
    const service = createWorkerApiService(prisma);
    const originalLeafOutput = {
      delivery: [],
      findings: {
        summary: 'Summary',
      },
      extras: {
        marker: 'original',
      },
    } as const;

    await service.submitReport('run-1', 'dispatch-1', {
      status: 'succeeded',
      summary: 'Run summary',
      leafOutputs: [structuredClone(originalLeafOutput)],
    });

    expect(originalLeafOutput.delivery).toEqual([]);
    expect(originalLeafOutput.findings).toEqual({ summary: 'Summary' });
    expect(originalLeafOutput.extras).toEqual({ marker: 'original' });
  });

  it('renders findings for non-github platforms without throwing', async () => {
    const prisma = createPrismaMock();
    prisma.workflowRun.findUnique = vi.fn().mockImplementation(async (args?: { select?: Record<string, unknown> }) => {
      if (args?.select?.acceptedDispatchAttempt) {
        return { acceptedDispatchAttempt: 'dispatch-1' };
      }

      return {
        acceptedDispatchAttempt: 'dispatch-1',
        repositoryMapping: {
          connector: {
            platformType: {
              key: 'linear',
            },
          },
        },
        workItem: {
          platformType: 'linear',
        },
      };
    });
    const service = createWorkerApiService(prisma);

    await expect(
      service.submitReport('run-1', 'dispatch-1', {
        status: 'succeeded',
        summary: 'Run summary',
        leafOutputs: [
          {
            delivery: [],
            findings: {
              summary: 'Summary',
            },
          },
        ],
      }),
    ).resolves.toEqual({ status: 'accepted' });
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
