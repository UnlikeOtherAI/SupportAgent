import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { platformTypesApi } from '@/api/platform-types'
import { connectorsApi, type ConnectorSecret, type GitHubRepositoryOption } from '@/api/connectors'
import { repositoriesApi } from '@/api/repositories'
import { PageShell } from '@/components/ui/PageShell'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PlatformIcon } from '@/components/icons/PlatformIcons'
import { SearchableSelect } from '@/components/ui/SearchableSelect'

const DEFAULT_POLLING_INTERVAL_MINUTES = 5
const LOCAL_GH_PLATFORM_KEYS = new Set(['github', 'github_issues'])
const LOCAL_GH_HIDDEN_CONFIG_KEYS = new Set(['api_base_url', 'repo_name', 'repo_owner'])

function SecretField({
  field,
  existingSecret,
  value,
  onChange,
  editing,
  onToggleEdit,
}: {
  field: { key: string; label: string; placeholder?: string; helpText?: string; required: boolean; secretType?: string }
  existingSecret?: ConnectorSecret
  value: string
  onChange: (v: string) => void
  editing: boolean
  onToggleEdit: () => void
}) {
  const id = `field-${field.key}`
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">
        {field.label}
        {field.required && <span className="text-signal-red-500"> *</span>}
      </label>
      {existingSecret && !editing ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 rounded-[var(--radius-sm)] border border-gray-100 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-500">
            {existingSecret.maskedHint ?? '****'}
          </span>
          <Button type="button" variant="ghost" onClick={onToggleEdit}>Update</Button>
        </div>
      ) : (
        <input
          id={id}
          type="password"
          placeholder={field.placeholder}
          value={value}
          onChange={(event) => { onChange(event.target.value) }}
          className="w-full rounded-[var(--radius-sm)] border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
        />
      )}
      {field.helpText && <p className="mt-1 text-xs text-gray-400">{field.helpText}</p>}
    </div>
  )
}

function ConfigField({
  field,
  value,
  onChange,
}: {
  field: { key: string; label: string; type: string; placeholder?: string; helpText?: string; required: boolean }
  value: string
  onChange: (v: string) => void
}) {
  const id = `field-${field.key}`
  const inputType = field.type === 'url' ? 'url' : field.type === 'number' ? 'number' : 'text'
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">
        {field.label}
        {field.required && <span className="text-signal-red-500"> *</span>}
      </label>
      <input
        id={id}
        type={inputType}
        placeholder={field.placeholder}
        value={value}
        onChange={(event) => { onChange(event.target.value) }}
        className="w-full rounded-[var(--radius-sm)] border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
      />
      {field.helpText && <p className="mt-1 text-xs text-gray-400">{field.helpText}</p>}
    </div>
  )
}

function getRepoName(repository: GitHubRepositoryOption) {
  return repository.nameWithOwner.split('/').slice(1).join('/')
}

function getPollingMinutes(seconds?: number | null) {
  if (!seconds || seconds <= 0) {
    return DEFAULT_POLLING_INTERVAL_MINUTES
  }
  return Math.max(1, Math.round(seconds / 60))
}

