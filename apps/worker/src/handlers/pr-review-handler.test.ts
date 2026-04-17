import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePrReviewJob } from './pr-review-handler.js';
import { type WorkerApiClient } from '../lib/api-client.js';
import { type WorkerJob } from '@support-agent/contracts';
import {
  ghAddPRComment,
  ghCheckAuth,
  ghCloneRepo,
  ghGetPR,
  ghGetPRDiff,
} from '../lib/gh-cli.js';
import type { Executor } from '../executors/index.js';

vi.mock('node:child_process', () => ({
  exec: vi.fn((...args: any[]) => {
    const callback = args[args.length - 1] as (err: null, result: { stdout: string }) => void;
    callback(null, { stdout: '' });
  }),
}));

vi.mock('../lib/gh-cli.js', () => ({
  ghAddPRComment: vi.fn(),
  ghCheckAuth: vi.fn(),
  ghCloneRepo: vi.fn(),
  ghGetPR: vi.fn(),
  ghGetPRDiff: vi.fn(),
  parseGitHubRef: vi.fn().mockReturnValue({ owner: 'rafiki270', repo: 'max-test' }),
  cleanupWorkDir: vi.fn(),
}));

let workDir = '';
let reviewBody = '';

function makeExecutor(): Executor {
  return {
    key: 'mock',
    async run() {
      return {
        stdout: '',
        outputContent: JSON.stringify({
          summary: 'Looks good.',
          recommendation: 'COMMENT',
          body: reviewBody,
        }),
      };
    },
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  workDir = await mkdtemp(join(tmpdir(), 'pr-review-handler-'));
  reviewBody = '## Summary\nLooks good.';

  vi.mocked(ghCheckAuth).mockResolvedValue(true);
  vi.mocked(ghGetPR).mockResolvedValue({
    number: 42,
    title: 'Add feature X',
    body: 'Implements feature X',
    base: 'main',
    head: 'feature/x',
    mergeable: true,
    merged: false,
    mergedAt: null,
    state: 'open',
    url: 'https://github.com/rafiki270/max-test/pull/42',
  });
  vi.mocked(ghGetPRDiff).mockResolvedValue('diff --git a/src/index.ts b/src/index.ts');
  vi.mocked(ghCloneRepo).mockResolvedValue({ workDir, branch: 'main' });
  vi.mocked(ghAddPRComment).mockResolvedValue(undefined);
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeApi(): { api: WorkerApiClient; submitReport: ReturnType<typeof vi.fn>; postLog: ReturnType<typeof vi.fn> } {
  const submitReport = vi.fn().mockResolvedValue(undefined);
  const postLog = vi.fn().mockResolvedValue(undefined);
  return {
    api: {
      baseUrl: 'http://localhost:4441',
      secret: 'secret',
      fetchJobContext: vi.fn(),
      postProgress: vi.fn().mockResolvedValue(undefined),
      postLog,
      uploadArtifact: vi.fn(),
      submitReport,
    } as WorkerApiClient,
    submitReport,
    postLog,
  };
}

function makeJob(providerHints: Record<string, unknown> = {}): WorkerJob {
  return {
    jobId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowType: 'review',
    apiBaseUrl: 'http://localhost:4441',
    workerSharedSecret: 'secret',
    sourceConnectorKey: 'github-connector',
    targetRepo: 'https://github.com/rafiki270/max-test',
    executionProfile: 'analysis-only',
    reproductionPolicy: 'never',
    artifactUploadMode: 'api',
    timeoutSeconds: 60,
    providerHints: {
      prNumber: 42,
      ...providerHints,
    },
  } as WorkerJob;
}

describe('handlePrReviewJob', () => {
  describe('triggerContext present', () => {
    it('includes the requester handle in the posted review comment', async () => {
      const { api } = makeApi();
      const job = makeJob({
        triggerContext: {
          kind: 'github.pull_request.comment',
          comment: {
            id: 'c1',
            author: 'alice',
            body: '/sa review --focus=security',
            createdAt: '2026-04-17T10:00:00Z',
          },
        },
      });

      await handlePrReviewJob(job, api, { executor: makeExecutor() });

      const [, , , commentBody] = vi.mocked(ghAddPRComment).mock.calls[0];
      expect(commentBody).toContain('@alice');
    });

    it('includes a snippet of the trigger comment body in the posted review comment', async () => {
      const { api } = makeApi();
      const job = makeJob({
        triggerContext: {
          kind: 'github.pull_request.comment',
          comment: {
            id: 'c2',
            author: 'bob',
            body: '/sa review --focus=security please check the auth flow',
            createdAt: '2026-04-17T10:00:00Z',
          },
        },
      });

      await handlePrReviewJob(job, api, { executor: makeExecutor() });

      const [, , , commentBody] = vi.mocked(ghAddPRComment).mock.calls[0];
      expect(commentBody).toContain('Triggered by @bob');
      expect(commentBody).toContain('/sa review --focus=security please check the auth flow');
    });

    it('renders the requester handle as a markdown link when the comment URL is present', async () => {
      const { api } = makeApi();
      const job = makeJob({
        triggerContext: {
          kind: 'github.pull_request.comment',
          comment: {
            id: 'c-url',
            author: 'frank',
            body: '/sa review',
            createdAt: '2026-04-17T10:00:00Z',
            url: 'https://github.com/rafiki270/max-test/pull/42#issuecomment-9999',
          },
        },
      });

      await handlePrReviewJob(job, api, { executor: makeExecutor() });

      const [, , , commentBody] = vi.mocked(ghAddPRComment).mock.calls[0];
      expect(commentBody).toContain(
        '[@frank](https://github.com/rafiki270/max-test/pull/42#issuecomment-9999)',
      );
    });

    it('renders a plain handle when the comment URL is absent', async () => {
      const { api } = makeApi();
      const job = makeJob({
        triggerContext: {
          kind: 'github.pull_request.comment',
          comment: {
            id: 'c-no-url',
            author: 'grace',
            body: '/sa review',
            createdAt: '2026-04-17T10:00:00Z',
          },
        },
      });

      await handlePrReviewJob(job, api, { executor: makeExecutor() });

      const [, , , commentBody] = vi.mocked(ghAddPRComment).mock.calls[0];
      expect(commentBody).toContain('Triggered by @grace:');
      expect(commentBody).not.toContain('[@grace]');
    });

    it('logs the trigger attribution via postLog', async () => {
      const { api, postLog } = makeApi();
      const job = makeJob({
        triggerContext: {
          kind: 'github.pull_request.comment',
          comment: {
            id: 'c3',
            author: 'carol',
            body: '/sa review',
            createdAt: '2026-04-17T10:00:00Z',
          },
        },
      });

      await handlePrReviewJob(job, api, { executor: makeExecutor() });

      const logCalls = vi.mocked(postLog).mock.calls.map(([, , msg]) => msg);
      expect(logCalls.some((msg) => msg.includes('@carol'))).toBe(true);
    });
  });

  describe('triggerContext absent', () => {
    it('does not include a "Triggered by" line in the review comment', async () => {
      const { api } = makeApi();
      const job = makeJob();

      await handlePrReviewJob(job, api, { executor: makeExecutor() });

      const [, , , commentBody] = vi.mocked(ghAddPRComment).mock.calls[0];
      expect(commentBody).not.toContain('Triggered by');
    });

    it('succeeds normally without triggerContext', async () => {
      const { api, submitReport } = makeApi();
      const job = makeJob();

      await handlePrReviewJob(job, api, { executor: makeExecutor() });

      expect(submitReport).toHaveBeenCalledTimes(1);
      const [, report] = submitReport.mock.calls[0];
      expect(report).toMatchObject({ workflowType: 'review', status: 'succeeded' });
    });
  });

  describe('body truncation', () => {
    it('truncates a body longer than 280 chars in the comment footer', async () => {
      const longBody = 'A'.repeat(300);
      const { api } = makeApi();
      const job = makeJob({
        triggerContext: {
          kind: 'github.pull_request.comment',
          comment: {
            id: 'c4',
            author: 'dave',
            body: longBody,
            createdAt: '2026-04-17T10:00:00Z',
          },
        },
      });

      await handlePrReviewJob(job, api, { executor: makeExecutor() });

      const [, , , commentBody] = vi.mocked(ghAddPRComment).mock.calls[0];
      // The footer snippet must be truncated — not the full 300-char string
      expect(commentBody).not.toContain(longBody);
      // Ellipsis character signals truncation
      expect(commentBody).toContain('…');
      // The first 280 chars of the body should appear
      expect(commentBody).toContain('A'.repeat(280));
    });

    it('does not truncate a body of exactly 280 chars', async () => {
      const exactBody = 'B'.repeat(280);
      const { api } = makeApi();
      const job = makeJob({
        triggerContext: {
          kind: 'github.pull_request.comment',
          comment: {
            id: 'c5',
            author: 'eve',
            body: exactBody,
            createdAt: '2026-04-17T10:00:00Z',
          },
        },
      });

      await handlePrReviewJob(job, api, { executor: makeExecutor() });

      const [, , , commentBody] = vi.mocked(ghAddPRComment).mock.calls[0];
      expect(commentBody).toContain(exactBody);
      expect(commentBody).not.toContain('…');
    });
  });
});
