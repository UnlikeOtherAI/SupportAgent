import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCancelChecker, handleSkillJob } from './skill-handler.js';
import { type WorkerApiClient } from '../lib/api-client.js';
import { type WorkerJob } from '@support-agent/contracts';
import { clearDispatchControl, registerActiveChildProcess } from '../lib/dispatch-control.js';

function makeJob(): WorkerJob {
  return {
    jobId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowType: 'triage',
    apiBaseUrl: 'http://localhost:4441',
    workerSharedSecret: 'secret',
    sourceConnectorKey: 'github-main',
    targetRepo: 'https://github.com/example/repo',
    executionProfile: 'analysis-only',
    reproductionPolicy: 'never',
    artifactUploadMode: 'api',
    timeoutSeconds: 60,
    executorKey: 'triage-default',
    executorRevisionHash: 'exec-hash-1',
    resolvedSkillManifest: [{ name: 'triage-issue', contentHash: 'skill-hash-1' }],
    executorFetch: {
      url: 'http://localhost:4441/v1/executors/triage-default/by-hash/exec-hash-1',
      contentHash: 'exec-hash-1',
    },
    skillFetches: [
      {
        name: 'triage-issue',
        contentHash: 'skill-hash-1',
        url: 'http://localhost:4441/v1/skills/triage-issue/by-hash/skill-hash-1',
      },
    ],
    providerHints: {
      actionConfig: {
        taskPrompt: 'Investigate {{trigger.issue.title}} at {{trigger.issue.url}} in {{trigger.repository.fullName}} (run {{run.id}})',
      },
      issueRef: 'https://github.com/example/repo/issues/123',
    },
    workItem: {
      title: 'Crash on save',
      body: 'Steps to reproduce',
      externalUrl: 'https://github.com/example/repo/issues/123',
    },
  } as WorkerJob;
}

function makeApi(): {
  api: WorkerApiClient;
  submitReport: ReturnType<typeof vi.fn>;
  postCheckpoint: ReturnType<typeof vi.fn>;
  postIterationState: ReturnType<typeof vi.fn>;
} {
  const submitReport = vi.fn().mockResolvedValue(undefined);
  const postCheckpoint = vi.fn().mockResolvedValue(undefined);
  const postIterationState = vi.fn().mockResolvedValue(undefined);
  const fetchExecutorByHash = vi.fn().mockResolvedValue({
    key: 'triage-default',
    contentHash: 'exec-hash-1',
    yaml: `version: 1
key: triage-default
display_name: "Default triage"
preamble: "Use file:line citations."
stages:
  - id: investigate
    parallel: 1
    system_skill: triage-issue
    complementary: []
    executor: max
    after: []
    inputs_from: []
    task_prompt: "Investigate the issue"
loop:
  enabled: false
  max_iterations: 1
  until_done: false
`,
  });
  const fetchSkillByHash = vi.fn().mockResolvedValue({
    name: 'triage-issue',
    description: 'Triage system skill',
    role: 'SYSTEM',
    body: '# Triage skill\nReturn findings.',
    contentHash: 'skill-hash-1',
    outputSchema: {
      type: 'object',
      properties: {
        delivery: {
          type: 'array',
          maxItems: 0,
        },
        findings: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
          },
          required: ['summary'],
        },
      },
      required: ['delivery', 'findings'],
    },
  });

  return {
    api: {
      baseUrl: 'http://localhost:4441',
      secret: 'secret',
      fetchJobContext: vi.fn(),
      fetchExecutorByHash,
      fetchSkillByHash,
      getRunStatus: vi.fn().mockResolvedValue('running'),
      getRunCancelState: vi.fn().mockResolvedValue({
        status: 'running',
        cancelForceRequestedAt: null,
      }),
      postProgress: vi.fn().mockResolvedValue(undefined),
      postLog: vi.fn().mockResolvedValue(undefined),
      postCheckpoint,
      postIterationState,
      uploadArtifact: vi.fn(),
      submitReport,
    } as WorkerApiClient,
    submitReport,
    postCheckpoint,
    postIterationState,
  };
}

