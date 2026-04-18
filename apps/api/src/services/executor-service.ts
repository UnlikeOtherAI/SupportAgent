import { ExecutorSource, Prisma, type PrismaClient } from '@prisma/client';
import {
  CreateExecutorCloneSchema,
  type ExecutorDetail,
  type ExecutorSummary,
  UpdateExecutorSchema,
} from '@support-agent/contracts';
import {
  hashExecutorContent,
  parseExecutorYaml,
} from '@support-agent/executors-runtime';

export class ExecutorService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(tenantId: string): Promise<ExecutorSummary[]> {
    const executors = await this.prisma.executor.findMany({
      where: {
        OR: [
          { tenantId: null, source: ExecutorSource.BUILTIN },
          { tenantId, source: ExecutorSource.USER },
        ],
      },
      orderBy: [{ key: 'asc' }, { updatedAt: 'desc' }],
    });

    const parentLabels = await this.loadParentExecutorLabels(executors);
    return executors.map((executor) => ({
      id: executor.id,
      key: executor.key,
      description: executor.description,
      source: executor.source,
      clonedFrom: mapClonedFrom(executor.parentExecutorId, parentLabels),
      updatedAt: executor.updatedAt.toISOString(),
    }));
  }

  async getById(id: string, tenantId: string): Promise<ExecutorDetail | null> {
    const executor = await this.prisma.executor.findFirst({
      where: {
        id,
        OR: [
          { tenantId: null, source: ExecutorSource.BUILTIN },
          { tenantId, source: ExecutorSource.USER },
        ],
      },
    });

    if (!executor) {
      return null;
    }

    const parentLabels = await this.loadParentExecutorLabels([executor]);
    return {
      id: executor.id,
      key: executor.key,
      description: executor.description,
      yaml: executor.yaml,
      parsed: executor.parsed as Record<string, unknown>,
      contentHash: executor.contentHash,
      source: executor.source,
      clonedFrom: mapClonedFrom(executor.parentExecutorId, parentLabels),
      updatedAt: executor.updatedAt.toISOString(),
    };
  }

  async clone(rawInput: unknown, tenantId: string): Promise<ExecutorDetail> {
    const input = CreateExecutorCloneSchema.parse(rawInput);
    const builtin = await this.prisma.executor.findFirst({
      where: {
        id: input.clonedFromExecutorId,
        tenantId: null,
        source: ExecutorSource.BUILTIN,
      },
    });

    if (!builtin) {
      throw new Error('Builtin executor not found');
    }

    const existing = await this.prisma.executor.findFirst({
      where: {
        tenantId,
        source: ExecutorSource.USER,
        key: input.key,
      },
    });

    if (existing) {
      throw new Error(`A user executor with key "${input.key}" already exists`);
    }

    const created = await this.prisma.executor.create({
      data: {
        tenantId,
        key: input.key,
        description: builtin.description,
        yaml: builtin.yaml,
        parsed: toPrismaJsonValue(builtin.parsed),
        contentHash: builtin.contentHash,
        source: ExecutorSource.USER,
        parentExecutorId: builtin.id,
      },
    });

    return {
      id: created.id,
      key: created.key,
      description: created.description,
      yaml: created.yaml,
      parsed: created.parsed as Record<string, unknown>,
      contentHash: created.contentHash,
      source: created.source,
      clonedFrom: { id: builtin.id, label: builtin.key },
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  async update(id: string, rawInput: unknown, tenantId: string): Promise<ExecutorDetail | null> {
    const input = UpdateExecutorSchema.parse(rawInput);
    const existing = await this.prisma.executor.findFirst({
      where: { id, tenantId, source: ExecutorSource.USER },
    });

    if (!existing) {
      return null;
    }

    const nextKey = input.key ?? existing.key;
    if (nextKey !== existing.key) {
      const conflict = await this.prisma.executor.findFirst({
        where: {
          tenantId,
          source: ExecutorSource.USER,
          key: nextKey,
          id: { not: id },
        },
      });

      if (conflict) {
        throw new Error(`A user executor with key "${nextKey}" already exists`);
      }
    }

    const nextYaml = input.yaml ?? existing.yaml;
    const parsed = parseExecutorYaml(nextYaml, { sourceName: nextKey });
    const updated = await this.prisma.executor.update({
      where: { id },
      data: {
        key: nextKey,
        description: input.description ?? parsed.display_name,
        yaml: nextYaml,
        parsed: toPrismaJsonValue(parsed),
        contentHash: hashExecutorContent(nextYaml),
      },
    });

    const parentLabels = await this.loadParentExecutorLabels([updated]);
    return {
      id: updated.id,
      key: updated.key,
      description: updated.description,
      yaml: updated.yaml,
      parsed: updated.parsed as Record<string, unknown>,
      contentHash: updated.contentHash,
      source: updated.source,
      clonedFrom: mapClonedFrom(updated.parentExecutorId, parentLabels),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  private async loadParentExecutorLabels(
    executors: Array<{ parentExecutorId: string | null }>,
  ): Promise<Map<string, string>> {
    const parentIds = Array.from(
      new Set(
        executors
          .map((executor) => executor.parentExecutorId)
          .filter((parentExecutorId): parentExecutorId is string => parentExecutorId !== null),
      ),
    );

    if (parentIds.length === 0) {
      return new Map();
    }

    const parents = await this.prisma.executor.findMany({
      where: { id: { in: parentIds } },
      select: { id: true, key: true },
    });

    return new Map(parents.map((parent) => [parent.id, parent.key]));
  }
}

function mapClonedFrom(parentExecutorId: string | null, parentLabels: Map<string, string>) {
  if (!parentExecutorId) {
    return null;
  }

  return {
    id: parentExecutorId,
    label: parentLabels.get(parentExecutorId) ?? parentExecutorId,
  };
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
