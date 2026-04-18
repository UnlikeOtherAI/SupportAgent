import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseExecutorYaml, validateExecutor } from '@support-agent/executors-runtime';

const builtinExecutors = [
  'triage-default',
  'pr-review-default',
  'merge-default',
  'cross-llm-review',
  'zero-defect-review',
] as const;

function readExecutorYaml(name: (typeof builtinExecutors)[number]): string {
  return readFileSync(resolve(process.cwd(), 'builtin', `${name}.yaml`), 'utf8');
}

function readSkillRecord(name: string) {
  const skillDir = resolve(process.cwd(), '../skills/builtin', name);
  const markdown = readFileSync(resolve(skillDir, 'SKILL.md'), 'utf8');
  const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    throw new Error(`Missing frontmatter in ${name}/SKILL.md`);
  }

  const frontmatter = Object.fromEntries(
    frontmatterMatch[1]
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split(':');
        return [key.trim(), rest.join(':').trim()];
      }),
  );

  const outputSchemaPath = frontmatter.output_schema?.replace(/^\.\/+/, '');
  const outputSchema = outputSchemaPath
    ? JSON.parse(readFileSync(resolve(skillDir, outputSchemaPath), 'utf8'))
    : null;

  return {
    contentHash: `test-${name}`,
    outputSchema,
    role: String(frontmatter.role ?? '').toUpperCase(),
  };
}

function getLeafStageId(stageIds: string[], afterGraph: Map<string, string[]>): string[] {
  return stageIds.filter(
    (candidate) =>
      !Array.from(afterGraph.values()).some((dependencies) => dependencies.includes(candidate)),
  );
}

describe('builtin executor YAMLs', () => {
  it.each(builtinExecutors)('parses and validates %s without schema or graph errors', async (name) => {
    const ast = parseExecutorYaml(readExecutorYaml(name), { sourceName: name });

    await expect(
      validateExecutor(ast, {
        resolveSkill: async (skillName: string) => readSkillRecord(skillName),
      }),
    ).resolves.toBeDefined();
  });

  it('models cross-llm-review as three reviewers feeding one consolidator leaf', () => {
    const ast = parseExecutorYaml(readExecutorYaml('cross-llm-review'), {
      sourceName: 'cross-llm-review',
    });

    expect(ast.stages).toHaveLength(4);
    expect(ast.stages.filter((stage) => stage.id.startsWith('review-'))).toHaveLength(3);
    expect(ast.stages.find((stage) => stage.id === 'consolidate')).toBeDefined();

    const leaves = getLeafStageId(
      ast.stages.map((stage) => stage.id),
      new Map(ast.stages.map((stage) => [stage.id, stage.after])),
    );

    expect(leaves).toEqual(['consolidate']);
  });

  it('marks zero-defect-review as an until-done loop', () => {
    const ast = parseExecutorYaml(readExecutorYaml('zero-defect-review'), {
      sourceName: 'zero-defect-review',
    });

    expect(ast.loop.until_done).toBe(true);
  });
});
