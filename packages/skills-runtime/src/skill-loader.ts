import { SkillRole, type Prisma, type Skill as PrismaSkill } from '@prisma/client';

export interface LoadedSkill {
  name: string;
  description: string;
  role: 'system' | 'complementary';
  body: string;
  outputSchema?: Record<string, unknown>;
}

type SkillRecord = Pick<PrismaSkill, 'name' | 'description' | 'role' | 'body' | 'outputSchema'>;

export function loadSkillFromRow(skill: SkillRecord): LoadedSkill {
  if (skill.role === SkillRole.SYSTEM) {
    const outputSchema = asJsonObject(skill.outputSchema, `${skill.name} outputSchema`);
    return {
      name: skill.name,
      description: skill.description,
      role: 'system',
      body: skill.body,
      outputSchema,
    };
  }

  if (skill.outputSchema !== null) {
    throw new Error(`Complementary skill "${skill.name}" cannot define an output schema`);
  }

  return {
    name: skill.name,
    description: skill.description,
    role: 'complementary',
    body: skill.body,
  };
}

function asJsonObject(value: Prisma.JsonValue | null, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }

  return value as Record<string, unknown>;
}
