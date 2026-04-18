import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import {
  clearDispatchControl,
  isDispatchCancelRequested,
} from '../lib/dispatch-control.js';
import { createWebSocketTransport } from './ws-transport.js';

function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('Timed out waiting for condition'));
        return;
      }

      setTimeout(tick, 20);
    };

    tick();
  });
}

describe('createWebSocketTransport', () => {
  let server: WebSocketServer | null = null;

  afterEach(async () => {
    clearDispatchControl('00000000-0000-0000-0000-000000000111');
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    server = null;
  });

  it('applies cancel_requested messages from the gateway protocol', async () => {
    server = new WebSocketServer({ port: 0 });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an inet server address');
    }

    server.on('connection', (socket) => {
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString()) as { type: string };
        if (message.type === 'register') {
          socket.send(
            JSON.stringify({
              type: 'cancel_requested',
              dispatchAttemptId: '00000000-0000-0000-0000-000000000111',
              workflowRunId: '00000000-0000-0000-0000-000000000222',
            }),
          );
        }
      });
    });

    const transport = createWebSocketTransport(`ws://127.0.0.1:${address.port}`);
    transport.start(async () => undefined);

    await waitFor(() => isDispatchCancelRequested('00000000-0000-0000-0000-000000000111'));

    await transport.stop();
  });
});
