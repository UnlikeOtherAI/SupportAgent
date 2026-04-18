import { z } from 'zod';

export const WorkflowType = z.enum(['triage', 'build', 'merge', 'review']);
export type WorkflowType = z.infer<typeof WorkflowType>;

export const ReviewStage = z.enum([
  'context_fetch', 'repository_setup', 'diff_read', 'analysis', 'comment_post',
]);
export type ReviewStage = z.infer<typeof ReviewStage>;

export const WorkflowRunStatus = z.enum([
  'queued', 'blocked', 'dispatched', 'running',
  'awaiting_review', 'awaiting_human',
  'succeeded', 'failed', 'canceled', 'lost',
]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatus>;

export const WorkItemKind = z.enum(['issue', 'review_target']);
export type WorkItemKind = z.infer<typeof WorkItemKind>;

export const ReviewTargetType = z.enum(['pull_request', 'merge_request']);
export type ReviewTargetType = z.infer<typeof ReviewTargetType>;

export const OutputVisibility = z.enum(['full', 'redacted', 'metadata_only']);
export type OutputVisibility = z.infer<typeof OutputVisibility>;

export const TriageStage = z.enum([
  'intake', 'context_fetch', 'repository_setup',
  'investigation', 'reproduction', 'findings', 'delivery',
]);
export type TriageStage = z.infer<typeof TriageStage>;

export const BuildStage = z.enum([
  'context_fetch', 'repository_setup', 'implementation',
  'validation', 'internal_review', 'branch_push', 'pr_open',
]);
export type BuildStage = z.infer<typeof BuildStage>;

export const MergeStage = z.enum([
  'context_fetch', 'repository_setup', 'base_sync',
  'conflict_resolution', 'validation', 'internal_review', 'merge_execute',
]);
export type MergeStage = z.infer<typeof MergeStage>;

export const ReproductionStatus = z.enum([
  'not_attempted', 'attempted', 'reproduced', 'not_reproduced', 'inconclusive',
]);
export type ReproductionStatus = z.infer<typeof ReproductionStatus>;
