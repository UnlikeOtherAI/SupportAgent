import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBuildJob } from './build-handler.js';
import { type WorkerApiClient } from '../lib/api-client.js';
import { type WorkerJob } from '@support-agent/contracts';
import {
  ghCheckAuth,
  ghCloneRepo,
  cleanupWorkDir,
  parseGitHubRef,
} from '../lib/gh-cli.js';
import { codexExec } from '../utils/codex-exec.js';

vi.mock('../lib/gh-cli.js', () => ({
  ghCheckAuth: vi.fn(),
  ghCloneRepo: vi.fn(),
  ghCreateBranch: vi.fn(),
  ghCommitAll: vi.fn(),
  ghCreatePR: vi.fn(),
  ghGetIssue: vi.fn(),
  ghAddIssueComment: vi.fn(),
  cleanupWorkDir: vi.fn(),
  parseGitHubRef: vi.fn(),
}));

vi.mock('../utils/codex-exec.js', () => ({
  codexExec: vi.fn(),
  summarizeResult: vi.fn().mockReturnValue('status=ok | duration=1s | no output'),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeJob(): WorkerJob {
  return {
    jobId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowType: 'build',
    apiBaseUrl: 'http://localhost:4441',
    workerSharedSecret: 'secret',
    sourceConnectorKey: 'github-connector',
    targetRepo: 'https://github.com/rafiki270/max-test',
    executionProfile: 'analysis-only',
    reproductionPolicy: 'never',
    artifactUploadMode: 'api',
    timeoutSeconds: 60,
  };
}

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

describe('handleBuildJob', () => {
  it('calls cleanupWorkDir exactly once when codexExec throws after a successful clone', async () => {
    vi.mocked(ghCheckAuth).mockResolvedValue(true);
    vi.mocked(parseGitHubRef).mockReturnValue({ owner: 'rafiki270', repo: 'max-test' });
    vi.mocked(ghCloneRepo).mockResolvedValue({ workDir: '/tmp/build-work-abc', branch: 'main' });
    vi.mocked(codexExec).mockRejectedValue(new Error('codex exploded mid-flight'));
    vi.mocked(cleanupWorkDir).mockResolvedValue(undefined);

    const { api } = makeApi();
    const job = makeJob();

    await expect(handleBuildJob(job, api)).resolves.toBeUndefined();

    expect(cleanupWorkDir).toHaveBeenCalledTimes(1);
    expect(cleanupWorkDir).toHaveBeenCalledWith('/tmp/build-work-abc');
  });
});
