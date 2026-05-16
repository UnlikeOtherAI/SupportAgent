import { type FastifyReply, type FastifyRequest } from 'fastify';

/**
 * HttpOnly session cookie that carries the relying-party JWT.
 *
 * `__Host-` requires `Secure`, `Path=/`, and no `Domain` attribute — the
 * strongest browser-side scoping. The cookie is set on the SSO callback
 * response and replayed by the browser on every API request. The admin
 * app reads identity via `/v1/auth/me`, which is backed by this cookie.
 *
 * No JWT ever appears in a URL query string. See finding H1 / L-3.
 */
export const SESSION_COOKIE = '__Host-abb_session';
export const SESSION_COOKIE_PATH = '/';
export const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24h, matches JWT exp

export function setSessionCookie(reply: FastifyReply, jwt: string): void {
  reply.setCookie(SESSION_COOKIE, jwt, {
    path: SESSION_COOKIE_PATH,
    maxAge: SESSION_TTL_SECONDS,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.setCookie(SESSION_COOKIE, '', {
    path: SESSION_COOKIE_PATH,
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
}

export function readSessionCookie(request: FastifyRequest): string | null {
  const value = request.cookies[SESSION_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
