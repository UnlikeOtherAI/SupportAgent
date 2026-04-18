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
  let sameTenantSiblingWorkflowRunId: string;
  let otherTenantConnectorId: string;
  let otherTenantRepoMappingId: string;
  let otherTenantWorkItemId: string;
  let otherTenantWorkflowRunId: string;
  let otherTenantDispatchId: string;

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

    const sameTenantSiblingRun = await app.prisma.workflowRun.create({
      data: {
        tenantId: TEST_TENANT_ID,
        workflowType: 'triage',
        status: 'running',
        workItemId,
        repositoryMappingId: repoMappingId,
        startedAt: new Date(),
      },
    });
    sameTenantSiblingWorkflowRunId = sameTenantSiblingRun.id;

    const otherTenantId = 'c0000000-0000-0000-0000-000000000099';
    const otherConnector = await app.prisma.connector.create({
      data: {
        tenantId: otherTenantId,
        platformTypeId: pt.id,
        name: 'Other Tenant Worker Connector',
        direction: 'inbound',
        configuredIntakeMode: 'webhook',
        effectiveIntakeMode: 'webhook',
      },
    });
    otherTenantConnectorId = otherConnector.id;

    const otherRepoMapping = await app.prisma.repositoryMapping.create({
      data: {
        tenantId: otherTenantId,
        connectorId: otherTenantConnectorId,
        repositoryUrl: 'https://github.com/test/other-worker-repo',
        defaultBranch: 'main',
      },
    });
    otherTenantRepoMappingId = otherRepoMapping.id;

    const otherWorkItem = await app.prisma.inboundWorkItem.create({
      data: {
        connectorInstanceId: otherTenantConnectorId,
        platformType: 'test-worker-api',
        workItemKind: 'issue',
        externalItemId: 'WORKER-TEST-2',
        title: 'Other tenant work item',
        repositoryMappingId: otherTenantRepoMappingId,
      },
    });
    otherTenantWorkItemId = otherWorkItem.id;

    const otherRun = await app.prisma.workflowRun.create({
      data: {
        tenantId: otherTenantId,
        workflowType: 'triage',
        status: 'running',
        workItemId: otherTenantWorkItemId,
        repositoryMappingId: otherTenantRepoMappingId,
        startedAt: new Date(),
      },
    });
    otherTenantWorkflowRunId = otherRun.id;

    const otherDispatch = await app.prisma.workerDispatch.create({
      data: {
        workflowRunId: otherTenantWorkflowRunId,
        executionProviderId,
        workerSharedSecret: 'worker-test-secret-other-456',
        jobPayload: { type: 'triage' },
        status: 'running',
        attemptNumber: 1,
      },
    });
    otherTenantDispatchId = otherDispatch.id;

    await app.prisma.workflowRun.update({
      where: { id: otherTenantWorkflowRunId },
      data: { acceptedDispatchAttempt: otherTenantDispatchId },
    });
  });

  afterAll(async () => {
    try {
      // Clean up in strict FK-safe order using raw SQL to avoid constraint issues
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM action_delivery_attempts WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" IN ($1, $2))`,
        TEST_TENANT_ID,
        'c0000000-0000-0000-0000-000000000099',
      );
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM action_outputs WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" IN ($1, $2))`,
        TEST_TENANT_ID,
        'c0000000-0000-0000-0000-000000000099',
      );
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM findings WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" IN ($1, $2))`,
        TEST_TENANT_ID,
        'c0000000-0000-0000-0000-000000000099',
      );
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM workflow_run_iterations WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" IN ($1, $2))`,
        TEST_TENANT_ID,
        'c0000000-0000-0000-0000-000000000099',
      );
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM dispatch_attempt_checkpoints WHERE "dispatchAttemptId" IN (SELECT id FROM worker_dispatches WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" = $1))`,
        TEST_TENANT_ID,
      );
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM dispatch_attempt_checkpoints WHERE "dispatchAttemptId" IN (SELECT id FROM worker_dispatches WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" = $1))`,
        'c0000000-0000-0000-0000-000000000099',
      );
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM workflow_log_events WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" = $1)`,
        TEST_TENANT_ID,
      );
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM workflow_log_events WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" = $1)`,
        'c0000000-0000-0000-0000-000000000099',
      );
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM worker_dispatches WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" = $1)`,
        TEST_TENANT_ID,
      );
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM worker_dispatches WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" = $1)`,
        'c0000000-0000-0000-0000-000000000099',
      );
      await app.prisma.$executeRawUnsafe(`DELETE FROM workflow_runs WHERE "tenantId" = $1`, TEST_TENANT_ID);
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM workflow_runs WHERE "tenantId" = $1`,
        'c0000000-0000-0000-0000-000000000099',
      );
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM inbound_work_items WHERE "connectorInstanceId" IN (SELECT id FROM connectors WHERE "tenantId" = $1)`,
        TEST_TENANT_ID,
      );
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM inbound_work_items WHERE "connectorInstanceId" IN (SELECT id FROM connectors WHERE "tenantId" = $1)`,
        'c0000000-0000-0000-0000-000000000099',
      );
      await app.prisma.$executeRawUnsafe(`DELETE FROM repository_mappings WHERE "tenantId" = $1`, TEST_TENANT_ID);
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM repository_mappings WHERE "tenantId" = $1`,
        'c0000000-0000-0000-0000-000000000099',
      );
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM connector_capabilities WHERE "connectorId" IN (SELECT id FROM connectors WHERE "tenantId" = $1)`,
        TEST_TENANT_ID,
      );
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM connector_capabilities WHERE "connectorId" IN (SELECT id FROM connectors WHERE "tenantId" = $1)`,
        'c0000000-0000-0000-0000-000000000099',
      );
      await app.prisma.$executeRawUnsafe(`DELETE FROM connectors WHERE "tenantId" = $1`, TEST_TENANT_ID);
      await app.prisma.$executeRawUnsafe(
        `DELETE FROM connectors WHERE "tenantId" = $1`,
        'c0000000-0000-0000-0000-000000000099',
      );
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

  it('POST /v1/workflow-runs/:runId/progress-comment accepts worker-authenticated updates', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workflow-runs/${workflowRunId}/progress-comment`,
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
      payload: { body: 'Still working...' },
    });

    expect(res.statusCode).toBe(204);
  });

  it('POST /v1/workflow-runs/:runId/iterations stores iteration state', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workflow-runs/${workflowRunId}/iterations`,
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
      payload: {
        iteration: 1,
        stages: {
          investigate: {
            spawn_outputs: [
              {
                delivery: [],
                reportSummary: 'Iteration output',
              },
            ],
          },
        },
      },
    });

    expect(res.statusCode).toBe(204);

    const iteration = await app.prisma.workflowRunIteration.findFirst({
      where: { workflowRunId, iteration: 1 },
    });
    expect(iteration?.stages).toEqual({
      investigate: {
        spawn_outputs: [
          {
            delivery: [],
            reportSummary: 'Iteration output',
          },
        ],
      },
    });
  });

  it('POST /v1/workflow-runs/:runId/iterations rejects cross-tenant writes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workflow-runs/${otherTenantWorkflowRunId}/iterations`,
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
      payload: {
        iteration: 1,
        stages: {},
      },
    });

    expect(res.statusCode).toBe(403);
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

  it('POST /v1/dispatch-attempts/:id/checkpoints appends a checkpoint row', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/dispatch-attempts/${dispatchId}/checkpoints`,
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
      payload: {
        kind: 'stage_complete',
        stageId: 'investigate',
        payload: [
          {
            delivery: [{ kind: 'comment', body: 'checkpoint body' }],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(204);

    const checkpoints = await app.prisma.dispatchAttemptCheckpoint.findMany({
      where: { dispatchAttemptId: dispatchId },
      orderBy: { createdAt: 'asc' },
    });
    expect(checkpoints.at(-1)?.kind).toBe('stage_complete');
    expect(checkpoints.at(-1)?.stageId).toBe('investigate');
  });

  it('POST /:jobId/report accepts canceled reports with leaf outputs', async () => {
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

    const canceledDispatch = await app.prisma.workerDispatch.create({
      data: {
        workflowRunId: run.id,
        executionProviderId,
        workerSharedSecret: 'worker-test-secret-canceled-321',
        jobPayload: { type: 'triage' },
        status: 'running',
        attemptNumber: 1,
      },
    });

    await app.prisma.workflowRun.update({
      where: { id: run.id },
      data: { acceptedDispatchAttempt: canceledDispatch.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/worker/jobs/${canceledDispatch.id}/report`,
      headers: { authorization: 'Bearer worker-test-secret-canceled-321' },
      payload: {
        status: 'canceled',
        summary: 'Canceled after first iteration',
        leafOutputs: [
          {
            delivery: [{ kind: 'comment', body: 'partial output' }],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);

    const updatedRun = await app.prisma.workflowRun.findUnique({
      where: { id: run.id },
    });
    expect(updatedRun?.status).toBe('canceled');
  });

  it('POST /:jobId/report synthesizes comment delivery and writes findings rows', async () => {
    const numericWorkItem = await app.prisma.inboundWorkItem.create({
      data: {
        connectorInstanceId: connectorId,
        platformType: 'test-worker-api',
        workItemKind: 'issue',
        externalItemId: '123',
        title: 'Numeric work item',
        repositoryMappingId: repoMappingId,
      },
    });

    const run = await app.prisma.workflowRun.create({
      data: {
        tenantId: TEST_TENANT_ID,
        workflowType: 'triage',
        status: 'running',
        workItemId: numericWorkItem.id,
        repositoryMappingId: repoMappingId,
        startedAt: new Date(),
      },
    });

    const findingsDispatch = await app.prisma.workerDispatch.create({
      data: {
        workflowRunId: run.id,
        executionProviderId,
        workerSharedSecret: 'worker-test-secret-findings-654',
        jobPayload: { type: 'triage' },
        status: 'running',
        attemptNumber: 1,
      },
    });

    await app.prisma.workflowRun.update({
      where: { id: run.id },
      data: { acceptedDispatchAttempt: findingsDispatch.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/worker/jobs/${findingsDispatch.id}/report`,
      headers: { authorization: 'Bearer worker-test-secret-findings-654' },
      payload: {
        status: 'succeeded',
        summary: 'Triage completed successfully',
        leafOutputs: [
          {
            delivery: [],
            findings: {
              summary: 'Issue summary',
              rootCause: 'Likely code path',
              reproductionSteps: '1. Reproduce',
              proposedFix: '1. Fix',
              affectedAreas: ['src/example.ts'],
              severity: 'high',
              confidence: 'medium',
              custom: {
                severityJustification: 'Breaks core flow',
                confidenceReason: 'Stack trace matches',
                logsExcerpt: 'error stack',
                sources: ['src/example.ts'],
              },
            },
            reportSummary: 'Issue summary',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);

    const findingRows = await app.prisma.finding.findMany({
      where: { workflowRunId: run.id },
    });
    expect(findingRows).toHaveLength(1);
    expect(findingRows[0].summary).toBe('Issue summary');

    const actionOutputs = await app.prisma.actionOutput.findMany({
      where: { workflowRunId: run.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(actionOutputs).toHaveLength(1);
    expect(actionOutputs[0].outputType).toBe('comment');
    expect(actionOutputs[0].payload).toMatchObject({
      kind: 'comment',
      body: expect.stringContaining('## Summary'),
    });
  });

  it('GET /worker/jobs/run/:runId returns 403 for a run in another tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/worker/jobs/run/${otherTenantWorkflowRunId}`,
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('GET /worker/jobs/run/:runId returns 403 for a different run in the same tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/worker/jobs/run/${sameTenantSiblingWorkflowRunId}`,
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('GET /worker/jobs/run/:runId returns 200 for the owning run', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/worker/jobs/run/${workflowRunId}`,
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(workflowRunId);
  });
});
