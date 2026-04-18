import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBuildJob } from './build-handler.js';
import { type WorkerApiClient } from '../lib/api-client.js';
import { type WorkerJob } from '@support-agent/contracts';
import {
  ghAddIssueComment,
  ghCheckAuth,
  ghCloneRepo,
  ghCommitAll,
  ghCreateBranch,
  ghCreatePR,
  cleanupWorkDir,
  parseGitHubRef,
} from '../lib/gh-cli.js';
import {
  linearAddComment,
  linearAuthAvailable,
  linearGetIssue,
} from '../lib/linear-cli.js';
import {
  respondioAuthAvailable,
  respondioGetConversation,
  respondioPostComment,
} from '../lib/respondio-cli.js';
import {
  jiraAddComment,
  jiraAuthAvailable,
  jiraGetIssue,
} from '../lib/jira-cli.js';
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

vi.mock('../lib/linear-cli.js', () => ({
  linearAddComment: vi.fn(),
  linearAuthAvailable: vi.fn(),
  linearGetIssue: vi.fn(),
}));

vi.mock('../lib/respondio-cli.js', () => ({
  respondioAuthAvailable: vi.fn(),
  respondioGetConversation: vi.fn(),
  respondioPostComment: vi.fn(),
}));

vi.mock('../lib/jira-cli.js', () => ({
  jiraAddComment: vi.fn(),
  jiraAuthAvailable: vi.fn(),
  jiraGetIssue: vi.fn(),
}));

vi.mock('../utils/codex-exec.js', () => ({
  codexExec: vi.fn(),
  summarizeResult: vi.fn().mockReturnValue('status=ok | duration=1s | no output'),
}));

