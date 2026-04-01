import { createHmac, timingSafeEqual } from 'crypto';
import { type WebhookNormalizer, type NormalizedWorkItem } from './base-normalizer.js';

export const linearNormalizer: WebhookNormalizer = {
  platformType: 'linear',

  verifySignature(payload, signature, secret) {
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  },

  normalize(rawPayload: unknown): NormalizedWorkItem | null {
    const payload = rawPayload as any;
    if (payload.type !== 'Issue' || payload.action !== 'create') return null;

    const data = payload.data;
    return {
      platformType: 'linear',
      workItemKind: 'issue',
      externalItemId: data.id,
      externalUrl: data.url,
      title: data.title,
      body: data.description ?? undefined,
      priority: data.priority !== undefined ? String(data.priority) : undefined,
      status: data.state?.name,
      taxonomy: {
        labels: data.labels?.map((l: any) => l.name) ?? [],
        teamId: data.teamId,
        projectId: data.projectId,
      },
      dedupeKey: `linear:issue:${data.id}:create`,
    };
  },
};
