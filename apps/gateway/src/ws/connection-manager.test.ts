import { describe, expect, it, vi } from 'vitest';
import { ConnectionManager } from './connection-manager.js';

function createSocket() {
  const listeners = new Map<string, Array<(payload: Buffer) => void>>();
  const ws = {
    OPEN: 1,
    readyState: 1,
    send: vi.fn(),
    on: vi.fn((event: string, handler: (payload: Buffer) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    }),
  };

  return {
    ws,
    emit(event: string, payload: unknown) {
      for (const handler of listeners.get(event) ?? []) {
        handler(Buffer.from(JSON.stringify(payload)));
      }
    },
  };
}

describe('ConnectionManager', () => {
  it('routes cancel messages to the worker currently running the dispatch attempt', async () => {
    const manager = new ConnectionManager();
    const socket = createSocket();
    manager.handleConnection(socket.ws as never);

    socket.emit('message', {
      type: 'register',
      workerId: 'worker-1',
      capabilities: [],
    });

    await manager.dispatchJob({
      jobId: 'dispatch-1',
      workflowRunId: '00000000-0000-0000-0000-000000000001',
      workflowType: 'triage',
      apiBaseUrl: 'https://api.example.com',
      workerSharedSecret: 'secret',
      sourceConnectorKey: 'github',
      targetRepo: 'https://github.com/test/repo',
      targetBranch: 'main',
      executionProfile: 'analysis-only',
      timeoutSeconds: 60,
    });

    expect(manager.sendCancelRequested('dispatch-1', '00000000-0000-0000-0000-000000000001')).toBe(true);
    expect(manager.sendCancelForce('dispatch-1', '00000000-0000-0000-0000-000000000001')).toBe(true);

    const sentMessages = socket.ws.send.mock.calls.map(([payload]) => JSON.parse(payload));
    expect(sentMessages[0]).toMatchObject({
      type: 'dispatch',
      job: {
        jobId: 'dispatch-1',
      },
    });
    expect(sentMessages[1]).toEqual({
      type: 'cancel_requested',
      dispatchAttemptId: 'dispatch-1',
      workflowRunId: '00000000-0000-0000-0000-000000000001',
    });
    expect(sentMessages[2]).toEqual({
      type: 'cancel_force',
      dispatchAttemptId: 'dispatch-1',
      workflowRunId: '00000000-0000-0000-0000-000000000001',
    });
  });
});
