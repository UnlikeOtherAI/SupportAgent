import { createHmac, timingSafeEqual } from 'crypto';
import { type WebhookNormalizer, type NormalizedWorkItem } from './base-normalizer.js';

const TRIGGER_LABELS = ['needs triage', 'needs PR'] as const;
type TriggerLabel = (typeof TRIGGER_LABELS)[number];

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
    if (payload.type !== 'Issue') return null;

    const data = payload.data;
    const action: string = payload.action;

    if (action === 'create') {
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
    }

    if (action === 'update' && payload.updatedFrom) {
      const currentLabels: Array<{ id: string; name: string }> = data.labels ?? [];
      // updatedFrom.labelIds holds the IDs that were present before the update
      const previousLabelIds: string[] = Array.isArray(payload.updatedFrom?.labelIds)
        ? payload.updatedFrom.labelIds
        : Array.isArray(payload.updatedFrom?.labels)
          ? (payload.updatedFrom.labels as any[]).map((l) => l.id)
          : [];

      // Find a trigger label that was newly added (present now but not before)
      const addedTrigger = currentLabels.find(
        (l) =>
          (TRIGGER_LABELS as readonly string[]).includes(l.name) &&
          !previousLabelIds.includes(l.id),
      );
      if (!addedTrigger) return null;

      const triggerLabel = addedTrigger.name as TriggerLabel;

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
          labels: currentLabels.map((l) => l.name),
          teamId: data.teamId,
          projectId: data.projectId,
        },
        triggerLabel,
        dedupeKey: `linear:issue:${data.id}:labeled:${triggerLabel}`,
      };
    }

    return null;
  },
};
