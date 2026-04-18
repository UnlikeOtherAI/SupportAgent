import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ExecutorSource, Prisma, type PrismaClient } from '@prisma/client';
import { parseExecutorYaml } from '@support-agent/executors-runtime';

export interface SeedBuiltinExecutorsResult {
  created: number;
  updated: number;
  skipped: number;
}

type ExecutorSeedClient = Pick<PrismaClient, 'executor'>;

export async function seedBuiltinExecutors(
  prisma: ExecutorSeedClient,
  builtinDir: string,
): Promise<SeedBuiltinExecutorsResult> {
  const entries = await readdir(builtinDir, { withFileTypes: true });
  const executorFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const result: SeedBuiltinExecutorsResult = { created: 0, updated: 0, skipped: 0 };

  for (const fileName of executorFiles) {
    const filePath = path.join(builtinDir, fileName);
    const yaml = await readFile(filePath, 'utf8');
    const parsed = parseExecutorYaml(yaml, { sourceName: fileName });
    const contentHash = hashExecutorContent(yaml, parsed);
    const existing = await prisma.executor.findFirst({
      where: {
        tenantId: null,
        key: parsed.key,
        source: ExecutorSource.BUILTIN,
      },
    });

    if (existing && existing.contentHash === contentHash) {
      result.skipped += 1;
      continue;
    }

    const data = {
      description: parsed.display_name,
      yaml,
      parsed: toPrismaJsonValue(parsed),
      contentHash,
    };

    if (existing) {
      await prisma.executor.update({
        where: { id: existing.id },
        data,
      });
      result.updated += 1;
      continue;
    }

    await prisma.executor.create({
      data: {
        tenantId: null,
        key: parsed.key,
        source: ExecutorSource.BUILTIN,
        ...data,
      },
    });
    result.created += 1;
  }

  return result;
}

function hashExecutorContent(yaml: string, parsed: unknown): string {
  const canonicalPayload = JSON.stringify({
    yaml,
    parsed: canonicalizeValue(parsed),
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

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
