import { type PrismaClient } from '@prisma/client';
import { PLATFORM_TYPE_CATALOG } from './platform-type-catalog.js';

export async function syncPlatformTypes(prisma: PrismaClient): Promise<void> {
  for (const platformType of PLATFORM_TYPE_CATALOG) {
    await prisma.platformType.upsert({
      where: { key: platformType.key },
      update: platformType,
      create: platformType,
    });
  }
}
