import { useLocation } from 'react-router-dom'
import { SearchIcon, BellIcon } from '@/components/icons/NavIcons'

const routeLabels: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/runs': 'Jobs',
  '/apps': 'Apps',
  '/connectors': 'Connectors',
  '/workflows': 'Workflows',
  '/designer': 'Designer',
  '/scenarios': 'Scenarios',
  '/channels': 'Channels',
  '/providers': 'Providers',
  '/api-keys': 'API Keys',
  '/review-profiles': 'Review Profiles',
  '/settings': 'Settings',
}

function useBreadcrumb(): string {
  const { pathname } = useLocation()
  const base = '/' + (pathname.split('/').find(Boolean) ?? '')
  return routeLabels[base] ?? 'Page'
}

export function TopBar() {
  const label = useBreadcrumb()

  return (
    <header className="flex items-center justify-between border-b border-white/6 bg-gray-950 px-6" style={{ height: 'var(--height-topbar)' }}>
      <nav className="flex items-center gap-1.5 text-[13px] text-gray-500">
        <span>Home</span>
        <span className="text-[11px] text-gray-600">/</span>
        <span className="font-medium text-gray-200">{label}</span>
      </nav>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-[var(--radius-sm)] text-gray-500 transition-colors hover:bg-white/6 hover:text-gray-300"
          aria-label="Search"
        >
          <SearchIcon width={18} height={18} />
        </button>
        <button
          type="button"
          className="relative flex h-[34px] w-[34px] items-center justify-center rounded-[var(--radius-sm)] text-gray-500 transition-colors hover:bg-white/6 hover:text-gray-300"
          aria-label="Notifications"
        >
          <BellIcon width={18} height={18} />
          <span className="absolute top-[7px] right-[7px] h-[7px] w-[7px] rounded-full border-2 border-gray-950 bg-signal-red-500" />
        </button>
      </div>
    </header>
  )
}
