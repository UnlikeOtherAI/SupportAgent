import { describe, it, expect } from 'vitest';
import { matchesIssueOpenedTrigger, matchesIssueLabeledTrigger } from './scenario.js';
import type { CompiledScenario } from './scenario.js';

function makeScenario(
  triggerKind: CompiledScenario['trigger']['kind'],
  triggerConfig: Record<string, unknown> = {},
): CompiledScenario {
  return {
    scenarioId: 'scen-1',
    scenarioKey: 'test-scenario',
    displayName: 'Test Scenario',
    workflowType: 'triage',
    connectorIds: [],
    trigger: { kind: triggerKind, label: 'Trigger', config: triggerConfig },
    action: null,
    outputs: [],
  };
}

describe('matchesIssueOpenedTrigger', () => {
  it('returns true when trigger kind is github.issue.opened', () => {
    expect(matchesIssueOpenedTrigger(makeScenario('github.issue.opened'))).toBe(true);
  });

  it('returns false when trigger kind is github.issue.labeled', () => {
    expect(matchesIssueOpenedTrigger(makeScenario('github.issue.labeled'))).toBe(false);
  });

  it('returns false when trigger kind is github.pull_request.opened', () => {
    expect(matchesIssueOpenedTrigger(makeScenario('github.pull_request.opened'))).toBe(false);
  });

  it('returns false when trigger kind is github.pull_request.comment', () => {
    expect(matchesIssueOpenedTrigger(makeScenario('github.pull_request.comment'))).toBe(false);
  });
});

describe('matchesIssueLabeledTrigger', () => {
  it('returns false when trigger kind is not github.issue.labeled', () => {
    expect(
      matchesIssueLabeledTrigger(makeScenario('github.issue.opened', { labelName: 'bug' }), 'bug'),
    ).toBe(false);
  });

  it('returns false when trigger config has no labelName', () => {
    expect(matchesIssueLabeledTrigger(makeScenario('github.issue.labeled', {}), 'bug')).toBe(false);
  });

  it('returns false when trigger config labelName is empty string', () => {
    expect(
      matchesIssueLabeledTrigger(makeScenario('github.issue.labeled', { labelName: '' }), 'bug'),
    ).toBe(false);
  });

  it('returns false when trigger config labelName is whitespace only', () => {
    expect(
      matchesIssueLabeledTrigger(makeScenario('github.issue.labeled', { labelName: '   ' }), 'bug'),
    ).toBe(false);
  });

  it('returns true when label matches exactly', () => {
    expect(
      matchesIssueLabeledTrigger(makeScenario('github.issue.labeled', { labelName: 'bug' }), 'bug'),
    ).toBe(true);
  });

  it('returns true when labels match case-insensitively', () => {
    expect(
      matchesIssueLabeledTrigger(
        makeScenario('github.issue.labeled', { labelName: 'Bug' }),
        'BUG',
      ),
    ).toBe(true);
  });

  it('returns true when labels match after trimming surrounding whitespace', () => {
    expect(
      matchesIssueLabeledTrigger(
        makeScenario('github.issue.labeled', { labelName: '  bug  ' }),
        ' bug ',
      ),
    ).toBe(true);
  });

  it('returns false when event label differs from trigger label', () => {
    expect(
      matchesIssueLabeledTrigger(
        makeScenario('github.issue.labeled', { labelName: 'bug' }),
        'enhancement',
      ),
    ).toBe(false);
  });
});
