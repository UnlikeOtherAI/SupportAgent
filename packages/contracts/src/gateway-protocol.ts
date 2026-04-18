import { z } from 'zod';
import { WorkerJobSchema } from './worker-job.js';

// ── Gateway → Worker messages ──────────────────────────────

export const GatewayDispatchMessage = z.object({
  type: z.literal('dispatch'),
  job: WorkerJobSchema,
});

export const GatewayCancelRequestedMessage = z.object({
  type: z.literal('cancel_requested'),
  dispatchAttemptId: z.string().uuid(),
  workflowRunId: z.string().uuid(),
});

export const GatewayCancelForceMessage = z.object({
  type: z.literal('cancel_force'),
  dispatchAttemptId: z.string().uuid(),
  workflowRunId: z.string().uuid(),
});

export const GatewayPingMessage = z.object({
  type: z.literal('ping'),
});

export const GatewayMessage = z.discriminatedUnion('type', [
  GatewayDispatchMessage,
  GatewayCancelRequestedMessage,
  GatewayCancelForceMessage,
  GatewayPingMessage,
]);

export type GatewayMessage = z.infer<typeof GatewayMessage>;

// ── Worker → Gateway messages ──────────────────────────────

export const WorkerRegisterMessage = z.object({
  type: z.literal('register'),
  workerId: z.string(),
  capabilities: z.array(z.string()).optional(),
});

export const WorkerPongMessage = z.object({
  type: z.literal('pong'),
});

export const WorkerJobAcceptedMessage = z.object({
  type: z.literal('job-accepted'),
  jobId: z.string(),
});

export const WorkerJobCompletedMessage = z.object({
  type: z.literal('job-completed'),
  jobId: z.string(),
});

export const WorkerJobFailedMessage = z.object({
  type: z.literal('job-failed'),
  jobId: z.string(),
  error: z.string(),
});

export const WorkerToGatewayMessage = z.discriminatedUnion('type', [
  WorkerRegisterMessage,
  WorkerPongMessage,
  WorkerJobAcceptedMessage,
  WorkerJobCompletedMessage,
  WorkerJobFailedMessage,
]);

export type WorkerToGatewayMessage = z.infer<typeof WorkerToGatewayMessage>;
