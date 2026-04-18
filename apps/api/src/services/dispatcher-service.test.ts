import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, ExecutorSource, SkillRole, SkillSource } from '@prisma/client';
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
  let executorId: string;
  let scenarioId: string;
  let skillId: string;

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

    const existingSkill = await prisma.skill.findFirst({
      where: {
        tenantId: null,
        name: 'triage-issue',
        source: SkillSource.BUILTIN,
      },
    });
    const skill = existingSkill
      ? await prisma.skill.update({
          where: { id: existingSkill.id },
          data: {
            description: 'Builtin triage skill',
            role: SkillRole.SYSTEM,
            body: '# Triage\n',
            outputSchema: {
              type: 'object',
              properties: {
                delivery: { type: 'array' },
              },
              required: ['delivery'],
            },
            contentHash: 'skill-hash-dispatcher-test',
          },
        })
      : await prisma.skill.create({
          data: {
            tenantId: null,
            name: 'triage-issue',
            description: 'Builtin triage skill',
            role: SkillRole.SYSTEM,
            body: '# Triage\n',
            outputSchema: {
              type: 'object',
              properties: {
                delivery: { type: 'array' },
              },
              required: ['delivery'],
            },
            contentHash: 'skill-hash-dispatcher-test',
            source: SkillSource.BUILTIN,
          },
        });
    skillId = skill.id;

    const existingExecutor = await prisma.executor.findFirst({
      where: {
        tenantId: null,
        key: 'triage-default',
        source: ExecutorSource.BUILTIN,
      },
    });
    const executor = existingExecutor
      ? await prisma.executor.update({
          where: { id: existingExecutor.id },
          data: {
            description: 'Builtin triage executor',
            yaml: `version: 1
key: triage-default
display_name: "Default triage"
stages:
  - id: investigate
    parallel: 1
    system_skill: triage-issue
    complementary: []
    executor: max
    after: []
    inputs_from: []
    task_prompt: "Investigate"
loop:
  enabled: false
  max_iterations: 1
  until_done: false
`,
            parsed: {},
            contentHash: 'executor-hash-dispatcher-test',
          },
        })
      : await prisma.executor.create({
          data: {
            tenantId: null,
            key: 'triage-default',
            description: 'Builtin triage executor',
            yaml: `version: 1
key: triage-default
display_name: "Default triage"
stages:
  - id: investigate
    parallel: 1
    system_skill: triage-issue
    complementary: []
    executor: max
    after: []
    inputs_from: []
    task_prompt: "Investigate"
loop:
  enabled: false
  max_iterations: 1
  until_done: false
`,
            parsed: {},
            contentHash: 'executor-hash-dispatcher-test',
            source: ExecutorSource.BUILTIN,
          },
        });
    executorId = executor.id;

    const scenario = await prisma.workflowScenario.create({
      data: {
        tenantId,
        key: `dispatcher-test-scenario-${Date.now()}`,
        displayName: 'Dispatcher Test Scenario',
        workflowType: 'triage',
        steps: {
          create: [
            {
              stepType: 'action',
              stepOrder: 1,
              config: {
                designer: { sourceKey: 'workflow.triage' },
                executorKey: 'triage-default',
              },
            },
          ],
        },
      },
    });
    scenarioId = scenario.id;
  });

  afterAll(async () => {
    await prisma.workerDispatch.deleteMany({ where: { workflowRun: { tenantId } } });
    await prisma.workflowRun.deleteMany({ where: { tenantId } });
    await prisma.workflowScenarioStep.deleteMany({ where: { scenarioId } });
    await prisma.workflowScenario.deleteMany({ where: { id: scenarioId } });
    await prisma.inboundWorkItem.deleteMany({ where: { connectorInstanceId: connectorId } });
    await prisma.repositoryMapping.deleteMany({ where: { tenantId } });
    await prisma.connector.deleteMany({ where: { tenantId } });
    await prisma.executionProvider.deleteMany({ where: { tenantId } });
    await prisma.executor.deleteMany({ where: { id: executorId } });
    await prisma.skill.deleteMany({ where: { id: skillId } });
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
        workflowScenarioId: scenarioId,
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
    expect(run!.resolvedExecutorRevision).toBe('executor-hash-dispatcher-test');
    expect(run!.resolvedSkillRevisions).toEqual({
      'triage-issue': 'skill-hash-dispatcher-test',
    });

    // Verify dispatch record
    const dispatch = await prisma.workerDispatch.findUnique({
      where: { id: result!.dispatchId },
    });
    expect(dispatch!.workerSharedSecret).toBeTruthy();
    expect(dispatch!.status).toBe('running');

    // Verify job was enqueued
    expect(dispatched.length).toBeGreaterThan(0);
  });

  it('populates triggerContext when review workItem has a comment', async () => {
    const reviewItem = await prisma.inboundWorkItem.create({
      data: {
        connectorInstanceId: connectorId,
        platformType: 'github',
        workItemKind: 'review_target',
        reviewTargetType: 'pull_request',
        reviewTargetNumber: 42,
        externalItemId: '42',
        externalUrl: 'https://github.com/test/repo/pull/42',
        title: 'Review test PR',
        dedupeKey: `review-test-42-${Date.now()}`,
        repositoryMappingId: repoMappingId,
        comments: [
          {
            commentId: 'cmt-001',
            author: 'alice',
            body: '/sa review',
            createdAt: '2026-04-17T10:00:00Z',
          },
        ],
      },
    });

    await prisma.workflowRun.create({
      data: {
        tenantId,
        workflowType: 'review',
        status: 'queued',
        workItemId: reviewItem.id,
        repositoryMappingId: repoMappingId,
      },
    });

    const result = await dispatcher.dispatchNext();
    expect(result).not.toBeNull();

    const dispatch = await prisma.workerDispatch.findUnique({
      where: { id: result!.dispatchId },
    });
    const payload = dispatch!.jobPayload as Record<string, unknown>;
    const hints = payload.providerHints as Record<string, unknown>;
    expect(hints.triggerContext).toMatchObject({
      kind: 'github.pull_request.comment',
      comment: {
        id: 'cmt-001',
        author: 'alice',
        body: '/sa review',
        createdAt: '2026-04-17T10:00:00Z',
      },
    });
    expect((hints.triggerContext as Record<string, unknown>).comment).not.toHaveProperty('url');
  });

  it('omits triggerContext when review workItem has no comments', async () => {
    const reviewItem = await prisma.inboundWorkItem.create({
      data: {
        connectorInstanceId: connectorId,
        platformType: 'github',
        workItemKind: 'review_target',
        reviewTargetType: 'pull_request',
        reviewTargetNumber: 43,
        externalItemId: '43',
        externalUrl: 'https://github.com/test/repo/pull/43',
        title: 'Review test PR no comment',
        dedupeKey: `review-test-43-${Date.now()}`,
        repositoryMappingId: repoMappingId,
      },
    });

    await prisma.workflowRun.create({
      data: {
        tenantId,
        workflowType: 'review',
        status: 'queued',
        workItemId: reviewItem.id,
        repositoryMappingId: repoMappingId,
      },
    });

    const result = await dispatcher.dispatchNext();
    expect(result).not.toBeNull();

    const dispatch = await prisma.workerDispatch.findUnique({
      where: { id: result!.dispatchId },
    });
    const payload = dispatch!.jobPayload as Record<string, unknown>;
    const hints = payload.providerHints as Record<string, unknown>;
    expect(hints.triggerContext).toBeUndefined();
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
