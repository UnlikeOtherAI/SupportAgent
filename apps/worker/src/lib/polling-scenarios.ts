import {
  ghListOpenIssues,
  ghListClosedIssues,
  ghListOpenPRs,
  ghListMergedPRs,
  ghListPrComments,
  parseGitHubRef,
  type GitHubIssueSummary,
  type GitHubPrComment,
} from '@support-agent/github-cli';
import {
  matchesPrCommentTrigger,
  matchesIssueOpenedTrigger,
  matchesIssueLabeledTrigger,
  type CompiledScenario,
} from './trigger-matchers.js';

export type { CompiledScenario };

export interface PollingScenarioTarget {
  connectorId: string;
  connectorName: string;
  config: Record<string, string>;
  defaultBranch: string;
  platformTypeKey: string;
  pollingIntervalSeconds: number;
  repositoryMappingId: string;
  repositoryUrl: string;
}

export interface PollingStats {
  created: number;
  duplicate: number;
  eventsEmitted: number;
  targetsChecked: number;
}

interface PrSummary {
  body: string | null;
  number: number;
  state: string;
  title: string;
  updatedAt: string;
  url: string;
  base: string;
  head: string;
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

function scenarioAppliesToConnector(scenario: CompiledScenario, connectorId: string) {
  if (scenario.connectorIds.length === 0) return true;
  return scenario.connectorIds.includes(connectorId);
}

function matchesPrOpenedTrigger(scenario: CompiledScenario) {
  return scenario.trigger.kind === 'github.pull_request.opened';
}

function anyScenarioWantsIssues(scenarios: CompiledScenario[]) {
  return scenarios.some(
    (scenario) =>
      scenario.trigger.kind === 'github.issue.opened' ||
      scenario.trigger.kind === 'github.issue.labeled',
  );
}

function anyScenarioWantsClosedIssues(scenarios: CompiledScenario[]) {
  return scenarios.some((scenario) => scenario.trigger.kind === 'github.issue.closed_comment');
}

function anyScenarioWantsPrs(scenarios: CompiledScenario[]) {
  return scenarios.some(
    (scenario) =>
      scenario.trigger.kind === 'github.pull_request.opened' ||
      scenario.trigger.kind === 'github.pull_request.comment',
  );
}

function anyScenarioWantsMergedPrs(scenarios: CompiledScenario[]) {
  return scenarios.some((scenario) => scenario.trigger.kind === 'github.pull_request.merged');
}

function anyScenarioWantsPrComments(scenarios: CompiledScenario[]) {
  return scenarios.some((scenario) => scenario.trigger.kind === 'github.pull_request.comment');
}

function matchesMergedPrTrigger(scenario: CompiledScenario) {
  return scenario.trigger.kind === 'github.pull_request.merged';
}

function matchesClosedCommentTrigger(scenario: CompiledScenario, commentBody: string) {
  if (scenario.trigger.kind !== 'github.issue.closed_comment') return false;
  const keyword =
    typeof scenario.trigger.config.keyword === 'string'
      ? scenario.trigger.config.keyword.trim()
      : '';
  if (keyword === '') return true;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<!\\w)${escaped}(?!\\w)`).test(commentBody);
}

interface DispatchEventInput {
  apiBaseUrl: string;
  token: string;
  scenario: CompiledScenario;
  event: Record<string, unknown>;
  stats: PollingStats;
  log?: (message: string) => void;
}

async function dispatchScenarioEvent(input: DispatchEventInput) {
  if (!input.scenario.action) return;
  const result = await apiPost<{ status: 'created' | 'duplicate' }>(
    '/v1/polling/event',
    input.token,
    input.apiBaseUrl,
    {
      scenarioId: input.scenario.scenarioId,
      actionKind: input.scenario.action.kind,
      event: input.event,
    },
  );
  input.stats.eventsEmitted++;
  if (result.status === 'created') {
    input.stats.created++;
  } else {
    input.stats.duplicate++;
  }
  input.log?.(
    `[polling] ${input.scenario.scenarioKey} ${result.status} for event=${String(input.event.kind)}`,
  );
}

async function processIssuesForTarget(input: {
  apiBaseUrl: string;
  token: string;
  target: PollingScenarioTarget;
  scenarios: CompiledScenario[];
  issues: GitHubIssueSummary[];
  closedIssues: GitHubIssueSummary[];
  stats: PollingStats;
  log?: (message: string) => void;
}) {
  for (const issue of input.issues) {
    for (const scenario of input.scenarios) {
      if (!scenarioAppliesToConnector(scenario, input.target.connectorId)) continue;

      if (matchesIssueOpenedTrigger(scenario)) {
        await dispatchScenarioEvent({
          apiBaseUrl: input.apiBaseUrl,
          token: input.token,
          scenario,
          event: {
            kind: 'github.issue.opened',
            connectorId: input.target.connectorId,
            repositoryMappingId: input.target.repositoryMappingId,
            issue,
          },
          stats: input.stats,
          log: input.log,
        });
      }

      for (const label of issue.labels) {
        if (!matchesIssueLabeledTrigger(scenario, label)) continue;
        await dispatchScenarioEvent({
          apiBaseUrl: input.apiBaseUrl,
          token: input.token,
          scenario,
          event: {
            kind: 'github.issue.labeled',
            connectorId: input.target.connectorId,
            repositoryMappingId: input.target.repositoryMappingId,
            label,
            issue,
          },
          stats: input.stats,
          log: input.log,
        });
      }
    }
  }

  for (const issue of input.closedIssues) {
    for (const comment of issue.comments) {
      for (const scenario of input.scenarios) {
        if (!scenarioAppliesToConnector(scenario, input.target.connectorId)) continue;
        if (!matchesClosedCommentTrigger(scenario, comment.body)) continue;

        await dispatchScenarioEvent({
          apiBaseUrl: input.apiBaseUrl,
          token: input.token,
          scenario,
          event: {
            kind: 'github.issue.closed_comment',
            connectorId: input.target.connectorId,
            repositoryMappingId: input.target.repositoryMappingId,
            issue,
            comment: {
              id: comment.id,
              author: comment.author,
              body: comment.body,
              createdAt: comment.createdAt,
              url: comment.url,
            },
          },
          stats: input.stats,
          log: input.log,
        });
      }
    }
  }
}

async function processPrsForTarget(input: {
  apiBaseUrl: string;
  token: string;
  target: PollingScenarioTarget;
  scenarios: CompiledScenario[];
  prs: PrSummary[];
  mergedPrs: PrSummary[];
  loadComments: (prNumber: number) => Promise<GitHubPrComment[]>;
  stats: PollingStats;
  log?: (message: string) => void;
}) {
  const wantsComments = anyScenarioWantsPrComments(input.scenarios);

  for (const pr of input.prs) {
    for (const scenario of input.scenarios) {
      if (!scenarioAppliesToConnector(scenario, input.target.connectorId)) continue;

      if (matchesPrOpenedTrigger(scenario)) {
        await dispatchScenarioEvent({
          apiBaseUrl: input.apiBaseUrl,
          token: input.token,
          scenario,
          event: {
            kind: 'github.pull_request.opened',
            connectorId: input.target.connectorId,
            repositoryMappingId: input.target.repositoryMappingId,
            pr: {
              number: pr.number,
              state: pr.state,
              title: pr.title,
              body: pr.body,
              updatedAt: pr.updatedAt,
              url: pr.url,
              baseRef: pr.base,
              headRef: pr.head,
            },
          },
          stats: input.stats,
          log: input.log,
        });
      }
    }

    if (!wantsComments) continue;
    const comments = await input.loadComments(pr.number).catch(() => [] as GitHubPrComment[]);
    for (const comment of comments) {
      for (const scenario of input.scenarios) {
        if (!scenarioAppliesToConnector(scenario, input.target.connectorId)) continue;
        if (!matchesPrCommentTrigger(scenario, { body: comment.body, author: comment.author })) continue;

        await dispatchScenarioEvent({
          apiBaseUrl: input.apiBaseUrl,
          token: input.token,
          scenario,
          event: {
            kind: 'github.pull_request.comment',
            connectorId: input.target.connectorId,
            repositoryMappingId: input.target.repositoryMappingId,
            pr: {
              number: pr.number,
              state: pr.state,
              title: pr.title,
              body: pr.body,
              updatedAt: pr.updatedAt,
              url: pr.url,
              baseRef: pr.base,
              headRef: pr.head,
            },
            comment: {
              id: comment.id,
              author: comment.author,
              body: comment.body,
              createdAt: comment.createdAt,
              url: comment.url,
            },
          },
          stats: input.stats,
          log: input.log,
        });
      }
    }
  }

  for (const pr of input.mergedPrs) {
    for (const scenario of input.scenarios) {
      if (!scenarioAppliesToConnector(scenario, input.target.connectorId)) continue;
      if (!matchesMergedPrTrigger(scenario)) continue;

      await dispatchScenarioEvent({
        apiBaseUrl: input.apiBaseUrl,
        token: input.token,
        scenario,
        event: {
          kind: 'github.pull_request.merged',
          connectorId: input.target.connectorId,
          repositoryMappingId: input.target.repositoryMappingId,
          pr: {
            number: pr.number,
            state: pr.state,
            title: pr.title,
            body: pr.body,
            updatedAt: pr.updatedAt,
            url: pr.url,
            baseRef: pr.base,
            headRef: pr.head,
          },
        },
        stats: input.stats,
        log: input.log,
      });
    }
  }
}

export async function pollScenarioTargets(input: {
  apiBaseUrl: string;
  token: string;
  lastPolledAtByTarget: Map<string, number>;
  ghListIssues?: (owner: string, repo: string, limit?: number) => Promise<GitHubIssueSummary[]>;
  ghListClosedIssues?: (owner: string, repo: string, opts?: { limit?: number }) => Promise<GitHubIssueSummary[]>;
  ghListPrs?: (owner: string, repo: string) => Promise<PrSummary[]>;
  ghListMergedPrs?: (owner: string, repo: string, opts?: { limit?: number }) => Promise<PrSummary[]>;
  ghListPrComments?: (owner: string, repo: string, prNumber: number) => Promise<GitHubPrComment[]>;
  now?: () => number;
  log?: (message: string) => void;
}): Promise<PollingStats> {
  const now = input.now ?? Date.now;
  const listIssues = input.ghListIssues ?? ghListOpenIssues;
  const listClosedIssues = input.ghListClosedIssues ?? ghListClosedIssues;
  const listPrs = input.ghListPrs ?? ghListOpenPRs;
  const listMergedPrs = input.ghListMergedPrs ?? ghListMergedPRs;
  const listPrComments = input.ghListPrComments ?? ghListPrComments;

  const stats: PollingStats = {
    created: 0,
    duplicate: 0,
    eventsEmitted: 0,
    targetsChecked: 0,
  };

  const [targets, scenarios] = await Promise.all([
    apiGet<PollingScenarioTarget[]>('/v1/polling/triage-targets', input.token, input.apiBaseUrl),
    apiGet<CompiledScenario[]>('/v1/polling/matchable-scenarios', input.token, input.apiBaseUrl),
  ]);

  if (scenarios.length === 0) {
    input.log?.('[polling] no enabled scenarios — skipping');
    return stats;
  }

  for (const target of targets) {
    const targetKey = `${target.connectorId}:${target.repositoryMappingId}`;
    const lastPolledAt = input.lastPolledAtByTarget.get(targetKey);
    if (lastPolledAt && now() - lastPolledAt < target.pollingIntervalSeconds * 1000) {
      continue;
    }

    const scenariosForTarget = scenarios.filter((scenario) =>
      scenarioAppliesToConnector(scenario, target.connectorId),
    );
    if (scenariosForTarget.length === 0) {
      input.lastPolledAtByTarget.set(targetKey, now());
      continue;
    }

    const { owner, repo } = parseGitHubRef(target.repositoryUrl);
    input.lastPolledAtByTarget.set(targetKey, now());
    stats.targetsChecked++;

    if (anyScenarioWantsIssues(scenariosForTarget) || anyScenarioWantsClosedIssues(scenariosForTarget)) {
      const [issues, closedIssues] = await Promise.all([
        anyScenarioWantsIssues(scenariosForTarget) ? listIssues(owner, repo, 100) : Promise.resolve([] as GitHubIssueSummary[]),
        anyScenarioWantsClosedIssues(scenariosForTarget) ? listClosedIssues(owner, repo, { limit: 30 }) : Promise.resolve([] as GitHubIssueSummary[]),
      ]);
      await processIssuesForTarget({
        apiBaseUrl: input.apiBaseUrl,
        token: input.token,
        target,
        scenarios: scenariosForTarget,
        issues,
        closedIssues,
        stats,
        log: input.log,
      });
    }

    if (anyScenarioWantsPrs(scenariosForTarget) || anyScenarioWantsMergedPrs(scenariosForTarget)) {
      const [prs, mergedPrs] = await Promise.all([
        anyScenarioWantsPrs(scenariosForTarget) ? listPrs(owner, repo) : Promise.resolve([] as PrSummary[]),
        anyScenarioWantsMergedPrs(scenariosForTarget) ? listMergedPrs(owner, repo, { limit: 30 }) : Promise.resolve([] as PrSummary[]),
      ]);
      await processPrsForTarget({
        apiBaseUrl: input.apiBaseUrl,
        token: input.token,
        target,
        scenarios: scenariosForTarget,
        prs,
        mergedPrs,
        loadComments: (prNumber) => listPrComments(owner, repo, prNumber),
        stats,
        log: input.log,
      });
    }
  }

  return stats;
}
