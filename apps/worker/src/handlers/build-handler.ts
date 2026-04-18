import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { type WorkerJob } from '@support-agent/contracts';
import { type WorkerApiClient } from '../lib/api-client.js';
import {
  ghAddIssueComment,
  ghCheckAuth,
  ghCloneRepo,
  ghCreateBranch,
  ghCommitAll,
  ghCreatePR,
  ghGetIssue,
  cleanupWorkDir,
  parseGitHubRef,
} from '../lib/gh-cli.js';
import {
  linearAddComment,
  linearAuthAvailable,
  linearGetIssue,
} from '../lib/linear-cli.js';
import { buildBuildPrompt } from './build-prompt.js';
import { codexExec, summarizeResult } from '../utils/codex-exec.js';

const execAsync = promisify(exec);

function buildCodexPrompt(prompt: string): string {
  return `${prompt}

Execution requirements:
- You are already inside the checked-out repository for this issue.
- Read any local repo instructions such as AGENTS.md or CLAUDE.md before editing if they exist.
- Make the necessary file edits directly in this working tree.
- Use the repository's existing tooling for verification.
- Run the smallest relevant test or lint command for the changed area after editing.
- Do not create or amend commits, branches, or pull requests.
- Do not wait for interactive input.
- End with the requested "## Changes Made" and "## Verification" sections.`;
}

