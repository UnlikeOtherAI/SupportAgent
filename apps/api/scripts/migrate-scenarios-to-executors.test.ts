import { describe, expect, it, vi } from 'vitest';
import {
  buildMigrationDecision,
  migrateScenariosToExecutors,
} from './migrate-scenarios-to-executors.js';

describe('migrate-scenarios-to-executors', () => {
  it('maps each legacy step type to the expected executor key', () => {
    expectExecutorKey('triage', 'triage-default');
    expectExecutorKey('pr-review', 'pr-review-default');
    expectExecutorKey('review', 'pr-review-default');
    expectExecutorKey('merge', 'merge-default');
  });

  it('maps action designer source keys for current workflow scenarios', () => {
    const decision = buildMigrationDecision({
      id: 'step-action-triage',
      stepType: 'action',
      config: {
        designer: { sourceKey: 'workflow.triage' },
      },
    });

    expect(decision).toMatchObject({
      type: 'update',
      status: 'migrated',
      config: { executorKey: 'triage-default' },
    });
  });

  it('flags hand-tuned fields for manual review without overwriting executor config', () => {
    const decision = buildMigrationDecision({
      id: 'step-custom',
      stepType: 'triage',
      config: {
        promptOverride: 'Use the custom triage prompt',
        customLabels: ['p1'],
      },
    });

    expect(decision).toEqual({
      type: 'update',
      status: 'requires_manual_review',
      config: {
        promptOverride: 'Use the custom triage prompt',
        customLabels: ['p1'],
        migration_status: 'requires_manual_review',
      },
    });
  });

  it('flags build mappings for manual review because no builtin executor row exists yet', () => {
    const decision = buildMigrationDecision({
      id: 'step-build',
      stepType: 'build',
      config: {},
    });

    expect(decision).toMatchObject({
      type: 'update',
      status: 'requires_manual_review',
      config: {
        executorKey: 'build-default',
        migration_status: 'requires_manual_review',
      },
    });
  });

  it('returns the expected summary counts across migrated, manual-review, and skipped steps', async () => {
    const steps = [
      {
        id: 'step-1',
        stepType: 'triage',
        config: {},
      },
      {
        id: 'step-2',
        stepType: 'merge',
        config: {
          taskPrompt: 'Use the existing merge prompt verbatim',
        },
      },
      {
        id: 'step-3',
        stepType: 'review',
        config: {
          cliArgs: ['--dangerous'],
        },
      },
      {
        id: 'step-4',
        stepType: 'build',
        config: {},
      },
      {
        id: 'step-5',
        stepType: 'output',
        config: {},
      },
    ];

    const updatedConfigs = new Map<string, unknown>();
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
      workflowScenarioStep: {
        findMany: vi.fn(async () => steps),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { config: unknown } }) => {
          updatedConfigs.set(where.id, data.config);
          return {
            id: where.id,
            config: data.config,
          };
        }),
      },
    } as const;

    const summary = await migrateScenariosToExecutors(prisma as never, {
      builtinExecutorsDir: '/tmp/unused',
      seedExecutors: vi.fn(async () => undefined),
    });

    expect(summary).toEqual({
      total: 5,
      migrated: 2,
      manualReview: 2,
      skipped: 1,
    });
    expect(updatedConfigs.get('step-1')).toMatchObject({
      executorKey: 'triage-default',
      migration_status: 'migrated',
    });
    expect(updatedConfigs.get('step-2')).toMatchObject({
      executorKey: 'merge-default',
      taskPrompt: 'Use the existing merge prompt verbatim',
      migration_status: 'migrated',
    });
    expect(updatedConfigs.get('step-3')).toMatchObject({
      cliArgs: ['--dangerous'],
      migration_status: 'requires_manual_review',
    });
    expect(updatedConfigs.get('step-4')).toMatchObject({
      executorKey: 'build-default',
      migration_status: 'requires_manual_review',
    });
  });
});

function expectExecutorKey(stepType: string, executorKey: string) {
  const decision = buildMigrationDecision({
    id: `step-${stepType}`,
    stepType,
    config: {},
  });

  expect(decision).toMatchObject({
    type: 'update',
    config: {
      executorKey,
    },
  });
}
