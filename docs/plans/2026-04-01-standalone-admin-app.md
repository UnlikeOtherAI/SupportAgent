# Standalone Admin App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the full standalone admin UI at `apps/admin/`, deployable to `app.appbuildbox.com`, covering every operator workflow from login through triage, build, merge, connectors, routing, channels, providers, and settings.

**Architecture:** CSR React SPA (Vite + React Router) backed by the existing API. Each page is a route slice scaffolded with `wf` CLI, wired to real TanStack Query calls, and validated with a Playwright clickthrough before the next slice starts. Auth is a login-first guard; every protected route redirects to `/login` when the bearer token is absent.

**Tech Stack:** React 18, Vite, TypeScript, Tailwind CSS, React Router v6, TanStack Query v5, Zustand (Zustand only for auth token + sidebar state), Zod-backed form validation.

---

## Page Inventory & Route Map

Before implementation, here is the complete set of routes this plan builds:

| Route | Page | Nav group |
|---|---|---|
| `/login` | Login | Auth |
| `/setup` | First-run onboarding wizard | Auth |
| `/` → redirect | — | — |
| `/dashboard` | Overview dashboard | Dashboard |
| `/runs` | Workflow runs list | Jobs |
| `/runs/:id` | Run detail + live log (read-only) | Jobs |
| `/connectors` | Connectors list | Connectors |
| `/connectors/new` | Add connector wizard | Connectors |
| `/connectors/:id` | Connector detail (read-only) | Connectors |
| `/connectors/:id/edit` | Connector edit form | Connectors |
| `/connectors/:id/triggers` | Trigger policy configuration | Connectors |
| `/repositories` | Repository mappings list | Repositories |
| `/repositories/new` | Create mapping form | Repositories |
| `/repositories/:id` | Mapping detail (read-only) | Repositories |
| `/repositories/:id/edit` | Mapping edit form | Repositories |
| `/routing` | Routing rules list | Routing |
| `/routing/rules/new` | Create routing rule form | Routing |
| `/routing/rules/:id` | Routing rule detail (read-only) | Routing |
| `/routing/rules/:id/edit` | Routing rule edit form | Routing |
| `/routing/destinations` | Outbound destinations list | Routing |
| `/routing/destinations/new` | Add outbound destination form | Routing |
| `/routing/destinations/:id` | Destination detail (read-only) | Routing |
| `/routing/destinations/:id/edit` | Destination edit form | Routing |
| `/scenarios` | Workflow scenarios list | Scenarios |
| `/scenarios/new` | Create scenario form | Scenarios |
| `/scenarios/:id` | Scenario detail (read-only) | Scenarios |
| `/scenarios/:id/edit` | Scenario edit form | Scenarios |
| `/channels` | Communication channels list | Channels |
| `/channels/new` | Add channel wizard | Channels |
| `/channels/:id` | Channel detail (pairing status, allowed actions) | Channels |
| `/channels/:id/edit` | Channel edit form | Channels |
| `/providers` | Execution providers list | Providers |
| `/providers/new` | Register provider form | Providers |
| `/providers/:id` | Provider detail (hosts panel, session state) | Providers |
| `/providers/:id/edit` | Provider edit form | Providers |
| `/api-keys` | Runtime API keys list | Providers |
| `/api-keys/new` | Create API key (one-time reveal) | Providers |
| `/review-profiles` | Review profiles list | Review |
| `/review-profiles/new` | Create review profile form | Review |
| `/review-profiles/:id` | Review profile detail (read-only) | Review |
| `/review-profiles/:id/edit` | Review profile edit form | Review |
| `/settings` | Tenant / org settings | Settings |
| `/settings/identity` | Identity provider (SSO) config | Settings |
| `/settings/users` | Users & roles | Settings |
| `/settings/audit` | Audit log | Settings |

---

## Task 1: Workspace and App Scaffold

**Files:**
- Create: `apps/admin/` (entire package)
- Modify: `pnpm-workspace.yaml` (already covers `apps/*` — no change needed)
- Modify: `turbo.json` (add `admin` pipeline entry if missing)

**Step 1: Init the Vite React TS app**

```bash
cd /System/Volumes/Data/.internal/projects/Projects/SupportAgent
pnpm create vite apps/admin --template react-ts
cd apps/admin
pnpm install
```

**Step 2: Install dependencies**

```bash
pnpm add react-router-dom @tanstack/react-query @tanstack/react-query-devtools zustand zod react-hook-form @hookform/resolvers
pnpm add -D tailwindcss @tailwindcss/forms autoprefixer postcss
npx tailwindcss init -p
```

**Step 3: Configure Tailwind**

`apps/admin/tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss'
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [require('@tailwindcss/forms')],
} satisfies Config
```

`apps/admin/src/index.css` — replace with:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Step 4: Create directory skeleton**

```
apps/admin/src/
  app/
    App.tsx           ← QueryClientProvider + RouterProvider wrapper
  api/
    client.ts         ← central fetch wrapper with bearer token injection
    auth.ts
    runs.ts
    connectors.ts
    repositories.ts
    routing.ts
    scenarios.ts
    channels.ts
    providers.ts
    review-profiles.ts
    settings.ts
  features/           ← one sub-dir per nav group (scaffold stubs now, fill per task)
  pages/              ← route containers import features
  router/
    index.tsx         ← route tree
    AuthGuard.tsx     ← redirects to /login if no token
  shared/
    Layout.tsx        ← shell: sidebar nav + top bar
    Sidebar.tsx
    PageShell.tsx     ← heading + breadcrumb wrapper
    ErrorBoundary.tsx
  lib/
    auth-store.ts     ← Zustand: token, user
    query-client.ts
    errors.ts
  types/
    api.ts            ← shared response envelope types
```

**Step 5: Wire `main.tsx`**

