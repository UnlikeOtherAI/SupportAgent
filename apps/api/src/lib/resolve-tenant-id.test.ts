import { describe, it, expect } from 'vitest';
import { resolveTenantId } from './resolve-tenant-id.js';

/**
 * Unit test for finding C3: `x-tenant-id` header MUST NOT override the JWT
 * tenant claim. The verified-JWT tenantId is the only source of truth.
 */
describe('resolveTenantId', () => {
  function makeRequest(jwtTenant: string, header?: string) {
    return {
      headers: header === undefined ? {} : { 'x-tenant-id': header },
      user: { sub: 'u1', tenantId: jwtTenant, role: 'admin' },
    } as unknown as Parameters<typeof resolveTenantId>[0];
  }

  it('returns the JWT-claimed tenantId when no header is present', () => {
    expect(resolveTenantId(makeRequest('tenant-jwt'))).toBe('tenant-jwt');
  });

  it('ignores the x-tenant-id header even when it differs from the JWT', () => {
    const req = makeRequest('tenant-jwt', 'attacker-tenant');
    expect(resolveTenantId(req)).toBe('tenant-jwt');
  });

  it('ignores the x-tenant-id header when it matches the JWT (no override path)', () => {
    const req = makeRequest('tenant-jwt', 'tenant-jwt');
    expect(resolveTenantId(req)).toBe('tenant-jwt');
  });

  it('ignores an empty x-tenant-id header', () => {
    const req = makeRequest('tenant-jwt', '');
    expect(resolveTenantId(req)).toBe('tenant-jwt');
  });
});
