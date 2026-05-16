import { createHash, timingSafeEqual } from 'crypto';
import { type PrismaClient } from '@prisma/client';

/**
 * Authentication context produced by verifying a presented `runtimeApiKey`.
 *
 * Key-issuance is owned by sibling PRs; this module owns only the
 * verification primitive that the gateway needs today: take the raw key,
 * SHA-256 hash it, look up the row, return the bound tenant + profile
 * scope.
 *
 * Layout of the raw key string (matches the seed/issuance helper):
 *
 *     rtk_<prefix>_<base64url-secret>
 *
 * Only `keyHash` (sha256 of the full raw string) is persisted. `keyPrefix`
 * is stored alongside for log/UI display and to narrow the index lookup.
 */
export interface RuntimeKeyContext {
  runtimeApiKeyId: string;
  tenantId: string;
  runtimeMode: 'worker' | 'gateway' | null;
  allowedProfiles: string[] | null;
  keyPrefix: string;
}

const KEY_FORMAT = /^rtk_([A-Za-z0-9]{4,16})_([A-Za-z0-9_-]{16,})$/;

export function parseRuntimeApiKey(raw: string): { prefix: string } | null {
  const match = KEY_FORMAT.exec(raw);
  if (!match) return null;
  return { prefix: match[1] };
}

export function hashRuntimeApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Verify a raw runtime API key. Returns the bound auth context on success.
 *
 * Constant-time comparison is used against the stored hash to defeat
 * remote timing attacks on the prefix lookup.
 *
 * Disabled/revoked keys are rejected. `lastUsedAt` is updated as a
 * side effect so operators can spot stale credentials.
 */
export async function verifyRuntimeApiKey(
  prisma: PrismaClient,
  rawKey: string | undefined | null,
): Promise<RuntimeKeyContext | null> {
  if (!rawKey) return null;
  const parsed = parseRuntimeApiKey(rawKey);
  if (!parsed) return null;

  const hash = hashRuntimeApiKey(rawKey);
  const candidates = await prisma.runtimeApiKey.findMany({
    where: { keyPrefix: parsed.prefix, isDisabled: false, revokedAt: null },
    select: {
      id: true,
      tenantId: true,
      runtimeMode: true,
      allowedProfiles: true,
      keyHash: true,
      keyPrefix: true,
    },
  });

  const wantBuf = Buffer.from(hash, 'hex');
  const match = candidates.find((c) => {
    const gotBuf = Buffer.from(c.keyHash, 'hex');
    return gotBuf.length === wantBuf.length && timingSafeEqual(gotBuf, wantBuf);
  });
  if (!match) return null;

  // Best-effort: stamp last-used so admins can spot stale credentials.
  try {
    await prisma.runtimeApiKey.update({
      where: { id: match.id },
      data: { lastUsedAt: new Date() },
    });
  } catch {
    // swallow: a missing row between findMany and update is benign here
  }

  return {
    runtimeApiKeyId: match.id,
    tenantId: match.tenantId,
    runtimeMode: match.runtimeMode,
    allowedProfiles: parseAllowedProfiles(match.allowedProfiles),
    keyPrefix: match.keyPrefix,
  };
}

function parseAllowedProfiles(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && v.length > 0) out.push(v);
  }
  return out.length > 0 ? out : null;
}

/**
 * A registered client can only claim worker IDs scoped to its key's
 * tenant + execution profile. This helper is the policy decision the
 * connection manager invokes before binding a `workerId`.
 */
export function workerIdMatchesScope(
  ctx: RuntimeKeyContext,
  workerId: string,
  capabilities: string[],
): boolean {
  // Worker IDs must include the tenant prefix so a stolen key for tenant A
  // cannot register `workerId=tenant-B-worker-1` and intercept dispatches
  // that the dispatcher routes by worker identity.
  if (!workerId.startsWith(`${ctx.tenantId}:`)) return false;

  if (ctx.allowedProfiles && ctx.allowedProfiles.length > 0) {
    const allowed = new Set(ctx.allowedProfiles);
    for (const cap of capabilities) {
      if (!allowed.has(cap)) return false;
    }
  }
  return true;
}
