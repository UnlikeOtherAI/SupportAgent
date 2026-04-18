import { describe, expect, it } from 'vitest';
import { renderInputsFrom } from './inputs-from-renderer.js';

const stage = {
  id: 'consolidator',
  inputs_from: [
    { stageId: 'workers', scope: 'this_iteration' as const },
    { stageId: 'review', scope: 'previous_iteration' as const },
    { stageId: 'audit', scope: 'this_iteration' as const },
  ],
} as const;

describe('renderInputsFrom', () => {
  it('renders this_iteration sources', () => {
    const rendered = renderInputsFrom(
      {
        ...stage,
        inputs_from: [{ stageId: 'workers', scope: 'this_iteration' }],
      } as never,
      new Map([
        [
          'workers',
          [
            { delivery: [{ kind: 'comment', body: 'alpha' }] },
            { delivery: [{ kind: 'comment', body: 'beta' }] },
          ],
        ],
      ]),
    );

    expect(rendered).toContain('## Inputs from stage "workers" (this iteration)');
    expect(rendered).toContain('Spawn 1: {');
    expect(rendered).toContain('"body": "alpha"');
    expect(rendered).toContain('Spawn 2: {');
    expect(rendered).toContain('"body": "beta"');
  });

  it('renders previous_iteration sources', () => {
    const rendered = renderInputsFrom(
      {
        ...stage,
        inputs_from: [{ stageId: 'review', scope: 'previous_iteration' }],
      } as never,
      new Map(),
      new Map([
        ['review', [{ delivery: [{ kind: 'comment', body: 'carry-over' }] }]],
      ]),
    );

    expect(rendered).toContain('## Inputs from stage "review" (previous iteration)');
    expect(rendered).toContain('"body": "carry-over"');
  });

  it('renders mixed sources in declaration order', () => {
    const rendered = renderInputsFrom(
      stage as never,
      new Map([
        ['workers', [{ delivery: [{ kind: 'comment', body: 'current-worker' }] }]],
        ['audit', [{ delivery: [{ kind: 'comment', body: 'current-audit' }] }]],
      ]),
      new Map([
        ['review', [{ delivery: [{ kind: 'comment', body: 'previous-review' }] }]],
      ]),
    );

    expect(rendered.indexOf('stage "workers"')).toBeLessThan(rendered.indexOf('stage "review"'));
    expect(rendered.indexOf('stage "review"')).toBeLessThan(rendered.indexOf('stage "audit"'));
  });

  it('renders empty sources deterministically', () => {
    const rendered = renderInputsFrom(
      {
        ...stage,
        inputs_from: [{ stageId: 'workers', scope: 'previous_iteration' }],
      } as never,
      new Map(),
      new Map(),
    );

    expect(rendered.trim()).toBe('## Inputs from stage "workers" (previous iteration)\nNo outputs.');
  });
});
