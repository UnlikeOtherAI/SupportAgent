import { exec } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { type WorkerJob } from '@support-agent/contracts';
import { type WorkerApiClient } from '../lib/api-client.js';
import {
  cleanupWorkDir,
  ghAddPRComment,
  ghCheckAuth,
  ghCloneRepo,
  ghGetPR,
  ghGetPRDiff,
  parseGitHubRef,
} from '../lib/gh-cli.js';
import {
  ExecutorOutputError,
  getDefaultExecutor,
  runWithJsonOutput,
  type Executor,
} from '../executors/index.js';

const execAsync = promisify(exec);
const MAX_DIFF_BYTES = 48_000;
const PR_REVIEW_MARKER = '<!-- supportagent:pr-review -->';
const TRIGGER_BODY_MAX = 280;

const PrReviewOutputSchema = z.object({
  summary: z.string(),
  recommendation: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
  body: z.string(),
});
type PrReviewOutput = z.infer<typeof PrReviewOutputSchema>;

const PR_REVIEW_OUTPUT_TEMPLATE: PrReviewOutput = {
  summary: '',
  recommendation: 'COMMENT',
  body: '',
};

interface TriggerComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
}

interface TriggerContext {
  kind: 'github.pull_request.comment';
  comment: TriggerComment;
}

interface PrReviewHints {
  prNumber?: number;
  prRef?: string;
  triggerContext?: TriggerContext;
}

export interface PrReviewHandlerOptions {
  executor?: Executor;
}

