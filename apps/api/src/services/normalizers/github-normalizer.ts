import { createHmac, timingSafeEqual } from 'crypto';
import { type WebhookNormalizer, type NormalizedWorkItem } from './base-normalizer.js';

export const githubNormalizer: WebhookNormalizer = {
  platformType: 'github',

  verifySignature(payload, signature, secret) {
    const expected =
      'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  },

  normalize(rawPayload: unknown): NormalizedWorkItem | null {
    const payload = rawPayload as any;

    // GitHub Issues
    if (payload.issue && payload.action === 'opened') {
      return {
        platformType: 'github',
        workItemKind: 'issue',
        externalItemId: String(payload.issue.number),
        externalUrl: payload.issue.html_url,
        title: payload.issue.title,
        body: payload.issue.body ?? undefined,
        priority: undefined,
        severity: undefined,
        status: payload.issue.state,
        taxonomy: {
          labels: payload.issue.labels?.map((l: any) => l.name) ?? [],
        },
        dedupeKey: `github:issue:${payload.repository?.full_name}:${payload.issue.number}`,
      };
    }

    // GitHub Pull Request
    if (
      payload.pull_request &&
      ['opened', 'synchronize', 'ready_for_review'].includes(payload.action)
    ) {
      return {
        platformType: 'github',
        workItemKind: 'review_target',
        externalItemId: String(payload.pull_request.number),
        externalUrl: payload.pull_request.html_url,
        title: payload.pull_request.title,
        body: payload.pull_request.body ?? undefined,
        status: payload.pull_request.state,
        taxonomy: {
          labels: payload.pull_request.labels?.map((l: any) => l.name) ?? [],
        },
        dedupeKey: `github:pr:${payload.repository?.full_name}:${payload.pull_request.number}:${payload.action}`,
        repositoryRef: payload.repository?.full_name,
        baseRef: payload.pull_request.base?.ref,
        headRef: payload.pull_request.head?.ref,
        reviewTargetType: 'pull_request',
        reviewTargetNumber: payload.pull_request.number,
      };
    }

    return null; // Unhandled event type
  },
};
