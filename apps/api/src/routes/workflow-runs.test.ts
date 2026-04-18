import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { parseEnv } from '@support-agent/config';
import { type FastifyInstance } from 'fastify';

const TEST_TENANT_ID = 'b0000000-0000-0000-0000-000000000001';
const JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

describe('Workflow Run API', () => {
  let app: FastifyInstance;
  let token: string;
  let platformTypeId: string;
  let connectorId: string;
  let repoMappingId: string;
  let workItemId: string;

  beforeAll(async () => {
    parseEnv({
      DATABASE_URL: 'postgresql://supportagent:supportagent@localhost:5432/supportagent_dev',
      JWT_SECRET,
      REDIS_URL: 'redis://localhost:6379',
    });
    app = await buildApp();
    await app.ready();
    token = app.jwt.sign({ sub: 'user-1', tenantId: TEST_TENANT_ID, role: 'admin' });

    // Create fixture data
    const pt = await app.prisma.platformType.upsert({
      where: { key: 'test-wfr' },
      update: {},
      create: {
        key: 'test-wfr',
        displayName: 'Test WFR Platform',
        supportsWebhook: true,
        supportsPolling: false,
        supportsInbound: true,
        supportsOutbound: false,
      },
    });
    platformTypeId = pt.id;

    const connector = await app.prisma.connector.create({
      data: {
        tenantId: TEST_TENANT_ID,
        platformTypeId,
        name: 'Test WFR Connector',
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
        repositoryUrl: 'https://github.com/test/wfr-repo',
      },
    });
    repoMappingId = repoMapping.id;

    const workItem = await app.prisma.inboundWorkItem.create({
      data: {
        connectorInstanceId: connectorId,
        platformType: 'test-wfr',
        workItemKind: 'issue',
        externalItemId: 'WFR-TEST-1',
        title: 'Test work item for workflow runs',
        repositoryMappingId: repoMappingId,
      },
    });
    workItemId = workItem.id;
  });

  afterAll(async () => {
    try {
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM dispatch_attempt_checkpoints WHERE "dispatchAttemptId" IN (SELECT id FROM worker_dispatches WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" = $1))`,
        TEST_TENANT_ID,
      );
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM workflow_log_events WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" = $1)`,
        TEST_TENANT_ID,
      );
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM worker_dispatches WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" = $1)`,
        TEST_TENANT_ID,
      );
      await app.prisma.$executeRawUnsafe(`DELETE FROM workflow_runs WHERE "tenantId" = $1`, TEST_TENANT_ID);
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM inbound_work_items WHERE "connectorInstanceId" IN (SELECT id FROM connectors WHERE "tenantId" = $1)`,
        TEST_TENANT_ID,
      );
      await app.prisma.$executeRawUnsafe(`DELETE FROM repository_mappings WHERE "tenantId" = $1`, TEST_TENANT_ID);
      await app.prisma.$executeRawUnsafe(`DELETE FROM connectors WHERE "tenantId" = $1`, TEST_TENANT_ID);
      await app.prisma.$executeRawUnsafe(`DELETE FROM execution_providers WHERE "tenantId" = $1`, TEST_TENANT_ID);
      await app.prisma.platformType.deleteMany({ where: { key: 'test-wfr' } });
    } catch (e) {
      console.warn('Cleanup warning:', (e as Error).message);
    }
    await app.close();
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/runs' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /v1/runs returns paginated list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('POST /v1/runs creates a run with status queued', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        workflowType: 'triage',
        workItemId,
        repositoryMappingId: repoMappingId,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('queued');
    expect(body.workflowType).toBe('triage');
    expect(body.workItemId).toBe(workItemId);
    expect(body.attemptNumber).toBe(1);
  });

  it('GET /v1/runs/:id returns run detail', async () => {
    // Create a run first
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        workflowType: 'build',
        workItemId,
        repositoryMappingId: repoMappingId,
      },
    });
    const created = createRes.json();

    const res = await app.inject({
      method: 'GET',
      url: `/v1/runs/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(created.id);
    expect(body.workflowType).toBe('build');
    expect(body).toHaveProperty('workItem');
    expect(body).toHaveProperty('repositoryMapping');
    expect(body).toHaveProperty('findings');
    expect(body).toHaveProperty('dispatches');
    expect(body).toHaveProperty('reviews');
  });

  it('POST /v1/runs/:id/transition with valid transition succeeds', async () => {
    // Create a run (status: queued)
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        workflowType: 'triage',
        workItemId,
        repositoryMappingId: repoMappingId,
      },
    });
    const run = createRes.json();

    // queued -> dispatched
    const res = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/transition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'dispatched' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('dispatched');
  });

  it('POST /v1/runs/:id/transition with invalid transition returns 409', async () => {
    // Create a run (status: queued)
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        workflowType: 'triage',
        workItemId,
        repositoryMappingId: repoMappingId,
      },
    });
    const run = createRes.json();

    // queued -> running (invalid: must go through dispatched first)
    const res = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/transition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'running' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST /v1/runs/:id/cancel marks a queued run as cancel_requested', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        workflowType: 'merge',
        workItemId,
        repositoryMappingId: repoMappingId,
      },
    });
    const run = createRes.json();

    const res = await app.inject({
      method: 'POST',
      url: `/v1/workflow-runs/${run.id}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancel_requested');
  });

  it('POST /v1/workflow-runs/:id/cancel?force=1 stamps cancelForceRequestedAt', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        workflowType: 'triage',
        workItemId,
        repositoryMappingId: repoMappingId,
      },
    });
    const run = createRes.json();

    await app.inject({
      method: 'POST',
      url: `/v1/workflow-runs/${run.id}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/workflow-runs/${run.id}/cancel?force=1`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancel_requested');
    expect(res.json().cancelRequestedAt).toBeTruthy();
    expect(res.json().cancelForceRequestedAt).toBeTruthy();
  });

  it('POST /v1/workflow-runs/:id/cancel?force=1 returns 409 for a completed run', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        workflowType: 'triage',
        workItemId,
        repositoryMappingId: repoMappingId,
      },
    });
    const run = createRes.json();

    await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/transition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'dispatched' },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/transition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'running' },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/transition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'succeeded' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/workflow-runs/${run.id}/cancel?force=1`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
  });

  it('GET /v1/workflow-runs/:id/checkpoints returns the run checkpoint rows', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        workflowType: 'triage',
        workItemId,
        repositoryMappingId: repoMappingId,
      },
    });
    const run = createRes.json();

    const provider = await app.prisma.executionProvider.create({
      data: {
        tenantId: TEST_TENANT_ID,
        providerType: 'local-host',
        name: `Checkpoint Provider ${run.id}`,
        connectionMode: 'direct',
        maxConcurrency: 1,
      },
    });

    const dispatch = await app.prisma.workerDispatch.create({
      data: {
        workflowRunId: run.id,
        executionProviderId: provider.id,
        workerSharedSecret: `checkpoint-secret-${run.id}`,
        jobPayload: {},
        status: 'running',
      },
    });

    await app.prisma.dispatchAttemptCheckpoint.createMany({
      data: [
        {
          dispatchAttemptId: dispatch.id,
          kind: 'stage_complete',
          iteration: 1,
          stageId: 'investigate',
          payload: [],
        },
        {
          dispatchAttemptId: dispatch.id,
          kind: 'iteration_complete',
          iteration: 1,
          stageId: null,
          payload: [{ reportSummary: 'Iteration finished', loop: { done: false } }],
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/workflow-runs/${run.id}/checkpoints`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
    expect(res.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dispatchAttemptId: dispatch.id,
          kind: 'stage_complete',
          iteration: 1,
          stageId: 'investigate',
        }),
        expect.objectContaining({
          dispatchAttemptId: dispatch.id,
          kind: 'iteration_complete',
          iteration: 1,
        }),
      ]),
    );
  });

  it('POST /v1/runs/:id/retry retries a failed run and increments attemptNumber', async () => {
    // Create and transition to failed: queued -> dispatched -> running -> failed
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        workflowType: 'triage',
        workItemId,
        repositoryMappingId: repoMappingId,
      },
    });
    const run = createRes.json();

    await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/transition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'dispatched' },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/transition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'running' },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/transition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'failed' },
    });

    const retryRes = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(retryRes.statusCode).toBe(200);
    const retried = retryRes.json();
    expect(retried.status).toBe('queued');
    expect(retried.attemptNumber).toBe(2);
  });

  it('POST /v1/runs/:id/retry on a running run returns 409', async () => {
    // Create and transition to running: queued -> dispatched -> running
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        workflowType: 'triage',
        workItemId,
        repositoryMappingId: repoMappingId,
      },
    });
    const run = createRes.json();

    await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/transition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'dispatched' },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/transition`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'running' },
    });

    const retryRes = await app.inject({
      method: 'POST',
      url: `/v1/runs/${run.id}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(retryRes.statusCode).toBe(409);
  });
});
