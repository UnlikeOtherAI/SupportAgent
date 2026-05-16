import { type WebSocket } from 'ws';
import { type PrismaClient } from '@prisma/client';
import {
  WorkerToGatewayMessage,
  type WorkerJob,
} from '@support-agent/contracts';
import { workerIdMatchesScope } from './runtime-key-auth.js';
import { recordGatewayAudit } from './audit.js';
import {
  type AcceptConnectionInput,
  type ConnectedWorker,
  type ConnectionLimits,
  type PendingJob,
} from './types.js';

const DISPATCH_TIMEOUT_MS = 60_000;

const DEFAULT_LIMITS: ConnectionLimits = {
  maxPayloadBytes: 1_048_576,
  pingIntervalMs: 30_000,
  idleTimeoutMs: 60_000,
  msgRateLimitPerMin: 600,
  maxConnPerTenant: 50,
};

/**
 * Owner of the worker fleet. Responsibilities:
 *
 *   1. Hold the live socket set, keyed by `workerId`.
 *   2. Dispatch incoming `WorkerJob`s to an idle worker (or queue them).
 *   3. Enforce per-connection liveness (ping/pong watchdog).
 *   4. Enforce per-connection message-rate and payload-size limits.
 *   5. Enforce per-tenant connection caps.
 *
 * Authentication is handled by the upgrade layer in `app.ts`; this class
 * trusts the `auth` context handed to `acceptConnection` and uses it for
 * scope checks (worker-id binding, dispatch claim audit).
 */
