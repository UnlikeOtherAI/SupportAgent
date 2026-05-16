import { type PrismaClient, Prisma } from '@prisma/client';
import { type WebhookNormalizer } from './normalizers/base-normalizer.js';
import { githubNormalizer } from './normalizers/github-normalizer.js';
import { sentryNormalizer } from './normalizers/sentry-normalizer.js';
import { linearNormalizer } from './normalizers/linear-normalizer.js';
import { jiraNormalizer } from './normalizers/jira-normalizer.js';

const normalizers: Record<string, WebhookNormalizer> = {
  github: githubNormalizer,
  github_issues: githubNormalizer,
  sentry: sentryNormalizer,
  linear: linearNormalizer,
  jira: jiraNormalizer,
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
      if (
        this.getNormalizer(connector.platformType.key) &&
        connector.platformType.key !== platformType
      ) {
        throw Object.assign(new Error('Platform type mismatch'), { statusCode: 400 });
      }

      // 2. Verify signature
      const normalizer = this.getNormalizer(platformType);
      if (!normalizer)
        throw Object.assign(new Error(`Unsupported platform: ${platformType}`), {
          statusCode: 400,
        });

      // HMAC verification is MANDATORY. A connector with no webhookSecret
      // configured cannot accept inbound webhooks — operators must set the
      // secret during onboarding before the route accepts traffic.
      if (!connector.webhookSecret || connector.webhookSecret.trim() === '') {
        throw Object.assign(
          new Error('Connector requires a webhook signing secret before it can accept webhooks'),
          { statusCode: 401 },
        );
      }
      if (!signature?.trim()) {
        throw Object.assign(new Error('Missing webhook signature'), { statusCode: 401 });
      }

      const valid = normalizer.verifySignature(rawBody, signature, connector.webhookSecret);
      if (!valid)
        throw Object.assign(new Error('Invalid webhook signature'), { statusCode: 401 });

      // 3. Normalize
      const parsed = JSON.parse(rawBody);
      const normalized = normalizer.normalize(parsed);
      if (!normalized) return { status: 'ignored', reason: 'Unhandled event type' };

      return prisma.$transaction(
        async (tx) => {
          // 4. Deduplicate
          const existing = await tx.inboundWorkItem.findFirst({
            where: { dedupeKey: normalized.dedupeKey },
          });
          if (existing) return { status: 'duplicate', workItemId: existing.id };

          // 5. Find repository mapping
          const repoMapping = await tx.repositoryMapping.findFirst({
            where: { connectorId: connector.id },
          });

          // 6. Create work item
          const workItem = await tx.inboundWorkItem.create({
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
              attachments:
                (normalized.attachments ?? undefined) as Prisma.InputJsonValue | undefined,
              comments: (normalized.comments ?? undefined) as Prisma.InputJsonValue | undefined,
              dependencyRefs:
                (normalized.dependencyRefs ?? undefined) as Prisma.InputJsonValue | undefined,
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
            const runConfig =
              normalized.triggerLabel === 'needs triage' ||
              normalized.triggerLabel === 'needs-triage'
                ? { skipBuildChain: true }
                : null;
            workflowRun = await tx.workflowRun.create({
              data: {
                tenantId: connector.tenantId,
                workflowType: 'triage',
                status: 'queued',
                workItemId: workItem.id,
                repositoryMappingId: repoMapping.id,
                ...(runConfig ? { config: runConfig } : {}),
              },
            });
          }

          return {
            status: 'created',
            workItemId: workItem.id,
            workflowRunId: workflowRun?.id ?? null,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },
  };
}

export type IntakeService = ReturnType<typeof createIntakeService>;
