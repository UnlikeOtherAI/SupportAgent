import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { parseEnv } from '@support-agent/config';
import { type FastifyInstance } from 'fastify';

describe('Connector routes', () => {
  let app: FastifyInstance;
  let authToken: string;
  const tenantId = '00000000-0000-0000-0000-000000000001';

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

  afterAll(async () => {
    await app.prisma.connectorCapability.deleteMany({});
    await app.prisma.connector.deleteMany({ where: { tenantId } });
    await app.close();
  });

  async function getPlatformTypeId(): Promise<string> {
    const pt = await app.prisma.platformType.findFirst({ where: { key: 'github' } });
    return pt!.id;
  }

  it('GET /v1/connectors returns empty list initially', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/connectors',
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('POST /v1/connectors creates a connector', async () => {
    const platformTypeId = await getPlatformTypeId();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/connectors',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        platformTypeId,
        name: 'Test GitHub Connector',
        direction: 'both',
        configuredIntakeMode: 'webhook',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Test GitHub Connector');
    expect(body.direction).toBe('both');
    expect(body.isEnabled).toBe(true);
  });

  it('GET /v1/connectors lists created connector', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/connectors',
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/connectors/:id returns connector detail', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/connectors',
      headers: { authorization: `Bearer ${authToken}` },
    });
    const connectorId = list.json()[0].id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/connectors/${connectorId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(connectorId);
  });

  it('PATCH /v1/connectors/:id updates connector', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/connectors',
      headers: { authorization: `Bearer ${authToken}` },
    });
    const connectorId = list.json()[0].id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/connectors/${connectorId}`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { name: 'Updated Connector', isEnabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Updated Connector');
    expect(res.json().isEnabled).toBe(false);
  });

  it('POST /v1/connectors/:id/capabilities/discover discovers capabilities', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/connectors',
      headers: { authorization: `Bearer ${authToken}` },
    });
    const connectorId = list.json()[0].id;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/connectors/${connectorId}/capabilities/discover`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(res.statusCode).toBe(200);
    const caps = res.json();
    expect(caps.length).toBeGreaterThan(0);
  });

  it('DELETE /v1/connectors/:id removes connector', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/connectors',
      headers: { authorization: `Bearer ${authToken}` },
    });
    const connectorId = list.json()[0].id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/connectors/${connectorId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it('returns 401 without auth token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/connectors',
    });
    expect(res.statusCode).toBe(401);
  });
});
