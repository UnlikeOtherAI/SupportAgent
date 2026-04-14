import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { platformTypesApi, type PlatformTypeDetail } from '@/api/platform-types'
import { connectorsApi } from '@/api/connectors'
import { PageShell } from '@/components/ui/PageShell'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PlatformIcon } from '@/components/icons/PlatformIcons'

const CATEGORIES = [
  { key: 'error-monitoring', label: 'Error Monitoring' },
  { key: 'issue-tracker', label: 'Issue Trackers' },
  { key: 'version-control', label: 'Version Control' },
  { key: 'project-management', label: 'Project Management' },
] as const

function InstalledCard({
  connector,
  platform,
}: {
  connector: { id: string; name: string; status: string; platformType: string }
  platform: PlatformTypeDetail
}) {
  const statusColor =
    connector.status === 'healthy' ? 'bg-accent-500' :
    connector.status === 'degraded' ? 'bg-signal-amber-500' : 'bg-gray-300'

  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-gray-50">
          <PlatformIcon slug={platform.iconSlug} className="h-6 w-6 text-gray-700" />
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-accent-50 px-2.5 py-0.5 text-xs font-medium text-accent-600">
          <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />
          Connected
        </span>
      </div>
      <p className="text-sm font-semibold text-gray-900">{connector.name}</p>
      <p className="mt-0.5 text-xs text-gray-500">{platform.displayName}</p>
      <div className="mt-4">
        <Link to={`/apps/${platform.key}/configure/${connector.id}`}>
          <Button variant="secondary" className="w-full justify-center">Configure</Button>
        </Link>
      </div>
    </Card>
  )
}

function AvailableCard({
  platform,
  hasExisting,
}: {
  platform: PlatformTypeDetail
  hasExisting: boolean
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-gray-50">
        <PlatformIcon slug={platform.iconSlug} className="h-6 w-6 text-gray-700" />
      </div>
      <h3 className="text-sm font-semibold text-gray-900">{platform.displayName}</h3>
      <p className="mt-1 flex-1 text-xs leading-relaxed text-gray-500">{platform.description}</p>
      <div className="mt-4">
        <Link to={`/apps/${platform.key}/enable`}>
          <Button variant={hasExisting ? 'secondary' : 'primary'} className="w-full justify-center">
            {hasExisting ? 'Add another' : 'Install'}
          </Button>
        </Link>
      </div>
    </Card>
  )
}

export default function AppsPage() {
  const { data: platforms, isLoading } = useQuery({
    queryKey: ['platform-types'],
    queryFn: () => platformTypesApi.list(),
  })
  const { data: connectorsData } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => connectorsApi.list({ limit: 100 }),
  })

  const connectors = connectorsData?.data ?? []
  const installedByPlatform = new Map<string, typeof connectors>()
  for (const c of connectors) {
    installedByPlatform.set(c.platformType.key, [
      ...(installedByPlatform.get(c.platformType.key) ?? []),
      c,
    ])
  }

  const installedCards = connectors
    .map((c) => ({ connector: c, platform: (platforms ?? []).find((p) => p.key === c.platformType.key) }))
    .filter((x): x is { connector: typeof connectors[0]; platform: PlatformTypeDetail } => !!x.platform)

  const availablePlatforms = (platforms ?? []).filter((p) => !installedByPlatform.has(p.key))

  return (
    <PageShell title="Apps">
      {/* Installed */}
      {installedCards.length > 0 && (
        <div className="mb-10">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">Installed</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {installedCards.map(({ connector, platform }) => (
              <InstalledCard key={connector.id} connector={connector} platform={platform} />
            ))}
          </div>
        </div>
      )}

      {/* Available */}
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : availablePlatforms.length === 0 && installedCards.length > 0 ? (
        <p className="text-sm text-gray-500">All supported platforms are connected.</p>
      ) : (
        <>
          {CATEGORIES.map((cat) => {
            const catPlatforms = availablePlatforms.filter((p) => p.category === cat.key)
            const addAnother = (platforms ?? [])
              .filter((p) => p.category === cat.key && installedByPlatform.has(p.key))
            if (catPlatforms.length === 0 && addAnother.length === 0) return null
            return (
              <div key={cat.key} className="mb-8">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
                  {cat.label}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {catPlatforms.map((platform) => (
                    <AvailableCard key={platform.key} platform={platform} hasExisting={false} />
                  ))}
                  {addAnother.map((platform) => (
                    <AvailableCard key={`add-${platform.key}`} platform={platform} hasExisting />
                  ))}
                </div>
              </div>
            )
          })}
        </>
      )}
    </PageShell>
  )
}
