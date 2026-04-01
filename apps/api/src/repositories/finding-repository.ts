import { type PrismaClient, type Prisma } from '@prisma/client';

export function createFindingRepository(prisma: PrismaClient) {
  return {
    async listByRunId(workflowRunId: string) {
      return prisma.finding.findMany({
        where: { workflowRunId },
        orderBy: { createdAt: 'desc' },
      });
    },

    async getById(id: string) {
      return prisma.finding.findUnique({
        where: { id },
        include: { workflowRun: true, deliveryAttempts: true },
      });
    },

    async create(data: Prisma.FindingCreateInput) {
      return prisma.finding.create({ data });
    },

    async update(id: string, data: Prisma.FindingUpdateInput) {
      return prisma.finding.update({ where: { id }, data });
    },
  };
}

export type FindingRepository = ReturnType<typeof createFindingRepository>;
