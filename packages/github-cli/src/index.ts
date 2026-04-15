import { exec } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const GITHUB_HOST = 'github.com';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_LABEL_COLOR = '1D76DB';

const LABEL_DEFINITIONS: Record<string, { color: string; description: string }> = {
  triaged: {
    color: '0E8A16',
    description: 'Processed by SupportAgent triage',
  },
  'complexity-low': {
    color: '1D76DB',
    description: 'Low-complexity issue',
  },
  'complexity-medium': {
    color: 'FBCA04',
    description: 'Medium-complexity issue',
  },
  'complexity-high': {
    color: 'D93F0B',
    description: 'High-complexity issue',
  },
};

export interface GitHubRepositoryOption {
  defaultBranch: string;
  isPrivate: boolean;
  nameWithOwner: string;
  owner: string;
  url: string;
}

export interface GitHubRepositoryOwnerOption {
  login: string;
  type: 'organization' | 'user';
}

export interface GitHubIssueComment {
  author: string;
  body: string;
  createdAt: string;
  id: string;
  url?: string;
}

export interface GitHubIssueSummary {
  body: string | null;
  comments: GitHubIssueComment[];
  labels: string[];
  number: number;
  state: string;
  title: string;
  updatedAt?: string;
  url: string;
}

function tempDir(): string {
  return path.join(
    os.tmpdir(),
    `support-agent-gh-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

async function run(cmd: string, cwd?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const options = cwd ? { cwd, timeout: timeoutMs } : { timeout: timeoutMs };
  const { stdout, stderr } = await execAsync(cmd, options);
  if (stderr) {
    console.warn('[github-cli]', stderr.trim());
  }
  return stdout.trim();
}

async function runQuiet(cmd: string, cwd?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const options = cwd ? { cwd, timeout: timeoutMs } : { timeout: timeoutMs };
  const { stdout } = await execAsync(cmd, options);
  return stdout.trim();
}

function parseLabels(labels: Array<string | { name?: string }> | undefined): string[] {
  return (labels ?? []).map((label) =>
    typeof label === 'string' ? label : label.name ?? '',
  ).filter(Boolean);
}

function parseComments(comments: Array<any> | undefined): GitHubIssueComment[] {
  return (comments ?? []).map((comment) => ({
    id: String(comment.id),
    author: comment.author?.login ?? 'unknown',
    body: comment.body ?? '',
    createdAt: comment.createdAt ?? '',
    url: comment.url,
  }));
}

async function ghGetViewerLogin(): Promise<string> {
  return run(`gh api /user --jq '.login'`);
}

async function ghGetOrganizations(): Promise<string[]> {
  const result = await run(`gh api /user/orgs --jq '.[].login'`);
  return result
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function ghListReposForOwner(owner: string): Promise<GitHubRepositoryOption[]> {
  const out = await run(
    `gh repo list ${owner} --limit 1000 --source --json nameWithOwner,url,defaultBranchRef,isPrivate`,
  );
  const repositories = JSON.parse(out) as Array<{
    defaultBranchRef?: { name?: string } | null;
    isPrivate?: boolean;
    nameWithOwner: string;
    url: string;
  }>;

  return repositories.map((repository) => {
    const [repoOwner] = repository.nameWithOwner.split('/');
    return {
      nameWithOwner: repository.nameWithOwner,
      owner: repoOwner,
      url: repository.url,
      defaultBranch: repository.defaultBranchRef?.name ?? 'main',
      isPrivate: repository.isPrivate ?? false,
    };
  });
}

async function ghCanListReposForOwner(owner: string): Promise<boolean> {
  try {
    await run(
      `gh repo list ${owner} --limit 1 --source --json nameWithOwner`,
      undefined,
      30_000,
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[github-cli] Skipping inaccessible owner ${owner}: ${message}`);
    return false;
  }
}

export async function ghCheckAuth(): Promise<boolean> {
  try {
    await run('gh auth status');
    return true;
  } catch {
    return false;
  }
}

