import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { parseEnv } from '@support-agent/config';
import { type FastifyInstance } from 'fastify';

const TEST_TENANT_ID = 'c0000000-0000-0000-0000-000000000001';
const JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
const WORKER_SECRET = 'worker-test-secret-abc123';
const STALE_WORKER_SECRET = 'worker-test-secret-stale-999';

describe('Worker API routes', () => {
  let app: FastifyInstance;
  let connectorId: string;
  let repoMappingId: string;
  let workItemId: string;
  let workflowRunId: string;
  let dispatchId: string;
  let executionProviderId: string;
  let staleDispatchId: string;

  beforeAll(async () => {
    parseEnv({
      DATABASE_URL: 'postgresql://supportagent:supportagent@localhost:5432/supportagent_dev',
      JWT_SECRET,
      REDIS_URL: 'redis://localhost:6379',
    });
    app = await buildApp();
    await app.ready();

    // Create fixture: platformType -> connector -> repoMapping -> workItem -> workflowRun -> executionProvider -> dispatch
    const pt = await app.prisma.platformType.upsert({
      where: { key: 'test-worker-api' },
      update: {},
      create: {
        key: 'test-worker-api',
        displayName: 'Test Worker API Platform',
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
        name: 'Test Worker Connector',
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
        repositoryUrl: 'https://github.com/test/worker-repo',
        defaultBranch: 'main',
      },
    });
    repoMappingId = repoMapping.id;

    const workItem = await app.prisma.inboundWorkItem.create({
      data: {
        connectorInstanceId: connectorId,
        platformType: 'test-worker-api',
        workItemKind: 'issue',
        externalItemId: 'WORKER-TEST-1',
        title: 'Test work item for worker API',
        repositoryMappingId: repoMappingId,
      },
    });
    workItemId = workItem.id;

    const provider = await app.prisma.executionProvider.create({
      data: {
        tenantId: TEST_TENANT_ID,
        providerType: 'local',
        name: 'Test Provider',
        isEnabled: true,
        connectionMode: 'direct',
        maxConcurrency: 2,
      },
    });
    executionProviderId = provider.id;

    const run = await app.prisma.workflowRun.create({
      data: {
        tenantId: TEST_TENANT_ID,
        workflowType: 'triage',
        status: 'running',
        workItemId,
        repositoryMappingId: repoMappingId,
        startedAt: new Date(),
      },
    });
    workflowRunId = run.id;

    const dispatch = await app.prisma.workerDispatch.create({
      data: {
        workflowRunId,
        executionProviderId,
        workerSharedSecret: WORKER_SECRET,
        jobPayload: { type: 'triage' },
        status: 'running',
        attemptNumber: 1,
      },
    });
    dispatchId = dispatch.id;

    // Set accepted dispatch on the run
    await app.prisma.workflowRun.update({
      where: { id: workflowRunId },
      data: { acceptedDispatchAttempt: dispatchId },
    });

    // Create a stale dispatch for 403 test
    const staleDispatch = await app.prisma.workerDispatch.create({
      data: {
        workflowRunId,
        executionProviderId,
        workerSharedSecret: STALE_WORKER_SECRET,
        jobPayload: { type: 'triage' },
        status: 'superseded',
        attemptNumber: 0,
      },
    });
    staleDispatchId = staleDispatch.id;
  });

  afterAll(async () => {
    try {
      // Clean up in strict FK-safe order using raw SQL to avoid constraint issues
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
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM connector_capabilities WHERE "connectorId" IN (SELECT id FROM connectors WHERE "tenantId" = $1)`,
        TEST_TENANT_ID,
      );
      await app.prisma.$executeRawUnsafe(`DELETE FROM connectors WHERE "tenantId" = $1`, TEST_TENANT_ID);
      await app.prisma.$executeRawUnsafe(`DELETE FROM execution_providers WHERE "tenantId" = $1`, TEST_TENANT_ID);
      await app.prisma.platformType.deleteMany({ where: { key: 'test-worker-api' } });
    } catch (e) {
      console.warn('Cleanup warning:', (e as Error).message);
    }
    await app.close();
  });

  it('returns 401 without auth header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/worker/jobs/${dispatchId}/context`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with invalid secret', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/worker/jobs/${dispatchId}/context`,
      headers: { authorization: 'Bearer totally-invalid-secret' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 with stale dispatch attempt', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/worker/jobs/${staleDispatchId}/context`,
      headers: { authorization: `Bearer ${STALE_WORKER_SECRET}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /:jobId/context returns job info', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/worker/jobs/${dispatchId}/context`,
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.workflowRunId).toBe(workflowRunId);
    expect(body.workflowType).toBe('triage');
    expect(body.targetRepo).toBe('https://github.com/test/worker-repo');
    expect(body.targetBranch).toBe('main');
    expect(body.workItem).toBeTruthy();
    expect(body.repositoryMapping).toBeTruthy();
  });

  it('POST /:jobId/progress updates stage and creates log event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/worker/jobs/${dispatchId}/progress`,
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
      payload: { stage: 'clone', message: 'Cloning repository' },
    });
    expect(res.statusCode).toBe(204);

    // Verify the run's currentStage was updated
    const run = await app.prisma.workflowRun.findUnique({
      where: { id: workflowRunId },
    });
    expect(run?.currentStage).toBe('clone');

    // Verify a log event was created
    const logs = await app.prisma.workflowLogEvent.findMany({
      where: { workflowRunId, streamType: 'progress', stage: 'clone' },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].message).toBe('Cloning repository');
  });

  it('POST /:jobId/logs creates log event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/worker/jobs/${dispatchId}/logs`,
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
      payload: { streamType: 'stdout', message: 'npm install completed', stage: 'setup' },
    });
    expect(res.statusCode).toBe(204);

    const logs = await app.prisma.workflowLogEvent.findMany({
      where: { workflowRunId, streamType: 'stdout', stage: 'setup' },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].message).toBe('npm install completed');
  });

  it('POST /:jobId/report updates run status to succeeded', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/worker/jobs/${dispatchId}/report`,
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
      payload: {
        status: 'succeeded',
        summary: 'Triage completed successfully',
        stageResults: [
          { stage: 'clone', status: 'passed', summary: 'Cloned OK', durationMs: 1200 },
          { stage: 'analyze', status: 'passed', durationMs: 3400 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'accepted' });

    const run = await app.prisma.workflowRun.findUnique({
      where: { id: workflowRunId },
    });
    expect(run?.status).toBe('succeeded');
    expect(run?.completedAt).toBeTruthy();

    // Verify report log event
    const logs = await app.prisma.workflowLogEvent.findMany({
      where: { workflowRunId, streamType: 'report', stage: 'final' },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].message).toBe('Triage completed successfully');
  });
});
