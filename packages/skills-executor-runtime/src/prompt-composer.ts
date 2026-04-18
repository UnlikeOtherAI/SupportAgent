import type { SkillRunResult } from '@support-agent/contracts';
import type { ResolvedExecutor, ResolvedStageAst } from '@support-agent/executors-runtime';
import { renderInputsFrom } from './inputs-from-renderer.js';
import type { RuntimeResolvedStageAst } from './types.js';

interface ComposePromptArgs {
  executor: ResolvedExecutor;
  stage: ResolvedStageAst;
  taskPrompt: string;
  inputsByStage: Map<string, SkillRunResult[]>;
  iteration?: number;
  prevIterationOutputs?: Map<string, SkillRunResult[]>;
}

function asRuntimeStage(stage: ResolvedStageAst): RuntimeResolvedStageAst {
  const runtimeStage = stage as RuntimeResolvedStageAst;
  if (!runtimeStage.resolvedSystemSkill.body) {
    throw new Error(`Stage "${stage.id}" is missing resolved system skill body content`);
  }

  for (const skill of runtimeStage.resolvedComplementarySkills) {
    if (!skill.body) {
      throw new Error(`Stage "${stage.id}" complementary skill "${skill.name}" is missing body`);
    }
  }

  return runtimeStage;
}

function renderOutputContract(stage: RuntimeResolvedStageAst): string {
  const outputSchema = stage.resolvedSystemSkill.outputSchema;
  if (!outputSchema) {
    throw new Error(`Stage "${stage.id}" system skill "${stage.system_skill}" is missing output schema`);
  }

  return [
    '# Output contract',
    'Emit JSON that matches the leaf system skill output schema exactly.',
    '- Return only valid JSON.',
    '- Do not wrap the JSON in markdown fences.',
    '- Do not add keys that are not allowed by the schema.',
    JSON.stringify(outputSchema, null, 2),
  ].join('\n');
}

function renderLoopFocus(
  executor: ResolvedExecutor,
  iteration: number | undefined,
  prevIterationOutputs?: Map<string, SkillRunResult[]>,
): string {
  if (!iteration || iteration <= 1 || !prevIterationOutputs) {
    return '';
  }

  const previousLeafOutputs = prevIterationOutputs.get(executor.leafStageId) ?? [];
  const focus = previousLeafOutputs.find((output) => output.loop?.next_iteration_focus)?.loop
    ?.next_iteration_focus;

  return focus ? `# Focus for this iteration\n${focus}` : '';
}

export function composePrompt(args: ComposePromptArgs): string {
  const runtimeStage = asRuntimeStage(args.stage);
  const complementaryBodies = runtimeStage.resolvedComplementarySkills.map((skill) => skill.body);
  const inputsFromRendered = renderInputsFrom(
    args.stage,
    args.inputsByStage,
    args.prevIterationOutputs,
  );
  const loopFocus = renderLoopFocus(args.executor, args.iteration, args.prevIterationOutputs);

  const sections = [
    args.executor.ast.preamble,
    runtimeStage.resolvedSystemSkill.body,
    ...complementaryBodies,
    renderOutputContract(runtimeStage),
  ];

  const inputsSection = [inputsFromRendered, loopFocus].filter(Boolean).join('\n\n');
  sections.push(inputsSection, args.taskPrompt);

  return sections.filter(Boolean).join('\n\n');
}
