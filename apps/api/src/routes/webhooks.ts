import { type FastifyInstance } from 'fastify';
import { createIntakeService } from '../services/intake-service.js';

export async function webhookRoutes(app: FastifyInstance) {
  const intake = createIntakeService(app.prisma);

  app.post<{ Params: { platformType: string; connectorId: string } }>(
    '/:platformType/:connectorId',
    async (request, reply) => {
      const { platformType, connectorId } = request.params;
      const rawBody = request.body as string;

      // Get signature from common header locations
      const signature =
        (request.headers['x-hub-signature-256'] as string) ??
        (request.headers['x-linear-signature'] as string) ??
        (request.headers['sentry-hook-signature'] as string) ??
        (request.headers['x-webhook-signature'] as string);

      const result = await intake.processWebhook(
        connectorId,
        platformType,
        rawBody,
        signature,
      );

      if (result.status === 'ignored') return reply.status(200).send(result);
      if (result.status === 'duplicate') return reply.status(200).send(result);
      return reply.status(201).send(result);
    },
  );
}
