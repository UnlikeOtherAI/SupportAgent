import { z } from 'zod';
import { WorkflowType, WorkflowRunStatus } from './enums.js';

export const WorkflowRunSchema = z.object({
  workflowRunId: z.string().uuid(),
  workflowType: WorkflowType,
  workItemId: z.string().uuid(),
  repositoryMappingId: z.string().uuid(),
  executionProfileId: z.string().uuid().optional(),
  orchestrationProfileId: z.string().uuid().optional(),
  reviewProfileId: z.string().uuid().optional(),
  workflowScenarioId: z.string().uuid().optional(),
  parentWorkflowRunId: z.string().uuid().optional(),
  status: WorkflowRunStatus,
  currentStage: z.string().optional(),
  attemptNumber: z.number().int().default(1),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  blockedReason: z.string().optional(),
  providerExecutionRef: z.string().optional(),
  acceptedDispatchAttempt: z.string().uuid().optional(),
});

export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;
