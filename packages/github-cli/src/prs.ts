import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runArgv } from './run.js';
import { GITHUB_HOST } from './types.js';
import { assertSafeBranchName } from './clone.js';

export async function ghGetPR(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{
  base: string;
  body: string | null;
  head: string;
  mergeable: boolean;
  merged: boolean;
  mergedAt: string | null;
  number: number;
  state: string;
  title: string;
  url: string;
}> {
  const out = await runArgv('gh', [
    'pr', 'view', String(prNumber),
    '--repo', `${owner}/${repo}`,
    '--json', 'number,title,body,state,mergedAt,mergeable,baseRefName,headRefName,url',
  ]);
  const data = JSON.parse(out);
  return {
    number: data.number,
    title: data.title,
    body: data.body,
    state: data.state,
    merged: data.mergedAt !== null,
    mergedAt: data.mergedAt,
    mergeable: data.mergeable,
    base: data.baseRefName,
    head: data.headRefName,
    url: data.url,
  };
}

export async function ghGetPRDiff(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string> {
  return runArgv(
    'gh',
    ['pr', 'diff', String(prNumber), '--repo', `${owner}/${repo}`],
    { timeoutMs: 30_000 },
  );
}

export async function ghGetPRFiles(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string[]> {
  const out = await runArgv('gh', [
    'pr', 'view', String(prNumber),
    '--repo', `${owner}/${repo}`,
    '--json', 'files',
  ]);
  const data = JSON.parse(out) as { files?: Array<{ filename: string }> };
  return (data.files ?? []).map((file) => file.filename);
}

export async function ghCreatePR(
  owner: string,
  repo: string,
  title: string,
  body: string,
  headBranch: string,
  baseBranch = 'main',
  options?: { draft?: boolean },
): Promise<{ number: number; url: string }> {
  assertSafeBranchName(headBranch);
  assertSafeBranchName(baseBranch);

  const bodyFile = path.join(os.tmpdir(), `pr-body-${Date.now()}.txt`);
  await fs.writeFile(bodyFile, body, 'utf-8');
  try {
    const args = [
      'pr', 'create',
      '--repo', `${owner}/${repo}`,
      '--title', title,
      '--body-file', bodyFile,
      '--base', baseBranch,
      '--head', headBranch,
    ];
    if (options?.draft) {
      args.push('--draft');
    }
    const out = await runArgv('gh', args, { quiet: true });
    const url = out.startsWith('http')
      ? out
      : `https://${GITHUB_HOST}/${owner}/${repo}/pull/${out}`;
    const match = url.match(/\/pull\/(\d+)/);
    return {
      number: match ? Number.parseInt(match[1], 10) : 0,
      url,
    };
  } catch (error: any) {
    const message = (error?.stderr ?? error?.message ?? String(error)) as string;
    if (message.includes('already exists')) {
      const existingMatch = message.match(
        /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/,
      );
      if (existingMatch) {
        const number = Number.parseInt(existingMatch[1], 10);
        return { number, url: `https://${GITHUB_HOST}/${owner}/${repo}/pull/${number}` };
      }

      const existingPrs = await ghListOpenPRsForBranch(owner, repo, headBranch);
      if (existingPrs.length > 0) {
        return { number: existingPrs[0].number, url: existingPrs[0].url };
      }
    }
    throw error;
  } finally {
    await fs.unlink(bodyFile).catch(() => undefined);
  }
}

export async function ghListOpenPRsForBranch(
  owner: string,
  repo: string,
  headBranch: string,
): Promise<
  Array<{ base: string; head: string; number: number; state: string; title: string; url: string }>
> {
  const out = await runArgv('gh', [
    'pr', 'list',
    '--repo', `${owner}/${repo}`,
    '--state', 'open',
    '--head', headBranch,
    '--json', 'number,title,state,headRefName,baseRefName,url',
  ]);
  return JSON.parse(out);
}

export async function ghMergePR(
  owner: string,
  repo: string,
  prNumber: number,
  method: 'merge' | 'rebase' | 'squash' = 'squash',
): Promise<void> {
  await runArgv(
    'gh',
    [
      'pr', 'merge', String(prNumber),
      '--repo', `${owner}/${repo}`,
      `--${method}`,
      '--delete-branch',
    ],
    { timeoutMs: 30_000 },
  );
}

export async function ghListOpenPRs(
  owner: string,
  repo: string,
): Promise<Array<{ base: string; body: string | null; head: string; number: number; state: string; title: string; updatedAt: string; url: string }>> {
  const out = await runArgv('gh', [
    'pr', 'list',
    '--repo', `${owner}/${repo}`,
    '--state', 'open',
    '--json', 'number,title,body,state,headRefName,baseRefName,url,updatedAt',
  ]);
  const prs = JSON.parse(out) as Array<any>;
  return prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    body: pr.body ?? null,
    state: pr.state,
    base: pr.baseRefName,
    head: pr.headRefName,
    url: pr.url,
    updatedAt: pr.updatedAt,
  }));
}

export async function ghListMergedPRs(
  owner: string,
  repo: string,
  opts?: { limit?: number },
): Promise<Array<{ base: string; body: string | null; head: string; number: number; state: string; title: string; updatedAt: string; url: string }>> {
  const limit = opts?.limit ?? 30;
  const out = await runArgv('gh', [
    'pr', 'list',
    '--repo', `${owner}/${repo}`,
    '--state', 'merged',
    '--json', 'number,title,body,state,headRefName,baseRefName,url,updatedAt',
    '--limit', String(limit),
  ]);
  const prs = JSON.parse(out) as Array<any>;
  return prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    body: pr.body ?? null,
    state: pr.state,
    base: pr.baseRefName,
    head: pr.headRefName,
    url: pr.url,
    updatedAt: pr.updatedAt,
  }));
}

export async function ghApprovePR(
  owner: string,
  repo: string,
  prNumber: number,
  body = 'SupportAgent approved this pull request.',
): Promise<void> {
  await runArgv('gh', [
    'pr', 'review', String(prNumber),
    '--repo', `${owner}/${repo}`,
    '--approve',
    '--body', body,
  ]);
}

export async function ghRequestChangesPR(
  owner: string,
  repo: string,
  prNumber: number,
  body = 'SupportAgent requested changes.',
): Promise<void> {
  await runArgv('gh', [
    'pr', 'review', String(prNumber),
    '--repo', `${owner}/${repo}`,
    '--request-changes',
    '--body', body,
  ]);
}

export async function ghPostPRStatus(
  owner: string,
  repo: string,
  prNumber: number,
  state: 'error' | 'failure' | 'pending' | 'success',
  description: string,
): Promise<void> {
  const body = `## AI Review Status: ${state.toUpperCase()}\n\n${description}`;
  await runArgv('gh', [
    'pr', 'edit', String(prNumber),
    '--repo', `${owner}/${repo}`,
    '--body', body,
  ]);
}
