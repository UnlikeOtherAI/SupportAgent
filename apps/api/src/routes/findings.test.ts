import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { parseEnv } from '@support-agent/config';
import { type FastifyInstance } from 'fastify';

const TEST_TENANT_ID = 'f0000000-0000-0000-0000-000000000001';
const JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

describe('Findings API', () => {
  let app: FastifyInstance;
  let token: string;
  let connectorId: string;
  let repoMappingId: string;
  let workItemId: string;
  let workflowRunId: string;

  beforeAll(async () => {
    parseEnv({
      DATABASE_URL: 'postgresql://supportagent:supportagent@localhost:5432/supportagent_dev',
      JWT_SECRET,
      REDIS_URL: 'redis://localhost:6379',
    });
    app = await buildApp();
    await app.ready();
    token = app.jwt.sign({ sub: 'user-findings', tenantId: TEST_TENANT_ID, role: 'admin' });

    const pt = await app.prisma.platformType.upsert({
      where: { key: 'test-findings' },
      update: {},
      create: {
        key: 'test-findings',
        displayName: 'Test Findings Platform',
        supportsWebhook: true,
        supportsPolling: false,
        supportsInbound: true,
        supportsOutbound: false,
      },
    });

    const connector = await app.prisma.connector.create({
      data: {
        tenantId: TEST_TENANT_ID,
        platformTypeId: pt.id,
        name: 'Test Findings Connector',
        direction: 'inbound',
        configuredIntakeMode: 'webhook',
        effectiveIntakeMode: 'webhook',
      },
    });
    connectorId = connector.id;

    const repoMapping = await app.prisma.repositoryMapping.create({
      data: {
        tenantId: TEST_TENANT_ID,
        connectorId,
        repositoryUrl: 'https://github.com/test/findings-repo',
      },
    });
    repoMappingId = repoMapping.id;

    const workItem = await app.prisma.inboundWorkItem.create({
      data: {
        connectorInstanceId: connectorId,
        platformType: 'test-findings',
        workItemKind: 'issue',
        externalItemId: 'FIND-TEST-1',
        title: 'Test work item for findings',
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
  });

  afterAll(async () => {
    // Clean up test data in reverse dependency order
    await app.prisma.outboundDeliveryAttempt.deleteMany({ where: { workflowRunId } });
    await app.prisma.finding.deleteMany({ where: { workflowRunId } });
    await app.prisma.workflowRun.deleteMany({ where: { id: workflowRunId } });
    await app.prisma.inboundWorkItem.deleteMany({ where: { id: workItemId } });
    await app.prisma.repositoryMapping.deleteMany({ where: { id: repoMappingId } });
    await app.prisma.connector.deleteMany({ where: { id: connectorId } });
    // Platform type left in place (shared reference data, unique key)
    await app.close();
  });

  it('POST /v1/runs/:runId/findings creates a finding', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/runs/${workflowRunId}/findings`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        summary: 'Null pointer in auth middleware',
        rootCauseHypothesis: 'Missing null check on user object',
        confidence: 0.85,
        reproductionStatus: 'reproduced',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.summary).toBe('Null pointer in auth middleware');
    expect(body.confidence).toBe(0.85);
    expect(body.workflowRunId).toBe(workflowRunId);
  });

  it('GET /v1/runs/:runId/findings returns created finding', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/runs/${workflowRunId}/findings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].summary).toBe('Null pointer in auth middleware');
  });

  it('GET /v1/findings/:findingId returns finding detail', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: `/v1/runs/${workflowRunId}/findings`,
      headers: { authorization: `Bearer ${token}` },
    });
    const findingId = listRes.json()[0].id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/findings/${findingId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(findingId);
    expect(res.json()).toHaveProperty('workflowRun');
  });

  it('returns 404 for non-existent run', async () => {
    const fakeRunId = '00000000-0000-0000-0000-000000000099';
    const res = await app.inject({
      method: 'GET',
      url: `/v1/runs/${fakeRunId}/findings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/runs/${workflowRunId}/findings`,
    });
    expect(res.statusCode).toBe(401);
  });
});
