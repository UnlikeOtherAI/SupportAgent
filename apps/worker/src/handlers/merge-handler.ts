import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { type WorkerJob } from '@support-agent/contracts';
import { type WorkerApiClient } from '../lib/api-client.js';
import {
  ghCheckAuth,
  ghGetPR,
  ghGetPRDiff,
  ghMergePR,
  ghAddPRComment,
  ghGetPRFiles,
} from '../lib/gh-cli.js';
import {
  ExecutorOutputError,
  getDefaultExecutor,
  runWithJsonOutput,
  type Executor,
} from '../executors/index.js';

const MergeReviewSchema = z.object({
  decision: z.enum(['approve', 'request_changes', 'comment']),
  summary: z.string(),
  concerns: z.array(z.string()),
  praise: z.array(z.string()),
});
type MergeReview = z.infer<typeof MergeReviewSchema>;

const MERGE_REVIEW_TEMPLATE: MergeReview = {
  decision: 'comment',
  summary: '',
  concerns: [],
  praise: [],
};

export interface MergeHandlerOptions {
  executor?: Executor;
}

async function runAIReview(
  executor: Executor,
  jobId: string,
  owner: string,
  repo: string,
  prNumber: number,
  title: string,
  body: string | null,
  baseBranch: string,
  onLog: (msg: string) => void,
): Promise<MergeReview> {
  onLog(`[merge] Fetching PR diff for #${prNumber}`);
  let diff = '';
  try {
    diff = await ghGetPRDiff(owner, repo, prNumber);
  } catch (err) {
    onLog(`[merge] Could not get diff: ${err}`);
    diff = '(diff unavailable)';
  }

  let files: string[] = [];
  try {
    files = await ghGetPRFiles(owner, repo, prNumber);
  } catch (err) {
    onLog(`[merge] Could not get file list: ${err}`);
  }

  const promptBody = `You are a senior code reviewer. Review this pull request carefully.

Repository: ${owner}/${repo}
PR #${prNumber}: ${title}
PR Description:
${body ?? '(no description)'}
Base Branch: ${baseBranch}
Changed Files: ${files.join(', ')}

Code Diff:
${diff.slice(0, 8000)}

Review Checklist:
1. **Correctness** — Does the code do what the PR claims? Are there edge cases not handled?
2. **Code Quality** — Is the code readable, well-structured, no obvious bugs?
3. **Security** — Any SQL injection, XSS, or other security concerns?
4. **Tests** — Are tests adequate? Do they test the right things?
5. **Breaking Changes** — Any API or behavior changes that could break existing consumers?

Review Rules:
- Only raise a concern when it is directly supported by the diff, PR description, or clearly implied behavior.
- Do not speculate about missing lint or formatting problems unless the diff explicitly shows them.
- Prefer "comment" over "request_changes" when you are uncertain or the concern is minor.

Field meanings:
- decision: one of "approve", "request_changes", "comment"
- summary: one-sentence verdict
- concerns: list of concrete concerns; empty list if none
- praise: list of things the PR does well; empty list if none

Be honest. Request changes if there are real problems.`;

  const outputPath = join(tmpdir(), `merge-review-${jobId}.json`);

  try {
    return await runWithJsonOutput(executor, {
      promptBody,
      schema: MergeReviewSchema,
      template: MERGE_REVIEW_TEMPLATE,
      outputPath,
      timeoutMs: 300_000,
    });
  } catch (err) {
    const detail =
      err instanceof ExecutorOutputError
        ? `${err.message}\n--- raw output (first 500 chars) ---\n${err.rawContent.slice(0, 500)}`
        : (err as Error).message;
    onLog(`[merge] ${executor.key} review failed: ${detail}`);
    return {
      decision: 'comment',
      summary: `Review tool failed: ${(err as Error).message}`,
      concerns: ['Review tool could not run'],
      praise: [],
    };
  }
}

