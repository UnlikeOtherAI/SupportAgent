import { Prisma } from '@prisma/client';
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';

const WorkflowType = z.enum(['triage', 'build', 'merge']);

const ScenarioBody = z.object({
  key: z.string().min(1).max(255).optional(),
  displayName: z.string().min(1).max(255).optional(),
  workflowType: WorkflowType.optional(),
  enabled: z.boolean().optional(),
  executionProfileId: z.string().uuid().nullable().optional(),
  orchestrationProfileId: z.string().uuid().nullable().optional(),
  reviewProfileId: z.string().uuid().nullable().optional(),
  allowedConnectors: z.array(z.string().uuid()).optional(),
  notificationPolicy: z.string().nullable().optional(),
  distributionTarget: z.string().nullable().optional(),
});

const CreateScenarioBody = ScenarioBody.extend({
  key: z.string().min(1).max(255),
  displayName: z.string().min(1).max(255),
  workflowType: WorkflowType,
});

type WorkflowScenarioWithBindings = Prisma.WorkflowScenarioGetPayload<{
  include: { bindings: true };
}>;

function readStringConfig(value: unknown, key: string) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : null;
}

function mapScenario(scenario: WorkflowScenarioWithBindings) {
  return {
    id: scenario.id,
    key: scenario.key,
    displayName: scenario.displayName,
    workflowType: scenario.workflowType,
    enabled: scenario.isEnabled,
    triggerPolicyCount: scenario.triggerPolicyId ? 1 : 0,
    executionProfileId: scenario.executionProfileId,
    orchestrationProfileId: scenario.orchestrationProfileId,
    reviewProfileId: scenario.reviewProfileId,
    allowedConnectors: scenario.bindings
      .map((binding) => binding.connectorId)
      .filter((connectorId): connectorId is string => !!connectorId),
    notificationPolicy: readStringConfig(scenario.notificationConfig, 'policy'),
    distributionTarget: readStringConfig(scenario.distributionConfig, 'target'),
  };
}

function createJsonStringConfig(value: string | null | undefined, key: string) {
  if (!value) return undefined;
  return { [key]: value } as Prisma.InputJsonValue;
}

function updateJsonStringConfig(value: string | null | undefined, key: string) {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return Prisma.JsonNull;
  return { [key]: value } as Prisma.InputJsonValue;
}

export async function workflowScenarioRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  app.get('/', async (request) => {
    const scenarios = await app.prisma.workflowScenario.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { createdAt: 'desc' },
      include: { bindings: true },
    });

    return scenarios.map(mapScenario);
  });

  app.get<{ Params: { scenarioId: string } }>('/:scenarioId', async (request, reply) => {
    const scenario = await app.prisma.workflowScenario.findFirst({
      where: { id: request.params.scenarioId, tenantId: request.user.tenantId },
      include: { bindings: true },
    });

    if (!scenario) {
      return reply.status(404).send({ error: 'Workflow scenario not found' });
    }

    return mapScenario(scenario);
  });

  app.post('/', async (request, reply) => {
    const body = CreateScenarioBody.parse(request.body);
    const scenario = await app.prisma.workflowScenario.create({
      data: {
        tenantId: request.user.tenantId,
        key: body.key,
        displayName: body.displayName,
        workflowType: body.workflowType,
        isEnabled: body.enabled ?? true,
        executionProfileId: body.executionProfileId ?? undefined,
        orchestrationProfileId: body.orchestrationProfileId ?? undefined,
        reviewProfileId: body.reviewProfileId ?? undefined,
        notificationConfig: createJsonStringConfig(body.notificationPolicy, 'policy'),
        distributionConfig: createJsonStringConfig(body.distributionTarget, 'target'),
        bindings: {
          create: (body.allowedConnectors ?? []).map((connectorId, index) => ({
            connectorId,
            priority: index + 1,
          })),
        },
      },
      include: { bindings: true },
    });

    return reply.status(201).send(mapScenario(scenario));
  });

  app.put<{ Params: { scenarioId: string } }>('/:scenarioId', async (request, reply) => {
    const body = ScenarioBody.parse(request.body);
    const existing = await app.prisma.workflowScenario.findFirst({
      where: { id: request.params.scenarioId, tenantId: request.user.tenantId },
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Workflow scenario not found' });
    }

    const scenario = await app.prisma.$transaction(async (tx) => {
      if (body.allowedConnectors !== undefined) {
        await tx.workflowScenarioBinding.deleteMany({
          where: { scenarioId: existing.id },
        });

        if (body.allowedConnectors.length > 0) {
          await tx.workflowScenarioBinding.createMany({
            data: body.allowedConnectors.map((connectorId, index) => ({
              scenarioId: existing.id,
              connectorId,
              priority: index + 1,
            })),
          });
        }
      }

      return tx.workflowScenario.update({
        where: { id: existing.id },
        data: {
          ...(body.key !== undefined ? { key: body.key } : {}),
          ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
          ...(body.workflowType !== undefined ? { workflowType: body.workflowType } : {}),
          ...(body.enabled !== undefined ? { isEnabled: body.enabled } : {}),
          ...(body.executionProfileId !== undefined ? { executionProfileId: body.executionProfileId } : {}),
          ...(body.orchestrationProfileId !== undefined ? { orchestrationProfileId: body.orchestrationProfileId } : {}),
          ...(body.reviewProfileId !== undefined ? { reviewProfileId: body.reviewProfileId } : {}),
          ...(body.notificationPolicy !== undefined
            ? { notificationConfig: updateJsonStringConfig(body.notificationPolicy, 'policy') }
            : {}),
          ...(body.distributionTarget !== undefined
            ? { distributionConfig: updateJsonStringConfig(body.distributionTarget, 'target') }
            : {}),
        },
        include: { bindings: true },
      });
    });

    return mapScenario(scenario);
  });

  app.delete<{ Params: { scenarioId: string } }>('/:scenarioId', async (request, reply) => {
    const existing = await app.prisma.workflowScenario.findFirst({
      where: { id: request.params.scenarioId, tenantId: request.user.tenantId },
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Workflow scenario not found' });
    }

    await app.prisma.workflowScenario.delete({ where: { id: existing.id } });
    return reply.status(204).send();
  });
}
