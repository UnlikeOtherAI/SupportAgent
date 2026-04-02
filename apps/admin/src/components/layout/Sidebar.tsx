import { NavLink } from 'react-router-dom'
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
  const initials = user
    ? user.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '??'

  return (
    <aside className="grid h-full grid-rows-[var(--height-topbar)_1fr_auto] border-r border-white/6 bg-gray-950" style={{ width: 'var(--width-sidebar)' }}>
      {/* Brand */}
      <div className="flex items-center gap-2.5 border-b border-white/6 px-5">
        <div className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-accent-500">
          <BoltIcon width={14} height={14} stroke="#fff" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-white">AppBuildBox</span>
      </div>

      {/* Nav */}
      <nav className="overflow-y-auto px-2.5 py-3">
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
      </nav>

      {/* User */}
      <div className="border-t border-white/6 px-2.5 py-3">
        <div className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 transition-colors hover:bg-white/6">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-600 to-accent-400 text-[11px] font-semibold text-white">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-gray-200">
              {user?.displayName ?? 'Unknown'}
            </div>
            <div className="text-[11px] text-gray-500">{user?.role ?? 'Operator'}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
