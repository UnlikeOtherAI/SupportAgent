import { Prisma } from '@prisma/client';
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createScenarioMatcher } from '../services/scenario-matcher.js';

const WorkflowType = z.enum(['triage', 'build', 'merge', 'review']);
const DesignerNodeType = z.enum(['trigger', 'action', 'output']);

const DesignerGraphNode = z.object({
  id: z.string().min(1).max(255),
  type: DesignerNodeType,
  label: z.string().min(1).max(255),
  sourceKey: z.string().min(1).max(255),
  x: z.number(),
  y: z.number(),
  config: z.record(z.unknown()).optional(),
});

const DesignerGraphConnection = z.object({
  id: z.string().min(1).max(255).optional(),
  fromNodeId: z.string().min(1).max(255),
  toNodeId: z.string().min(1).max(255),
});

const DesignerGraph = z.object({
  nodes: z.array(DesignerGraphNode),
  connections: z.array(DesignerGraphConnection),
});

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
  designerGraph: DesignerGraph.optional(),
});

const CreateScenarioBody = ScenarioBody.extend({
  key: z.string().min(1).max(255),
  displayName: z.string().min(1).max(255),
  workflowType: WorkflowType,
});

type WorkflowScenarioWithBindings = Prisma.WorkflowScenarioGetPayload<{
  include: { bindings: true; steps: true };
}>;

function readStringConfig(value: unknown, key: string) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : null;
}

function mapScenario(scenario: WorkflowScenarioWithBindings) {
  const designerGraph = readDesignerGraph(scenario.steps);

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
    designerGraph,
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

function readDesignerConfig(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const designer = (value as Record<string, unknown>).designer;
  return designer && typeof designer === 'object' && !Array.isArray(designer)
    ? designer as Record<string, unknown>
    : null;
}

function readRuntimeStepConfig(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const config = { ...value as Record<string, unknown> };
  delete config.designer;
  return config;
}

function readDesignerGraph(steps: WorkflowScenarioWithBindings['steps']) {
  const orderedSteps = [...steps].sort((left, right) => left.stepOrder - right.stepOrder);
  const nodes = orderedSteps.flatMap((step) => {
    const designer = readDesignerConfig(step.config);
    if (!designer) return [];

    const position = readDesignerConfig({ designer: designer.position });
    const nodeId = typeof designer.id === 'string' ? designer.id : step.id;
    const label = typeof designer.label === 'string' ? designer.label : step.stepType;
    const sourceKey = typeof designer.sourceKey === 'string' ? designer.sourceKey : step.stepType;
    const x = typeof position?.x === 'number' ? position.x : 80 + step.stepOrder * 32;
    const y = typeof position?.y === 'number' ? position.y : 80 + step.stepOrder * 32;

    return [{
      id: nodeId,
      type: DesignerNodeType.catch('action').parse(step.stepType),
      label,
      sourceKey,
      x,
      y,
      config: readRuntimeStepConfig(step.config),
    }];
  });

  const nodeIds = new Set(nodes.map((node) => node.id));
  const connections = orderedSteps.flatMap((step) => {
    const designer = readDesignerConfig(step.config);
    const fromNodeId = typeof designer?.id === 'string' ? designer.id : step.id;
    const outgoingNodeIds = Array.isArray(designer?.outgoingNodeIds)
      ? designer.outgoingNodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string')
      : [];

    return outgoingNodeIds.flatMap((toNodeId) =>
      nodeIds.has(fromNodeId) && nodeIds.has(toNodeId)
        ? [{ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId }]
        : [],
    );
  });

  return { nodes, connections };
}

function createDesignerSteps(designerGraph: z.infer<typeof DesignerGraph>) {
  return designerGraph.nodes.map((node, index) => {
    const outgoingNodeIds = designerGraph.connections
      .filter((connection) => connection.fromNodeId === node.id)
      .map((connection) => connection.toNodeId);
    const config = {
      ...(node.config ?? {}),
      designer: {
        id: node.id,
        label: node.label,
        outgoingNodeIds,
        position: {
          x: Math.round(node.x),
          y: Math.round(node.y),
        },
        sourceKey: node.sourceKey,
      },
    } satisfies Prisma.InputJsonObject;

    return {
      stepOrder: index + 1,
      stepType: node.type,
      config,
    };
  });
}

const MatchableQuery = z.object({
  connectorId: z.string().uuid().optional(),
});

export async function workflowScenarioRoutes(app: FastifyInstance) {
  const matcher = createScenarioMatcher(app.prisma);

  app.addHook('onRequest', async (request) => {
    await request.authenticate();
  });

  app.get('/matchable', async (request) => {
    const query = MatchableQuery.parse(request.query ?? {});
    return matcher.listMatchable(request.user.tenantId, { connectorId: query.connectorId });
  });

  app.get('/', async (request) => {
    const scenarios = await app.prisma.workflowScenario.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { createdAt: 'desc' },
      include: { bindings: true, steps: true },
    });

    return scenarios.map(mapScenario);
  });

  app.get<{ Params: { scenarioId: string } }>('/:scenarioId', async (request, reply) => {
    const scenario = await app.prisma.workflowScenario.findFirst({
      where: { id: request.params.scenarioId, tenantId: request.user.tenantId },
      include: { bindings: true, steps: true },
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
        steps: body.designerGraph
          ? {
              create: createDesignerSteps(body.designerGraph),
            }
          : undefined,
      },
      include: { bindings: true, steps: true },
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

      if (body.designerGraph !== undefined) {
        await tx.workflowScenarioStep.deleteMany({
          where: { scenarioId: existing.id },
        });

        const steps = createDesignerSteps(body.designerGraph);
        if (steps.length > 0) {
          await tx.workflowScenarioStep.createMany({
            data: steps.map((step) => ({
              ...step,
              scenarioId: existing.id,
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
        include: { bindings: true, steps: true },
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

    await app.prisma.$transaction(async (tx) => {
      await tx.workflowScenarioStep.deleteMany({ where: { scenarioId: existing.id } });
      await tx.workflowScenarioBinding.deleteMany({ where: { scenarioId: existing.id } });
      await tx.workflowScenario.delete({ where: { id: existing.id } });
    });
    return reply.status(204).send();
  });
}
