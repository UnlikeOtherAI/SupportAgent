import { useLocation } from 'react-router-dom'
import { SearchIcon, BellIcon } from '@/components/icons/NavIcons'

const routeLabels: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/runs': 'Jobs',
  '/connectors': 'Connectors',
  '/repositories': 'Repositories',
  '/routing': 'Routing',
  '/scenarios': 'Scenarios',
  '/channels': 'Channels',
  '/providers': 'Providers',
  '/api-keys': 'API Keys',
  '/review-profiles': 'Review Profiles',
  '/settings': 'Settings',
}

function useBreadcrumb(): string {
  const { pathname } = useLocation()
  const base = '/' + pathname.split('/').filter(Boolean)[0]
  return routeLabels[base] ?? 'Page'
}

export function TopBar() {
  const label = useBreadcrumb()

  return (
    <header className="flex items-center justify-between border-b border-gray-100 bg-white px-6" style={{ height: 'var(--height-topbar)' }}>
      <nav className="flex items-center gap-1.5 text-[13px] text-gray-400">
        <span>Home</span>
        <span className="text-[11px] text-gray-300">/</span>
        <span className="font-medium text-gray-800">{label}</span>
      </nav>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-[var(--radius-sm)] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          aria-label="Search"
        >
          <SearchIcon width={18} height={18} />
        </button>
        <button
          type="button"
          className="relative flex h-[34px] w-[34px] items-center justify-center rounded-[var(--radius-sm)] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          aria-label="Notifications"
        >
          <BellIcon width={18} height={18} />
          <span className="absolute top-[7px] right-[7px] h-[7px] w-[7px] rounded-full border-2 border-white bg-signal-red-500" />
        </button>
      </div>
    </header>
  )
}
