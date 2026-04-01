import { type RepositoryMappingRepository } from '../repositories/repository-mapping-repository.js';
import { type PrismaClient, type Prisma } from '@prisma/client';

export function createRepositoryMappingService(
  repo: RepositoryMappingRepository,
  prisma: PrismaClient,
) {
  return {
    async listMappings(tenantId: string, opts?: { connectorId?: string }) {
      return repo.list(tenantId, opts);
    },

    async getMapping(id: string, tenantId: string) {
      const mapping = await repo.getById(id, tenantId);
      if (!mapping)
        throw Object.assign(new Error('Repository mapping not found'), { statusCode: 404 });
      return mapping;
    },

    async createMapping(
      tenantId: string,
      input: {
        connectorId: string;
        repositoryUrl: string;
        defaultBranch?: string;
        executionProfileId?: string;
        orchestrationProfileId?: string;
        reviewProfileId?: string;
        dependencyPolicy?: Record<string, unknown>;
        notificationBindings?: Record<string, unknown>;
      },
    ) {
      const connector = await prisma.connector.findFirst({
        where: { id: input.connectorId, tenantId },
      });
      if (!connector)
        throw Object.assign(new Error('Connector not found or does not belong to tenant'), {
          statusCode: 400,
        });

      if (input.executionProfileId) {
        const profile = await prisma.executionProfile.findFirst({
          where: { id: input.executionProfileId, tenantId },
        });
        if (!profile)
          throw Object.assign(
            new Error('Execution profile not found or does not belong to tenant'),
            { statusCode: 400 },
          );
      }

      return repo.create({
        tenantId,
        connectorId: input.connectorId,
        repositoryUrl: input.repositoryUrl,
        defaultBranch: input.defaultBranch ?? 'main',
        executionProfileId: input.executionProfileId,
        orchestrationProfileId: input.orchestrationProfileId,
        reviewProfileId: input.reviewProfileId,
        dependencyPolicy: input.dependencyPolicy as Prisma.InputJsonValue | undefined,
        notificationBindings: input.notificationBindings as Prisma.InputJsonValue | undefined,
      });
    },

    async updateMapping(
      id: string,
      tenantId: string,
      input: {
        repositoryUrl?: string;
        defaultBranch?: string;
        executionProfileId?: string | null;
        orchestrationProfileId?: string | null;
        reviewProfileId?: string | null;
        dependencyPolicy?: Record<string, unknown> | null;
        notificationBindings?: Record<string, unknown> | null;
      },
    ) {
      await this.getMapping(id, tenantId);

      if (input.executionProfileId) {
        const profile = await prisma.executionProfile.findFirst({
          where: { id: input.executionProfileId, tenantId },
        });
        if (!profile)
          throw Object.assign(
            new Error('Execution profile not found or does not belong to tenant'),
            { statusCode: 400 },
          );
      }

      const data: Record<string, unknown> = {};
      if (input.repositoryUrl !== undefined) data.repositoryUrl = input.repositoryUrl;
      if (input.defaultBranch !== undefined) data.defaultBranch = input.defaultBranch;
      if (input.executionProfileId !== undefined)
        data.executionProfileId = input.executionProfileId;
      if (input.orchestrationProfileId !== undefined)
        data.orchestrationProfileId = input.orchestrationProfileId;
      if (input.reviewProfileId !== undefined) data.reviewProfileId = input.reviewProfileId;
      if (input.dependencyPolicy !== undefined) data.dependencyPolicy = input.dependencyPolicy;
      if (input.notificationBindings !== undefined)
        data.notificationBindings = input.notificationBindings;

      const updated = await repo.update(id, tenantId, data);
      if (!updated)
        throw Object.assign(new Error('Repository mapping not found'), { statusCode: 404 });
      return updated;
    },

    async deleteMapping(id: string, tenantId: string) {
      await this.getMapping(id, tenantId);
      await repo.delete(id, tenantId);
    },
  };
}

export type RepositoryMappingService = ReturnType<typeof createRepositoryMappingService>;
