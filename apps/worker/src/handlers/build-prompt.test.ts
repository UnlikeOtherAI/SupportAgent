import { describe, expect, it } from 'vitest';
import { buildBuildPrompt } from './build-prompt.js';

describe('buildBuildPrompt', () => {
  it('builds a generic issue-driven prompt with repo and triage context', () => {
    const prompt = buildBuildPrompt({
      owner: 'rafiki270',
      repo: 'max-test',
      targetBranch: 'main',
      issueBody: 'Add support for the new workflow chain page.',
      issueNumber: 42,
      issueTitle: 'Implement workflow chain UI',
      triageSummary: 'The admin app lacks a route and controls for workflow-chain operations.',
    });

    expect(prompt).toContain('Repository: rafiki270/max-test');
    expect(prompt).toContain('Issue #42: Implement workflow chain UI');
    expect(prompt).toContain('Triage Summary:');
    expect(prompt).toContain('Inspect the repository');
    expect(prompt).toContain('Update or add the relevant tests');
    expect(prompt).toContain('Run the most appropriate test command');
    expect(prompt).not.toContain('calculator.py');
    expect(prompt).not.toContain('tests.py');
    expect(prompt).not.toContain('divide(10, 0)');
  });
});
