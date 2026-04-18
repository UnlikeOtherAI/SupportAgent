import type { SkillRunResult } from '@support-agent/contracts';
import type { ResolvedExecutor } from '@support-agent/executors-runtime';
import { runStageDag } from './stage-scheduler.js';
import {
  type PersistIterationFn,
  type RunStageFn,
  type StageDagRunResult,
  NoProgressError,
} from './types.js';

interface RunWithLoopArgs {
  executor: ResolvedExecutor;
  taskPromptByStageId: Record<string, string>;
  runStage: RunStageFn;
  signal: AbortSignal;
  persistIteration: PersistIterationFn;
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
    const result = await runStageDag(args);
    await args.persistIteration(1, result.outputsByStage);
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
      const result = await runStageDag(args);

      if (
        minIterationChange &&
        previousLeafOutputs &&
        areLeafOutputsEqual(previousLeafOutputs, result.leafOutputs)
      ) {
        throw new NoProgressError(iteration);
      }

      await args.persistIteration(iteration, result.outputsByStage);

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
