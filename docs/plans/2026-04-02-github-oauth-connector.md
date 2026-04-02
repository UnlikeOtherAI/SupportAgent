# Multi-Platform OAuth Connector

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Every platform in the registry that supports OAuth exposes a two-option install flow — "Connect via OAuth App" (when the operator has registered and configured our app globally) or "Use a token / API key" (always available, works for self-hosted / enterprise variants). No per-tenant credential setup; the OAuth App is a single global registration.

**Architecture:** Three layers of change. (1) `PlatformRegistryEntry` gains `supportsOAuth`. (2) A shared API module `oauth-platforms.ts` owns the per-platform OAuth wiring (authorize URL, token URL, scopes, env key names) so both the platform-types route and the OAuth route share one source of truth. (3) The platform-types route computes `oauthAvailable` at runtime from the shared map + env. `AppEnablePage` shows a method-picker when `oauthAvailable` is true; the token form is unchanged and always accessible.

**Self-hosted / Enterprise note:** Token auth is always present. GitHub Enterprise users pick "Use a token" and fill in a custom `api_base_url`. OAuth is only offered when the operator has registered our app with that provider — no per-tenant custom OAuth.

**Tech Stack:** React, TanStack Query, React Router, Fastify, `jose`, Zod, `@support-agent/contracts`, `@support-agent/config`

---

### Task 1: Extend platform registry and env config

**Files:**
- Modify: `packages/contracts/src/platform-registry.ts`
- Modify: `packages/config/src/env.ts`

**Step 1: Add `supportsOAuth` to `PlatformRegistryEntry`**

In `packages/contracts/src/platform-registry.ts`, add the field to the interface:

```ts
export interface PlatformRegistryEntry {
  key: string;
  displayName: string;
  description: string;
  category: 'issue-tracker' | 'error-monitoring' | 'version-control' | 'project-management';
  iconSlug: string;
  defaultDirection: 'inbound' | 'outbound' | 'both';
  defaultIntakeMode: 'webhook' | 'polling' | 'manual';
  supportsCustomServer: boolean;
  supportsOAuth: boolean;
  configFields: PlatformConfigField[];
}
```

**Step 2: Set `supportsOAuth` on every entry in `PLATFORM_REGISTRY`**

- `github`: `supportsOAuth: true`
- `github_issues`: `supportsOAuth: true`
- `gitlab`: `supportsOAuth: true`
- `linear`: `supportsOAuth: true`
- `sentry`: `supportsOAuth: false` — uses internal integrations, not a standard OAuth App flow
- `crashlytics`: `supportsOAuth: false`
- `jira`: `supportsOAuth: false` — Atlassian's 3LO flow is complex; add later
- `trello`: `supportsOAuth: false`
- `bitbucket`: `supportsOAuth: false`

Add `supportsOAuth: true` or `false` directly after `supportsCustomServer` in each entry.

**Step 3: Add OAuth env vars to the config schema**

In `packages/config/src/env.ts`, add after the `ADMIN_APP_URL` line:

```ts
  // OAuth App credentials — set by the operator for each platform they register.
  // When absent, that platform's OAuth option is hidden and token auth is used instead.
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  GITLAB_OAUTH_CLIENT_ID: z.string().optional(),
  GITLAB_OAUTH_CLIENT_SECRET: z.string().optional(),
  LINEAR_OAUTH_CLIENT_ID: z.string().optional(),
  LINEAR_OAUTH_CLIENT_SECRET: z.string().optional(),
```

**Step 4: Rebuild the two packages**

```bash
pnpm --filter @support-agent/contracts build
pnpm --filter @support-agent/config build
```

Expected: both complete without errors.

**Step 5: Commit**

```bash
git add packages/contracts/src/platform-registry.ts packages/config/src/env.ts
git commit -m "feat: add supportsOAuth to platform registry, add OAuth env vars for GitHub/GitLab/Linear"
```

---

### Task 2: Create the shared OAuth platforms map

