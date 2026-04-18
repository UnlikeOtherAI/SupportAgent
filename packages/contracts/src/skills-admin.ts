import { z } from 'zod';

export const SkillRoleSchema = z.enum(['SYSTEM', 'COMPLEMENTARY']);
export type SkillRole = z.infer<typeof SkillRoleSchema>;

export const SkillSourceSchema = z.enum(['BUILTIN', 'USER']);
export type SkillSource = z.infer<typeof SkillSourceSchema>;

export const ExecutorSourceSchema = z.enum(['BUILTIN', 'USER']);
export type ExecutorSource = z.infer<typeof ExecutorSourceSchema>;

export const ClonedFromSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
});
export type ClonedFrom = z.infer<typeof ClonedFromSchema>;

export const SkillSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  role: SkillRoleSchema,
  source: SkillSourceSchema,
  description: z.string(),
  bodyPreview: z.string(),
  clonedFrom: ClonedFromSchema.nullable(),
  updatedAt: z.string(),
});
export type SkillSummary = z.infer<typeof SkillSummarySchema>;

export const SkillDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  role: SkillRoleSchema,
  source: SkillSourceSchema,
  description: z.string(),
  body: z.string(),
  outputSchema: z.record(z.unknown()).nullable(),
  contentHash: z.string().min(1),
  clonedFrom: ClonedFromSchema.nullable(),
  updatedAt: z.string(),
});
export type SkillDetail = z.infer<typeof SkillDetailSchema>;

export const CreateSkillCloneSchema = z.object({
  clonedFromSkillId: z.string().uuid(),
  name: z.string().min(1).max(255),
});
export type CreateSkillClone = z.infer<typeof CreateSkillCloneSchema>;

export const UpdateSkillSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().min(1).max(5000).optional(),
  body: z.string().min(1).optional(),
  outputSchema: z.record(z.unknown()).nullable().optional(),
});
export type UpdateSkill = z.infer<typeof UpdateSkillSchema>;

export const ExecutorSummarySchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1),
  description: z.string(),
  source: ExecutorSourceSchema,
  clonedFrom: ClonedFromSchema.nullable(),
  updatedAt: z.string(),
});
export type ExecutorSummary = z.infer<typeof ExecutorSummarySchema>;

export const ExecutorDetailSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1),
  description: z.string(),
  yaml: z.string().min(1),
  parsed: z.record(z.unknown()),
  contentHash: z.string().min(1),
  source: ExecutorSourceSchema,
  clonedFrom: ClonedFromSchema.nullable(),
  updatedAt: z.string(),
});
export type ExecutorDetail = z.infer<typeof ExecutorDetailSchema>;

export const CreateExecutorCloneSchema = z.object({
  clonedFromExecutorId: z.string().uuid(),
  key: z.string().min(1).max(255),
});
export type CreateExecutorClone = z.infer<typeof CreateExecutorCloneSchema>;

export const UpdateExecutorSchema = z.object({
  key: z.string().min(1).max(255).optional(),
  description: z.string().min(1).max(5000).optional(),
  yaml: z.string().min(1).optional(),
});
export type UpdateExecutor = z.infer<typeof UpdateExecutorSchema>;
