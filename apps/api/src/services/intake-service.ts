import { type PrismaClient, type Prisma } from '@prisma/client';
import { type WebhookNormalizer } from './normalizers/base-normalizer.js';
import { githubNormalizer } from './normalizers/github-normalizer.js';
import { sentryNormalizer } from './normalizers/sentry-normalizer.js';
import { linearNormalizer } from './normalizers/linear-normalizer.js';

const normalizers: Record<string, WebhookNormalizer> = {
  github: githubNormalizer,
  github_issues: githubNormalizer,
  sentry: sentryNormalizer,
  linear: linearNormalizer,
};

export function createIntakeService(prisma: PrismaClient) {
  return {
    getNormalizer(platformType: string): WebhookNormalizer | undefined {
      return normalizers[platformType];
    },

    async processWebhook(
      connectorId: string,
      platformType: string,
      rawBody: string,
      signature: string | undefined,
    ) {
      // 1. Load connector
      const connector = await prisma.connector.findUnique({
        where: { id: connectorId },
        include: { platformType: true },
      });
      if (!connector)
        throw Object.assign(new Error('Connector not found'), { statusCode: 404 });
      if (!connector.isEnabled)
        throw Object.assign(new Error('Connector is disabled'), { statusCode: 403 });

      // 2. Verify signature
      const normalizer = this.getNormalizer(platformType);
      if (!normalizer)
        throw Object.assign(new Error(`Unsupported platform: ${platformType}`), {
          statusCode: 400,
        });

      if (connector.webhookSecret && signature) {
        const valid = normalizer.verifySignature(rawBody, signature, connector.webhookSecret);
        if (!valid)
          throw Object.assign(new Error('Invalid webhook signature'), { statusCode: 401 });
      }

      // 3. Normalize
      const parsed = JSON.parse(rawBody);
      const normalized = normalizer.normalize(parsed);
      if (!normalized) return { status: 'ignored', reason: 'Unhandled event type' };

      // 4. Deduplicate
      const existing = await prisma.inboundWorkItem.findFirst({
        where: { dedupeKey: normalized.dedupeKey },
      });
      if (existing) return { status: 'duplicate', workItemId: existing.id };

      // 5. Find repository mapping
      const repoMapping = await prisma.repositoryMapping.findFirst({
        where: { connectorId: connector.id },
      });

      // 6. Create work item
      const workItem = await prisma.inboundWorkItem.create({
        data: {
          connectorInstanceId: connector.id,
          platformType: normalized.platformType,
          workItemKind: normalized.workItemKind as any,
          externalItemId: normalized.externalItemId,
          externalUrl: normalized.externalUrl,
          title: normalized.title,
          body: normalized.body,
          priority: normalized.priority,
          severity: normalized.severity,
          status: normalized.status,
          taxonomy: (normalized.taxonomy ?? undefined) as Prisma.InputJsonValue | undefined,
          attachments: (normalized.attachments ?? undefined) as Prisma.InputJsonValue | undefined,
          comments: (normalized.comments ?? undefined) as Prisma.InputJsonValue | undefined,
          dependencyRefs: (normalized.dependencyRefs ?? undefined) as Prisma.InputJsonValue | undefined,
          dedupeKey: normalized.dedupeKey,
          repositoryMappingId: repoMapping?.id,
          repositoryRef: normalized.repositoryRef,
          baseRef: normalized.baseRef,
          headRef: normalized.headRef,
          reviewTargetType: normalized.reviewTargetType,
          reviewTargetNumber: normalized.reviewTargetNumber,
        },
      });

      // 7. Create workflow run if repo mapping exists
      let workflowRun = null;
      if (repoMapping) {
        workflowRun = await prisma.workflowRun.create({
          data: {
            tenantId: connector.tenantId,
            workflowType: 'triage',
            status: 'queued',
            workItemId: workItem.id,
            repositoryMappingId: repoMapping.id,
          },
        });
      }

      return {
        status: 'created',
        workItemId: workItem.id,
        workflowRunId: workflowRun?.id ?? null,
      };
    },
  };
}

export type IntakeService = ReturnType<typeof createIntakeService>;
