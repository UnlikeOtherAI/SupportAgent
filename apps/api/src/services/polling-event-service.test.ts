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

  // Regression: Date.now() fallback produced a different key on every poll,
  // meaning the same labeled event was never recognised as a duplicate.
  it('produces the same key on repeated polls when updatedAt is absent (regression)', () => {
    const key1 = dedupeKeyForEvent(
      makeLabeledEvent({ updatedAt: undefined }),
      SCENARIO_ID,
      REPO_URL,
    );
    const key2 = dedupeKeyForEvent(
      makeLabeledEvent({ updatedAt: undefined }),
      SCENARIO_ID,
      REPO_URL,
    );
    expect(key1).toBe(key2);
  });

  it('produces the same key for two events with identical content when updatedAt is absent', () => {
    const eventA = makeLabeledEvent({ label: 'needs-triage', issueNumber: 42, updatedAt: undefined });
    const eventB = makeLabeledEvent({ label: 'needs-triage', issueNumber: 42, updatedAt: undefined });
    const key1 = dedupeKeyForEvent(eventA, SCENARIO_ID, REPO_URL);
    const key2 = dedupeKeyForEvent(eventB, SCENARIO_ID, REPO_URL);
    expect(key1).toBe(key2);
  });

  it('produces different keys when labels array differs and updatedAt is absent', () => {
    const eventA: PollingEvent = {
      kind: 'github.issue.labeled',
      connectorId: 'connector-1',
      repositoryMappingId: 'mapping-1',
      label: 'needs-triage',
      issue: {
        number: 42,
        title: 'Test issue',
        body: null,
        state: 'open',
        url: 'https://github.com/test/repo/issues/42',
        labels: ['needs-triage'],
        comments: [],
        updatedAt: undefined,
      },
    };
    const eventB: PollingEvent = {
      kind: 'github.issue.labeled',
      connectorId: 'connector-1',
      repositoryMappingId: 'mapping-1',
      label: 'needs-triage',
      issue: {
        number: 42,
        title: 'Test issue',
        body: null,
        state: 'open',
        url: 'https://github.com/test/repo/issues/42',
        labels: ['needs-triage', 'bug'],
        comments: [],
        updatedAt: undefined,
      },
    };
    const key1 = dedupeKeyForEvent(eventA, SCENARIO_ID, REPO_URL);
    const key2 = dedupeKeyForEvent(eventB, SCENARIO_ID, REPO_URL);
    expect(key1).not.toBe(key2);
  });
});
