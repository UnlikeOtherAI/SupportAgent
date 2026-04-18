import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '@support-agent/config';
import { parseExecutorYaml } from '@support-agent/executors-runtime';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';

const TEST_TENANT_ID = 'd0000000-0000-0000-0000-000000000001';
const OTHER_TENANT_ID = 'd0000000-0000-0000-0000-000000000099';
const WORKER_SECRET = 'worker-fetch-secret-abc123';

describe('Worker fetch routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    parseEnv({
      DATABASE_URL: 'postgresql://supportagent:supportagent@localhost:5432/supportagent_dev',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      REDIS_URL: 'redis://localhost:6379',
    });

    app = await buildApp();
    await app.ready();

    const platformType = await app.prisma.platformType.upsert({
      where: { key: 'test-worker-fetch' },
      update: {},
      create: {
        key: 'test-worker-fetch',
        displayName: 'Test Worker Fetch Platform',
        supportsWebhook: true,
        supportsPolling: false,
        supportsInbound: true,
        supportsOutbound: false,
      },
    });

    const connector = await app.prisma.connector.create({
      data: {
        tenantId: TEST_TENANT_ID,
        platformTypeId: platformType.id,
        name: 'Test Worker Fetch Connector',
        direction: 'inbound',
        configuredIntakeMode: 'webhook',
        effectiveIntakeMode: 'webhook',
      },
    });

    const repositoryMapping = await app.prisma.repositoryMapping.create({
      data: {
        tenantId: TEST_TENANT_ID,
        connectorId: connector.id,
        repositoryUrl: 'https://github.com/test/fetch-repo',
        defaultBranch: 'main',
      },
    });

    const workItem = await app.prisma.inboundWorkItem.create({
      data: {
        connectorInstanceId: connector.id,
        platformType: 'test-worker-fetch',
        workItemKind: 'issue',
        externalItemId: '101',
        title: 'Fetch test work item',
        repositoryMappingId: repositoryMapping.id,
      },
    });

    const executionProvider = await app.prisma.executionProvider.create({
      data: {
        tenantId: TEST_TENANT_ID,
        providerType: 'local-host',
        name: 'Fetch Test Provider',
        isEnabled: true,
        connectionMode: 'direct',
        maxConcurrency: 1,
      },
    });

    const workflowRun = await app.prisma.workflowRun.create({
      data: {
        tenantId: TEST_TENANT_ID,
        workflowType: 'triage',
        status: 'running',
        workItemId: workItem.id,
        repositoryMappingId: repositoryMapping.id,
        startedAt: new Date(),
      },
    });

    const yaml = `version: 1
key: triage-default
display_name: "Default triage"
preamble: "Use file:line citations."
stages:
  - id: investigate
    parallel: 1
    system_skill: triage-issue
    complementary: []
    executor: max
    after: []
    inputs_from: []
    task_prompt: "Investigate the issue"
loop:
  enabled: false
  max_iterations: 1
  until_done: false
`;

    await app.prisma.executor.create({
      data: {
        tenantId: TEST_TENANT_ID,
        key: 'triage-default',
        description: 'Fetch test executor',
        yaml,
        parsed: parseExecutorYaml(yaml),
        contentHash: 'executor-hash-1',
        source: 'USER',
      },
    });

    await app.prisma.executor.create({
      data: {
        tenantId: OTHER_TENANT_ID,
        key: 'triage-default',
        description: 'Other tenant executor',
        yaml,
        parsed: parseExecutorYaml(yaml),
        contentHash: 'executor-hash-other-1',
        source: 'USER',
      },
    });

    await app.prisma.skill.create({
      data: {
        tenantId: TEST_TENANT_ID,
        name: 'triage-issue',
        role: 'SYSTEM',
        description: 'Fetch test skill',
        body: '# Triage issue\nReturn JSON.',
        outputSchema: {
          type: 'object',
          properties: {
            delivery: { type: 'array' },
          },
          required: ['delivery'],
        },
        contentHash: 'skill-hash-1',
        source: 'USER',
      },
    });

    await app.prisma.skill.create({
      data: {
        tenantId: OTHER_TENANT_ID,
        name: 'triage-issue',
        role: 'SYSTEM',
        description: 'Other tenant skill',
        body: '# Triage issue\nReturn JSON.',
        outputSchema: {
          type: 'object',
          properties: {
            delivery: { type: 'array' },
          },
          required: ['delivery'],
        },
        contentHash: 'skill-hash-other-1',
        source: 'USER',
      },
    });

    const dispatch = await app.prisma.workerDispatch.create({
      data: {
        workflowRunId: workflowRun.id,
        executionProviderId: executionProvider.id,
        workerSharedSecret: WORKER_SECRET,
        jobPayload: {},
        status: 'running',
        attemptNumber: 1,
      },
    });

    await app.prisma.workflowRun.update({
      where: { id: workflowRun.id },
      data: { acceptedDispatchAttempt: dispatch.id },
    });
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
      await app.prisma.skill.deleteMany({ where: { tenantId: TEST_TENANT_ID } });
      await app.prisma.executor.deleteMany({ where: { tenantId: TEST_TENANT_ID } });
      await app.prisma.skill.deleteMany({ where: { tenantId: OTHER_TENANT_ID } });
      await app.prisma.executor.deleteMany({ where: { tenantId: OTHER_TENANT_ID } });
      await app.prisma.platformType.deleteMany({ where: { key: 'test-worker-fetch' } });
    } finally {
      await app.close();
    }
  });

  it('returns the pinned executor body for the requested hash', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/executors/triage-default/by-hash/executor-hash-1',
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      key: 'triage-default',
      contentHash: 'executor-hash-1',
    });
    expect(res.json().contentHash).toBe('executor-hash-1');
  });

  it('returns 404 for executor hash mismatch', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/executors/triage-default/by-hash/wrong-hash',
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the requested executor hash only exists in another tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/executors/triage-default/by-hash/executor-hash-other-1',
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns the pinned skill body for the requested hash', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/skills/triage-issue/by-hash/skill-hash-1',
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      name: 'triage-issue',
      contentHash: 'skill-hash-1',
      role: 'SYSTEM',
    });
    expect(res.json().contentHash).toBe('skill-hash-1');
  });

  it('returns 404 for skill hash mismatch', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/skills/triage-issue/by-hash/wrong-hash',
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the requested skill hash only exists in another tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/skills/triage-issue/by-hash/skill-hash-other-1',
      headers: { authorization: `Bearer ${WORKER_SECRET}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 with bad worker auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/executors/triage-default/by-hash/executor-hash-1',
      headers: { authorization: 'Bearer wrong-worker-secret' },
    });

    expect(res.statusCode).toBe(401);
  });
});
