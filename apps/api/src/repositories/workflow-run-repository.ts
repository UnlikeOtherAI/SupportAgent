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

    async updateStage(id: string, stage: string) {
      return prisma.workflowRun.update({ where: { id }, data: { currentStage: stage } });
    },
  };
}

export type WorkflowRunRepository = ReturnType<typeof createWorkflowRunRepository>;
