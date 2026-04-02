# Connector Apps Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the connector system into an app-store experience where each platform (Sentry, Linear, GitHub, etc.) appears as a card with its own icon, description, and platform-specific settings form for API keys, URLs, webhook secrets, etc.

**Architecture:** Add a code-defined platform registry that maps each platform key to its icon, description, category, and config field schema. The PlatformType DB model gains `description` and `category` fields. A new `/v1/platform-types` API serves the registry. The admin UI gets an "Apps" page showing platform cards with Enable/Configure actions. ConnectionSecret records store credentials per connector. No new tables needed — ConnectionSecret already exists.

**Tech Stack:** Fastify API, Prisma, React + TanStack Query, Tailwind CSS, Zod validation

---

## Task 1: Platform Registry — shared contract

Define the per-platform config schema as a shared contract so both API and admin agree on what fields each platform needs.

**Files:**
- Create: `packages/contracts/src/platform-registry.ts`
- Modify: `packages/contracts/src/index.ts` (add export)

**Step 1: Create the platform registry**

```typescript
// packages/contracts/src/platform-registry.ts

export interface PlatformConfigField {
  key: string
  label: string
  type: 'text' | 'password' | 'url' | 'number' | 'toggle'
  placeholder?: string
  helpText?: string
  required: boolean
  secretType?: string // maps to ConnectionSecret.secretType when type=password
}

export interface PlatformRegistryEntry {
  key: string
  displayName: string
  description: string
  category: 'issue-tracker' | 'error-monitoring' | 'version-control' | 'project-management'
  iconSlug: string // used to render the right SVG icon
  defaultDirection: 'inbound' | 'outbound' | 'both'
  defaultIntakeMode: 'webhook' | 'polling' | 'manual'
  supportsCustomServer: boolean
  configFields: PlatformConfigField[]
}

export const PLATFORM_REGISTRY: Record<string, PlatformRegistryEntry> = {
  sentry: {
    key: 'sentry',
    displayName: 'Sentry',
    description: 'Error monitoring and crash reporting. Receive issues via webhook or poll the API.',
    category: 'error-monitoring',
    iconSlug: 'sentry',
    defaultDirection: 'inbound',
    defaultIntakeMode: 'webhook',
    supportsCustomServer: true,
    configFields: [
      { key: 'auth_token', label: 'Auth Token', type: 'password', placeholder: 'sntrys_...', helpText: 'Sentry internal integration token with issue read/write scope', required: true, secretType: 'api_key' },
      { key: 'api_base_url', label: 'API Base URL', type: 'url', placeholder: 'https://sentry.io', helpText: 'Custom URL for self-hosted Sentry instances', required: false },
      { key: 'org_slug', label: 'Organization Slug', type: 'text', placeholder: 'my-org', helpText: 'Your Sentry organization slug', required: true },
      { key: 'webhook_secret', label: 'Webhook Secret', type: 'password', placeholder: 'whsec_...', helpText: 'HMAC signing secret for webhook verification', required: false, secretType: 'webhook_secret' },
      { key: 'integration_id', label: 'Integration ID', type: 'text', placeholder: '12345', helpText: 'Internal integration ID for external issue linking', required: false },
    ],
  },

  crashlytics: {
    key: 'crashlytics',
    displayName: 'Firebase Crashlytics',
    description: 'Crash reporting for mobile apps via Firebase.',
    category: 'error-monitoring',
    iconSlug: 'crashlytics',
    defaultDirection: 'inbound',
    defaultIntakeMode: 'webhook',
    supportsCustomServer: false,
    configFields: [
      { key: 'service_account_json', label: 'Service Account JSON', type: 'password', placeholder: '{"type":"service_account",...}', helpText: 'Firebase service account key (JSON)', required: true, secretType: 'service_account' },
      { key: 'project_id', label: 'Firebase Project ID', type: 'text', placeholder: 'my-firebase-project', helpText: 'The Firebase project ID', required: true },
    ],
  },

  linear: {
    key: 'linear',
    displayName: 'Linear',
    description: 'Issue tracking and project management. Inbound issues and outbound updates.',
    category: 'issue-tracker',
    iconSlug: 'linear',
    defaultDirection: 'both',
    defaultIntakeMode: 'webhook',
    supportsCustomServer: false,
    configFields: [
      { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'lin_api_...', helpText: 'Linear personal or workspace API key', required: true, secretType: 'api_key' },
      { key: 'team_id', label: 'Team ID', type: 'text', placeholder: 'TEAM-abc', helpText: 'The Linear team ID to create issues in', required: true },
      { key: 'project_id', label: 'Project ID', type: 'text', placeholder: 'PROJECT-xyz', helpText: 'Optional project to organize issues under', required: false },
      { key: 'webhook_secret', label: 'Webhook Secret', type: 'password', placeholder: 'whsec_...', helpText: 'HMAC signing secret for webhook verification', required: false, secretType: 'webhook_secret' },
    ],
  },

  github: {
    key: 'github',
    displayName: 'GitHub',
    description: 'Repository integration for PRs, issues, and code review.',
    category: 'version-control',
    iconSlug: 'github',
    defaultDirection: 'both',
    defaultIntakeMode: 'webhook',
    supportsCustomServer: true,
    configFields: [
      { key: 'access_token', label: 'Access Token', type: 'password', placeholder: 'ghp_...', helpText: 'GitHub personal access token or app installation token', required: true, secretType: 'api_key' },
      { key: 'api_base_url', label: 'API Base URL', type: 'url', placeholder: 'https://api.github.com', helpText: 'Custom URL for GitHub Enterprise Server', required: false },
      { key: 'webhook_secret', label: 'Webhook Secret', type: 'password', placeholder: 'whsec_...', helpText: 'HMAC signing secret for webhook verification', required: false, secretType: 'webhook_secret' },
    ],
  },

  github_issues: {
    key: 'github_issues',
    displayName: 'GitHub Issues',
    description: 'Issue tracking via GitHub Issues. Separate from PR/code review integration.',
    category: 'issue-tracker',
    iconSlug: 'github',
    defaultDirection: 'both',
    defaultIntakeMode: 'webhook',
    supportsCustomServer: true,
    configFields: [
      { key: 'access_token', label: 'Access Token', type: 'password', placeholder: 'ghp_...', helpText: 'GitHub personal access token with issues scope', required: true, secretType: 'api_key' },
      { key: 'api_base_url', label: 'API Base URL', type: 'url', placeholder: 'https://api.github.com', helpText: 'Custom URL for GitHub Enterprise Server', required: false },
      { key: 'webhook_secret', label: 'Webhook Secret', type: 'password', placeholder: 'whsec_...', helpText: 'HMAC signing secret for webhook verification', required: false, secretType: 'webhook_secret' },
      { key: 'repo_owner', label: 'Repository Owner', type: 'text', placeholder: 'my-org', helpText: 'GitHub org or user that owns the repo', required: false },
      { key: 'repo_name', label: 'Repository Name', type: 'text', placeholder: 'my-repo', helpText: 'Specific repository to watch', required: false },
    ],
  },

  jira: {
    key: 'jira',
    displayName: 'Jira',
    description: 'Issue tracking and project management from Atlassian.',
    category: 'issue-tracker',
    iconSlug: 'jira',
    defaultDirection: 'both',
    defaultIntakeMode: 'webhook',
    supportsCustomServer: true,
    configFields: [
      { key: 'api_token', label: 'API Token', type: 'password', placeholder: 'ATATT3...', helpText: 'Jira API token (Atlassian account settings)', required: true, secretType: 'api_key' },
      { key: 'user_email', label: 'User Email', type: 'text', placeholder: 'you@company.com', helpText: 'Email associated with the API token', required: true },
      { key: 'api_base_url', label: 'Instance URL', type: 'url', placeholder: 'https://your-org.atlassian.net', helpText: 'Jira Cloud or Server instance URL', required: true },
      { key: 'project_key', label: 'Project Key', type: 'text', placeholder: 'PROJ', helpText: 'Jira project key to watch', required: false },
      { key: 'webhook_secret', label: 'Webhook Secret', type: 'password', placeholder: 'whsec_...', helpText: 'Secret for webhook verification', required: false, secretType: 'webhook_secret' },
    ],
  },

  trello: {
    key: 'trello',
    displayName: 'Trello',
    description: 'Kanban boards and task management.',
    category: 'project-management',
    iconSlug: 'trello',
    defaultDirection: 'both',
    defaultIntakeMode: 'webhook',
    supportsCustomServer: false,
    configFields: [
      { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'Key from trello.com/power-ups/admin', helpText: 'Trello Power-Up API key', required: true, secretType: 'api_key' },
      { key: 'api_token', label: 'API Token', type: 'password', placeholder: 'Token generated after key auth', helpText: 'Trello API token', required: true, secretType: 'api_token' },
      { key: 'board_id', label: 'Board ID', type: 'text', placeholder: 'abc123def', helpText: 'Trello board to watch', required: false },
      { key: 'webhook_secret', label: 'Webhook Secret', type: 'password', placeholder: 'whsec_...', helpText: 'Callback URL verification secret', required: false, secretType: 'webhook_secret' },
    ],
  },

  gitlab: {
    key: 'gitlab',
    displayName: 'GitLab',
    description: 'Repository integration for merge requests, issues, and CI.',
    category: 'version-control',
    iconSlug: 'gitlab',
    defaultDirection: 'both',
    defaultIntakeMode: 'webhook',
    supportsCustomServer: true,
    configFields: [
      { key: 'access_token', label: 'Access Token', type: 'password', placeholder: 'glpat-...', helpText: 'GitLab personal or project access token', required: true, secretType: 'api_key' },
      { key: 'api_base_url', label: 'Instance URL', type: 'url', placeholder: 'https://gitlab.com', helpText: 'Custom URL for self-hosted GitLab', required: false },
      { key: 'webhook_secret', label: 'Webhook Secret', type: 'password', placeholder: 'whsec_...', helpText: 'Secret token for webhook verification', required: false, secretType: 'webhook_secret' },
    ],
  },

  bitbucket: {
    key: 'bitbucket',
    displayName: 'Bitbucket',
    description: 'Repository integration for pull requests, issues, and pipelines.',
    category: 'version-control',
    iconSlug: 'bitbucket',
    defaultDirection: 'both',
    defaultIntakeMode: 'webhook',
    supportsCustomServer: true,
    configFields: [
      { key: 'app_password', label: 'App Password', type: 'password', placeholder: 'ATBB...', helpText: 'Bitbucket app password', required: true, secretType: 'api_key' },
      { key: 'username', label: 'Username', type: 'text', placeholder: 'your-username', helpText: 'Bitbucket username for auth', required: true },
      { key: 'api_base_url', label: 'Instance URL', type: 'url', placeholder: 'https://api.bitbucket.org/2.0', helpText: 'Custom URL for Bitbucket Data Center', required: false },
      { key: 'workspace', label: 'Workspace', type: 'text', placeholder: 'my-workspace', helpText: 'Bitbucket workspace slug', required: false },
      { key: 'webhook_secret', label: 'Webhook Secret', type: 'password', placeholder: 'whsec_...', helpText: 'Secret for webhook verification', required: false, secretType: 'webhook_secret' },
    ],
  },
}

export const PLATFORM_CATEGORIES = [
  { key: 'error-monitoring', label: 'Error Monitoring' },
  { key: 'issue-tracker', label: 'Issue Trackers' },
  { key: 'version-control', label: 'Version Control' },
  { key: 'project-management', label: 'Project Management' },
] as const
```

