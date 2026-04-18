import { describe, expect, it } from 'vitest';
import {
  findTemplatePlaceholders,
  substitutePlaceholders,
} from './placeholder-substitution.js';

describe('substitutePlaceholders', () => {
  it('replaces nested placeholder values from context', () => {
    const template = 'Issue: {{trigger.issue.title}} (#{{run.id}})';
    const result = substitutePlaceholders(template, {
      trigger: {
        issue: {
          title: 'Crash on save',
        },
      },
      run: {
        id: 'run-123',
      },
    });

    expect(result).toBe('Issue: Crash on save (#run-123)');
  });

  it('leaves missing placeholders intact', () => {
    const template = 'Repo: {{trigger.repository.fullName}}';
    const result = substitutePlaceholders(template, {
      trigger: {},
    });

    expect(result).toBe('Repo: {{trigger.repository.fullName}}');
  });

  it('stringifies scalar values', () => {
    const template = 'Run {{run.id}} attempt {{run.attempt}}';
    const result = substitutePlaceholders(template, {
      run: {
        id: 42,
        attempt: true,
      },
    });

    expect(result).toBe('Run 42 attempt true');
  });
});

describe('findTemplatePlaceholders', () => {
  it('returns unique placeholder keys', () => {
    const placeholders = findTemplatePlaceholders(
      '{{trigger.issue.url}} {{trigger.issue.url}} {{run.id}}',
    );

    expect(placeholders).toEqual(['trigger.issue.url', 'run.id']);
  });
});
