import type { SkillRunResult } from '@support-agent/contracts';
import type { ResolvedExecutor, ResolvedStageAst } from '@support-agent/executors-runtime';
import {
  AbortError,
  CanceledError,
  FanOutFailureError,
  MultiLeafSafetyViolation,
  type BuildStagePromptFn,
  type CancelAwareRuntimeArgs,
  type RunStageFn,
  SchemaValidationError,
  type StageDagRunResult,
} from './types.js';

interface RunStageDagArgs {
  executor: ResolvedExecutor;
  buildStagePrompt: BuildStagePromptFn;
  runStage: RunStageFn;
  signal: AbortSignal;
  iteration?: number;
  prevIterationOutputs?: Map<string, SkillRunResult[]>;
  cancelChecker?: CancelAwareRuntimeArgs['cancelChecker'];
  checkpointWriter?: CancelAwareRuntimeArgs['checkpointWriter'];
}

interface StageExecutionResult {
  outputs: SkillRunResult[];
  errors: Error[];
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AbortError();
  }
}

function cloneOutputs(outputsByStage: Map<string, SkillRunResult[]>): Map<string, SkillRunResult[]> {
  return new Map(
    Array.from(outputsByStage.entries(), ([stageId, outputs]) => [
      stageId,
      outputs.map((output) => structuredClone(output)),
    ]),
  );
}

function topologicallySortStages(stages: ResolvedStageAst[]): ResolvedStageAst[] {
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const indegree = new Map(stages.map((stage) => [stage.id, stage.after.length]));
  const dependants = new Map<string, string[]>();

  for (const stage of stages) {
    for (const dependencyId of stage.after) {
      const next = dependants.get(dependencyId) ?? [];
      next.push(stage.id);
      dependants.set(dependencyId, next);
    }
  }

  const ready = stages.filter((stage) => indegree.get(stage.id) === 0).map((stage) => stage.id);
  const ordered: ResolvedStageAst[] = [];

  while (ready.length > 0) {
    ready.sort();
    const stageId = ready.shift()!;
    const stage = byId.get(stageId)!;
    ordered.push(stage);

    for (const dependantId of dependants.get(stageId) ?? []) {
      const nextIndegree = (indegree.get(dependantId) ?? 0) - 1;
      indegree.set(dependantId, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(dependantId);
      }
    }
  }

  if (ordered.length !== stages.length) {
    throw new Error('Executor stages contain a circular dependency');
  }

  return ordered;
}

function isConsolidatorStage(stage: ResolvedStageAst, executor: ResolvedExecutor): boolean {
  if (stage.parallel !== 1 || stage.after.length === 0) {
    return false;
  }

  const byId = new Map(executor.stages.map((candidate) => [candidate.id, candidate]));
  return stage.after.some((dependencyId) => (byId.get(dependencyId)?.parallel ?? 0) > 1);
}

function isSchemaValidationFailure(error: unknown): error is Error {
  return (
    error instanceof SchemaValidationError ||
    (error instanceof Error && error.name === 'ZodError')
  );
}

function resolveFanOutThreshold(stage: ResolvedStageAst, executor: ResolvedExecutor): number {
  if (stage.parallel <= 1) {
    return 1;
  }

  return executor.ast.guardrails?.fan_out_min_success_rate ?? 1;
}

function assertMultiLeafCommentOnly(stage: ResolvedStageAst, outputs: SkillRunResult[]): void {
  if (stage.parallel <= 1) {
    return;
  }

  outputs.forEach((output, spawnIndex) => {
    const offendingOp = output.delivery.find((op) => op.kind !== 'comment');
    if (offendingOp) {
      throw new MultiLeafSafetyViolation(stage.id, spawnIndex, offendingOp.kind);
    }
  });
}

async function executeStageOnce(
  stage: ResolvedStageAst,
  prompt: string,
  runStage: RunStageFn,
  signal: AbortSignal,
): Promise<StageExecutionResult> {
  throwIfAborted(signal);

  const settled = await Promise.allSettled(
    Array.from({ length: stage.parallel }, () => runStage(stage, prompt)),
  );

  const outputs: SkillRunResult[] = [];
  const errors: Error[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      outputs.push(result.value);
    } else {
      errors.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
    }
  }

  return { outputs, errors };
}

async function executeStageWithRetries(
  stage: ResolvedStageAst,
  prompt: string,
  executor: ResolvedExecutor,
  runStage: RunStageFn,
  signal: AbortSignal,
): Promise<StageExecutionResult> {
  const isConsolidator = isConsolidatorStage(stage, executor);
  const maxRetries = isConsolidator ? executor.ast.guardrails?.consolidator_max_retries ?? 0 : 0;

  let lastResult: StageExecutionResult | null = null;
  let lastSchemaError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const result = await executeStageOnce(stage, prompt, runStage, signal);
    lastResult = result;

    if (
      result.outputs.length === stage.parallel ||
      !isConsolidator ||
      result.errors.length === 0 ||
      !result.errors.every((error) => isSchemaValidationFailure(error))
    ) {
      return result;
    }

    lastSchemaError = result.errors[0] ?? null;
  }

  if (lastResult) {
    return lastResult;
  }

  throw lastSchemaError ?? new Error(`Stage "${stage.id}" failed without a result`);
}

function getLeafOutputs(
  executor: ResolvedExecutor,
  outputsByStage: Map<string, SkillRunResult[]>,
): SkillRunResult[] {
  return outputsByStage.get(executor.leafStageId) ?? [];
}

export async function runStageDag(args: RunStageDagArgs): Promise<StageDagRunResult> {
  const orderedStages = topologicallySortStages(args.executor.stages);
  const outputsByStage = new Map<string, SkillRunResult[]>();

  for (const stage of orderedStages) {
    throwIfAborted(args.signal);
    if (await args.cancelChecker?.()) {
      throw new CanceledError(
        `Execution canceled before stage "${stage.id}"`,
        cloneOutputs(outputsByStage),
        getLeafOutputs(args.executor, outputsByStage),
      );
    }

    const prompt = args.buildStagePrompt(
      stage,
      cloneOutputs(outputsByStage),
      args.iteration,
      args.prevIterationOutputs ? cloneOutputs(args.prevIterationOutputs) : undefined,
    );

    const result = await executeStageWithRetries(
      stage,
      prompt,
      args.executor,
      args.runStage,
      args.signal,
    );

    const threshold = resolveFanOutThreshold(stage, args.executor);
    const minimumSuccesses = Math.ceil(stage.parallel * threshold);

    if (result.outputs.length < minimumSuccesses) {
      throw new FanOutFailureError(stage.id, result.outputs.length, stage.parallel, threshold);
    }

    if (result.errors.length > 0 && stage.parallel === 1) {
      throw result.errors[0]!;
    }

    assertMultiLeafCommentOnly(stage, result.outputs);
    outputsByStage.set(stage.id, result.outputs);
    await args.checkpointWriter?.writeCheckpoint({
      kind: 'stage_complete',
      stageId: stage.id,
      payload: result.outputs.map((output) => structuredClone(output)),
    });
  }

  return {
    outputsByStage,
    leafOutputs: getLeafOutputs(args.executor, outputsByStage),
  };
}
