import { type WebSocket } from 'ws';
import { type WorkerJob } from '@support-agent/contracts';

interface ConnectedWorker {
  ws: WebSocket;
  workerId: string;
  capabilities: string[];
  busy: boolean;
  currentJobId: string | null;
}

interface PendingJob {
  job: WorkerJob;
  resolve: () => void;
  reject: (err: Error) => void;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const DISPATCH_TIMEOUT_MS = 60_000;

export class ConnectionManager {
  private workers = new Map<string, ConnectedWorker>();
  private pendingJobs: PendingJob[] = [];

  handleConnection(ws: WebSocket): void {
    let workerId: string | null = null;

    ws.on('message', (data) => {
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case 'register':
          workerId = msg.workerId as string;
          this.workers.set(workerId, {
            ws,
            workerId,
            capabilities: (msg.capabilities as string[]) ?? [],
            busy: false,
            currentJobId: null,
          });
          console.log(
            `[gateway] Worker ${workerId} registered (${this.workers.size} connected)`,
          );
          this.tryDispatchPending();
          break;

        case 'pong':
          break;

        case 'job-accepted':
          break;

        case 'job-completed':
        case 'job-failed': {
          const worker = workerId ? this.workers.get(workerId) : null;
          if (worker) {
            worker.busy = false;
            worker.currentJobId = null;
            this.tryDispatchPending();
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      if (workerId) {
        this.workers.delete(workerId);
        console.log(
          `[gateway] Worker ${workerId} disconnected (${this.workers.size} connected)`,
        );
      }
    });

    ws.on('error', (err) => {
      console.error(`[gateway] Worker ${workerId ?? 'unknown'} error:`, err.message);
    });

    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      } else {
        clearInterval(heartbeat);
      }
    }, HEARTBEAT_INTERVAL_MS);

    ws.on('close', () => clearInterval(heartbeat));
  }

  async dispatchJob(job: WorkerJob): Promise<void> {
    const idle = this.findIdleWorker();
    if (idle) {
      this.sendJob(idle, job);
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this.pendingJobs.findIndex((p) => p.job.jobId === job.jobId);
        if (idx >= 0) this.pendingJobs.splice(idx, 1);
        reject(new Error(`No worker available for job ${job.jobId} within timeout`));
      }, DISPATCH_TIMEOUT_MS);

      this.pendingJobs.push({
        job,
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });
    });
  }

  count(): number {
    return this.workers.size;
  }

  idleCount(): number {
    let n = 0;
    for (const w of this.workers.values()) {
      if (!w.busy && w.ws.readyState === w.ws.OPEN) n++;
    }
    return n;
  }

  sendCancelRequested(dispatchAttemptId: string, workflowRunId: string): boolean {
    return this.sendControlMessage(dispatchAttemptId, {
      type: 'cancel_requested',
      dispatchAttemptId,
      workflowRunId,
    });
  }

  sendCancelForce(dispatchAttemptId: string, workflowRunId: string): boolean {
    return this.sendControlMessage(dispatchAttemptId, {
      type: 'cancel_force',
      dispatchAttemptId,
      workflowRunId,
    });
  }

  private findIdleWorker(): ConnectedWorker | null {
    for (const worker of this.workers.values()) {
      if (!worker.busy && worker.ws.readyState === worker.ws.OPEN) {
        return worker;
      }
    }
    return null;
  }

  private sendJob(worker: ConnectedWorker, job: WorkerJob): void {
    worker.busy = true;
    worker.currentJobId = job.jobId;
    worker.ws.send(JSON.stringify({ type: 'dispatch', job }));
  }

  private sendControlMessage(
    dispatchAttemptId: string,
    payload: Record<string, unknown>,
  ): boolean {
    for (const worker of this.workers.values()) {
      if (worker.currentJobId === dispatchAttemptId && worker.ws.readyState === worker.ws.OPEN) {
        worker.ws.send(JSON.stringify(payload));
        return true;
      }
    }

    return false;
  }

  private tryDispatchPending(): void {
    while (this.pendingJobs.length > 0) {
      const idle = this.findIdleWorker();
      if (!idle) break;
      const pending = this.pendingJobs.shift()!;
      this.sendJob(idle, pending.job);
      pending.resolve();
    }
  }
}
