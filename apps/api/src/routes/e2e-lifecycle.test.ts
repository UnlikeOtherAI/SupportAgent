import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { parseEnv } from '@support-agent/config';
import { type FastifyInstance } from 'fastify';

const TENANT_ID = 'e2e00000-0000-0000-0000-000000000001';
const JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
const CLEANUP_SQL = [
  `DELETE FROM outbound_delivery_attempts WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" = $1)`,
  `DELETE FROM outbound_destinations WHERE "tenantId" = $1`,
  `DELETE FROM findings WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" = $1)`,
  `DELETE FROM workflow_log_events WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" = $1)`,
  `DELETE FROM worker_dispatches WHERE "workflowRunId" IN (SELECT id FROM workflow_runs WHERE "tenantId" = $1)`,
  `DELETE FROM workflow_runs WHERE "tenantId" = $1`,
  `DELETE FROM inbound_work_items WHERE "connectorInstanceId" IN (SELECT id FROM connectors WHERE "tenantId" = $1)`,
  `DELETE FROM repository_mappings WHERE "tenantId" = $1`,
  `DELETE FROM connector_capabilities WHERE "connectorId" IN (SELECT id FROM connectors WHERE "tenantId" = $1)`,
  `DELETE FROM connectors WHERE "tenantId" = $1`,
  `DELETE FROM execution_providers WHERE "tenantId" = $1`,
] as const;

