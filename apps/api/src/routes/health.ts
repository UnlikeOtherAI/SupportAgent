import { type FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/', async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
    } catch {
      return reply.status(503).send({
        error: { code: 'DB_UNAVAILABLE', message: 'Database connection failed' },
      });
    }
    return { status: 'ok' };
  });
}
