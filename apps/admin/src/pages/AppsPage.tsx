import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { platformTypesApi, type PlatformTypeDetail } from '@/api/platform-types'
import { connectorsApi } from '@/api/connectors'
import { PageShell } from '@/components/ui/PageShell'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { getPlatformIcon } from '@/components/icons/PlatformIcons'

const CATEGORIES = [
  { key: 'error-monitoring', label: 'Error Monitoring' },
  { key: 'issue-tracker', label: 'Issue Trackers' },
  { key: 'version-control', label: 'Version Control' },
  { key: 'project-management', label: 'Project Management' },
] as const

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
          <Icon className="h-6 w-6 text-gray-700" />
        </div>
        <StatusBadge hasConnector={!!connectorId} />
      </div>
      <h3 className="text-sm font-semibold text-gray-900">{platform.displayName}</h3>
      <p className="mt-1 flex-1 text-xs leading-relaxed text-gray-500">{platform.description}</p>
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
  const { data: platforms, isLoading } = useQuery({
    queryKey: ['platform-types'],
    queryFn: platformTypesApi.list,
  })
  const { data: connectorsData } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => connectorsApi.list({ limit: 100 }),
  })

  if (isLoading) {
    return <PageShell title="Apps"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  const connectors = connectorsData?.data ?? []
  const connectorByPlatform = new Map<string, string>()
  for (const c of connectors) {
    if (!connectorByPlatform.has(c.platformType)) {
      connectorByPlatform.set(c.platformType, c.id)
    }
  }

  const grouped = CATEGORIES.map((cat) => ({
    ...cat,
    platforms: (platforms ?? []).filter((p) => p.category === cat.key),
  })).filter((cat) => cat.platforms.length > 0)

  return (
    <PageShell title="Apps">
      {grouped.map((cat) => (
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