This module is the single source of truth for per-platform OAuth wiring. Both the platform-types route (to compute `oauthAvailable`) and the OAuth route (to build the authorize URL and exchange the code) import from here.

**Files:**
- Create: `apps/api/src/lib/oauth-platforms.ts`

**Step 1: Write the module**

```ts
import { type Env } from '@support-agent/config';

export interface OAuthPlatformConfig {
  /** Authorization endpoint on the provider */
  authorizeUrl: string;
  /** Token exchange endpoint on the provider */
  tokenUrl: string;
  /** Default scopes to request */
  scopes: string[];
  /** Env key holding the client ID */
  clientIdKey: keyof Env;
  /** Env key holding the client secret */
  clientSecretKey: keyof Env;
}

/**
 * Add an entry here for every platform that has `supportsOAuth: true`
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
  const clientId = env[config.clientIdKey] as string | undefined;
  const clientSecret = env[config.clientSecretKey] as string | undefined;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}
```

**Step 2: Check TypeScript**

```bash
pnpm --filter api exec tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add apps/api/src/lib/oauth-platforms.ts
git commit -m "feat: add shared OAuth platform map (GitHub, GitLab, Linear)"
```

---

### Task 3: Expose `oauthAvailable` in the platform-types API

**Files:**
- Modify: `apps/api/src/routes/platform-types.ts`

**Step 1: Add imports**

```ts
import { getEnv } from '@support-agent/config';
import { getOAuthCredentials } from '../lib/oauth-platforms.js';
```

**Step 2: Update `enrichPlatformType` to accept env**

Replace the function with:

```ts
function enrichPlatformType(
  pt: PlatformTypeRecord,
  env: ReturnType<typeof getEnv>,
) {
  const registry = PLATFORM_REGISTRY[pt.key];
  const oauthAvailable = (registry?.supportsOAuth ?? false)
    ? getOAuthCredentials(pt.key, env) !== null
    : false;

  return {
    id: pt.id,
    key: pt.key,
    displayName: pt.displayName,
    description: registry?.description ?? pt.description,
    category: registry?.category ?? pt.category,
    iconSlug: registry?.iconSlug ?? pt.key,
    supportsWebhook: pt.supportsWebhook,
    supportsPolling: pt.supportsPolling,
    supportsInbound: pt.supportsInbound,
    supportsOutbound: pt.supportsOutbound,
    supportsCustomServer: registry?.supportsCustomServer ?? false,
    defaultDirection: registry?.defaultDirection ?? 'inbound',
    defaultIntakeMode: registry?.defaultIntakeMode ?? 'webhook',
    oauthAvailable,
    configFields: registry?.configFields ?? [],
  };
}
```

**Step 3: Thread env into both handlers**

`GET /`:
```ts
app.get('/', async () => {
  const env = getEnv();
  const platformTypes = await app.prisma.platformType.findMany({
    orderBy: { displayName: 'asc' },
  });
  return platformTypes.map((pt) => enrichPlatformType(pt, env));
});
```

`GET /:key`:
```ts
app.get<{ Params: { key: string } }>('/:key', async (request) => {
  const env = getEnv();
  const platformType = await app.prisma.platformType.findUnique({
    where: { key: request.params.key },
  });
  if (!platformType) {
    throw Object.assign(new Error('Platform type not found'), { statusCode: 404 });
  }
  return enrichPlatformType(platformType, env);
});
```

**Step 4: Check TypeScript**

```bash
pnpm --filter api exec tsc --noEmit
```

**Step 5: Commit**

```bash
git add apps/api/src/routes/platform-types.ts
git commit -m "feat: expose oauthAvailable on platform-types API"
```

---

### Task 4: Add OAuth connector routes

**Files:**
- Create: `apps/api/src/routes/connector-oauth.ts`
- Modify: `apps/api/src/app.ts`

**Step 1: Create `connector-oauth.ts`**

