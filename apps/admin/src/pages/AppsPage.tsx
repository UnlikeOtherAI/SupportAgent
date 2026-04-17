import { useState, useRef, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { platformTypesApi, type PlatformTypeDetail } from '@/api/platform-types'
import { connectorsApi } from '@/api/connectors'
import { PageShell } from '@/components/ui/PageShell'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PlatformIcon } from '@/components/icons/PlatformIcons'
import { EmptyState } from '@/components/ui/EmptyState'

const CATEGORIES = [
  { key: 'error-monitoring', label: 'Error Monitoring' },
  { key: 'issue-tracker', label: 'Issue Trackers' },
  { key: 'version-control', label: 'Version Control' },
  { key: 'project-management', label: 'Project Management' },
] as const

// ─── Left panel: available platforms ───────────────────────────────────────────

function AvailableCard({ platform }: { platform: PlatformTypeDetail }) {
  return (
    <Card className="flex flex-col p-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-gray-50">
        <PlatformIcon slug={platform.iconSlug} className="h-5 w-5 text-gray-700" />
      </div>
      <h3 className="text-sm font-semibold text-gray-900">{platform.displayName}</h3>
      <p className="mt-1 flex-1 text-xs leading-relaxed text-gray-500 line-clamp-2">{platform.description}</p>
      <div className="mt-3">
        <Link to={`/apps/${platform.key}/enable`}>
          <Button variant="primary" className="w-full justify-center">Install</Button>
        </Link>
      </div>
    </Card>
  )
}

// ─── Right panel: installed connectors ────────────────────────────────────────

function connectorSubtitle(config?: Record<string, string>, intakeMode?: string): string {
  if (config?.repo_owner && config?.repo_name) return `${config.repo_owner}/${config.repo_name}`
  if (config?.repo_name) return config.repo_name
  if (config?.repo_owner) return config.repo_owner
  if (config?.project_key) return config.project_key
  if (config?.base_url) return config.base_url
  const extra = Object.values(config ?? {}).find((v) => v && v !== 'oauth' && v !== 'token' && v !== 'local_gh')
  if (extra) return extra
  return intakeMode ?? ''
}

function ConnectorCard({
  connector,
  platformKey,
}: {
  connector: { id: string; name: string; status: string; config?: Record<string, string>; intakeMode: string }
  platformKey: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: () => connectorsApi.delete(connector.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connectors'] })
    },
  })

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const statusColor =
    connector.status === 'healthy' ? 'bg-accent-500' :
    connector.status === 'degraded' ? 'bg-signal-amber-500' : 'bg-gray-300'

  const subtitle = connectorSubtitle(connector.config, connector.intakeMode)

  if (deleteConfirm) {
    return (
      <div className="flex items-center justify-between rounded-md border border-red-100 bg-red-50/50 px-3 py-2">
        <span className="text-xs text-red-600">Delete this connector?</span>
        <div className="flex items-center gap-1">
          {deleteMutation.isPending ? (
            <span className="text-xs text-gray-400">Deleting…</span>
          ) : (
            <>
              <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => deleteMutation.mutate()}>Confirm</Button>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50/50 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusColor}`} />
        <div className="min-w-0">
          <span className="truncate text-sm text-gray-700">{connector.name || 'Untitled'}</span>
          {subtitle && <span className="ml-2 text-xs text-gray-400">{subtitle}</span>}
        </div>
      </div>
      <div className="relative shrink-0 ml-2" ref={menuRef}>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Options"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="2.5" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13.5" r="1.5"/>
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
            <Link
              to={`/apps/${platformKey}/configure/${connector.id}`}
              onClick={() => setMenuOpen(false)}
              className="block px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              Configure
            </Link>
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-xs text-red-500 hover:bg-red-50"
              onClick={() => { setMenuOpen(false); setDeleteConfirm(true) }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function InstalledPlatformGroup({
  platformKey,
  connectors,
  platform,
}: {
  platformKey: string
  connectors: { id: string; name: string; status: string; config?: Record<string, string>; intakeMode: string }[]
  platform: PlatformTypeDetail
}) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] bg-gray-100">
          <PlatformIcon slug={platform.iconSlug} className="h-4 w-4 text-gray-700" />
        </div>
        <h3 className="text-sm font-semibold text-gray-900">{platform.displayName}</h3>
        <span className="text-xs text-gray-400">({connectors.length})</span>
      </div>
      <div className="space-y-1.5">
        {connectors.map((c) => (
          <ConnectorCard key={c.id} connector={c} platformKey={platformKey} />
        ))}
      </div>
      <div className="mt-2">
        <Link to={`/apps/${platformKey}/enable`}>
          <Button variant="ghost" className="text-xs text-gray-400 hover:text-gray-700">+ Add another</Button>
        </Link>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AppsPage() {
  const { data: platforms, isLoading: platformsLoading } = useQuery({
    queryKey: ['platform-types'],
    queryFn: () => platformTypesApi.list(),
  })
  const { data: connectorsData, isLoading: connectorsLoading } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => connectorsApi.list({ limit: 100 }),
  })

  const connectors = connectorsData?.items ?? []

  // Group connectors by platform key
  const installedByPlatform = new Map<string, typeof connectors>()
  for (const c of connectors) {
    const existing = installedByPlatform.get(c.platformType.key) ?? []
    existing.push(c)
    installedByPlatform.set(c.platformType.key, existing)
  }

  // Available = platforms with zero connectors installed
  const availablePlatforms = (platforms ?? []).filter((p) => !installedByPlatform.has(p.key))

  // Installed platforms = platforms that have at least one connector
  const installedPlatforms = (platforms ?? []).filter((p) => installedByPlatform.has(p.key))

  const isLoading = platformsLoading || connectorsLoading

  return (
    <PageShell title="Apps" fullWidth>
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10">
          {/* Left panel: available to install */}
          <div>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-500">
              Available
            </h2>
            {availablePlatforms.length === 0 && installedPlatforms.length > 0 ? (
              <p className="text-sm text-gray-400">All supported platforms are connected.</p>
            ) : (
              <div className="space-y-6">
                {CATEGORIES.map((cat) => {
                  const catPlatforms = availablePlatforms.filter((p) => p.category === cat.key)
                  if (catPlatforms.length === 0) return null
                  return (
                    <div key={cat.key}>
                      <h3 className="mb-2 text-xs font-medium text-gray-400">{cat.label}</h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {catPlatforms.map((platform) => (
                          <AvailableCard key={platform.key} platform={platform} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Right panel: installed connectors */}
          <div>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-500">
              Connected
            </h2>
            {connectors.length === 0 ? (
              <EmptyState
                title="No connectors installed"
                description="Install a platform from the left panel to get started."
              />
            ) : (
              <Card className="p-4">
                {/* Group installed connectors by platform type, preserving platform category order */}
                {(() => {
                  const orderedPlatformKeys = installedPlatforms.map((p) => p.key)
                  return orderedPlatformKeys.map((key) => {
                    const platform = platforms?.find((candidate) => candidate.key === key)
                    const platformConnectors = installedByPlatform.get(key)
                    if (!platform || !platformConnectors) return null
                    return (
                      <InstalledPlatformGroup
                        key={key}
                        platformKey={key}
                        connectors={platformConnectors}
                        platform={platform}
                      />
                    )
                  })
                })()}
              </Card>
            )}
          </div>
        </div>
      )}
    </PageShell>
  )
}
