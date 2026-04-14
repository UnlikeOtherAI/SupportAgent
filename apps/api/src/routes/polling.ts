import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createPollingTriageService } from '../services/polling-triage-service.js';

const EnqueuePolledIssueBody = z.object({
  connectorId: z.string().uuid(),
  repositoryMappingId: z.string().uuid(),
  issue: z.object({
    body: z.string().nullable(),
    comments: z.array(
      z.object({
        author: z.string(),
        body: z.string(),
        createdAt: z.string(),
        id: z.string(),
        url: z.string().optional(),
      }),
    ),
    labels: z.array(z.string()),
    number: z.number().int().positive(),
    state: z.string(),
    title: z.string().min(1),
    updatedAt: z.string().optional(),
    url: z.string().url(),
  }),
});

export async function pollingRoutes(app: FastifyInstance) {
  const service = createPollingTriageService(app.prisma);

  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  app.get('/triage-targets', async (request) => {
    return service.listTargets(request.user.tenantId);
  });

  app.post('/triage-enqueue', async (request, reply) => {
    const body = EnqueuePolledIssueBody.parse(request.body);
    const result = await service.enqueueIssue(request.user.tenantId, body);
    return reply.status(result.status === 'created' ? 201 : 200).send(result);
  });
}
