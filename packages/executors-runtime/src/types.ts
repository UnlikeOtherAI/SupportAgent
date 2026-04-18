export type ExecutorInputScope = 'this_iteration' | 'previous_iteration';

export interface ExecutorInputSourceAst {
  stageId: string;
  scope: ExecutorInputScope;
}

export interface LoopSafetyAst {
  min_iteration_change?: boolean;
  no_self_retrigger: boolean;
}

export interface ExecutorGuardrailsAst {
  fan_out_min_success_rate?: number;
  consolidator_max_retries?: number;
  loop_safety?: LoopSafetyAst;
}

export interface ExecutorLoopAst {
  enabled: boolean;
  max_iterations: number;
  until_done: boolean;
}

export interface StageAst {
  id: string;
  parallel: number;
  system_skill: string;
  complementary: string[];
  executor: string;
  after: string[];
  inputs_from: ExecutorInputSourceAst[];
  task_prompt: string;
}

export interface ExecutorAst {
  version: 1;
  key: string;
  display_name: string;
  preamble: string;
  guardrails?: ExecutorGuardrailsAst;
  stages: StageAst[];
  loop: ExecutorLoopAst;
}

export interface ResolvedSkillMetadata {
  contentHash: string;
  role: 'SYSTEM' | 'COMPLEMENTARY';
  outputSchema?: unknown;
}

export interface ResolvedStageAst extends StageAst {
  resolvedSystemSkill: ResolvedSkillMetadata & { name: string };
  resolvedComplementarySkills: Array<ResolvedSkillMetadata & { name: string }>;
}

export interface ResolvedExecutor {
  ast: ExecutorAst;
  stages: ResolvedStageAst[];
  leafStageId: string;
}

export interface ParseExecutorYamlOptions {
  sourceName?: string;
}

export interface ValidateExecutorOptions {
  resolveSkill: SkillResolver;
}

export type SkillResolver = (
  name: string,
) => Promise<{
  contentHash: string;
  role: string;
  outputSchema?: unknown;
}>;