```tsx
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

**Step 6: Verify dev server starts**

```bash
pnpm --filter admin dev
```
Expected: Vite dev server running, blank page with no console errors.

**Step 7: Commit**

```bash
git add apps/admin
git commit -m "feat: scaffold admin app (Vite + React + Tailwind + Router + TanStack Query)"
```

---

## Task 2: Auth Layer — Login Page + Guard

The login page renders a centred logo above a card containing one button per enabled SSO provider. There are no credential inputs. Clicking a button navigates the browser to that provider's `startUrl`. The provider completes its own auth flow and redirects back to `/auth/callback`, where the API exchanges the code for a Support Agent bearer token.

Reference: `docs/identity-providers.md` — server-driven provider button model, `GET /v1/auth/providers` response shape, `startUrl` field, callback flow.

**Files:**
- Create: `apps/admin/src/pages/LoginPage.tsx`
- Create: `apps/admin/src/pages/AuthCallbackPage.tsx`
- Create: `apps/admin/src/features/auth/ProviderButtons.tsx`
- Create: `apps/admin/src/api/auth.ts`
- Create: `apps/admin/src/lib/auth-store.ts`
- Create: `apps/admin/src/router/AuthGuard.tsx`
- Create: `apps/admin/src/router/index.tsx`
- Create: `apps/admin/public/logo.svg` (placeholder — replace with real asset)

**Routes:** `/login`, `/auth/callback`

**API calls used:**
- `GET /v1/auth/providers` — `{ providers: [{ key, label, buttonText, iconUrl, startUrl }] }`
- `GET /v1/auth/providers/:providerKey/callback?code=&state=` — API-side callback that exchanges code and returns `{ token, userId }`

**Step 1: Auth store**

`src/lib/auth-store.ts`:
```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  token: string | null
  userId: string | null
  setAuth: (token: string, userId: string) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userId: null,
      setAuth: (token, userId) => set({ token, userId }),
      clearAuth: () => set({ token: null, userId: null }),
    }),
    { name: 'sa-auth' }
  )
)
```

**Step 2: API client**

`src/api/client.ts`:
```ts
import { useAuthStore } from '../lib/auth-store'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export async function apiRequest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = useAuthStore.getState().token
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body.message ?? res.statusText), {
      status: res.status,
      body,
    })
  }
  return res.json() as Promise<T>
}
```

**Step 3: Auth API module**

`src/api/auth.ts`:
```ts
import { apiRequest } from './client'

export interface IdentityProvider {
  key: string
  label: string
  buttonText: string
  iconUrl: string | null
  startUrl: string
}

export const getProviders = () =>
  apiRequest<{ providers: IdentityProvider[] }>('/v1/auth/providers')
```

**Step 4: ProviderButtons component**

`src/features/auth/ProviderButtons.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query'
import { getProviders } from '../../api/auth'

export function ProviderButtons() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: getProviders,
  })

  if (isLoading) {
    return <div className="text-center text-sm text-gray-400">Loading…</div>
  }

  if (isError) {
    return (
      <div className="text-center text-sm text-red-500">
        Could not load sign-in options. Please try again.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {data?.providers.map((p) => (
        <a
          key={p.key}
          href={p.startUrl}
          className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100"
        >
          {p.iconUrl && (
            <img src={p.iconUrl} alt="" className="h-4 w-4 object-contain" />
          )}
          {p.buttonText}
        </a>
      ))}
    </div>
  )
}
```

**Step 5: Login page**

```
/login layout:

  ┌─────────────────────────┐
  │                         │
  │      [Logo]             │  ← logo.svg, centered
  │                         │
  │  ┌─────────────────┐    │
  │  │  Sign in        │    │  ← card
  │  │                 │    │
  │  │  [SSO Button 1] │    │
  │  │  [SSO Button 2] │    │
  │  └─────────────────┘    │
  │                         │
  └─────────────────────────┘
```

`src/pages/LoginPage.tsx`:
```tsx
import { ProviderButtons } from '../features/auth/ProviderButtons'

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gray-50 px-4">
      <img src="/logo.svg" alt="AppBuildBox" className="h-10" />
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-900/5">
        <h1 className="mb-6 text-center text-lg font-semibold text-gray-900">
          Sign in to AppBuildBox
        </h1>
        <ProviderButtons />
      </div>
    </div>
  )
}
```

**Step 6: Auth callback page**

After the provider redirects back, this page reads `code` and `state` from the URL, calls the API, stores the token, and navigates to `/dashboard` (or `/setup` if onboarding is required).

`src/pages/AuthCallbackPage.tsx`:
```tsx
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../lib/auth-store'

// The API callback route handles code exchange server-side and redirects here
// with token and userId as query params, or with an error param.
export default function AuthCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)

  useEffect(() => {
    const token = params.get('token')
    const userId = params.get('userId')
    const error = params.get('error')

    if (error || !token || !userId) {
      navigate('/login?error=' + (error ?? 'callback_failed'), { replace: true })
      return
    }

    setAuth(token, userId)
    navigate('/dashboard', { replace: true })
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <p className="text-sm text-gray-400">Completing sign-in…</p>
    </div>
  )
}
```

**Step 7: Auth guard**

`src/router/AuthGuard.tsx`:
```tsx
import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../lib/auth-store'

export function AuthGuard() {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <Outlet />
}
```

**Step 8: Route tree skeleton (all routes stubbed)**

`src/router/index.tsx`:
```tsx
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { AuthGuard } from './AuthGuard'
import { Layout } from '../shared/Layout'

const load = (fn: () => Promise<{ default: React.ComponentType }>) =>
  lazy(fn)

const LoginPage = load(() => import('../pages/LoginPage'))
const AuthCallbackPage = load(() => import('../pages/AuthCallbackPage'))
const DashboardPage = load(() => import('../pages/DashboardPage'))
// ... (other pages added per task)

export const router = createBrowserRouter([
  { path: '/login', element: <Suspense><LoginPage /></Suspense> },
  { path: '/auth/callback', element: <Suspense><AuthCallbackPage /></Suspense> },
  {
    element: <AuthGuard />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: 'dashboard', element: <Suspense><DashboardPage /></Suspense> },
          // routes added per task below
        ],
      },
    ],
  },
])
```

**Step 9: Write failing test**

`apps/admin/tests/login.spec.ts`:
```ts
test('login page shows logo and SSO provider buttons', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('img', { name: /appbuildbox/i })).toBeVisible()
  // buttons rendered from mocked /v1/auth/providers response
  await expect(page.getByRole('link', { name: /sign in with/i }).first()).toBeVisible()
})

