import crypto, { type KeyObject } from 'node:crypto';
import {
  SignJWT,
  exportJWK,
  importPKCS8,
  type CryptoKey,
  type JWK,
} from 'jose';
import { getEnv } from '@support-agent/config';

type SigningKey = CryptoKey | KeyObject;

/**
 * UOA (UnlikeOtherAuthenticator) relying-party helpers.
 *
 * The runtime loads the RS256 private key on first use, derives the matching
 * public JWK, and caches both. The same `kid` is written into the JWT header
 * and the published JWK so UOA can resolve signatures against our JWKS.
 */

export interface UoaKeyMaterial {
  privateKey: SigningKey;
  publicJwk: JWK & { kid: string; alg: string; use: string };
  kid: string;
}

let cached: UoaKeyMaterial | null = null;

export async function getUoaKeyMaterial(): Promise<UoaKeyMaterial> {
  if (cached) return cached;

  const env = getEnv();
  if (!env.UOA_CONFIG_SIGNING_PRIVATE_KEY_PEM) {
    throw new Error('UOA_CONFIG_SIGNING_PRIVATE_KEY_PEM is not set');
  }

  const privateKey = await importPKCS8(env.UOA_CONFIG_SIGNING_PRIVATE_KEY_PEM, 'RS256');

  // Derive the public JWK from the private key so operators only have to
  // manage one secret. Stripping the private components is defense in depth:
  // UOA rejects JWKs that include `d`, `p`, `q`, `dp`, `dq`, `qi`, or `oth`.
  const raw = await exportJWK(privateKey);
  const publicJwk: JWK & { kid: string; alg: string; use: string } = {
    kty: raw.kty!,
    n: raw.n!,
    e: raw.e!,
    kid: env.UOA_JWK_KID,
    alg: 'RS256',
    use: 'sig',
  };

  cached = { privateKey, publicJwk, kid: env.UOA_JWK_KID };
  return cached;
}

export interface ConfigJwtPayload {
  domain: string;
  jwks_url: string;
  contact_email: string;
  redirect_urls: string[];
  enabled_auth_methods: string[];
  ui_theme: Record<string, unknown>;
  language_config: string;
  org_features?: Record<string, unknown>;
}

export async function signConfigJwt(payload: ConfigJwtPayload): Promise<string> {
  const { privateKey, kid } = await getUoaKeyMaterial();
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .setIssuedAt()
    .sign(privateKey);
}

/**
 * Bearer token for backend-to-backend calls (`/auth/token`, `/auth/revoke`).
 * The hash binds the per-domain secret to the `domain` claim so a leaked
 * secret cannot be replayed from a different origin.
 */
export function computeClientHash(domain: string, secret: string): string {
  return crypto.createHash('sha256').update(domain + secret).digest('hex');
}

/* ── PKCE ─────────────────────────────────────────────────────────────── */

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkcePair(): PkcePair {
  // 32 random bytes → 43 chars base64url, within UOA's 43-128 char bound.
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/* ── URLs ─────────────────────────────────────────────────────────────── */

export function getConfigUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl}/v1/auth/sso-config`;
}

export function getJwksUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl}/.well-known/jwks.json`;
}

export function getCallbackUrl(apiBaseUrl: string, providerKey: string): string {
  return `${apiBaseUrl}/v1/auth/providers/${providerKey}/callback`;
}

/**
 * True when the relying-party configuration is complete enough to sign a
 * config JWT and trigger Phase-1 auto-onboarding. `UOA_CLIENT_SECRET` is
 * intentionally NOT required here: the provider list must still surface
 * during onboarding so an operator can kick off the discovery flow.
 */
export function isSsoConfigured(): boolean {
  const env = getEnv();
  return Boolean(
    env.UOA_CONFIG_SIGNING_PRIVATE_KEY_PEM &&
      env.UOA_CONTACT_EMAIL &&
      env.SSO_DOMAIN,
  );
}