export async function handleBuildJob(job: WorkerJob, api: WorkerApiClient): Promise<void> {
  const { jobId, workflowRunId, targetRepo, targetBranch, sourceConnectorKey } = job;
  const isLinearSource = sourceConnectorKey === 'linear';

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
  const sourceExternalId: string | undefined = providerHints.sourceExternalId;
  let issueNum = 0;
  let issueTitle = '';
  let issueBody = '';
  let owner = '';
  let repo = '';
  let displayRef = '';
  let linearIssueId: string | undefined;

  try {
    const parsed = parseGitHubRef(targetRepo);
    owner = parsed.owner;
    repo = parsed.repo;

    if (isLinearSource) {
      if (!sourceExternalId) {
        throw new Error('Linear-sourced build job missing sourceExternalId in providerHints');
      }
      if (!linearAuthAvailable()) {
        throw new Error('LINEAR_API_KEY not configured on worker');
      }
      const linearIssue = await linearGetIssue(sourceExternalId);
      issueTitle = linearIssue.title;
      issueBody = linearIssue.body ?? '';
      displayRef = linearIssue.identifier;
      linearIssueId = linearIssue.id;
      await api.postLog(jobId, 'stdout', `[build] Fetched Linear issue ${displayRef}: ${issueTitle}`);
    } else {
      if (issueRef) {
        const m = issueRef.match(/(?:issues?|pull)\/(\d+)/);
        if (m) issueNum = parseInt(m[1]);
      }

      if (issueNum > 0) {
        const issue = await ghGetIssue(owner, repo, issueNum);
        issueTitle = issue.title;
        issueBody = issue.body ?? '';
        displayRef = `#${issueNum}`;
        await api.postLog(jobId, 'stdout', `[build] Fetched issue #${issueNum}: ${issueTitle}`);
      }
    }
  } catch (err) {
    await api.postLog(jobId, 'stderr', `[build] Could not fetch issue: ${err}`);
    if (isLinearSource) {
      await api.submitReport(jobId, {
        workflowRunId,
        workflowType: 'build',
        status: 'failed',
        summary: `Failed to fetch Linear issue ${sourceExternalId}: ${err}`,
        stageResults: [
          { stage: 'auth', status: 'passed' },
          { stage: 'issue_fetch', status: 'failed' },
        ],
      });
      return;
    }
  }

  // Notify Linear that build is starting (matches "comment back with each step").
  if (isLinearSource && linearIssueId) {
    try {
      await linearAddComment(
        linearIssueId,
        `<!-- supportagent:build-start -->\n🔨 SupportAgent is building a fix for **${displayRef}** on \`${owner}/${repo}\`. PR link will follow.`,
      );
    } catch (err) {
      await api.postLog(jobId, 'stderr', `[build] Could not post build-start comment on Linear: ${err}`);
    }
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

  try {
    const result = await ghCloneRepo(targetRepo, targetBranch);
    workDir = result.workDir;
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

  try {
  // Generate implementation with Codex so the repository is actually edited.
  await api.postProgress(jobId, 'implementation', 'Generating implementation with Codex');
  await api.postLog(jobId, 'stdout', `[build] Generating implementation for ${displayRef || 'issue'}`);

  const buildPrompt = buildBuildPrompt({
    owner,
    repo,
    targetBranch: targetBranch ?? '',
    issueNumber: issueNum,
    issueTitle,
    issueBody,
    triageSummary,
  });

  let fixResult = '';
  let implementationSummary = '';
  let implementationFailed = false;
  try {
    const result = await codexExec(buildCodexPrompt(buildPrompt), workDir!);
    fixResult = result.stdout + (result.stderr ? '\n[stderr]: ' + result.stderr : '');
    implementationSummary = summarizeResult(result);
    implementationFailed = !result.ok;
    await api.postLog(jobId, 'stdout', `[build] Codex result: ${implementationSummary}`);
    if (!result.ok) {
      await api.postLog(jobId, 'stderr', `[build] codex exec exited without success`);
    }
  } catch (err) {
    implementationFailed = true;
    implementationSummary = `codex exec failed unexpectedly: ${String(err)}`;
    fixResult = `[${implementationSummary}]`;
    await api.postLog(jobId, 'stderr', `[build] ${implementationSummary}`);
  }

  await api.postLog(jobId, 'stdout', `[build] Full execution output:\n${fixResult.slice(0, 4000)}`);
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
    const branchSlug = isLinearSource && displayRef
      ? displayRef.toLowerCase()
      : `issue-${issueNum}`;
    const branchName = `max-fix/${branchSlug}-${Date.now().toString(36)}`;

    await api.postProgress(jobId, 'commit', `Creating branch ${branchName}`);
    try {
      await ghCreateBranch(workDir!, branchName);
      await api.postLog(jobId, 'stdout', `[build] Created branch: ${branchName}`);
    } catch (err) {
      await api.postLog(jobId, 'stderr', `[build] Failed to create branch: ${err}`);
      await api.submitReport(jobId, {
        workflowRunId,
        workflowType: 'build',
        status: 'failed',
        summary: `Branch creation failed — cannot push safely: ${err}`,
        stageResults: [
          { stage: 'auth', status: 'passed' },
          { stage: 'repository_setup', status: 'passed' },
          { stage: 'implementation', status: 'passed' },
          { stage: 'commit', status: 'failed' },
          { stage: 'pr_create', status: 'skipped' },
        ],
      });
      return;
    }

    await api.postProgress(jobId, 'commit', 'Committing changes');
    try {
      const commitRef = displayRef || (issueNum > 0 ? `#${issueNum}` : 'task');
      await ghCommitAll(
        workDir!,
        `fix(${repo}): resolve ${commitRef} - ${issueTitle.slice(0, 50)}`,
      );
      await api.postLog(jobId, 'stdout', `[build] Changes committed and pushed`);
    } catch (err) {
      await api.postLog(jobId, 'stderr', `[build] Commit failed: ${err}`);
    }

    // Create PR
    await api.postProgress(jobId, 'pr_create', 'Creating pull request');
    try {
      const actionConfig = ((job as any).providerHints?.actionConfig ?? {}) as Record<string, unknown>;
      const issueLinkMode = actionConfig.issueLinkMode === 'mentions' ? 'mentions' : 'fixes';
      const issueLinkLine = !isLinearSource && issueNum > 0
        ? issueLinkMode === 'fixes'
          ? `Fixes #${issueNum}`
          : `Relates to #${issueNum}`
        : isLinearSource && displayRef
          ? `Relates to Linear ${displayRef}`
          : '';

      const headerRef = displayRef || (issueNum > 0 ? `#${issueNum}` : 'task');
      const prBody = `${issueLinkLine}

## AI Fix — ${headerRef}

**Issue:** ${issueTitle}

${issueBody ? `**Description:**\n${issueBody}\n` : ''}

${triageSummary ? `**Triage Analysis:**\n${triageSummary}\n` : ''}

**Changes Made:**
${changedFiles.map(f => `- ${f}`).join('\n')}

${implementationSummary.slice(0, 1000)}

---
*Generated by SupportAgent (Codex)*`;

      const baseBranch = targetBranch || 'main';
      const prTitle = `[${headerRef}] ${issueTitle.slice(0, 80)}`;
      const result = await ghCreatePR(owner, repo, prTitle, prBody, branchName, baseBranch);
      prNumber = result.number;
      prUrl = result.url;
      await api.postLog(jobId, 'stdout', `[build] PR created: ${prUrl}`);
      await api.postProgress(jobId, 'pr_create', `PR opened: ${prUrl}`);

      if (isLinearSource && linearIssueId) {
        try {
          await linearAddComment(
            linearIssueId,
            `<!-- supportagent:pr-link -->\n🚀 Draft PR opened on \`${owner}/${repo}\`: ${prUrl}\n\nPR title: **${prTitle}**`,
          );
          await api.postLog(jobId, 'stdout', `[build] Posted PR link on Linear ${displayRef}`);
        } catch (commentErr) {
          await api.postLog(
            jobId,
            'stderr',
            `[build] Could not post PR link back on Linear: ${commentErr}`,
          );
        }
      } else if (issueNum > 0) {
        try {
          await ghAddIssueComment(
            owner,
            repo,
            issueNum,
            `<!-- supportagent:pr-link -->\n🚀 Draft PR opened: ${prUrl}\n\n${issueLinkLine ? `PR body references this issue with \`${issueLinkLine}\`.` : ''}`,
          );
          await api.postLog(jobId, 'stdout', `[build] Posted PR link on issue #${issueNum}`);
        } catch (commentErr) {
          await api.postLog(
            jobId,
            'stderr',
            `[build] Could not post PR link back on issue: ${commentErr}`,
          );
        }
      }
    } catch (err) {
      await api.postLog(jobId, 'stderr', `[build] PR creation failed: ${err}`);
      await api.postProgress(jobId, 'pr_create', `PR creation failed: ${err}`);
      if (isLinearSource && linearIssueId) {
        try {
          await linearAddComment(
            linearIssueId,
            `<!-- supportagent:pr-fail -->\n⚠️ SupportAgent failed to open a PR for **${displayRef}** on \`${owner}/${repo}\`: \`${String(err).slice(0, 300)}\``,
          );
        } catch {
          // best-effort
        }
      }
    }
  } else {
    await api.postLog(jobId, 'stdout', `[build] No files changed — no PR to create`);
    await api.postProgress(jobId, 'pr_create', 'No changes needed');
    if (isLinearSource && linearIssueId) {
      try {
        await linearAddComment(
          linearIssueId,
          `<!-- supportagent:no-changes -->\nℹ️ SupportAgent ran but produced no code changes for **${displayRef}**. ${implementationFailed ? `Reason: ${implementationSummary.slice(0, 300)}` : 'The fix may already be in place, or the executor returned no patch.'}`,
        );
      } catch (err) {
        await api.postLog(jobId, 'stderr', `[build] Could not post no-changes comment on Linear: ${err}`);
      }
    }
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
        : implementationFailed
          ? `Codex did not produce a usable patch: ${implementationSummary.slice(0, 200)}`
          : 'No changes were generated by Codex',
    stageResults: [
      { stage: 'auth', status: 'passed' },
      { stage: 'repository_setup', status: 'passed' },
      { stage: 'implementation', status: changedFiles.length > 0 ? 'passed' : 'failed' },
      { stage: 'commit', status: prNumber > 0 ? 'passed' : 'skipped' },
      { stage: 'pr_create', status: prNumber > 0 ? 'passed' : 'skipped' },
    ],
  });
  } finally {
    if (workDir) await cleanupWorkDir(workDir);
  }
}