**Step 2: Export from contracts index**

Add `export * from './platform-registry.js'` to `packages/contracts/src/index.ts`.

**Step 3: Commit**

```bash
git add packages/contracts/src/platform-registry.ts packages/contracts/src/index.ts
git commit -m "feat: add platform registry with per-platform config schemas"
```

---

## Task 2: Prisma migration — add description and category to PlatformType

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (PlatformType model)
- Modify: `apps/api/prisma/seed.ts` (add description + category to seeds)

**Step 1: Add fields to PlatformType model**

In `schema.prisma`, add to the `PlatformType` model:

```prisma
  description      String    @default("")
  category         String    @default("issue-tracker")
```

**Step 2: Run migration**

```bash
cd apps/api && pnpm prisma migrate dev --name add-platform-type-metadata
```

**Step 3: Update seed data**

Update each platform type in `seed.ts` to include `description` and `category` matching the values from `PLATFORM_REGISTRY`.

**Step 4: Run seed**

```bash
cd apps/api && pnpm prisma db seed
```

**Step 5: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat: add description and category to platform_types"
```

---

## Task 3: Platform Types API endpoint

Serve platform types with their registry metadata so the admin UI can render app cards and config forms.

**Files:**
- Create: `apps/api/src/routes/platform-types.ts`
- Modify: `apps/api/src/app.ts` (register route)

**Step 1: Create the route**

```typescript
// apps/api/src/routes/platform-types.ts
import { type FastifyInstance } from 'fastify'
import { PLATFORM_REGISTRY } from '@support-agent/contracts'

