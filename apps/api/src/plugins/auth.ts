import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { getEnv } from '@support-agent/config';

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

export const authPlugin = fp(async (app: FastifyInstance) => {
  const env = getEnv();

  await app.register(jwt, { secret: env.JWT_SECRET });

  app.decorateRequest('authenticate', async function (this: FastifyRequest) {
    await this.jwtVerify();
  });
});
