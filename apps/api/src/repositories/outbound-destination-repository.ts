import { type PrismaClient, type Prisma } from '@prisma/client';

export function createOutboundDestinationRepository(prisma: PrismaClient) {
  return {
    async list(tenantId: string) {
      return prisma.outboundDestination.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
    },

    async getById(id: string, tenantId: string) {
      return prisma.outboundDestination.findFirst({
        where: { id, tenantId },
      });
    },

    async create(data: Prisma.OutboundDestinationCreateInput) {
      return prisma.outboundDestination.create({ data });
    },

    async update(id: string, tenantId: string, data: Prisma.OutboundDestinationUpdateInput) {
      const dest = await prisma.outboundDestination.findFirst({ where: { id, tenantId } });
      if (!dest) return null;
      return prisma.outboundDestination.update({ where: { id }, data });
    },

    async delete(id: string, tenantId: string) {
      return prisma.outboundDestination.deleteMany({ where: { id, tenantId } });
    },
  };
}

export type OutboundDestinationRepository = ReturnType<typeof createOutboundDestinationRepository>;
