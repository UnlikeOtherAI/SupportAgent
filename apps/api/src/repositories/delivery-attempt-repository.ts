import { type PrismaClient, type Prisma } from '@prisma/client';

export function createDeliveryAttemptRepository(prisma: PrismaClient) {
  return {
    async listByRunId(workflowRunId: string) {
      return prisma.outboundDeliveryAttempt.findMany({
        where: { workflowRunId },
        include: { outboundDestination: true, finding: true },
        orderBy: { createdAt: 'desc' },
      });
    },

    async create(data: Prisma.OutboundDeliveryAttemptCreateInput) {
      return prisma.outboundDeliveryAttempt.create({ data });
    },

    async updateStatus(
      id: string,
      status: string,
      extra?: { response?: Prisma.InputJsonValue; errorMessage?: string },
    ) {
      return prisma.outboundDeliveryAttempt.update({
        where: { id },
        data: {
          status: status as any,
          response: extra?.response,
          errorMessage: extra?.errorMessage,
        },
      });
    },
  };
}

export type DeliveryAttemptRepository = ReturnType<typeof createDeliveryAttemptRepository>;
