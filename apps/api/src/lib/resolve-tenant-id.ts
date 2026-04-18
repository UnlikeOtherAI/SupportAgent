import type { FastifyRequest } from 'fastify';

export function resolveTenantId(request: FastifyRequest): string {
  const headerTenantId = request.headers['x-tenant-id'];
  if (typeof headerTenantId === 'string' && headerTenantId.trim() !== '') {
    return headerTenantId.trim();
  }

  return request.user.tenantId;
}
