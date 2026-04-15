import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { providersApi } from '@/api/providers'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { executionProviderTypeOptions } from '@/lib/execution-provider-types'

export default function ProviderEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<{ name: string; type: string } | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['provider', id],
    queryFn: async () => {
      if (!id) throw new Error('Provider id is required')
      return providersApi.get(id)
    },
    enabled: !!id,
  })
  const mutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Provider id is required')
      const form = draft ?? { name: data?.name ?? '', type: data?.type ?? '' }
      return providersApi.update(id, form)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] })
      void queryClient.invalidateQueries({ queryKey: ['provider', id] })
      void navigate(`/providers/${id}`)
    },
  })

  if (isLoading) {
    return <PageShell title="Edit Provider"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!data) {
    return <PageShell title="Edit Provider"><p className="text-sm text-gray-400">Not found</p></PageShell>
  }

  const form = draft ?? { name: data.name, type: data.type }
  const providerTypeOptions = executionProviderTypeOptions.some((option) => option.value === form.type)
    ? executionProviderTypeOptions
    : [{ value: form.type, label: form.type }, ...executionProviderTypeOptions]

  return (
    <PageShell title={`Edit ${data.name}`}>
      <Link to={`/providers/${id}`} className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Provider</Link>
      <Card>
        <form onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
          <div className="space-y-4 px-5 py-5">
            <div>
              <label htmlFor="provider-name" className="mb-1.5 block text-xs font-medium text-gray-500">Name</label>
              <input
                id="provider-name"
                value={form.name}
                onChange={(event) => {
                  setDraft({ ...form, name: event.target.value })
                }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <SearchableSelect
              id="provider-type"
              label="Type"
              value={form.type}
              onChange={(value) => { setDraft({ ...form, type: value }) }}
              options={providerTypeOptions}
              placeholder="Search provider types..."
              required
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => navigate(`/providers/${id}`)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : 'Save Provider'}
            </Button>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
