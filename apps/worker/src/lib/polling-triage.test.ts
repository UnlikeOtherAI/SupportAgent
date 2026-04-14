import { describe, expect, it, vi } from 'vitest';
import { pollTriageTargets } from './polling-triage.js';
import { TRIAGE_DISCOVERY_MARKER } from './triage-discovery-comment.js';

describe('pollTriageTargets', () => {
  it('queues only open issues without the triaged label or discovery comment', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          {
            connectorId: 'connector-1',
            connectorName: 'GitHub Issues',
            config: { auth_mode: 'local_gh' },
            defaultBranch: 'main',
            platformTypeKey: 'github_issues',
            pollingIntervalSeconds: 300,
            repositoryMappingId: 'mapping-1',
            repositoryUrl: 'https://github.com/rafiki270/max-test',
          },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'created' }),
      });

    const ghListIssues = vi.fn().mockResolvedValue([
      {
        body: 'Needs investigation',
        comments: [],
        labels: [],
        number: 12,
        state: 'OPEN',
        title: 'Fresh issue',
        url: 'https://github.com/rafiki270/max-test/issues/12',
      },
      {
        body: 'Already handled',
        comments: [],
        labels: ['triaged'],
        number: 13,
        state: 'OPEN',
        title: 'Label already present',
        url: 'https://github.com/rafiki270/max-test/issues/13',
      },
      {
        body: 'Already discovered',
        comments: [
          {
            author: 'support-agent',
            body: `${TRIAGE_DISCOVERY_MARKER}\n## Discovery`,
            createdAt: new Date().toISOString(),
            id: 'comment-1',
          },
        ],
        labels: [],
        number: 14,
        state: 'OPEN',
        title: 'Comment already present',
        url: 'https://github.com/rafiki270/max-test/issues/14',
      },
    ]);

    vi.stubGlobal('fetch', fetchMock);

    const result = await pollTriageTargets({
      apiBaseUrl: 'http://localhost:4441',
      ghListIssues,
      lastPolledAtByTarget: new Map<string, number>(),
      token: 'jwt-token',
    });

    expect(result).toEqual({
      created: 1,
      duplicate: 0,
      skipped: 2,
      targetsChecked: 1,
    });
    expect(ghListIssues).toHaveBeenCalledWith('rafiki270', 'max-test', 100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('respects the configured poll interval for each target', async () => {
    const now = vi.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_500);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          connectorId: 'connector-1',
          connectorName: 'GitHub Issues',
          config: { auth_mode: 'local_gh' },
          defaultBranch: 'main',
          platformTypeKey: 'github_issues',
          pollingIntervalSeconds: 300,
          repositoryMappingId: 'mapping-1',
          repositoryUrl: 'https://github.com/rafiki270/max-test',
        },
      ]),
    });
    const ghListIssues = vi.fn().mockResolvedValue([]);

    vi.stubGlobal('fetch', fetchMock);

    const lastPolledAtByTarget = new Map<string, number>();
    await pollTriageTargets({
      apiBaseUrl: 'http://localhost:4441',
      ghListIssues,
      lastPolledAtByTarget,
      now,
      token: 'jwt-token',
    });
    await pollTriageTargets({
      apiBaseUrl: 'http://localhost:4441',
      ghListIssues,
      lastPolledAtByTarget,
      now,
      token: 'jwt-token',
    });

    expect(ghListIssues).toHaveBeenCalledTimes(1);
  });
});