```ts
import { type FastifyInstance } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { getEnv } from '@support-agent/config';
import { createConnectorRepository } from '../repositories/connector-repository.js';
import { createConnectorService } from '../services/connector-service.js';
import { OAUTH_PLATFORM_MAP, getOAuthCredentials } from '../lib/oauth-platforms.js';

export async function connectorOAuthRoutes(app: FastifyInstance) {
  const repo = createConnectorRepository(app.prisma);
  const service = createConnectorService(repo, app.prisma);

  /**
   * GET /v1/connector-oauth/:platformKey/start?connectorId=<id>
   *
   * Authenticated. Verifies the connector belongs to the caller,
   * signs a short-lived state JWT, builds the provider's authorize URL,
   * and returns it as JSON. The frontend does window.location.href = redirectUrl.
   */
  app.get<{
    Params: { platformKey: string };
    Querystring: { connectorId: string };
  }>('/:platformKey/start', async (request, reply) => {
    await request.authenticate();
    const { platformKey } = request.params;
    const { connectorId } = request.query;
    const { tenantId } = request.user;

    const oauthConfig = OAUTH_PLATFORM_MAP[platformKey];
    if (!oauthConfig) {
      return reply.status(404).send({ error: 'OAuth not supported for this platform' });
    }

    const env = getEnv();
    const creds = getOAuthCredentials(platformKey, env);
    if (!creds) {
      return reply.status(503).send({ error: 'OAuth credentials not configured on server' });
    }

    // Verify the connector belongs to this tenant before issuing the flow
    await service.getConnector(connectorId, tenantId);

    const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);
    const state = await new SignJWT({ connectorId, tenantId, platformKey })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(jwtSecret);

    const callbackUrl = `${env.API_BASE_URL}/v1/connector-oauth/${platformKey}/callback`;
    const url = new URL(oauthConfig.authorizeUrl);
    url.searchParams.set('client_id', creds.clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('scope', oauthConfig.scopes.join(' '));
    url.searchParams.set('state', state);

    return { redirectUrl: url.toString() };
  });

  /**
   * GET /v1/connector-oauth/:platformKey/callback?code=&state=
   *
   * Public — the provider redirects here after the user authorizes.
   * Verifies the signed state, exchanges the code for an access token,
   * stores it as the connector secret, then redirects to the admin
   * configure page.
   */
  app.get<{
    Params: { platformKey: string };
    Querystring: { code?: string; state?: string; error?: string };
  }>('/:platformKey/callback', async (request, reply) => {
    const { platformKey } = request.params;
    const { code, state, error } = request.query;
    const env = getEnv();
    const adminUrl = env.ADMIN_APP_URL;

    const oauthConfig = OAUTH_PLATFORM_MAP[platformKey];
    if (!oauthConfig) {
      return reply.redirect(`${adminUrl}/apps?oauth_error=unknown_platform`);
    }

    if (error || !code || !state) {
      const msg = encodeURIComponent(error ?? 'missing_params');
      return reply.redirect(`${adminUrl}/apps?oauth_error=${msg}`);
    }

    const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);
    let payload: { connectorId: string; tenantId: string; platformKey: string };
    try {
      const result = await jwtVerify(state, jwtSecret);
      payload = result.payload as typeof payload;
    } catch {
      return reply.redirect(`${adminUrl}/apps?oauth_error=invalid_state`);
    }

    const { connectorId, tenantId } = payload;
    const creds = getOAuthCredentials(platformKey, env);
    if (!creds) {
      return reply.redirect(`${adminUrl}/apps?oauth_error=oauth_not_configured`);
    }

    const callbackUrl = `${env.API_BASE_URL}/v1/connector-oauth/${platformKey}/callback`;
    const tokenRes = await fetch(oauthConfig.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code,
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenRes.ok) {
      return reply.redirect(`${adminUrl}/apps?oauth_error=token_exchange_failed`);
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      const msg = encodeURIComponent(tokenData.error ?? 'no_access_token');
      return reply.redirect(`${adminUrl}/apps?oauth_error=${msg}`);
    }

    try {
      await service.setConnectorSecret(connectorId, tenantId, 'api_key', tokenData.access_token);
    } catch {
      return reply.redirect(`${adminUrl}/apps?oauth_error=secret_store_failed`);
    }

    return reply.redirect(
      `${adminUrl}/apps/${platformKey}/configure/${connectorId}?oauth=success`,
    );
  });
}
```

