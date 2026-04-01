import { type PrismaClient, type Prisma } from '@prisma/client';

export function createRepositoryMappingRepository(prisma: PrismaClient) {
  const includeRelations = {
    connector: { include: { platformType: true } },
    executionProfile: true,
  };

  return {
    async list(tenantId: string, opts?: { connectorId?: string }) {
      const where: Prisma.RepositoryMappingWhereInput = { tenantId };
      if (opts?.connectorId) where.connectorId = opts.connectorId;
      return prisma.repositoryMapping.findMany({
        where,
        include: includeRelations,
        orderBy: { createdAt: 'desc' },
      });
    },

    async getById(id: string, tenantId: string) {
      return prisma.repositoryMapping.findFirst({
        where: { id, tenantId },
        include: includeRelations,
      });
    },

    async create(data: Prisma.RepositoryMappingUncheckedCreateInput) {
      return prisma.repositoryMapping.create({
        data,
        include: includeRelations,
      });
    },

    async update(id: string, tenantId: string, data: Prisma.RepositoryMappingUpdateInput) {
      await prisma.repositoryMapping.updateMany({ where: { id, tenantId }, data });
      return prisma.repositoryMapping.findFirst({
        where: { id, tenantId },
        include: includeRelations,
      });
    },

    async delete(id: string, tenantId: string) {
      return prisma.repositoryMapping.deleteMany({ where: { id, tenantId } });
    },
  };
}

export type RepositoryMappingRepository = ReturnType<typeof createRepositoryMappingRepository>;
