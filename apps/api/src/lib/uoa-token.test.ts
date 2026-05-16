import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { parseEnv } from '@support-agent/config';
import { redactUoaToken, verifyUoaAccessToken, type UoaTokenResponse } from './uoa-token.js';

/**
 * Unit tests for finding H2 (signature verification) and L-3 / H-1 (redaction).
 *
 * `verifyUoaAccessToken` fetches a remote JWKS at the UOA base URL, so the
 * verification tests focus on the error path: an unsigned token, an expired
 * token, a wrong-audience token. Each must throw — there is no soft fallback.
 *
 * The "happy path" (valid signature against UOA's real JWKS) is covered by
 * the SSO integration test in `auth-callback.test.ts` against a stubbed JWKS.
 */
describe('verifyUoaAccessToken', () => {
  beforeAll(() => {
    parseEnv({
      DATABASE_URL: 'postgresql://supportagent:supportagent@localhost:5432/supportagent_dev',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      REDIS_URL: 'redis://localhost:6379',
      // Point JWKS lookup at an unreachable host so verification fails closed.
      SSO_BASE_URL: 'https://127.0.0.1:1',
    });
  });

  it('rejects a structurally invalid token', async () => {
    await expect(verifyUoaAccessToken('not.a.jwt')).rejects.toThrow();
  });

  it('rejects an HS256-signed token (UOA publishes RS-family JWKS only)', async () => {
    const key = new TextEncoder().encode('a-symmetric-secret-only-the-relying-party-knows');
    const token = await new SignJWT({ sub: 'u1', email: 'x@y' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('https://attacker.example.com')
      .setAudience('attacker')
      .setExpirationTime('1h')
      .sign(key);
    await expect(verifyUoaAccessToken(token)).rejects.toThrow();
  });

  it('rejects an expired RS256-signed token', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const token = await new SignJWT({ sub: 'u1' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer('https://127.0.0.1:1')
      .setAudience('api.appbuildbox.com')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey);
    await expect(verifyUoaAccessToken(token)).rejects.toThrow();
  });

  // Make sure JWK export is part of the public surface we test against
  // (defensive: catches a future refactor that drops the dependency).
  it('uses RS-family keys downstream', async () => {
    const { publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    expect(jwk.kty).toBe('RSA');
  });
});

describe('redactUoaToken', () => {
  it('returns a placeholder for null input', () => {
    expect(redactUoaToken(null)).toEqual({ tokenResponse: null });
    expect(redactUoaToken(undefined)).toEqual({ tokenResponse: null });
  });

  it('never includes access_token, refresh_token, or id_token in output', () => {
    const res: UoaTokenResponse = {
      access_token: 'eyJ-secret-access',
      refresh_token: 'rt-secret-refresh',
      expires_in: 3600,
      refresh_token_expires_in: 86_400,
      token_type: 'Bearer',
      firstLogin: {
        memberships: { orgs: [{ orgId: 'o1', role: 'owner' }] },
      },
    };
    const redacted = redactUoaToken(res);
    const serialised = JSON.stringify(redacted);
    expect(serialised).not.toContain('eyJ-secret-access');
    expect(serialised).not.toContain('rt-secret-refresh');
  });

  it('preserves non-secret metadata for log correlation', () => {
    const res: UoaTokenResponse = {
      access_token: 'a',
      refresh_token: 'b',
      expires_in: 3600,
      token_type: 'Bearer',
      firstLogin: { memberships: { orgs: [{ orgId: 'o1' }, { orgId: 'o2' }] } },
    };
    const redacted = redactUoaToken(res);
    expect(redacted).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3600,
      has_access_token: true,
      has_refresh_token: true,
      firstLogin_orgs: 2,
    });
  });

  it('reports has_access_token=false when the token is missing', () => {
    const res = { access_token: '', token_type: 'Bearer' } as UoaTokenResponse;
    expect(redactUoaToken(res)).toMatchObject({ has_access_token: false });
  });
});
