import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { parseEnv } from '@support-agent/config';
import { type FastifyInstance } from 'fastify';

const TEST_TENANT_ID = 'd0000000-0000-0000-0000-000000000001';
const JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

describe('Outbound Destinations API', () => {
  let app: FastifyInstance;
  let token: string;
  let connectorId: string;
  let repoMappingId: string;
  let workItemId: string;
  let workflowRunId: string;
  let findingId: string;
  let destinationId: string;

  beforeAll(async () => {
    parseEnv({
      DATABASE_URL: 'postgresql://supportagent:supportagent@localhost:5432/supportagent_dev',
      JWT_SECRET,
      REDIS_URL: 'redis://localhost:6379',
    });
    app = await buildApp();
    await app.ready();
    token = app.jwt.sign({ sub: 'user-outbound', tenantId: TEST_TENANT_ID, role: 'admin' });

    const pt = await app.prisma.platformType.upsert({
      where: { key: 'test-outbound' },
      update: {},
      create: {
        key: 'test-outbound',
        displayName: 'Test Outbound Platform',
        supportsWebhook: true,
        supportsPolling: false,
        supportsInbound: true,
        supportsOutbound: true,
      },
    });

    const connector = await app.prisma.connector.create({
      data: {
        tenantId: TEST_TENANT_ID,
        platformTypeId: pt.id,
        name: 'Test Outbound Connector',
        direction: 'both',
        configuredIntakeMode: 'webhook',
        effectiveIntakeMode: 'webhook',
      },
    });
    connectorId = connector.id;

    const repoMapping = await app.prisma.repositoryMapping.create({
      data: {
        tenantId: TEST_TENANT_ID,
        connectorId,
        repositoryUrl: 'https://github.com/test/outbound-repo',
      },
    });
    repoMappingId = repoMapping.id;

    const workItem = await app.prisma.inboundWorkItem.create({
      data: {
        connectorInstanceId: connectorId,
        platformType: 'test-outbound',
        workItemKind: 'issue',
        externalItemId: 'OUT-TEST-1',
        title: 'Test work item for outbound',
        repositoryMappingId: repoMappingId,
      },
    });
    workItemId = workItem.id;

    const run = await app.prisma.workflowRun.create({
      data: {
        tenantId: TEST_TENANT_ID,
        workflowType: 'triage',
        status: 'running',
        workItemId,
        repositoryMappingId: repoMappingId,
      },
    });
    workflowRunId = run.id;

    const finding = await app.prisma.finding.create({
      data: {
        workflowRunId,
        summary: 'Test finding for outbound delivery',
        confidence: 0.9,
      },
    });
    findingId = finding.id;
  });

  afterAll(async () => {
    await app.prisma.outboundDeliveryAttempt.deleteMany({ where: { workflowRunId } });
    await app.prisma.outboundDestination.deleteMany({ where: { tenantId: TEST_TENANT_ID } });
    await app.prisma.finding.deleteMany({ where: { workflowRunId } });
    await app.prisma.workflowRun.deleteMany({ where: { tenantId: TEST_TENANT_ID } });
    await app.prisma.inboundWorkItem.deleteMany({
      where: { connectorInstanceId: connectorId },
    });
    await app.prisma.repositoryMapping.deleteMany({ where: { tenantId: TEST_TENANT_ID } });
    await app.prisma.connector.deleteMany({ where: { tenantId: TEST_TENANT_ID } });
    await app.prisma.platformType.deleteMany({ where: { key: 'test-outbound' } });
    await app.close();
  });

  it('CRUD lifecycle: create, list, get, update, delete', async () => {
    // Create
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/outbound-destinations',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Slack Notifications',
        destinationType: 'webhook',
        config: { url: 'https://hooks.slack.example/test' },
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.name).toBe('Slack Notifications');
    expect(created.isActive).toBe(true);
    destinationId = created.id;

    // List
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/outbound-destinations',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().length).toBeGreaterThanOrEqual(1);

    // Get
    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/outbound-destinations/${destinationId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().id).toBe(destinationId);

    // Update
    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/v1/outbound-destinations/${destinationId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Updated Slack', isActive: false },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().name).toBe('Updated Slack');
    expect(updateRes.json().isActive).toBe(false);

    // Delete
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/v1/outbound-destinations/${destinationId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteRes.statusCode).toBe(204);

    // Confirm deleted
    const afterDelete = await app.inject({
      method: 'GET',
      url: `/v1/outbound-destinations/${destinationId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterDelete.statusCode).toBe(404);
  });

  it('POST /:destinationId/deliver creates delivery attempt', async () => {
    // Create a fresh destination for delivery
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/outbound-destinations',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Delivery Test Dest',
        destinationType: 'webhook',
        config: { url: 'http://localhost:19999/nonexistent' },
      },
    });
    const dest = createRes.json();
    destinationId = dest.id;

    const deliverRes = await app.inject({
      method: 'POST',
      url: `/v1/outbound-destinations/${dest.id}/deliver`,
      headers: { authorization: `Bearer ${token}` },
      payload: { workflowRunId, findingId },
    });
    // Delivery will fail (no server listening) but the attempt is created
    expect(deliverRes.statusCode).toBe(200);
    const attempt = deliverRes.json();
    expect(attempt.outboundDestinationId).toBe(dest.id);
    expect(attempt.workflowRunId).toBe(workflowRunId);
    expect(attempt.findingId).toBe(findingId);
    expect(attempt.status).toBe('failed');
  });

  it('GET /v1/runs/:runId/delivery-attempts lists delivery attempts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/runs/${workflowRunId}/delivery-attempts`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].workflowRunId).toBe(workflowRunId);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/outbound-destinations',
    });
    expect(res.statusCode).toBe(401);
  });
});
