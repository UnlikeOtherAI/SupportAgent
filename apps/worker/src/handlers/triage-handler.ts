import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { type WorkerJob } from '@support-agent/contracts';
import { type WorkerApiClient } from '../lib/api-client.js';
import {
  ghAddIssueComment,
  ghCheckAuth,
  ghCloneRepo,
  ghAddIssueLabels,
  ghGetIssue,
  cleanupWorkDir,
  parseGitHubRef,
} from '../lib/gh-cli.js';
import { buildTriageDiscoveryComment } from '../lib/triage-discovery-comment.js';

const execAsync = promisify(exec);

export async function handleTriageJob(job: WorkerJob, api: WorkerApiClient): Promise<void> {
  const { jobId, workflowRunId, targetRepo } = job;

  // ── 1. Auth check ────────────────────────────────────────────────
  await api.postProgress(jobId, 'auth', 'Checking GitHub authentication');
  await api.postLog(jobId, 'stdout', `[triage] Starting triage for ${targetRepo}`);

  const isAuthed = await ghCheckAuth();
  if (!isAuthed) {
    await api.postLog(jobId, 'stderr', '[triage] ERROR: gh not authenticated. Run: gh auth login');
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType: 'triage',
      status: 'failed',
      summary: 'gh CLI is not authenticated',
      stageResults: [{ stage: 'auth', status: 'failed' }],
    });
    return;
  }
  await api.postProgress(jobId, 'auth', 'GitHub authenticated');

  // ── 2. Extract issue number from job context ──────────────────────
  // The workItemId carries the issue number context via providerHints
  const providerHints = (job as any).providerHints ?? {};
  const issueNumber = providerHints.issueNumber ?? parseInt(providerHints.issueRef ?? '0');
  const issueRef = providerHints.issueRef ?? '';

  let issueNum = issueNumber;
  if (!issueNum && issueRef) {
    // e.g. "owner/repo#123" or "owner/repo/issues/123"
    const m = issueRef.match(/(?:issues?|pull)\/(\d+)/);
    if (m) issueNum = parseInt(m[1]);
  }

  if (!issueNum) {
    await api.postLog(jobId, 'stderr', `[triage] ERROR: No issue number in job hints: ${JSON.stringify(providerHints)}`);
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType: 'triage',
      status: 'failed',
      summary: 'No issue number found in job context',
      stageResults: [{ stage: 'issue_fetch', status: 'failed' }],
    });
    return;
  }

  const { owner, repo } = parseGitHubRef(targetRepo);

  // ── 3. Fetch issue ─────────────────────────────────────────────────
  await api.postProgress(jobId, 'issue_fetch', `Fetching issue #${issueNum}`);
  await api.postLog(jobId, 'stdout', `[triage] Fetching issue ${owner}/${repo}#${issueNum}`);

  let issue: Awaited<ReturnType<typeof ghGetIssue>>;
  try {
    issue = await ghGetIssue(owner, repo, issueNum);
  } catch (err) {
    await api.postLog(jobId, 'stderr', `[triage] ERROR fetching issue: ${err}`);
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType: 'triage',
      status: 'failed',
      summary: `Failed to fetch issue #${issueNum}: ${err}`,
      stageResults: [{ stage: 'issue_fetch', status: 'failed' }],
    });
    return;
  }

  await api.postLog(jobId, 'stdout', `[triage] Issue: "${issue.title}" (${issue.state})`);
  await api.postProgress(jobId, 'issue_fetch', `Issue: "${issue.title}"`);

  // ── 4. Clone repo for analysis ──────────────────────────────────────
  await api.postProgress(jobId, 'repository_setup', 'Cloning repository');
  await api.postLog(jobId, 'stdout', `[triage] Cloning ${targetRepo}`);

  let workDir: string | undefined;
  try {
    const result = await ghCloneRepo(targetRepo);
    workDir = result.workDir;
    await api.postLog(jobId, 'stdout', `[triage] Cloned to ${workDir}`);
    await api.postProgress(jobId, 'repository_setup', 'Repository cloned');
  } catch (err) {
    await api.postLog(jobId, 'stderr', `[triage] ERROR cloning repo: ${err}`);
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType: 'triage',
      status: 'failed',
      summary: `Failed to clone repo: ${err}`,
      stageResults: [{ stage: 'repository_setup', status: 'failed' }],
    });
    return;
  }

  // ── 5. Run triage analysis with max (MiniMax m2.7) ─────────────────
  await api.postProgress(jobId, 'investigation', 'Running AI triage analysis');
  await api.postLog(jobId, 'stdout', `[triage] Running max m2.7 triage analysis`);

  const triagePrompt = `You are a senior software engineer doing triage analysis for a GitHub issue.

Repository: ${owner}/${repo}
Issue #${issue.number}: ${issue.title}
Issue Body:
${issue.body ?? '(no description)'}
Labels: ${issue.labels.join(', ')}

Your task:
1. Read the relevant source files to understand the codebase
2. Identify the root cause of this issue
3. Determine which files need to be changed
4. Estimate complexity (low/medium/high)
5. Suggest a fix approach

Be specific and technical. Cite file paths and line numbers where possible.

Output your analysis in this format:
## Root Cause
[Your analysis]

## Affected Files
- file1.ts (specific lines/functions)
- file2.ts (specific lines/functions)

## Fix Approach
[Step by step]

## Complexity
[low/medium/high]`;

  let triageResult = '';
  try {
    const { stdout } = await execAsync(
      `max -p "${triagePrompt.replace(/"/g, '\\"')}"`,
      { timeout: 300_000, cwd: workDir! },
    );
    triageResult = stdout;
  } catch (err: any) {
    triageResult = `[max analysis unavailable: ${err.message}]\n\nManual triage: Review issue and codebase to determine fix.`;
    await api.postLog(jobId, 'stderr', `[triage] max analysis failed: ${err.message}`);
  }

  await api.postLog(jobId, 'stdout', `[triage] Triage analysis:\n${triageResult.slice(0, 2000)}`);
  await api.postProgress(jobId, 'investigation', 'Analysis complete');

  // ── 6. Generate findings ───────────────────────────────────────────
  await api.postProgress(jobId, 'findings', 'Generating findings');

  const findingsPrompt = `Based on this triage analysis for issue #${issue.number} in ${owner}/${repo}:

Issue: ${issue.title}
${issue.body ?? ''}

Analysis:
${triageResult}

Extract the key findings and format as a concise summary suitable for a developer to act on. Include:
- Root cause (1-2 sentences)
- Key files affected (bullet list)
- Recommended fix (1-2 sentences)
- Confidence level (0-1)

Return JSON with: root_cause, suspect_files (array), recommended_fix, confidence`;

  let findingsJson = '{}';
  try {
    const { stdout } = await execAsync(
      `max -p "${findingsPrompt.replace(/"/g, '\\"')}" --json`,
      { timeout: 60_000, cwd: workDir! },
    );
    // Try to extract JSON from output
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    findingsJson = jsonMatch ? jsonMatch[0] : JSON.stringify({ root_cause: triageResult.slice(0, 500), confidence: 0.5 });
  } catch {
    findingsJson = JSON.stringify({
      root_cause: triageResult.slice(0, 500),
      suspect_files: [],
      recommended_fix: 'Review triage analysis above',
      confidence: 0.5,
    });
  }

  let findings: any;
  try {
    findings = JSON.parse(findingsJson);
  } catch {
    findings = { root_cause: triageResult.slice(0, 500), confidence: 0.5 };
  }

  await api.postLog(jobId, 'stdout', `[triage] Findings: ${JSON.stringify(findings)}`);

  // ── 7. Submit findings to API ───────────────────────────────────────
  const confidenceVal = typeof findings.confidence === 'number'
    ? findings.confidence
    : 0.5;

  const findingPayload = {
    summary: `Triage for #${issue.number}: ${issue.title}`,
    rootCauseHypothesis: findings.root_cause ?? triageResult.slice(0, 500),
    confidence: confidenceVal,
    reproductionStatus: 'not_started',
    affectedAreas: { files: findings.suspect_files ?? [] },
    evidenceRefs: { triage_output: triageResult.slice(0, 5000) },
    recommendedNextAction: findings.recommended_fix ?? 'Review analysis and implement fix',
    suspectFiles: findings.suspect_files ?? [],
  };

  try {
    await fetch(`${api.baseUrl}/v1/runs/${workflowRunId}/findings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${api.secret}`,
      },
      body: JSON.stringify(findingPayload),
    });
    await api.postLog(jobId, 'stdout', `[triage] Findings submitted to API`);
  } catch (err) {
    await api.postLog(jobId, 'stderr', `[triage] Failed to submit findings: ${err}`);
  }

  // ── 8. Post the discovery comment, then label the issue ─────────────
  try {
    await ghAddIssueComment(
      owner,
      repo,
      issueNum,
      buildTriageDiscoveryComment({
        confidence: confidenceVal,
        recommendedFix: findings.recommended_fix ?? 'Review analysis and implement fix',
        rootCause: findings.root_cause ?? triageResult.slice(0, 500),
        suspectFiles: findings.suspect_files ?? [],
      }),
    );
    await api.postLog(jobId, 'stdout', `[triage] Posted discovery comment on issue #${issueNum}`);
  } catch (err) {
    await api.postLog(jobId, 'stderr', `[triage] Could not post discovery comment: ${err}`);
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType: 'triage',
      status: 'failed',
      summary: `Triage for #${issue.number} failed while posting the discovery comment`,
      stageResults: [
        { stage: 'auth', status: 'passed' },
        { stage: 'issue_fetch', status: 'passed' },
        { stage: 'repository_setup', status: 'passed' },
        { stage: 'investigation', status: 'passed' },
        { stage: 'findings', status: 'failed' },
      ],
    });
    if (workDir) {
      await cleanupWorkDir(workDir);
    }
    return;
  }

  const labels = ['triaged', findings.complexity ?? 'complexity-medium'];
  try {
    await ghAddIssueLabels(owner, repo, issueNum, labels);
  } catch (err) {
    await api.postLog(jobId, 'stderr', `[triage] Could not label issue: ${err}`);
  }

  // ── 9. Done ────────────────────────────────────────────────────────
  await api.postProgress(jobId, 'delivery', 'Triage complete');

  await api.submitReport(jobId, {
    workflowRunId,
    workflowType: 'triage',
    status: 'succeeded',
    summary: `Triage for #${issue.number}: ${issue.title}`,
    stageResults: [
      { stage: 'auth', status: 'passed' },
      { stage: 'issue_fetch', status: 'passed' },
      { stage: 'repository_setup', status: 'passed' },
      { stage: 'investigation', status: 'passed' },
      { stage: 'findings', status: 'passed' },
    ],
  });

  // Cleanup
  if (workDir) {
    await cleanupWorkDir(workDir);
    await api.postLog(jobId, 'stdout', `[triage] Cleaned up working directory`);
  }
}