**Step 2: Register the route in `apps/api/src/app.ts`**

Add the import:
```ts
import { connectorOAuthRoutes } from './routes/connector-oauth.js';
```

Add the registration after the connectors line:
```ts
await app.register(connectorOAuthRoutes, { prefix: '/v1/connector-oauth' });
```

**Step 3: Check TypeScript**

```bash
pnpm --filter api exec tsc --noEmit
```

**Step 4: Commit**

```bash
git add apps/api/src/routes/connector-oauth.ts apps/api/src/app.ts
git commit -m "feat: add connector OAuth routes — generic start/callback for any platform"
```

---

### Task 5: Update admin API client

**Files:**
- Modify: `apps/admin/src/api/platform-types.ts`
- Modify: `apps/admin/src/api/connectors.ts`

**Step 1: Add `oauthAvailable` to `PlatformTypeDetail`**

```ts
export interface PlatformTypeDetail {
  id: string
  key: string
  displayName: string
  description: string
  category: string
  iconSlug: string
  supportsWebhook: boolean
  supportsPolling: boolean
  supportsInbound: boolean
  supportsOutbound: boolean
  supportsCustomServer: boolean
  defaultDirection: 'inbound' | 'outbound' | 'both'
  defaultIntakeMode: 'webhook' | 'polling' | 'manual'
  oauthAvailable: boolean
  configFields: {
    key: string
    label: string
    type: 'text' | 'password' | 'url' | 'number' | 'toggle'
    placeholder?: string
    helpText?: string
    required: boolean
    secretType?: string
  }[]
}
```

**Step 2: Add `getOAuthStartUrl` to `connectorsApi`**

In `apps/admin/src/api/connectors.ts`, add to the `connectorsApi` object:

```ts
  getOAuthStartUrl: (platformKey: string, connectorId: string) =>
    api.get<{ redirectUrl: string }>(
      `/v1/connector-oauth/${platformKey}/start?connectorId=${encodeURIComponent(connectorId)}`
    ),
```

**Step 3: TypeScript check**

```bash
pnpm --filter admin exec tsc --noEmit
```

**Step 4: Commit**

```bash
git add apps/admin/src/api/platform-types.ts apps/admin/src/api/connectors.ts
git commit -m "feat: add oauthAvailable to PlatformTypeDetail, getOAuthStartUrl to connectorsApi"
```

---

### Task 6: Update AppEnablePage with method picker

**Files:**
- Modify: `apps/admin/src/pages/AppEnablePage.tsx`

The page gains a `'choose' | 'token'` state. When `platform.oauthAvailable` is true, users see the picker first. The token form is the existing code, untouched. The OAuth flow creates the connector with no secrets, then redirects to the provider.

**Step 1: Replace `AppEnablePage.tsx` with the updated version**

