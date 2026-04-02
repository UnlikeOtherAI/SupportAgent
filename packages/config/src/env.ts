import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32),
  API_BASE_URL: z.string().url().default('http://localhost:3001'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  QUEUE_BACKEND: z.enum(['bullmq', 'pubsub']).default('bullmq'),
  GCP_PROJECT_ID: z.string().optional(),
  GATEWAY_URL: z.string().optional(),
  GATEWAY_PORT: z.coerce.number().default(3002),
  SSO_BASE_URL: z.string().url().default('https://authentication.unlikeotherai.com'),
  SSO_SHARED_SECRET: z.string().min(32).optional(),
  SSO_IDENTIFIER: z.string().default('authentication.unlikeotherai.com'),
  SSO_DOMAIN: z.string().default('app.appbuildbox.com'),
  ADMIN_APP_URL: z.string().url().default('http://localhost:5173'),
  // OAuth App credentials — set by the operator for each platform they register.
  // When absent, that platform's OAuth option is hidden and token auth is used instead.
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  GITLAB_OAUTH_CLIENT_ID: z.string().optional(),
  GITLAB_OAUTH_CLIENT_SECRET: z.string().optional(),
  LINEAR_OAUTH_CLIENT_ID: z.string().optional(),
  LINEAR_OAUTH_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function parseEnv(overrides?: Partial<Record<string, string>>): Env {
  const result = envSchema.safeParse({ ...process.env, ...overrides });
  if (!result.success) {
    const formatted = result.error.flatten().fieldErrors;
    const missing = Object.entries(formatted)
      .map(([key, errors]) => `  ${key}: ${errors?.join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${missing}`);
  }
  _env = result.data;
  return _env;
}

export function getEnv(): Env {
  if (!_env) {
    throw new Error('Environment not parsed yet. Call parseEnv() first.');
  }
  return _env;
}
