import { Prisma, SkillRole, SkillSource, type PrismaClient } from '@prisma/client';
import {
  CreateSkillCloneSchema,
  type SkillDetail,
  type SkillSummary,
  UpdateSkillSchema,
} from '@support-agent/contracts';
import { hashSkillContent } from '@support-agent/skills-runtime';

export class SkillService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(tenantId: string): Promise<SkillSummary[]> {
    const skills = await this.prisma.skill.findMany({
      where: {
        OR: [
          { tenantId: null, source: SkillSource.BUILTIN },
          { tenantId, source: SkillSource.USER },
        ],
      },
      orderBy: [{ name: 'asc' }, { updatedAt: 'desc' }],
    });

    const parentNames = await this.loadParentSkillNames(skills);
    return skills.map((skill) => this.mapSummary(skill, parentNames));
  }

  async getById(id: string, tenantId: string): Promise<SkillDetail | null> {
    const skill = await this.prisma.skill.findFirst({
      where: {
        id,
        OR: [
          { tenantId: null, source: SkillSource.BUILTIN },
          { tenantId, source: SkillSource.USER },
        ],
      },
    });

    if (!skill) {
      return null;
    }

    const parentNames = await this.loadParentSkillNames([skill]);
    return this.mapDetail(skill, parentNames);
  }

  async getByNameAndHash(
    name: string,
    contentHash: string,
    tenantId: string,
  ): Promise<SkillDetail | null> {
    const skill = await this.prisma.skill.findFirst({
      where: {
        name,
        contentHash,
        OR: [
          { tenantId: null, source: SkillSource.BUILTIN },
          { tenantId, source: SkillSource.USER },
        ],
      },
    });

    if (!skill) {
      return null;
    }

    const parentNames = await this.loadParentSkillNames([skill]);
    return this.mapDetail(skill, parentNames);
  }

  async clone(rawInput: unknown, tenantId: string): Promise<SkillDetail> {
    const input = CreateSkillCloneSchema.parse(rawInput);
    const builtin = await this.prisma.skill.findFirst({
      where: {
        id: input.clonedFromSkillId,
        tenantId: null,
        source: SkillSource.BUILTIN,
      },
    });

    if (!builtin) {
      throw new Error('Builtin skill not found');
    }

    const existing = await this.prisma.skill.findFirst({
      where: {
        tenantId,
        source: SkillSource.USER,
        name: input.name,
      },
    });

    if (existing) {
      throw new Error(`A user skill named "${input.name}" already exists`);
    }

    const created = await this.prisma.skill.create({
      data: {
        tenantId,
        name: input.name,
        role: builtin.role,
        description: builtin.description,
        body: builtin.body,
        outputSchema: toNullableJsonValue(asOutputSchema(builtin.outputSchema)),
        contentHash: builtin.contentHash,
        source: SkillSource.USER,
        parentSkillId: builtin.id,
      },
    });

    return this.mapDetail(created, new Map([[builtin.id, builtin.name]]));
  }

  async update(id: string, rawInput: unknown, tenantId: string): Promise<SkillDetail | null> {
    const input = UpdateSkillSchema.parse(rawInput);
    const existing = await this.prisma.skill.findFirst({
      where: { id, tenantId, source: SkillSource.USER },
    });

    if (!existing) {
      return null;
    }

    const nextName = input.name ?? existing.name;
    if (nextName !== existing.name) {
      const conflict = await this.prisma.skill.findFirst({
        where: {
          tenantId,
          source: SkillSource.USER,
          name: nextName,
          id: { not: id },
        },
      });

      if (conflict) {
        throw new Error(`A user skill named "${nextName}" already exists`);
      }
    }

    const nextDescription = input.description ?? existing.description;
    const nextBody = input.body ?? existing.body;
    const nextOutputSchema = input.outputSchema !== undefined
      ? input.outputSchema
      : asOutputSchema(existing.outputSchema);

    if (existing.role === SkillRole.SYSTEM && nextOutputSchema === null) {
      throw new Error('System skills require an output schema');
    }

    if (existing.role === SkillRole.COMPLEMENTARY && nextOutputSchema !== null) {
      throw new Error('Complementary skills cannot define an output schema');
    }

    const updated = await this.prisma.skill.update({
      where: { id },
      data: {
        name: nextName,
        description: nextDescription,
        body: nextBody,
        outputSchema: toNullableJsonValue(nextOutputSchema),
        contentHash: hashSkillContent({
          role: existing.role === SkillRole.SYSTEM ? 'system' : 'complementary',
          description: nextDescription,
          body: nextBody,
          outputSchema: nextOutputSchema,
        }),
      },
    });

    const parentNames = await this.loadParentSkillNames([updated]);
    return this.mapDetail(updated, parentNames);
  }

  private async loadParentSkillNames(
    skills: Array<{ parentSkillId: string | null }>,
  ): Promise<Map<string, string>> {
    const parentIds = Array.from(
      new Set(
        skills
          .map((skill) => skill.parentSkillId)
          .filter((parentSkillId): parentSkillId is string => parentSkillId !== null),
      ),
    );

    if (parentIds.length === 0) {
      return new Map();
    }

    const parents = await this.prisma.skill.findMany({
      where: { id: { in: parentIds } },
      select: { id: true, name: true },
    });

    return new Map(parents.map((parent) => [parent.id, parent.name]));
  }

  private mapSummary(
    skill: {
      id: string;
      name: string;
      role: SkillRole;
      source: SkillSource;
      description: string;
      body: string;
      parentSkillId: string | null;
      updatedAt: Date;
    },
    parentNames: Map<string, string>,
  ): SkillSummary {
    return {
      id: skill.id,
      name: skill.name,
      role: skill.role,
      source: skill.source,
      description: skill.description,
      bodyPreview: skill.body.split('\n').find((line) => line.trim() !== '')?.slice(0, 160) ?? '',
      clonedFrom: mapClonedFrom(skill.parentSkillId, parentNames),
      updatedAt: skill.updatedAt.toISOString(),
    };
  }

  private mapDetail(
    skill: {
      id: string;
      name: string;
      role: SkillRole;
      source: SkillSource;
      description: string;
      body: string;
      outputSchema: Prisma.JsonValue | null;
      contentHash: string;
      parentSkillId: string | null;
      updatedAt: Date;
    },
    parentNames: Map<string, string>,
  ): SkillDetail {
    return {
      id: skill.id,
      name: skill.name,
      role: skill.role,
      source: skill.source,
      description: skill.description,
      body: skill.body,
      outputSchema: asOutputSchema(skill.outputSchema),
      contentHash: skill.contentHash,
      clonedFrom: mapClonedFrom(skill.parentSkillId, parentNames),
      updatedAt: skill.updatedAt.toISOString(),
    };
  }
}

function asOutputSchema(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Skill output schema must be a JSON object');
  }

  return value as Record<string, unknown>;
}

function mapClonedFrom(parentSkillId: string | null, parentNames: Map<string, string>) {
  if (!parentSkillId) {
    return null;
  }

  return {
    id: parentSkillId,
    label: parentNames.get(parentSkillId) ?? parentSkillId,
  };
}

function toNullableJsonValue(
  value: Record<string, unknown> | null,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null) {
    return Prisma.DbNull;
  }

  return value as Prisma.InputJsonValue;
}
