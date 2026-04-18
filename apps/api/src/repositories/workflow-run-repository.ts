import { type PrismaClient, type Prisma } from '@prisma/client';

export interface WorkflowRunFilters {
  tenantId: string;
  workflowType?: string;
  status?: string;
  repositoryMappingId?: string;
  workflowScenarioId?: string;
  limit?: number;
  offset?: number;
}

export function createWorkflowRunRepository(prisma: PrismaClient) {
  return {
    async list(filters: WorkflowRunFilters) {
      const where: Prisma.WorkflowRunWhereInput = { tenantId: filters.tenantId };
      if (filters.workflowType) where.workflowType = filters.workflowType as any;
      if (filters.status) where.status = filters.status as any;
      if (filters.repositoryMappingId) where.repositoryMappingId = filters.repositoryMappingId;
      if (filters.workflowScenarioId) where.workflowScenarioId = filters.workflowScenarioId;

      const [items, total] = await Promise.all([
        prisma.workflowRun.findMany({
          where,
          include: { workItem: true, repositoryMapping: true },
          orderBy: { createdAt: 'desc' },
          take: filters.limit ?? 50,
          skip: filters.offset ?? 0,
        }),
        prisma.workflowRun.count({ where }),
      ]);

      return { items, total };
    },

    async getById(id: string, tenantId: string) {
      return prisma.workflowRun.findFirst({
        where: { id, tenantId },
        include: {
          workItem: true,
          repositoryMapping: true,
          findings: true,
          logEvents: { orderBy: { timestamp: 'asc' }, take: 100 },
          dispatches: true,
          reviews: true,
        },
      });
    },

    async listCheckpoints(id: string, tenantId: string) {
      return prisma.dispatchAttemptCheckpoint.findMany({
        where: {
          dispatchAttempt: {
            workflowRunId: id,
            workflowRun: { tenantId },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    },

    async create(data: Prisma.WorkflowRunCreateInput) {
      return prisma.workflowRun.create({ data });
    },

    async updateStatus(id: string, status: string, extra?: Record<string, any>) {
      const data: Record<string, any> = { status };
      if (extra) Object.assign(data, extra);
      if (status === 'running' && !extra?.startedAt) data.startedAt = new Date();
      if (['succeeded', 'failed', 'canceled'].includes(status) && !extra?.completedAt) {
        data.completedAt = new Date();
      }
      return prisma.workflowRun.update({ where: { id }, data });
    },

    async updateStatusConditional(
      id: string,
      expectedStatus: string,
      newStatus: string,
      extra?: Record<string, any>,
    ) {
      const data: Record<string, any> = { status: newStatus };
      if (extra) Object.assign(data, extra);
      if (newStatus === 'running' && !extra?.startedAt) data.startedAt = new Date();
      if (['succeeded', 'failed', 'canceled'].includes(newStatus) && !extra?.completedAt) {
        data.completedAt = new Date();
      }

      const updated = await prisma.workflowRun.updateMany({
        where: { id, status: expectedStatus as any },
        data,
      });
      if (updated.count === 0) {
        throw Object.assign(new Error('Concurrent status change detected'), {
          statusCode: 409,
        });
      }

      return prisma.workflowRun.findUnique({ where: { id } });
    },

    async updateStage(id: string, stage: string) {
      return prisma.workflowRun.update({ where: { id }, data: { currentStage: stage } });
    },

    async requestCancel(id: string, expectedStatuses: string[], requestedAt: Date) {
      const updated = await prisma.workflowRun.updateMany({
        where: {
          id,
          status: { in: expectedStatuses as any },
        },
        data: {
          status: 'cancel_requested',
          cancelRequestedAt: requestedAt,
        },
      });

      return updated.count > 0 ? prisma.workflowRun.findUnique({ where: { id } }) : null;
    },

    async requestForceCancel(
      id: string,
      expectedStatuses: string[],
      requestedAt: Date,
      options?: { setCancelRequested: boolean },
    ) {
      const updated = await prisma.workflowRun.updateMany({
        where: {
          id,
          status: { in: expectedStatuses as any },
        },
        data: {
          ...(options?.setCancelRequested
            ? {
                status: 'cancel_requested',
                cancelRequestedAt: requestedAt,
              }
            : {}),
          cancelForceRequestedAt: requestedAt,
        },
      });

      return updated.count > 0 ? prisma.workflowRun.findUnique({ where: { id } }) : null;
    },
  };
}

export type WorkflowRunRepository = ReturnType<typeof createWorkflowRunRepository>;
