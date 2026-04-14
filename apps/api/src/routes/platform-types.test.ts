import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { parseEnv } from '@support-agent/config';
import { type FastifyInstance } from 'fastify';

describe('Platform type routes', () => {
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
    await app.close();
  });

  it('GET /v1/platform-types returns the shared platform catalog', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/platform-types',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'github',
          displayName: 'GitHub',
          category: 'version-control',
          supportsWebhook: true,
          supportsPolling: true,
        }),
        expect.objectContaining({
          key: 'sentry',
          displayName: 'Sentry',
          category: 'error-monitoring',
          supportsOutbound: false,
        }),
      ]),
    );
  });

  it('GET /v1/platform-types/:key returns a specific platform type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/platform-types/github',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({
        key: 'github',
        displayName: 'GitHub',
        category: 'version-control',
      }),
    );
  });
});
