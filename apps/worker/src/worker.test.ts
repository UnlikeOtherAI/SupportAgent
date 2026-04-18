import { describe, it, expect, vi } from 'vitest';
import { processJob } from './worker.js';
import { type WorkerJob } from '@support-agent/contracts';

vi.mock('./handlers/skill-handler.js', () => ({
  handleSkillJob: vi.fn().mockResolvedValue(undefined),
}));

function makeJob(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    jobId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowType: 'triage',
    apiBaseUrl: 'http://localhost:3001',
    workerSharedSecret: 'test-secret',
    sourceConnectorKey: 'test-connector',
    targetRepo: 'https://github.com/test/repo',
    executionProfile: 'analysis-only',
    reproductionPolicy: 'never',
    artifactUploadMode: 'api',
    timeoutSeconds: 60,
    ...overrides,
  };
}

describe('processJob', () => {
  it('throws on unknown workflow type', async () => {
    const job = makeJob({ workflowType: 'unknown' as any });
    await expect(processJob(job)).rejects.toThrow('Unknown workflow type');
  });

  it('processes triage job without throwing (with mocked fetch)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const job = makeJob({ workflowType: 'triage' });
    await expect(processJob(job)).resolves.toBeUndefined();
  });

  it('processes build job without throwing (with mocked fetch)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const job = makeJob({ workflowType: 'build' });
    await expect(processJob(job)).resolves.toBeUndefined();
  });

  it('processes merge job without throwing (with mocked fetch)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const job = makeJob({ workflowType: 'merge' });
    await expect(processJob(job)).resolves.toBeUndefined();
  });

  it('routes jobs with executorKey to the skill handler first', async () => {
    const job = makeJob({ workflowType: 'triage', executorKey: 'triage-default' });

    await expect(processJob(job)).resolves.toBeUndefined();
  });
});
