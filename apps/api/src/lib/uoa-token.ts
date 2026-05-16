import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import { getEnv } from '@support-agent/config';

/**
 * UOA access-token verification and redaction helpers.
 *
 * Verifies the access_token end-to-end against UOA's JWKS using `jwtVerify`,
 * enforcing `iss`, `aud` (the relying-party client_id / SSO_DOMAIN), `exp`,
 * and `nbf`. There is NO `decodeJwt` fallback — finding H2 in the auth
 * security review explicitly rejects "trust the token because UOA delivered
 * it over a backend channel."
 *
 * If UOA has not yet published its JWKS, the runtime fails closed at
 * verification rather than silently accepting an unverified token.
 */

export interface UoaAccessTokenClaims extends JWTPayload {
  sub?: string;
  email?: string;
  role?: string;
  domain?: string;
  client_id?: string;
}

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getUoaJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (cachedJwks) return cachedJwks;
  const env = getEnv();
  const url = new URL('/.well-known/jwks.json', env.SSO_BASE_URL);
  cachedJwks = createRemoteJWKSet(url, { cooldownDuration: 30_000 });
  return cachedJwks;
}

export class UoaTokenVerificationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'UoaTokenVerificationError';
  }
}

/**
 * Verify a UOA access_token. Throws `UoaTokenVerificationError` on any
 * signature, claim, or expiry failure. Callers MUST treat thrown errors as
 * authentication failures — there is no soft fallback.
 */
export async function verifyUoaAccessToken(
  accessToken: string,
): Promise<UoaAccessTokenClaims> {
  const env = getEnv();
  const expectedIssuer = env.SSO_BASE_URL.replace(/\/+$/, '');
  // UOA documents `aud` as the relying-party domain (the same value we put
  // in the config-JWT `domain` claim). See sso-uoa-doc-gaps.md §6.
  const expectedAudience = env.SSO_DOMAIN;

  try {
    const { payload } = await jwtVerify(accessToken, getUoaJwks(), {
      issuer: expectedIssuer,
      audience: expectedAudience,
      // `jwtVerify` already enforces exp/nbf with a default 0-second tolerance.
    });
    return payload as UoaAccessTokenClaims;
  } catch (err) {
    throw new UoaTokenVerificationError(
      'UOA access_token failed verification',
      err,
    );
  }
}

/**
 * Decode-only path retained for local development against a UOA stub that
 * cannot yet serve a JWKS. Strictly gated by `NODE_ENV !== 'production'`. The
 * production code path never calls this — finding H2 forbids it.
 */
export function decodeUoaAccessTokenForDev(
  accessToken: string,
): UoaAccessTokenClaims {
  return decodeJwt(accessToken) as UoaAccessTokenClaims;
}

/**
 * Shape of the `/auth/token` response from UOA. Mirrored from `auth.ts`.
 */
export interface UoaOrgMembership {
  orgId?: string;
  role?: string;
}

export interface UoaTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  token_type?: string;
  firstLogin?: {
    memberships?: {
      orgs?: UoaOrgMembership[];
      teams?: Array<{ teamId?: string; orgId?: string; role?: string }>;
    };
    pending_invites?: unknown[];
    capabilities?: { can_create_org?: boolean; can_accept_invite?: boolean };
  };
}

/**
 * Redaction helper. Replaces every token-bearing field with `'[REDACTED]'`
 * so a `UoaTokenResponse` can be passed safely into a structured logger.
 * Never log a raw token response — finding L-3 / H-1.
 */
export function redactUoaToken(
  res: UoaTokenResponse | null | undefined,
): Record<string, unknown> {
  if (!res) return { tokenResponse: null };
  return {
    token_type: res.token_type,
    expires_in: res.expires_in,
    refresh_token_expires_in: res.refresh_token_expires_in,
    has_access_token: typeof res.access_token === 'string' && res.access_token.length > 0,
    has_refresh_token: typeof res.refresh_token === 'string' && res.refresh_token.length > 0,
    firstLogin_orgs: res.firstLogin?.memberships?.orgs?.length ?? 0,
  };
}
