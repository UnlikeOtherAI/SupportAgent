export interface NormalizedWorkItem {
  platformType: string;
  workItemKind: 'issue' | 'review_target';
  externalItemId: string;
  externalUrl?: string;
  title: string;
  body?: string;
  priority?: string;
  severity?: string;
  status?: string;
  taxonomy?: Record<string, unknown>;
  attachments?: Array<{
    attachmentId: string;
    url: string;
    mimeType?: string;
    filename?: string;
  }>;
  comments?: Array<{
    commentId: string;
    author: string;
    body: string;
    createdAt: string;
    isBotMention?: boolean;
  }>;
  dependencyRefs?: string[];
  dedupeKey: string;
  // review target fields
  repositoryRef?: string;
  baseRef?: string;
  headRef?: string;
  reviewTargetType?: string;
  reviewTargetNumber?: number;
}

export interface WebhookNormalizer {
  platformType: string;
  verifySignature(payload: string, signature: string, secret: string): boolean;
  normalize(rawPayload: unknown): NormalizedWorkItem | null;
}
