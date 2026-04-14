import { Prisma, type PrismaClient } from '@prisma/client';
import { GitHubConnectorConfigSchema } from '@support-agent/contracts';

type PolledIssueComment = {
  author: string;
  body: string;
  createdAt: string;
  id: string;
  url?: string;
};

type PolledIssue = {
  body: string | null;
  comments: PolledIssueComment[];
  labels: string[];
  number: number;
  state: string;
  title: string;
  updatedAt?: string;
  url: string;
};

function parseConnectorConfig(capabilities: unknown) {
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    return {};
  }
  return GitHubConnectorConfigSchema.parse(capabilities);
}

export function createPollingTriageService(prisma: PrismaClient) {
  return {
    async listTargets(tenantId: string) {
      const mappings = await prisma.repositoryMapping.findMany({
        where: {
          tenantId,
          connector: {
            isEnabled: true,
            effectiveIntakeMode: 'polling',
            platformType: {
              key: { in: ['github', 'github_issues'] },
            },
          },
        },
        include: {
          connector: {
            include: {
              platformType: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      return mappings
        .map((mapping) => ({
          connectorId: mapping.connectorId,
          connectorName: mapping.connector.name,
          platformTypeKey: mapping.connector.platformType.key,
          pollingIntervalSeconds: mapping.connector.pollingIntervalSeconds ?? 300,
          repositoryMappingId: mapping.id,
          repositoryUrl: mapping.repositoryUrl,
          defaultBranch: mapping.defaultBranch,
          config: parseConnectorConfig(mapping.connector.capabilities),
        }))
        .filter((mapping) => mapping.config.auth_mode === 'local_gh');
    },

    async enqueueIssue(
      tenantId: string,
      input: {
        connectorId: string;
        issue: PolledIssue;
        repositoryMappingId: string;
      },
    ) {
      const mapping = await prisma.repositoryMapping.findFirst({
        where: {
          id: input.repositoryMappingId,
          tenantId,
          connectorId: input.connectorId,
        },
        include: {
          connector: {
            include: {
              platformType: true,
            },
          },
        },
      });

      if (!mapping) {
        throw Object.assign(new Error('Repository mapping not found'), { statusCode: 404 });
      }

      if (mapping.connector.effectiveIntakeMode !== 'polling') {
        throw Object.assign(new Error('Connector is not configured for polling'), {
          statusCode: 400,
        });
      }

      const config = parseConnectorConfig(mapping.connector.capabilities);
      if (config.auth_mode !== 'local_gh') {
        throw Object.assign(new Error('Connector is not configured for local gh polling'), {
          statusCode: 400,
        });
      }

      const dedupeKey = `poll:${mapping.connectorId}:${mapping.repositoryUrl}:${input.issue.number}`;

      return prisma.$transaction(
        async (transaction) => {
          const existingWorkItem = await transaction.inboundWorkItem.findFirst({
            where: { dedupeKey },
          });
          if (existingWorkItem) {
            const existingRun = await transaction.workflowRun.findFirst({
              where: {
                workItemId: existingWorkItem.id,
                workflowType: 'triage',
              },
              orderBy: { createdAt: 'desc' },
            });

            return {
              status: 'duplicate' as const,
              workItemId: existingWorkItem.id,
              workflowRunId: existingRun?.id ?? null,
            };
          }

          const workItem = await transaction.inboundWorkItem.create({
            data: {
              connectorInstanceId: mapping.connectorId,
              platformType: mapping.connector.platformType.key,
              workItemKind: 'issue',
              externalItemId: String(input.issue.number),
              externalUrl: input.issue.url,
              title: input.issue.title,
              body: input.issue.body ?? undefined,
              status: input.issue.state.toLowerCase(),
              comments: input.issue.comments.map((comment) => ({
                author: comment.author,
                body: comment.body,
                commentId: comment.id,
                createdAt: comment.createdAt,
              })) as Prisma.InputJsonValue,
              dedupeKey,
              repositoryMappingId: mapping.id,
              repositoryRef: mapping.repositoryUrl,
            },
          });

          const workflowRun = await transaction.workflowRun.create({
            data: {
              tenantId,
              workflowType: 'triage',
              status: 'queued',
              workItemId: workItem.id,
              repositoryMappingId: mapping.id,
            },
          });

          return {
            status: 'created' as const,
            workItemId: workItem.id,
            workflowRunId: workflowRun.id,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },
  };
}

export type PollingTriageService = ReturnType<typeof createPollingTriageService>;
