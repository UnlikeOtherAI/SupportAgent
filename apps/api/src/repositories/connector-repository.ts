import { type PrismaClient, type Prisma } from '@prisma/client';

export function createConnectorRepository(prisma: PrismaClient) {
  return {
    async list(tenantId: string, opts?: { direction?: string; isEnabled?: boolean }) {
      const where: Prisma.ConnectorWhereInput = { tenantId };
      if (opts?.direction) where.direction = opts.direction as Prisma.EnumConnectorDirectionFilter;
      if (opts?.isEnabled !== undefined) where.isEnabled = opts.isEnabled;
      return prisma.connector.findMany({
        where,
        include: { platformType: true, endpoints: true },
        orderBy: { createdAt: 'desc' },
      });
    },

    async getById(id: string, tenantId: string) {
      return prisma.connector.findFirst({
        where: { id, tenantId },
        include: { platformType: true, endpoints: true, connectorCapabilities: true },
      });
    },

    async create(data: Prisma.ConnectorCreateInput) {
      return prisma.connector.create({
        data,
        include: { platformType: true },
      });
    },

    async update(id: string, tenantId: string, data: Prisma.ConnectorUpdateInput) {
      return prisma.connector.updateMany({ where: { id, tenantId }, data });
    },

    async delete(id: string, tenantId: string) {
      return prisma.$transaction(async (tx) => {
        await tx.connectorCapability.deleteMany({ where: { connectorId: id } });
        await tx.connectorEndpoint.deleteMany({ where: { connectorId: id } });
        await tx.connectorTaxonomyCache.deleteMany({ where: { connectorId: id } });
        await tx.connectorScopeMapping.deleteMany({ where: { connectorId: id } });
        await tx.connectionSecret.deleteMany({ where: { connectorId: id } });
        return tx.connector.deleteMany({ where: { id, tenantId } });
      });
    },

    async listCapabilities(connectorId: string) {
      return prisma.connectorCapability.findMany({ where: { connectorId } });
    },

    async upsertCapability(
      connectorId: string,
      capabilityKey: string,
      isSupported: boolean,
      metadata?: Prisma.InputJsonValue,
    ) {
      const existing = await prisma.connectorCapability.findFirst({
        where: { connectorId, capabilityKey },
      });
      if (existing) {
        return prisma.connectorCapability.update({
          where: { id: existing.id },
          data: { isSupported, metadata, discoveredAt: new Date() },
        });
      }
      return prisma.connectorCapability.create({
        data: { connectorId, capabilityKey, isSupported, metadata, discoveredAt: new Date() },
      });
    },
  };
}

export type ConnectorRepository = ReturnType<typeof createConnectorRepository>;