export async function platformTypeRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    await request.authenticate()
  })

  // List all platform types with their config schemas
  app.get('/', async () => {
    const dbTypes = await app.prisma.platformType.findMany({
      orderBy: { displayName: 'asc' },
    })

    return dbTypes.map((pt) => {
      const registry = PLATFORM_REGISTRY[pt.key]
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
        configFields: registry?.configFields ?? [],
      }
    })
  })

  // Get single platform type by key
  app.get<{ Params: { key: string } }>('/:key', async (request) => {
    const pt = await app.prisma.platformType.findUnique({
      where: { key: request.params.key },
    })
    if (!pt) throw Object.assign(new Error('Platform type not found'), { statusCode: 404 })

    const registry = PLATFORM_REGISTRY[pt.key]
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
      configFields: registry?.configFields ?? [],
    }
  })
}
```

**Step 2: Register in app.ts**

Add import and register:
```typescript
import { platformTypeRoutes } from './routes/platform-types.js'
// ...
await app.register(platformTypeRoutes, { prefix: '/v1/platform-types' })
```

**Step 3: Commit**

```bash
git add apps/api/src/routes/platform-types.ts apps/api/src/app.ts
git commit -m "feat: add /v1/platform-types API endpoint with config schemas"
```

---

## Task 4: Connection secrets API — store and retrieve credentials

The ConnectionSecret model already exists. Add API endpoints to manage secrets per connector.

**Files:**
- Modify: `apps/api/src/repositories/connector-repository.ts` (add secret methods)
- Modify: `apps/api/src/services/connector-service.ts` (add secret logic)
- Modify: `apps/api/src/routes/connectors.ts` (add secret endpoints)

**Step 1: Add secret methods to repository**

Add to `createConnectorRepository`:

```typescript
async listSecrets(connectorId: string) {
  return prisma.connectionSecret.findMany({
    where: { connectorId },
    select: { id: true, secretType: true, maskedHint: true, createdAt: true, rotatedAt: true },
  })
},

