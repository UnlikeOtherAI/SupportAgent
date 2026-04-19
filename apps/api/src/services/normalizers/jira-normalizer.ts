import { createHmac, timingSafeEqual } from 'crypto';
import { type WebhookNormalizer, type NormalizedWorkItem } from './base-normalizer.js';

function adfToPlainText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'text' && typeof n.text === 'string') return n.text;
  if (Array.isArray(n.content)) {
    const parts = n.content.map((child) => adfToPlainText(child));
    if (n.type === 'paragraph' || n.type === 'heading') return parts.join('') + '\n';
    return parts.join('');
  }
  return '';
}

function descriptionToText(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return raw;
  return adfToPlainText(raw).trim() || undefined;
}

export const jiraNormalizer: WebhookNormalizer = {
  platformType: 'jira',

  verifySignature(payload, signature, secret) {
    // Jira Cloud uses X-Hub-Signature with HMAC-SHA256
    const sig = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  },

  normalize(rawPayload: unknown): NormalizedWorkItem | null {
    const payload = rawPayload as any;
    const event: string = payload.webhookEvent ?? '';

    // Only handle issue creation and updates for now
    if (!event.includes('jira:issue_created') && !event.includes('jira:issue_updated')) {
      return null;
    }

    const issue = payload.issue;
    if (!issue?.key) return null;

    const fields = issue.fields ?? {};
    const summary: string = fields.summary ?? issue.key;
    const description = descriptionToText(fields.description);
    const statusName: string = fields.status?.name ?? 'Unknown';
    const priorityName: string | undefined = fields.priority?.name;
    const labels: string[] = fields.labels ?? [];
    const baseUrl = issue.self
      ? new URL(issue.self).origin
      : undefined;
    const externalUrl = baseUrl ? `${baseUrl}/browse/${issue.key}` : undefined;

    return {
      platformType: 'jira',
      workItemKind: 'issue',
      externalItemId: issue.key,
      externalUrl,
      title: summary,
      body: description,
      priority: priorityName,
      status: statusName,
      taxonomy: { labels, projectKey: issue.key.split('-')[0] },
      dedupeKey: `jira:issue:${issue.key}:${event}`,
    };
  },
};
