import type { SkillRunResult } from '@support-agent/contracts';
import type { ResolvedExecutor } from '@support-agent/executors-runtime';
import { runStageDag } from './stage-scheduler.js';
import {
  CanceledError,
  type BuildStagePromptFn,
  type CancelAwareRuntimeArgs,
  type PersistIterationFn,
  type RunStageFn,
  type StageDagRunResult,
  NoProgressError,
} from './types.js';

interface RunWithLoopArgs {
  executor: ResolvedExecutor;
  buildStagePrompt: BuildStagePromptFn;
  runStage: RunStageFn;
  signal: AbortSignal;
  persistIteration: PersistIterationFn;
  cancelChecker?: CancelAwareRuntimeArgs['cancelChecker'];
  checkpointWriter?: CancelAwareRuntimeArgs['checkpointWriter'];
}

interface RunWithLoopResult {
  iterations: number;
  finalOutputs: SkillRunResult[];
}

function cloneOutputs(outputsByStage: Map<string, SkillRunResult[]>): Map<string, SkillRunResult[]> {
  return new Map(
    Array.from(outputsByStage.entries(), ([stageId, outputs]) => [
      stageId,
      outputs.map((output) => structuredClone(output)),
    ]),
  );
}

function areLeafOutputsEqual(previous: SkillRunResult[], current: SkillRunResult[]): boolean {
  return JSON.stringify(previous) === JSON.stringify(current);
}

function hasLoopDone(outputs: SkillRunResult[]): boolean {
  return outputs.some((output) => output.loop?.done === true);
}

export async function runWithLoop(args: RunWithLoopArgs): Promise<RunWithLoopResult> {
  if (!args.executor.ast.loop.enabled) {
    const result = await runStageDag({
      executor: args.executor,
      buildStagePrompt: args.buildStagePrompt,
      runStage: args.runStage,
      signal: args.signal,
      cancelChecker: args.cancelChecker,
      checkpointWriter: args.checkpointWriter,
    });
    await args.persistIteration(1, result.outputsByStage);
    await args.checkpointWriter?.writeCheckpoint({
      kind: 'iteration_complete',
      iteration: 1,
      payload: result.leafOutputs.map((output) => structuredClone(output)),
    });
    return {
      iterations: 1,
      finalOutputs: result.leafOutputs,
    };
  }

  const loopConfig = args.executor.ast.loop;
  const minIterationChange =
    args.executor.ast.guardrails?.loop_safety?.min_iteration_change ?? loopConfig.until_done;

  let previousLeafOutputs: SkillRunResult[] | null = null;
  let stickyDone: { iteration: number; outputs: SkillRunResult[] } | null = null;
  let lastSuccessfulResult: StageDagRunResult | null = null;

  for (let iteration = 1; iteration <= loopConfig.max_iterations; iteration += 1) {
    try {
      if (iteration > 1 && await args.cancelChecker?.()) {
        throw new CanceledError(
          `Execution canceled before iteration ${iteration}`,
          lastSuccessfulResult ? cloneOutputs(lastSuccessfulResult.outputsByStage) : new Map(),
          lastSuccessfulResult?.leafOutputs.map((output) => structuredClone(output)) ?? [],
        );
      }

      const result = await runStageDag({
        executor: args.executor,
        buildStagePrompt: args.buildStagePrompt,
        runStage: args.runStage,
        signal: args.signal,
        iteration,
        prevIterationOutputs: lastSuccessfulResult?.outputsByStage,
        cancelChecker: args.cancelChecker,
        checkpointWriter: args.checkpointWriter,
      });

      if (
        minIterationChange &&
        previousLeafOutputs &&
        areLeafOutputsEqual(previousLeafOutputs, result.leafOutputs)
      ) {
        throw new NoProgressError(iteration);
      }

      await args.persistIteration(iteration, result.outputsByStage);
      await args.checkpointWriter?.writeCheckpoint({
        kind: 'iteration_complete',
        iteration,
        payload: result.leafOutputs.map((output) => structuredClone(output)),
      });

      lastSuccessfulResult = result;
      previousLeafOutputs = result.leafOutputs.map((output) => structuredClone(output));

      if (hasLoopDone(result.leafOutputs)) {
        stickyDone = {
          iteration,
          outputs: result.leafOutputs.map((output) => structuredClone(output)),
        };
      }

      if (loopConfig.until_done && stickyDone && stickyDone.iteration === iteration) {
        return {
          iterations: iteration,
          finalOutputs: stickyDone.outputs,
        };
      }
    } catch (error) {
      if (error instanceof CanceledError) {
        throw new CanceledError(
          error.message,
          error.outputsByStage.size > 0
            ? error.outputsByStage
            : lastSuccessfulResult
              ? cloneOutputs(lastSuccessfulResult.outputsByStage)
              : new Map(),
          error.preservedOutputs.length > 0
            ? error.preservedOutputs
            : lastSuccessfulResult?.leafOutputs.map((output) => structuredClone(output)) ?? [],
        );
      }
      if (stickyDone) {
        return {
          iterations: stickyDone.iteration,
          finalOutputs: stickyDone.outputs,
        };
      }

      throw error;
    }
  }

  if (stickyDone) {
    return {
      iterations: stickyDone.iteration,
      finalOutputs: stickyDone.outputs,
    };
  }

  return {
    iterations: loopConfig.max_iterations,
    finalOutputs: lastSuccessfulResult?.leafOutputs ?? [],
  };
}
