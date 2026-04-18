import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma, SkillRole, SkillSource, type PrismaClient } from '@prisma/client';
import { parseSkillFrontmatter } from './frontmatter-parser.js';
import { loadOutputSchema } from './output-schema-loader.js';

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

    const contentHash = hashSkillContent(parsedSkill.body, outputSchema);
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

function hashSkillContent(
  body: string,
  outputSchemaJson: Record<string, unknown> | null,
): string {
  const canonicalPayload = JSON.stringify({
    body,
    outputSchemaJson: canonicalizeValue(outputSchemaJson),
  });

  return createHash('sha256').update(canonicalPayload).digest('hex');
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeValue(entry));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = canonicalizeValue((value as Record<string, unknown>)[key]);
        return accumulator;
      }, {});
  }

  return value;
}

function toPrismaJsonValue(
  value: Record<string, unknown> | null,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null) {
    return Prisma.DbNull;
  }

  return value as Prisma.InputJsonValue;
}