```tsx
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { platformTypesApi } from '@/api/platform-types'
import { connectorsApi } from '@/api/connectors'
import { PageShell } from '@/components/ui/PageShell'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PlatformIcon } from '@/components/icons/PlatformIcons'

function ConfigField({
  field,
  value,
  onChange,
}: {
  field: { key: string; label: string; type: string; placeholder?: string; helpText?: string; required: boolean }
  value: string
  onChange: (v: string) => void
}) {
  const id = `field-${field.key}`
  const inputType = field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">
        {field.label}
        {field.required && <span className="text-signal-red-500"> *</span>}
      </label>
      <input
        id={id}
        type={inputType}
        placeholder={field.placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value) }}
        className="w-full rounded-[var(--radius-sm)] border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
      />
      {field.helpText && <p className="mt-1 text-xs text-gray-400">{field.helpText}</p>}
    </div>
  )
}

export default function AppEnablePage() {
  const { platformKey } = useParams<{ platformKey: string }>()
  const navigate = useNavigate()
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  // 'choose' shows the method picker; 'token' shows the PAT form.
  // Platforms without oauthAvailable skip straight to 'token'.
  const [authMethod, setAuthMethod] = useState<'choose' | 'token'>('choose')

  const { data: platform, isLoading } = useQuery({
    queryKey: ['platform-type', platformKey],
    queryFn: () => platformTypesApi.get(platformKey ?? ''),
    enabled: !!platformKey,
  })

  // OAuth flow: create a connector shell, then redirect to the provider
  const oauthMutation = useMutation({
    mutationFn: async () => {
      if (!platform) throw new Error('Platform not loaded')
      const connector = await connectorsApi.create({
        platformTypeKey: platform.key,
        name: platform.displayName,
        direction: platform.defaultDirection,
        configuredIntakeMode: platform.defaultIntakeMode,
        config: {},
        secrets: {},
      } as Parameters<typeof connectorsApi.create>[0])
      const { redirectUrl } = await connectorsApi.getOAuthStartUrl(platform.key, connector.id)
      return redirectUrl
    },
    onSuccess: (redirectUrl) => {
      window.location.href = redirectUrl
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  // Token flow: create the connector with secrets from the form
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!platform) throw new Error('Platform not loaded')
      const secrets: Record<string, string> = {}
      const config: Record<string, string> = {}
      for (const field of platform.configFields) {
        const val = values[field.key] ?? ''
        if (!val) continue
        if (field.secretType) {
          secrets[field.secretType] = val
        } else {
          config[field.key] = val
        }
      }
      return connectorsApi.create({
        platformTypeKey: platform.key,
        name: platform.displayName,
        direction: platform.defaultDirection,
        configuredIntakeMode: platform.defaultIntakeMode,
        config,
        secrets,
      } as Parameters<typeof connectorsApi.create>[0])
    },
    onSuccess: (connector) => {
      void navigate(`/apps/${platformKey}/configure/${connector.id}`)
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (platform) {
      for (const field of platform.configFields) {
        if (field.required && !values[field.key]) {
          setError(`${field.label} is required`)
          return
        }
      }
    }
    createMutation.mutate()
  }

  if (isLoading) {
    return <PageShell title="Install App"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!platform) {
    return <PageShell title="Install App"><p className="text-sm text-gray-400">Platform not found</p></PageShell>
  }

  // Method picker — shown for OAuth-capable platforms before the user picks a path
  if (platform.oauthAvailable && authMethod === 'choose') {
    return (
      <PageShell title={`Connect ${platform.displayName}`}>
        <Link to="/apps" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back</Link>
        <Card className="max-w-md">
          <CardHeader title={`Connect ${platform.displayName}`} subtitle="How would you like to authenticate?" />
          <div className="space-y-3 px-5 pb-5">
            {/* OAuth option */}
            <button
              type="button"
              disabled={oauthMutation.isPending}
              onClick={() => { setError(null); oauthMutation.mutate() }}
              className="flex w-full items-center gap-4 rounded-[var(--radius-sm)] border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:border-accent-400 hover:bg-accent-50 disabled:opacity-50"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-accent-50">
                <PlatformIcon slug={platform.iconSlug} className="h-5 w-5 text-accent-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {oauthMutation.isPending ? 'Redirecting…' : `Connect with ${platform.displayName}`}
                </p>
                <p className="text-xs text-gray-500">Authorize via our registered OAuth app — no tokens to copy</p>
              </div>
            </button>

            {/* Token option */}
            <button
              type="button"
              onClick={() => { setAuthMethod('token') }}
              className="flex w-full items-center gap-4 rounded-[var(--radius-sm)] border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:border-gray-300 hover:bg-gray-50"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-gray-50">
                <span className="text-sm font-medium text-gray-500">PAT</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Use a personal access token</p>
                <p className="text-xs text-gray-500">For self-hosted / enterprise instances, or manual credential management</p>
              </div>
            </button>

            {error && <p className="pt-1 text-sm text-signal-red-500">{error}</p>}
          </div>
        </Card>
      </PageShell>
    )
  }

  // Token form (always available; default for platforms without OAuth)
  return (
    <PageShell title={`Connect ${platform.displayName}`}>
      <Link to="/apps" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back</Link>

      <Card>
        <CardHeader title={platform.displayName} subtitle={platform.description} />

        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-gray-50">
            <PlatformIcon slug={platform.iconSlug} className="h-6 w-6 text-gray-700" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">{platform.displayName}</p>
            <p className="text-xs text-gray-500">{platform.category.replace('-', ' ')}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-5 py-5">
          {platform.configFields.map((field) => (
            <ConfigField
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              onChange={(v) => { setValues((prev) => ({ ...prev, [field.key]: v })) }}
            />
          ))}

          {error && <p className="text-sm text-signal-red-500">{error}</p>}

          <div className="flex gap-3 pt-2">
            <Button type="submit" variant="primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Connecting…' : 'Connect'}
            </Button>
            {platform.oauthAvailable && (
              <Button type="button" variant="secondary" onClick={() => { setAuthMethod('choose') }}>
                Back
              </Button>
            )}
            <Link to="/apps">
              <Button type="button" variant="secondary">Cancel</Button>
            </Link>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
```