export class ConnectionManager {
  private workers = new Map<string, ConnectedWorker>();
  private pendingJobs: PendingJob[] = [];
  private tenantCounts = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly limits: ConnectionLimits = DEFAULT_LIMITS,
  ) {}

  /**
   * The upgrade layer authenticated the request. We now wire up:
   *   - tenant cap (close if exceeded)
   *   - message handlers
   *   - ping/pong watchdog
   *   - rate limit window
   */
  acceptConnection(input: AcceptConnectionInput): void {
    const { ws, auth, remoteAddr } = input;
    const tenantCount = this.tenantCounts.get(auth.tenantId) ?? 0;
    if (tenantCount >= this.limits.maxConnPerTenant) {
      void recordGatewayAudit(this.prisma, {
        tenantId: auth.tenantId,
        runtimeApiKeyId: auth.runtimeApiKeyId,
        action: 'triggered',
        resourceType: 'gateway_ws_upgrade',
        resourceId: auth.runtimeApiKeyId,
        outcome: 'rejected',
        reason: 'tenant_connection_cap',
        remoteAddr,
      });
      ws.close(1008, 'tenant connection cap reached');
      return;
    }
    this.tenantCounts.set(auth.tenantId, tenantCount + 1);

    let workerId: string | null = null;
    const now = Date.now();
    const transient = {
      lastPongAt: now,
      windowStart: now,
      windowCount: 0,
    };
    const watchdog = setInterval(
      () => this.heartbeat(ws, transient),
      this.limits.pingIntervalMs,
    );

    ws.on('message', (data) => {
      const claimed = this.handleMessage({
        ws,
        auth,
        remoteAddr,
        rawData: data,
        currentWorkerId: workerId,
        transient,
      });
      if (claimed) workerId = claimed;
    });

    ws.on('pong', () => {
      transient.lastPongAt = Date.now();
    });

    const cleanup = () => {
      clearInterval(watchdog);
      if (workerId) this.workers.delete(workerId);
      const left = (this.tenantCounts.get(auth.tenantId) ?? 1) - 1;
      if (left <= 0) this.tenantCounts.delete(auth.tenantId);
      else this.tenantCounts.set(auth.tenantId, left);
    };

    ws.on('close', cleanup);
    ws.on('error', (err) => {
      console.error(`[gateway] ws error for ${workerId ?? 'pre-register'}:`, err.message);
    });
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

  // ── private ────────────────────────────────────────────────────────────

  /**
   * Process one inbound frame. Returns the worker-id this connection is
   * now bound to (after a successful `register`), or null if no binding
   * happened on this frame.
   */
  private handleMessage(args: {
    ws: WebSocket;
    auth: AcceptConnectionInput['auth'];
    remoteAddr: string;
    rawData: unknown;
    currentWorkerId: string | null;
    transient: { lastPongAt: number; windowStart: number; windowCount: number };
  }): string | null {
    const { ws, auth, remoteAddr, rawData, currentWorkerId, transient } = args;

    if (!this.allowRate(transient)) {
      console.warn(`[gateway] rate limit hit for ${currentWorkerId ?? auth.runtimeApiKeyId}`);
      ws.close(1008, 'rate limit exceeded');
      return null;
    }

    const text =
      rawData instanceof Buffer ? rawData.toString('utf8') : String(rawData);
    if (text.length > this.limits.maxPayloadBytes) {
      ws.close(1009, 'payload too large');
      return null;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      return null;
    }

    const parsed = WorkerToGatewayMessage.safeParse(parsedJson);
    if (!parsed.success) return null;
    const msg = parsed.data;

    switch (msg.type) {
      case 'register': {
        const caps = msg.capabilities ?? [];
        if (!workerIdMatchesScope(auth, msg.workerId, caps)) {
          void recordGatewayAudit(this.prisma, {
            tenantId: auth.tenantId,
            runtimeApiKeyId: auth.runtimeApiKeyId,
            action: 'triggered',
            resourceType: 'gateway_ws_upgrade',
            resourceId: msg.workerId,
            outcome: 'rejected',
            reason: 'worker_id_out_of_scope',
            remoteAddr,
            metadata: { capabilities: caps },
          });
          ws.close(1008, 'worker id out of scope');
          return null;
        }
        if (this.workers.has(msg.workerId)) {
          ws.close(1008, 'worker id already registered');
          return null;
        }
        this.workers.set(msg.workerId, {
          ws,
          workerId: msg.workerId,
          capabilities: caps,
          busy: false,
          currentJobId: null,
          auth,
          remoteAddr,
        });
        void recordGatewayAudit(this.prisma, {
          tenantId: auth.tenantId,
          runtimeApiKeyId: auth.runtimeApiKeyId,
          action: 'triggered',
          resourceType: 'gateway_ws_upgrade',
          resourceId: msg.workerId,
          outcome: 'accepted',
          remoteAddr,
          metadata: { capabilities: caps },
        });
        console.log(
          `[gateway] Worker ${msg.workerId} registered (${this.workers.size} connected)`,
        );
        this.tryDispatchPending();
        return msg.workerId;
      }

      case 'pong':
        transient.lastPongAt = Date.now();
        return null;

      case 'job-accepted':
        return null;

      case 'job-completed':
      case 'job-failed': {
        const worker = currentWorkerId ? this.workers.get(currentWorkerId) : null;
        if (worker) {
          worker.busy = false;
          worker.currentJobId = null;
          this.tryDispatchPending();
        }
        return null;
      }
    }
  }

  /**
   * Token-bucket-ish per-connection rate limit. Window: 60 s.
   */
  private allowRate(transient: {
    windowStart: number;
    windowCount: number;
  }): boolean {
    const now = Date.now();
    if (now - transient.windowStart >= 60_000) {
      transient.windowStart = now;
      transient.windowCount = 0;
    }
    transient.windowCount += 1;
    return transient.windowCount <= this.limits.msgRateLimitPerMin;
  }

  /**
   * Send a `ping` and, if the previous ping was never answered within
   * `idleTimeoutMs`, terminate the socket. The `ws` library raises the
   * `pong` event when the peer responds; the timestamp lives on
   * `transient.lastPongAt`.
   */
  private heartbeat(
    ws: WebSocket,
    transient: { lastPongAt: number },
  ): void {
    if (ws.readyState !== ws.OPEN) return;
    if (Date.now() - transient.lastPongAt > this.limits.idleTimeoutMs) {
      console.warn('[gateway] terminating idle ws (no pong)');
      ws.terminate();
      return;
    }
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
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
    void recordGatewayAudit(this.prisma, {
      tenantId: worker.auth.tenantId,
      runtimeApiKeyId: worker.auth.runtimeApiKeyId,
      action: 'dispatched',
      resourceType: 'worker_dispatch',
      resourceId: job.jobId,
      outcome: 'dispatched',
      remoteAddr: worker.remoteAddr,
      metadata: {
        workerId: worker.workerId,
        workflowRunId: job.workflowRunId,
        executionProfile: job.executionProfile,
      },
    });
  }

  private sendControlMessage(
    dispatchAttemptId: string,
    payload: Record<string, unknown>,
  ): boolean {
    for (const worker of this.workers.values()) {
      if (
        worker.currentJobId === dispatchAttemptId &&
        worker.ws.readyState === worker.ws.OPEN
      ) {
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
