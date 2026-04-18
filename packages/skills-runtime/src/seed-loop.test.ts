import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Prisma, SkillRole, SkillSource } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedBuiltinSkills } from './seed-loop.js';

describe('seedBuiltinSkills', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map(async (directory) => {
        await rm(directory, { recursive: true, force: true });
      }),
    );
  });

  it('creates skills on the first run and skips them on the second run', async () => {
    const builtinDir = await mkdtemp(path.join(os.tmpdir(), 'skills-runtime-'));
    tempDirectories.push(builtinDir);

    await writeSkill(builtinDir, 'triage-issue', `---
name: triage-issue
description: Investigate a newly opened issue.
role: system
output_schema: ./output.schema.json
---
# Triage
Return JSON only.
`, {
      type: 'object',
      properties: {
        delivery: { type: 'array' },
      },
    });

    await writeSkill(builtinDir, 'repo-rules', `---
name: repo-rules
description: Reuse repository-specific knowledge.
role: complementary
---
Follow the repo rules.
`);

    const storedHashes = new Map<string, string>();
    const findFirst = vi.fn(
      async ({ where }: { where: { name: string } }) => {
        const contentHash = storedHashes.get(where.name);
        if (!contentHash) {
          return null;
        }

        return {
          id: `${where.name}-id`,
          tenantId: null,
          name: where.name,
          role: SkillRole.SYSTEM,
          description: '',
          body: '',
          outputSchema: null,
          contentHash,
          source: SkillSource.BUILTIN,
          parentSkillId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    );
    const create = vi.fn(
      async ({
        data,
      }: {
        data: { name: string; contentHash: string; outputSchema: Record<string, unknown> | typeof Prisma.DbNull };
      }) => {
        storedHashes.set(data.name, data.contentHash);
        return {
          id: `${data.name}-id`,
          tenantId: null,
          name: data.name,
          role: SkillRole.SYSTEM,
          description: '',
          body: '',
          outputSchema: data.outputSchema === Prisma.DbNull ? null : data.outputSchema,
          contentHash: data.contentHash,
          source: SkillSource.BUILTIN,
          parentSkillId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    );
    const update = vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { contentHash: string; outputSchema: Record<string, unknown> | typeof Prisma.DbNull };
      }) => {
        storedHashes.set(where.id.replace(/-id$/, ''), data.contentHash);
        return {
          id: where.id,
          tenantId: null,
          name: where.id.replace(/-id$/, ''),
          role: SkillRole.SYSTEM,
          description: '',
          body: '',
          outputSchema: data.outputSchema === Prisma.DbNull ? null : data.outputSchema,
          contentHash: data.contentHash,
          source: SkillSource.BUILTIN,
          parentSkillId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    );

    const prisma = {
      skill: {
        findFirst,
        create,
        update,
      },
    } as unknown as Parameters<typeof seedBuiltinSkills>[0];

    await expect(seedBuiltinSkills(prisma, builtinDir)).resolves.toEqual({
      created: 2,
      updated: 0,
      skipped: 0,
    });
    expect(create).toHaveBeenCalledTimes(2);

    await expect(seedBuiltinSkills(prisma, builtinDir)).resolves.toEqual({
      created: 0,
      updated: 0,
      skipped: 2,
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });
});

async function writeSkill(
  builtinDir: string,
  directoryName: string,
  skillMarkdown: string,
  outputSchema?: Record<string, unknown>,
): Promise<void> {
  const skillDir = path.join(builtinDir, directoryName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, 'SKILL.md'), skillMarkdown, 'utf8');

  if (outputSchema) {
    await writeFile(
      path.join(skillDir, 'output.schema.json'),
      JSON.stringify(outputSchema, null, 2),
      'utf8',
    );
  }
}
