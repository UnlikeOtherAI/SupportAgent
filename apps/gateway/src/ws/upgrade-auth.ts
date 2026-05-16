import { type FastifyRequest } from 'fastify';
import { type PrismaClient } from '@prisma/client';
import {
  verifyRuntimeApiKey,
  type RuntimeKeyContext,
} from './runtime-key-auth.js';
import { recordGatewayAudit } from './audit.js';
import { originIsAllowed, type OriginPolicy } from './origin-allowlist.js';

/**
 * Extracts the runtime API key from a WS upgrade request.
 *
 * Two transports are supported:
 *
 *   1. `Sec-WebSocket-Protocol`: client lists the subprotocol
 *      `support-agent.v1` and an opaque token-bearing subprotocol of the
 *      form `key.<runtimeApiKey>`. This is the only way a browser can
 *      send credentials on the upgrade.
 *   2. `Authorization: Bearer <runtimeApiKey>`: long-lived servers can
 *      use this directly.
 */
export function extractRuntimeApiKey(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const candidate = auth.slice(7).trim();
    if (candidate.length > 0) return candidate;
  }

  const proto = request.headers['sec-websocket-protocol'];
  if (typeof proto === 'string') {
    for (const part of proto.split(',')) {
      const v = part.trim();
      if (v.startsWith('key.')) {
        const key = v.slice(4);
        if (key.length > 0) return key;
      }
    }
  }
  return null;
}

export interface UpgradeAuthDeps {
  prisma: PrismaClient;
  originPolicy: OriginPolicy;
}

export type UpgradeAuthResult =
  | { ok: true; auth: RuntimeKeyContext; remoteAddr: string }
  | { ok: false; statusCode: number; reason: string };

/**
 * Validate a WS upgrade request: Origin allowlist + runtime API key.
 * Every outcome is audited. Caller (the route handler) decides how to
 * surface the rejection to the client.
 */
export async function authorizeUpgrade(
  request: FastifyRequest,
  deps: UpgradeAuthDeps,
): Promise<UpgradeAuthResult> {
  const remoteAddr = request.ip;
  const origin = request.headers.origin;
  if (!originIsAllowed(deps.originPolicy, typeof origin === 'string' ? origin : undefined)) {
    await recordGatewayAudit(deps.prisma, {
      tenantId: 'unknown',
      runtimeApiKeyId: null,
      action: 'triggered',
      resourceType: 'gateway_ws_upgrade',
      resourceId: 'origin',
      outcome: 'rejected',
      reason: 'origin_not_allowed',
      remoteAddr,
      metadata: { origin: typeof origin === 'string' ? origin : null },
    });
    return { ok: false, statusCode: 403, reason: 'origin not allowed' };
  }

  const rawKey = extractRuntimeApiKey(request);
  const ctx = await verifyRuntimeApiKey(deps.prisma, rawKey);
  if (!ctx) {
    await recordGatewayAudit(deps.prisma, {
      tenantId: 'unknown',
      runtimeApiKeyId: null,
      action: 'triggered',
      resourceType: 'gateway_ws_upgrade',
      resourceId: 'auth',
      outcome: 'rejected',
      reason: rawKey ? 'invalid_runtime_api_key' : 'missing_runtime_api_key',
      remoteAddr,
    });
    return { ok: false, statusCode: 401, reason: 'invalid runtime api key' };
  }

  return { ok: true, auth: ctx, remoteAddr };
}
