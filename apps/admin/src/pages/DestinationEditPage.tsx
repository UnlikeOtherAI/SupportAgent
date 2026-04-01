import type { SyntheticEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { routingApi, type OutboundDestination } from '@/api/routing'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'

function getTextValue(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

export default function DestinationEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['outbound-destination', id],
    queryFn: async () => {
      if (!id) throw new Error('Missing destination id')
      return routingApi.getDestination(id)
    },
    enabled: !!id,
  })

  const mutation = useMutation({
    mutationFn: async (payload: Parameters<typeof routingApi.updateDestination>[1]) => {
      if (!id) throw new Error('Missing destination id')
      return routingApi.updateDestination(id, payload)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['outbound-destinations'] })
      void queryClient.invalidateQueries({ queryKey: ['outbound-destination', id] })
      void navigate(`/routing/destinations/${id}`)
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

  if (isLoading) {
    return <PageShell title="Edit Destination"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!data) {
    return <PageShell title="Edit Destination"><p className="text-sm text-gray-400">Not found</p></PageShell>
  }

  return (
    <PageShell title="Edit Destination">
      <Link to={`/routing/destinations/${id}`} className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Destination</Link>
      <Card>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-5 py-5">
            <div>
              <label htmlFor="edit-destination-name" className="mb-1.5 block text-xs font-medium text-gray-500">Name</label>
              <input id="edit-destination-name" name="name" required defaultValue={data.name} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" />
            </div>
            <div>
              <label htmlFor="edit-destination-platform-type" className="mb-1.5 block text-xs font-medium text-gray-500">Platform Type</label>
              <input id="edit-destination-platform-type" name="platformType" required defaultValue={data.platformType} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" />
            </div>
            <div>
              <label htmlFor="edit-destination-delivery-type" className="mb-1.5 block text-xs font-medium text-gray-500">Delivery Type</label>
              <select id="edit-destination-delivery-type" name="deliveryType" defaultValue={data.deliveryType} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500">
                <option value="comment-back">comment-back</option>
                <option value="create-issue">create-issue</option>
                <option value="pr">pr</option>
                <option value="draft-pr">draft-pr</option>
              </select>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => { void navigate(`/routing/destinations/${id}`) }}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving...' : 'Save Changes'}</Button>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
