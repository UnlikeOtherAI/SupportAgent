import type { SkillRunResult } from '@support-agent/contracts';
import type { ResolvedStageAst } from '@support-agent/executors-runtime';

export function renderInputsFrom(
  stage: ResolvedStageAst,
  inputsByStage: Map<string, SkillRunResult[]>,
  prevIterationOutputs?: Map<string, SkillRunResult[]>,
): string {
  if (stage.inputs_from.length === 0) {
    return '';
  }

  const sections: string[] = [];

  for (const source of stage.inputs_from) {
    const stageOutputs =
      source.scope === 'previous_iteration'
        ? prevIterationOutputs?.get(source.stageId) ?? []
        : inputsByStage.get(source.stageId) ?? [];

    const scopeLabel =
      source.scope === 'previous_iteration' ? 'previous iteration' : 'this iteration';

    const lines = [`## Inputs from stage "${source.stageId}" (${scopeLabel})`];

    if (stageOutputs.length === 0) {
      lines.push('No outputs.');
    } else {
      stageOutputs.forEach((output, index) => {
        lines.push(`Spawn ${index + 1}: ${JSON.stringify(output, null, 2)}`);
      });
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}
