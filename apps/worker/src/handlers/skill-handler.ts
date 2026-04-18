import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Prisma, SkillRole } from '@prisma/client';
import { type SkillRunResult, type WorkerJob } from '@support-agent/contracts';
import {
  type ResolvedExecutor,
  type ResolvedStageAst,
  parseExecutorYaml,
  validateExecutor,
} from '@support-agent/executors-runtime';
import {
  CanceledError,
  findTemplatePlaceholders,
  type RuntimeResolvedStageAst,
  composePrompt,
  runWithLoop,
  substitutePlaceholders,
} from '@support-agent/skills-executor-runtime';
import { loadSkillFromRow } from '@support-agent/skills-runtime';
import { getExecutorByKey, runWithJsonOutput, type Executor } from '../executors/index.js';
import { type WorkerApiClient } from '../lib/api-client.js';
import {
  clearDispatchAbortController,
  clearDispatchControl,
  isDispatchCancelRequested,
  isDispatchForceCanceled,
  registerActiveChildProcess,
  registerDispatchAbortController,
  requestDispatchCancel,
} from '../lib/dispatch-control.js';
import {
  createSkillRunResultSchema,
  createTemplateFromJsonSchema,
} from '../lib/skill-run-result-json-schema.js';

export interface SkillHandlerOptions {
  executor?: Executor;
}

// TODO: This runner still executes in a fresh temp dir without a repo checkout.
// Build- or code-reading skills may require a checked-out repository once the
// local orchestrator path is defined clearly enough to implement it here.

type SkillManifestEntry = NonNullable<WorkerJob['resolvedSkillManifest']>[number];
type SkillFetchEntry = NonNullable<WorkerJob['skillFetches']>[number];
type SkillRow = {
  name: string;
  description: string;
  role: SkillRole;
  body: string;
  outputSchema: Prisma.JsonValue | null;
  contentHash: string;
};
type ExecutorRow = {
  key: string;
  yaml: string;
  contentHash: string;
};
type RuntimeResolvedExecutor = ResolvedExecutor & { stages: RuntimeResolvedStageAst[] };

const CANCEL_POLL_INTERVAL_MS = 2_000;

type WorkerJobWithContext = WorkerJob & {
  workItem?: {
    externalUrl?: string | null;
    title?: string | null;
    body?: string | null;
  };
  repositoryMapping?: {
    repositoryUrl?: string | null;
  };
  providerHints?: Record<string, unknown>;
};

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseRepositoryFullName(repositoryUrl: string): string {
  const normalized = repositoryUrl.endsWith('.git')
    ? repositoryUrl.slice(0, -4)
    : repositoryUrl;
  const match = normalized.match(/github\.com[:/](.+?)\/(.+)$/);
  return match ? `${match[1]}/${match[2]}` : normalized;
}

function buildPromptContext(job: WorkerJobWithContext): Record<string, unknown> {
  const providerHints = readRecord(job.providerHints);
  const triggerContext = readRecord(providerHints.triggerContext);
  const actionConfig = readRecord(providerHints.actionConfig);
  const workItem = readRecord(job.workItem);
  const repositoryUrl =
    typeof job.repositoryMapping?.repositoryUrl === 'string'
      ? job.repositoryMapping.repositoryUrl
      : job.targetRepo;
  const repositoryFullName = repositoryUrl ? parseRepositoryFullName(repositoryUrl) : '';
  const issueUrl = typeof providerHints.issueRef === 'string'
    ? providerHints.issueRef
    : workItem.externalUrl;
  const prUrl = typeof providerHints.prRef === 'string'
    ? providerHints.prRef
    : workItem.externalUrl;
  const pullRequestTitle =
    typeof triggerContext.title === 'string'
      ? triggerContext.title
      : typeof workItem.title === 'string'
        ? workItem.title
        : undefined;
  const pullRequestBody =
    typeof triggerContext.body === 'string'
      ? triggerContext.body
      : typeof workItem.body === 'string'
        ? workItem.body
        : undefined;

  return {
    action: actionConfig,
    job: {
      id: job.jobId,
    },
    repository: {
      fullName: repositoryFullName,
      url: repositoryUrl,
    },
    run: {
      id: job.workflowRunId,
    },
    trigger: {
      ...(readRecord((job as Record<string, unknown>).trigger)),
      issue: {
        url: issueUrl,
        title: typeof workItem.title === 'string' ? workItem.title : undefined,
        body: typeof workItem.body === 'string' ? workItem.body : undefined,
      },
      pull_request: {
        url: prUrl,
        title: pullRequestTitle,
        body: pullRequestBody,
      },
      repository: {
        fullName: repositoryFullName,
        url: repositoryUrl,
      },
    },
  };
}

