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
import {
  buildTriageDiscoveryComment,
  parseTriageReport,
} from '../lib/triage-discovery-comment.js';

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

Read relevant source files to understand the codebase before writing. Cite file paths and line numbers.

Your output MUST be a single markdown document containing exactly the following 9 sections in this order, with the exact headings shown:

### Summary
One short paragraph naming the error, where it surfaced, and how it was captured.

### Root Cause
The specific code path with a quoted code snippet (file + line range) and the chain of conditions that cause it.

### Replication Steps
A numbered list a developer can follow to reproduce.

### Suggested Fix
One or more numbered remediations with code examples. Distinguish the primary fix from defensive guards.

### Severity
One of: Low | Medium | High | Critical. Follow with a one-line justification on the same line, e.g. "High — prevents POS from rendering".

### Confidence
One of: Low | Medium | High. Follow with the main reason for uncertainty on the same line.

### Affected Files
Bullet list of file paths the fix should touch or where relevant context lives.

### Logs Excerpt
The real log or telemetry extract used for the investigation, fenced as a code block. If none is available, write "None available.".

### Sources
Bullet list of every file or artifact you read during the investigation.

Do not emit any other headings, preamble, or trailing commentary. Do not wrap the whole output in a code fence.`;

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

  // ── 6. Parse the 9-section report into structured findings ─────────
  await api.postProgress(jobId, 'findings', 'Parsing triage report');

  const parsed = parseTriageReport(triageResult);
  const confidenceVal = parsed.confidenceNumeric;

  await api.postLog(
    jobId,
    'stdout',
    `[triage] Parsed sections: severity=${parsed.severity ?? 'n/a'} confidence=${parsed.confidenceLabel ?? 'n/a'} files=${parsed.affectedFiles.length}`,
  );

  // ── 7. Submit findings to API ───────────────────────────────────────
  const findingPayload = {
    summary: parsed.summary
      ? `Triage for #${issue.number}: ${parsed.summary.slice(0, 200)}`
      : `Triage for #${issue.number}: ${issue.title}`,
    rootCauseHypothesis: parsed.rootCause || triageResult.slice(0, 500),
    confidence: confidenceVal,
    reproductionStatus: 'not_started',
    affectedAreas: { files: parsed.affectedFiles },
    evidenceRefs: {
      triage_report: triageResult.slice(0, 8000),
      severity: parsed.severity ?? null,
      confidence_label: parsed.confidenceLabel ?? null,
    },
    recommendedNextAction: parsed.suggestedFix || 'Review analysis and implement fix',
    suspectFiles: parsed.affectedFiles,
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
      buildTriageDiscoveryComment({ report: triageResult }),
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

  const severityLabel = parsed.severity ? `severity-${parsed.severity.toLowerCase()}` : 'severity-unknown';
  const labels = ['triaged', severityLabel];
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
