import { type WebSocket } from 'ws';
import { type WorkerJob } from '@support-agent/contracts';
import { type RuntimeKeyContext } from './runtime-key-auth.js';

export interface ConnectedWorker {
  ws: WebSocket;
  workerId: string;
  capabilities: string[];
  busy: boolean;
  currentJobId: string | null;
  auth: RuntimeKeyContext;
  remoteAddr: string;
}

export interface PendingJob {
  job: WorkerJob;
  resolve: () => void;
  reject: (err: Error) => void;
}

export interface ConnectionLimits {
  maxPayloadBytes: number;
  pingIntervalMs: number;
  idleTimeoutMs: number;
  msgRateLimitPerMin: number;
  maxConnPerTenant: number;
}

export interface AcceptConnectionInput {
  ws: WebSocket;
  auth: RuntimeKeyContext;
  remoteAddr: string;
}