async function warnOnMissingPlaceholders(
  api: WorkerApiClient,
  jobId: string,
  template: string,
  context: Record<string, unknown>,
): Promise<void> {
  const missing = findTemplatePlaceholders(template).filter((placeholder) => {
    const substituted = substitutePlaceholders(`{{${placeholder}}}`, context);
    return substituted === `{{${placeholder}}}`;
  });

  for (const placeholder of missing) {
    await api.postLog(
      jobId,
      'stderr',
      `[skill] Missing placeholder context for {{${placeholder}}}; leaving token intact`,
    );
  }
}

async function postCheckpointWithRetry(
  api: WorkerApiClient,
  jobId: string,
  dispatchAttemptId: string,
  payload: {
    kind: 'stage_complete' | 'iteration_complete';
    stageId?: string;
    iteration?: number;
    payload: SkillRunResult[];
  },
): Promise<void> {
  try {
    await api.postCheckpoint(dispatchAttemptId, payload);
    return;
  } catch (error) {
    try {
      await api.postLog(
        jobId,
        'stderr',
        `[skill] Checkpoint post failed (${payload.kind}); retrying once: ${error instanceof Error ? error.message : String(error)}`,
      );
    } catch (logError) {
      console.warn('[skill] Failed to log checkpoint retry warning', logError);
    }
  }

  try {
    await api.postCheckpoint(dispatchAttemptId, payload);
  } catch (error) {
    try {
      await api.postLog(
        jobId,
        'stderr',
        `[skill] Checkpoint post failed after retry (${payload.kind}); continuing without persisted checkpoint: ${error instanceof Error ? error.message : String(error)}`,
      );
    } catch (logError) {
      console.warn('[skill] Failed to log final checkpoint failure', logError);
    }
  }
}

