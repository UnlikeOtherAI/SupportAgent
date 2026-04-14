import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseEnv } from '@support-agent/config';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';

describe('Polling routes', () => {
  let app: FastifyInstance;
  let authToken: string;
  const tenantId = '00000000-0000-0000-0000-000000000301';

  beforeAll(async () => {
    parseEnv({
      DATABASE_URL: 'postgresql://supportagent:supportagent@localhost:5432/supportagent_dev',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      REDIS_URL: 'redis://localhost:6379',
    });
    app = await buildApp();
    await app.ready();
    authToken = app.jwt.sign({ sub: 'test-user', tenantId, role: 'admin' });
  });

  beforeEach(async () => {
    await app.prisma.workflowRun.deleteMany({ where: { tenantId } });
    await app.prisma.inboundWorkItem.deleteMany({
      where: {
        connector: {
          tenantId,
        },
      },
    });
    await app.prisma.repositoryMapping.deleteMany({ where: { tenantId } });
    await app.prisma.connector.deleteMany({ where: { tenantId } });
  });

  afterAll(async () => {
    await app.prisma.workflowRun.deleteMany({ where: { tenantId } });
    await app.prisma.inboundWorkItem.deleteMany({
      where: {
        connector: {
          tenantId,
        },
      },
    });
    await app.prisma.repositoryMapping.deleteMany({ where: { tenantId } });
    await app.prisma.connector.deleteMany({ where: { tenantId } });
    await app.close();
  });

  async function createLocalGhMapping() {
    const platformType = await app.prisma.platformType.findFirst({
      where: { key: 'github_issues' },
    });
    const connector = await app.prisma.connector.create({
      data: {
        tenantId,
        platformTypeId: platformType!.id,
        name: 'Polling GitHub Issues',
        direction: 'both',
        configuredIntakeMode: 'polling',
        effectiveIntakeMode: 'polling',
        pollingIntervalSeconds: 300,
        capabilities: {
          auth_mode: 'local_gh',
          repo_owner: 'rafiki270',
          repo_name: 'max-test',
        },
      },
    });
    const mapping = await app.prisma.repositoryMapping.create({
      data: {
        tenantId,
        connectorId: connector.id,
        repositoryUrl: 'https://github.com/rafiki270/max-test',
        defaultBranch: 'main',
      },
    });

    return { connector, mapping };
  }

  it('GET /v1/polling/triage-targets returns local gh polling mappings', async () => {
    const { connector, mapping } = await createLocalGhMapping();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/polling/triage-targets',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        connectorId: connector.id,
        connectorName: 'Polling GitHub Issues',
        platformTypeKey: 'github_issues',
        pollingIntervalSeconds: 300,
        repositoryMappingId: mapping.id,
        repositoryUrl: 'https://github.com/rafiki270/max-test',
        defaultBranch: 'main',
        config: {
          auth_mode: 'local_gh',
          repo_owner: 'rafiki270',
          repo_name: 'max-test',
        },
      },
    ]);
  });

  it('POST /v1/polling/triage-enqueue creates and deduplicates triage runs', async () => {
    const { connector, mapping } = await createLocalGhMapping();

    const payload = {
      connectorId: connector.id,
      repositoryMappingId: mapping.id,
      issue: {
        body: 'App crashes on startup.',
        comments: [
          {
            author: 'rafiki270',
            body: 'Reproducible on main.',
            createdAt: new Date().toISOString(),
            id: 'issue-comment-1',
          },
        ],
        labels: ['bug'],
        number: 42,
        state: 'OPEN',
        title: 'Crash on startup',
        updatedAt: new Date().toISOString(),
        url: 'https://github.com/rafiki270/max-test/issues/42',
      },
    };

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/polling/triage-enqueue',
      headers: { authorization: `Bearer ${authToken}` },
      payload,
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().status).toBe('created');

    const duplicateResponse = await app.inject({
      method: 'POST',
      url: '/v1/polling/triage-enqueue',
      headers: { authorization: `Bearer ${authToken}` },
      payload,
    });

    expect(duplicateResponse.statusCode).toBe(200);
    expect(duplicateResponse.json().status).toBe('duplicate');

    const workItems = await app.prisma.inboundWorkItem.findMany({
      where: { connectorInstanceId: connector.id },
    });
    const runs = await app.prisma.workflowRun.findMany({
      where: {
        tenantId,
        workflowType: 'triage',
      },
    });

    expect(workItems).toHaveLength(1);
    expect(runs).toHaveLength(1);
    expect(workItems[0].externalItemId).toBe('42');
    expect(runs[0].status).toBe('queued');
  });
});
