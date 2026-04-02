import { type Env } from '@support-agent/config';

type StringEnvKey = {
  [K in keyof Env]-?: Env[K] extends string | undefined ? K : never;
}[keyof Env];

export interface OAuthPlatformConfig {
  /** Authorization endpoint on the provider */
  authorizeUrl: string;
  /** Token exchange endpoint on the provider */
  tokenUrl: string;
  /** Default scopes to request */
  scopes: string[];
  /** Env key holding the client ID */
  clientIdKey: StringEnvKey;
  /** Env key holding the client secret */
  clientSecretKey: StringEnvKey;
}

/**
 * Add an entry here for every platform that has supportsOAuth: true
 * in the platform registry. Platforms that share an OAuth App
 * (e.g. github + github_issues) can reference the same env keys.
 */
export const OAUTH_PLATFORM_MAP: Record<string, OAuthPlatformConfig> = {
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:org'],
    clientIdKey: 'GITHUB_OAUTH_CLIENT_ID',
    clientSecretKey: 'GITHUB_OAUTH_CLIENT_SECRET',
  },
  github_issues: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:org'],
    clientIdKey: 'GITHUB_OAUTH_CLIENT_ID',
    clientSecretKey: 'GITHUB_OAUTH_CLIENT_SECRET',
  },
  gitlab: {
    authorizeUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    scopes: ['api', 'read_user'],
    clientIdKey: 'GITLAB_OAUTH_CLIENT_ID',
    clientSecretKey: 'GITLAB_OAUTH_CLIENT_SECRET',
  },
  linear: {
    authorizeUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    scopes: ['read', 'write'],
    clientIdKey: 'LINEAR_OAUTH_CLIENT_ID',
    clientSecretKey: 'LINEAR_OAUTH_CLIENT_SECRET',
  },
};

/** Returns client credentials for a platform, or null if not configured. */
export function getOAuthCredentials(
  platformKey: string,
  env: Env,
): { clientId: string; clientSecret: string } | null {
  const config = OAUTH_PLATFORM_MAP[platformKey];
  if (!config) return null;
  const clientId = env[config.clientIdKey];
  const clientSecret = env[config.clientSecretKey];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}
