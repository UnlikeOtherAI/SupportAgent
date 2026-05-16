import { describe, expect, it, vi } from 'vitest';
import { authorizeUpgrade, extractRuntimeApiKey } from './upgrade-auth.js';
import { hashRuntimeApiKey } from './runtime-key-auth.js';
import { parseOriginPolicy } from './origin-allowlist.js';

type FakePrisma = Parameters<typeof authorizeUpgrade>[1]['prisma'];

function fakePrisma(keys: Array<{
  id: string;
  tenantId: string;
  keyHash: string;
  keyPrefix: string;
  runtimeMode?: 'worker' | 'gateway' | null;
  allowedProfiles?: unknown;
  isDisabled?: boolean;
  revokedAt?: Date | null;
}>): FakePrisma {
  return {
    runtimeApiKey: {
      findMany: vi.fn(async ({ where }: { where: { keyPrefix: string; isDisabled: boolean; revokedAt: null } }) => {
        return keys.filter(
          (k) =>
            k.keyPrefix === where.keyPrefix &&
            (k.isDisabled ?? false) === false &&
            (k.revokedAt ?? null) === null,
        );
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
  } as unknown as FakePrisma;
}

function fakeRequest(headers: Record<string, string>, ip = '10.0.0.1') {
  return { headers, ip } as unknown as Parameters<typeof authorizeUpgrade>[0];
}

describe('extractRuntimeApiKey', () => {
  it('reads from Authorization Bearer', () => {
    expect(
      extractRuntimeApiKey(fakeRequest({ authorization: 'Bearer rtk_abcd_secrettoken123456' })),
    ).toBe('rtk_abcd_secrettoken123456');
  });

  it('reads from Sec-WebSocket-Protocol key.<token>', () => {
    expect(
      extractRuntimeApiKey(
        fakeRequest({
          'sec-websocket-protocol': 'support-agent.v1, key.rtk_abcd_secrettoken123456',
        }),
      ),
    ).toBe('rtk_abcd_secrettoken123456');
  });

  it('returns null when no credentials are present', () => {
    expect(extractRuntimeApiKey(fakeRequest({}))).toBeNull();
  });
});

describe('authorizeUpgrade', () => {
  const ALLOWED_ORIGIN = 'https://admin.example.com';

  it('rejects when Origin is not in the allowlist (production posture)', async () => {
    const prisma = fakePrisma([]);
    const policy = parseOriginPolicy(ALLOWED_ORIGIN, true);
    const result = await authorizeUpgrade(
      fakeRequest({ origin: 'https://evil.example.com' }),
      { prisma, originPolicy: policy },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(403);
      expect(result.reason).toBe('origin not allowed');
    }
    // Audit row must have been written.
    expect(
      (prisma as unknown as { auditEvent: { create: ReturnType<typeof vi.fn> } }).auditEvent.create,
    ).toHaveBeenCalled();
  });

  it('rejects when no runtime API key is presented', async () => {
    const prisma = fakePrisma([]);
    const result = await authorizeUpgrade(
      fakeRequest({ origin: ALLOWED_ORIGIN }),
      { prisma, originPolicy: parseOriginPolicy(ALLOWED_ORIGIN, true) },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.statusCode).toBe(401);
  });

  it('rejects when the runtime API key is malformed', async () => {
    const prisma = fakePrisma([]);
    const result = await authorizeUpgrade(
      fakeRequest({ origin: ALLOWED_ORIGIN, authorization: 'Bearer junk' }),
      { prisma, originPolicy: parseOriginPolicy(ALLOWED_ORIGIN, true) },
    );
    expect(result.ok).toBe(false);
  });

  it('rejects when the runtime API key does not match any stored hash', async () => {
    const realKey = 'rtk_abcd_realsecrettoken12345';
    const prisma = fakePrisma([
      {
        id: 'rk-1',
        tenantId: 'tenant-A',
        keyHash: hashRuntimeApiKey(realKey),
        keyPrefix: 'abcd',
      },
    ]);
    const otherKey = 'rtk_abcd_someothertoken12345';
    const result = await authorizeUpgrade(
      fakeRequest({ origin: ALLOWED_ORIGIN, authorization: `Bearer ${otherKey}` }),
      { prisma, originPolicy: parseOriginPolicy(ALLOWED_ORIGIN, true) },
    );
    expect(result.ok).toBe(false);
  });

  it('accepts a valid key with allowed Origin and returns the tenant context', async () => {
    const realKey = 'rtk_abcd_realsecrettoken12345';
    const prisma = fakePrisma([
      {
        id: 'rk-1',
        tenantId: 'tenant-A',
        keyHash: hashRuntimeApiKey(realKey),
        keyPrefix: 'abcd',
        runtimeMode: 'worker',
        allowedProfiles: ['analysis-only'],
      },
    ]);
    const result = await authorizeUpgrade(
      fakeRequest({ origin: ALLOWED_ORIGIN, authorization: `Bearer ${realKey}` }),
      { prisma, originPolicy: parseOriginPolicy(ALLOWED_ORIGIN, true) },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auth.tenantId).toBe('tenant-A');
      expect(result.auth.runtimeApiKeyId).toBe('rk-1');
      expect(result.auth.allowedProfiles).toEqual(['analysis-only']);
    }
  });

  it('rejects when the key is disabled', async () => {
    const realKey = 'rtk_abcd_realsecrettoken12345';
    const prisma = fakePrisma([
      {
        id: 'rk-1',
        tenantId: 'tenant-A',
        keyHash: hashRuntimeApiKey(realKey),
        keyPrefix: 'abcd',
        isDisabled: true,
      },
    ]);
    const result = await authorizeUpgrade(
      fakeRequest({ origin: ALLOWED_ORIGIN, authorization: `Bearer ${realKey}` }),
      { prisma, originPolicy: parseOriginPolicy(ALLOWED_ORIGIN, true) },
    );
    expect(result.ok).toBe(false);
  });

  it('is permissive on Origin outside production with an empty allowlist', async () => {
    const realKey = 'rtk_abcd_realsecrettoken12345';
    const prisma = fakePrisma([
      {
        id: 'rk-1',
        tenantId: 'tenant-A',
        keyHash: hashRuntimeApiKey(realKey),
        keyPrefix: 'abcd',
      },
    ]);
    const result = await authorizeUpgrade(
      fakeRequest({ authorization: `Bearer ${realKey}` }),
      { prisma, originPolicy: parseOriginPolicy('', false) },
    );
    expect(result.ok).toBe(true);
  });
});
