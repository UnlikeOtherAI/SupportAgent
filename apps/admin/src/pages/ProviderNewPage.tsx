import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { providersApi } from '@/api/providers'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { executionProviderTypeOptions } from '@/lib/execution-provider-types'

export default function ProviderNewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [type, setType] = useState('local-host')
  const mutation = useMutation({
    mutationFn: () => providersApi.create({ name, type }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] })
      void navigate('/providers')
    },
  })

  return (
    <PageShell title="New Provider">
      <Link to="/providers" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Providers</Link>
      <Card>
        <form onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
          <div className="space-y-4 px-5 py-5">
            <div>
              <label htmlFor="provider-name" className="mb-1.5 block text-xs font-medium text-gray-500">Name</label>
              <input
                id="provider-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <SearchableSelect
              id="provider-type"
              label="Type"
              value={type}
              onChange={setType}
              options={executionProviderTypeOptions}
              placeholder="Search provider types..."
              required
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => navigate('/providers')}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating...' : 'Create Provider'}
            </Button>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
