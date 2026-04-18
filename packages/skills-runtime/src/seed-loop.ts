import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma, SkillRole, SkillSource, type PrismaClient } from '@prisma/client';
import { parseSkillFrontmatter } from './frontmatter-parser.js';
import { loadOutputSchema } from './output-schema-loader.js';
import { hashSkillContent } from './skill-content-hash.js';

export interface SeedBuiltinSkillsResult {
  created: number;
  updated: number;
  skipped: number;
}

export async function seedBuiltinSkills(
  prisma: PrismaClient,
  builtinDir: string,
): Promise<SeedBuiltinSkillsResult> {
  const entries = await readdir(builtinDir, { withFileTypes: true });
  const skillDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const result: SeedBuiltinSkillsResult = { created: 0, updated: 0, skipped: 0 };

  for (const directoryName of skillDirectories) {
    const skillDir = path.join(builtinDir, directoryName);
    const skillFilePath = path.join(skillDir, 'SKILL.md');
    const markdown = await readFile(skillFilePath, 'utf8');
    const parsedSkill = parseSkillFrontmatter(markdown, skillFilePath);
    const outputSchema =
      parsedSkill.frontmatter.role === 'system'
        ? await loadOutputSchema(path.resolve(skillDir, parsedSkill.frontmatter.outputSchemaPath!))
        : null;

    const contentHash = hashSkillContent({
      role: parsedSkill.frontmatter.role,
      description: parsedSkill.frontmatter.description,
      body: parsedSkill.body,
      outputSchema,
    });
    const existing = await prisma.skill.findFirst({
      where: {
        tenantId: null,
        name: parsedSkill.frontmatter.name,
        source: SkillSource.BUILTIN,
      },
    });
    if (existing && existing.contentHash === contentHash) {
      result.skipped += 1;
      continue;
    }

    if (existing) {
      await prisma.skill.update({
        where: { id: existing.id },
        data: {
          role:
            parsedSkill.frontmatter.role === 'system' ? SkillRole.SYSTEM : SkillRole.COMPLEMENTARY,
          description: parsedSkill.frontmatter.description,
          body: parsedSkill.body,
          outputSchema: toPrismaJsonValue(outputSchema),
          contentHash,
        },
      });

      result.updated += 1;
      continue;
    }

    await prisma.skill.create({
      data: {
        tenantId: null,
        name: parsedSkill.frontmatter.name,
        source: SkillSource.BUILTIN,
        role:
          parsedSkill.frontmatter.role === 'system' ? SkillRole.SYSTEM : SkillRole.COMPLEMENTARY,
        description: parsedSkill.frontmatter.description,
        body: parsedSkill.body,
        outputSchema: toPrismaJsonValue(outputSchema),
        contentHash,
      },
    });
    result.created += 1;
  }

  return result;
}

function toPrismaJsonValue(
  value: Record<string, unknown> | null,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null) {
    return Prisma.DbNull;
  }

  return value as Prisma.InputJsonValue;
}
