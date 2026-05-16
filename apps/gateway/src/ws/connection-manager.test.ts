import { describe, expect, it, vi } from 'vitest';
import { ConnectionManager } from './connection-manager.js';
import { type RuntimeKeyContext } from './runtime-key-auth.js';

function createSocket() {
  const listeners = new Map<string, Array<(payload: Buffer) => void>>();
  const ws = {
    OPEN: 1,
    readyState: 1,
    send: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
    close: vi.fn(),
    on: vi.fn((event: string, handler: (payload: Buffer) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    }),
  };

  return {
    ws,
    emit(event: string, payload: unknown) {
      const text =
        typeof payload === 'string' ? payload : JSON.stringify(payload);
      for (const handler of listeners.get(event) ?? []) {
        handler(Buffer.from(text));
      }
    },
  };
}

function fakePrisma() {
  return {
    auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
  } as unknown as ConstructorParameters<typeof ConnectionManager>[0];
}

function fakeAuth(tenantId: string, profiles: string[] | null = null): RuntimeKeyContext {
  return {
    runtimeApiKeyId: 'rk-1',
    tenantId,
    runtimeMode: 'worker',
    allowedProfiles: profiles,
    keyPrefix: 'abcd',
  };
}

describe('ConnectionManager', () => {
  it('routes cancel messages to the worker currently running the dispatch attempt', async () => {
    const manager = new ConnectionManager(fakePrisma());
    const socket = createSocket();
    const auth = fakeAuth('tenant-1');
    manager.acceptConnection({
      ws: socket.ws as never,
      auth,
      remoteAddr: '127.0.0.1',
    });

    socket.emit('message', {
      type: 'register',
      workerId: 'tenant-1:worker-1',
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
      reproductionPolicy: 'when_supported',
      artifactUploadMode: 'api',
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

  it('rejects a register message whose workerId is not scoped to the runtime key tenant', () => {
    const manager = new ConnectionManager(fakePrisma());
    const socket = createSocket();
    manager.acceptConnection({
      ws: socket.ws as never,
      auth: fakeAuth('tenant-A'),
      remoteAddr: '127.0.0.1',
    });

    socket.emit('message', {
      type: 'register',
      workerId: 'tenant-B:malicious-worker',
      capabilities: [],
    });

    expect(socket.ws.close).toHaveBeenCalledWith(1008, 'worker id out of scope');
    expect(manager.count()).toBe(0);
  });

  it('rejects a register whose capabilities exceed the allowed execution profiles', () => {
    const manager = new ConnectionManager(fakePrisma());
    const socket = createSocket();
    manager.acceptConnection({
      ws: socket.ws as never,
      auth: fakeAuth('tenant-1', ['analysis-only']),
      remoteAddr: '127.0.0.1',
    });

    socket.emit('message', {
      type: 'register',
      workerId: 'tenant-1:w1',
      capabilities: ['build-and-merge'],
    });

    expect(socket.ws.close).toHaveBeenCalledWith(1008, 'worker id out of scope');
    expect(manager.count()).toBe(0);
  });

  it('enforces the per-tenant connection cap', () => {
    const manager = new ConnectionManager(fakePrisma(), {
      maxPayloadBytes: 1_048_576,
      pingIntervalMs: 30_000,
      idleTimeoutMs: 60_000,
      msgRateLimitPerMin: 600,
      maxConnPerTenant: 1,
    });
    const first = createSocket();
    const second = createSocket();
    manager.acceptConnection({
      ws: first.ws as never,
      auth: fakeAuth('tenant-1'),
      remoteAddr: '127.0.0.1',
    });
    manager.acceptConnection({
      ws: second.ws as never,
      auth: fakeAuth('tenant-1'),
      remoteAddr: '127.0.0.1',
    });
    expect(second.ws.close).toHaveBeenCalledWith(1008, 'tenant connection cap reached');
  });

  it('rejects an oversized inbound frame', () => {
    const manager = new ConnectionManager(fakePrisma(), {
      maxPayloadBytes: 32,
      pingIntervalMs: 30_000,
      idleTimeoutMs: 60_000,
      msgRateLimitPerMin: 600,
      maxConnPerTenant: 50,
    });
    const socket = createSocket();
    manager.acceptConnection({
      ws: socket.ws as never,
      auth: fakeAuth('tenant-1'),
      remoteAddr: '127.0.0.1',
    });
    socket.emit('message', { type: 'register', workerId: 'x'.repeat(64), capabilities: [] });
    expect(socket.ws.close).toHaveBeenCalledWith(1009, 'payload too large');
  });
});
