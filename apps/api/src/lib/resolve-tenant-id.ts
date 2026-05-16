import type { FastifyRequest } from 'fastify';

/**
 * Resolve the tenant for an authenticated request.
 *
 * The tenant ID is always taken from the verified JWT claim. The legacy
 * `x-tenant-id` request header is ignored — a service-to-service caller that
 * needs to act on behalf of a tenant MUST present a JWT whose `tenantId`
 * claim already encodes the target tenant. There is no plaintext-header
 * override path on user JWTs.
 *
 * See `docs/reviews/security-auth-and-sso.md` finding C3.
 */
export function resolveTenantId(request: FastifyRequest): string {
  return request.user.tenantId;
}