function optionalString(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export default function AppConfigurePage() {
  const { platformKey, connectorId } = useParams<{ platformKey: string; connectorId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [secretValues, setSecretValues] = useState<Record<string, string>>({})
  const [editingSecrets, setEditingSecrets] = useState(new Set<string>())
  const [error, setError] = useState<string | null>(null)
  const [configOverrides, setConfigOverrides] = useState<Partial<Record<string, string>>>({})
  const [pollingMinutesOverride, setPollingMinutesOverride] = useState<string | undefined>(undefined)
  const [repositoryOwnerOverride, setRepositoryOwnerOverride] = useState<string | undefined>(undefined)
  const [selectedRepositoryUrlOverride, setSelectedRepositoryUrlOverride] = useState<string | undefined>(undefined)

  const { data: platform } = useQuery({
    queryKey: ['platform-type', platformKey],
    queryFn: () => platformTypesApi.get(platformKey ?? ''),
    enabled: !!platformKey,
  })

  const { data: connector, isLoading: loadingConnector } = useQuery({
    queryKey: ['connector', connectorId],
    queryFn: () => connectorsApi.get(connectorId ?? ''),
    enabled: !!connectorId,
  })

  const { data: secrets } = useQuery({
    queryKey: ['connector-secrets', connectorId],
    queryFn: () => connectorsApi.getSecrets(connectorId ?? ''),
    enabled: !!connectorId,
  })

  const isLocalGhConnector =
    !!connector &&
    LOCAL_GH_PLATFORM_KEYS.has(connector.platformType.key) &&
    connector.config?.auth_mode === 'local_gh'

  const { data: repositoryMappingData } = useQuery({
    queryKey: ['repository-mappings', connectorId],
    queryFn: () => repositoriesApi.list({ connectorId, limit: 100 }),
    enabled: !!connectorId && isLocalGhConnector,
  })

  const {
    data: repositoryOwners,
    error: repositoryOwnersError,
    isLoading: loadingRepositoryOwners,
  } = useQuery({
    queryKey: ['connector-repository-owners', connectorId],
    queryFn: () => connectorsApi.listRepositoryOwners(connectorId ?? ''),
    enabled: !!connectorId && isLocalGhConnector,
  })

  const currentMapping = repositoryMappingData?.items[0] ?? null
  const currentConfig: Partial<Record<string, string>> = connector?.config ?? {}
  const configValues: Partial<Record<string, string>> = { ...currentConfig, ...configOverrides }
  const repositoryOwnerValue =
    repositoryOwnerOverride ?? configOverrides.repo_owner ?? currentConfig.repo_owner ?? ''
  const pollingMinutesValue =
    pollingMinutesOverride ?? String(getPollingMinutes(connector?.pollingIntervalSeconds))
  const derivedRepositoryUrl =
    currentMapping?.repositoryUrl ??
    (currentConfig.repo_owner && currentConfig.repo_name
      ? `https://github.com/${currentConfig.repo_owner}/${currentConfig.repo_name}`
      : '')
  const selectedRepositoryUrl = selectedRepositoryUrlOverride ?? derivedRepositoryUrl

  const {
    data: repositoryOptions,
    error: repositoryOptionsError,
    isLoading: loadingRepositoryOptions,
    refetch: refetchRepositoryOptions,
  } = useQuery({
    queryKey: ['connector-repository-options', connectorId, repositoryOwnerValue],
    queryFn: () => connectorsApi.listRepositoryOptions(connectorId ?? '', optionalString(repositoryOwnerValue)),
    enabled: !!connectorId && isLocalGhConnector,
  })

  const selectedRepository = useMemo(
    () => repositoryOptions?.repositories.find((repository) => repository.url === selectedRepositoryUrl) ?? null,
    [repositoryOptions, selectedRepositoryUrl],
  )
  const discoveredOwnerOptions = (repositoryOwners?.owners ?? []).map((owner) => ({
    value: owner.login,
    label: owner.login,
    description: owner.type,
  }))
  const repositoryOwnerOptions = repositoryOwnerValue && !discoveredOwnerOptions.some((option) => option.value === repositoryOwnerValue)
    ? [{ value: repositoryOwnerValue, label: repositoryOwnerValue, description: 'current value' }, ...discoveredOwnerOptions]
    : discoveredOwnerOptions
  const repositorySelectOptions = (repositoryOptions?.repositories ?? []).map((repository) => ({
    value: repository.url,
    label: repository.nameWithOwner,
    description: repository.defaultBranch,
  }))

  function handleRepositoryOwnerChange(value: string) {
    setRepositoryOwnerOverride(value)
    setSelectedRepositoryUrlOverride('')
  }

  const visibleConfigFields = useMemo(() => {
    if (!platform) return []
    return platform.configFields.filter((field) => {
      if (field.secretType) return false
      if (!isLocalGhConnector) return true
      return !LOCAL_GH_HIDDEN_CONFIG_KEYS.has(field.key)
    })
  }, [isLocalGhConnector, platform])

  const visibleSecretFields = useMemo(() => {
    if (!platform) return []
    if (isLocalGhConnector) return []
    return platform.configFields.filter((field) => !!field.secretType)
  }, [isLocalGhConnector, platform])

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!platform || !connectorId || !connector) return

      const nextConfig: Record<string, string> = {}
      for (const field of visibleConfigFields) {
        const value = configValues[field.key]?.trim() ?? ''
        if (field.required && !value) {
          throw new Error(`${field.label} is required`)
        }
        if (value) {
          nextConfig[field.key] = value
        }
      }

      const secretsToUpdate: Record<string, string> = {}
      for (const field of visibleSecretFields) {
        if (field.secretType && editingSecrets.has(field.key) && secretValues[field.key]) {
          secretsToUpdate[field.secretType] = secretValues[field.key]
        }
      }

      if (isLocalGhConnector) {
        const pollingMinutes = Number.parseInt(pollingMinutesValue, 10)
        if (!Number.isFinite(pollingMinutes) || pollingMinutes < 1) {
          throw new Error('Polling interval must be at least 1 minute')
        }
        if (!selectedRepository) {
          throw new Error('Select a repository to monitor')
        }

        nextConfig.auth_mode = 'local_gh'
        nextConfig.repo_owner = selectedRepository.owner
        nextConfig.repo_name = getRepoName(selectedRepository)

        await connectorsApi.update(connectorId, {
          config: nextConfig,
          configuredIntakeMode: 'polling',
          pollingIntervalSeconds: pollingMinutes * 60,
        })

        if (currentMapping) {
          await repositoriesApi.update(currentMapping.id, {
            defaultBranch: selectedRepository.defaultBranch,
            repositoryUrl: selectedRepository.url,
          })
        } else {
          await repositoriesApi.create({
            connectorId,
            defaultBranch: selectedRepository.defaultBranch,
            repositoryUrl: selectedRepository.url,
          })
        }
      } else {
        await connectorsApi.update(connectorId, {
          config: nextConfig,
        })
      }

      if (Object.keys(secretsToUpdate).length > 0) {
        await connectorsApi.setSecrets(connectorId, secretsToUpdate)
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['connector', connectorId] }),
        queryClient.invalidateQueries({ queryKey: ['connector-secrets', connectorId] }),
        queryClient.invalidateQueries({ queryKey: ['repositories'] }),
        queryClient.invalidateQueries({ queryKey: ['repository-mappings', connectorId] }),
      ])
      setEditingSecrets(new Set())
      setSecretValues({})
      setError(null)
    },
    onError: (mutationError: Error) => {
      setError(mutationError.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => connectorsApi.delete(connectorId ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connectors'] })
      void navigate('/apps')
    },
  })

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    updateMutation.mutate()
  }

  function getSecretByType(secretType: string): ConnectorSecret | undefined {
    return (secrets ?? []).find((secret) => secret.secretType === secretType)
  }

  if (loadingConnector) {
    return <PageShell title="Configure"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!connector || !platform) {
    return <PageShell title="Configure"><p className="text-sm text-gray-400">Not found</p></PageShell>
  }

  return (
    <PageShell
      title={`Configure ${platform.displayName}`}
      action={
        <div className="flex gap-2">
          <Link to={`/connectors/${connectorId}/triggers`}>
            <Button variant="secondary">Triggers</Button>
          </Link>
          <Button
            variant="danger"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (window.confirm(`Disable ${platform.displayName} and delete this connector?`)) {
                deleteMutation.mutate()
              }
            }}
          >
            {deleteMutation.isPending ? 'Disabling...' : 'Disable'}
          </Button>
        </div>
      }
    >
      <Link to="/apps" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Apps</Link>

      <Card className="mb-6">
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-gray-50">
            <PlatformIcon slug={platform.iconSlug} className="h-6 w-6 text-gray-700" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">{connector.name}</p>
            <p className="text-xs text-gray-500">{platform.category.replace('-', ' ')}</p>
          </div>
          <span className="rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-600">
            {isLocalGhConnector ? 'Local gh' : 'Connected'}
          </span>
        </div>
      </Card>

      <form onSubmit={handleSubmit}>
        {isLocalGhConnector && (
          <Card className="mb-6">
            <CardHeader
              title="Polling Setup"
              subtitle="Use the GitHub CLI session on this machine, monitor one mapped repository, and queue triage for open issues that still need discovery."
            />
            <div className="space-y-5 px-5 py-5">
              <div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <SearchableSelect
                    id="polling-owner"
                    label="Repository Owner Filter"
                    value={repositoryOwnerValue}
                    onChange={handleRepositoryOwnerChange}
                    options={repositoryOwnerOptions}
                    allowClear
                    placeholder={loadingRepositoryOwners ? 'Loading owners...' : 'Search owners...'}
                  />
                  <Button type="button" variant="secondary" onClick={() => { void refetchRepositoryOptions() }}>
                    Refresh Repos
                  </Button>
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  Leave blank to load repositories from the authenticated account and org memberships.
                </p>
                {repositoryOwnersError instanceof Error && (
                  <p className="mt-1 text-sm text-signal-red-500">{repositoryOwnersError.message}</p>
                )}
              </div>

              <div>
                <SearchableSelect
                  id="polling-repository"
                  label="Repository To Monitor"
                  value={selectedRepositoryUrl}
                  onChange={setSelectedRepositoryUrlOverride}
                  options={repositorySelectOptions}
                  placeholder={loadingRepositoryOptions ? 'Loading repositories...' : 'Search repositories...'}
                  required
                />
                {selectedRepository && (
                  <p className="mt-1 text-xs text-gray-400">
                    Default branch: <span className="font-mono">{selectedRepository.defaultBranch}</span>
                  </p>
                )}
                {repositoryOptionsError instanceof Error && (
                  <p className="mt-1 text-sm text-signal-red-500">{repositoryOptionsError.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="polling-interval" className="mb-1 block text-xs font-medium text-gray-700">
                  Polling Interval (minutes)
                </label>
                <input
                  id="polling-interval"
                  type="number"
                  min="1"
                  step="1"
                  value={pollingMinutesValue}
                  onChange={(event) => { setPollingMinutesOverride(event.target.value) }}
                  className="w-full rounded-[var(--radius-sm)] border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Issues without the discovery comment marker and `triaged` label will be queued when this interval elapses.
                </p>
              </div>
            </div>
          </Card>
        )}

        {visibleConfigFields.length > 0 && (
          <Card className="mb-6">
            <CardHeader title="Configuration" />
            <div className="space-y-5 px-5 py-5">
              {visibleConfigFields.map((field) => (
                <ConfigField
                  key={field.key}
                  field={field}
                  value={configValues[field.key] ?? ''}
                  onChange={(value) => { setConfigOverrides((previous) => ({ ...previous, [field.key]: value })) }}
                />
              ))}
            </div>
          </Card>
        )}

        {visibleSecretFields.length > 0 && (
          <Card className="mb-6">
            <CardHeader title="Credentials" />
            <div className="space-y-5 px-5 py-5">
              {visibleSecretFields.map((field) => (
                <SecretField
                  key={field.key}
                  field={field}
                  existingSecret={field.secretType ? getSecretByType(field.secretType) : undefined}
                  value={secretValues[field.key] ?? ''}
                  onChange={(value) => { setSecretValues((previous) => ({ ...previous, [field.key]: value })) }}
                  editing={editingSecrets.has(field.key)}
                  onToggleEdit={() => {
                    setEditingSecrets((previous) => {
                      const next = new Set(previous)
                      if (next.has(field.key)) next.delete(field.key)
                      else next.add(field.key)
                      return next
                    })
                  }}
                />
              ))}
            </div>
          </Card>
        )}

        {error && <p className="mb-4 text-sm text-signal-red-500">{error}</p>}

        <div className="flex gap-3">
          <Button type="submit" variant="primary" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
          <Link to="/apps">
            <Button type="button" variant="secondary">Cancel</Button>
          </Link>
        </div>
      </form>
    </PageShell>
  )
}