async upsertSecret(connectorId: string, secretType: string, encryptedValue: string, maskedHint: string) {
  const existing = await prisma.connectionSecret.findFirst({
    where: { connectorId, secretType },
  })
  if (existing) {
    return prisma.connectionSecret.update({
      where: { id: existing.id },
      data: { encryptedValue, maskedHint, rotatedAt: new Date() },
    })
  }
  return prisma.connectionSecret.create({
    data: { connectorId, secretType, encryptedValue, maskedHint },
  })
},

async deleteSecret(connectorId: string, secretType: string) {
  return prisma.connectionSecret.deleteMany({
    where: { connectorId, secretType },
  })
},
```

**Step 2: Add secret logic to service**

Add to `createConnectorService`:

```typescript
async getConnectorSecrets(connectorId: string, tenantId: string) {
  await this.getConnector(connectorId, tenantId)
  return repo.listSecrets(connectorId)
},

async setConnectorSecret(connectorId: string, tenantId: string, secretType: string, value: string) {
  await this.getConnector(connectorId, tenantId)
  const masked = value.length > 4 ? `${'*'.repeat(value.length - 4)}${value.slice(-4)}` : '****'
  return repo.upsertSecret(connectorId, secretType, value, masked)
},
```

Note: For the initial implementation, `encryptedValue` stores plaintext. A follow-up task should add envelope encryption. This is acceptable for local dev but must be addressed before production.

**Step 3: Add secret routes**

Add to `connectorRoutes`:

```typescript
// GET /:connectorId/secrets — list masked secrets
app.get<{ Params: { connectorId: string } }>('/:connectorId/secrets', async (request) => {
  return service.getConnectorSecrets(request.params.connectorId, request.user.tenantId)
})