export async function handleSkillJob(
  job: WorkerJob,
  api: WorkerApiClient,
  options: SkillHandlerOptions = {},
): Promise<void> {
  const { jobId, workflowRunId, workflowType } = job;

  if (!job.executorKey || !job.executorRevisionHash) {
    throw new Error('Skill job requires executorKey and executorRevisionHash');
  }

  if (!job.resolvedSkillManifest || job.resolvedSkillManifest.length === 0) {
    throw new Error('Skill job requires resolvedSkillManifest');
  }

  await api.postProgress(jobId, 'skill_setup', `Loading executor ${job.executorKey}`);
  await api.postLog(
    jobId,
    'stdout',
    `[skill] Starting ${job.executorKey}@${job.executorRevisionHash} for run ${workflowRunId}`,
  );

  const executorRow = await loadExecutorRow(api, {
    key: job.executorKey,
    contentHash: job.executorRevisionHash,
    url: job.executorFetch?.url,
  });
  const skillRowsByName = await loadSkillRows(
    api,
    job.resolvedSkillManifest,
    job.skillFetches ?? [],
  );
  const resolvedExecutor = await resolveExecutor(executorRow, skillRowsByName);
  const workDir = await mkdtemp(join(tmpdir(), `support-agent-skill-${jobId}-`));
  const abortController = new AbortController();
  registerDispatchAbortController(jobId, abortController);
  const promptContext = buildPromptContext(job as WorkerJobWithContext);
  const actionConfig = readRecord((job as WorkerJobWithContext).providerHints?.actionConfig);

  try {
    for (const stage of resolvedExecutor.stages) {
      const runtimeStage = stage as RuntimeResolvedStageAst;
      const configuredTaskPrompt = typeof actionConfig.taskPrompt === 'string'
        && actionConfig.taskPrompt.trim() !== ''
        ? actionConfig.taskPrompt
        : runtimeStage.task_prompt;
      await warnOnMissingPlaceholders(api, jobId, configuredTaskPrompt, promptContext);
    }

    const buildStagePrompt = (
      stage: ResolvedStageAst,
      outputsByStage: Map<string, SkillRunResult[]>,
      iteration?: number,
      prevIterationOutputs?: Map<string, SkillRunResult[]>,
    ) => {
      const runtimeStage = stage as RuntimeResolvedStageAst;
      const configuredTaskPrompt = typeof actionConfig.taskPrompt === 'string'
        && actionConfig.taskPrompt.trim() !== ''
        ? actionConfig.taskPrompt
        : runtimeStage.task_prompt;
      return (
      composePrompt({
        executor: resolvedExecutor,
        stage: runtimeStage,
        taskPrompt: substitutePlaceholders(configuredTaskPrompt, promptContext),
        inputsByStage: outputsByStage,
        iteration,
        prevIterationOutputs,
      })
      );
    };

    const checkpointWriter = {
      writeCheckpoint: (args: {
        kind: 'stage_complete' | 'iteration_complete';
        stageId?: string;
        iteration?: number;
        payload: SkillRunResult[];
      }) => postCheckpointWithRetry(api, jobId, jobId, args),
    };

    const cancelChecker = createCancelChecker(api, jobId, workflowRunId);

    const result = await runWithLoop({
      executor: resolvedExecutor,
      buildStagePrompt,
      runStage: async (stage, stagePrompt) => {
        const runtimeStage = stage as RuntimeResolvedStageAst;
        const cliExecutor = options.executor ?? getExecutorByKey(stage.executor);
        const outputSchema = getStageOutputSchema(runtimeStage);
        const schema = createSkillRunResultSchema(outputSchema);
        const template = createTemplateFromJsonSchema(outputSchema);
        const outputPath = join(workDir, `${runtimeStage.id}-${crypto.randomUUID()}.json`);

        await api.postProgress(
          jobId,
          runtimeStage.id,
          `Running stage ${runtimeStage.id} with ${cliExecutor.key}`,
        );
        await api.postLog(
          jobId,
          'stdout',
          `[skill] stage=${runtimeStage.id} executor=${cliExecutor.key}`,
        );

        const stageResult = await runWithJsonOutput(cliExecutor, {
          promptBody: stagePrompt,
          schema,
          template,
          outputPath,
          cwd: workDir,
          timeoutMs: (job.timeoutSeconds ?? 3_600) * 1_000,
          onSpawn: (child: import('node:child_process').ChildProcess) =>
            registerActiveChildProcess(jobId, child),
        });

        await api.postLog(
          jobId,
          'stdout',
          `[skill] stage=${runtimeStage.id} completed with ${stageResult.delivery.length} delivery op(s)`,
        );

        return stageResult;
      },
      signal: abortController.signal,
      persistIteration: async (iteration, outputsByStage) => {
        const leafOutputs = outputsByStage.get(resolvedExecutor.leafStageId) ?? [];
        const stages = Object.fromEntries(
          Array.from(outputsByStage.entries()).map(([stageId, outputs]) => [
            stageId,
            { spawn_outputs: outputs },
          ]),
        );
        await api.postIterationState(workflowRunId, {
          iteration,
          stages,
        });
        await api.postProgress(
          jobId,
          'skill_iteration',
          `Completed iteration ${iteration} with ${leafOutputs.length} leaf output(s)`,
        );
      },
      cancelChecker,
      checkpointWriter,
    });

    const summary = summarizeOutputs(result.finalOutputs, 'Skill execution completed');
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType,
      status: 'succeeded',
      summary,
      stageResults: [
        {
          stage: 'skill_execution',
          status: 'passed',
          summary,
        },
      ],
      leafOutputs: result.finalOutputs,
    });
  } catch (error: unknown) {
    if (error instanceof CanceledError) {
      const summary = summarizeOutputs(error.preservedOutputs, 'Skill execution canceled');
      await api.postLog(
        jobId,
        'stdout',
        `[skill] Canceled with ${error.preservedOutputs.length} preserved output(s)`,
      );
      await api.submitReport(jobId, {
        workflowRunId,
        workflowType,
        status: 'canceled',
        summary,
        stageResults: [
          {
            stage: 'skill_execution',
            status: 'skipped',
            summary: 'Canceled at a checkpoint boundary',
          },
        ],
        leafOutputs: error.preservedOutputs,
      });
      return;
    }

    if (isDispatchForceCanceled(jobId)) {
      await api.postLog(
        jobId,
        'stdout',
        '[skill] Force cancel requested; terminating execution',
      );
      await api.submitReport(jobId, {
        workflowRunId,
        workflowType,
        status: 'canceled',
        summary: 'Skill execution force-canceled',
        stageResults: [
          {
            stage: 'skill_execution',
            status: 'skipped',
            summary: 'Force-canceled while a subprocess was active',
          },
        ],
        leafOutputs: [],
      });
      return;
    }

    await api.postLog(
      jobId,
      'stderr',
      `[skill] Execution failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    );
    throw error;
  } finally {
    clearDispatchAbortController(jobId);
    clearDispatchControl(jobId);
    await rm(workDir, { recursive: true, force: true });
  }
}

async function loadExecutorRow(
  api: WorkerApiClient,
  fetchTarget: { key: string; contentHash: string; url?: string },
): Promise<ExecutorRow> {
  return api.fetchExecutorByHash(
    fetchTarget.key,
    fetchTarget.contentHash,
    fetchTarget.url,
  );
}

async function loadSkillRows(
  api: WorkerApiClient,
  manifest: SkillManifestEntry[],
  skillFetches: SkillFetchEntry[],
): Promise<Map<string, SkillRow>> {
  const fetchesByName = new Map(skillFetches.map((entry) => [entry.name, entry]));
  const rows = await Promise.all(
    manifest.map(async (entry) => {
      const fetchTarget = fetchesByName.get(entry.name);
      if (fetchTarget && fetchTarget.contentHash !== entry.contentHash) {
        throw new Error(
          `Dispatch skill fetch hash mismatch for ${entry.name}: ${fetchTarget.contentHash} != ${entry.contentHash}`,
        );
      }

      const row = await api.fetchSkillByHash(entry.name, entry.contentHash, fetchTarget?.url);
      return [entry.name, row] as const;
    }),
  );

  return new Map(
    rows.map(([name, row]) => [
      name,
      {
        ...row,
        role: row.role as SkillRole,
        outputSchema: row.outputSchema as Prisma.JsonValue | null,
      },
    ]),
  );
}

async function resolveExecutor(
  executorRow: ExecutorRow,
  skillRowsByName: Map<string, SkillRow>,
): Promise<RuntimeResolvedExecutor> {
  const ast = parseExecutorYaml(executorRow.yaml, {
    sourceName: `${executorRow.key}@${executorRow.contentHash}`,
  });

  const validated = await validateExecutor(ast, {
    resolveSkill: async (name: string) => {
      const skill = skillRowsByName.get(name);
      if (!skill) {
        throw new Error(`Missing resolved skill body for ${name}`);
      }

      const loaded = loadSkillFromRow(skill);
      return {
        contentHash: skill.contentHash,
        role: loaded.role.toUpperCase(),
        outputSchema: loaded.outputSchema,
      };
    },
  });

  return {
    ...validated,
    stages: validated.stages.map((stage) => ({
      ...stage,
      resolvedSystemSkill: attachSkillBody(stage.resolvedSystemSkill.name, skillRowsByName),
      resolvedComplementarySkills: stage.resolvedComplementarySkills.map((skill) =>
        attachSkillBody(skill.name, skillRowsByName),
      ),
    })),
  };
}

function attachSkillBody(name: string, skillRowsByName: Map<string, SkillRow>) {
  const row = skillRowsByName.get(name);
  if (!row) {
    throw new Error(`Missing skill body for ${name}`);
  }

  const loaded = loadSkillFromRow(row);
  return {
    name,
    role: loaded.role.toUpperCase() as 'SYSTEM' | 'COMPLEMENTARY',
    contentHash: row.contentHash,
    body: loaded.body,
    outputSchema: loaded.outputSchema,
  };
}

function getStageOutputSchema(stage: RuntimeResolvedStageAst): Record<string, unknown> {
  const outputSchema = stage.resolvedSystemSkill.outputSchema;
  if (!outputSchema || typeof outputSchema !== 'object' || Array.isArray(outputSchema)) {
    throw new Error(`Stage ${stage.id} is missing a valid output schema`);
  }

  return outputSchema as Record<string, unknown>;
}

export function createCancelChecker(
  api: WorkerApiClient,
  dispatchAttemptId: string,
  workflowRunId: string,
) {
  let lastCheckedAt = 0;
  let lastCancelState: { cancelForceRequestedAt: string | null; status: string } | null = null;

  return async () => {
    if (isDispatchCancelRequested(dispatchAttemptId)) {
      return true;
    }

    const now = Date.now();
    if (now - lastCheckedAt < CANCEL_POLL_INTERVAL_MS) {
      return lastCancelState?.status === 'cancel_requested';
    }

    lastCheckedAt = now;
    lastCancelState = await api.getRunCancelState(workflowRunId);
    if (lastCancelState.cancelForceRequestedAt) {
      requestDispatchCancel(dispatchAttemptId, 'force');
      return true;
    }

    return lastCancelState.status === 'cancel_requested';
  };
}

function summarizeOutputs(outputs: SkillRunResult[], fallback: string): string {
  const reportSummary = outputs.find((output) => output.reportSummary)?.reportSummary;
  if (reportSummary) {
    return reportSummary;
  }

  const findingSummary = outputs.find((output) => output.findings?.summary)?.findings?.summary;
  if (findingSummary) {
    return findingSummary;
  }

  const commentBody = outputs
    .flatMap((output) => output.delivery)
    .find((operation) => operation.kind === 'comment');
  if (commentBody?.kind === 'comment') {
    return truncate(commentBody.body);
  }

  return fallback;
}

function truncate(value: string, maxLength = 240): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
