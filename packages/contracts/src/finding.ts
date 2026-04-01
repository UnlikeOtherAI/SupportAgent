import { z } from 'zod';
import { ReproductionStatus } from './enums.js';

export const FindingSchema = z.object({
  findingId: z.string().uuid(),
  workflowRunId: z.string().uuid(),
  summary: z.string(),
  rootCauseHypothesis: z.string().optional(),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  reproductionStatus: ReproductionStatus.optional(),
  affectedAreas: z.array(z.string()).optional(),
  evidenceRefs: z.array(z.string()).optional(),
  recommendedNextAction: z.string().optional(),
  outboundSummary: z.string().optional(),
  suspectCommits: z.array(z.string()).optional(),
  suspectFiles: z.array(z.string()).optional(),
  userVisibleImpact: z.string().optional(),
  designNotes: z.string().optional(),
});

export type Finding = z.infer<typeof FindingSchema>;
