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

export const SkillRunResultSchema = z.object({
  delivery: z.array(DeliveryOpSchema),
  findings: StructuredFindingsSchema.optional(),
  reportSummary: z.string().optional(),
  loop: SkillRunLoopSchema.optional(),
  extras: z.record(z.unknown()).optional(),
}).superRefine((value, context) => {
  const hasRenderedFindings =
    !!value.findings &&
    Object.values(value.findings).some((field) => {
      if (field === undefined) {
        return false;
      }

      if (Array.isArray(field)) {
        return field.length > 0;
      }

      if (field && typeof field === 'object') {
        return Object.keys(field).length > 0;
      }

      return true;
    });

  if (!hasRenderedFindings) {
    return;
  }

  const commentIndex = value.delivery.findIndex((op) => op.kind === 'comment');
  if (commentIndex >= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['delivery', commentIndex],
      message: 'SkillRunResult leaf output cannot contain both findings and comment delivery ops',
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
