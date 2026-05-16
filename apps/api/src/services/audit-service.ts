import { type PrismaClient, type Prisma } from '@prisma/client';

/**
 * Minimal audit-event writer. Records the who/what/when of operator and
 * authentication events into the `audit_events` table. Errors are swallowed
 * with a console warning — audit must never break the surrounding request.
 *
 * See `docs/reviews/security-auth-and-sso.md` H3 and
 * `docs/reviews/security-secrets-and-data.md` H-4.
 */
export interface RecordAuditEventInput {
  tenantId: string;
  actorId?: string | null;
  actorType?: string | null;
  action: Prisma.AuditEventCreateInput['action'];
  resourceType: string;
  resourceId: string;
  metadata?: Prisma.JsonValue | null;
}

export async function recordAuditEvent(
  prisma: PrismaClient,
  input: RecordAuditEventInput,
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        actorId: input.actorId ?? null,
        actorType: input.actorType ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    // Audit must not break the calling request. Surface at warn so an
    // operator can spot a misconfiguration without crashing the SSO flow.
    // eslint-disable-next-line no-console
    console.warn('[audit] failed to record event', err);
  }
}
