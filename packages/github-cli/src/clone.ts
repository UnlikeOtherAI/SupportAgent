import * as fs from 'node:fs/promises';
import { runArgv } from './run.js';
import { tempDir } from './temp.js';

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._\-/]+$/;

function assertSafeBranchName(branch: string): void {
  if (!branch || branch.length > 255) {
    throw new Error(`Invalid branch name: ${JSON.stringify(branch)}`);
  }
  if (!BRANCH_NAME_PATTERN.test(branch)) {
    throw new Error(
      `Branch name contains disallowed characters: ${JSON.stringify(branch)}`,
    );
  }
  if (branch.startsWith('-')) {
    throw new Error(`Branch name must not start with '-': ${JSON.stringify(branch)}`);
  }
  if (branch.includes('..')) {
    throw new Error(`Branch name must not contain '..': ${JSON.stringify(branch)}`);
  }
}

export async function ghCloneRepo(
  repoUrl: string,
  branch?: string,
): Promise<{ branch: string; workDir: string }> {
  const dir = tempDir();
  await fs.mkdir(dir, { recursive: true });

  let remoteUrl = repoUrl;
  if (repoUrl.startsWith('https://')) {
    const match = repoUrl.match(/https:\/\/github\.com\/(.+?)(?:\.git)?$/);
    remoteUrl = match ? `git@github.com:${match[1]}` : repoUrl;
  } else if (!repoUrl.startsWith('git@')) {
    remoteUrl = `git@github.com:${repoUrl.replace(/\.git$/, '')}`;
  }

  const cloneArgs = ['clone'];
  if (branch) {
    assertSafeBranchName(branch);
    cloneArgs.push('--branch', branch);
  }
  cloneArgs.push('--depth', '1', '--', remoteUrl, '.');

  await runArgv('git', cloneArgs, { cwd: dir });
  const currentBranch =
    (await runArgv('git', ['branch', '--show-current'], { cwd: dir })).trim() ||
    branch ||
    'main';
  return { workDir: dir, branch: currentBranch };
}

export async function ghCreateBranch(workDir: string, branchName: string): Promise<void> {
  assertSafeBranchName(branchName);
  await runArgv('git', ['checkout', '-b', branchName], { cwd: workDir });
  await runArgv('git', ['push', '-u', 'origin', branchName], { cwd: workDir });
}

export { assertSafeBranchName };
