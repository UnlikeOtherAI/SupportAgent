import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createConnectorRepository } from '../repositories/connector-repository.js';
import { createConnectorService } from '../services/connector-service.js';

const CreateConnectorBody = z
  .object({
    platformTypeKey: z.string().optional(),
    platformTypeId: z.string().uuid().optional(),
    name: z.string().min(1).max(255),
    direction: z.enum(['inbound', 'outbound', 'both']),
    configuredIntakeMode: z.enum(['webhook', 'polling', 'manual']),
    apiBaseUrl: z.string().url().optional(),
    pollingIntervalSeconds: z.number().int().min(10).optional(),
    config: z.record(z.string(), z.string()).optional(),
    secrets: z.record(z.string(), z.string()).optional(),
  })
  .refine((d) => d.platformTypeKey || d.platformTypeId, {
    message: 'Either platformTypeKey or platformTypeId is required',
  });

const UpdateConnectorBody = z.object({
  name: z.string().min(1).max(255).optional(),
  direction: z.enum(['inbound', 'outbound', 'both']).optional(),
  configuredIntakeMode: z.enum(['webhook', 'polling', 'manual']).optional(),
  effectiveIntakeMode: z.enum(['webhook', 'polling', 'manual']).optional(),
  isEnabled: z.boolean().optional(),
  apiBaseUrl: z.string().url().optional(),
  pollingIntervalSeconds: z.number().int().min(10).optional(),
  config: z.record(z.string(), z.string()).optional(),
  taxonomyConfig: z.record(z.unknown()).optional(),
  imageDescriptionPolicy: z.string().optional(),
});

const UpdateConnectorSecretsBody = z.record(z.string(), z.string());

export async function connectorRoutes(app: FastifyInstance) {
  const repo = createConnectorRepository(app.prisma);
  const service = createConnectorService(repo, app.prisma);

  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  app.get('/', async (request) => {
    const { tenantId } = request.user;
    const query = request.query as { direction?: string; isEnabled?: string };
    return service.listConnectors(tenantId, {
      direction: query.direction,
      isEnabled:
        query.isEnabled === 'true' ? true : query.isEnabled === 'false' ? false : undefined,
    });
  });

  app.get<{ Params: { connectorId: string } }>('/:connectorId', async (request) => {
    return service.getConnector(request.params.connectorId, request.user.tenantId);
  });

  app.get<{ Params: { connectorId: string } }>('/:connectorId/secrets', async (request) => {
    return service.getConnectorSecrets(request.params.connectorId, request.user.tenantId);
  });

  app.post('/', async (request, reply) => {
    const body = CreateConnectorBody.parse(request.body);
    const connector = await service.createConnector(request.user.tenantId, body);
    return reply.status(201).send(connector);
  });

  app.patch<{ Params: { connectorId: string } }>('/:connectorId', async (request) => {
    const body = UpdateConnectorBody.parse(request.body);
    return service.updateConnector(request.params.connectorId, request.user.tenantId, body);
  });

  app.get<{ Params: { connectorId: string }; Querystring: { owner?: string } }>(
    '/:connectorId/repository-options',
    async (request) => {
      return {
        repositories: await service.listRepositoryOptions(
          request.params.connectorId,
          request.user.tenantId,
          request.query.owner,
        ),
      };
    },
  );

  app.get<{ Params: { connectorId: string } }>(
    '/:connectorId/repository-owners',
    async (request) => {
      return {
        owners: await service.listRepositoryOwners(
          request.params.connectorId,
          request.user.tenantId,
        ),
      };
    },
  );

  app.put<{ Params: { connectorId: string } }>('/:connectorId/secrets', async (request) => {
    const body = UpdateConnectorSecretsBody.parse(request.body);
    for (const [secretType, value] of Object.entries(body)) {
      if (value.length === 0) continue;
      await service.setConnectorSecret(
        request.params.connectorId,
        request.user.tenantId,
        secretType,
        value,
      );
    }
    return service.getConnectorSecrets(request.params.connectorId, request.user.tenantId);
  });

  app.delete<{ Params: { connectorId: string } }>('/:connectorId', async (request, reply) => {
    await service.deleteConnector(request.params.connectorId, request.user.tenantId);
    return reply.status(204).send();
  });

  app.post<{ Params: { connectorId: string } }>(
    '/:connectorId/capabilities/discover',
    async (request) => {
      return service.discoverCapabilities(request.params.connectorId, request.user.tenantId);
    },
  );

  app.get<{ Params: { connectorId: string } }>(
    '/:connectorId/capabilities',
    async (request) => {
      await service.getConnector(request.params.connectorId, request.user.tenantId);
      return repo.listCapabilities(request.params.connectorId);
    },
  );

  // Trigger policies — returns empty for now; full implementation requires a
  // Connector→TriggerPolicy junction relation in the schema + service/repository
  app.get<{ Params: { connectorId: string } }>(
    '/:connectorId/trigger-policies',
    async (request) => {
      await service.getConnector(request.params.connectorId, request.user.tenantId);
      return { policies: [] };
    },
  );

  app.put<{ Params: { connectorId: string } }>(
    '/:connectorId/trigger-policies',
    async (request) => {
      await service.getConnector(request.params.connectorId, request.user.tenantId);
      // Full implementation: validate and persist policies via junction table
      return { policies: [] };
    },
  );
}
