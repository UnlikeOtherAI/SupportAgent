import type { SkillRunResult } from '@support-agent/contracts';
import type {
  ResolvedExecutor,
  ResolvedSkillMetadata,
  ResolvedStageAst,
} from '@support-agent/executors-runtime';

export interface RuntimeResolvedSkill extends ResolvedSkillMetadata {
  name: string;
  body: string;
}

export interface RuntimeResolvedStageAst extends Omit<ResolvedStageAst, 'resolvedSystemSkill' | 'resolvedComplementarySkills'> {
  resolvedSystemSkill: RuntimeResolvedSkill;
  resolvedComplementarySkills: RuntimeResolvedSkill[];
}

export interface StageDagRunResult {
  outputsByStage: Map<string, SkillRunResult[]>;
  leafOutputs: SkillRunResult[];
}

export class SkillExecutorRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class FanOutFailureError extends SkillExecutorRuntimeError {
  constructor(
    readonly stageId: string,
    readonly successCount: number,
    readonly totalCount: number,
    readonly threshold: number,
  ) {
    super(
      `Stage "${stageId}" fan-out success rate ${successCount}/${totalCount} did not meet threshold ${threshold}`,
    );
  }
}

export class SchemaValidationError extends SkillExecutorRuntimeError {}

export class NoProgressError extends SkillExecutorRuntimeError {
  constructor(readonly iteration: number) {
    super(`Iteration ${iteration} produced no structural change from the prior iteration`);
  }
}

export class AbortError extends SkillExecutorRuntimeError {
  constructor(message = 'Execution aborted') {
    super(message);
  }
}

export interface RunStageFn {
  (stageId: string, stagePrompt: string, executorKey: string): Promise<SkillRunResult>;
}

export interface PersistIterationFn {
  (iteration: number, outputs: Map<string, SkillRunResult[]>): Promise<void>;
}

export type { ResolvedExecutor, ResolvedStageAst };
