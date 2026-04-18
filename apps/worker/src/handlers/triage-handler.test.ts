import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleTriageJob } from './triage-handler.js';
import { type WorkerApiClient } from '../lib/api-client.js';
import { type WorkerJob } from '@support-agent/contracts';
import {
  ghAddIssueComment,
  ghAddIssueLabels,
  ghCheckAuth,
  ghCloneRepo,
  ghGetIssue,
  cleanupWorkDir,
  parseGitHubRef,
} from '../lib/gh-cli.js';
import {
  linearAddComment,
  linearAuthAvailable,
  linearGetIssue,
} from '../lib/linear-cli.js';
import type { Executor } from '../executors/index.js';
import { writeFile } from 'node:fs/promises';

vi.mock('../lib/gh-cli.js', () => ({
  ghCheckAuth: vi.fn(),
  ghCloneRepo: vi.fn(),
  ghGetIssue: vi.fn(),
  ghAddIssueComment: vi.fn(),
  ghAddIssueLabels: vi.fn(),
  cleanupWorkDir: vi.fn(),
  parseGitHubRef: vi.fn(),
}));

vi.mock('../lib/linear-cli.js', () => ({
  linearAddComment: vi.fn(),
  linearAuthAvailable: vi.fn(),
  linearGetIssue: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeApi(): { api: WorkerApiClient; submitReport: ReturnType<typeof vi.fn> } {
  const submitReport = vi.fn().mockResolvedValue(undefined);
  return {
    api: {
      baseUrl: 'http://localhost:4441',
      secret: 'secret',
      fetchJobContext: vi.fn(),
      fetchExecutorByHash: vi.fn(),
      fetchSkillByHash: vi.fn(),
      getRunStatus: vi.fn(),
      postProgress: vi.fn().mockResolvedValue(undefined),
      postLog: vi.fn().mockResolvedValue(undefined),
      postCheckpoint: vi.fn(),
      uploadArtifact: vi.fn(),
      submitReport,
    } as unknown as WorkerApiClient,
    submitReport,
  };
}

function makeLinearJob(): WorkerJob {
  return {
    jobId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowType: 'triage',
    apiBaseUrl: 'http://localhost:4441',
    workerSharedSecret: 'secret',
    sourceConnectorKey: 'linear',
    targetRepo: 'https://github.com/rafiki270/max-test',
    executionProfile: 'analysis-only',
    reproductionPolicy: 'never',
    artifactUploadMode: 'api',
    timeoutSeconds: 60,
    providerHints: {
      sourceExternalId: 'linear-issue-uuid-456',
      sourcePlatform: 'linear',
    },
  } as WorkerJob;
}

function fakeExecutor(): Executor {
  return {
    key: 'fake-executor',
    async run({ outputPath }) {
      const payload = {
        summary: 'Login crashes when token expired.',
        rootCause: 'Missing null check at auth.ts:42',
        replicationSteps: '1. login\n2. wait\n3. retry',
        suggestedFix: 'Add null guard',
        severity: { level: 'High', justification: 'blocks login' },
        confidence: { label: 'High', reason: 'reproduced locally' },
        affectedFiles: ['src/auth.ts'],
        logsExcerpt: '',
        sources: ['src/auth.ts'],
      };
      const json = JSON.stringify(payload);
      await writeFile(outputPath, json, 'utf8');
      return { stdout: '', outputContent: json };
    },
  };
}

describe('handleTriageJob — Linear-sourced', () => {
  it('fetches the Linear issue, posts the discovery comment to Linear, and never labels GitHub', async () => {
    vi.mocked(ghCheckAuth).mockResolvedValue(true);
    vi.mocked(parseGitHubRef).mockReturnValue({ owner: 'rafiki270', repo: 'max-test' });
    vi.mocked(ghCloneRepo).mockResolvedValue({ workDir: '/tmp/triage-linear', branch: 'main' });
    vi.mocked(linearAuthAvailable).mockReturnValue(true);
    vi.mocked(linearGetIssue).mockResolvedValue({
      id: 'linear-issue-uuid-456',
      identifier: 'ENG-99',
      title: 'Auth bug',
      body: 'Steps inside.',
      url: 'https://linear.app/team/issue/ENG-99',
      state: 'Triage',
      priority: 2,
      labels: [],
      assignee: null,
      comments: [],
    });
    vi.mocked(cleanupWorkDir).mockResolvedValue(undefined);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    try {
      const { api, submitReport } = makeApi();
      await handleTriageJob(makeLinearJob(), api, { executor: fakeExecutor() });

      expect(linearGetIssue).toHaveBeenCalledWith('linear-issue-uuid-456');

      // Discovery comment must be posted on Linear, not GitHub.
      expect(linearAddComment).toHaveBeenCalledTimes(1);
      const [linearIssueId, body] = vi.mocked(linearAddComment).mock.calls[0];
      expect(linearIssueId).toBe('linear-issue-uuid-456');
      expect(body).toContain('Login crashes');

      expect(ghAddIssueComment).not.toHaveBeenCalled();
      expect(ghAddIssueLabels).not.toHaveBeenCalled();

      expect(submitReport).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'succeeded' }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('fails fast when LINEAR_API_KEY is missing', async () => {
    vi.mocked(ghCheckAuth).mockResolvedValue(true);
    vi.mocked(parseGitHubRef).mockReturnValue({ owner: 'rafiki270', repo: 'max-test' });
    vi.mocked(linearAuthAvailable).mockReturnValue(false);

    const { api, submitReport } = makeApi();
    await handleTriageJob(makeLinearJob(), api, { executor: fakeExecutor() });

    expect(linearGetIssue).not.toHaveBeenCalled();
    expect(submitReport).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'failed',
        summary: expect.stringContaining('LINEAR_API_KEY'),
      }),
    );
  });

  it('fails fast when sourceExternalId is missing for Linear job', async () => {
    vi.mocked(ghCheckAuth).mockResolvedValue(true);

    const job = makeLinearJob();
    (job as { providerHints: Record<string, unknown> }).providerHints = {};

    const { api, submitReport } = makeApi();
    await handleTriageJob(job, api, { executor: fakeExecutor() });

    expect(linearGetIssue).not.toHaveBeenCalled();
    expect(submitReport).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'failed',
        summary: expect.stringContaining('No Linear issue id'),
      }),
    );
  });
});
