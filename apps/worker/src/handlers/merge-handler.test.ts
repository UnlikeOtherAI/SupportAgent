import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMergeJob } from './merge-handler.js';
import { type WorkerApiClient } from '../lib/api-client.js';
import { type WorkerJob } from '@support-agent/contracts';
import {
  ghAddPRComment,
  ghCheckAuth,
  ghGetPR,
  ghGetPRDiff,
  ghGetPRFiles,
  ghMergePR,
} from '../lib/gh-cli.js';

let reviewOutput = '';

vi.mock('node:child_process', () => ({
  exec: vi.fn((...args: any[]) => {
    const callback = args[args.length - 1] as (err: null, result: { stdout: string }) => void;
    callback(null, { stdout: reviewOutput });
  }),
}));

vi.mock('../lib/gh-cli.js', () => ({
  ghAddPRComment: vi.fn(),
  ghCheckAuth: vi.fn(),
  ghGetPR: vi.fn(),
  ghGetPRDiff: vi.fn(),
  ghGetPRFiles: vi.fn(),
  ghMergePR: vi.fn(),
  ghGetIssue: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeJob(): WorkerJob {
  return {
    jobId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowType: 'merge',
    apiBaseUrl: 'http://localhost:4441',
    workerSharedSecret: 'secret',
    sourceConnectorKey: 'github-connector',
    targetRepo: 'https://github.com/rafiki270/max-test',
    executionProfile: 'analysis-only',
    reproductionPolicy: 'never',
    artifactUploadMode: 'api',
    timeoutSeconds: 60,
    providerHints: {
      prRef: 'https://github.com/rafiki270/max-test/pull/32',
    },
  };
}

function makeApi(): { api: WorkerApiClient; submitReport: ReturnType<typeof vi.fn> } {
  const submitReport = vi.fn().mockResolvedValue(undefined);
  return {
    api: {
      baseUrl: 'http://localhost:4441',
      secret: 'secret',
      fetchJobContext: vi.fn(),
      postProgress: vi.fn().mockResolvedValue(undefined),
      postLog: vi.fn().mockResolvedValue(undefined),
      uploadArtifact: vi.fn(),
      submitReport,
    } as WorkerApiClient,
    submitReport,
  };
}

describe('handleMergeJob', () => {
  it.each(['comment', 'request_changes'] as const)(
    'marks %s review decisions as failed when the PR is not merged',
    async (decision) => {
      reviewOutput = JSON.stringify({
        decision,
        summary: 'Human follow-up is needed',
        concerns: ['Needs manual review'],
        praise: [],
      });

      vi.mocked(ghCheckAuth).mockResolvedValue(true);
      vi.mocked(ghGetPR).mockResolvedValue({
        number: 32,
        title: 'Add local gh polling',
        body: 'Test PR',
        base: 'main',
        head: 'feature',
        mergeable: true,
        merged: false,
        mergedAt: null,
        state: 'open',
        url: 'https://github.com/rafiki270/max-test/pull/32',
      });
      vi.mocked(ghGetPRDiff).mockResolvedValue('diff --git a/file b/file');
      vi.mocked(ghGetPRFiles).mockResolvedValue(['apps/worker/src/handlers/merge-handler.ts']);
      vi.mocked(ghAddPRComment).mockResolvedValue(undefined);
      vi.mocked(ghMergePR).mockResolvedValue(undefined);

      const { api, submitReport } = makeApi();
      const job = makeJob();

      await expect(handleMergeJob(job, api)).resolves.toBeUndefined();

      expect(ghMergePR).not.toHaveBeenCalled();
      expect(submitReport).toHaveBeenCalledTimes(1);

      const [, report] = submitReport.mock.calls[0];
      expect(report).toMatchObject({
        workflowType: 'merge',
        status: 'failed',
        summary: expect.stringContaining('Human follow-up required'),
      });
      expect(report.stageResults).toEqual([
        { stage: 'context_fetch', status: 'passed' },
        { stage: 'review', status: 'passed' },
        { stage: 'merge', status: 'skipped' },
      ]);
    },
  );

  it('keeps approved and merged PRs succeeded', async () => {
    reviewOutput = JSON.stringify({
      decision: 'approve',
      summary: 'Looks good',
      concerns: [],
      praise: ['Good structure'],
    });

    vi.mocked(ghCheckAuth).mockResolvedValue(true);
    vi.mocked(ghGetPR).mockResolvedValue({
      number: 32,
      title: 'Add local gh polling',
      body: 'Test PR',
      base: 'main',
      head: 'feature',
      mergeable: true,
      merged: false,
      mergedAt: null,
      state: 'open',
      url: 'https://github.com/rafiki270/max-test/pull/32',
    });
    vi.mocked(ghGetPRDiff).mockResolvedValue('diff --git a/file b/file');
    vi.mocked(ghGetPRFiles).mockResolvedValue(['apps/worker/src/handlers/merge-handler.ts']);
    vi.mocked(ghAddPRComment).mockResolvedValue(undefined);
    vi.mocked(ghMergePR).mockResolvedValue(undefined);

    const { api, submitReport } = makeApi();
    const job = makeJob();

    await expect(handleMergeJob(job, api)).resolves.toBeUndefined();

    expect(ghMergePR).toHaveBeenCalledWith('rafiki270', 'max-test', 32, 'squash');
    const [, report] = submitReport.mock.calls[0];
    expect(report).toMatchObject({
      workflowType: 'merge',
      status: 'succeeded',
      summary: expect.stringContaining('Review approved'),
    });
  });
});
