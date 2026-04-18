import { describe, expect, it } from 'vitest';
import { composePrompt } from './prompt-composer.js';

function buildStage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'main',
    system_skill: 'triage-system',
    complementary: [],
    inputs_from: [],
    resolvedSystemSkill: {
      name: 'triage-system',
      role: 'SYSTEM',
      contentHash: 'hash-system',
      body: '# System skill body',
      outputSchema: {
        type: 'object',
        properties: {
          delivery: { type: 'array' },
        },
        required: ['delivery'],
      },
    },
    resolvedComplementarySkills: [],
    ...overrides,
  };
}

function buildExecutor() {
  return {
    ast: {
      key: 'review',
      preamble: 'You are running inside SupportAgent.',
      loop: { enabled: false, max_iterations: 1, until_done: false },
    },
    leafStageId: 'main',
    stages: [],
  };
}

describe('composePrompt', () => {
  it('composes a minimal prompt without upstream inputs', () => {
    const prompt = composePrompt({
      executor: buildExecutor() as never,
      stage: buildStage() as never,
      taskPrompt: 'Investigate the issue.',
      inputsByStage: new Map(),
    });

    expect(prompt).toContain('You are running inside SupportAgent.');
    expect(prompt).toContain('# System skill body');
    expect(prompt).toContain('# Output contract');
    expect(prompt).toContain('Investigate the issue.');
    expect(prompt).not.toContain('## Inputs from stage');
  });

  it('renders multiple upstream inputs into the prompt body', () => {
    const prompt = composePrompt({
      executor: buildExecutor() as never,
      stage: buildStage({
        inputs_from: [
          { stageId: 'workers', scope: 'this_iteration' },
          { stageId: 'review', scope: 'previous_iteration' },
        ],
      }) as never,
      taskPrompt: 'Consolidate the results.',
      inputsByStage: new Map([
        ['workers', [{ delivery: [{ kind: 'comment', body: 'worker output' }] }]],
      ]),
      prevIterationOutputs: new Map([
        ['review', [{ delivery: [{ kind: 'comment', body: 'previous output' }] }]],
      ]),
      iteration: 2,
    });

    expect(prompt).toContain('## Inputs from stage "workers" (this iteration)');
    expect(prompt).toContain('## Inputs from stage "review" (previous iteration)');
    expect(prompt).toContain('"body": "worker output"');
    expect(prompt).toContain('"body": "previous output"');
  });

  it('appends complementary skill bodies in order', () => {
    const prompt = composePrompt({
      executor: buildExecutor() as never,
      stage: buildStage({
        complementary: ['arch', 'policy'],
        resolvedComplementarySkills: [
          {
            name: 'arch',
            role: 'COMPLEMENTARY',
            contentHash: 'hash-arch',
            body: 'Architecture notes',
          },
          {
            name: 'policy',
            role: 'COMPLEMENTARY',
            contentHash: 'hash-policy',
            body: 'Policy notes',
          },
        ],
      }) as never,
      taskPrompt: 'Review the code.',
      inputsByStage: new Map(),
    });

    expect(prompt.indexOf('Architecture notes')).toBeGreaterThan(prompt.indexOf('# System skill body'));
    expect(prompt.indexOf('Policy notes')).toBeGreaterThan(prompt.indexOf('Architecture notes'));
  });
});
