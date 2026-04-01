import { createHmac, timingSafeEqual } from 'crypto';
import { type WebhookNormalizer, type NormalizedWorkItem } from './base-normalizer.js';

export const sentryNormalizer: WebhookNormalizer = {
  platformType: 'sentry',

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
    const data = payload.data;
    if (!data?.issue) return null;

    const issue = data.issue;
    return {
      platformType: 'sentry',
      workItemKind: 'issue',
      externalItemId: String(issue.id),
      externalUrl: issue.permalink,
      title: issue.title,
      body: issue.culprit ?? issue.metadata?.value,
      priority: issue.priority ?? undefined,
      severity: issue.level ?? undefined,
      status: issue.status,
      taxonomy: { project: payload.data?.project?.slug },
      dedupeKey: `sentry:issue:${issue.id}:${payload.action ?? 'created'}`,
    };
  },
};
