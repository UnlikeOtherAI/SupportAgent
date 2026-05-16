import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { getEnv } from '@support-agent/config';
import { SESSION_COOKIE } from '../lib/session-cookie.js';

declare module 'fastify' {
  interface FastifyRequest {
    authenticate: () => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; tenantId: string; role: string };
    user: { sub: string; tenantId: string; role: string };
  }
}

/**
 * Auth plugin. Accepts the relying-party JWT from either:
 *   1. `Authorization: Bearer <jwt>` — legacy/admin and worker callers
 *   2. The `__Host-abb_session` cookie set by the SSO callback
 *
 * Cookie delivery is preferred for browser sessions: the JWT never appears
 * in URL query strings, browser history, or `Referer` headers. See review
 * findings H1 and L-3.
 */
export const authPlugin = fp(async (app: FastifyInstance) => {
  const env = getEnv();

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: SESSION_COOKIE, signed: false },
  });

  app.decorateRequest('authenticate', async function (this: FastifyRequest) {
    // `@fastify/jwt` resolves the token from the `Authorization` header first,
    // then falls back to the configured cookie. We do not pass `onlyCookie`
    // because worker and CLI callers still use bearer headers.
    await this.jwtVerify();
  });
});
