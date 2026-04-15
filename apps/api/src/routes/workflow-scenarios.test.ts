import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseEnv } from '@support-agent/config';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';

const TENANT_ID = 'f0000000-0000-0000-0000-000000000001';
const JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

describe('Workflow scenario designer graph routes', () => {
  let app: FastifyInstance;
  let authToken: string;
  let scenarioId: string;

  beforeAll(async () => {
    parseEnv({
      DATABASE_URL: 'postgresql://supportagent:supportagent@localhost:5432/supportagent_dev',
      JWT_SECRET,
      REDIS_URL: 'redis://localhost:6379',
    });
    app = await buildApp();
    await app.ready();
    authToken = app.jwt.sign({ sub: 'workflow-test-user', tenantId: TENANT_ID, role: 'admin' });
  });

  afterAll(async () => {
    await app.prisma.workflowScenarioStep.deleteMany({
      where: { scenario: { tenantId: TENANT_ID } },
    });
    await app.prisma.workflowScenario.deleteMany({ where: { tenantId: TENANT_ID } });
    await app.close();
  });

  it('creates, returns, updates, and deletes a designer-backed workflow', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/workflow-scenarios',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        key: 'designer-test-workflow',
        displayName: 'Designer Test Workflow',
        workflowType: 'triage',
        designerGraph: {
          nodes: [
            {
              id: 'node-trigger',
              type: 'trigger',
              label: 'GitHub issue opened',
              sourceKey: 'github.issue.opened',
              x: 40,
              y: 60,
              config: { event: 'github.issue.opened' },
            },
            {
              id: 'node-triage',
              type: 'action',
              label: 'Run triage',
              sourceKey: 'workflow.triage',
              x: 360,
              y: 60,
              config: { workflowType: 'triage' },
            },
            {
              id: 'node-comment',
              type: 'output',
              label: 'GitHub comment',
              sourceKey: 'github.issue.comment',
              x: 680,
              y: 60,
              config: { destinationType: 'github.issue.comment' },
            },
          ],
          connections: [
            { id: 'link-1', fromNodeId: 'node-trigger', toNodeId: 'node-triage' },
            { id: 'link-2', fromNodeId: 'node-triage', toNodeId: 'node-comment' },
          ],
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    scenarioId = createRes.json().id;
    expect(createRes.json().designerGraph.nodes).toHaveLength(3);
    expect(createRes.json().designerGraph.connections).toHaveLength(2);

    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/workflow-scenarios/${scenarioId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().designerGraph.nodes[0]).toMatchObject({
      id: 'node-trigger',
      label: 'GitHub issue opened',
      sourceKey: 'github.issue.opened',
      type: 'trigger',
    });

    const updateRes = await app.inject({
      method: 'PUT',
      url: `/v1/workflow-scenarios/${scenarioId}`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        designerGraph: {
          nodes: [
            {
              id: 'node-trigger',
              type: 'trigger',
              label: 'GitHub issue opened',
              sourceKey: 'github.issue.opened',
              x: 80,
              y: 90,
              config: { event: 'github.issue.opened' },
            },
          ],
          connections: [],
        },
      },
    });

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().designerGraph.nodes).toHaveLength(1);
    expect(updateRes.json().designerGraph.connections).toHaveLength(0);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/v1/workflow-scenarios/${scenarioId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(deleteRes.statusCode).toBe(204);
  });
});