export async function handleMergeJob(
  job: WorkerJob,
  api: WorkerApiClient,
  options: MergeHandlerOptions = {},
): Promise<void> {
  const executor = options.executor ?? getDefaultExecutor();
  const { jobId, workflowRunId, targetRepo } = job;

  await api.postProgress(jobId, 'auth', 'Checking GitHub authentication');
  await api.postLog(jobId, 'stdout', `[merge] Starting merge review for ${targetRepo}`);

  const isAuthed = await ghCheckAuth();
  if (!isAuthed) {
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType: 'merge',
      status: 'failed',
      summary: 'gh CLI is not authenticated',
      stageResults: [{ stage: 'auth', status: 'failed' }],
    });
    return;
  }
  await api.postProgress(jobId, 'auth', 'GitHub authenticated');

  // Get PR context from provider hints or look up from parent build run
  const providerHints = (job as any).providerHints ?? {};
  const prRef = providerHints.prRef ?? ''; // e.g. "owner/repo#123"
  const parentBuildRunId = providerHints.parentBuildRunId ?? '';

  let owner = '';
  let repo = '';
  let prNumber = 0;

  if (prRef) {
    const parts = prRef.replace('https://github.com/', '').split('/');
    if (parts.length >= 4) {
      owner = parts[0];
      repo = parts[1];
      const m = prRef.match(/\/pull\/(\d+)/);
      if (m) {
        prNumber = parseInt(m[1]);
      } else if (parts[3]) {
        prNumber = parseInt(parts[3]);
      }
    }
  } else if (parentBuildRunId) {
    // Look up the PR from the parent build run's providerExecutionRef
    try {
      const res = await fetch(`${api.baseUrl}/worker/run/${parentBuildRunId}`, {
        headers: { Authorization: `Bearer ${api.secret}` },
      });
      const runData = await res.json() as any;
      const execRef = runData?.providerExecutionRef ?? '';
      const m = execRef.match(/pr:([^#]+)#(\d+)/);
      if (m) {
        const refParts = m[1].split('/');
        owner = refParts[0];
        repo = refParts[1];
        prNumber = parseInt(m[2]);
      }
    } catch (err) {
      await api.postLog(jobId, 'stderr', `[merge] Could not fetch parent run: ${err}`);
    }
  }

  // Fallback: try to find a PR opened by this repo from recent builds
  if (!prNumber && targetRepo) {
    try {
      const parts = targetRepo.replace('https://github.com/', '').replace('.git', '').split('/');
      owner = parts[0];
      repo = parts[1];
      const { ghListOpenPRs } = await import('../lib/gh-cli.js');
      const prs = await ghListOpenPRs(owner, repo);
      if (prs.length > 0) {
        prNumber = prs[0].number;
        await api.postLog(jobId, 'stdout', `[merge] Found open PR: #${prNumber} — "${prs[0].title}"`);
      }
    } catch (err) {
      await api.postLog(jobId, 'stderr', `[merge] Could not list PRs: ${err}`);
    }
  }

  if (!prNumber) {
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType: 'merge',
      status: 'failed',
      summary: 'Could not find PR to merge',
      stageResults: [{ stage: 'pr_lookup', status: 'failed' }],
    });
    return;
  }

  await api.postProgress(jobId, 'context_fetch', `Fetching PR #${prNumber}`);
  let pr: Awaited<ReturnType<typeof ghGetPR>>;
  try {
    pr = await ghGetPR(owner, repo, prNumber);
    await api.postLog(jobId, 'stdout', `[merge] PR: #${pr.number} "${pr.title}" (merged=${pr.merged})`);
  } catch (err) {
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType: 'merge',
      status: 'failed',
      summary: `Could not fetch PR #${prNumber}: ${err}`,
      stageResults: [{ stage: 'context_fetch', status: 'failed' }],
    });
    return;
  }

  if (pr.merged) {
    await api.postLog(jobId, 'stdout', `[merge] PR #${prNumber} is already merged`);
    await api.submitReport(jobId, {
      workflowRunId,
      workflowType: 'merge',
      status: 'succeeded',
      summary: `PR #${prNumber} was already merged`,
      stageResults: [
        { stage: 'context_fetch', status: 'passed' },
        { stage: 'review', status: 'skipped' },
        { stage: 'merge', status: 'skipped' },
      ],
    });
    return;
  }

  // Run AI review
  await api.postProgress(jobId, 'review', `Running AI code review (${executor.key})`);
  await api.postLog(jobId, 'stdout', `[merge] Running ${executor.key} review on PR #${prNumber}`);

  const logFn = (msg: string) => api.postLog(jobId, 'stdout', msg);
  const review = await runAIReview(
    executor,
    jobId,
    owner,
    repo,
    prNumber,
    pr.title,
    pr.body ?? '',
    pr.base,
    logFn,
  );

  await api.postLog(jobId, 'stdout', `[merge] Review decision: ${review.decision}`);
  await api.postLog(jobId, 'stdout', `[merge] Summary: ${review.summary}`);
  await api.postLog(jobId, 'stdout', `[merge] Concerns: ${review.concerns.join('; ')}`);
  await api.postProgress(jobId, 'review', `Decision: ${review.decision}`);

  // Post review comment
  const verdictBadge =
    review.decision === 'approve'
      ? 'APPROVE'
      : review.decision === 'request_changes'
        ? 'REQUEST CHANGES'
        : 'COMMENT';

  const reviewComment = `## AI Code Review Results (SupportAgent — ${executor.key})

### Verdict: **${verdictBadge}**

**Summary:** ${review.summary}

${review.praise.length > 0 ? `### What looks good
${review.praise.map((p) => `- ${p}`).join('\n')}\n` : ''}
${review.concerns.length > 0 ? `### Concerns
${review.concerns.map((c) => `- ${c}`).join('\n')}\n` : ''}
---
*Automated review by SupportAgent (${executor.key})*`;

  try {
    await ghAddPRComment(owner, repo, prNumber, reviewComment);
    await api.postLog(jobId, 'stdout', `[merge] Posted review comment on PR #${prNumber}`);
  } catch (err) {
    await api.postLog(jobId, 'stderr', `[merge] Could not post comment: ${err}`);
  }

  // Merge if approved
  await api.postProgress(jobId, 'merge', 'Processing merge decision');

  if (review.decision === 'approve') {
    try {
      await ghMergePR(owner, repo, prNumber, 'squash');
      await api.postLog(jobId, 'stdout', `[merge] PR #${prNumber} merged (squash)`);
      await api.postProgress(jobId, 'merge', 'PR merged successfully');
    } catch (err) {
      await api.postLog(jobId, 'stderr', `[merge] Merge failed: ${err}`);
      await api.submitReport(jobId, {
        workflowRunId,
        workflowType: 'merge',
        status: 'failed',
        summary: `PR approved but merge failed: ${err}`,
        stageResults: [
          { stage: 'context_fetch', status: 'passed' },
          { stage: 'review', status: 'passed' },
          { stage: 'merge', status: 'failed' },
        ],
      });
      return;
    }
  } else {
    await api.postLog(jobId, 'stdout', `[merge] PR #${prNumber} not merged — ${review.decision}`);
    await api.postProgress(jobId, 'merge', 'Not auto-merged (human follow-up required)');
  }

  const finalStatus = review.decision === 'approve' ? 'succeeded' : 'failed';
  const finalSummary = review.decision === 'approve'
    ? `Review approved: ${review.summary}`
    : `Human follow-up required (${review.decision}): ${review.summary}`;

  await api.submitReport(jobId, {
    workflowRunId,
    workflowType: 'merge',
    status: finalStatus,
    summary: finalSummary,
    stageResults: [
      { stage: 'context_fetch', status: 'passed' },
      { stage: 'review', status: 'passed' },
      { stage: 'merge', status: review.decision === 'approve' ? 'passed' : 'skipped' },
    ],
  });
}