**Step 2: TypeScript check**

```bash
pnpm --filter admin exec tsc --noEmit
```

**Step 3: Commit**

```bash
git add apps/admin/src/pages/AppEnablePage.tsx
git commit -m "feat: add OAuth method picker to AppEnablePage"
```

---

### Task 7: Playwright verification

Start the API with fake GitHub OAuth credentials (real exchange will fail but the redirect and UI branching can be verified):

```bash
GITHUB_OAUTH_CLIENT_ID=fake-client-id \
GITHUB_OAUTH_CLIENT_SECRET=fake-client-secret \
JWT_SECRET=dev-secret-key-for-local-development-only \
PORT=3000 \
pnpm --filter api dev
```

Verification steps:

1. Navigate to `/apps` — all platform cards should show "Install"
2. Click Install on **GitHub** — should show the method picker (two options)
3. Click "Use a personal access token" — should show token form with `api_base_url` field (for GHE)
4. Click Back — should return to method picker
5. Click Install on **Sentry** — should go straight to the token form (no picker)
6. Click Install on **Linear** — should go straight to token form (no OAuth credentials configured for Linear)
7. Click "Connect with GitHub" on the picker — should attempt redirect. It will fail at GitHub since the client ID is fake, but check that the browser URL contains `github.com/login/oauth/authorize`

**If any step fails, fix and recheck before moving on.**

**Step: push when green**

```bash
git push
```

---

### How to add a new platform's OAuth later

1. Set `supportsOAuth: true` in its `PLATFORM_REGISTRY` entry (`packages/contracts/src/platform-registry.ts`)
2. Add an entry to `OAUTH_PLATFORM_MAP` in `apps/api/src/lib/oauth-platforms.ts`
3. Add `{PLATFORM}_OAUTH_CLIENT_ID` and `{PLATFORM}_OAUTH_CLIENT_SECRET` to `packages/config/src/env.ts`
4. Rebuild: `pnpm --filter @support-agent/contracts build && pnpm --filter @support-agent/config build`
5. Register your OAuth App with the provider, set the callback URL to `{API_BASE_URL}/v1/connector-oauth/{platformKey}/callback`

No changes needed in the route handlers, platform-types route, or admin UI.