describe('E2E Lifecycle', () => {
  let app: FastifyInstance;
  let authToken: string;
  let platformTypeId: string;
  let connectorId: string;
  let mappingId: string;
  let workItemId: string;
  let workflowRunId: string;
  let dispatchId: string;
  let workerSecret: string;
  let findingId: string;
  let destinationId: string;
  let secondRunId: string;
  let retriedRunId: string;

  const auth = (token = authToken) => ({ authorization: `Bearer ${token}` });
  const workerAuth = (secret: string, extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${secret}`,
    ...extra,
  });
  const api = (method: string, url: string, payload?: unknown, headers?: Record<string, string>) =>
    app.inject({ method, url, payload, headers: { ...auth(), ...headers } });
  const worker = (
    method: string,
    url: string,
    secret: string,
    payload?: unknown,
    headers?: Record<string, string>,
  ) => app.inject({ method, url, payload, headers: workerAuth(secret, headers) });
  const cleanupTenant = async () => {
    for (const sql of CLEANUP_SQL) await app.prisma.$executeRawUnsafe(sql, TENANT_ID);
  };

  beforeAll(async () => {
    parseEnv({
      DATABASE_URL: 'postgresql://supportagent:supportagent@localhost:5432/supportagent_dev',
      JWT_SECRET,
      REDIS_URL: 'redis://localhost:6379',
    });
    app = await buildApp();
    await app.ready();
    authToken = app.jwt.sign({ sub: 'e2e-test-user', tenantId: TENANT_ID, role: 'admin' });
    await cleanupTenant();
    platformTypeId = (
      await app.prisma.platformType.upsert({
        where: { key: 'github' },
        update: {},
        create: {
          key: 'github',
          displayName: 'GitHub',
          supportsWebhook: true,
          supportsPolling: true,
          supportsInbound: true,
          supportsOutbound: true,
        },
      })
    ).id;
  });

  afterAll(async () => {
    try {
      for (const sql of CLEANUP_SQL) await app.prisma.$executeRawUnsafe(sql, TENANT_ID);
    } catch (e) {
      console.warn('E2E cleanup warning:', (e as Error).message);
    }
    await app.close();
  });

  describe('Phase 1: Health Check', () => {
    it('GET /health -> 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });
  });

  describe('Phase 2: Connector CRUD', () => {
    it('creates, lists, reads, updates, and discovers capabilities', async () => {
      const createRes = await api('POST', '/v1/connectors', {
        platformTypeId,
        name: 'E2E GitHub Connector',
        direction: 'both',
        configuredIntakeMode: 'webhook',
      });
      expect(createRes.statusCode).toBe(201);
      connectorId = createRes.json().id;

      const listRes = await api('GET', '/v1/connectors');
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().some((x: any) => x.id === connectorId)).toBe(true);

      const detailRes = await api('GET', `/v1/connectors/${connectorId}`);
      expect(detailRes.statusCode).toBe(200);
      expect(detailRes.json().name).toBe('E2E GitHub Connector');

      const updateRes = await api('PATCH', `/v1/connectors/${connectorId}`, {
        name: 'E2E GitHub Connector Updated',
      });
      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json().name).toBe('E2E GitHub Connector Updated');

      const discoverRes = await api('POST', `/v1/connectors/${connectorId}/capabilities/discover`);
      expect(discoverRes.statusCode).toBe(200);
      expect(discoverRes.json().length).toBeGreaterThan(0);

      const capsRes = await api('GET', `/v1/connectors/${connectorId}/capabilities`);
      expect(capsRes.statusCode).toBe(200);
      expect(capsRes.json().some((x: any) => x.capabilityKey === 'webhook_intake')).toBe(true);
    });
  });

  describe('Phase 3: Repository Mapping CRUD', () => {
    it('creates, lists, reads, and updates the mapping', async () => {
      const createRes = await api('POST', '/v1/repository-mappings', {
        connectorId,
        repositoryUrl: 'https://github.com/e2e-test/lifecycle-repo',
        defaultBranch: 'main',
      });
      expect(createRes.statusCode).toBe(201);
      mappingId = createRes.json().id;

      const listRes = await api('GET', '/v1/repository-mappings');
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().some((x: any) => x.id === mappingId)).toBe(true);

      const detailRes = await api('GET', `/v1/repository-mappings/${mappingId}`);
      expect(detailRes.statusCode).toBe(200);
      expect(detailRes.json().connector.id).toBe(connectorId);

      const updateRes = await api('PATCH', `/v1/repository-mappings/${mappingId}`, {
        defaultBranch: 'develop',
      });
      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json().defaultBranch).toBe('develop');
    });
  });

  describe('Phase 4: Webhook Intake', () => {
    it('creates a work item and marks the duplicate', async () => {
      const payload = JSON.stringify({
        action: 'opened',
        issue: {
          number: 9001,
          html_url: 'https://github.com/e2e-test/lifecycle-repo/issues/9001',
          title: 'E2E lifecycle test issue',
          body: 'Steps to reproduce the e2e bug...',
          state: 'open',
          labels: [{ name: 'bug' }],
        },
        repository: { full_name: 'e2e-test/lifecycle-repo' },
      });
      const headers = { 'content-type': 'application/json' };

      const firstRes = await app.inject({
        method: 'POST',
        url: `/webhooks/github/${connectorId}`,
        headers,
        payload,
      });
      expect(firstRes.statusCode).toBe(201);
      expect(firstRes.json().status).toBe('created');
      workItemId = firstRes.json().workItemId;
      workflowRunId = firstRes.json().workflowRunId;

      const secondRes = await app.inject({
        method: 'POST',
        url: `/webhooks/github/${connectorId}`,
        headers,
        payload,
      });
      expect(secondRes.statusCode).toBe(200);
      expect(secondRes.json()).toEqual({ status: 'duplicate', workItemId });
    });
  });

  describe('Phase 5: Workflow Run Management', () => {
    it('lists, reads, blocks, and re-queues the run', async () => {
      const listRes = await api('GET', '/v1/runs');
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().items.some((x: any) => x.id === workflowRunId && x.status === 'queued')).toBe(true);

      const detailRes = await api('GET', `/v1/runs/${workflowRunId}`);
      expect(detailRes.statusCode).toBe(200);
      expect(detailRes.json().workItem.id).toBe(workItemId);
      expect(detailRes.json().repositoryMapping.id).toBe(mappingId);

      const blockedRes = await api('POST', `/v1/runs/${workflowRunId}/transition`, {
        status: 'blocked',
        blockedReason: 'Waiting for approval',
      });
      expect(blockedRes.statusCode).toBe(200);
      expect(blockedRes.json().status).toBe('blocked');
      expect(blockedRes.json().blockedReason).toBe('Waiting for approval');

      const queuedRes = await api('POST', `/v1/runs/${workflowRunId}/transition`, { status: 'queued' });
      expect(queuedRes.statusCode).toBe(200);
      expect(queuedRes.json().status).toBe('queued');

      const verifyRes = await api('GET', `/v1/runs/${workflowRunId}`);
      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.json().status).toBe('queued');
    });
  });

  describe('Phase 6: Dispatcher', () => {
    it('requires admin role', async () => {
      const viewerToken = app.jwt.sign({ sub: 'viewer', tenantId: TENANT_ID, role: 'viewer' });
      const forbiddenRes = await app.inject({
        method: 'POST',
        url: '/v1/dispatcher/dispatch-next',
        headers: auth(viewerToken),
      });
      expect(forbiddenRes.statusCode).toBe(403);
    });

    it('dispatches queued runs and exposes worker secret in jobPayload', async () => {
      // dispatch-next grabs the first globally queued run; other test files
      // may leave queued rows too.  Loop until our run is dispatched or idle.
      let found = false;
      for (let i = 0; i < 20 && !found; i++) {
        const res = await api('POST', '/v1/dispatcher/dispatch-next');
        expect(res.statusCode).toBe(200);
        if (res.json().status === 'idle') break;
        if (res.json().workflowRunId === workflowRunId) {
          dispatchId = res.json().dispatchId;
          found = true;
        }
      }
      expect(found).toBe(true);

      const dispatch = await app.prisma.workerDispatch.findUnique({ where: { id: dispatchId } });
      workerSecret = (dispatch!.jobPayload as { workerSharedSecret: string }).workerSharedSecret;
      expect(workerSecret).toBeTruthy();
    });

    it('dispatch-all returns zero when no queued runs remain', async () => {
      const dispatchAllRes = await api('POST', '/v1/dispatcher/dispatch-all');
      expect(dispatchAllRes.statusCode).toBe(200);
      expect(dispatchAllRes.json().dispatched).toBe(0);
    });
  });

  describe('Phase 7: Worker API', () => {
    it('authenticates workers and accepts context, progress, logs, artifacts, and reports', async () => {
      expect((await app.inject({ method: 'GET', url: `/worker/jobs/${dispatchId}/context` })).statusCode).toBe(401);
      expect((await worker('GET', `/worker/jobs/${dispatchId}/context`, 'wrong-secret')).statusCode).toBe(401);

      const contextRes = await worker('GET', `/worker/jobs/${dispatchId}/context`, workerSecret);
      expect(contextRes.statusCode).toBe(200);
      expect(contextRes.json().workflowRunId).toBe(workflowRunId);
      expect(contextRes.json().workflowType).toBe('triage');
      expect(contextRes.json().targetRepo).toBe('https://github.com/e2e-test/lifecycle-repo');
      expect(contextRes.json().workItem.id).toBe(workItemId);
      expect(contextRes.json().repositoryMapping.id).toBe(mappingId);

      const progressRes = await worker(
        'POST',
        `/worker/jobs/${dispatchId}/progress`,
        workerSecret,
        { stage: 'clone', message: 'Cloning repository...' },
      );
      expect(progressRes.statusCode).toBe(204);
      expect((await app.prisma.workflowRun.findUnique({ where: { id: workflowRunId } }))?.currentStage).toBe('clone');
      expect(
        (
          await app.prisma.workflowLogEvent.findFirst({
            where: { workflowRunId, streamType: 'progress', stage: 'clone' },
          })
        )?.message,
      ).toBe('Cloning repository...');

      const logsRes = await worker(
        'POST',
        `/worker/jobs/${dispatchId}/logs`,
        workerSecret,
        { streamType: 'stdout', message: 'npm install completed', stage: 'setup' },
      );
      expect(logsRes.statusCode).toBe(204);
      expect(
        (
          await app.prisma.workflowLogEvent.findFirst({
            where: { workflowRunId, streamType: 'stdout', stage: 'setup' },
          })
        )?.message,
      ).toBe('npm install completed');

      const artifactRes = await worker(
        'POST',
        `/worker/jobs/${dispatchId}/artifacts`,
        workerSecret,
        Buffer.from('test artifact content'),
        { 'x-artifact-name': 'test-output.log', 'content-type': 'application/octet-stream' },
      );
      expect(artifactRes.statusCode).toBe(200);
      expect(artifactRes.json()).toEqual({ artifactRef: `artifacts/${workflowRunId}/test-output.log` });

      const reportRes = await worker(
        'POST',
        `/worker/jobs/${dispatchId}/report`,
        workerSecret,
        {
          status: 'succeeded',
          summary: 'E2E triage completed',
          stageResults: [{ stage: 'clone', status: 'passed', durationMs: 500 }],
        },
      );
      expect(reportRes.statusCode).toBe(200);
      expect(reportRes.json()).toEqual({ status: 'accepted' });
      const run = await app.prisma.workflowRun.findUnique({ where: { id: workflowRunId } });
      expect(run?.status).toBe('succeeded');
      expect(run?.completedAt).toBeTruthy();
    });
  });

  describe('Phase 8: Findings', () => {
    it('creates and reads findings for the run', async () => {
      const createRes = await api('POST', `/v1/runs/${workflowRunId}/findings`, {
        summary: 'Null pointer in handleRequest',
        rootCauseHypothesis: 'Missing null check',
        confidence: 0.85,
        reproductionStatus: 'reproduced',
        affectedAreas: ['api'],
        suspectFiles: ['src/handlers/request.ts'],
        userVisibleImpact: 'Crashes on login',
      });
      expect(createRes.statusCode).toBe(201);
      findingId = createRes.json().id;

      const listRes = await api('GET', `/v1/runs/${workflowRunId}/findings`);
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().some((x: any) => x.id === findingId)).toBe(true);

      const detailRes = await api('GET', `/v1/findings/${findingId}`);
      expect(detailRes.statusCode).toBe(200);
      expect(detailRes.json().workflowRun.id).toBe(workflowRunId);
    });
  });

  describe('Phase 9: Outbound Destinations & Delivery', () => {
    it('creates a destination, attempts delivery, and lists attempts', async () => {
      const createRes = await api('POST', '/v1/outbound-destinations', {
        name: 'E2E Webhook',
        destinationType: 'webhook',
        config: { url: 'https://httpbin.org/post' },
        isActive: true,
      });
      expect(createRes.statusCode).toBe(201);
      destinationId = createRes.json().id;

      expect((await api('GET', '/v1/outbound-destinations')).json().some((x: any) => x.id === destinationId)).toBe(true);
      expect((await api('GET', `/v1/outbound-destinations/${destinationId}`)).json().id).toBe(destinationId);

      const updateRes = await api('PATCH', `/v1/outbound-destinations/${destinationId}`, {
        name: 'E2E Webhook Updated',
      });
      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json().name).toBe('E2E Webhook Updated');

      const deliverRes = await api('POST', `/v1/outbound-destinations/${destinationId}/deliver`, {
        workflowRunId,
        findingId,
      });
      expect(deliverRes.statusCode).toBe(200);
      expect(deliverRes.json().workflowRunId).toBe(workflowRunId);
      expect(deliverRes.json().findingId).toBe(findingId);
      expect(['sent', 'failed']).toContain(deliverRes.json().status);

      const attemptsRes = await api('GET', `/v1/runs/${workflowRunId}/delivery-attempts`);
      expect(attemptsRes.statusCode).toBe(200);
      expect(attemptsRes.json().some((x: any) => x.outboundDestinationId === destinationId && x.findingId === findingId)).toBe(true);
    });
  });

  describe('Phase 10: Create Run via API + Cancel/Retry', () => {
    it('creates a run, cancels one, and retries a failed one', async () => {
      const createRes = await api('POST', '/v1/runs', {
        workflowType: 'triage',
        workItemId,
        repositoryMappingId: mappingId,
      });
      expect(createRes.statusCode).toBe(201);
      secondRunId = createRes.json().id;

      const cancelRes = await api('POST', `/v1/runs/${secondRunId}/cancel`);
      expect(cancelRes.statusCode).toBe(200);
      expect(cancelRes.json().status).toBe('canceled');

      const retrySourceRes = await api('POST', '/v1/runs', {
        workflowType: 'triage',
        workItemId,
        repositoryMappingId: mappingId,
      });
      expect(retrySourceRes.statusCode).toBe(201);
      const retrySourceId = retrySourceRes.json().id;

      for (const status of ['dispatched', 'running', 'failed']) {
        const transitionRes = await api('POST', `/v1/runs/${retrySourceId}/transition`, { status });
        expect(transitionRes.statusCode).toBe(200);
      }

      const retryRes = await api('POST', `/v1/runs/${retrySourceId}/retry`);
      expect(retryRes.statusCode).toBe(200);
      expect(retryRes.json().status).toBe('queued');
      retriedRunId = retryRes.json().id;
      expect(retriedRunId).toBeTruthy();
    });
  });

  describe('Phase 11: Auth Edge Cases', () => {
    it('rejects missing JWTs on protected routes', async () => {
      expect((await app.inject({ method: 'GET', url: '/v1/connectors' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/v1/runs' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/v1/outbound-destinations' })).statusCode).toBe(401);
    });
  });

  describe('Phase 12: Cleanup via API', () => {
    it('cannot delete destination with delivery attempts (FK constraint)', async () => {
      const res = await api('DELETE', `/v1/outbound-destinations/${destinationId}`);
      expect(res.statusCode).toBe(500);
    });
  });
});
