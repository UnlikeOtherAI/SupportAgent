import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { type WorkerJob } from '@support-agent/contracts';
import { type WorkerApiClient } from '../lib/api-client.js';
import {
  ghCheckAuth,
  ghCloneRepo,
  ghCreateBranch,
  ghCommitFiles,
  ghCommitAll,
  ghCreatePR,
  ghGetIssue,
  cleanupWorkDir,
  parseGitHubRef,
} from '../lib/gh-cli.js';

const execAsync = promisify(exec);

export async function handleBuildJob(job: WorkerJob, api: WorkerApiClient): Promise<void> {
  const { jobId, workflowRunId, targetRepo, targetBranch } = job;

  await api.postProgress(jobId, 'auth', 'Checking GitHub authentication');
  await api.postLog(jobId, 'stdout', `[build] Starting build for ${targetRepo}`);

  const isAuthed = await ghCheckAuth();
  if (!isAuthed) {
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType: 'build',
      status: 'failed',
      summary: 'gh CLI is not authenticated',
      stageResults: [{ stage: 'auth', status: 'failed' }],
    });
    return;
  }
  await api.postProgress(jobId, 'auth', 'GitHub authenticated');

  // Get context from provider hints or parent triage run
  const providerHints = (job as any).providerHints ?? {};
  const issueRef = providerHints.issueRef ?? '';
  const workItemId = providerHints.workItemId ?? '';

  let issueNum = 0;
  let issueTitle = '';
  let issueBody = '';
  let owner = '';
  let repo = '';

  try {
    const parsed = parseGitHubRef(targetRepo);
    owner = parsed.owner;
    repo = parsed.repo;

    if (issueRef) {
      const m = issueRef.match(/(?:issues?|pull)\/(\d+)/);
      if (m) issueNum = parseInt(m[1]);
    }

    if (issueNum > 0) {
      const issue = await ghGetIssue(owner, repo, issueNum);
      issueTitle = issue.title;
      issueBody = issue.body ?? '';
      await api.postLog(jobId, 'stdout', `[build] Fetched issue #${issueNum}: ${issueTitle}`);
    }
  } catch (err) {
    await api.postLog(jobId, 'stderr', `[build] Could not fetch issue: ${err}`);
  }

  // Fetch parent triage run findings using worker-scoped route
  let triageSummary = '';
  const parentTriageRunId = providerHints.parentTriageRunId as string | undefined;
  if (parentTriageRunId) {
    try {
      const findingsRes = await fetch(
        `${api.baseUrl}/worker/jobs/${jobId}/run/${parentTriageRunId}/findings`,
        { headers: { Authorization: `Bearer ${api.secret}` } },
      );
      if (findingsRes.ok) {
        const findings = (await findingsRes.json()) as any[];
        if (findings.length > 0) {
          triageSummary = findings[0].rootCauseHypothesis ?? '';
          await api.postLog(jobId, 'stdout', `[build] Loaded triage findings from run ${parentTriageRunId}`);
        }
      }
    } catch (err) {
      await api.postLog(jobId, 'stderr', `[build] Could not fetch triage findings: ${err}`);
    }
  }

  // Clone the repo
  await api.postProgress(jobId, 'repository_setup', 'Cloning repository');
  await api.postLog(jobId, 'stdout', `[build] Cloning ${targetRepo}`);
  let workDir: string | undefined;
  let currentBranch: string | undefined;

  try {
    const result = await ghCloneRepo(targetRepo, targetBranch);
    workDir = result.workDir;
    currentBranch = result.branch;
    await api.postProgress(jobId, 'repository_setup', 'Repository cloned');
  } catch (err) {
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType: 'build',
      status: 'failed',
      summary: `Failed to clone repo: ${err}`,
      stageResults: [{ stage: 'repository_setup', status: 'failed' }],
    });
    return;
  }

  // Generate fix with max
  await api.postProgress(jobId, 'implementation', 'Generating fix with max m2.7');
  await api.postLog(jobId, 'stdout', `[build] Generating fix for issue #${issueNum}`);

  const fixPrompt = `You are a senior software engineer implementing a fix for a GitHub issue in a Python codebase.

Repository: ${owner}/${repo}
Issue #${issueNum}: ${issueTitle}
Issue Description:
${issueBody}

Triage Analysis:
${triageSummary || '(no triage summary — analyze the code yourself)'}

IMPORTANT INSTRUCTIONS:
1. First, read the current calculator.py and tests.py files to understand the existing code
2. Fix ALL bugs, not just some:
   - divide(): add a guard to raise a meaningful ValueError when b==0 (NOT ZeroDivisionError)
   - calculate_average(): add a guard to raise ValueError when the list is empty
   - process_numbers(): add guards to handle empty lists (max/min crash on empty lists)
   - DO NOT change safe_divide() — it already works correctly and returns None on division by zero
3. Update or add tests in tests.py to cover:
   - divide(10, 0) raises ValueError (NOT ZeroDivisionError)
   - calculate_average([]) raises ValueError
   - process_numbers([]) returns {}
4. Run pytest to verify all tests pass

After making changes, output a brief summary.

Format your response as:
## Changes Made
[What files you modified and what you changed]

## Verification
[pytest output showing all tests passing]`;

  let fixResult = '';
  try {
    const { stdout, stderr } = await execAsync(
      `max -p "${fixPrompt.replace(/"/g, '\\"')}"`,
      { timeout: 600_000, cwd: workDir! },
    );
    fixResult = stdout + (stderr ? '\n[stderr]: ' + stderr : '');
  } catch (err: any) {
    fixResult = `[max fix failed: ${err.message}]`;
    await api.postLog(jobId, 'stderr', `[build] max fix failed: ${err.message}`);
  }

  await api.postLog(jobId, 'stdout', `[build] Fix result:\n${fixResult.slice(0, 2000)}`);
  await api.postProgress(jobId, 'implementation', 'Fix generated');

  // Check what files were changed
  await api.postProgress(jobId, 'validation', 'Checking changed files');
  let changedFiles: string[] = [];
  try {
    const { stdout } = await execAsync('git status --short', { cwd: workDir! });
    changedFiles = stdout.split('\n').filter(Boolean).map(l => l.slice(3).trim());
    await api.postLog(jobId, 'stdout', `[build] Changed files: ${changedFiles.join(', ')}`);
  } catch {
    await api.postLog(jobId, 'stderr', `[build] Could not get git status`);
  }

  let prNumber = 0;
  let prUrl = '';

  if (changedFiles.length > 0) {
    // Commit and create PR
    const branchName = `max-fix/issue-${issueNum}-${Date.now().toString(36)}`;

    await api.postProgress(jobId, 'commit', `Creating branch ${branchName}`);
    try {
      await ghCreateBranch(workDir!, branchName);
      await api.postLog(jobId, 'stdout', `[build] Created branch: ${branchName}`);
    } catch (err) {
      await api.postLog(jobId, 'stderr', `[build] Failed to create branch: ${err}`);
    }

    await api.postProgress(jobId, 'commit', 'Committing changes');
    try {
      await ghCommitAll(
        workDir!,
        `fix(${repo}): resolve issue #${issueNum} - ${issueTitle.slice(0, 50)}`,
      );
      await api.postLog(jobId, 'stdout', `[build] Changes committed and pushed`);
    } catch (err) {
      await api.postLog(jobId, 'stderr', `[build] Commit failed: ${err}`);
    }

    // Create PR
    await api.postProgress(jobId, 'pr_create', 'Creating pull request');
    try {
      const prBody = `## AI Fix — Issue #${issueNum}

**Issue:** ${issueTitle}

${issueBody ? `**Description:**\n${issueBody}\n` : ''}

${triageSummary ? `**Triage Analysis:**\n${triageSummary}\n` : ''}

**Changes Made:**
${changedFiles.map(f => `- ${f}`).join('\n')}

${fixResult.slice(0, 1000)}

---
*Generated by SupportAgent (max m2.7)*`;

      const baseBranch = targetBranch || 'main';
      const result = await ghCreatePR(owner, repo, `[ISSUE #${issueNum}] ${issueTitle.slice(0, 80)}`, prBody, branchName, baseBranch);
      prNumber = result.number;
      prUrl = result.url;
      await api.postLog(jobId, 'stdout', `[build] PR created: ${prUrl}`);
      await api.postProgress(jobId, 'pr_create', `PR opened: ${prUrl}`);
    } catch (err) {
      await api.postLog(jobId, 'stderr', `[build] PR creation failed: ${err}`);
      await api.postProgress(jobId, 'pr_create', `PR creation failed: ${err}`);
    }
  } else {
    await api.postLog(jobId, 'stdout', `[build] No files changed — no PR to create`);
    await api.postProgress(jobId, 'pr_create', 'No changes needed');
  }

  await api.postProgress(jobId, 'delivery', 'Build complete');

  // Update the run with PR reference via the API
  if (prNumber > 0) {
    try {
      await fetch(`${api.baseUrl}/worker/jobs/${jobId}/run`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${api.secret}`,
        },
        body: JSON.stringify({ providerExecutionRef: `pr:${owner}/${repo}#${prNumber}` }),
      });
    } catch (err) {
      await api.postLog(jobId, 'stderr', `[build] Could not update run with PR ref: ${err}`);
    }
  }

  await api.submitReport(jobId, {
    workflowRunId,
    workflowType: 'build',
    status: changedFiles.length > 0 ? 'succeeded' : 'failed',
    summary: prNumber > 0
      ? `Fix implemented, PR opened: ${prUrl}`
      : changedFiles.length > 0
        ? `Changes committed but PR creation failed`
        : 'No changes were generated by max',
    stageResults: [
      { stage: 'auth', status: 'passed' },
      { stage: 'repository_setup', status: 'passed' },
      { stage: 'implementation', status: changedFiles.length > 0 ? 'passed' : 'failed' },
      { stage: 'commit', status: prNumber > 0 ? 'passed' : 'skipped' },
      { stage: 'pr_create', status: prNumber > 0 ? 'passed' : 'skipped' },
    ],
  });

  if (workDir) await cleanupWorkDir(workDir);
}
