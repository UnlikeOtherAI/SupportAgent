import { type FastifyInstance } from 'fastify';
import { resolveTenantId } from '../lib/resolve-tenant-id.js';
import { SkillService } from '../services/skill-service.js';

export async function skillRoutes(app: FastifyInstance) {
  const service = new SkillService(app.prisma);

  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  app.get('/', async (request) => {
    return service.list(resolveTenantId(request));
  });

  app.get<{ Params: { skillId: string } }>('/:skillId', async (request, reply) => {
    const skill = await service.getById(request.params.skillId, resolveTenantId(request));
    if (!skill) {
      return reply.status(404).send({ error: 'Skill not found' });
    }

    return skill;
  });

  app.post('/', async (request, reply) => {
    try {
      const skill = await service.clone(request.body, resolveTenantId(request));
      return reply.status(201).send(skill);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to clone skill';
      return reply.status(/already exists/i.test(message) ? 409 : 400).send({ error: message });
    }
  });

  app.put<{ Params: { skillId: string } }>('/:skillId', async (request, reply) => {
    try {
      const skill = await service.update(
        request.params.skillId,
        request.body,
        resolveTenantId(request),
      );

      if (!skill) {
        return reply.status(404).send({ error: 'User skill not found' });
      }

      return skill;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update skill';
      return reply.status(/already exists/i.test(message) ? 409 : 400).send({ error: message });
    }
  });
}
