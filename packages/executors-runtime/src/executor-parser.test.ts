import { describe, expect, it } from 'vitest';
import { parseExecutorYaml } from './executor-parser.js';

function buildYaml(overrides = ''): string {
  return `version: 1
key: triage-default
display_name: "Default triage"
preamble: |
  You are operating inside SupportAgent...
guardrails:
  fan_out_min_success_rate: 0.6
  consolidator_max_retries: 1
  loop_safety:
    min_iteration_change: true
stages:
  - id: investigate
    parallel: 1
    system_skill: triage-issue
    complementary: [codebase-architecture]
    executor: claude-sonnet
    after: []
    inputs_from: []
    task_prompt: "Investigate the issue at {{trigger.issue.url}}"
  - id: consolidate
    parallel: 1
    system_skill: consolidator
    complementary: []
    executor: claude-haiku
    after: [investigate]
    inputs_from: [investigate]
    task_prompt: "Consolidate the investigation findings."
loop:
  enabled: false
  max_iterations: 3
  until_done: false
${overrides}`;
}

describe('parseExecutorYaml', () => {
  it('parses a valid executor cleanly', () => {
    const ast = parseExecutorYaml(buildYaml());

    expect(ast.key).toBe('triage-default');
    expect(ast.stages).toHaveLength(2);
    expect(ast.stages[1]?.inputs_from).toEqual([
      {
        stageId: 'investigate',
        scope: 'this_iteration',
      },
    ]);
    expect(ast.guardrails?.loop_safety?.no_self_retrigger).toBe(true);
  });

  it('throws for a bad version', () => {
    expect(() => parseExecutorYaml(buildYaml().replace('version: 1', 'version: 2'))).toThrow(
      /version/i,
    );
  });

  it('throws for duplicate stage ids', () => {
    expect(() =>
      parseExecutorYaml(buildYaml().replace('id: consolidate', 'id: investigate')),
    ).toThrow(/Duplicate stage id/i);
  });

  it('throws when a stage references a missing after id', () => {
    expect(() =>
      parseExecutorYaml(buildYaml().replace('after: [investigate]', 'after: [missing-stage]')),
    ).toThrow(/Unknown stage id 'missing-stage'/i);
  });

  it('throws when there are two terminal stages', () => {
    const yaml = `version: 1
key: multi-leaf
display_name: "Two leaves"
preamble: ""
stages:
  - id: alpha
    parallel: 1
    system_skill: triage-issue
    complementary: []
    executor: claude-sonnet
    after: []
    inputs_from: []
    task_prompt: "Alpha"
  - id: beta
    parallel: 1
    system_skill: consolidator
    complementary: []
    executor: claude-haiku
    after: []
    inputs_from: []
    task_prompt: "Beta"
loop:
  enabled: false
  max_iterations: 1
  until_done: false
`;

    expect(() => parseExecutorYaml(yaml)).toThrow(/exactly one terminal stage/i);
  });

  it('throws when the executor contains a circular dependency', () => {
    const yaml = `version: 1
key: cyclic
display_name: "Cyclic executor"
preamble: ""
stages:
  - id: alpha
    parallel: 1
    system_skill: triage-issue
    complementary: []
    executor: claude-sonnet
    after: [beta]
    inputs_from: []
    task_prompt: "Alpha"
  - id: beta
    parallel: 1
    system_skill: consolidator
    complementary: []
    executor: claude-haiku
    after: [alpha]
    inputs_from: [alpha]
    task_prompt: "Beta"
loop:
  enabled: false
  max_iterations: 1
  until_done: false
`;

    expect(() => parseExecutorYaml(yaml)).toThrow(/Circular dependency detected/i);
  });

  it('defaults loop_safety.no_self_retrigger to true when omitted', () => {
    const ast = parseExecutorYaml(buildYaml());

    expect(ast.guardrails?.loop_safety?.no_self_retrigger).toBe(true);
  });

  it('parses loop_safety.no_self_retrigger when explicitly false', () => {
    const ast = parseExecutorYaml(
      buildYaml().replace(
        '    min_iteration_change: true',
        '    min_iteration_change: true\n    no_self_retrigger: false',
      ),
    );

    expect(ast.guardrails?.loop_safety?.no_self_retrigger).toBe(false);
  });

  it('throws when loop_safety.no_self_retrigger is not a boolean', () => {
    expect(() =>
      parseExecutorYaml(
        buildYaml().replace(
          '    min_iteration_change: true',
          '    min_iteration_change: true\n    no_self_retrigger: "no"',
        ),
      ),
    ).toThrow(/no_self_retrigger/i);
  });
});
