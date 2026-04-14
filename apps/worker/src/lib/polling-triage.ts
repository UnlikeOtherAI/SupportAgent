import { ghListOpenIssues, parseGitHubRef, type GitHubIssueSummary } from '@support-agent/github-cli';
import { hasDiscoveryComment, hasTriagedLabel } from './triage-discovery-comment.js';

export interface PollingTriageTarget {
  connectorId: string;
  connectorName: string;
  config: Record<string, string>;
  defaultBranch: string;
  platformTypeKey: string;
  pollingIntervalSeconds: number;
  repositoryMappingId: string;
  repositoryUrl: string;
}

export interface PollingTriageStats {
  created: number;
  duplicate: number;
  skipped: number;
  targetsChecked: number;
}

async function apiGet<T>(path: string, token: string, apiBaseUrl: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GET ${path} failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<T>;
}

async function apiPost<T>(
  path: string,
  token: string,
  apiBaseUrl: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`POST ${path} failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<T>;
}

export async function pollTriageTargets(input: {
  apiBaseUrl: string;
  ghListIssues?: (owner: string, repo: string, limit?: number) => Promise<GitHubIssueSummary[]>;
  lastPolledAtByTarget: Map<string, number>;
  log?: (message: string) => void;
  now?: () => number;
  token: string;
}): Promise<PollingTriageStats> {
  const now = input.now ?? Date.now;
  const ghListIssues = input.ghListIssues ?? ghListOpenIssues;
  const stats: PollingTriageStats = {
    created: 0,
    duplicate: 0,
    skipped: 0,
    targetsChecked: 0,
  };

  const targets = await apiGet<PollingTriageTarget[]>(
    '/v1/polling/triage-targets',
    input.token,
    input.apiBaseUrl,
  );

  for (const target of targets) {
    const targetKey = `${target.connectorId}:${target.repositoryMappingId}`;
    const lastPolledAt = input.lastPolledAtByTarget.get(targetKey);
    if (lastPolledAt && now() - lastPolledAt < target.pollingIntervalSeconds * 1000) {
      continue;
    }

    const { owner, repo } = parseGitHubRef(target.repositoryUrl);
    const issues = await ghListIssues(owner, repo, 100);
    input.lastPolledAtByTarget.set(targetKey, now());
    stats.targetsChecked++;

    for (const issue of issues) {
      if (hasTriagedLabel(issue) || hasDiscoveryComment(issue)) {
        stats.skipped++;
        continue;
      }

      const result = await apiPost<{ status: 'created' | 'duplicate' }>(
        '/v1/polling/triage-enqueue',
        input.token,
        input.apiBaseUrl,
        {
          connectorId: target.connectorId,
          repositoryMappingId: target.repositoryMappingId,
          issue,
        },
      );

      stats[result.status]++;
      input.log?.(
        `[polling] ${result.status === 'created' ? 'Queued' : 'Skipped duplicate'} ${owner}/${repo}#${issue.number}`,
      );
    }
  }

  return stats;
}
