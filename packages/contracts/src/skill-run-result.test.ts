import { describe, expect, it } from 'vitest';
import { SkillRunResultSchema } from './skill-run-result.js';

describe('SkillRunResultSchema', () => {
  it('parses a minimal result with one comment op', () => {
    const result = SkillRunResultSchema.parse({
      delivery: [{ kind: 'comment', body: 'Investigation complete.' }],
    });

    expect(result.delivery).toHaveLength(1);
    expect(result.delivery[0]).toEqual({ kind: 'comment', body: 'Investigation complete.' });
  });

  it('parses a result containing all supported delivery op kinds', () => {
    const result = SkillRunResultSchema.parse({
      delivery: [
        { kind: 'comment', body: 'Posted a summary.' },
        { kind: 'labels', add: ['triaged'], remove: ['needs-triage'] },
        { kind: 'state', change: 'approve' },
        {
          kind: 'pr',
          spec: {
            branch: 'fix/issue-42',
            title: 'Fix issue 42',
            body: 'This resolves the reported bug.',
            base: 'main',
            commit_message: 'Fix issue 42',
            draft: true,
          },
        },
      ],
    });

    expect(result.delivery).toHaveLength(4);
  });

  it('accepts internal visibility on delivery ops', () => {
    const result = SkillRunResultSchema.parse({
      delivery: [{ kind: 'comment', body: 'Internal diagnostic', visibility: 'internal' }],
    });

    expect(result.delivery[0]).toMatchObject({ visibility: 'internal' });
  });

  it('rejects an invalid state change value', () => {
    expect(() =>
      SkillRunResultSchema.parse({
        delivery: [{ kind: 'state', change: 'ship' }],
      }),
    ).toThrow();
  });

  it('accepts findings when a comment delivery op is also present', () => {
    const result = SkillRunResultSchema.parse({
      delivery: [{ kind: 'comment', body: 'Human-readable summary.' }],
      findings: {
        summary: 'The null check is missing.',
        rootCause: 'The handler assumes metadata is always populated.',
        confidence: 'high',
      },
    });

    expect(result.delivery).toHaveLength(1);
    expect(result.findings?.summary).toBe('The null check is missing.');
  });

  it('accepts findings with non-comment delivery ops', () => {
    const result = SkillRunResultSchema.parse({
      delivery: [{ kind: 'labels', add: ['triaged'] }],
      findings: {
        summary: 'The null check is missing.',
      },
    });

    expect(result.findings?.summary).toBe('The null check is missing.');
  });

  it('accepts findings-only results', () => {
    const result = SkillRunResultSchema.parse({
      delivery: [],
      findings: {
        summary: 'The null check is missing.',
      },
    });

    expect(result.findings?.summary).toBe('The null check is missing.');
  });

  it('accepts comment-only results', () => {
    const result = SkillRunResultSchema.parse({
      delivery: [{ kind: 'comment', body: 'Human-readable summary.' }],
    });

    expect(result.delivery).toHaveLength(1);
  });

  it('accepts comment ops alongside other non-comment delivery ops without findings', () => {
    const result = SkillRunResultSchema.parse({
      delivery: [
        { kind: 'comment', body: 'Human-readable summary.' },
        { kind: 'labels', add: ['triaged'] },
      ],
    });

    expect(result.delivery).toHaveLength(2);
  });
});
