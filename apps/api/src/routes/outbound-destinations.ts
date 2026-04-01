import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createOutboundDestinationRepository } from '../repositories/outbound-destination-repository.js';
import { createDeliveryAttemptRepository } from '../repositories/delivery-attempt-repository.js';
import { createOutboundDeliveryService } from '../services/outbound-delivery-service.js';

const CreateDestinationBody = z.object({
  name: z.string().min(1).max(255),
  destinationType: z.string().min(1),
  connectorId: z.string().uuid().optional(),
  config: z.record(z.unknown()),
  isActive: z.boolean().optional(),
});

const UpdateDestinationBody = z.object({
  name: z.string().min(1).max(255).optional(),
  destinationType: z.string().min(1).optional(),
  config: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

const DeliverBody = z.object({
  workflowRunId: z.string().uuid(),
  findingId: z.string().uuid(),
});

/** Routes mounted at /v1/outbound-destinations. */
export async function outboundDestinationRoutes(app: FastifyInstance) {
  const destRepo = createOutboundDestinationRepository(app.prisma);
  const attemptRepo = createDeliveryAttemptRepository(app.prisma);
  const service = createOutboundDeliveryService(destRepo, attemptRepo, app.prisma);

  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  app.get('/', async (request) => {
    return service.listDestinations(request.user.tenantId);
  });

  app.post('/', async (request, reply) => {
    const body = CreateDestinationBody.parse(request.body);
    const dest = await service.createDestination(request.user.tenantId, body);
    return reply.status(201).send(dest);
  });

  app.get<{ Params: { destinationId: string } }>('/:destinationId', async (request) => {
    return service.getDestination(request.params.destinationId, request.user.tenantId);
  });

  app.patch<{ Params: { destinationId: string } }>('/:destinationId', async (request) => {
    const body = UpdateDestinationBody.parse(request.body);
    return service.updateDestination(
      request.params.destinationId,
      request.user.tenantId,
      body,
    );
  });

  app.delete<{ Params: { destinationId: string } }>(
    '/:destinationId',
    async (request, reply) => {
      await service.deleteDestination(request.params.destinationId, request.user.tenantId);
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { destinationId: string } }>(
    '/:destinationId/deliver',
    async (request) => {
      const body = DeliverBody.parse(request.body);
      return service.deliverFinding(
        request.params.destinationId,
        request.user.tenantId,
        body,
      );
    },
  );
}

/** Routes mounted at /v1/runs — adds /:runId/delivery-attempts endpoint. */
export async function deliveryAttemptRunRoutes(app: FastifyInstance) {
  const destRepo = createOutboundDestinationRepository(app.prisma);
  const attemptRepo = createDeliveryAttemptRepository(app.prisma);
  const service = createOutboundDeliveryService(destRepo, attemptRepo, app.prisma);

  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  app.get<{ Params: { runId: string } }>('/:runId/delivery-attempts', async (request) => {
    return service.listDeliveryAttempts(request.params.runId, request.user.tenantId);
  });
}