// PUT /:connectorId/secrets — bulk upsert secrets
const UpsertSecretsBody = z.record(z.string(), z.string()) // { secretType: value }
app.put<{ Params: { connectorId: string } }>('/:connectorId/secrets', async (request) => {
  const secrets = UpsertSecretsBody.parse(request.body)
  const results = []
  for (const [secretType, value] of Object.entries(secrets)) {
    if (value) {
      results.push(await service.setConnectorSecret(request.params.connectorId, request.user.tenantId, secretType, value))
    }
  }
  return results
})
```

**Step 4: Commit**

```bash
git add apps/api/src/repositories/connector-repository.ts apps/api/src/services/connector-service.ts apps/api/src/routes/connectors.ts
git commit -m "feat: add connection secrets CRUD API"
```

---

## Task 5: Enhanced connector creation — accept config + secrets in one call

Update the create connector flow to accept platform-specific config and secrets alongside the basic connector fields, so enabling an app is a single action.

**Files:**
- Modify: `apps/api/src/routes/connectors.ts`
- Modify: `apps/api/src/services/connector-service.ts`

**Step 1: Extend CreateConnectorBody**

Update the create body to accept platform key instead of platform type ID, plus config and secrets:

```typescript
const CreateConnectorBody = z.object({
  platformTypeKey: z.string().optional(),
  platformTypeId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  direction: z.enum(['inbound', 'outbound', 'both']),
  configuredIntakeMode: z.enum(['webhook', 'polling', 'manual']),
  apiBaseUrl: z.string().url().optional(),
  pollingIntervalSeconds: z.number().int().min(10).optional(),
  config: z.record(z.string(), z.string()).optional(), // non-secret config fields
  secrets: z.record(z.string(), z.string()).optional(), // secret fields
}).refine(
  (d) => d.platformTypeKey || d.platformTypeId,
  { message: 'Either platformTypeKey or platformTypeId is required' },
)
```

**Step 2: Update createConnector service**

After creating the connector, store any non-secret config in the connector's `capabilities` JSON field and upsert secrets via `setConnectorSecret`.

**Step 3: Commit**

```bash
git add apps/api/src/routes/connectors.ts apps/api/src/services/connector-service.ts
git commit -m "feat: accept config + secrets on connector creation"
```

---

## Task 6: Platform icon SVGs

Create SVG icon components for each platform.

**Files:**
- Create: `apps/admin/src/components/icons/PlatformIcons.tsx`

**Step 1: Create icon components**

Create a file with simple SVG icons for each platform. Each icon is a React component accepting standard SVG props. Use recognizable shapes/colors:

- **Sentry**: The Sentry chevron mark
- **GitHub**: The octocat silhouette
- **Linear**: The Linear mark (lines converging)
- **Jira**: The Jira diamond mark
- **Trello**: The Trello board icon
- **GitLab**: The GitLab fox mark
- **Bitbucket**: The Bitbucket logo
- **Crashlytics**: The Firebase flame

Export a `getPlatformIcon(iconSlug: string)` function that returns the appropriate component.

**Step 2: Commit**

```bash
git add apps/admin/src/components/icons/PlatformIcons.tsx
git commit -m "feat: add platform SVG icons"
```

---

## Task 7: Admin API client — platform types and secrets

**Files:**
- Create: `apps/admin/src/api/platform-types.ts`
- Modify: `apps/admin/src/api/connectors.ts` (add secrets methods)

**Step 1: Create platform types API client**

```typescript
// apps/admin/src/api/platform-types.ts
import { api } from '@/lib/api-client'
import type { PlatformConfigField } from '@support-agent/contracts'

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
  configFields: PlatformConfigField[]
}

