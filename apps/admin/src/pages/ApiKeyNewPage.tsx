import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { providersApi, type RuntimeApiKey } from '@/api/providers'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'

export default function ApiKeyNewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('')
  const [allowedMode, setAllowedMode] = useState<RuntimeApiKey['allowedMode']>('worker')
  const [allowedProfiles, setAllowedProfiles] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () => providersApi.createApiKey({
      label,
      allowedMode,
      allowedProfiles: allowedProfiles
        .split(',')
        .map((profile) => profile.trim())
        .filter(Boolean),
    }),
    onSuccess: (result) => {
      setSecret(result.secret)
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })

  if (secret) {
    return (
      <PageShell title="New API Key">
        <Card>
          <div className="space-y-4 px-5 py-5">
            <div className="rounded-[var(--radius-md)] border border-signal-amber-500 bg-signal-amber-50 p-4">
              <p className="text-sm font-medium text-gray-900">Copy this secret now. It won't be shown again.</p>
              <p className="mt-3 font-mono text-xs text-gray-700 break-all">{secret}</p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
            <Button variant="primary" onClick={() => navigate('/api-keys')}>Done</Button>
          </div>
        </Card>
      </PageShell>
    )
  }

  return (
    <PageShell title="New API Key">
      <Link to="/api-keys" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to API Keys</Link>
      <Card>
        <form onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
          <div className="space-y-4 px-5 py-5">
            <div>
              <label htmlFor="api-key-label" className="mb-1.5 block text-xs font-medium text-gray-500">Label</label>
              <input
                id="api-key-label"
                value={label}
                onChange={(event) => {
                  setLabel(event.target.value)
                }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <div>
              <label htmlFor="api-key-mode" className="mb-1.5 block text-xs font-medium text-gray-500">Allowed Mode</label>
              <select
                id="api-key-mode"
                value={allowedMode}
                onChange={(event) => {
                  setAllowedMode(event.target.value as RuntimeApiKey['allowedMode'])
                }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              >
                <option value="worker">worker</option>
                <option value="gateway">gateway</option>
                <option value="both">both</option>
              </select>
            </div>
            <div>
              <label htmlFor="api-key-profiles" className="mb-1.5 block text-xs font-medium text-gray-500">Allowed Profiles</label>
              <input
                id="api-key-profiles"
                value={allowedProfiles}
                onChange={(event) => {
                  setAllowedProfiles(event.target.value)
                }}
                placeholder="default, browser, android"
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => navigate('/api-keys')}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating...' : 'Create API Key'}
            </Button>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