test('unauthenticated / redirects to /login', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})
```

**Step 10: Run Playwright clickthrough**

```bash
pnpm --filter admin playwright test tests/login.spec.ts
```
Expected: logo visible, at least one SSO button visible (from mocked API), redirect works.

**Step 11: Commit**

```bash
git add apps/admin
git commit -m "feat: login page — logo, SSO provider buttons, auth callback handler, bearer guard"
```

---

## Task 3: App Shell — Layout, Sidebar, and PageShell

**Files:**
- Create: `apps/admin/src/shared/Layout.tsx`
- Create: `apps/admin/src/shared/Sidebar.tsx`
- Create: `apps/admin/src/shared/PageShell.tsx`

The shell is needed before any protected page can be built and click-tested.

**Step 1: Sidebar nav definition**

`src/shared/Sidebar.tsx`:
```tsx
import { NavLink } from 'react-router-dom'

const NAV = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Jobs', to: '/runs' },
  { label: 'Connectors', to: '/connectors' },
  { label: 'Repositories', to: '/repositories' },
  { label: 'Routing', to: '/routing' },
  { label: 'Scenarios', to: '/scenarios' },
  { label: 'Channels', to: '/channels' },
  { label: 'Providers', to: '/providers' },
  { label: 'API Keys', to: '/api-keys' },
  { label: 'Review', to: '/review-profiles' },
  { label: 'Settings', to: '/settings' },
]

