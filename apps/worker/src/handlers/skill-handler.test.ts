import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSkillJob } from './skill-handler.js';
import { type WorkerApiClient } from '../lib/api-client.js';
import { type WorkerJob } from '@support-agent/contracts';

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
  };
}

function makeApi(): { api: WorkerApiClient; submitReport: ReturnType<typeof vi.fn>; postCheckpoint: ReturnType<typeof vi.fn> } {
  const submitReport = vi.fn().mockResolvedValue(undefined);
  const postCheckpoint = vi.fn().mockResolvedValue(undefined);
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
      postProgress: vi.fn().mockResolvedValue(undefined),
      postLog: vi.fn().mockResolvedValue(undefined),
      postCheckpoint,
      uploadArtifact: vi.fn(),
      submitReport,
    } as WorkerApiClient,
    submitReport,
    postCheckpoint,
  };
}

describe('handleSkillJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves executor/skills, writes checkpoints, and submits leaf outputs', async () => {
    const { api, submitReport, postCheckpoint } = makeApi();
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
});
