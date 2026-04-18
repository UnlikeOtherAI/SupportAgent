import { z } from 'zod';

const DeliveryVisibilitySchema = z.enum(['public', 'internal']);

export const PrSpecSchema = z.object({
  branch: z.string(),
  title: z.string(),
  body: z.string(),
  base: z.string().optional(),
  commit_message: z.string().optional(),
  draft: z.boolean().optional(),
});

export const CommentDeliveryOpSchema = z.object({
  kind: z.literal('comment'),
  body: z.string(),
  visibility: DeliveryVisibilitySchema.optional(),
});

export const LabelsDeliveryOpSchema = z.object({
  kind: z.literal('labels'),
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
  visibility: DeliveryVisibilitySchema.optional(),
});

export const StateDeliveryOpSchema = z.object({
  kind: z.literal('state'),
  change: z.enum(['close', 'reopen', 'merge', 'request_changes', 'approve']),
  visibility: DeliveryVisibilitySchema.optional(),
});

export const PrDeliveryOpSchema = z.object({
  kind: z.literal('pr'),
  spec: PrSpecSchema,
  visibility: DeliveryVisibilitySchema.optional(),
});

export const DeliveryOpSchema = z.discriminatedUnion('kind', [
  CommentDeliveryOpSchema,
  LabelsDeliveryOpSchema,
  StateDeliveryOpSchema,
  PrDeliveryOpSchema,
]);

export const StructuredFindingsSchema = z.object({
  summary: z.string().optional(),
  rootCause: z.string().optional(),
  reproductionSteps: z.string().optional(),
  proposedFix: z.string().optional(),
  affectedAreas: z.array(z.string()).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  custom: z.record(z.unknown()).optional(),
});

export const SkillRunLoopSchema = z.object({
  done: z.boolean(),
  next_iteration_focus: z.string().optional(),
});

function hasPopulatedFindings(findings: z.infer<typeof StructuredFindingsSchema> | undefined): boolean {
  if (!findings) {
    return false;
  }

  return [
    typeof findings.summary === 'string' && findings.summary.trim() !== '',
    typeof findings.rootCause === 'string' && findings.rootCause.trim() !== '',
    typeof findings.reproductionSteps === 'string' && findings.reproductionSteps.trim() !== '',
    typeof findings.proposedFix === 'string' && findings.proposedFix.trim() !== '',
    Array.isArray(findings.affectedAreas) && findings.affectedAreas.length > 0,
    typeof findings.severity === 'string',
    typeof findings.confidence === 'string',
    !!findings.custom && Object.keys(findings.custom).length > 0,
  ].some(Boolean);
}

export const SkillRunResultSchema = z.object({
  delivery: z.array(DeliveryOpSchema),
  findings: StructuredFindingsSchema.optional(),
  reportSummary: z.string().optional(),
  loop: SkillRunLoopSchema.optional(),
  extras: z.record(z.unknown()).optional(),
}).superRefine((value, ctx) => {
  const hasCommentDelivery = value.delivery.some((op) => op.kind === 'comment');
  if (hasCommentDelivery && hasPopulatedFindings(value.findings)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Leaf results cannot include both populated findings and comment delivery ops',
      path: ['findings'],
    });
  }
});

export type PrSpec = z.infer<typeof PrSpecSchema>;
export type CommentDeliveryOp = z.infer<typeof CommentDeliveryOpSchema>;
export type LabelsDeliveryOp = z.infer<typeof LabelsDeliveryOpSchema>;
export type StateDeliveryOp = z.infer<typeof StateDeliveryOpSchema>;
export type PrDeliveryOp = z.infer<typeof PrDeliveryOpSchema>;
export type DeliveryOp = z.infer<typeof DeliveryOpSchema>;
export type StructuredFindings = z.infer<typeof StructuredFindingsSchema>;
export type SkillRunLoop = z.infer<typeof SkillRunLoopSchema>;
export type SkillRunResult = z.infer<typeof SkillRunResultSchema>;
