import { describe, it, expect } from 'vitest';
import { dedupeKeyForEvent, type PollingEvent } from './polling-event-service.js';

const SCENARIO_ID = 'scn-abc';
const REPO_URL = 'https://github.com/test/repo';

function makeLabeledEvent(
  overrides: Partial<{ label: string; issueNumber: number; updatedAt: string | undefined }> = {},
): PollingEvent {
  return {
    kind: 'github.issue.labeled',
    connectorId: 'connector-1',
    repositoryMappingId: 'mapping-1',
    label: overrides.label ?? 'needs-triage',
    issue: {
      number: overrides.issueNumber ?? 42,
      title: 'Test issue',
      body: null,
      state: 'open',
      url: 'https://github.com/test/repo/issues/42',
      labels: ['needs-triage'],
      comments: [],
      updatedAt: overrides.updatedAt,
    },
  };
}

describe('dedupeKeyForEvent — github.issue.labeled', () => {
  it('produces the same key when updatedAt is identical (same event instance)', () => {
    const updatedAt = '2024-01-15T10:00:00Z';
    const key1 = dedupeKeyForEvent(makeLabeledEvent({ updatedAt }), SCENARIO_ID, REPO_URL);
    const key2 = dedupeKeyForEvent(makeLabeledEvent({ updatedAt }), SCENARIO_ID, REPO_URL);
    expect(key1).toBe(key2);
  });

  it('produces different keys when updatedAt differs (label removed and re-added)', () => {
    const first = dedupeKeyForEvent(
      makeLabeledEvent({ updatedAt: '2024-01-15T10:00:00Z' }),
      SCENARIO_ID,
      REPO_URL,
    );
    const second = dedupeKeyForEvent(
      makeLabeledEvent({ updatedAt: '2024-01-16T12:00:00Z' }),
      SCENARIO_ID,
      REPO_URL,
    );
    expect(first).not.toBe(second);
  });
});
