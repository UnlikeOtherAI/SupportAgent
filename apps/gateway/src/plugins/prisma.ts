import { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';
import { type FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * Gateway Prisma plugin. The gateway only reads `RuntimeApiKey` records on
 * the WS upgrade path and writes `AuditEvent` rows; it does not own any
 * tenant data.
 */
export const prismaPlugin = fp(async (app: FastifyInstance) => {
  const prisma = new PrismaClient();
  await prisma.$connect();

  app.decorate('prisma', prisma);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});
