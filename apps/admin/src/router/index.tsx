import { createBrowserRouter, Navigate } from 'react-router-dom'
import { lazy, Suspense, type ComponentType } from 'react'
import { AuthGuard } from './AuthGuard'
import { Layout } from '@/components/layout/Layout'

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

        /* Connectors */
        { path: 'connectors',              element: load(() => import('@/pages/ConnectorsPage')) },
        { path: 'connectors/new',          element: load(() => import('@/pages/ConnectorNewPage')) },
        { path: 'connectors/:id',          element: load(() => import('@/pages/ConnectorDetailPage')) },
        { path: 'connectors/:id/edit',     element: load(() => import('@/pages/ConnectorEditPage')) },
        { path: 'connectors/:id/triggers', element: load(() => import('@/pages/ConnectorTriggersPage')) },

        /* Repositories */
        { path: 'repositories',          element: load(() => import('@/pages/RepositoriesPage')) },
        { path: 'repositories/new',      element: load(() => import('@/pages/RepositoryNewPage')) },
        { path: 'repositories/:id',      element: load(() => import('@/pages/RepositoryDetailPage')) },
        { path: 'repositories/:id/edit', element: load(() => import('@/pages/RepositoryEditPage')) },

        /* Routing */
        { path: 'routing',                       element: load(() => import('@/pages/RoutingPage')) },
        { path: 'routing/rules/new',              element: load(() => import('@/pages/RoutingRuleNewPage')) },
        { path: 'routing/rules/:id',              element: load(() => import('@/pages/RoutingRuleDetailPage')) },
        { path: 'routing/rules/:id/edit',         element: load(() => import('@/pages/RoutingRuleEditPage')) },
        { path: 'routing/destinations',            element: load(() => import('@/pages/DestinationsPage')) },
        { path: 'routing/destinations/new',        element: load(() => import('@/pages/DestinationNewPage')) },
        { path: 'routing/destinations/:id',        element: load(() => import('@/pages/DestinationDetailPage')) },
        { path: 'routing/destinations/:id/edit',   element: load(() => import('@/pages/DestinationEditPage')) },

        /* Scenarios */
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
