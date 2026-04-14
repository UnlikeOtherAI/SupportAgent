import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { connectorsApi } from '@/api/connectors'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'

export default function ConnectorEditPage() {
  const { id: rawId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<{
    name: string
    platformType: string
    roles: ('inbound' | 'outbound')[]
    intakeMode: 'webhook' | 'polling'
  } | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['connector', rawId],
    queryFn: async () => {
      if (!rawId) throw new Error('No connector ID')
      return connectorsApi.get(rawId)
    },
    enabled: !!rawId,
  })
  const { data: platformData, isLoading: platformLoading } = useQuery({
    queryKey: ['connector-platform-types'],
    queryFn: () => connectorsApi.getPlatformTypes(),
  })

  // Always call useMutation unconditionally — before any conditionals
  const id = rawId ?? data?.id ?? ''
  const form = draft ?? (data ? {
    name: data.name,
    platformType: data.platformType.key,
    roles: data.roles,
    intakeMode: data.intakeMode,
  } : null)
  const mutation = useMutation({
    mutationFn: () => {
      if (!rawId) throw new Error('No connector ID')
      if (!form) throw new Error('Connector not loaded')
      return connectorsApi.update(rawId, {
        name: form.name,
        roles: form.roles,
        intakeMode: form.intakeMode,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connectors'] })
      void queryClient.invalidateQueries({ queryKey: ['connector', rawId] })
      void navigate(`/connectors/${rawId}`)
    },
  })

  function toggleRole(role: 'inbound' | 'outbound') {
    if (!form) return
    setDraft({
      ...form,
      roles: form.roles.includes(role)
        ? form.roles.filter((value) => value !== role)
        : [...form.roles, role],
    })
  }

  if (isLoading || platformLoading) {
    return <PageShell title="Edit Connector"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!data) {
    return <PageShell title="Edit Connector"><p className="text-sm text-gray-400">Not found</p></PageShell>
  }

  return (
    <PageShell title="Edit Connector">
      <Link to={`/connectors/${id}`} className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Connector</Link>
      <Card>
        <form onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
          <div className="space-y-4 px-5 py-5">
            <div>
              <label htmlFor="connector-name" className="mb-1.5 block text-xs font-medium text-gray-500">Name</label>
              <input id="connector-name" value={form?.name ?? ''} onChange={(event) => { if (form) setDraft({ ...form, name: event.target.value }); }} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" />
            </div>
            <div>
              <label htmlFor="connector-platform-type" className="mb-1.5 block text-xs font-medium text-gray-500">Platform Type</label>
              <select id="connector-platform-type" value={form?.platformType ?? ''} disabled onChange={(event) => { if (form) setDraft({ ...form, platformType: event.target.value }); }} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-500 focus:border-accent-500 focus:ring-1 focus:ring-accent-500">
                <option value="">Select a platform</option>
                {(platformData?.platformTypes ?? []).map((type) => (
                  <option key={type.key} value={type.key}>{type.label}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="mb-1.5 block text-xs font-medium text-gray-500">Roles</div>
              <div className="flex flex-col gap-2">
                {(['inbound', 'outbound'] as const).map((role) => (
                  <label key={role} htmlFor={`connector-role-${role}`} className="flex items-center gap-2 text-sm text-gray-700">
                    <input id={`connector-role-${role}`} type="checkbox" checked={form?.roles.includes(role) ?? false} onChange={() => { toggleRole(role); }} className="h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500" />
                    {role}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="connector-intake-mode" className="mb-1.5 block text-xs font-medium text-gray-500">Intake Mode</label>
              <select id="connector-intake-mode" value={form?.intakeMode ?? 'webhook'} onChange={(event) => { if (form) setDraft({ ...form, intakeMode: event.target.value as 'webhook' | 'polling' }); }} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500">
                <option value="webhook">webhook</option>
                <option value="polling">polling</option>
              </select>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => navigate(`/connectors/${id}`)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