export async function ghListAccessibleRepos(owner?: string): Promise<GitHubRepositoryOption[]> {
  const owners = owner
    ? [owner]
    : [await ghGetViewerLogin(), ...(await ghGetOrganizations())];

  const repositoriesByName = new Map<string, GitHubRepositoryOption>();
  for (const currentOwner of owners) {
    let repositories: GitHubRepositoryOption[];
    try {
      repositories = await ghListReposForOwner(currentOwner);
    } catch (error) {
      if (owner) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[github-cli] Skipping inaccessible owner ${currentOwner}: ${message}`);
      continue;
    }
    for (const repository of repositories) {
      repositoriesByName.set(repository.nameWithOwner, repository);
    }
  }

  return [...repositoriesByName.values()].sort((left, right) =>
    left.nameWithOwner.localeCompare(right.nameWithOwner),
  );
}

export async function ghListAccessibleOwners(): Promise<GitHubRepositoryOwnerOption[]> {
  const viewer = await ghGetViewerLogin();
  const organizations = await ghGetOrganizations();
  const owners: GitHubRepositoryOwnerOption[] = [
    { login: viewer, type: 'user' },
    ...organizations.map((login): GitHubRepositoryOwnerOption => ({
      login,
      type: 'organization',
    })),
  ];
  const accessChecks = await Promise.all(
    owners.map(async (owner) => ({
      ...owner,
      canListRepos: await ghCanListReposForOwner(owner.login),
    })),
  );

  return accessChecks
    .filter((owner) => owner.canListRepos)
    .map((owner) => ({ login: owner.login, type: owner.type }))
    .sort((left, right) => left.login.localeCompare(right.login));
}

export async function ghCloneRepo(
  repoUrl: string,
  branch?: string,
): Promise<{ branch: string; workDir: string }> {
  const dir = tempDir();
  await fs.mkdir(dir, { recursive: true });
  const branchArg = branch ? `--branch ${branch}` : '';

  let remoteUrl = repoUrl;
  if (repoUrl.startsWith('https://')) {
    const match = repoUrl.match(/https:\/\/github\.com\/(.+?)(?:\.git)?$/);
    remoteUrl = match ? `git@github.com:${match[1]}` : repoUrl;
  } else if (!repoUrl.startsWith('git@')) {
    remoteUrl = `git@github.com:${repoUrl.replace(/\.git$/, '')}`;
  }

  await run(`git clone ${branchArg} --depth 1 ${remoteUrl} .`, dir);
  const currentBranch =
    (await run('git branch --show-current', dir)).trim() || branch || 'main';
  return { workDir: dir, branch: currentBranch };
}

export async function ghCreateBranch(workDir: string, branchName: string): Promise<void> {
  await run(`git checkout -b ${branchName}`, workDir);
  await run(`git push -u origin ${branchName}`, workDir);
}

export async function ghCommitFiles(
  workDir: string,
  files: Array<{ content: string; path: string }>,
  message: string,
): Promise<void> {
  for (const file of files) {
    const filePath = path.join(workDir, file.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content, 'utf-8');
    await run(`git add ${file.path}`, workDir);
  }

  await run(`git commit -m "${message.replace(/"/g, '\\"')}"`, workDir);
  await run('git push', workDir);
}

export async function ghCommitAll(workDir: string, message: string): Promise<void> {
  await run('git add -A', workDir);
  await run(`git commit -m "${message.replace(/"/g, '\\"')}"`, workDir);
  await run('git push', workDir);
}

