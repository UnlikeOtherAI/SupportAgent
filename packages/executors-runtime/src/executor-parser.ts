import { parseDocument } from 'yaml';
import { ZodError, type ZodIssue } from 'zod';
import { ExecutorYamlSchema } from './executor-yaml-schema.js';
import type { ExecutorAst, ParseExecutorYamlOptions } from './types.js';

function makeIssue(path: Array<string | number>, message: string): ZodIssue {
  return {
    code: 'custom',
    message,
    path,
  };
}

function buildStageIndex(stages: ExecutorAst['stages']): Map<string, number> {
  return new Map(stages.map((stage, index) => [stage.id, index]));
}

function collectParserIssues(ast: ExecutorAst): ZodIssue[] {
  const issues: ZodIssue[] = [];
  const stageIndex = buildStageIndex(ast.stages);
  const seenIds = new Map<string, number>();

  ast.stages.forEach((stage, stagePosition) => {
    const prior = seenIds.get(stage.id);
    if (prior !== undefined) {
      issues.push(
        makeIssue(
          ['stages', stagePosition, 'id'],
          `Duplicate stage id '${stage.id}' also declared at stages[${prior}]`,
        ),
      );
    } else {
      seenIds.set(stage.id, stagePosition);
    }

    stage.after.forEach((dependencyId, dependencyIndex) => {
      if (!stageIndex.has(dependencyId)) {
        issues.push(
          makeIssue(
            ['stages', stagePosition, 'after', dependencyIndex],
            `Unknown stage id '${dependencyId}'`,
          ),
        );
      }
    });

    stage.inputs_from.forEach((inputSource, inputIndex) => {
      if (!stageIndex.has(inputSource.stageId)) {
        issues.push(
          makeIssue(
            ['stages', stagePosition, 'inputs_from', inputIndex],
            `Unknown stage id '${inputSource.stageId}'`,
          ),
        );
      }
    });
  });

  const leaves = ast.stages.filter(
    (candidate) => !ast.stages.some((stage) => stage.after.includes(candidate.id)),
  );

  if (leaves.length !== 1) {
    issues.push(
      makeIssue(
        ['stages'],
        `Executor must have exactly one terminal stage, found ${leaves.length}`,
      ),
    );
  }

  const cycleIssues = collectCycleIssues(ast);
  issues.push(...cycleIssues);

  return issues;
}

function collectCycleIssues(ast: ExecutorAst): ZodIssue[] {
  const issues: ZodIssue[] = [];
  const state = new Map<string, 'unvisited' | 'visiting' | 'visited'>();
  const stageById = new Map(ast.stages.map((stage) => [stage.id, stage]));

  const visit = (stageId: string, stack: string[]): void => {
    const current = state.get(stageId) ?? 'unvisited';
    if (current === 'visiting') {
      const cycleStart = stack.indexOf(stageId);
      const cyclePath = [...stack.slice(cycleStart), stageId];
      issues.push(
        makeIssue(
          ['stages'],
          `Circular dependency detected: ${cyclePath.join(' -> ')}`,
        ),
      );
      return;
    }

    if (current === 'visited') {
      return;
    }

    state.set(stageId, 'visiting');
    const stage = stageById.get(stageId);
    if (stage) {
      for (const dependencyId of stage.after) {
        if (stageById.has(dependencyId)) {
          visit(dependencyId, [...stack, stageId]);
        }
      }
    }
    state.set(stageId, 'visited');
  };

  for (const stage of ast.stages) {
    visit(stage.id, []);
  }

  return issues;
}

export function parseExecutorYaml(
  yamlText: string,
  options: ParseExecutorYamlOptions = {},
): ExecutorAst {
  const document = parseDocument(yamlText, {
    prettyErrors: false,
    uniqueKeys: false,
  });

  if (document.errors.length > 0) {
    throw new ZodError(
      document.errors.map((error) =>
        makeIssue([], `${options.sourceName ?? 'executor'} YAML parse error: ${error.message}`),
      ),
    );
  }

  const parsed = ExecutorYamlSchema.safeParse(document.toJS());
  if (!parsed.success) {
    throw parsed.error;
  }

  const ast = parsed.data as ExecutorAst;
  const graphIssues = collectParserIssues(ast);
  if (graphIssues.length > 0) {
    throw new ZodError(graphIssues);
  }

  return ast;
}
