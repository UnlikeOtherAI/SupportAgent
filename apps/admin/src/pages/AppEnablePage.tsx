import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { platformTypesApi } from '@/api/platform-types'
import { connectorsApi } from '@/api/connectors'
import { PageShell } from '@/components/ui/PageShell'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PlatformIcon } from '@/components/icons/PlatformIcons'

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
  const inputType = field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'
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
        onChange={(e) => { onChange(e.target.value) }}
        className="w-full rounded-[var(--radius-sm)] border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
      />
      {field.helpText && <p className="mt-1 text-xs text-gray-400">{field.helpText}</p>}
    </div>
  )
}

export default function AppEnablePage() {
  const { platformKey } = useParams<{ platformKey: string }>()
  const navigate = useNavigate()
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const { data: platform, isLoading } = useQuery({
    queryKey: ['platform-type', platformKey],
    queryFn: () => platformTypesApi.get(platformKey ?? ''),
    enabled: !!platformKey,
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!platform) throw new Error('Platform not loaded')

      const secrets: Record<string, string> = {}
      const config: Record<string, string> = {}
      for (const field of platform.configFields) {
        const val = values[field.key] ?? ''
        if (!val) continue
        if (field.secretType) {
          secrets[field.secretType] = val
        } else {
          config[field.key] = val
        }
      }

      return connectorsApi.create({
        platformTypeKey: platform.key,
        name: platform.displayName,
        direction: platform.defaultDirection,
        configuredIntakeMode: platform.defaultIntakeMode,
        config,
        secrets,
      } as Parameters<typeof connectorsApi.create>[0])
    },
    onSuccess: (connector) => {
      void navigate(`/apps/${platformKey}/configure/${connector.id}`)
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (platform) {
      for (const field of platform.configFields) {
        if (field.required && !values[field.key]) {
          setError(`${field.label} is required`)
          return
        }
      }
    }

    createMutation.mutate()
  }

  if (isLoading) {
    return <PageShell title="Enable App"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!platform) {
    return <PageShell title="Enable App"><p className="text-sm text-gray-400">Platform not found</p></PageShell>
  }

  return (
    <PageShell title={`Enable ${platform.displayName}`}>
      <Link to="/apps" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Apps</Link>

      <Card>
        <CardHeader title={platform.displayName} subtitle={platform.description} />

        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-gray-50">
            <PlatformIcon slug={platform.iconSlug} className="h-6 w-6 text-gray-700" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">{platform.displayName}</p>
            <p className="text-xs text-gray-500">{platform.category.replace('-', ' ')}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-5 py-5">
          {platform.configFields.map((field) => (
            <ConfigField
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              onChange={(v) => { setValues((prev) => ({ ...prev, [field.key]: v })) }}
            />
          ))}

          {error && <p className="text-sm text-signal-red-500">{error}</p>}

          <div className="flex gap-3 pt-2">
            <Button type="submit" variant="primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Enabling...' : 'Enable'}
            </Button>
            <Link to="/apps">
              <Button type="button" variant="secondary">Cancel</Button>
            </Link>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