export const platformTypesApi = {
  list: () => api.get<PlatformTypeDetail[]>('/v1/platform-types'),
  get: (key: string) => api.get<PlatformTypeDetail>(`/v1/platform-types/${key}`),
}
```

**Step 2: Add secrets methods to connectors API**

Add to `connectorsApi`:

```typescript
getSecrets: (id: string) => api.get<ConnectorSecret[]>(`/v1/connectors/${id}/secrets`),
setSecrets: (id: string, secrets: Record<string, string>) => api.put<void>(`/v1/connectors/${id}/secrets`, secrets),
```

And add the type:

```typescript
export interface ConnectorSecret {
  id: string
  secretType: string
  maskedHint: string | null
  createdAt: string
  rotatedAt: string | null
}
```

**Step 3: Commit**

```bash
git add apps/admin/src/api/platform-types.ts apps/admin/src/api/connectors.ts
git commit -m "feat: add admin API clients for platform types and secrets"
```

---

## Task 8: Apps page — platform cards grid

The main "Apps" page showing all available platforms as cards, grouped by category. Each card shows the platform icon, name, description, and an Enable/Configure button.

**Files:**
- Create: `apps/admin/src/pages/AppsPage.tsx`
- Modify: `apps/admin/src/router/index.tsx` (add route)
- Modify: `apps/admin/src/components/layout/Sidebar.tsx` (add nav item)

**Step 1: Create AppsPage**

```typescript
// apps/admin/src/pages/AppsPage.tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { platformTypesApi, type PlatformTypeDetail } from '@/api/platform-types'
import { connectorsApi } from '@/api/connectors'
import { PageShell } from '@/components/ui/PageShell'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { getPlatformIcon } from '@/components/icons/PlatformIcons'
import { PLATFORM_CATEGORIES } from '@support-agent/contracts'

function StatusBadge({ hasConnector }: { hasConnector: boolean }) {
  if (!hasConnector) return null
  return (
    <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-600">
      Connected
    </span>
  )
}

function PlatformCard({ platform, connectorId }: { platform: PlatformTypeDetail; connectorId?: string }) {
  const Icon = getPlatformIcon(platform.iconSlug)
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-gray-50">
          <Icon className="h-6 w-6" />
        </div>
        <StatusBadge hasConnector={!!connectorId} />
      </div>
      <h3 className="text-sm font-semibold text-gray-900">{platform.displayName}</h3>
      <p className="mt-1 flex-1 text-xs text-gray-500 leading-relaxed">{platform.description}</p>
      <div className="mt-4">
        {connectorId ? (
          <Link to={`/apps/${platform.key}/configure/${connectorId}`}>
            <Button variant="secondary" className="w-full justify-center">Configure</Button>
          </Link>
        ) : (
          <Link to={`/apps/${platform.key}/enable`}>
            <Button variant="primary" className="w-full justify-center">Enable</Button>
          </Link>
        )}
      </div>
    </Card>
  )
}

