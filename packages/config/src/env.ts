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
  // UOA (UnlikeOtherAuthenticator) relying-party configuration.
  // `SSO_DOMAIN` is the public hostname that serves `/.well-known/jwks.json`
  // and `/v1/auth/sso-config`. The `domain` claim in the config JWT must
  // match this value byte-for-byte (case-insensitive).
  SSO_DOMAIN: z.string().default('api.appbuildbox.com'),
  // PKCS8 PEM of the RS256 private key used to sign config JWTs. Required for
  // SSO to be offered; the matching public JWK is derived at startup and
  // published at /.well-known/jwks.json.
  UOA_CONFIG_SIGNING_PRIVATE_KEY_PEM: z.string().optional(),
  // `kid` value used in both the JWT header and the published JWK. Rotated by
  // issuing a new `kid` and re-registering with the UOA superuser.
  UOA_JWK_KID: z.string().default('supportagent-2026-04'),
  // Contact email that receives the integration claim link during Phase-1
  // auto-onboarding. Also included in the config JWT payload.
  UOA_CONTACT_EMAIL: z.string().optional(),
  // `uoa_sec_...` value delivered by UOA after the integration is approved.
  // Absent until the claim link is consumed. Once set, the runtime computes
  // `client_hash = sha256(domain + secret)` and uses it as the Bearer token
  // for backend-to-backend calls (`/auth/token`, `/auth/revoke`).
  UOA_CLIENT_SECRET: z.string().optional(),
  ADMIN_APP_URL: z.string().url().default('http://localhost:5173'),
  // OAuth App credentials — set by the operator for each platform they register.
  // When absent, that platform's OAuth option is hidden and token auth is used instead.
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  GITLAB_OAUTH_CLIENT_ID: z.string().optional(),
  GITLAB_OAUTH_CLIENT_SECRET: z.string().optional(),
  LINEAR_OAUTH_CLIENT_ID: z.string().optional(),
  LINEAR_OAUTH_CLIENT_SECRET: z.string().optional(),
  // Direct API key path used by the worker for posting comments back to Linear.
  // Per-tenant secret should eventually live in Connector.config; this env var
  // is the temporary bootstrap path while we wire that through.
  LINEAR_API_KEY: z.string().optional(),
  // Respond.io workspace bearer token. Same temporary bootstrap shape as
  // LINEAR_API_KEY; per-tenant secrets will move to Connector.config.
  RESPONDIO_API_KEY: z.string().optional(),
  // Jira Cloud credentials for the worker. Same temporary bootstrap shape:
  // per-tenant secrets will move to Connector.config once that path lands.
  JIRA_BASE_URL: z.string().url().optional(),
  JIRA_USER_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),
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
