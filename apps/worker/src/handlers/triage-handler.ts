import { join } from 'node:path';
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
  confidenceNumeric,
  renderTriageReportMarkdown,
  TRIAGE_OUTPUT_TEMPLATE,
  TriageOutputSchema,
  type TriageOutput,
} from '../lib/triage-discovery-comment.js';
import {
  ExecutorOutputError,
  getDefaultExecutor,
  runWithJsonOutput,
  type Executor,
} from '../executors/index.js';

export interface TriageHandlerOptions {
  executor?: Executor;
}

export async function handleTriageJob(
  job: WorkerJob,
  api: WorkerApiClient,
  options: TriageHandlerOptions = {},
): Promise<void> {
  const executor = options.executor ?? getDefaultExecutor();
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
  const providerHints = (job as any).providerHints ?? {};
  const issueNumber = providerHints.issueNumber ?? parseInt(providerHints.issueRef ?? '0');
  const issueRef = providerHints.issueRef ?? '';

  let issueNum = issueNumber;
  if (!issueNum && issueRef) {
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

  try {
    // ── 5. Run triage analysis via the configured executor ──────────────
    await api.postProgress(jobId, 'investigation', `Running triage analysis (${executor.key})`);
    await api.postLog(jobId, 'stdout', `[triage] Running ${executor.key} triage analysis`);

    const promptBody = `You are a senior software engineer doing triage analysis for a GitHub issue.

Repository: ${owner}/${repo}
Issue #${issue.number}: ${issue.title}
Issue Body:
${issue.body ?? '(no description)'}
Labels: ${issue.labels.join(', ')}

Read relevant source files to understand the codebase before writing. Cite file paths and line numbers.

You will produce a structured triage analysis. Each field has a specific purpose:

- summary: One short paragraph naming the error, where it surfaced, and how it was captured.
- rootCause: The specific code path with quoted code (file + line range) and the chain of conditions that cause it.
- replicationSteps: A markdown numbered list a developer can follow to reproduce.
- suggestedFix: One or more numbered remediations with code examples. Distinguish the primary fix from defensive guards.
- severity.level: one of "Low", "Medium", "High", "Critical", "Unknown".
- severity.justification: one short sentence explaining the level.
- confidence.label: one of "Low", "Medium", "High".
- confidence.reason: one short sentence on what makes you uncertain (or confident).
- affectedFiles: array of file paths the fix should touch or where relevant context lives.
- logsExcerpt: the real log or telemetry extract used. Empty string if none.
- sources: array of files or artifacts you read during the investigation.`;

    const outputPath = join(workDir!, '.sa', `triage-${jobId}.json`);

    let triageOutput: TriageOutput;
    try {
      triageOutput = await runWithJsonOutput(executor, {
        promptBody,
        schema: TriageOutputSchema,
        template: TRIAGE_OUTPUT_TEMPLATE,
        outputPath,
        cwd: workDir,
        timeoutMs: 300_000,
      });
    } catch (err) {
      const detail =
        err instanceof ExecutorOutputError
          ? `${err.message}\n--- raw output (first 500 chars) ---\n${err.rawContent.slice(0, 500)}`
          : (err as Error).message;
      await api.postLog(jobId, 'stderr', `[triage] ${executor.key} analysis failed: ${detail}`);
      await api.submitReport(jobId, {
        workflowRunId,
        workflowType: 'triage',
        status: 'failed',
        summary: `Triage analysis failed: ${(err as Error).message}`,
        stageResults: [
          { stage: 'auth', status: 'passed' },
          { stage: 'issue_fetch', status: 'passed' },
          { stage: 'repository_setup', status: 'passed' },
          { stage: 'investigation', status: 'failed' },
        ],
      });
      return;
    }

    await api.postLog(
      jobId,
      'stdout',
      `[triage] Triage analysis: severity=${triageOutput.severity.level} confidence=${triageOutput.confidence.label} files=${triageOutput.affectedFiles.length}`,
    );
    await api.postProgress(jobId, 'investigation', 'Analysis complete');

    // ── 6. Submit findings to API ─────────────────────────────────────
    await api.postProgress(jobId, 'findings', 'Submitting findings');

    const reportMarkdown = renderTriageReportMarkdown(triageOutput);
    const findingPayload = {
      summary: triageOutput.summary
        ? `Triage for #${issue.number}: ${triageOutput.summary.slice(0, 200)}`
        : `Triage for #${issue.number}: ${issue.title}`,
      rootCauseHypothesis: triageOutput.rootCause || reportMarkdown.slice(0, 500),
      confidence: confidenceNumeric(triageOutput.confidence.label),
      reproductionStatus: 'not_started',
      affectedAreas: { files: triageOutput.affectedFiles },
      evidenceRefs: {
        triage_report: reportMarkdown.slice(0, 8000),
        severity: triageOutput.severity.level,
        confidence_label: triageOutput.confidence.label,
      },
      recommendedNextAction: triageOutput.suggestedFix || 'Review analysis and implement fix',
      suspectFiles: triageOutput.affectedFiles,
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

    // ── 7. Post the discovery comment, then label the issue ────────────
    try {
      await ghAddIssueComment(
        owner,
        repo,
        issueNum,
        buildTriageDiscoveryComment({ output: triageOutput }),
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
      return;
    }

    const severityLabel = `severity-${triageOutput.severity.level.toLowerCase()}`;
    const labels = ['triaged', severityLabel];
    try {
      await ghAddIssueLabels(owner, repo, issueNum, labels);
    } catch (err) {
      await api.postLog(jobId, 'stderr', `[triage] Could not label issue: ${err}`);
    }

    // ── 8. Done ────────────────────────────────────────────────────────
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
  } finally {
    if (workDir) {
      await cleanupWorkDir(workDir);
      await api.postLog(jobId, 'stdout', `[triage] Cleaned up working directory`);
    }
  }
}