describe('handleSkillJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDispatchControl('dispatch-cancel-test');
  });

  it('uses scenario task prompts, persists iteration state, writes checkpoints, and submits leaf outputs', async () => {
    const { api, submitReport, postCheckpoint, postIterationState } = makeApi();
    const executor = {
      key: 'mock-executor',
      run: vi.fn().mockResolvedValue({
        stdout: '',
        outputContent: JSON.stringify({
          delivery: [],
          findings: {
            summary: 'Likely issue in src/example.ts',
          },
          reportSummary: 'Likely issue in src/example.ts',
        }),
      }),
    };

    await handleSkillJob(makeJob(), api, { executor });

    expect(executor.run).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining(
          'Investigate Crash on save at https://github.com/example/repo/issues/123 in example/repo',
        ),
      }),
    );

    expect(postCheckpoint.mock.calls).toEqual([
      [
        expect.any(String),
        {
          kind: 'stage_complete',
          stageId: 'investigate',
          payload: [
            {
              delivery: [],
              findings: {
                summary: 'Likely issue in src/example.ts',
              },
              reportSummary: 'Likely issue in src/example.ts',
            },
          ],
        },
      ],
      [
        expect.any(String),
        {
          kind: 'iteration_complete',
          iteration: 1,
          payload: [
            {
              delivery: [],
              findings: {
                summary: 'Likely issue in src/example.ts',
              },
              reportSummary: 'Likely issue in src/example.ts',
            },
          ],
        },
      ],
    ]);

    expect(postIterationState).toHaveBeenCalledWith(
      expect.any(String),
      {
        iteration: 1,
        stages: {
          investigate: {
            spawn_outputs: [
              {
                delivery: [],
                findings: {
                  summary: 'Likely issue in src/example.ts',
                },
                reportSummary: 'Likely issue in src/example.ts',
              },
            ],
          },
        },
      },
    );

    expect(submitReport).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'succeeded',
        leafOutputs: [
          {
            delivery: [],
            findings: {
              summary: 'Likely issue in src/example.ts',
            },
            reportSummary: 'Likely issue in src/example.ts',
          },
        ],
      }),
    );
  });

  it('retries checkpoint posts once before continuing', async () => {
    const { api, submitReport, postCheckpoint } = makeApi();
    postCheckpoint
      .mockRejectedValueOnce(new Error('temporary checkpoint failure'))
      .mockResolvedValue(undefined);
    const executor = {
      key: 'mock-executor',
      run: vi.fn().mockResolvedValue({
        stdout: '',
        outputContent: JSON.stringify({
          delivery: [],
          findings: {
            summary: 'Retried checkpoint',
          },
          reportSummary: 'Retried checkpoint',
        }),
      }),
    };

    await handleSkillJob(makeJob(), api, { executor });

    expect(postCheckpoint).toHaveBeenCalledTimes(3);
    expect(submitReport).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'succeeded',
      }),
    );
  });

  it('treats status=cancel_requested without force as a graceful checkpoint cancel', async () => {
    const { api } = makeApi();
    vi.mocked(api.getRunCancelState).mockResolvedValue({
      status: 'cancel_requested',
      cancelForceRequestedAt: null,
    });
    const child = {
      killed: false,
      kill: vi.fn(),
      once: vi.fn(),
    };
    registerActiveChildProcess('dispatch-cancel-test', child as never);

    const shouldCancel = await createCancelChecker(
      api,
      'dispatch-cancel-test',
      'run-cancel-test',
    )();

    expect(shouldCancel).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('escalates cancelForceRequestedAt to SIGTERM on the active subprocess', async () => {
    const { api } = makeApi();
    vi.mocked(api.getRunCancelState).mockResolvedValue({
      status: 'cancel_requested',
      cancelForceRequestedAt: new Date().toISOString(),
    });
    const child = {
      killed: false,
      kill: vi.fn(),
      once: vi.fn(),
    };
    registerActiveChildProcess('dispatch-cancel-test', child as never);

    const shouldCancel = await createCancelChecker(
      api,
      'dispatch-cancel-test',
      'run-cancel-test',
    )();

    expect(shouldCancel).toBe(true);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
