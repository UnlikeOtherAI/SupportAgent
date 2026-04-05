import { NavLink, useNavigate } from 'react-router-dom'
import {
  DashboardIcon, JobsIcon, RepositoriesIcon,
  RoutingIcon, ScenariosIcon, ChannelsIcon, ProvidersIcon,
  ApiKeysIcon, ReviewIcon, SettingsIcon, BoltIcon,
} from '@/components/icons/NavIcons'
import { AppsIcon } from '@/components/icons/PlatformIcons'
import { useAuth } from '@/lib/auth'
import type { ReactNode } from 'react'

interface NavItem {
  label: string
  to: string
  icon: ReactNode
  badge?: string
}

interface NavSection {
  label: string
  items: NavItem[]
}

const NAV: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: <DashboardIcon /> },
      { label: 'Jobs', to: '/runs', icon: <JobsIcon /> },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { label: 'Apps', to: '/apps', icon: <AppsIcon /> },
      { label: 'Repositories', to: '/repositories', icon: <RepositoriesIcon /> },
      { label: 'Routing', to: '/routing', icon: <RoutingIcon /> },
      { label: 'Scenarios', to: '/scenarios', icon: <ScenariosIcon /> },
    ],
  },
  {
    label: 'Channels',
    items: [
      { label: 'Channels', to: '/channels', icon: <ChannelsIcon /> },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { label: 'Providers', to: '/providers', icon: <ProvidersIcon /> },
      { label: 'API Keys', to: '/api-keys', icon: <ApiKeysIcon /> },
      { label: 'Review Profiles', to: '/review-profiles', icon: <ReviewIcon /> },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Settings', to: '/settings', icon: <SettingsIcon /> },
    ],
  },
]

export function Sidebar() {
  const user = useAuth((s) => s.user)
  const clearAuth = useAuth((s) => s.clearAuth)
  const navigate = useNavigate()
  const initials = user
    ? user.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '??'

  function handleLogout() {
    clearAuth()
    void navigate('/login')
  }

  return (
    <aside className="flex h-full w-[var(--width-sidebar)] flex-col border-r border-white/6 bg-gray-950">
      {/* Brand */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-white/6 px-5" style={{ height: 'var(--height-topbar)' }}>
        <div className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-accent-500">
          <BoltIcon width={14} height={14} stroke="#fff" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-white">AppBuildBox</span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col overflow-hidden px-2.5 py-3">
        <div className="flex-1 overflow-y-auto">
          {NAV.map((section) => (
            <div key={section.label}>
              <div className="px-2.5 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                {section.label}
              </div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-[7px] text-[13px] font-[450] transition-colors duration-100 ${
                      isActive
                        ? 'bg-white/8 text-white [&>*:first-child]:opacity-85'
                        : 'text-gray-400 hover:bg-white/6 hover:text-gray-200 [&>*:first-child]:opacity-50'
                    }`
                  }
                >
                  <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{item.icon}</span>
                  {item.label}
                  {item.badge && (
                    <span className="ml-auto rounded-[4px] bg-accent-500/15 px-1.5 py-px font-mono text-[11px] font-semibold text-accent-400">
                      {item.badge}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </div>

        {/* User — sticky at bottom of nav */}
        <div className="mt-3 shrink-0 border-t border-white/6 pt-3">
          <div className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 transition-colors hover:bg-white/6">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-600 to-accent-400 text-[11px] font-semibold text-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-gray-200">
                {user?.displayName ?? 'Unknown'}
              </div>
              <div className="text-[11px] text-gray-500">{user?.role ?? 'Operator'}</div>
            </div>
            <button
              onClick={handleLogout}
              className="shrink-0 rounded p-1 text-gray-500 transition-colors hover:bg-white/6 hover:text-gray-300"
              title="Log out"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </nav>
    </aside>
  )
}
