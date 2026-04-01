import { z } from 'zod';
import { WorkItemKind, ReviewTargetType } from './enums.js';

export const WorkItemSchema = z.object({
  workItemId: z.string().uuid(),
  connectorInstanceId: z.string().uuid(),
  platformType: z.string(),
  workItemKind: WorkItemKind,
  externalItemId: z.string(),
  externalUrl: z.string().url().optional(),
  title: z.string(),
  body: z.string().optional(),
  priority: z.string().optional(),
  severity: z.string().optional(),
  status: z.string().optional(),
  taxonomy: z.record(z.unknown()).optional(),
  attachments: z.array(z.object({
    attachmentId: z.string(),
    url: z.string().url(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    description: z.string().optional(),
  })).optional(),
  comments: z.array(z.object({
    commentId: z.string(),
    author: z.string(),
    body: z.string(),
    createdAt: z.string().datetime(),
    isBotMention: z.boolean().optional(),
  })).optional(),
  dependencyRefs: z.array(z.string()).optional(),
  sourcePayloadRef: z.string().optional(),
  repositoryMappingId: z.string().uuid().optional(),
  dedupeKey: z.string(),
  // Review target fields (required when workItemKind = 'review_target')
  repositoryRef: z.string().optional(),
  baseRef: z.string().optional(),
  headRef: z.string().optional(),
  commitRange: z.string().optional(),
  diffRef: z.string().optional(),
  reviewTargetType: ReviewTargetType.optional(),
  reviewTargetNumber: z.number().int().optional(),
});

export type WorkItem = z.infer<typeof WorkItemSchema>;
