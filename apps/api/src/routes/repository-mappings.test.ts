import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { parseEnv } from '@support-agent/config';
import { type FastifyInstance } from 'fastify';

describe('Repository mapping routes', () => {
  let app: FastifyInstance;
  let authToken: string;
  const tenantId = '00000000-0000-0000-0000-000000000002';
  let connectorId: string;
  let mappingId: string;

  beforeAll(async () => {
    parseEnv({
      DATABASE_URL: 'postgresql://supportagent:supportagent@localhost:5432/supportagent_dev',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      REDIS_URL: 'redis://localhost:6379',
    });
    app = await buildApp();
    await app.ready();
    authToken = app.jwt.sign({ sub: 'test-user', tenantId, role: 'admin' });

    // Create a connector fixture for mapping tests
    const pt = await app.prisma.platformType.findFirst({ where: { key: 'github' } });
    const connector = await app.prisma.connector.create({
      data: {
        tenantId,
        name: 'Mapping Test Connector',
        direction: 'both',
        configuredIntakeMode: 'webhook',
        effectiveIntakeMode: 'webhook',
        isEnabled: true,
        platformType: { connect: { id: pt!.id } },
      },
    });
    connectorId = connector.id;
  });

  afterAll(async () => {
    await app.prisma.repositoryMapping.deleteMany({ where: { tenantId } });
    await app.prisma.connector.deleteMany({ where: { tenantId } });
    await app.close();
  });

  it('GET /v1/repository-mappings returns empty list initially', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/repository-mappings',
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('POST /v1/repository-mappings creates a mapping', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/repository-mappings',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        connectorId,
        repositoryUrl: 'https://github.com/test-org/test-repo',
        defaultBranch: 'develop',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.repositoryUrl).toBe('https://github.com/test-org/test-repo');
    expect(body.defaultBranch).toBe('develop');
    expect(body.connectorId).toBe(connectorId);
    mappingId = body.id;
  });

  it('GET /v1/repository-mappings/:mappingId returns detail with connector', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/repository-mappings/${mappingId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(mappingId);
    expect(body.connector).toBeDefined();
    expect(body.connector.id).toBe(connectorId);
    expect(body.connector.platformType).toBeDefined();
  });

  it('PATCH /v1/repository-mappings/:mappingId updates fields', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/repository-mappings/${mappingId}`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        defaultBranch: 'main',
        repositoryUrl: 'https://github.com/test-org/updated-repo',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.defaultBranch).toBe('main');
    expect(body.repositoryUrl).toBe('https://github.com/test-org/updated-repo');
  });

  it('GET /v1/repository-mappings filters by connectorId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/repository-mappings?connectorId=${connectorId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBe(1);
    expect(body[0].connectorId).toBe(connectorId);
  });

  it('DELETE /v1/repository-mappings/:mappingId removes mapping', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/repository-mappings/${mappingId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(res.statusCode).toBe(204);

    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/repository-mappings/${mappingId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('returns 401 without auth token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/repository-mappings',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for non-existent mapping', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/repository-mappings/00000000-0000-0000-0000-000000000099',
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
