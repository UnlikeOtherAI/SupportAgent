import { z } from 'zod';
import { WorkflowType, WorkflowRunStatus } from './enums.js';
import { SkillRunResultSchema } from './skill-run-result.js';

export const FinalReportSchema = z.object({
  workflowRunId: z.string().uuid(),
  workflowType: WorkflowType,
  status: WorkflowRunStatus,
  summary: z.string(),
  stageResults: z.array(z.object({
    stage: z.string(),
    status: z.enum(['passed', 'failed', 'skipped']),
    summary: z.string().optional(),
    durationMs: z.number().optional(),
  })),
  artifactRefs: z.array(z.string()).optional(),
  logRef: z.string().optional(),
  findingsRef: z.string().optional(),
  leafOutputs: z.array(SkillRunResultSchema).optional(),
  reviewOutcome: z.string().optional(),
  outboundActions: z.array(z.object({
    destinationId: z.string(),
    actionType: z.string(),
    status: z.string(),
    externalRef: z.string().optional(),
  })).optional(),
  branchName: z.string().optional(),
  pullRequestRef: z.string().optional(),
  mergeRef: z.string().optional(),
  distributionRefs: z.array(z.string()).optional(),
  extras: z.record(z.unknown()).optional(),
});

export type FinalReport = z.infer<typeof FinalReportSchema>;
