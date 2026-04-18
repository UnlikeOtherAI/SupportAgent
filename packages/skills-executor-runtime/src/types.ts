import type { SkillRunResult } from '@support-agent/contracts';
import type {
  ResolvedExecutor,
  ResolvedSkillMetadata,
  ResolvedStageAst,
} from '@support-agent/executors-runtime';
import type { CheckpointWriter } from './cancel-checkpoint.js';

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

export class MultiLeafSafetyViolation extends SkillExecutorRuntimeError {
  constructor(
    readonly stageId: string,
    readonly spawnIndex: number,
    readonly deliveryKind: string,
  ) {
    super(
      `Stage "${stageId}" spawn ${spawnIndex} emitted forbidden multi-leaf delivery kind "${deliveryKind}"`,
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

export class CanceledError extends SkillExecutorRuntimeError {
  constructor(
    message = 'Execution canceled',
    readonly outputsByStage: Map<string, SkillRunResult[]> = new Map(),
    readonly preservedOutputs: SkillRunResult[] = [],
  ) {
    super(message);
  }
}

export interface RunStageFn {
  (stage: ResolvedStageAst, stagePrompt: string): Promise<SkillRunResult>;
}

export interface PersistIterationFn {
  (iteration: number, outputs: Map<string, SkillRunResult[]>): Promise<void>;
}

export interface BuildStagePromptFn {
  (
    stage: ResolvedStageAst,
    outputsByStage: Map<string, SkillRunResult[]>,
    iteration?: number,
    prevIterationOutputs?: Map<string, SkillRunResult[]>,
  ): string;
}

export interface CancelAwareRuntimeArgs {
  cancelChecker?: () => Promise<boolean>;
  checkpointWriter?: CheckpointWriter;
}

export type { ResolvedExecutor, ResolvedStageAst };
