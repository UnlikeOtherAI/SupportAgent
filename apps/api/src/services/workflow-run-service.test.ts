import { describe, expect, it, vi } from 'vitest';
import { createWorkflowRunService } from './workflow-run-service.js';

describe('createWorkflowRunService cancel broadcasting', () => {
  it('broadcasts graceful cancel requests after marking the run cancel_requested', async () => {
    const repo = {
      getById: vi.fn().mockResolvedValue({
        id: 'run-1',
        status: 'running',
        attemptNumber: 1,
      }),
      requestCancel: vi.fn().mockResolvedValue({
        id: 'run-1',
        status: 'cancel_requested',
      }),
    };
    const broadcaster = {
      broadcastRunCancel: vi.fn().mockResolvedValue(undefined),
    };
    const service = createWorkflowRunService(repo as never, {} as never, broadcaster);

    const result = await service.cancelRun('run-1', 'tenant-1', false);

    expect(result).toEqual({
      id: 'run-1',
      status: 'cancel_requested',
    });
    expect(broadcaster.broadcastRunCancel).toHaveBeenCalledWith({
      workflowRunId: 'run-1',
      force: false,
    });
  });

  it('broadcasts force cancel requests when force=1 is used', async () => {
    const repo = {
      getById: vi.fn().mockResolvedValue({
        id: 'run-2',
        status: 'running',
        attemptNumber: 1,
      }),
      requestForceCancel: vi.fn().mockResolvedValue({
        id: 'run-2',
        status: 'cancel_requested',
        cancelForceRequestedAt: new Date().toISOString(),
      }),
    };
    const broadcaster = {
      broadcastRunCancel: vi.fn().mockResolvedValue(undefined),
    };
    const service = createWorkflowRunService(repo as never, {} as never, broadcaster);

    const result = await service.cancelRun('run-2', 'tenant-1', true);

    expect(result).toMatchObject({ id: 'run-2', status: 'cancel_requested' });
    expect(broadcaster.broadcastRunCancel).toHaveBeenCalledWith({
      workflowRunId: 'run-2',
      force: true,
    });
  });
});