export async function ghGetIssue(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GitHubIssueSummary> {
  const out = await run(
    `gh issue view ${issueNumber} --repo ${owner}/${repo} --json number,title,body,state,labels,comments,url`,
  );
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
  const out = await run(
    `gh issue list --repo ${owner}/${repo} --state open --limit ${limit} --json number,title,body,state,labels,comments,url,updatedAt`,
  );
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
  const out = await run(
    `gh pr view ${prNumber} --repo ${owner}/${repo} --json number,title,body,state,mergedAt,mergeable,baseRefName,headRefName,url`,
  );
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
  return run(`gh pr diff ${prNumber} --repo ${owner}/${repo}`, undefined, 30_000);
}

export async function ghGetPRFiles(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string[]> {
  const out = await run(`gh pr view ${prNumber} --repo ${owner}/${repo} --json files`);
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
): Promise<{ number: number; url: string }> {
  const bodyFile = path.join(os.tmpdir(), `pr-body-${Date.now()}.txt`);
  await fs.writeFile(bodyFile, body, 'utf-8');
  try {
    const out = await runQuiet(
      `gh pr create --repo ${owner}/${repo} --title "${title.replace(/"/g, '\\"')}" --body-file "${bodyFile}" --base ${baseBranch} --head ${headBranch}`,
    );
    const url = out.startsWith('http')
      ? out
      : `https://${GITHUB_HOST}/${owner}/${repo}/pull/${out}`;
    const match = url.match(/\/pull\/(\d+)/);
    return {
      number: match ? Number.parseInt(match[1], 10) : 0,
      url,
    };
  } catch (error: any) {
    const message = error?.message ?? String(error);
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
  const out = await run(
    `gh pr list --repo ${owner}/${repo} --state open --head ${headBranch} --json number,title,state,headRefName,baseRefName,url`,
  );
  return JSON.parse(out);
}

export async function ghMergePR(
  owner: string,
  repo: string,
  prNumber: number,
  method: 'merge' | 'rebase' | 'squash' = 'squash',
): Promise<void> {
  await run(`gh pr merge ${prNumber} --repo ${owner}/${repo} --${method} --delete-branch`, undefined, 30_000);
}

export async function ghAddPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  comment: string,
): Promise<void> {
  const bodyFile = path.join(os.tmpdir(), `pr-comment-${Date.now()}.txt`);
  await fs.writeFile(bodyFile, comment, 'utf-8');
  try {
    await run(`gh pr comment ${prNumber} --repo ${owner}/${repo} --body-file "${bodyFile}"`);
  } finally {
    await fs.unlink(bodyFile).catch(() => undefined);
  }
}

export async function ghListOpenPRs(
  owner: string,
  repo: string,
): Promise<Array<{ base: string; head: string; number: number; state: string; title: string }>> {
  const out = await run(
    `gh pr list --repo ${owner}/${repo} --state open --json number,title,state,headRefName,baseRefName`,
  );
  return JSON.parse(out);
}

export async function ghAddIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  comment: string,
): Promise<void> {
  const bodyFile = path.join(os.tmpdir(), `issue-comment-${Date.now()}.txt`);
  await fs.writeFile(bodyFile, comment, 'utf-8');
  try {
    await run(`gh issue comment ${issueNumber} --repo ${owner}/${repo} --body-file "${bodyFile}"`);
  } finally {
    await fs.unlink(bodyFile).catch(() => undefined);
  }
}

export async function ghAddIssueLabels(
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[],
): Promise<void> {
  if (!labels.length) {
    return;
  }

  for (const label of labels) {
    const definition = LABEL_DEFINITIONS[label] ?? {
      color: DEFAULT_LABEL_COLOR,
      description: 'Managed by SupportAgent',
    };

    await run(
      `gh label create "${label}" --repo ${owner}/${repo} --force --color ${definition.color} --description "${definition.description}"`,
    );
  }

  await run(
    `gh issue edit ${issueNumber} --repo ${owner}/${repo} --add-label "${labels.join(',')}"`,
  );
}

export async function ghPostPRStatus(
  owner: string,
  repo: string,
  prNumber: number,
  state: 'error' | 'failure' | 'pending' | 'success',
  description: string,
): Promise<void> {
  await run(
    `gh pr edit ${prNumber} --repo ${owner}/${repo} --body "## AI Review Status: ${state.toUpperCase()}\n\n${description}"`,
  );
}

export function parseGitHubRef(ref: string): { owner: string; repo: string } {
  if (!ref.includes('/')) {
    throw new Error(`Invalid GitHub ref: ${ref}`);
  }

  const [owner, repo] = ref
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .split('/');
  return { owner, repo };
}

export async function cleanupWorkDir(workDir: string): Promise<void> {
  try {
    await fs.rm(workDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors from temp directories.
  }
}
