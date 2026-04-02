import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { platformTypesApi } from '@/api/platform-types'
import { connectorsApi, type ConnectorSecret } from '@/api/connectors'
import { PageShell } from '@/components/ui/PageShell'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { getPlatformIcon } from '@/components/icons/PlatformIcons'

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
          onChange={(e) => onChange(e.target.value)}
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
  const inputType = field.type === 'url' ? 'url' : 'text'
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
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[var(--radius-sm)] border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
      />
      {field.helpText && <p className="mt-1 text-xs text-gray-400">{field.helpText}</p>}
    </div>
  )
}

export default function AppConfigurePage() {
  const { platformKey, connectorId } = useParams<{ platformKey: string; connectorId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [configValues, setConfigValues] = useState<Record<string, string>>({})
  const [secretValues, setSecretValues] = useState<Record<string, string>>({})
  const [editingSecrets, setEditingSecrets] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)

  const { data: platform } = useQuery({
    queryKey: ['platform-type', platformKey],
    queryFn: () => platformTypesApi.get(platformKey!),
    enabled: !!platformKey,
  })

  const { data: connector, isLoading: loadingConnector } = useQuery({
    queryKey: ['connector', connectorId],
    queryFn: () => connectorsApi.get(connectorId!),
    enabled: !!connectorId,
  })

  const { data: secrets } = useQuery({
    queryKey: ['connector-secrets', connectorId],
    queryFn: () => connectorsApi.getSecrets(connectorId!),
    enabled: !!connectorId,
  })

  // Initialize config values from connector capabilities
  useEffect(() => {
    if (initialized || !connector || !platform) return
    const caps = (connector as Record<string, unknown>).capabilities as Record<string, string> | null
    if (caps && typeof caps === 'object') {
      const initial: Record<string, string> = {}
      for (const field of platform.configFields) {
        if (!field.secretType && caps[field.key]) {
          initial[field.key] = caps[field.key]
        }
      }
      setConfigValues(initial)
    }
    setInitialized(true)
  }, [connector, platform, initialized])

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!platform || !connectorId) return

      // Update non-secret config
      const config: Record<string, string> = {}
      for (const field of platform.configFields) {
        if (!field.secretType) {
          const val = configValues[field.key] ?? ''
          if (val) config[field.key] = val
        }
      }

      await connectorsApi.update(connectorId, {
        capabilities: config,
        apiBaseUrl: configValues['api_base_url'] || undefined,
      } as Parameters<typeof connectorsApi.update>[1])

      // Update secrets that were edited
      const secretsToUpdate: Record<string, string> = {}
      for (const field of platform.configFields) {
        if (field.secretType && editingSecrets.has(field.key) && secretValues[field.key]) {
          secretsToUpdate[field.secretType] = secretValues[field.key]
        }
      }

      if (Object.keys(secretsToUpdate).length > 0) {
        await connectorsApi.setSecrets(connectorId, secretsToUpdate)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connector', connectorId] })
      void queryClient.invalidateQueries({ queryKey: ['connector-secrets', connectorId] })
      setEditingSecrets(new Set())
      setSecretValues({})
      setError(null)
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => connectorsApi.delete(connectorId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connectors'] })
      navigate('/apps')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    updateMutation.mutate()
  }

  function getSecretByType(secretType: string): ConnectorSecret | undefined {
    return (secrets ?? []).find((s) => s.secretType === secretType)
  }

  if (loadingConnector) {
    return <PageShell title="Configure"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!connector || !platform) {
    return <PageShell title="Configure"><p className="text-sm text-gray-400">Not found</p></PageShell>
  }

  const Icon = getPlatformIcon(platform.iconSlug)
  const configFields = platform.configFields.filter((f) => !f.secretType)
  const secretFields = platform.configFields.filter((f) => !!f.secretType)

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

      {/* Status header */}
      <Card className="mb-6">
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-gray-50">
            <Icon className="h-6 w-6 text-gray-700" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">{connector.name}</p>
            <p className="text-xs text-gray-500">{platform.category.replace('-', ' ')}</p>
          </div>
          <span className="rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-600">
            Connected
          </span>
        </div>
      </Card>

      <form onSubmit={handleSubmit}>
        {/* Config fields */}
        {configFields.length > 0 && (
          <Card className="mb-6">
            <CardHeader title="Configuration" />
            <div className="space-y-5 px-5 py-5">
              {configFields.map((field) => (
                <ConfigField
                  key={field.key}
                  field={field}
                  value={configValues[field.key] ?? ''}
                  onChange={(v) => setConfigValues((prev) => ({ ...prev, [field.key]: v }))}
                />
              ))}
            </div>
          </Card>
        )}

        {/* Secret fields */}
        {secretFields.length > 0 && (
          <Card className="mb-6">
            <CardHeader title="Credentials" />
            <div className="space-y-5 px-5 py-5">
              {secretFields.map((field) => (
                <SecretField
                  key={field.key}
                  field={field}
                  existingSecret={field.secretType ? getSecretByType(field.secretType) : undefined}
                  value={secretValues[field.key] ?? ''}
                  onChange={(v) => setSecretValues((prev) => ({ ...prev, [field.key]: v }))}
                  editing={editingSecrets.has(field.key)}
                  onToggleEdit={() =>
                    setEditingSecrets((prev) => {
                      const next = new Set(prev)
                      if (next.has(field.key)) next.delete(field.key)
                      else next.add(field.key)
                      return next
                    })
                  }
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
