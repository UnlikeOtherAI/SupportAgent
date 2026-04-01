import { describe, it, expect, beforeEach, vi } from 'vitest';

const validEnv = {
  DATABASE_URL: 'postgresql://localhost:5432/support_agent',
  JWT_SECRET: 'a]V8kx!rZ3pQ9wLm2nYf7dCjT0hBuXsG',
};

describe('env', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('parseEnv with valid env returns typed config', async () => {
    const { parseEnv } = await import('./env.js');
    const env = parseEnv({
      NODE_ENV: 'production',
      PORT: '4000',
      DATABASE_URL: 'postgresql://localhost:5432/support_agent',
      REDIS_URL: 'redis://localhost:6380',
      JWT_SECRET: 'a]V8kx!rZ3pQ9wLm2nYf7dCjT0hBuXsG',
      API_BASE_URL: 'http://localhost:4000',
      CORS_ORIGIN: 'http://localhost:3000',
      LOG_LEVEL: 'debug',
    });

    expect(env.NODE_ENV).toBe('production');
    expect(env.PORT).toBe(4000);
    expect(typeof env.PORT).toBe('number');
    expect(env.DATABASE_URL).toBe('postgresql://localhost:5432/support_agent');
    expect(env.REDIS_URL).toBe('redis://localhost:6380');
    expect(env.JWT_SECRET).toBe('a]V8kx!rZ3pQ9wLm2nYf7dCjT0hBuXsG');
    expect(env.API_BASE_URL).toBe('http://localhost:4000');
    expect(env.CORS_ORIGIN).toBe('http://localhost:3000');
    expect(env.LOG_LEVEL).toBe('debug');
  });

  it('parseEnv throws on missing DATABASE_URL', async () => {
    const { parseEnv } = await import('./env.js');
    expect(() => parseEnv({ JWT_SECRET: validEnv.JWT_SECRET })).toThrow(
      'Invalid environment variables',
    );
  });

  it('parseEnv throws on missing JWT_SECRET', async () => {
    const { parseEnv } = await import('./env.js');
    expect(() => parseEnv({ DATABASE_URL: validEnv.DATABASE_URL })).toThrow(
      'Invalid environment variables',
    );
  });

  it('parseEnv throws on short JWT_SECRET', async () => {
    const { parseEnv } = await import('./env.js');
    expect(() =>
      parseEnv({
        DATABASE_URL: validEnv.DATABASE_URL,
        JWT_SECRET: 'tooshort',
      }),
    ).toThrow('Invalid environment variables');
  });

  it('parseEnv uses defaults for optional vars', async () => {
    delete process.env.NODE_ENV;
    const { parseEnv } = await import('./env.js');
    const env = parseEnv(validEnv);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
    expect(env.API_BASE_URL).toBe('http://localhost:3001');
    expect(env.CORS_ORIGIN).toBe('http://localhost:5173');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('getEnv throws before parseEnv called', async () => {
    const { getEnv } = await import('./env.js');
    expect(() => getEnv()).toThrow('Environment not parsed yet. Call parseEnv() first.');
  });

  it('parseEnv accepts overrides', async () => {
    const { parseEnv } = await import('./env.js');
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/from_process');
    vi.stubEnv('JWT_SECRET', validEnv.JWT_SECRET);

    const env = parseEnv({
      DATABASE_URL: 'postgresql://localhost:5432/from_override',
    });

    expect(env.DATABASE_URL).toBe('postgresql://localhost:5432/from_override');
  });
});
