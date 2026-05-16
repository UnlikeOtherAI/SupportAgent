import { type FastifyReply } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';

/**
 * State cookie used during the UOA SSO redirect dance.
 *
 * `__Host-` requires Path=/, so we use `__Secure-` to scope the cookie to
 * the callback route only. Both prefixes enforce HTTPS-only delivery.
 */
export const STATE_COOKIE = '__Secure-sso_state';
export const STATE_COOKIE_PATH = '/v1/auth/providers';
export const STATE_TTL_SECONDS = 600;

export interface SsoStatePayload {
  codeVerifier: string;
  next: string;
  providerKey: string;
}

export async function signStateCookie(
  secret: string,
  payload: SsoStatePayload,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifyStateCookie(
  secret: string,
  token: string,
): Promise<SsoStatePayload | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    const { codeVerifier, next, providerKey } = payload as Record<string, unknown>;
    if (
      typeof codeVerifier !== 'string' ||
      typeof next !== 'string' ||
      typeof providerKey !== 'string'
    ) {
      return null;
    }
    return { codeVerifier, next, providerKey };
  } catch {
    return null;
  }
}

export function clearStateCookie(reply: FastifyReply): void {
  reply.setCookie(STATE_COOKIE, '', {
    path: STATE_COOKIE_PATH,
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
}
