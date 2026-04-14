import { describe, expect, it, vi } from 'vitest';
import { PLATFORM_TYPE_CATALOG } from './platform-type-catalog.js';
import { syncPlatformTypes } from './sync-platform-types.js';

describe('syncPlatformTypes', () => {
  it('upserts every platform type from the shared catalog', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      platformType: {
        upsert,
      },
    };

    await syncPlatformTypes(prisma as never);

    expect(upsert).toHaveBeenCalledTimes(PLATFORM_TYPE_CATALOG.length);
    expect(upsert).toHaveBeenCalledWith({
      where: { key: 'github' },
      update: expect.objectContaining({
        key: 'github',
        displayName: 'GitHub',
        category: 'version-control',
      }),
      create: expect.objectContaining({
        key: 'github',
        displayName: 'GitHub',
        category: 'version-control',
      }),
    });
  });
});
