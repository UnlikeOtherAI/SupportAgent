import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const execAsync = promisify(exec);

const GITHUB_HOST = 'github.com';
const DEFAULT_TIMEOUT_MS = 120_000;

function tempDir(): string {
  return path.join(os.tmpdir(), `support-agent-gh-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

async function run(cmd: string, cwd?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const opts = cwd ? { cwd, timeout: timeoutMs } : { timeout: timeoutMs };
  const { stdout, stderr } = await execAsync(cmd, opts);
  if (stderr) console.warn('[gh-cli]', stderr.trim());
  return stdout.trim();
}

async function runQuiet(cmd: string, cwd?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  // Like run() but ignores stderr — use for commands that write to stderr on success
  // (e.g., gh writes progress to stderr)
  const opts = cwd ? { cwd, timeout: timeoutMs } : { timeout: timeoutMs };
  const { stdout } = await execAsync(cmd, opts);
  return stdout.trim();
}

/** Verify gh is authenticated */
export async function ghCheckAuth(): Promise<boolean> {
  try {
    await run('gh auth status');
    return true;
  } catch {
    return false;
  }
}

/** Clone a repo into a temp dir, return the path */
export async function ghCloneRepo(
  repoUrl: string,
  branch?: string,
): Promise<{ workDir: string; branch: string }> {
  const dir = tempDir();
  await fs.mkdir(dir, { recursive: true });
  const branchArg = branch ? `--branch ${branch}` : '';
  // Normalize: git@github.com:owner/repo.git or https://github.com/owner/repo.git → git@github.com:owner/repo.git
  let remoteUrl = repoUrl;
  if (repoUrl.startsWith('https://')) {
    // Convert https://github.com/owner/repo.git → git@github.com:owner/repo.git
    const match = repoUrl.match(/https:\/\/github\.com\/(.+?)(?:\.git)?$/);
    remoteUrl = match ? `git@github.com:${match[1]}` : repoUrl;
  } else if (!repoUrl.startsWith('git@')) {
    // Bare owner/repo format → git@github.com:owner/repo.git
    remoteUrl = `git@github.com:${repoUrl.replace(/\.git$/, '')}`;
  }
  await run(`git clone ${branchArg} --depth 1 ${remoteUrl} .`, dir);
  const currentBranch = (await run('git branch --show-current', dir)).trim() || branch || 'main';
  return { workDir: dir, branch: currentBranch };
}

/** Create and push a new branch */
export async function ghCreateBranch(
  workDir: string,
  branchName: string,
): Promise<void> {
  await run('git checkout -b ' + branchName, workDir);
  await run('git push -u origin ' + branchName, workDir);
}

/** Stage, commit, and push one or more files */
export async function ghCommitFiles(
  workDir: string,
  files: Array<{ path: string; content: string }>,
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

/** Stage all changed files, commit, and push */
export async function ghCommitAll(
  workDir: string,
  message: string,
): Promise<void> {
  await run('git add -A', workDir);
  await run(`git commit -m "${message.replace(/"/g, '\\"')}"`, workDir);
  await run('git push', workDir);
}

/** Get issue details */
export async function ghGetIssue(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<{
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: string[];
}> {
  const out = await run(
    `gh issue view ${issueNumber} --repo ${owner}/${repo} --json number,title,body,state,labels`,
  );
  const data = JSON.parse(out);
  return {
    number: data.number,
    title: data.title,
    body: data.body,
    state: data.state,
    labels: (data.labels ?? []).map((l: any) => typeof l === 'string' ? l : l.name),
  };
}

/** Get PR details */
export async function ghGetPR(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged: boolean;
  mergedAt: string | null;
  mergeable: boolean;
  base: string;
  head: string;
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

/** Get PR diff */
export async function ghGetPRDiff(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string> {
  return run(`gh pr diff ${prNumber} --repo ${owner}/${repo}`, undefined, 30_000);
}

/** Get PR changed files */
export async function ghGetPRFiles(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string[]> {
  const out = await run(`gh pr view ${prNumber} --repo ${owner}/${repo} --json files`);
  const data = JSON.parse(out);
  return (data.files ?? []).map((f: any) => f.filename as string);
}

/** Create a PR, return the PR number */
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
    // gh returns URL on success
    const url = out.startsWith('http') ? out : `https://github.com/${owner}/${repo}/pulls/${out}`;
    const match = url.match(/\/pull\/(\d+)/);
    const number = match ? parseInt(match[1]) : 0;
    return { number, url };
  } catch (err: any) {
    // If the PR already exists, extract the PR number from the error message
    const msg = err?.message ?? String(err);
    if (msg.includes('already exists')) {
      const existingMatch = msg.match(/https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/(\d+)/);
      if (existingMatch) {
        const number = parseInt(existingMatch[1]);
        return { number, url: `https://github.com/${owner}/${repo}/pull/${number}` };
      }
      // Fallback: look up by head branch
      const prs = await ghListOpenPRsForBranch(owner, repo, headBranch);
      if (prs.length > 0) {
        return { number: prs[0].number, url: prs[0].url };
      }
    }
    throw err;
  } finally {
    await fs.unlink(bodyFile).catch(() => {});
  }
}

/** List open PRs targeting a specific head branch */
export async function ghListOpenPRsForBranch(
  owner: string,
  repo: string,
  headBranch: string,
): Promise<Array<{ number: number; title: string; state: string; head: string; base: string; url: string }>> {
  const out = await run(
    `gh pr list --repo ${owner}/${repo} --state open --head ${headBranch} --json number,title,state,headRefName,baseRefName,url`,
  );
  return JSON.parse(out);
}

/** Merge a PR */
export async function ghMergePR(
  owner: string,
  repo: string,
  prNumber: number,
  method: 'squash' | 'merge' | 'rebase' = 'squash',
): Promise<void> {
  await run(`gh pr merge ${prNumber} --repo ${owner}/${repo} --${method} --delete-branch`, undefined, 30_000);
}

/** Add a PR comment */
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
    await fs.unlink(bodyFile).catch(() => {});
  }
}

/** List open PRs in a repo */
export async function ghListOpenPRs(
  owner: string,
  repo: string,
): Promise<Array<{ number: number; title: string; state: string; head: string; base: string }>> {
  const out = await run(
    `gh pr list --repo ${owner}/${repo} --state open --json number,title,state,headRefName,baseRefName`,
  );
  return JSON.parse(out);
}

/** Add labels to an issue */
export async function ghAddIssueLabels(
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[],
): Promise<void> {
  if (!labels.length) return;
  await run(`gh issue edit ${issueNumber} --repo ${owner}/${repo} --add-label "${labels.join(',')}"`);
}

/** Post a status check on a PR (success/failure) */
export async function ghPostPRStatus(
  owner: string,
  repo: string,
  prNumber: number,
  state: 'success' | 'failure' | 'pending' | 'error',
  description: string,
): Promise<void> {
  await run(
    `gh pr edit ${prNumber} --repo ${owner}/${repo} --body "## AI Review Status: ${state.toUpperCase()}\n\n${description}"`,
  );
}

/** Parse "owner/repo" from various GitHub URL or shorthand formats */
export function parseGitHubRef(ref: string): { owner: string; repo: string } {
  // Already in owner/repo format
  if (!ref.includes('/')) {
    throw new Error(`Invalid GitHub ref: ${ref}`);
  }
  const [owner, repo] = ref.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').split('/');
  return { owner, repo };
}

/** Delete a temp working directory */
export async function cleanupWorkDir(workDir: string): Promise<void> {
  try {
    await fs.rm(workDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
