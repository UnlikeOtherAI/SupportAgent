import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createRepositoryMappingRepository } from '../repositories/repository-mapping-repository.js';
import { createRepositoryMappingService } from '../services/repository-mapping-service.js';
import { RepositoryUrlSchema } from '../validators/repository-url.js';

const CreateMappingBody = z.object({
  connectorId: z.string().uuid(),
  repositoryUrl: RepositoryUrlSchema,
  defaultBranch: z.string().min(1).optional(),
  executionProfileId: z.string().uuid().optional(),
  orchestrationProfileId: z.string().uuid().optional(),
  reviewProfileId: z.string().uuid().optional(),
  dependencyPolicy: z.record(z.unknown()).optional(),
  notificationBindings: z.record(z.unknown()).optional(),
});

const UpdateMappingBody = z.object({
  repositoryUrl: RepositoryUrlSchema.optional(),
  defaultBranch: z.string().min(1).optional(),
  executionProfileId: z.string().uuid().nullable().optional(),
  orchestrationProfileId: z.string().uuid().nullable().optional(),
  reviewProfileId: z.string().uuid().nullable().optional(),
  dependencyPolicy: z.record(z.unknown()).nullable().optional(),
  notificationBindings: z.record(z.unknown()).nullable().optional(),
});

export async function repositoryMappingRoutes(app: FastifyInstance) {
  const repo = createRepositoryMappingRepository(app.prisma);
  const service = createRepositoryMappingService(repo, app.prisma);

  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  app.get('/', async (request) => {
    const query = request.query as { connectorId?: string };
    return service.listMappings(request.user.tenantId, {
      connectorId: query.connectorId,
    });
  });

  app.get<{ Params: { mappingId: string } }>('/:mappingId', async (request) => {
    return service.getMapping(request.params.mappingId, request.user.tenantId);
  });

  app.post('/', async (request, reply) => {
    const body = CreateMappingBody.parse(request.body);
    const mapping = await service.createMapping(request.user.tenantId, body);
    return reply.status(201).send(mapping);
  });

  app.patch<{ Params: { mappingId: string } }>('/:mappingId', async (request) => {
    const body = UpdateMappingBody.parse(request.body);
    return service.updateMapping(request.params.mappingId, request.user.tenantId, body);
  });

  app.delete<{ Params: { mappingId: string } }>('/:mappingId', async (request, reply) => {
    await service.deleteMapping(request.params.mappingId, request.user.tenantId);
    return reply.status(204).send();
  });
}
