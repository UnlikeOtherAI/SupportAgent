import { type PrismaClient } from '@prisma/client';

/**
 * Gateway-side audit-log writer. All inbound WS upgrades and outbound
 * dispatch claims pass through this helper so operators have a single
 * place to look when investigating runtime-key abuse.
 *
 * Schema: `AuditEvent` in `prisma/schema.prisma`. `action` is constrained
 * to the existing enum; we use:
 *   - `triggered` for accepted upgrades and rejected upgrades (metadata
 *     carries the outcome and the reason)
 *   - `dispatched` for outbound dispatch claims to a registered worker
 */
export type GatewayAuditAction = 'triggered' | 'dispatched';

export interface GatewayAuditPayload {
  tenantId: string;
  runtimeApiKeyId: string | null;
  action: GatewayAuditAction;
  resourceType: string;
  resourceId: string;
  outcome: 'accepted' | 'rejected' | 'dispatched';
  reason?: string;
  remoteAddr?: string;
  metadata?: Record<string, unknown>;
}

export async function recordGatewayAudit(
  prisma: PrismaClient,
  payload: GatewayAuditPayload,
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        tenantId: payload.tenantId,
        actorId: payload.runtimeApiKeyId,
        actorType: payload.runtimeApiKeyId ? 'runtime_api_key' : 'anonymous',
        action: payload.action,
        resourceType: payload.resourceType,
        resourceId: payload.resourceId,
        metadata: {
          outcome: payload.outcome,
          reason: payload.reason ?? null,
          remoteAddr: payload.remoteAddr ?? null,
          ...(payload.metadata ?? {}),
        },
      },
    });
  } catch (err) {
    // Audit must not break the operational path. Surface to console and
    // continue — operators will see the gap in audit_events but the
    // gateway will keep serving.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[gateway][audit] failed to write AuditEvent:', message);
  }
}
