import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { type WorkerJob } from '@support-agent/contracts';
import { type WorkerApiClient } from '../lib/api-client.js';
import {
  ghCheckAuth,
  ghGetPR,
  ghGetPRDiff,
  ghMergePR,
  ghAddPRComment,
  ghGetPRFiles,
  ghGetIssue,
} from '../lib/gh-cli.js';

const execAsync = promisify(exec);

interface ReviewResult {
  decision: 'approve' | 'request_changes' | 'comment';
  summary: string;
  concerns: string[];
  praise: string[];
}

async function runAIReview(
  owner: string,
  repo: string,
  prNumber: number,
  title: string,
  body: string | null,
  baseBranch: string,
  onLog: (msg: string) => void,
): Promise<ReviewResult> {
  // Get PR diff and changed files
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

  const reviewPrompt = `You are a senior code reviewer. Review this pull request carefully.

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

Respond with your review in this JSON format:
{
  "decision": "approve" | "request_changes" | "comment",
  "summary": "One sentence summary of your verdict",
  "concerns": ["concern 1", "concern 2"],
  "praise": ["what was done well"]
}

Be honest. Request changes if there are real problems.`;

  let reviewOutput = '';
  try {
    const { stdout } = await execAsync(
      `max -p "${reviewPrompt.replace(/"/g, '\\"')}"`,
      { timeout: 300_000 },
    );
    reviewOutput = stdout;
  } catch (err: any) {
    reviewOutput = JSON.stringify({
      decision: 'comment',
      summary: `Review tool failed: ${err.message}`,
      concerns: ['Review tool could not run'],
      praise: [],
    });
    onLog(`[merge] max review failed: ${err.message}`);
  }

  // Try to parse JSON
  try {
    const jsonMatch = reviewOutput.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as ReviewResult;
    }
  } catch {
    onLog(`[merge] Could not parse review JSON`);
  }

  return {
    decision: 'comment',
    summary: reviewOutput.slice(0, 300),
    concerns: ['Could not parse structured review'],
    praise: [],
  };
}

export async function handleMergeJob(job: WorkerJob, api: WorkerApiClient): Promise<void> {
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
  await api.postProgress(jobId, 'review', 'Running AI code review with max m2.7');
  await api.postLog(jobId, 'stdout', `[merge] Running AI review on PR #${prNumber}`);

  const logFn = (msg: string) => api.postLog(jobId, 'stdout', msg);
  const review = await runAIReview(owner, repo, prNumber, pr.title, pr.body ?? '', pr.base, logFn);

  await api.postLog(jobId, 'stdout', `[merge] Review decision: ${review.decision}`);
  await api.postLog(jobId, 'stdout', `[merge] Summary: ${review.summary}`);
  await api.postLog(jobId, 'stdout', `[merge] Concerns: ${review.concerns.join('; ')}`);
  await api.postProgress(jobId, 'review', `Decision: ${review.decision}`);

  // Post review comment
  const reviewComment = `## AI Code Review Results (SupportAgent — max m2.7)

### Verdict: **${review.decision === 'approve' ? '✅ APPROVE' : review.decision === 'request_changes' ? '❌ REQUEST CHANGES' : '💬 COMMENT'}**

**Summary:** ${review.summary}

${review.praise.length > 0 ? `### What looks good
${review.praise.map(p => `- ${p}`).join('\n')}\n` : ''}
${review.concerns.length > 0 ? `### Concerns
${review.concerns.map(c => `- ${c}`).join('\n')}\n` : ''}
---
*Automated review by SupportAgent (max m2.7)*`;

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
      await api.postLog(jobId, 'stdout', `[merge] ✅ PR #${prNumber} merged (squash)`);
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
    await api.postProgress(jobId, 'merge', 'Not auto-merged (review passed but human review requested)');
  }

  await api.submitReport(jobId, {
    workflowRunId,
    workflowType: 'merge',
    status: review.decision === 'approve' ? 'succeeded' : 'succeeded',
    summary: `Review ${review.decision}: ${review.summary}`,
    stageResults: [
      { stage: 'context_fetch', status: 'passed' },
      { stage: 'review', status: 'passed' },
      { stage: 'merge', status: review.decision === 'approve' ? 'passed' : 'skipped' },
    ],
  });
}
