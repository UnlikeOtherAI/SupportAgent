import path from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { seedBuiltinExecutors } from './seed-builtin-executors.js';

type MigrationExecutorKey =
  | 'triage-default'
  | 'pr-review-default'
  | 'merge-default'
  | 'build-default';

type MigrationStatus = 'migrated' | 'requires_manual_review';

type LegacyStepKind = 'triage' | 'pr-review' | 'review' | 'merge' | 'build';

interface ScenarioStepRecord {
  id: string;
  stepType: string;
  config: unknown;
}

interface MigrationSummary {
  total: number;
  migrated: number;
  manualReview: number;
  skipped: number;
}

interface MigrateScenariosOptions {
  builtinExecutorsDir?: string;
  seedExecutors?: (tx: Prisma.TransactionClient, builtinDir: string) => Promise<unknown>;
  log?: Pick<Console, 'log'>;
}

const DEFAULT_TASK_PROMPTS: Record<MigrationExecutorKey, string> = {
  'triage-default': 'Investigate the issue described in {{trigger.issue.title}} and {{trigger.issue.url}}.',
  'pr-review-default': 'Review the pull request at {{trigger.pull_request.url}} for correctness and risk.',
  'merge-default': 'Assess whether {{trigger.pull_request.url}} is ready to merge now.',
  'build-default': 'Implement the requested fix for {{trigger.issue.title}} and prepare the change for review.',
};

const ACTION_SOURCE_KEY_TO_STEP_KIND: Record<string, LegacyStepKind> = {
  'workflow.triage': 'triage',
  'workflow.build': 'build',
  'workflow.review': 'review',
  'workflow.merge': 'merge',
};

const LEGACY_STEP_MAPPINGS: Record<LegacyStepKind, MigrationExecutorKey> = {
  triage: 'triage-default',
  'pr-review': 'pr-review-default',
  review: 'pr-review-default',
  merge: 'merge-default',
  build: 'build-default',
};

const MANUAL_REVIEW_EXECUTOR_KEYS = new Set<MigrationExecutorKey>(['build-default']);
const HAND_TUNED_PRESENCE_KEYS = new Set([
  'promptOverride',
  'customPrompt',
  'systemPromptOverride',
  'skillOverride',
]);
const NON_EMPTY_COLLECTION_KEYS = new Set(['cliArgs', 'customLabels']);

export async function migrateScenariosToExecutors(
  prisma: PrismaClient,
  options: MigrateScenariosOptions = {},
): Promise<MigrationSummary> {
  const builtinExecutorsDir =
    options.builtinExecutorsDir
    ?? path.resolve(__dirname, '../../../packages/executors/builtin');
  const seedExecutors = options.seedExecutors ?? seedBuiltinExecutors;

  const summary = await prisma.$transaction(async (tx) => {
    await seedExecutors(tx, builtinExecutorsDir);

    const steps = await tx.workflowScenarioStep.findMany({
      orderBy: [{ createdAt: 'asc' }, { stepOrder: 'asc' }],
      select: { id: true, stepType: true, config: true },
    });

    const nextSummary: MigrationSummary = {
      total: steps.length,
      migrated: 0,
      manualReview: 0,
      skipped: 0,
    };

    for (const step of steps) {
      const decision = buildMigrationDecision(step);

      if (decision.type === 'skip') {
        nextSummary.skipped += 1;
        continue;
      }

      await tx.workflowScenarioStep.update({
        where: { id: step.id },
        data: {
          config: decision.config as Prisma.InputJsonValue,
        },
      });

      if (decision.status === 'migrated') {
        nextSummary.migrated += 1;
      } else {
        nextSummary.manualReview += 1;
      }
    }

    return nextSummary;
  });

  options.log?.log(JSON.stringify(summary));
  return summary;
}

export function buildMigrationDecision(
  step: ScenarioStepRecord,
):
  | { type: 'skip' }
  | { type: 'update'; status: MigrationStatus; config: Record<string, unknown> } {
  const stepKind = detectLegacyStepKind(step);
  if (!stepKind) {
    return { type: 'skip' };
  }

  const config = asRecord(step.config);
  if (!config) {
    return { type: 'skip' };
  }

  if (typeof config.executorKey === 'string' && config.executorKey.trim() !== '') {
    return { type: 'skip' };
  }

  const executorKey = LEGACY_STEP_MAPPINGS[stepKind];
  const nextConfig: Record<string, unknown> = { ...config };
  const hasHandTunedFields = containsHandTunedFields(config);

  if (hasHandTunedFields) {
    nextConfig.migration_status = 'requires_manual_review';
    return { type: 'update', status: 'requires_manual_review', config: nextConfig };
  }

  if (executorKey === 'build-default') {
    nextConfig.migration_status = 'requires_manual_review';
    nextConfig.migration_note =
      'no builtin build-default.yaml exists yet — route to a USER executor after cloning one';
    return { type: 'update', status: 'requires_manual_review', config: nextConfig };
  }

  nextConfig.executorKey = executorKey;
  nextConfig.taskPrompt = readTaskPrompt(config) ?? DEFAULT_TASK_PROMPTS[executorKey];
  nextConfig.migration_status = MANUAL_REVIEW_EXECUTOR_KEYS.has(executorKey)
    ? 'requires_manual_review'
    : 'migrated';

  return {
    type: 'update',
    status: nextConfig.migration_status as MigrationStatus,
    config: nextConfig,
  };
}

export function containsHandTunedFields(value: unknown): boolean {
  return walkConfig(value, []);
}

function walkConfig(value: unknown, pathSegments: string[]): boolean {
  if (Array.isArray(value)) {
    return value.some((entry, index) => walkConfig(entry, [...pathSegments, String(index)]));
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (HAND_TUNED_PRESENCE_KEYS.has(key)) {
      return true;
    }

    if ((key.startsWith('override_') || key.startsWith('custom_')) && pathSegments.length >= 0) {
      return true;
    }

    if (NON_EMPTY_COLLECTION_KEYS.has(key)) {
      if (Array.isArray(nestedValue) && nestedValue.length > 0) {
        return true;
      }

      if (nestedValue && typeof nestedValue === 'object' && Object.keys(nestedValue).length > 0) {
        return true;
      }
    }

    if (walkConfig(nestedValue, [...pathSegments, key])) {
      return true;
    }
  }

  return false;
}

function detectLegacyStepKind(step: ScenarioStepRecord): LegacyStepKind | null {
  if (step.stepType in LEGACY_STEP_MAPPINGS) {
    return step.stepType as LegacyStepKind;
  }

  if (step.stepType !== 'action') {
    return null;
  }

  const config = asRecord(step.config);
  const designer = asRecord(config?.designer);
  const sourceKey = typeof designer?.sourceKey === 'string' ? designer.sourceKey : null;
  if (!sourceKey) {
    return null;
  }

  return ACTION_SOURCE_KEY_TO_STEP_KIND[sourceKey] ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readTaskPrompt(config: Record<string, unknown>): string | null {
  return typeof config.taskPrompt === 'string' && config.taskPrompt.trim() !== ''
    ? config.taskPrompt
    : null;
}

async function main() {
  const prisma = new PrismaClient();

  try {
    await migrateScenariosToExecutors(prisma, { log: console });
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1]
  && /migrate-scenarios-to-executors\.(?:ts|js)$/.test(process.argv[1])
) {
  main().catch((error) => {
    console.error('Failed to migrate workflow scenarios to executors', error);
    process.exit(1);
  });
}
