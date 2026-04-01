import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { parseEnv } from '@support-agent/config';
import { createDispatcherService } from './dispatcher-service.js';
import { createLocalHostProvider } from './execution-provider.js';

describe('DispatcherService', () => {
  const prisma = new PrismaClient();
  const dispatched: unknown[] = [];
  const tenantId = '00000000-0000-0000-0000-000000000099';

  const fakeEnqueue = async (_name: string, payload: unknown) => {
    dispatched.push(payload);
    return 'fake-job-' + dispatched.length;
  };

  const localProvider = createLocalHostProvider(fakeEnqueue);
  const dispatcher = createDispatcherService(prisma, [localProvider], 'http://localhost:3001');

  let connectorId: string;
  let repoMappingId: string;
  let workItemId: string;

  beforeAll(async () => {
    parseEnv({
      DATABASE_URL: 'postgresql://supportagent:supportagent@localhost:5432/supportagent_dev',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      REDIS_URL: 'redis://localhost:6379',
    });

    // Create fixture data
    const pt = await prisma.platformType.findFirst({ where: { key: 'github' } });
    const connector = await prisma.connector.create({
      data: {
        tenantId,
        platformTypeId: pt!.id,
        name: 'dispatcher-test',
        direction: 'inbound',
        configuredIntakeMode: 'webhook',
        effectiveIntakeMode: 'webhook',
        isEnabled: true,
      },
    });
    connectorId = connector.id;

    const mapping = await prisma.repositoryMapping.create({
      data: {
        tenantId,
        connectorId,
        repositoryUrl: 'https://github.com/test/repo',
        defaultBranch: 'main',
      },
    });
    repoMappingId = mapping.id;

    const item = await prisma.inboundWorkItem.create({
      data: {
        connectorInstanceId: connectorId,
        platformType: 'github',
        workItemKind: 'issue',
        externalItemId: '999',
        title: 'Dispatch test issue',
        dedupeKey: 'dispatcher-test-999',
      },
    });
    workItemId = item.id;
  });

  afterAll(async () => {
    await prisma.workerDispatch.deleteMany({ where: { workflowRun: { tenantId } } });
    await prisma.workflowRun.deleteMany({ where: { tenantId } });
    await prisma.inboundWorkItem.deleteMany({ where: { connectorInstanceId: connectorId } });
    await prisma.repositoryMapping.deleteMany({ where: { tenantId } });
    await prisma.connector.deleteMany({ where: { tenantId } });
    await prisma.executionProvider.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
  });

  it('returns null when no queued runs', async () => {
    const result = await dispatcher.dispatchNext();
    expect(result).toBeNull();
  });

  it('dispatches a queued run', async () => {
    // Create a queued run
    await prisma.workflowRun.create({
      data: {
        tenantId,
        workflowType: 'triage',
        status: 'queued',
        workItemId,
        repositoryMappingId: repoMappingId,
      },
    });

    const result = await dispatcher.dispatchNext();
    expect(result).not.toBeNull();
    expect(result!.workflowRunId).toBeTruthy();
    expect(result!.dispatchId).toBeTruthy();

    // Verify run transitioned to running
    const run = await prisma.workflowRun.findUnique({
      where: { id: result!.workflowRunId },
    });
    expect(run!.status).toBe('running');
    expect(run!.acceptedDispatchAttempt).toBe(result!.dispatchId);

    // Verify dispatch record
    const dispatch = await prisma.workerDispatch.findUnique({
      where: { id: result!.dispatchId },
    });
    expect(dispatch!.workerSharedSecret).toBeTruthy();
    expect(dispatch!.status).toBe('running');

    // Verify job was enqueued
    expect(dispatched.length).toBeGreaterThan(0);
  });

  it('dispatchAll dispatches multiple queued runs', async () => {
    // Create 2 queued runs
    for (let i = 0; i < 2; i++) {
      const item = await prisma.inboundWorkItem.create({
        data: {
          connectorInstanceId: connectorId,
          platformType: 'github',
          workItemKind: 'issue',
          externalItemId: `batch-${i}`,
          title: `Batch test ${i}`,
          dedupeKey: `batch-test-${i}-${Date.now()}`,
        },
      });
      await prisma.workflowRun.create({
        data: {
          tenantId,
          workflowType: 'triage',
          status: 'queued',
          workItemId: item.id,
          repositoryMappingId: repoMappingId,
        },
      });
    }

    const count = await dispatcher.dispatchAll();
    expect(count).toBe(2);
  });
});