function extractPrNumber(hints: PrReviewHints): number | null {
  if (typeof hints.prNumber === 'number' && hints.prNumber > 0) return hints.prNumber;
  if (typeof hints.prRef === 'string') {
    const match = hints.prRef.match(/\/pull\/(\d+)/);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

function buildTriggerSnippet(body: string): string {
  return body.length > TRIGGER_BODY_MAX ? `${body.slice(0, TRIGGER_BODY_MAX)}\u2026` : body;
}

export async function handlePrReviewJob(
  job: WorkerJob,
  api: WorkerApiClient,
  options: PrReviewHandlerOptions = {},
): Promise<void> {
  // TODO(skills-executors-migration): Re-home PR review onto workflowType='triage'
  // with workItemKind='review_target', then remove the legacy 'review' reports here.
  const executor = options.executor ?? getDefaultExecutor();
  const { jobId, workflowRunId, targetRepo } = job;
  const providerHints = (job as any).providerHints ?? {};
  const triggerContext = providerHints.triggerContext as TriggerContext | undefined;

  await api.postLog(jobId, 'stdout', `[pr-review] Starting review for ${targetRepo}`);

  if (triggerContext) {
    const snippet = buildTriggerSnippet(triggerContext.comment.body);
    await api.postLog(
      jobId,
      'stdout',
      `[pr-review] Triggered by @${triggerContext.comment.author}: "${snippet}"`,
    );
  }

  await api.postProgress(jobId, 'context_fetch', 'Checking GitHub authentication');

  if (!(await ghCheckAuth())) {
    await api.postLog(jobId, 'stderr', '[pr-review] ERROR: gh not authenticated');
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType: 'review',
      status: 'failed',
      summary: 'gh CLI is not authenticated',
      stageResults: [{ stage: 'context_fetch', status: 'failed' }],
    });
    return;
  }

  const prNumber = extractPrNumber(providerHints);
  if (!prNumber) {
    await api.postLog(
      jobId,
      'stderr',
      `[pr-review] ERROR: No PR number in hints: ${JSON.stringify(providerHints)}`,
    );
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType: 'review',
      status: 'failed',
      summary: 'No PR number in job context',
      stageResults: [{ stage: 'context_fetch', status: 'failed' }],
    });
    return;
  }

  const { owner, repo } = parseGitHubRef(targetRepo);

  await api.postProgress(jobId, 'context_fetch', `Fetching PR #${prNumber}`);
  const pr = await ghGetPR(owner, repo, prNumber).catch((err) => {
    throw new Error(`Failed to fetch PR #${prNumber}: ${err.message ?? err}`);
  });
  await api.postLog(jobId, 'stdout', `[pr-review] PR: "${pr.title}" (${pr.state})`);

  let diff = '';
  try {
    diff = await ghGetPRDiff(owner, repo, prNumber);
  } catch (err) {
    await api.postLog(jobId, 'stderr', `[pr-review] WARNING: could not fetch diff: ${err}`);
  }
  const diffExcerpt = diff.length > MAX_DIFF_BYTES ? `${diff.slice(0, MAX_DIFF_BYTES)}\n...[truncated]` : diff;

  await api.postProgress(jobId, 'repository_setup', 'Cloning repository');
  let workDir: string | undefined;
  try {
    const result = await ghCloneRepo(targetRepo);
    workDir = result.workDir;
    await api.postLog(jobId, 'stdout', `[pr-review] Cloned to ${workDir}`);
  } catch (err) {
    await api.postLog(jobId, 'stderr', `[pr-review] ERROR cloning repo: ${err}`);
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType: 'review',
      status: 'failed',
      summary: `Failed to clone repo: ${err}`,
      stageResults: [{ stage: 'repository_setup', status: 'failed' }],
    });
    return;
  }

  try {
    await execAsync(`git fetch origin pull/${prNumber}/head:pr-${prNumber}`, {
      cwd: workDir,
      timeout: 60_000,
    });
    await execAsync(`git checkout pr-${prNumber}`, { cwd: workDir, timeout: 30_000 });
  } catch (err) {
    await api.postLog(jobId, 'stderr', `[pr-review] WARNING: could not check out PR branch: ${err}`);
  }

  await api.postProgress(jobId, 'analysis', `Running code review analysis (${executor.key})`);

  const triggerContextSection = triggerContext
    ? `\nReview requested by @${triggerContext.comment.author} with the comment:\n"${triggerContext.comment.body}"\nHonor any explicit flags or focus areas in that comment (e.g. --focus=security).\n`
    : '';

  const promptBody = `You are a senior software engineer reviewing a pull request.

Repository: ${owner}/${repo}
PR #${pr.number}: ${pr.title}
Base: ${pr.base} -> Head: ${pr.head}
PR Body:
${pr.body ?? '(no description)'}
${triggerContextSection}
Diff:
${diffExcerpt || '(no diff available)'}

Produce a focused code review covering:
- Correctness issues (logic bugs, missing edge cases, unsafe operations)
- Design concerns (coupling, separation of concerns, premature abstractions)
- Quality concerns (readability, naming, testability, observability)
- Security concerns (input validation, authentication, authorization, data handling)
- Tests (missing coverage, fragile assertions, flakiness risk)

You will produce a structured review. Each field has a specific purpose:

- summary: One paragraph summarizing the PR and your overall verdict.
- recommendation: One of "APPROVE", "REQUEST_CHANGES", "COMMENT".
- body: The full markdown review that will be posted as a PR comment. Use these sections, in order:

  ## Summary
  One paragraph summarizing the PR and overall review verdict.

  ## Strengths
  Bulleted list of concrete things this PR does well.

  ## Issues
  Numbered list of concrete issues. For each: file path and line if possible, problem description, and suggested fix with code when relevant.

  ## Recommendation
  One of: APPROVE, REQUEST_CHANGES, COMMENT. Justify in one sentence.`;

  const outputPath = join(workDir!, '.sa', `pr-review-${jobId}.json`);

  let reviewBody = '';
  try {
    const reviewOutput = await runWithJsonOutput(executor, {
      promptBody,
      schema: PrReviewOutputSchema,
      template: PR_REVIEW_OUTPUT_TEMPLATE,
      outputPath,
      cwd: workDir,
      timeoutMs: 300_000,
    });
    reviewBody = reviewOutput.body.trim() || reviewOutput.summary;
  } catch (err) {
    const detail =
      err instanceof ExecutorOutputError
        ? `${err.message}\n--- raw output (first 500 chars) ---\n${err.rawContent.slice(0, 500)}`
        : (err as Error).message;
    reviewBody = `[${executor.key} review unavailable: ${(err as Error).message}]\n\nManual review required.`;
    await api.postLog(jobId, 'stderr', `[pr-review] ${executor.key} review failed: ${detail}`);
  }

  await api.postLog(jobId, 'stdout', `[pr-review] Review:\n${reviewBody.slice(0, 2000)}`);
  await api.postProgress(jobId, 'analysis', 'Review drafted');

  let triggerFooter = '';
  if (triggerContext) {
    const author = triggerContext.comment.author;
    const url = triggerContext.comment.url;
    const snippet = buildTriggerSnippet(triggerContext.comment.body);
    const authorRef = url ? `[@${author}](${url})` : `@${author}`;
    triggerFooter = `\n\n---\n> Triggered by ${authorRef}: "${snippet}"`;
  }

  const commentBody = `${PR_REVIEW_MARKER}\n# \uD83E\uDD16 SupportAgent PR Review\n\n${reviewBody}${triggerFooter}`;

  await api.postProgress(jobId, 'comment_post', 'Posting review comment');
  try {
    await ghAddPRComment(owner, repo, prNumber, commentBody);
    await api.postLog(jobId, 'stdout', `[pr-review] Posted review on PR #${prNumber}`);
  } catch (err) {
    await api.postLog(jobId, 'stderr', `[pr-review] Could not post PR comment: ${err}`);
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType: 'review',
      status: 'failed',
      summary: `Could not post review comment on PR #${prNumber}`,
      stageResults: [
        { stage: 'context_fetch', status: 'passed' },
        { stage: 'repository_setup', status: 'passed' },
        { stage: 'analysis', status: 'passed' },
        { stage: 'comment_post', status: 'failed' },
      ],
    });
    if (workDir) await cleanupWorkDir(workDir);
    return;
  }

  await api.submitReport(jobId, {
    workflowRunId,
    workflowType: 'review',
    status: 'succeeded',
    summary: `Review posted on PR #${pr.number}: ${pr.title}`,
    stageResults: [
      { stage: 'context_fetch', status: 'passed' },
      { stage: 'repository_setup', status: 'passed' },
      { stage: 'analysis', status: 'passed' },
      { stage: 'comment_post', status: 'passed' },
    ],
  });

  if (workDir) {
    await cleanupWorkDir(workDir);
    await api.postLog(jobId, 'stdout', `[pr-review] Cleaned up working directory`);
  }
}