const execMock = vi.fn();
vi.mock('node:child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('node:child_process');
  return {
    ...actual,
    exec: (cmd: string, opts: unknown, cb: unknown) => execMock(cmd, opts, cb),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default exec stub: any callback-style exec call completes with empty output.
  execMock.mockImplementation((_cmd: string, opts: unknown, cb: unknown) => {
    const callback = (typeof opts === 'function' ? opts : cb) as (err: Error | null, out: { stdout: string; stderr: string }) => void;
    if (callback) callback(null, { stdout: '', stderr: '' });
    return {} as never;
  });
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

  describe('Linear-sourced builds', () => {
    function makeLinearJob(): WorkerJob {
      const job = makeJob();
      return {
        ...job,
        sourceConnectorKey: 'linear',
        providerHints: {
          sourceExternalId: 'linear-issue-uuid-123',
          sourcePlatform: 'linear',
        },
      } as WorkerJob;
    }

    it('fetches the Linear issue and posts build-start + PR-link comments to Linear, never to GitHub', async () => {
      vi.mocked(ghCheckAuth).mockResolvedValue(true);
      vi.mocked(parseGitHubRef).mockReturnValue({ owner: 'rafiki270', repo: 'max-test' });
      vi.mocked(ghCloneRepo).mockResolvedValue({ workDir: '/tmp/build-linear', branch: 'main' });
      vi.mocked(linearAuthAvailable).mockReturnValue(true);
      vi.mocked(linearGetIssue).mockResolvedValue({
        id: 'linear-issue-uuid-123',
        identifier: 'ENG-42',
        title: 'Crash on startup',
        body: 'Login screen crashes',
        url: 'https://linear.app/team/issue/ENG-42',
        state: 'Triage',
        priority: 2,
        labels: [],
        assignee: null,
        comments: [],
      });
      vi.mocked(codexExec).mockResolvedValue({
        ok: true,
        stdout: 'fixed it',
        stderr: '',
        durationMs: 1000,
        timedOut: false,
        exitCode: 0,
      });
      vi.mocked(ghCreateBranch).mockResolvedValue(undefined);
      vi.mocked(ghCommitAll).mockResolvedValue(undefined);
      vi.mocked(ghCreatePR).mockResolvedValue({ number: 99, url: 'https://github.com/rafiki270/max-test/pull/99' });
      vi.mocked(cleanupWorkDir).mockResolvedValue(undefined);

      // Need git status to produce changed files.
      execMock.mockImplementation((cmd: string, opts: unknown, cb: unknown) => {
        const callback = (typeof opts === 'function' ? opts : cb) as (err: Error | null, out: { stdout: string; stderr: string }) => void;
        if (typeof cmd === 'string' && cmd.startsWith('git status')) {
          callback(null, { stdout: ' M src/foo.ts\n', stderr: '' });
        } else {
          callback(null, { stdout: '', stderr: '' });
        }
        return {} as never;
      });

      // Mock fetch for the run-update PATCH so the handler doesn't hit network.
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

      try {
        const { api } = makeApi();
        await handleBuildJob(makeLinearJob(), api);

        expect(linearGetIssue).toHaveBeenCalledWith('linear-issue-uuid-123');

        const linearCalls = vi.mocked(linearAddComment).mock.calls;
        // First call: build-start comment
        expect(linearCalls[0][0]).toBe('linear-issue-uuid-123');
        expect(linearCalls[0][1]).toContain('SupportAgent is building');
        expect(linearCalls[0][1]).toContain('ENG-42');
        // Second call: PR-link comment
        expect(linearCalls[1][0]).toBe('linear-issue-uuid-123');
        expect(linearCalls[1][1]).toContain('https://github.com/rafiki270/max-test/pull/99');

        // Must never post comments to GitHub when Linear-sourced.
        expect(ghAddIssueComment).not.toHaveBeenCalled();

        // PR title should reference the Linear identifier, not "#0".
        const prCall = vi.mocked(ghCreatePR).mock.calls[0];
        expect(prCall[2]).toContain('ENG-42');
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('fails fast when LINEAR_API_KEY is missing', async () => {
      vi.mocked(ghCheckAuth).mockResolvedValue(true);
      vi.mocked(parseGitHubRef).mockReturnValue({ owner: 'rafiki270', repo: 'max-test' });
      vi.mocked(linearAuthAvailable).mockReturnValue(false);
      vi.mocked(linearGetIssue).mockResolvedValue({} as never);

      const { api, submitReport } = makeApi();
      await handleBuildJob(makeLinearJob(), api);

      expect(linearGetIssue).not.toHaveBeenCalled();
      expect(submitReport).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          status: 'failed',
          summary: expect.stringContaining('LINEAR_API_KEY'),
        }),
      );
    });
  });

  describe('Respond.io-sourced builds', () => {
    function makeRespondIoJob(): WorkerJob {
      const job = makeJob();
      return {
        ...job,
        sourceConnectorKey: 'respondio',
        providerHints: {
          sourceExternalId: '12345',
          sourcePlatform: 'respondio',
        },
      } as WorkerJob;
    }

    it('fetches the conversation, posts build-start + PR-link comments to Respond.io, never to GitHub', async () => {
      vi.mocked(ghCheckAuth).mockResolvedValue(true);
      vi.mocked(parseGitHubRef).mockReturnValue({ owner: 'rafiki270', repo: 'max-test' });
      vi.mocked(ghCloneRepo).mockResolvedValue({ workDir: '/tmp/build-respondio', branch: 'main' });
      vi.mocked(respondioAuthAvailable).mockReturnValue(true);
      vi.mocked(respondioGetConversation).mockResolvedValue({
        contact: {
          id: 12345,
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@example.com',
          phone: null,
          language: null,
          countryCode: null,
          tags: [],
          lifecycle: null,
          status: 'open',
          assignee: null,
          customFields: [],
          createdAt: 1700000000,
        },
        recentMessages: [
          {
            messageId: 1,
            channelId: 5,
            channelSource: 'whatsapp',
            type: 'text',
            text: 'login broken',
            traffic: 'incoming',
            senderSource: 'user',
            createdAt: 1700000001,
          },
        ],
      });
      vi.mocked(codexExec).mockResolvedValue({
        ok: true,
        stdout: 'fixed it',
        stderr: '',
        durationMs: 1000,
        timedOut: false,
        exitCode: 0,
      });
      vi.mocked(ghCreateBranch).mockResolvedValue(undefined);
      vi.mocked(ghCommitAll).mockResolvedValue(undefined);
      vi.mocked(ghCreatePR).mockResolvedValue({ number: 88, url: 'https://github.com/rafiki270/max-test/pull/88' });
      vi.mocked(cleanupWorkDir).mockResolvedValue(undefined);

      execMock.mockImplementation((cmd: string, opts: unknown, cb: unknown) => {
        const callback = (typeof opts === 'function' ? opts : cb) as (err: Error | null, out: { stdout: string; stderr: string }) => void;
        if (typeof cmd === 'string' && cmd.startsWith('git status')) {
          callback(null, { stdout: ' M src/login.ts\n', stderr: '' });
        } else {
          callback(null, { stdout: '', stderr: '' });
        }
        return {} as never;
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

      try {
        const { api } = makeApi();
        await handleBuildJob(makeRespondIoJob(), api);

        expect(respondioGetConversation).toHaveBeenCalledWith('12345');

        const calls = vi.mocked(respondioPostComment).mock.calls;
        // build-start
        expect(calls[0][0]).toBe('id:12345');
        expect(calls[0][1]).toContain('SupportAgent is building');
        expect(calls[0][1]).toContain('respondio:12345');
        // PR-link
        expect(calls[1][0]).toBe('id:12345');
        expect(calls[1][1]).toContain('https://github.com/rafiki270/max-test/pull/88');

        // Must never post comments to GitHub or Linear when Respond.io-sourced.
        expect(ghAddIssueComment).not.toHaveBeenCalled();
        expect(linearAddComment).not.toHaveBeenCalled();

        // Branch slug must be filesystem-safe (no colons).
        const branchArg = vi.mocked(ghCreateBranch).mock.calls[0][1];
        expect(branchArg).not.toContain(':');
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('fails fast when RESPONDIO_API_KEY is missing', async () => {
      vi.mocked(ghCheckAuth).mockResolvedValue(true);
      vi.mocked(parseGitHubRef).mockReturnValue({ owner: 'rafiki270', repo: 'max-test' });
      vi.mocked(respondioAuthAvailable).mockReturnValue(false);

      const { api, submitReport } = makeApi();
      await handleBuildJob(makeRespondIoJob(), api);

      expect(respondioGetConversation).not.toHaveBeenCalled();
      expect(submitReport).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          status: 'failed',
          summary: expect.stringContaining('RESPONDIO_API_KEY'),
        }),
      );
    });
  });

  describe('Jira-sourced builds', () => {
    function makeJiraJob(): WorkerJob {
      const job = makeJob();
      return {
        ...job,
        sourceConnectorKey: 'jira',
        providerHints: {
          sourceExternalId: 'PROJ-42',
          sourcePlatform: 'jira',
        },
      } as WorkerJob;
    }

    it('fetches the Jira issue and posts build-start + PR-link comments to Jira, never to GitHub', async () => {
      vi.mocked(ghCheckAuth).mockResolvedValue(true);
      vi.mocked(parseGitHubRef).mockReturnValue({ owner: 'rafiki270', repo: 'max-test' });
      vi.mocked(ghCloneRepo).mockResolvedValue({ workDir: '/tmp/build-jira', branch: 'main' });
      vi.mocked(jiraAuthAvailable).mockReturnValue(true);
      vi.mocked(jiraGetIssue).mockResolvedValue({
        id: '10001',
        key: 'PROJ-42',
        summary: 'Login crashes',
        description: 'Steps inside',
        url: 'https://acme.atlassian.net/browse/PROJ-42',
        status: 'To Do',
        priority: 'High',
        labels: ['bug'],
        assignee: 'Jane Doe',
      });
      vi.mocked(codexExec).mockResolvedValue({
        ok: true,
        stdout: 'fixed it',
        stderr: '',
        durationMs: 1000,
        timedOut: false,
        exitCode: 0,
      });
      vi.mocked(ghCreateBranch).mockResolvedValue(undefined);
      vi.mocked(ghCommitAll).mockResolvedValue(undefined);
      vi.mocked(ghCreatePR).mockResolvedValue({ number: 77, url: 'https://github.com/rafiki270/max-test/pull/77' });
      vi.mocked(cleanupWorkDir).mockResolvedValue(undefined);

      execMock.mockImplementation((cmd: string, opts: unknown, cb: unknown) => {
        const callback = (typeof opts === 'function' ? opts : cb) as (err: Error | null, out: { stdout: string; stderr: string }) => void;
        if (typeof cmd === 'string' && cmd.startsWith('git status')) {
          callback(null, { stdout: ' M src/auth.ts\n', stderr: '' });
        } else {
          callback(null, { stdout: '', stderr: '' });
        }
        return {} as never;
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

      try {
        const { api } = makeApi();
        await handleBuildJob(makeJiraJob(), api);

        expect(jiraGetIssue).toHaveBeenCalledWith('PROJ-42');

        const calls = vi.mocked(jiraAddComment).mock.calls;
        expect(calls[0][0]).toBe('PROJ-42');
        expect(calls[0][1]).toContain('SupportAgent is building');
        expect(calls[0][1]).toContain('PROJ-42');
        expect(calls[1][0]).toBe('PROJ-42');
        expect(calls[1][1]).toContain('https://github.com/rafiki270/max-test/pull/77');

        expect(ghAddIssueComment).not.toHaveBeenCalled();
        expect(linearAddComment).not.toHaveBeenCalled();
        expect(respondioPostComment).not.toHaveBeenCalled();

        const prCall = vi.mocked(ghCreatePR).mock.calls[0];
        expect(prCall[2]).toContain('PROJ-42');
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('fails fast when Jira credentials are missing', async () => {
      vi.mocked(ghCheckAuth).mockResolvedValue(true);
      vi.mocked(parseGitHubRef).mockReturnValue({ owner: 'rafiki270', repo: 'max-test' });
      vi.mocked(jiraAuthAvailable).mockReturnValue(false);

      const { api, submitReport } = makeApi();
      await handleBuildJob(makeJiraJob(), api);

      expect(jiraGetIssue).not.toHaveBeenCalled();
      expect(submitReport).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          status: 'failed',
          summary: expect.stringContaining('Jira credentials'),
        }),
      );
    });
  });
});
