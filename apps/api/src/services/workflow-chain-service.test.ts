import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { parseEnv } from '@support-agent/config';
import { createWorkflowChainService } from './workflow-chain-service.js';

describe('WorkflowChainService — chainBuildToMerge gating', () => {
  const prisma = new PrismaClient();
  const tenantId = '00000000-0000-0000-0000-000000000088';

  let connectorId: string;
  let repoMappingId: string;
  let workItemId: string;
  let executionProviderId: string;

  const chain = createWorkflowChainService(prisma);

  // Track all workflow runs and dispatches created in each test for targeted teardown
  const createdRunIds: string[] = [];
  const createdDispatchIds: string[] = [];

  async function createBuildRun(prRef: string): Promise<string> {
    const run = await prisma.workflowRun.create({
      data: {
        tenantId,
        workflowType: 'build',
        status: 'succeeded',
        workItemId,
        repositoryMappingId: repoMappingId,
        providerExecutionRef: prRef,
      },
    });
    createdRunIds.push(run.id);
    return run.id;
  }

  async function createDispatchFor(
    buildRunId: string,
    autoMergeOnSuccess?: boolean,
  ): Promise<string> {
    const providerHints: Record<string, unknown> = {};
    if (autoMergeOnSuccess !== undefined) {
      providerHints.actionConfig = { autoMergeOnSuccess };
    }
    const dispatch = await prisma.workerDispatch.create({
      data: {
        workflowRunId: buildRunId,
        executionProviderId,
        workerSharedSecret: 'test-secret',
        jobPayload: { providerHints },
        status: 'completed',
      },
    });
    createdDispatchIds.push(dispatch.id);
    return dispatch.id;
  }

  async function cleanupTest(runIds: string[]): Promise<void> {
    // Delete merge child runs created by the chain
    await prisma.workflowRun.deleteMany({
      where: { parentWorkflowRunId: { in: runIds } },
    });
    await prisma.workerDispatch.deleteMany({ where: { workflowRunId: { in: runIds } } });
    await prisma.workflowRun.deleteMany({ where: { id: { in: runIds } } });
  }

  beforeAll(async () => {
    parseEnv({
      DATABASE_URL: 'postgresql://supportagent:supportagent@localhost:5432/supportagent_dev',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      REDIS_URL: 'redis://localhost:6379',
    });

    const pt = await prisma.platformType.findFirst({ where: { key: 'github' } });

    const connector = await prisma.connector.create({
      data: {
        tenantId,
        platformTypeId: pt!.id,
        name: 'chain-test',
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
        repositoryUrl: 'https://github.com/test/chain-repo',
        defaultBranch: 'main',
      },
    });
    repoMappingId = mapping.id;

    const item = await prisma.inboundWorkItem.create({
      data: {
        connectorInstanceId: connectorId,
        platformType: 'github',
        workItemKind: 'issue',
        externalItemId: '888',
        title: 'Chain gate test issue',
        dedupeKey: 'chain-gate-test-888',
        repositoryMappingId: repoMappingId,
      },
    });
    workItemId = item.id;

    const provider = await prisma.executionProvider.create({
      data: {
        tenantId,
        providerType: 'local',
        name: 'chain-test-provider',
        isEnabled: true,
        connectionMode: 'direct',
        maxConcurrency: 1,
      },
    });
    executionProviderId = provider.id;
  });

  afterAll(async () => {
    await prisma.workflowRun.deleteMany({
      where: { parentWorkflowRunId: { in: createdRunIds } },
    });
    await prisma.workerDispatch.deleteMany({ where: { workflowRunId: { in: createdRunIds } } });
    await prisma.workflowRun.deleteMany({ where: { tenantId } });
    await prisma.inboundWorkItem.deleteMany({ where: { connectorInstanceId: connectorId } });
    await prisma.repositoryMapping.deleteMany({ where: { tenantId } });
    await prisma.connector.deleteMany({ where: { tenantId } });
    await prisma.executionProvider.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
  });

  it('1. skips when no WorkerDispatch exists for the build run', async () => {
    const buildRunId = await createBuildRun('pr:owner/repo#1');

    const result = await chain.chainBuildToMerge(buildRunId);

    expect(result).toBeNull();

    // Verify no merge run was created
    const mergeRun = await prisma.workflowRun.findFirst({
      where: { parentWorkflowRunId: buildRunId, workflowType: 'merge' },
    });
    expect(mergeRun).toBeNull();

    await cleanupTest([buildRunId]);
  });

  it('2. skips when WorkerDispatch exists but actionConfig is absent', async () => {
    const buildRunId = await createBuildRun('pr:owner/repo#2');
    // providerHints present but no actionConfig key
    await prisma.workerDispatch.create({
      data: {
        workflowRunId: buildRunId,
        executionProviderId,
        workerSharedSecret: 'test-secret',
        jobPayload: { providerHints: { issueRef: 'https://github.com/test/repo/issues/2' } },
        status: 'completed',
      },
    });

    const result = await chain.chainBuildToMerge(buildRunId);

    expect(result).toBeNull();

    await cleanupTest([buildRunId]);
  });

  it('3. skips when autoMergeOnSuccess is explicitly false', async () => {
    const buildRunId = await createBuildRun('pr:owner/repo#3');
    await createDispatchFor(buildRunId, false);

    const result = await chain.chainBuildToMerge(buildRunId);

    expect(result).toBeNull();

    const mergeRun = await prisma.workflowRun.findFirst({
      where: { parentWorkflowRunId: buildRunId, workflowType: 'merge' },
    });
    expect(mergeRun).toBeNull();

    await cleanupTest([buildRunId]);
  });

  it('4. chains when autoMergeOnSuccess is true', async () => {
    const buildRunId = await createBuildRun('pr:owner/repo#4');
    await createDispatchFor(buildRunId, true);

    const result = await chain.chainBuildToMerge(buildRunId);

    expect(result).not.toBeNull();
    expect(result!.mergeRunId).toBeTruthy();

    const mergeRun = await prisma.workflowRun.findUnique({ where: { id: result!.mergeRunId } });
    expect(mergeRun).not.toBeNull();
    expect(mergeRun!.workflowType).toBe('merge');
    expect(mergeRun!.status).toBe('queued');
    expect(mergeRun!.parentWorkflowRunId).toBe(buildRunId);
    expect(mergeRun!.providerExecutionRef).toBe('pr:owner/repo#4');

    await cleanupTest([buildRunId]);
  });

  it('5. chains when force: true regardless of autoMergeOnSuccess flag', async () => {
    const buildRunId = await createBuildRun('pr:owner/repo#5');
    // Dispatch explicitly set to false
    await createDispatchFor(buildRunId, false);

    const result = await chain.chainBuildToMerge(buildRunId, { force: true });

    expect(result).not.toBeNull();
    expect(result!.mergeRunId).toBeTruthy();

    const mergeRun = await prisma.workflowRun.findUnique({ where: { id: result!.mergeRunId } });
    expect(mergeRun).not.toBeNull();
    expect(mergeRun!.workflowType).toBe('merge');

    await cleanupTest([buildRunId]);
  });

  it('5b. chains when force: true and no dispatch at all', async () => {
    const buildRunId = await createBuildRun('pr:owner/repo#5b');
    // No dispatch created

    const result = await chain.chainBuildToMerge(buildRunId, { force: true });

    expect(result).not.toBeNull();
    expect(result!.mergeRunId).toBeTruthy();

    await cleanupTest([buildRunId]);
  });

  it('6. chainAll only chains opted-in builds among a mixed set', async () => {
    // Build A: no dispatch — should NOT chain
    const runA = await createBuildRun('pr:owner/repo#10');

    // Build B: autoMergeOnSuccess false — should NOT chain
    const runB = await createBuildRun('pr:owner/repo#11');
    await createDispatchFor(runB, false);

    // Build C: autoMergeOnSuccess true — SHOULD chain
    const runC = await createBuildRun('pr:owner/repo#12');
    await createDispatchFor(runC, true);

    // Build D: autoMergeOnSuccess true — SHOULD chain
    const runD = await createBuildRun('pr:owner/repo#13');
    await createDispatchFor(runD, true);

    const result = await chain.chainAll();

    // Two opted-in builds should have been chained
    expect(result.buildChained).toBeGreaterThanOrEqual(2);

    // Verify A and B produced no merge run
    const mergeA = await prisma.workflowRun.findFirst({
      where: { parentWorkflowRunId: runA, workflowType: 'merge' },
    });
    const mergeB = await prisma.workflowRun.findFirst({
      where: { parentWorkflowRunId: runB, workflowType: 'merge' },
    });
    expect(mergeA).toBeNull();
    expect(mergeB).toBeNull();

    // Verify C and D did get merge runs
    const mergeC = await prisma.workflowRun.findFirst({
      where: { parentWorkflowRunId: runC, workflowType: 'merge' },
    });
    const mergeD = await prisma.workflowRun.findFirst({
      where: { parentWorkflowRunId: runD, workflowType: 'merge' },
    });
    expect(mergeC).not.toBeNull();
    expect(mergeD).not.toBeNull();

    await cleanupTest([runA, runB, runC, runD]);
  });
});
