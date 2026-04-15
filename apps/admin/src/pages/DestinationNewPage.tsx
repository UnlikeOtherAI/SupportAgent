import { useState, type SyntheticEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { platformTypesApi } from '@/api/platform-types'
import { routingApi, type OutboundDestination } from '@/api/routing'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'
import { SearchableSelect } from '@/components/ui/SearchableSelect'

function getTextValue(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

export default function DestinationNewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [platformType, setPlatformType] = useState('')
  const { data: platformTypes } = useQuery({
    queryKey: ['platform-types', 'destination-form-options'],
    queryFn: () => platformTypesApi.list(),
  })
  const mutation = useMutation({
    mutationFn: routingApi.createDestination,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['outbound-destinations'] })
      void navigate('/routing/destinations')
    },
  })

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    mutation.mutate({
      name: getTextValue(formData, 'name').trim(),
      platformType: getTextValue(formData, 'platformType').trim(),
      deliveryType: getTextValue(formData, 'deliveryType') as OutboundDestination['deliveryType'],
    })
  }
  const platformOptions = (platformTypes ?? []).map((platform) => ({
    value: platform.key,
    label: platform.displayName,
    description: platform.category.replace('-', ' '),
  }))

  return (
    <PageShell title="New Destination">
      <Link to="/routing/destinations" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Destinations</Link>
      <Card>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-5 py-5">
            <div>
              <label htmlFor="destination-name" className="mb-1.5 block text-xs font-medium text-gray-500">Name</label>
              <input id="destination-name" name="name" required className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" />
            </div>
            <SearchableSelect
              id="destination-platform-type"
              label="Platform Type"
              name="platformType"
              value={platformType}
              onChange={setPlatformType}
              options={platformOptions}
              required
              placeholder="Search platforms..."
            />
            <div>
              <label htmlFor="destination-delivery-type" className="mb-1.5 block text-xs font-medium text-gray-500">Delivery Type</label>
              <select id="destination-delivery-type" name="deliveryType" defaultValue="comment-back" className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500">
                <option value="comment-back">comment-back</option>
                <option value="create-issue">create-issue</option>
                <option value="pr">pr</option>
                <option value="draft-pr">draft-pr</option>
              </select>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => { void navigate('/routing/destinations') }}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>{mutation.isPending ? 'Creating...' : 'Create Destination'}</Button>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
