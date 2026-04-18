import { createBrowserRouter, Navigate } from 'react-router-dom'
import { lazy, Suspense, type ComponentType } from 'react'
import { AuthGuard } from './AuthGuard'
import { Layout } from '@/components/layout/Layout'
import { executorRoutes } from '@/features/executors/routes'
import { skillRoutes } from '@/features/skills/routes'

function load(factory: () => Promise<{ default: ComponentType }>) {
  const Lazy = lazy(factory)
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-gray-400">Loading...</div>}>
      <Lazy />
    </Suspense>
  )
}

export const router = createBrowserRouter([
  /* ── Public ──────────────────────────────────────────── */
  { path: '/login',         element: load(() => import('@/pages/LoginPage')) },
  { path: '/auth/callback', element: load(() => import('@/pages/AuthCallbackPage')) },
  { path: '/setup',         element: load(() => import('@/pages/SetupPage')) },

  /* ── Authenticated ───────────────────────────────────── */
  {
    element: <AuthGuard />,
    children: [{
      element: <Layout />,
      children: [
        { index: true, element: <Navigate to="/dashboard" replace /> },

        /* Dashboard */
        { path: 'dashboard', element: load(() => import('@/pages/DashboardPage')) },

        /* Workflow Runs */
        { path: 'runs',     element: load(() => import('@/pages/RunsPage')) },
        { path: 'runs/:id', element: load(() => import('@/pages/RunDetailPage')) },

        ...skillRoutes,
        ...executorRoutes,

        /* Apps */
        { path: 'apps',                                          element: load(() => import('@/pages/AppsPage')) },
        { path: 'apps/:platformKey/enable',                      element: load(() => import('@/pages/AppEnablePage')) },
        { path: 'apps/:platformKey/configure/:connectorId',      element: load(() => import('@/pages/AppConfigurePage')) },

        /* Connectors */
        { path: 'connectors',              element: <Navigate to="/apps" replace /> },
        { path: 'connectors/:id',          element: load(() => import('@/pages/ConnectorDetailPage')) },
        { path: 'connectors/:id/edit',     element: load(() => import('@/pages/ConnectorEditPage')) },
        { path: 'connectors/:id/triggers', element: load(() => import('@/pages/ConnectorTriggersPage')) },


        /* Scenarios */
        { path: 'workflows',                 element: load(() => import('@/pages/WorkflowsPage')) },
        { path: 'workflows/new/designer',    element: load(() => import('@/pages/WorkflowDesignerPage')) },
        { path: 'workflows/:id/designer',    element: load(() => import('@/pages/WorkflowDesignerPage')) },
        { path: 'scenarios',          element: load(() => import('@/pages/ScenariosPage')) },
        { path: 'scenarios/new',      element: load(() => import('@/pages/ScenarioNewPage')) },
        { path: 'scenarios/:id',      element: load(() => import('@/pages/ScenarioDetailPage')) },
        { path: 'scenarios/:id/edit', element: load(() => import('@/pages/ScenarioEditPage')) },

        /* Channels */
        { path: 'channels',          element: load(() => import('@/pages/ChannelsPage')) },
        { path: 'channels/new',      element: load(() => import('@/pages/ChannelNewPage')) },
        { path: 'channels/:id',      element: load(() => import('@/pages/ChannelDetailPage')) },
        { path: 'channels/:id/edit', element: load(() => import('@/pages/ChannelEditPage')) },

        /* Providers */
        { path: 'providers',          element: load(() => import('@/pages/ProvidersPage')) },
        { path: 'providers/new',      element: load(() => import('@/pages/ProviderNewPage')) },
        { path: 'providers/:id',      element: load(() => import('@/pages/ProviderDetailPage')) },
        { path: 'providers/:id/edit', element: load(() => import('@/pages/ProviderEditPage')) },

        /* API Keys */
        { path: 'api-keys',     element: load(() => import('@/pages/ApiKeysPage')) },
        { path: 'api-keys/new', element: load(() => import('@/pages/ApiKeyNewPage')) },

        /* Review Profiles */
        { path: 'review-profiles',          element: load(() => import('@/pages/ReviewProfilesPage')) },
        { path: 'review-profiles/new',      element: load(() => import('@/pages/ReviewProfileNewPage')) },
        { path: 'review-profiles/:id',      element: load(() => import('@/pages/ReviewProfileDetailPage')) },
        { path: 'review-profiles/:id/edit', element: load(() => import('@/pages/ReviewProfileEditPage')) },

        /* Settings */
        { path: 'settings',          element: load(() => import('@/pages/SettingsPage')) },
        { path: 'settings/identity', element: load(() => import('@/pages/SettingsIdentityPage')) },
        { path: 'settings/users',    element: load(() => import('@/pages/SettingsUsersPage')) },
        { path: 'settings/audit',    element: load(() => import('@/pages/SettingsAuditPage')) },
      ],
    }],
  },
])
