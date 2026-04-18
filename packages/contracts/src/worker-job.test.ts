import { describe, expect, it } from 'vitest';
import { WorkerJobSchema } from './worker-job.js';

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    jobId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowType: 'triage' as const,
    apiBaseUrl: 'https://api.example.com',
    workerSharedSecret: 'secret-token-123',
    sourceConnectorKey: 'github-main',
    targetRepo: 'org/repo',
    executionProfile: 'standard',
    ...overrides,
  };
}

describe('WorkerJobSchema executor metadata', () => {
  it('parses executor metadata fields when present', () => {
    const result = WorkerJobSchema.parse(
      makeJob({
        executorKey: 'triage-default',
        executorRevisionHash: 'rev-123',
        resolvedSkillManifest: [
          { name: 'triage-issue', contentHash: 'hash-1' },
          { name: 'codebase-architecture', contentHash: 'hash-2' },
        ],
      }),
    );

    expect(result.executorKey).toBe('triage-default');
    expect(result.executorRevisionHash).toBe('rev-123');
    expect(result.resolvedSkillManifest).toEqual([
      { name: 'triage-issue', contentHash: 'hash-1' },
      { name: 'codebase-architecture', contentHash: 'hash-2' },
    ]);
  });

  it('leaves executor metadata undefined when omitted', () => {
    const result = WorkerJobSchema.parse(makeJob());

    expect(result.executorKey).toBeUndefined();
    expect(result.executorRevisionHash).toBeUndefined();
    expect(result.resolvedSkillManifest).toBeUndefined();
  });
});
