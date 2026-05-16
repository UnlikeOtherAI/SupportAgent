import { runArgv } from './run.js';
import { parseComments, parseLabels } from './parse.js';
import type { GitHubIssueSummary } from './types.js';

export async function ghGetIssue(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GitHubIssueSummary> {
  const out = await runArgv('gh', [
    'issue', 'view', String(issueNumber),
    '--repo', `${owner}/${repo}`,
    '--json', 'number,title,body,state,labels,comments,url',
  ]);
  const data = JSON.parse(out);
  return {
    number: data.number,
    title: data.title,
    body: data.body,
    state: data.state,
    labels: parseLabels(data.labels),
    comments: parseComments(data.comments),
    url: data.url,
  };
}

export async function ghListOpenIssues(
  owner: string,
  repo: string,
  limit = 100,
): Promise<GitHubIssueSummary[]> {
  const out = await runArgv('gh', [
    'issue', 'list',
    '--repo', `${owner}/${repo}`,
    '--state', 'open',
    '--limit', String(limit),
    '--json', 'number,title,body,state,labels,comments,url,updatedAt',
  ]);
  const issues = JSON.parse(out) as Array<any>;
  return issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body ?? null,
    state: issue.state,
    labels: parseLabels(issue.labels),
    comments: parseComments(issue.comments),
    url: issue.url,
    updatedAt: issue.updatedAt,
  }));
}

export async function ghListClosedIssues(
  owner: string,
  repo: string,
  opts?: { limit?: number },
): Promise<GitHubIssueSummary[]> {
  const limit = opts?.limit ?? 30;
  const out = await runArgv('gh', [
    'issue', 'list',
    '--repo', `${owner}/${repo}`,
    '--state', 'closed',
    '--json', 'number,title,body,state,labels,comments,url,updatedAt',
    '--limit', String(limit),
  ]);
  const issues = JSON.parse(out) as Array<any>;
  return issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body ?? null,
    state: issue.state,
    labels: parseLabels(issue.labels),
    comments: parseComments(issue.comments),
    url: issue.url,
    updatedAt: issue.updatedAt,
  }));
}

export async function ghCloseIssue(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<void> {
  await runArgv('gh', [
    'issue', 'close', String(issueNumber),
    '--repo', `${owner}/${repo}`,
  ]);
}

export async function ghReopenIssue(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<void> {
  await runArgv('gh', [
    'issue', 'reopen', String(issueNumber),
    '--repo', `${owner}/${repo}`,
  ]);
}
