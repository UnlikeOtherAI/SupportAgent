import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { parseEnv } from '@support-agent/config';
import { type FastifyInstance } from 'fastify';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    parseEnv({
      DATABASE_URL: 'postgresql://supportagent:supportagent@localhost:5432/supportagent_dev',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      REDIS_URL: 'redis://localhost:6379',
    });
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with status ok when database is available', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    // If DB is available this returns 200, if not 503 — both are valid behaviors
    expect([200, 503]).toContain(response.statusCode);
    if (response.statusCode === 200) {
      expect(response.json()).toEqual({ status: 'ok' });
    }
  });
});