export function Sidebar() {
  return (
    <nav className="flex h-full w-56 flex-col gap-1 border-r border-gray-200 bg-white px-3 py-4">
      <span className="mb-4 px-2 text-sm font-semibold text-gray-900">AppBuildBox</span>
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `rounded-md px-3 py-2 text-sm font-medium ${
              isActive
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
```

**Step 2: Layout**

`src/shared/Layout.tsx`:
```tsx
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function Layout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-gray-50 p-6">
        <Outlet />
      </main>
    </div>
  )
}
```

**Step 3: PageShell**

`src/shared/PageShell.tsx`:
```tsx
interface PageShellProps {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}

export function PageShell({ title, action, children }: PageShellProps) {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        {action}
      </div>
      {children}
    </div>
  )
}
```

**Step 4: Stub DashboardPage so layout can render**

`src/pages/DashboardPage.tsx`:
```tsx
import { PageShell } from '../shared/PageShell'

export default function DashboardPage() {
  return <PageShell title="Dashboard"><p className="text-gray-500">Loading…</p></PageShell>
}
```

**Step 5: Playwright clickthrough**

```bash
pnpm --filter admin playwright test tests/shell.spec.ts
```
Expected: sidebar renders, `/dashboard` loads without error.

**Step 6: Commit**

```bash
git commit -m "feat: admin app shell — sidebar nav, layout, page shell"
```

---

## Task 4: Dashboard Page

**Route:** `/dashboard`

**API calls:**
- `GET /v1/workflow-runs?status=active&limit=5` — recent active runs
- `GET /v1/connectors?limit=100` — connector count
- `GET /v1/workflow-runs?limit=10&sort=createdAt:desc` — recent runs

**Page content:**
- Stat cards: Active runs, Total connectors, Total findings this week
- Recent runs table (last 10): run ID, type, status, started at, repository
- Quick links to Connectors and Repositories if zero are configured

**Files:**
- Create: `apps/admin/src/features/dashboard/StatsBar.tsx`
- Create: `apps/admin/src/features/dashboard/RecentRunsTable.tsx`
- Create: `apps/admin/src/api/runs.ts`
- Modify: `apps/admin/src/pages/DashboardPage.tsx`

**Step 1: Write failing test**

`apps/admin/tests/dashboard.spec.ts`:
```ts
test('dashboard shows stat cards and recent runs heading', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.getByText('Active runs')).toBeVisible()
  await expect(page.getByText('Recent runs')).toBeVisible()
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter admin playwright test tests/dashboard.spec.ts
```
Expected: FAIL — stat cards not rendered.

**Step 3: Implement DashboardPage**

Wire `StatsBar` and `RecentRunsTable` using TanStack Query. Stat cards show `—` while loading.

**Step 4: Run test to verify it passes**

```bash
pnpm --filter admin playwright test tests/dashboard.spec.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git commit -m "feat: dashboard page — stat cards and recent runs table"
```

---

## Task 5: Workflow Runs List Page

**Route:** `/runs`

**API calls:**
- `GET /v1/workflow-runs?page=1&limit=25&type=<filter>&status=<filter>`

**Page content:**
- Filter bar: workflow type (triage / build / merge / all), status (all / queued / running / succeeded / failed)
- Table: run ID, type badge, status badge, connector name, repository, started at, elapsed, link to detail
- Pagination

**Files:**
- Create: `apps/admin/src/features/runs/RunsTable.tsx`
- Create: `apps/admin/src/features/runs/RunFilters.tsx`
- Create: `apps/admin/src/pages/RunsPage.tsx`
- Modify: `apps/admin/src/api/runs.ts`

**Step 1: Write failing test**

```ts
test('runs page shows type filter and table header', async ({ page }) => {
  await page.goto('/runs')
  await expect(page.getByRole('combobox', { name: /type/i })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /status/i })).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

**Step 5: Commit**

```bash
git commit -m "feat: workflow runs list page — filter bar, table, pagination"
```

---

## Task 6: Workflow Run Detail Page (Live Log)

**Route:** `/runs/:id`

**API calls:**
- `GET /v1/workflow-runs/:id` — run record
- `GET /v1/workflow-runs/:id/logs` — log events (polled or streamed)
- `GET /v1/workflow-runs/:id/findings` — findings when run is complete
- `POST /v1/workflow-runs/:id/cancel` — cancel action button

**Page content:**
- Header: run type badge, status badge, started / elapsed, repository name, connector name
- Progress indicator (step names from run record, highlighted current step)
- Live log panel: auto-scrolling, monospace, timestamps, log level coloring
- Findings accordion (visible once run has findings)
- Actions: Cancel (when running), Trigger Build (when triage succeeded)

**Files:**
- Create: `apps/admin/src/features/runs/RunHeader.tsx`
- Create: `apps/admin/src/features/runs/LogViewer.tsx`
- Create: `apps/admin/src/features/runs/FindingsPanel.tsx`
- Create: `apps/admin/src/pages/RunDetailPage.tsx`

**Step 1: Write failing test**

```ts
test('run detail page shows log viewer section', async ({ page }) => {
  await page.goto('/runs/test-run-id')
  await expect(page.getByTestId('log-viewer')).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

Key implementation notes:
- Poll `GET /v1/workflow-runs/:id/logs?after=<cursor>` every 2 s while run status is `running` or `queued`. Stop polling when status is terminal.
- Use `useQuery` with `refetchInterval` controlled by run status.
- Log viewer must auto-scroll to bottom unless user has manually scrolled up.

**Step 5: Commit**

```bash
git commit -m "feat: run detail page — live log viewer, findings panel, run actions"
```

---

## Task 7: Connectors List Page

**Route:** `/connectors`

**API calls:**
- `GET /v1/connectors?page=1&limit=25`

**Page content:**
- Table: connector name, platform type, roles (inbound / outbound / both), intake mode (webhook / polling), status (healthy / degraded / unconfigured)
- "Add connector" CTA button → `/connectors/new`
- Per-row action: Edit, View triggers

**Files:**
- Create: `apps/admin/src/features/connectors/ConnectorsTable.tsx`
- Create: `apps/admin/src/api/connectors.ts`
- Create: `apps/admin/src/pages/ConnectorsPage.tsx`

**Step 1: Write failing test**

```ts
test('connectors page shows table and add button', async ({ page }) => {
  await page.goto('/connectors')
  await expect(page.getByRole('link', { name: /add connector/i })).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

**Step 5: Commit**

```bash
git commit -m "feat: connectors list page"
```

---

## Task 8: Add Connector Wizard

**Route:** `/connectors/new`

This is a multi-step form wizard. Each step is a separate component.

**Steps:**
1. Choose platform type (Sentry, Linear, GitHub Issues, Jira, Trello, GitHub, GitLab, etc.)
2. Enter credentials / OAuth flow for chosen platform
3. Choose connector roles: inbound, outbound, or both
4. Run capability discovery (POST to API, show results: webhook available / polling only)
5. Review and save

**API calls:**
- `GET /v1/connectors/platform-types` — list of supported platforms with metadata
- `POST /v1/connectors` — create connector
- `POST /v1/connectors/:id/discover-capabilities` — trigger capability check
- `GET /v1/connectors/:id/capabilities` — fetch capability results

**Files:**
- Create: `apps/admin/src/features/connectors/wizard/ConnectorWizard.tsx`
- Create: `apps/admin/src/features/connectors/wizard/StepPlatform.tsx`
- Create: `apps/admin/src/features/connectors/wizard/StepCredentials.tsx`
- Create: `apps/admin/src/features/connectors/wizard/StepRoles.tsx`
- Create: `apps/admin/src/features/connectors/wizard/StepCapabilities.tsx`
- Create: `apps/admin/src/features/connectors/wizard/StepReview.tsx`
- Create: `apps/admin/src/pages/ConnectorNewPage.tsx`

**Step 1: Write failing test**

```ts
test('connector wizard step 1 shows platform list', async ({ page }) => {
  await page.goto('/connectors/new')
  await expect(page.getByText('Choose a platform')).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

Wizard state lives in local React state on `ConnectorWizard`, not in Zustand. Submit on final step calls `POST /v1/connectors` then redirects to `/connectors/:id`.

**Step 5: Commit**

```bash
git commit -m "feat: add connector wizard — platform, credentials, roles, capability discovery"
```

---

## Task 9: Connector Detail Page

**Route:** `/connectors/:id`

Read-only view. Shows current state, capabilities, and taxonomy. Links to edit and triggers pages.

**API calls:**
- `GET /v1/connectors/:id`
- `GET /v1/connectors/:id/capabilities`
- `DELETE /v1/connectors/:id` — danger-zone action only

**Page content:**
- Header: connector name, platform badge, status pill, "Edit" button → `/connectors/:id/edit`, "Triggers" button → `/connectors/:id/triggers`
- Connector info: platform type, roles (inbound / outbound), intake mode (effective)
- Capability panel: last discovery timestamp, list of discovered capabilities (webhook supported, attachment-read, comment-read, mention-detect, etc.), "Re-run discovery" button
- Taxonomy panel: configured label/tag mappings, project/board IDs (display only)
- Danger zone: Delete connector (confirmation modal)

**Files:**
- Create: `apps/admin/src/features/connectors/CapabilityPanel.tsx`
- Create: `apps/admin/src/features/connectors/TaxonomyPanel.tsx`
- Create: `apps/admin/src/pages/ConnectorDetailPage.tsx`

**Step 1: Write failing test**

```ts
test('connector detail shows capabilities panel and edit link', async ({ page }) => {
  await page.goto('/connectors/test-connector-id')
  await expect(page.getByText('Capabilities')).toBeVisible()
  await expect(page.getByRole('link', { name: /edit/i })).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

**Step 5: Commit**

```bash
git commit -m "feat: connector detail page — capability panel, taxonomy panel, delete"
```

---

## Task 9b: Connector Edit Page

**Route:** `/connectors/:id/edit`

**API calls:**
- `GET /v1/connectors/:id`
- `PUT /v1/connectors/:id`

**Page content:**
- Back link → `/connectors/:id`
- Form: name, credentials (masked input, re-enter to change), intake mode override, role toggles (inbound / outbound / both)
- Save / Cancel buttons

**Files:**
- Create: `apps/admin/src/features/connectors/ConnectorForm.tsx` — shared by new wizard final step and this edit page
- Create: `apps/admin/src/pages/ConnectorEditPage.tsx`

**Step 1: Write failing test**

```ts
test('connector edit page shows form with name field', async ({ page }) => {
  await page.goto('/connectors/test-connector-id/edit')
  await expect(page.getByLabel(/name/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /save/i })).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

On successful save, redirect to `/connectors/:id`.

**Step 5: Commit**

```bash
git commit -m "feat: connector edit page — pre-populated form, save redirects to detail"
```

---

## Task 10: Connector Trigger Policy Page

**Route:** `/connectors/:id/triggers`

**API calls:**
- `GET /v1/connectors/:id/trigger-policies`
- `PUT /v1/connectors/:id/trigger-policies`

**Page content:**
- Three sections: Triage triggers, Build triggers, Merge triggers
- Each section: event-type checkboxes (status change, label match, comment/mention, etc.), label/tag filter inputs, trigger intent (fix / feature for build), auto-PR toggle
- Save button per section or one global Save

**Files:**
- Create: `apps/admin/src/features/connectors/TriggerPolicyForm.tsx`
- Create: `apps/admin/src/pages/ConnectorTriggersPage.tsx`

**Step 1: Write failing test**

```ts
test('trigger policy page shows triage and build sections', async ({ page }) => {
  await page.goto('/connectors/test-connector-id/triggers')
  await expect(page.getByText('Triage triggers')).toBeVisible()
  await expect(page.getByText('Build triggers')).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

**Step 5: Commit**

```bash
git commit -m "feat: connector trigger policy page — triage, build, merge trigger config"
```

---

## Task 11: Repository Mappings Pages

**Routes:** `/repositories`, `/repositories/new`, `/repositories/:id`, `/repositories/:id/edit`

**API calls:**
- `GET /v1/repository-mappings`
- `POST /v1/repository-mappings`
- `GET /v1/repository-mappings/:id`
- `PUT /v1/repository-mappings/:id`
- `DELETE /v1/repository-mappings/:id`

**Page content (list):**
- Table: mapping name, connector name, repository URL, default execution/review profile, status
- "Add mapping" button → `/repositories/new`
- Per-row link to detail

**Page content (`/repositories/new`):**
- Form: connector selector, repository URL or name, execution profile, orchestration profile, review profile, auto-PR toggle, build trigger labels
- On save → redirect to `/repositories/:id`

**Page content (`/repositories/:id`):**
- Read-only view: connector name, repository URL, profiles, settings summary
- "Edit" button → `/repositories/:id/edit`
- Delete (danger zone)

**Page content (`/repositories/:id/edit`):**
- Pre-populated form (same `MappingForm` component)
- Back link → `/repositories/:id`
- On save → redirect to `/repositories/:id`

**Files:**
- Create: `apps/admin/src/features/repositories/MappingsTable.tsx`
- Create: `apps/admin/src/features/repositories/MappingForm.tsx` — shared by new + edit pages
- Create: `apps/admin/src/api/repositories.ts`
- Create: `apps/admin/src/pages/RepositoriesPage.tsx`
- Create: `apps/admin/src/pages/RepositoryNewPage.tsx`
- Create: `apps/admin/src/pages/RepositoryDetailPage.tsx`
- Create: `apps/admin/src/pages/RepositoryEditPage.tsx`

**Step 1: Write failing tests**

```ts
test('repository list shows add button', async ({ page }) => {
  await page.goto('/repositories')
  await expect(page.getByRole('link', { name: /add mapping/i })).toBeVisible()
})

test('repository detail shows edit link', async ({ page }) => {
  await page.goto('/repositories/test-mapping-id')
  await expect(page.getByRole('link', { name: /edit/i })).toBeVisible()
})

test('repository edit page shows pre-populated form', async ({ page }) => {
  await page.goto('/repositories/test-mapping-id/edit')
  await expect(page.getByRole('button', { name: /save/i })).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

**Step 5: Commit**

```bash
git commit -m "feat: repository mapping pages — list, new, detail, edit"
```

---

## Task 12: Routing Rules + Outbound Destinations Pages

**Routes:**
- `/routing` — rules list
- `/routing/rules/new` — create rule
- `/routing/rules/:id` — rule detail
- `/routing/rules/:id/edit` — rule edit
- `/routing/destinations` — destinations list
- `/routing/destinations/new` — add destination
- `/routing/destinations/:id` — destination detail
- `/routing/destinations/:id/edit` — destination edit

**API calls:**
- `GET /v1/routing-rules`
- `POST /v1/routing-rules`
- `GET /v1/routing-rules/:id`
- `PUT /v1/routing-rules/:id`
- `DELETE /v1/routing-rules/:id`
- `GET /v1/outbound-destinations`
- `POST /v1/outbound-destinations`
- `GET /v1/outbound-destinations/:id`
- `PUT /v1/outbound-destinations/:id`
- `DELETE /v1/outbound-destinations/:id`

**Page content (`/routing`):**
- Routing rules table: priority, condition summary (connector / workflow type / scenario), destination name, enabled toggle
- "Add rule" link → `/routing/rules/new`
- "Destinations" nav link → `/routing/destinations`
- Per-row link to rule detail

**Page content (`/routing/rules/new` and `/routing/rules/:id/edit`):**
- Form (shared `RoutingRuleForm`): priority, connector condition, workflow type condition, scenario condition, destination selector, enabled toggle
- New → save → redirect to `/routing/rules/:id`
- Edit → save → redirect to `/routing/rules/:id`

**Page content (`/routing/rules/:id`):**
- Read-only: priority, conditions, destination, enabled state
- "Edit" button, Delete (danger zone)

**Page content (`/routing/destinations`):**
- Destinations table: name, platform type, delivery type (comment-back / create-issue / PR / draft-PR), configured status
- "Add destination" link → `/routing/destinations/new`
- Per-row link to detail

**Page content (`/routing/destinations/new` and `/routing/destinations/:id/edit`):**
- Form (shared `DestinationForm`): name, platform connector selector, delivery type, credential/token fields (write-only)

**Page content (`/routing/destinations/:id`):**
- Read-only: name, platform, delivery type, credential masked metadata
- "Edit" button, Delete

**Files:**
- Create: `apps/admin/src/features/routing/RoutingRulesTable.tsx`
- Create: `apps/admin/src/features/routing/RoutingRuleForm.tsx`
- Create: `apps/admin/src/features/routing/RoutingRuleDetail.tsx`
- Create: `apps/admin/src/features/routing/DestinationsTable.tsx`
- Create: `apps/admin/src/features/routing/DestinationForm.tsx`
- Create: `apps/admin/src/features/routing/DestinationDetail.tsx`
- Create: `apps/admin/src/api/routing.ts`
- Create: `apps/admin/src/pages/RoutingPage.tsx`
- Create: `apps/admin/src/pages/RoutingRuleNewPage.tsx`
- Create: `apps/admin/src/pages/RoutingRuleDetailPage.tsx`
- Create: `apps/admin/src/pages/RoutingRuleEditPage.tsx`
- Create: `apps/admin/src/pages/DestinationsPage.tsx`
- Create: `apps/admin/src/pages/DestinationNewPage.tsx`
- Create: `apps/admin/src/pages/DestinationDetailPage.tsx`
- Create: `apps/admin/src/pages/DestinationEditPage.tsx`

**Step 1: Write failing tests**

```ts
test('routing page shows rules table and destinations link', async ({ page }) => {
  await page.goto('/routing')
  await expect(page.getByText('Routing rules')).toBeVisible()
  await expect(page.getByRole('link', { name: /destinations/i })).toBeVisible()
})

test('routing rule detail shows edit link', async ({ page }) => {
  await page.goto('/routing/rules/test-rule-id')
  await expect(page.getByRole('link', { name: /edit/i })).toBeVisible()
})

test('destination detail shows edit link', async ({ page }) => {
  await page.goto('/routing/destinations/test-dest-id')
  await expect(page.getByRole('link', { name: /edit/i })).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

**Step 5: Commit**

```bash
git commit -m "feat: routing pages — rules list/detail/edit, destinations list/detail/edit"
```

---

## Task 13: Workflow Scenarios Pages

**Routes:** `/scenarios`, `/scenarios/new`, `/scenarios/:id`, `/scenarios/:id/edit`

**API calls:**
- `GET /v1/workflow-scenarios`
- `POST /v1/workflow-scenarios`
- `GET /v1/workflow-scenarios/:id`
- `PUT /v1/workflow-scenarios/:id`
- `DELETE /v1/workflow-scenarios/:id`

**Page content (list):**
- Table: scenario key, display name, workflow type, enabled, trigger policy count, execution profile
- "New scenario" button → `/scenarios/new`
- Per-row link to detail

**Page content (`/scenarios/new` and `/scenarios/:id/edit`):**
- Form (shared `ScenarioForm`): key (new only — read-only on edit), display name, enabled toggle, workflow type selector, allowed connectors (multi-select), execution profile, orchestration profile, review profile, notification policy, distribution target
- Save → redirect to `/scenarios/:id`

**Page content (`/scenarios/:id`):**
- Read-only: all fields displayed
- "Edit" button → `/scenarios/:id/edit`
- Trigger policy count with link to bound connector trigger pages
- Delete (danger zone)

**Files:**
- Create: `apps/admin/src/features/scenarios/ScenariosTable.tsx`
- Create: `apps/admin/src/features/scenarios/ScenarioForm.tsx`
- Create: `apps/admin/src/features/scenarios/ScenarioDetail.tsx`
- Create: `apps/admin/src/api/scenarios.ts`
- Create: `apps/admin/src/pages/ScenariosPage.tsx`
- Create: `apps/admin/src/pages/ScenarioNewPage.tsx`
- Create: `apps/admin/src/pages/ScenarioDetailPage.tsx`
- Create: `apps/admin/src/pages/ScenarioEditPage.tsx`

**Step 1: Write failing tests**

```ts
test('scenarios list shows new button', async ({ page }) => {
  await page.goto('/scenarios')
  await expect(page.getByRole('link', { name: /new scenario/i })).toBeVisible()
})

test('scenario detail shows edit link', async ({ page }) => {
  await page.goto('/scenarios/test-scenario-id')
  await expect(page.getByRole('link', { name: /edit/i })).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

**Step 5: Commit**

```bash
git commit -m "feat: workflow scenario pages — list, new, detail, edit"
```

---

## Task 14: Communication Channels Pages

**Routes:** `/channels`, `/channels/new`, `/channels/:id`, `/channels/:id/edit`

**API calls:**
- `GET /v1/communication-channels`
- `POST /v1/communication-channels`
- `GET /v1/communication-channels/:id`
- `PUT /v1/communication-channels/:id`
- `DELETE /v1/communication-channels/:id`

**Page content (list):**
- Table: channel name, platform (Slack / Teams / WhatsApp), pairing status, linked workspace/conversation, allowed actions count
- "Add channel" button → `/channels/new`
- Per-row link to detail

**Page content (`/channels/new`):**
- Step 1: choose platform (Slack / Teams / WhatsApp)
- Step 2: OAuth connect (Slack/Teams) or enter business number (WhatsApp)
- Step 3: set allowed actions and notification subscriptions
- On save → redirect to `/channels/:id`

**Page content (`/channels/:id`):**
- Read-only: platform, pairing status, linked workspace/conversation, allowed actions, notification subscriptions, linked context scope
- "Edit" button → `/channels/:id/edit`
- "Reconnect" action (re-triggers OAuth or re-links number)
- Delete

**Page content (`/channels/:id/edit`):**
- Form: display name, allowed actions checkboxes, notification subscription toggles, linked connector/team/repository scope
- Does not re-do the OAuth pairing (use "Reconnect" on detail page for that)
- Back link → `/channels/:id`
- On save → redirect to `/channels/:id`

**Files:**
- Create: `apps/admin/src/features/channels/ChannelsTable.tsx`
- Create: `apps/admin/src/features/channels/ChannelNewWizard.tsx`
- Create: `apps/admin/src/features/channels/ChannelDetail.tsx`
- Create: `apps/admin/src/features/channels/ChannelEditForm.tsx`
- Create: `apps/admin/src/api/channels.ts`
- Create: `apps/admin/src/pages/ChannelsPage.tsx`
- Create: `apps/admin/src/pages/ChannelNewPage.tsx`
- Create: `apps/admin/src/pages/ChannelDetailPage.tsx`
- Create: `apps/admin/src/pages/ChannelEditPage.tsx`

**Step 1: Write failing tests**

```ts
test('channels list shows add button', async ({ page }) => {
  await page.goto('/channels')
  await expect(page.getByRole('link', { name: /add channel/i })).toBeVisible()
})

test('channel detail shows edit link and reconnect action', async ({ page }) => {
  await page.goto('/channels/test-channel-id')
  await expect(page.getByRole('link', { name: /edit/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /reconnect/i })).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

**Step 5: Commit**

```bash
git commit -m "feat: communication channel pages — list, new wizard, detail, edit"
```

---

## Task 15: Execution Providers Pages

**Routes:** `/providers`, `/providers/new`, `/providers/:id`, `/providers/:id/edit`

**API calls:**
- `GET /v1/execution-providers`
- `POST /v1/execution-providers`
- `GET /v1/execution-providers/:id`
- `PUT /v1/execution-providers/:id`
- `DELETE /v1/execution-providers/:id`

**Page content (list):**
- Table: provider name, type (gcp-vm / local-host / reverse-connected / etc.), status (online / offline / unknown), last heartbeat, registered hosts count
- "Register provider" button → `/providers/new`
- Per-row link to detail

**Page content (`/providers/new`):**
- Form: label, provider type selector, execution profile compatibility (multi-select)
- Save → redirect to `/providers/:id`

**Page content (`/providers/:id`):**
- Read-only: label, type, profile compatibility, status
- Registered hosts panel: list of `execution_provider_hosts` with connection status and last-seen timestamp
- For reverse-connected: shows active session state and reconnect instructions
- "Edit" button → `/providers/:id/edit`
- Delete (danger zone)

**Page content (`/providers/:id/edit`):**
- Form: label, execution profile compatibility (type is immutable after creation)
- Back link → `/providers/:id`
- On save → redirect to `/providers/:id`

**Files:**
- Create: `apps/admin/src/features/providers/ProvidersTable.tsx`
- Create: `apps/admin/src/features/providers/ProviderForm.tsx`
- Create: `apps/admin/src/features/providers/ProviderDetail.tsx`
- Create: `apps/admin/src/features/providers/HostsPanel.tsx`
- Create: `apps/admin/src/api/providers.ts`
- Create: `apps/admin/src/pages/ProvidersPage.tsx`
- Create: `apps/admin/src/pages/ProviderNewPage.tsx`
- Create: `apps/admin/src/pages/ProviderDetailPage.tsx`
- Create: `apps/admin/src/pages/ProviderEditPage.tsx`

**Step 1: Write failing tests**

```ts
test('providers list shows register button', async ({ page }) => {
  await page.goto('/providers')
  await expect(page.getByRole('link', { name: /register provider/i })).toBeVisible()
})

test('provider detail shows hosts panel and edit link', async ({ page }) => {
  await page.goto('/providers/test-provider-id')
  await expect(page.getByText('Registered hosts')).toBeVisible()
  await expect(page.getByRole('link', { name: /edit/i })).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

**Step 5: Commit**

```bash
git commit -m "feat: execution provider pages — list, new, detail, edit"
```

---

## Task 16: Runtime API Keys Pages

**Routes:** `/api-keys`, `/api-keys/new`

**API calls:**
- `GET /v1/runtime-api-keys`
- `POST /v1/runtime-api-keys` — returns the key once; never readable again
- `DELETE /v1/runtime-api-keys/:id` — revoke

**Page content (list):**
- Table: label, tenant scope, allowed mode, created at, last used, status (active / revoked)
- "Create API key" button

**Page content (new):**
- Form: label, allowed runtime mode (worker / gateway / both), allowed execution profiles (multi-select)
- On successful creation: show key in a one-time copy panel with a warning that it will not be shown again

**Files:**
- Create: `apps/admin/src/features/providers/ApiKeysTable.tsx`
- Create: `apps/admin/src/features/providers/ApiKeyNewForm.tsx`
- Create: `apps/admin/src/features/providers/KeyRevealPanel.tsx`
- Create: `apps/admin/src/pages/ApiKeysPage.tsx`
- Create: `apps/admin/src/pages/ApiKeyNewPage.tsx`

**Step 1: Write failing test**

```ts
test('api keys list shows table and create button', async ({ page }) => {
  await page.goto('/api-keys')
  await expect(page.getByRole('link', { name: /create api key/i })).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

**Step 5: Commit**

```bash
git commit -m "feat: runtime API key pages — list, create with one-time reveal"
```

---

## Task 17: Review Profiles Pages

**Routes:** `/review-profiles`, `/review-profiles/new`, `/review-profiles/:id`, `/review-profiles/:id/edit`

**API calls:**
- `GET /v1/review-profiles`
- `POST /v1/review-profiles`
- `GET /v1/review-profiles/:id`
- `PUT /v1/review-profiles/:id`

**Page content (list):**
- Table: profile name, version, max rounds, mandatory human approval, active status
- "New profile" button → `/review-profiles/new`

**Page content (`/review-profiles/new`):**
- Form: name, max review rounds, mandatory human approval toggle, continue-after-passing toggle, allowed workflow types
- Save → redirect to `/review-profiles/:id`

**Page content (`/review-profiles/:id`):**
- Read-only: name, version, max rounds, approval settings, prompt set reference (display only — server-managed), allowed workflow types
- "Edit" button → `/review-profiles/:id/edit`

**Page content (`/review-profiles/:id/edit`):**
- Pre-populated form (same `ReviewProfileForm` component)
- Key/name is read-only on edit; only policy fields are editable
- Back link → `/review-profiles/:id`
- On save → redirect to `/review-profiles/:id`

**Files:**
- Create: `apps/admin/src/features/review/ReviewProfilesTable.tsx`
- Create: `apps/admin/src/features/review/ReviewProfileForm.tsx`
- Create: `apps/admin/src/features/review/ReviewProfileDetail.tsx`
- Create: `apps/admin/src/api/review-profiles.ts`
- Create: `apps/admin/src/pages/ReviewProfilesPage.tsx`
- Create: `apps/admin/src/pages/ReviewProfileNewPage.tsx`
- Create: `apps/admin/src/pages/ReviewProfileDetailPage.tsx`
- Create: `apps/admin/src/pages/ReviewProfileEditPage.tsx`

**Step 1: Write failing tests**

```ts
test('review profiles list shows table and new button', async ({ page }) => {
  await page.goto('/review-profiles')
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('link', { name: /new profile/i })).toBeVisible()
})

test('review profile detail shows edit link', async ({ page }) => {
  await page.goto('/review-profiles/test-profile-id')
  await expect(page.getByRole('link', { name: /edit/i })).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

**Step 5: Commit**

```bash
git commit -m "feat: review profile pages — list, new, detail, edit"
```

---

## Task 18: Settings — Tenant, Identity, Users, Audit

**Routes:** `/settings`, `/settings/identity`, `/settings/users`, `/settings/audit`

Use a tab layout within a shared `/settings` shell.

**API calls:**
- `GET /v1/settings/tenant`
- `PUT /v1/settings/tenant`
- `GET /v1/settings/identity-providers`
- `POST /v1/settings/identity-providers`
- `PUT /v1/settings/identity-providers/:id`
- `DELETE /v1/settings/identity-providers/:id`
- `GET /v1/users`
- `PUT /v1/users/:id/role`
- `DELETE /v1/users/:id`
- `GET /v1/audit-events?page=1&limit=50`

**Page content (`/settings`):**
- Org name, product mode (standalone SaaS / enterprise / integrated), hosting mode, model-access mode, output-visibility policy

**Page content (`/settings/identity`):**
- List of configured identity providers (OIDC / SAML)
- "Add provider" form: label, protocol, issuer URL / SAML metadata URL, client ID, client secret (write-only after save)
- Enable / disable toggle per provider

**Page content (`/settings/users`):**
- Table: name, email, role (admin / operator / viewer), last login
- Role selector per user, Deactivate action

**Page content (`/settings/audit`):**
- Table: timestamp, actor, action, resource type, resource ID, outcome
- Filter: actor, action, date range

**Files:**
- Create: `apps/admin/src/features/settings/TenantSettingsForm.tsx`
- Create: `apps/admin/src/features/settings/IdentityProviderList.tsx`
- Create: `apps/admin/src/features/settings/UsersTable.tsx`
- Create: `apps/admin/src/features/settings/AuditLogTable.tsx`
- Create: `apps/admin/src/api/settings.ts`
- Create: `apps/admin/src/pages/SettingsPage.tsx`
- Create: `apps/admin/src/pages/SettingsIdentityPage.tsx`
- Create: `apps/admin/src/pages/SettingsUsersPage.tsx`
- Create: `apps/admin/src/pages/SettingsAuditPage.tsx`

**Step 1: Write failing test**

```ts
test('settings page shows tenant settings tab and identity tab link', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByText('Org name')).toBeVisible()
  await expect(page.getByRole('link', { name: /identity/i })).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

**Step 5: Commit**

```bash
git commit -m "feat: settings pages — tenant, identity providers, users, audit log"
```

---

## Task 19: First-Run Onboarding Wizard

**Route:** `/setup`

Shown automatically when the admin detects zero connectors and zero repository mappings on first login (API returns `onboardingRequired: true` from tenant endpoint).

**Steps mirror `docs/onboarding.md`:**
1. Choose product mode (standalone SaaS / enterprise / integrated)
2. Choose execution mode (cloud-managed / customer-runtime)
3. Choose model-access mode (SA proxy / tenant-provider)
4. Add first connector (re-uses `ConnectorWizard` from Task 8)
5. Add first repository mapping (re-uses `MappingForm` from Task 11)
6. Register first runtime / API key (re-uses `ApiKeyNewForm` from Task 16)
7. Done — send test event prompt and link to `/runs`

**Files:**
- Create: `apps/admin/src/features/setup/OnboardingWizard.tsx`
- Create: `apps/admin/src/features/setup/StepProductMode.tsx`
- Create: `apps/admin/src/features/setup/StepExecutionMode.tsx`
- Create: `apps/admin/src/features/setup/StepModelAccess.tsx`
- Create: `apps/admin/src/features/setup/StepDone.tsx`
- Create: `apps/admin/src/pages/SetupPage.tsx`
- Modify: `apps/admin/src/router/index.tsx` — add `/setup` route + redirect logic

**Step 1: Write failing test**

```ts
test('setup wizard shows step 1 on /setup', async ({ page }) => {
  await page.goto('/setup')
  await expect(page.getByText('Choose product mode')).toBeVisible()
})
```

**Step 2–4: Implement → verify PASS**

The `AuthGuard` should check `onboardingRequired` after login and redirect to `/setup` if true.

**Step 5: Commit**

```bash
git commit -m "feat: first-run onboarding wizard — product mode, execution, connector, mapping, runtime"
```

---

## Task 20: Vite Config, Env, and Deploy Wiring

**Files:**
- Create: `apps/admin/vite.config.ts` — proxy `/v1` to API in dev
- Create: `apps/admin/.env.example`
- Create: `apps/admin/Dockerfile` — static build + Caddy or nginx serve
- Modify: `Dockerfile` at repo root (or add `apps/admin/Dockerfile`) for Cloud Run deployment

**Step 1: Vite proxy for local dev**

`apps/admin/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/v1': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
```

**Step 2: Env file**

`apps/admin/.env.example`:
```
VITE_API_URL=https://api.appbuildbox.com
```

**Step 3: Dockerfile**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter admin build

FROM caddy:2-alpine
COPY --from=build /app/apps/admin/dist /srv
COPY apps/admin/Caddyfile /etc/caddy/Caddyfile
```

`apps/admin/Caddyfile`:
```
:8080 {
  root * /srv
  try_files {path} /index.html
  file_server
}
```

**Step 4: Verify build**

```bash
pnpm --filter admin build
```
Expected: `dist/` created, no TS errors.

**Step 5: Commit**

```bash
git commit -m "feat: admin Vite config, env, and Dockerfile for Cloud Run"
```

---

## Task 21: Playwright Test Suite Bootstrap

**Files:**
- Create: `apps/admin/playwright.config.ts`
- Create: `apps/admin/tests/` (test files written in each task above)

**Step 1: Install Playwright**

```bash
pnpm --filter admin add -D @playwright/test
npx playwright install chromium
```

**Step 2: `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  webServer: {
    command: 'pnpm --filter admin dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})
```

**Step 3: Verify all passing tests run**

```bash
pnpm --filter admin playwright test
```
Expected: all tests introduced in tasks above pass.

**Step 4: Commit**

```bash
git commit -m "test: admin Playwright config and full clickthrough suite"
```

---

## Execution Note

Tasks 1–3 must be done sequentially (scaffold → auth → shell). Tasks 4–19 can each be done in parallel across independent route slices, but each task internally follows the write-test → implement → verify loop before committing.

---

**Plan complete and saved to `docs/plans/2026-04-01-standalone-admin-app.md`.**

**Two execution options:**

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open a new session with `executing-plans` skill, batch execution with checkpoints

**Which approach?**
