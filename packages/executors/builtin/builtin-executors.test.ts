import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseExecutorYaml } from '@support-agent/executors-runtime';

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

function getLeafStageId(stageIds: string[], afterGraph: Map<string, string[]>): string[] {
  return stageIds.filter(
    (candidate) =>
      !Array.from(afterGraph.values()).some((dependencies) => dependencies.includes(candidate)),
  );
}

describe('builtin executor YAMLs', () => {
  it.each(builtinExecutors)('parses %s without schema or graph errors', (name) => {
    expect(() => parseExecutorYaml(readExecutorYaml(name), { sourceName: name })).not.toThrow();
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
