import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type WorkerApiClient } from '../lib/api-client.js';
import { type WorkerJob } from '@support-agent/contracts';

const runWithLoop = vi.fn();

vi.mock('@support-agent/skills-executor-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@support-agent/skills-executor-runtime')>();
  return {
    ...actual,
    runWithLoop,
  };
});

describe('handleSkillJob cancel reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes schemaErrors in the partial cancel report extras', async () => {
    const { CanceledError } = await import('@support-agent/skills-executor-runtime');
    runWithLoop.mockRejectedValueOnce(new CanceledError(
      'Execution canceled',
      new Map(),
      [
        {
          delivery: [],
          findings: {
            summary: 'preserved',
          },
          reportSummary: 'preserved',
        },
      ],
      [
        {
          stageId: 'investigate',
          spawnIndex: 1,
          message: 'schema exploded',
        },
      ],
    ));
    const { handleSkillJob } = await import('./skill-handler.js');

    const submitReport = vi.fn().mockResolvedValue(undefined);
    const api = {
      baseUrl: 'http://localhost:4441',
      secret: 'secret',
      fetchJobContext: vi.fn(),
      fetchExecutorByHash: vi.fn().mockResolvedValue({
        key: 'triage-default',
        contentHash: 'exec-hash-1',
        yaml: `version: 1
key: triage-default
display_name: "Default triage"
stages:
  - id: investigate
    parallel: 1
    system_skill: triage-issue
    complementary: []
    executor: max
    after: []
    inputs_from: []
    task_prompt: "{{scenario.taskPrompt}}"
loop:
  enabled: false
  max_iterations: 1
  until_done: false
`,
      }),
      fetchSkillByHash: vi.fn().mockResolvedValue({
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
      }),
      getRunStatus: vi.fn().mockResolvedValue('running'),
      getRunCancelState: vi.fn().mockResolvedValue({
        status: 'running',
        cancelForceRequestedAt: null,
      }),
      postProgress: vi.fn().mockResolvedValue(undefined),
      postLog: vi.fn().mockResolvedValue(undefined),
      postCheckpoint: vi.fn().mockResolvedValue(undefined),
      postIterationState: vi.fn().mockResolvedValue(undefined),
      uploadArtifact: vi.fn(),
      submitReport,
    } as WorkerApiClient;

    await handleSkillJob({
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
          taskPrompt: 'Investigate',
        },
      },
      workItem: {
        title: 'Crash on save',
        body: 'Steps to reproduce',
        externalUrl: 'https://github.com/example/repo/issues/123',
      },
    } as WorkerJob, api);

    expect(submitReport).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'canceled',
        extras: {
          schemaErrors: [
            {
              stageId: 'investigate',
              spawnIndex: 1,
              message: 'schema exploded',
            },
          ],
        },
      }),
    );
  });
});
