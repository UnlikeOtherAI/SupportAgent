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
  // Runtime API key the worker uses to authenticate the WS upgrade to
  // the gateway. Format: `rtk_<prefix>_<secret>`. Issuance/rotation
  // tooling lives in a sibling change-set; the verification primitive
  // lives in `apps/gateway/src/ws/runtime-key-auth.ts`.
  RUNTIME_API_KEY: z.string().optional(),
  // Tenant-scoped worker id the worker advertises on `register`. Must
  // start with `<tenantId>:` so the gateway can verify the claim against
  // the runtime key's tenant.
  WORKER_ID: z.string().optional(),
  // Comma-separated allowlist of Origin/Host values accepted on the WS
  // upgrade. Empty string (default) means "no Origin allowlist" — allowed in
  // dev/test only; `parseEnv` rejects an empty value when NODE_ENV is
  // 'production'.
  GATEWAY_ALLOWED_ORIGINS: z.string().default(''),
  // Hard upper bound on a single WS frame, in bytes. Anything bigger and the
  // ws lib closes the connection.
  GATEWAY_WS_MAX_PAYLOAD_BYTES: z.coerce.number().int().positive().default(1_048_576),
  // Idle/dead-peer detection. Ping every PING_MS; if pong does not arrive
  // within IDLE_TIMEOUT_MS, terminate the socket.
  GATEWAY_WS_PING_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  GATEWAY_WS_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // Per-connection rate limit on inbound control messages.
  GATEWAY_WS_MSG_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(600),
  // Max simultaneous WS connections per tenant.
  GATEWAY_WS_MAX_CONN_PER_TENANT: z.coerce.number().int().positive().default(50),
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
  if (
    result.data.NODE_ENV === 'production' &&
    result.data.GATEWAY_ALLOWED_ORIGINS.trim().length === 0
  ) {
    throw new Error(
      'GATEWAY_ALLOWED_ORIGINS must be set to a non-empty allowlist in production.',
    );
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
