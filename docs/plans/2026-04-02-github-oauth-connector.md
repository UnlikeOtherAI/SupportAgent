# GitHub OAuth Connector

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When installing GitHub or GitHub Issues connectors, offer two auth methods — paste a Personal Access Token, or connect via our registered GitHub OAuth App — and extend the same pattern to any future platform that supports OAuth.

**Architecture:** `PlatformRegistryEntry` gains a `supportsOAuth` flag. The platform-types API exposes a computed `oauthAvailable` field (true when env credentials are also configured). A new route file `connector-oauth.ts` handles the two OAuth endpoints: `start` (authenticated, returns a redirect URL) and `callback` (public, exchanges code, stores token, redirects to admin). `AppEnablePage` shows a method-picker when `oauthAvailable` is true; the token path is the existing form unchanged.

**Tech Stack:** React, TanStack Query, React Router, Fastify, `jose` (already used in auth), Zod, `@support-agent/contracts`, `@support-agent/config`

---

### Task 1: Extend platform registry and env config

**Files:**
- Modify: `packages/contracts/src/platform-registry.ts`
- Modify: `packages/config/src/env.ts`

**Step 1: Add `supportsOAuth` to `PlatformRegistryEntry`**

In `packages/contracts/src/platform-registry.ts`, add the optional field to the interface:

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
  supportsOAuth: boolean;        // ← add
  configFields: PlatformConfigField[];
}
```

**Step 2: Set `supportsOAuth` on every existing entry**

Every entry already in `PLATFORM_REGISTRY` needs the new field. Set `supportsOAuth: false` for all except `github` and `github_issues`, which get `supportsOAuth: true`.

For `github` (line ~153):
```ts
  supportsCustomServer: true,
  supportsOAuth: true,        // ← add
  configFields: [
```

For `github_issues` (line ~191):
```ts
  supportsCustomServer: true,
  supportsOAuth: true,        // ← add
  configFields: [
```

For all others (`sentry`, `crashlytics`, `linear`, `jira`, `trello`, `gitlab`, `bitbucket`):
```ts
  supportsCustomServer: ...,
  supportsOAuth: false,       // ← add
  configFields: [
```

**Step 3: Add GitHub OAuth env vars to config schema**

In `packages/config/src/env.ts`, add two optional fields to `envSchema`:

```ts
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
```

Place them after the `ADMIN_APP_URL` line.

**Step 4: Rebuild the contracts and config packages**

```bash
pnpm --filter @support-agent/contracts build
pnpm --filter @support-agent/config build
```

Expected: both complete without errors.

**Step 5: Commit**

```bash
git add packages/contracts/src/platform-registry.ts packages/config/src/env.ts
git commit -m "feat: add supportsOAuth to platform registry, GitHub OAuth env vars"
```

---

### Task 2: Expose `oauthAvailable` in the platform-types API

**Files:**
- Modify: `apps/api/src/routes/platform-types.ts`

**Step 1: Import `getEnv`**

At the top of the file, add:
```ts
import { getEnv } from '@support-agent/config';
```

**Step 2: Update `enrichPlatformType` to accept env and return `oauthAvailable`**

Replace the current `enrichPlatformType` function signature and return shape:

```ts
function enrichPlatformType(
  pt: PlatformTypeRecord,
  env: ReturnType<typeof getEnv>,
) {
  const registry = PLATFORM_REGISTRY[pt.key];

  const supportsOAuth = registry?.supportsOAuth ?? false;
  const oauthAvailable =
    supportsOAuth &&
    (pt.key === 'github' || pt.key === 'github_issues')
      ? !!(env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET)
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

**Step 3: Thread env into both route handlers**

In the `GET /` handler:
```ts
app.get('/', async () => {
  const env = getEnv();
  const platformTypes = await app.prisma.platformType.findMany({
    orderBy: { displayName: 'asc' },
  });
  return platformTypes.map((pt) => enrichPlatformType(pt, env));
});
```

In the `GET /:key` handler:
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

Expected: no errors.

**Step 5: Commit**

```bash
git add apps/api/src/routes/platform-types.ts
git commit -m "feat: expose oauthAvailable on platform type responses"
```

---

### Task 3: Add OAuth connector routes

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

// Per-platform OAuth wiring. Add entries here as more platforms gain OAuth support.
const OAUTH_CONFIGS: Record<
  string,
  { authorizeUrl: string; tokenUrl: string; scopes: string[] }
> = {
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:org'],
  },
  github_issues: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:org'],
  },
};

function getGitHubCredentials(env: ReturnType<typeof getEnv>) {
  return {
    clientId: env.GITHUB_OAUTH_CLIENT_ID,
    clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
  };
}

export async function connectorOAuthRoutes(app: FastifyInstance) {
  const repo = createConnectorRepository(app.prisma);
  const service = createConnectorService(repo, app.prisma);

  /**
   * GET /v1/connector-oauth/:platformKey/start?connectorId=<id>
   *
   * Authenticated. Creates a signed state JWT, builds the provider
   * authorize URL, and returns it as JSON. The frontend redirects.
   */
  app.get<{
    Params: { platformKey: string };
    Querystring: { connectorId: string };
  }>('/:platformKey/start', async (request, reply) => {
    await request.authenticate();
    const { platformKey } = request.params;
    const { connectorId } = request.query;
    const { tenantId } = request.user;

    const oauthConfig = OAUTH_CONFIGS[platformKey];
    if (!oauthConfig) {
      return reply.status(404).send({ error: 'OAuth not supported for this platform' });
    }

    const env = getEnv();
    const { clientId } = getGitHubCredentials(env);
    if (!clientId) {
      return reply.status(503).send({ error: 'OAuth not configured on server' });
    }

    // Verify connector belongs to this tenant before issuing the flow
    await service.getConnector(connectorId, tenantId);

    const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);
    const state = await new SignJWT({ connectorId, tenantId, platformKey })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(jwtSecret);

    const callbackUrl = `${env.API_BASE_URL}/v1/connector-oauth/${platformKey}/callback`;
    const url = new URL(oauthConfig.authorizeUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('scope', oauthConfig.scopes.join(' '));
    url.searchParams.set('state', state);

    return { redirectUrl: url.toString() };
  });

  /**
   * GET /v1/connector-oauth/:platformKey/callback?code=&state=
   *
   * Public (no Bearer required). GitHub redirects here.
   * Exchanges code, stores access token as connector secret, redirects to admin.
   */
  app.get<{
    Params: { platformKey: string };
    Querystring: { code?: string; state?: string; error?: string };
  }>('/:platformKey/callback', async (request, reply) => {
    const { platformKey } = request.params;
    const { code, state, error } = request.query;
    const env = getEnv();
    const adminUrl = env.ADMIN_APP_URL;

    const oauthConfig = OAUTH_CONFIGS[platformKey];
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
    const { clientId, clientSecret } = getGitHubCredentials(env);
    if (!clientId || !clientSecret) {
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
        client_id: clientId,
        client_secret: clientSecret,
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

Add the import at the top with the other route imports:
```ts
import { connectorOAuthRoutes } from './routes/connector-oauth.js';
```

Add the registration after the connectors route:
```ts
await app.register(connectorOAuthRoutes, { prefix: '/v1/connector-oauth' });
```

**Step 3: Check TypeScript**

```bash
pnpm --filter api exec tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add apps/api/src/routes/connector-oauth.ts apps/api/src/app.ts
git commit -m "feat: add connector OAuth routes (start + callback) for GitHub"
```

---

### Task 4: Update admin API client

**Files:**
- Modify: `apps/admin/src/api/platform-types.ts`
- Modify: `apps/admin/src/api/connectors.ts`

**Step 1: Add `oauthAvailable` to `PlatformTypeDetail`**

In `apps/admin/src/api/platform-types.ts`, add the field:

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
  oauthAvailable: boolean          // ← add
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

**Step 3: Check TypeScript**

```bash
pnpm --filter admin exec tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add apps/admin/src/api/platform-types.ts apps/admin/src/api/connectors.ts
git commit -m "feat: add oauthAvailable to PlatformTypeDetail, getOAuthStartUrl to connectorsApi"
```

---

### Task 5: Update AppEnablePage with method picker

**Files:**
- Modify: `apps/admin/src/pages/AppEnablePage.tsx`

**Step 1: Add `useMutation` import**

`useMutation` is already imported. Verify the imports at the top still include:
```ts
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { platformTypesApi } from '@/api/platform-types'
import { connectorsApi } from '@/api/connectors'
import { PageShell } from '@/components/ui/PageShell'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PlatformIcon } from '@/components/icons/PlatformIcons'
```

**Step 2: Rewrite `AppEnablePage`**

Replace the full file content with:

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
  // 'choose' = method picker (only shown when oauthAvailable), 'token' = PAT form
  const [authMethod, setAuthMethod] = useState<'choose' | 'token'>('choose')

  const { data: platform, isLoading } = useQuery({
    queryKey: ['platform-type', platformKey],
    queryFn: () => platformTypesApi.get(platformKey ?? ''),
    enabled: !!platformKey,
  })

  // OAuth flow: create connector then get redirect URL
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

  // Token flow: create connector with secrets from form
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
    return <PageShell title="Enable App"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!platform) {
    return <PageShell title="Enable App"><p className="text-sm text-gray-400">Platform not found</p></PageShell>
  }

  // Method picker — shown when OAuth is available and user hasn't picked yet
  if (platform.oauthAvailable && authMethod === 'choose') {
    return (
      <PageShell title={`Connect ${platform.displayName}`}>
        <Link to="/apps" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Apps</Link>
        <Card className="max-w-md">
          <CardHeader title={`Connect ${platform.displayName}`} subtitle="Choose how to authenticate" />
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-gray-50 mx-5 mt-1">
            <PlatformIcon slug={platform.iconSlug} className="h-6 w-6 text-gray-700" />
          </div>
          <div className="space-y-3 px-5 py-5">
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
                  {oauthMutation.isPending ? 'Redirecting...' : `Connect with ${platform.displayName}`}
                </p>
                <p className="text-xs text-gray-500">Authorize via our OAuth app — no tokens to copy</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => { setAuthMethod('token') }}
              className="flex w-full items-center gap-4 rounded-[var(--radius-sm)] border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:border-gray-300 hover:bg-gray-50"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-gray-50">
                <span className="text-base">🔑</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Use a personal access token</p>
                <p className="text-xs text-gray-500">Paste a PAT if you prefer manual credential management</p>
              </div>
            </button>

            {error && <p className="text-sm text-signal-red-500">{error}</p>}
          </div>
        </Card>
      </PageShell>
    )
  }

  // Token form (default when no OAuth, or user chose token)
  return (
    <PageShell title={`Enable ${platform.displayName}`}>
      <Link to="/apps" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Apps</Link>

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
              {createMutation.isPending ? 'Enabling...' : 'Enable'}
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

**Step 3: Check TypeScript**

```bash
pnpm --filter admin exec tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add apps/admin/src/pages/AppEnablePage.tsx
git commit -m "feat: add OAuth method picker to AppEnablePage for GitHub"
```

---

### Task 6: Verify in Playwright

Start the dev server with GitHub OAuth credentials set (use fake values for local testing — we're only verifying the UI branching, not a real GitHub round-trip):

```bash
GITHUB_OAUTH_CLIENT_ID=fake-client-id \
GITHUB_OAUTH_CLIENT_SECRET=fake-secret \
JWT_SECRET=dev-secret-key-for-local-development-only \
PORT=3000 \
pnpm --filter api dev
```

Then in Playwright:

1. Navigate to `/apps`
2. Click Install on **GitHub** — should land on method picker with two options
3. Click "Use a personal access token" — should show the PAT form
4. Click Back — should return to method picker
5. Click Install on **Sentry** — should go straight to the token form (no picker)
6. Click "Connect with GitHub" — should redirect (will fail with GitHub error since client_id is fake, but the redirect URL should contain `github.com/login/oauth/authorize`)

**Step 1: Run verification**

Navigate and screenshot key states.

**Step 2: Fix anything broken and re-run**

**Step 3: Push**

```bash
git push
```

---

### Notes on GitHub App setup

To wire this up in production:
1. Create a GitHub OAuth App at `https://github.com/settings/developers`
2. Set Homepage URL and Authorization callback URL to `${API_BASE_URL}/v1/connector-oauth/github/callback`
3. Set `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` env vars on the API
4. The same OAuth App serves both `github` and `github_issues` connectors (same scopes)

To add OAuth support for a future platform (e.g. GitLab):
1. Set `supportsOAuth: true` in its `PLATFORM_REGISTRY` entry
2. Add an entry to `OAUTH_CONFIGS` in `connector-oauth.ts`
3. Add env vars for its client ID/secret (e.g. `GITLAB_OAUTH_CLIENT_ID`)
4. Add those vars to the config schema
5. Update the `oauthAvailable` logic in `platform-types.ts`