export default function AppsPage() {
  const { data: platforms, isLoading: loadingPlatforms } = useQuery({
    queryKey: ['platform-types'],
    queryFn: platformTypesApi.list,
  })
  const { data: connectorsData } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => connectorsApi.list({ limit: 100 }),
  })

  if (loadingPlatforms) {
    return <PageShell title="Apps"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  const connectors = connectorsData?.data ?? []
  // Map platformType key -> first connector id
  const connectorByPlatform = new Map<string, string>()
  for (const c of connectors) {
    if (!connectorByPlatform.has(c.platformType)) {
      connectorByPlatform.set(c.platformType, c.id)
    }
  }

  const categories = PLATFORM_CATEGORIES.map((cat) => ({
    ...cat,
    platforms: (platforms ?? []).filter((p) => p.category === cat.key),
  })).filter((cat) => cat.platforms.length > 0)

  return (
    <PageShell title="Apps">
      {categories.map((cat) => (
        <div key={cat.key} className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">{cat.label}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cat.platforms.map((platform) => (
              <PlatformCard
                key={platform.key}
                platform={platform}
                connectorId={connectorByPlatform.get(platform.key)}
              />
            ))}
          </div>
        </div>
      ))}
    </PageShell>
  )
}
```

**Step 2: Add route**

In `router/index.tsx`, add under authenticated children:

```typescript
/* Apps */
{ path: 'apps',                        element: load(() => import('@/pages/AppsPage')) },
{ path: 'apps/:platformKey/enable',    element: load(() => import('@/pages/AppEnablePage')) },
{ path: 'apps/:platformKey/configure/:connectorId', element: load(() => import('@/pages/AppConfigurePage')) },
```

**Step 3: Add sidebar nav item**

Add to Configuration section in Sidebar.tsx, above Connectors:

```typescript
{ label: 'Apps', to: '/apps', icon: <AppsIcon /> },
```

Add `AppsIcon` to `NavIcons.tsx` — a simple grid/blocks icon.

**Step 4: Commit**

```bash
git add apps/admin/src/pages/AppsPage.tsx apps/admin/src/router/index.tsx apps/admin/src/components/layout/Sidebar.tsx apps/admin/src/components/icons/NavIcons.tsx
git commit -m "feat: add Apps page with platform cards grid"
```

---

## Task 9: App Enable page — platform-specific settings form

When a user clicks "Enable" on a platform card, this page renders the platform-specific config form based on `configFields` from the registry and creates a connector with secrets.

**Files:**
- Create: `apps/admin/src/pages/AppEnablePage.tsx`

**Step 1: Create AppEnablePage**

The page:
1. Fetches the platform type by key from the URL param
2. Renders a form with fields from `configFields`
3. On submit, calls `connectorsApi.create()` with config + secrets
4. Redirects to the configure page on success

Key form rendering logic:

```typescript
function ConfigField({ field, value, onChange }: { field: PlatformConfigField; value: string; onChange: (v: string) => void }) {
  const id = `field-${field.key}`
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700 mb-1">
        {field.label}{field.required && <span className="text-signal-red-500"> *</span>}
      </label>
      <input
        id={id}
        type={field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'}
        placeholder={field.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[var(--radius-sm)] border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
      />
      {field.helpText && <p className="mt-1 text-xs text-gray-400">{field.helpText}</p>}
    </div>
  )
}
```

The submit handler separates secret fields (those with `secretType`) from config fields, calls create with the connector data, then calls `setSecrets` with the secret values.

**Step 2: Commit**

```bash
git add apps/admin/src/pages/AppEnablePage.tsx
git commit -m "feat: add App Enable page with platform-specific settings form"
```

---

## Task 10: App Configure page — edit settings for enabled connector

**Files:**
- Create: `apps/admin/src/pages/AppConfigurePage.tsx`

**Step 1: Create AppConfigurePage**

Similar to AppEnablePage but:
1. Loads existing connector + its masked secrets
2. Pre-fills non-secret config fields
3. Shows masked hints for secret fields (with option to replace)
4. Has a Disable/Delete button
5. Updates on save rather than creates

The page shows:
- Connection status indicator
- All config fields with current values
- Secret fields showing masked values with "Update" toggle
- Save and Disable buttons
- Link to triggers configuration

**Step 2: Commit**

```bash
git add apps/admin/src/pages/AppConfigurePage.tsx
git commit -m "feat: add App Configure page for editing connector settings"
```

---

## Task 11: Wire connector config storage

Store non-secret connector config (org_slug, team_id, project_key, etc.) in the `Connector.capabilities` JSON field.

**Files:**
- Modify: `apps/api/src/services/connector-service.ts`

**Step 1: Update createConnector and updateConnector**

When `config` is provided, merge it into the `capabilities` JSON field:

```typescript
// In createConnector, after connector creation:
if (input.config && Object.keys(input.config).length > 0) {
  await repo.update(connector.id, tenantId, {
    capabilities: input.config,
  })
}

// Store secrets
if (input.secrets) {
  for (const [secretType, value] of Object.entries(input.secrets)) {
    if (value) {
      await this.setConnectorSecret(connector.id, tenantId, secretType, value)
    }
  }
}
```

**Step 2: Update getConnector response**

When returning a connector detail, include the config fields from capabilities JSON and masked secrets.

**Step 3: Commit**

```bash
git add apps/api/src/services/connector-service.ts
git commit -m "feat: store platform config in connector capabilities field"
```

---

## Task 12: Playwright clickthrough validation

Run a basic Playwright test to verify the apps page loads, shows platform cards, and the enable flow works.

**Files:**
- Create: `apps/admin/e2e/apps.spec.ts` (or run manual clickthrough)

**Step 1: Start the dev servers**

```bash
cd apps/api && pnpm dev &
cd apps/admin && pnpm dev &
```

**Step 2: Run Playwright clickthrough**

Verify:
1. Navigate to `/apps` — grid of platform cards renders
2. Each card shows icon, name, description
3. Clicking "Enable" on Sentry navigates to `/apps/sentry/enable`
4. Form shows: Auth Token, API Base URL, Organization Slug, Webhook Secret, Integration ID
5. Fill required fields and submit — connector created, redirect to configure page
6. Configure page shows saved values with masked secrets

**Step 3: Fix any issues and commit**

```bash
git add -A
git commit -m "feat: apps page e2e validation pass"
```

---

## Summary

| Task | What | Key Files |
|------|------|-----------|
| 1 | Platform registry contract | `packages/contracts/src/platform-registry.ts` |
| 2 | DB migration: platformType metadata | `apps/api/prisma/schema.prisma`, `seed.ts` |
| 3 | `/v1/platform-types` API | `apps/api/src/routes/platform-types.ts` |
| 4 | Connection secrets API | connector repo + service + routes |
| 5 | Enhanced connector creation | connector routes + service |
| 6 | Platform SVG icons | `apps/admin/src/components/icons/PlatformIcons.tsx` |
| 7 | Admin API clients | `apps/admin/src/api/platform-types.ts` |
| 8 | Apps page with cards grid | `apps/admin/src/pages/AppsPage.tsx` |
| 9 | App Enable page (settings form) | `apps/admin/src/pages/AppEnablePage.tsx` |
| 10 | App Configure page (edit) | `apps/admin/src/pages/AppConfigurePage.tsx` |
| 11 | Config storage wiring | connector service |
| 12 | Playwright validation | e2e test |
