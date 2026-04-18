import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import {
  GatewayMessage,
  type WorkerJob,
} from '@support-agent/contracts';
import { requestDispatchCancel } from '../lib/dispatch-control.js';
import { type JobTransport } from './transport.js';

export function createWebSocketTransport(
  gatewayUrl: string,
  opts?: {
    workerId?: string;
    capabilities?: string[];
    reconnectMs?: number;
  },
): JobTransport {
  const workerId = opts?.workerId ?? randomUUID();
  const capabilities = opts?.capabilities ?? [];
  const reconnectMs = opts?.reconnectMs ?? 5000;

  let ws: WebSocket | null = null;
  let handler: ((job: WorkerJob) => Promise<void>) | null = null;
  let active = false;

  function connect(): void {
    if (!active) return;

    ws = new WebSocket(gatewayUrl);

    ws.on('open', () => {
      console.log(`[ws] Connected to gateway at ${gatewayUrl}`);
      ws!.send(
        JSON.stringify({ type: 'register', workerId, capabilities }),
      );
    });

    ws.on('message', async (data) => {
      let msg: GatewayMessage;
      try {
        msg = GatewayMessage.parse(JSON.parse(data.toString()));
      } catch {
        return;
      }

      if (msg.type === 'ping') {
        ws?.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      if (msg.type === 'cancel_requested') {
        requestDispatchCancel(msg.dispatchAttemptId, 'requested');
        return;
      }

      if (msg.type === 'cancel_force') {
        requestDispatchCancel(msg.dispatchAttemptId, 'force');
        return;
      }

      if (msg.type === 'dispatch' && handler) {
        const job = msg.job as WorkerJob;
        ws?.send(JSON.stringify({ type: 'job-accepted', jobId: job.jobId }));

        try {
          console.log(`[ws] Received job ${job.jobId} type=${job.workflowType}`);
          await handler(job);
          console.log(`[ws] Completed job ${job.jobId}`);
          ws?.send(
            JSON.stringify({ type: 'job-completed', jobId: job.jobId }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[ws] Job ${job.jobId} failed:`, message);
          ws?.send(
            JSON.stringify({
              type: 'job-failed',
              jobId: job.jobId,
              error: message,
            }),
          );
        }
      }
    });

    ws.on('close', () => {
      console.log('[ws] Disconnected from gateway');
      if (active) {
        console.log(`[ws] Reconnecting in ${reconnectMs}ms...`);
        setTimeout(connect, reconnectMs);
      }
    });

    ws.on('error', (err) => {
      console.error('[ws] Connection error:', err.message);
    });
  }

  return {
    start(jobHandler) {
      handler = jobHandler;
      active = true;
      connect();
    },

    async stop() {
      active = false;
      if (ws) {
        ws.close();
        ws = null;
      }
    },
  };
}
