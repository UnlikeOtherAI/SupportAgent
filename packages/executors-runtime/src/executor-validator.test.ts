import { describe, expect, it } from 'vitest';
import { parseExecutorYaml } from './executor-parser.js';
import { validateExecutor } from './executor-validator.js';
import type { SkillResolver } from './types.js';

const commentOnlySchema = {
  type: 'object',
  properties: {
    delivery: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            properties: {
              kind: { const: 'comment' },
              body: { type: 'string' },
            },
            required: ['kind', 'body'],
          },
        ],
      },
    },
  },
  required: ['delivery'],
};

const stateDeliverySchema = {
  type: 'object',
  properties: {
    delivery: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            properties: {
              kind: { const: 'state' },
              change: { enum: ['close', 'reopen'] },
            },
            required: ['kind', 'change'],
          },
        ],
      },
    },
  },
  required: ['delivery'],
};

const loopDoneSchema = {
  type: 'object',
  properties: {
    delivery: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            properties: {
              kind: { const: 'comment' },
              body: { type: 'string' },
            },
            required: ['kind', 'body'],
          },
        ],
      },
    },
    loop: {
      type: 'object',
      properties: {
        done: { type: 'boolean' },
        next_iteration_focus: { type: 'string' },
      },
      required: ['done'],
    },
  },
  required: ['delivery', 'loop'],
};

function buildExecutorYaml(stageCount: 2 | 1, untilDone = false): string {
  if (stageCount === 1) {
    return `version: 1
key: single-stage
display_name: "Single stage"
preamble: ""
stages:
  - id: main
    parallel: 1
    system_skill: triage-issue
    complementary: []
    executor: codex
    after: []
    inputs_from: []
    task_prompt: "Investigate"
loop:
  enabled: ${untilDone ? 'true' : 'false'}
  max_iterations: 3
  until_done: ${untilDone ? 'true' : 'false'}
`;
  }

  return `version: 1
key: multi-stage
display_name: "Multi stage"
preamble: ""
stages:
  - id: investigate
    parallel: 1
    system_skill: triage-issue
    complementary: [codebase-architecture]
    executor: codex
    after: []
    inputs_from: []
    task_prompt: "Investigate"
  - id: consolidate
    parallel: 1
    system_skill: consolidator
    complementary: []
    executor: claude
    after: [investigate]
    inputs_from: [investigate]
    task_prompt: "Consolidate"
loop:
  enabled: ${untilDone ? 'true' : 'false'}
  max_iterations: 3
  until_done: ${untilDone ? 'true' : 'false'}
`;
}

function createResolver(overrides: Record<string, { contentHash: string; role: string; outputSchema?: unknown }>): SkillResolver {
  return async (name) => {
    const resolved = overrides[name];
    if (!resolved) {
      throw new Error(`Unexpected skill lookup: ${name}`);
    }
    return resolved;
  };
}

describe('validateExecutor', () => {
  it('throws when a system skill resolves to the wrong role', async () => {
    const ast = parseExecutorYaml(buildExecutorYaml(1));

    await expect(
      validateExecutor(ast, {
        resolveSkill: createResolver({
          'triage-issue': {
            contentHash: 'hash-system',
            role: 'COMPLEMENTARY',
            outputSchema: commentOnlySchema,
          },
        }),
      }),
    ).rejects.toThrow(/must resolve to SYSTEM/i);
  });

  it('throws when a complementary skill resolves to the wrong role', async () => {
    const ast = parseExecutorYaml(buildExecutorYaml(2));

    await expect(
      validateExecutor(ast, {
        resolveSkill: createResolver({
          'triage-issue': {
            contentHash: 'hash-triage',
            role: 'SYSTEM',
            outputSchema: commentOnlySchema,
          },
          consolidator: {
            contentHash: 'hash-consolidator',
            role: 'SYSTEM',
            outputSchema: commentOnlySchema,
          },
          'codebase-architecture': {
            contentHash: 'hash-architecture',
            role: 'SYSTEM',
          },
        }),
      }),
    ).rejects.toThrow(/must resolve to COMPLEMENTARY/i);
  });

  it('throws when a multi-stage leaf skill allows non-comment delivery', async () => {
    const ast = parseExecutorYaml(buildExecutorYaml(2));

    await expect(
      validateExecutor(ast, {
        resolveSkill: createResolver({
          'triage-issue': {
            contentHash: 'hash-triage',
            role: 'SYSTEM',
            outputSchema: commentOnlySchema,
          },
          consolidator: {
            contentHash: 'hash-consolidator',
            role: 'SYSTEM',
            outputSchema: stateDeliverySchema,
          },
          'codebase-architecture': {
            contentHash: 'hash-architecture',
            role: 'COMPLEMENTARY',
          },
        }),
      }),
    ).rejects.toThrow(/banned delivery kind 'state'/i);
  });

  it('passes when a single-stage executor allows state delivery', async () => {
    const ast = parseExecutorYaml(buildExecutorYaml(1));

    const resolved = await validateExecutor(ast, {
      resolveSkill: createResolver({
        'triage-issue': {
          contentHash: 'hash-triage',
          role: 'SYSTEM',
          outputSchema: stateDeliverySchema,
        },
      }),
    });

    expect(resolved.leafStageId).toBe('main');
    expect(resolved.stages[0]?.resolvedSystemSkill.contentHash).toBe('hash-triage');
  });

  it('throws when until_done=true and the leaf schema lacks loop.done', async () => {
    const ast = parseExecutorYaml(buildExecutorYaml(1, true));

    await expect(
      validateExecutor(ast, {
        resolveSkill: createResolver({
          'triage-issue': {
            contentHash: 'hash-triage',
            role: 'SYSTEM',
            outputSchema: commentOnlySchema,
          },
        }),
      }),
    ).rejects.toThrow(/must require loop\.done:boolean/i);
  });

  it('passes when until_done=true and the leaf schema requires loop.done', async () => {
    const ast = parseExecutorYaml(buildExecutorYaml(1, true));

    const resolved = await validateExecutor(ast, {
      resolveSkill: createResolver({
        'triage-issue': {
          contentHash: 'hash-triage',
          role: 'SYSTEM',
          outputSchema: loopDoneSchema,
        },
      }),
    });

    expect(resolved.leafStageId).toBe('main');
  });
});
