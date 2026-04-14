import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { platformTypesApi } from '@/api/platform-types'
import { connectorsApi } from '@/api/connectors'
import { PageShell } from '@/components/ui/PageShell'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PlatformIcon } from '@/components/icons/PlatformIcons'

const LOCAL_GH_PLATFORMS = new Set(['github', 'github_issues'])

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
  // 'choose' shows the method picker; 'token' shows the PAT form.
  // Platforms without oauthAvailable skip straight to 'token'.
  const [authMethod, setAuthMethod] = useState<'choose' | 'token'>('choose')

  const { data: platform, isLoading } = useQuery({
    queryKey: ['platform-type', platformKey],
    queryFn: () => platformTypesApi.get(platformKey ?? ''),
    enabled: !!platformKey,
  })

  const supportsLocalGhInstall = platform ? LOCAL_GH_PLATFORMS.has(platform.key) : false

  // OAuth flow: create a connector shell, then redirect to the provider
  const oauthMutation = useMutation({
    mutationFn: async () => {
      if (!platform) throw new Error('Platform not loaded')
      const connector = await connectorsApi.create({
        platformTypeKey: platform.key,
        name: platform.displayName,
        direction: platform.defaultDirection,
        configuredIntakeMode: platform.defaultIntakeMode,
        config: {},
        secrets: {},
      } as Parameters<typeof connectorsApi.create>[0])
      let redirectUrl: string
      try {
        const result = await connectorsApi.getOAuthStartUrl(platform.key, connector.id)
        redirectUrl = result.redirectUrl
      } catch (err) {
        await connectorsApi.delete(connector.id).catch(() => undefined)
        throw err
      }
      if (!redirectUrl.startsWith('https://')) throw new Error('Invalid OAuth redirect URL')
      return redirectUrl
    },
    onSuccess: (redirectUrl) => {
      window.location.href = redirectUrl
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  // Token flow: create the connector with secrets from the form
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

  const localGhMutation = useMutation({
    mutationFn: async () => {
      if (!platform) throw new Error('Platform not loaded')
      return connectorsApi.create({
        platformTypeKey: platform.key,
        name: platform.displayName,
        direction: platform.defaultDirection,
        configuredIntakeMode: 'polling',
        pollingIntervalSeconds: 300,
        config: {
          auth_mode: 'local_gh',
        },
        secrets: {},
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
    if (!platform) return
    for (const field of platform.configFields) {
      if (field.required && !values[field.key]) {
        setError(`${field.label} is required`)
        return
      }
    }
    createMutation.mutate()
  }

  if (isLoading) {
    return <PageShell title="Install App"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!platform) {
    return <PageShell title="Install App"><p className="text-sm text-gray-400">Platform not found</p></PageShell>
  }

  // Method picker — shown for OAuth-capable platforms before the user picks a path
  if ((platform.oauthAvailable || supportsLocalGhInstall) && authMethod === 'choose') {
    return (
      <PageShell title={`Connect ${platform.displayName}`}>
        <Link to="/apps" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back</Link>
        <Card className="max-w-md">
          <CardHeader title={`Connect ${platform.displayName}`} subtitle="How would you like to authenticate?" />
          <div className="space-y-3 px-5 pb-5">
            {/* OAuth option */}
            <button
              type="button"
              disabled={oauthMutation.isPending}
              onClick={() => { setError(null); oauthMutation.mutate() }}
              className="flex w-full items-center gap-4 rounded-[var(--radius-sm)] border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:border-accent-400 hover:bg-accent-50 disabled:opacity-50"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-accent-50">
                <PlatformIcon slug={platform.iconSlug} className="h-5 w-5 text-accent-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {oauthMutation.isPending ? 'Redirecting…' : `Connect with ${platform.displayName}`}
                </p>
                <p className="text-xs text-gray-500">Authorize via our registered OAuth app — no tokens to copy</p>
              </div>
            </button>

            {/* Token option */}
            <button
              type="button"
              onClick={() => { setAuthMethod('token') }}
              className="flex w-full items-center gap-4 rounded-[var(--radius-sm)] border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:border-gray-300 hover:bg-gray-50"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-gray-50">
                <span className="text-sm font-medium text-gray-500">PAT</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Use a personal access token</p>
                <p className="text-xs text-gray-500">For self-hosted / enterprise instances, or manual credential management</p>
              </div>
            </button>

            {supportsLocalGhInstall && (
              <button
                type="button"
                disabled={localGhMutation.isPending}
                onClick={() => { setError(null); localGhMutation.mutate() }}
                className="flex w-full items-center gap-4 rounded-[var(--radius-sm)] border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:border-accent-400 hover:bg-accent-50 disabled:opacity-50"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-accent-50">
                  <span className="text-sm font-semibold text-accent-700">gh</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {localGhMutation.isPending ? 'Connecting…' : 'Use local gh CLI'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Reuse the GitHub CLI session on this machine and start in polling mode every 5 minutes
                  </p>
                </div>
              </button>
            )}

            {error && <p className="pt-1 text-sm text-signal-red-500">{error}</p>}
          </div>
        </Card>
      </PageShell>
    )
  }

  // Token form (always available; default for platforms without OAuth)
  return (
    <PageShell title={`Connect ${platform.displayName}`}>
      <Link to="/apps" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back</Link>

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
              {createMutation.isPending ? 'Connecting…' : 'Connect'}
            </Button>
            {platform.oauthAvailable && (
              <Button type="button" variant="secondary" onClick={() => { setAuthMethod('choose') }}>
                Back
              </Button>
            )}
            <Link to="/apps">
              <Button type="button" variant="secondary">Cancel</Button>
            </Link>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
