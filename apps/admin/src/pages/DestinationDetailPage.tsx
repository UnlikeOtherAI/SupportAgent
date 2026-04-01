import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { routingApi } from '@/api/routing'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-800">{value}</dd>
    </div>
  )
}

export default function DestinationDetailPage() {
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
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Missing destination id')
      return routingApi.deleteDestination(id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['outbound-destinations'] })
      void navigate('/routing/destinations')
    },
  })

  if (isLoading) {
    return <PageShell title="Destination"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!data) {
    return <PageShell title="Destination"><p className="text-sm text-gray-400">Not found</p></PageShell>
  }

  return (
    <PageShell
      title={data.name}
      action={
        <>
          <Link to={`/routing/destinations/${data.id}/edit`}><Button>Edit</Button></Link>
          <Button variant="danger" onClick={() => { deleteMutation.mutate() }} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </>
      }
    >
      <Link to="/routing/destinations" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Destinations</Link>
      <Card className="divide-y divide-gray-100">
        <DetailRow label="Name" value={data.name} />
        <DetailRow label="Platform Type" value={data.platformType} />
        <DetailRow label="Delivery Type" value={<span className="font-mono text-xs text-gray-600">{data.deliveryType}</span>} />
        <DetailRow label="Configured" value={data.configured ? 'Yes' : 'No'} />
        <DetailRow label="Created" value={<span className="font-mono text-xs text-gray-500">{data.createdAt}</span>} />
      </Card>
    </PageShell>
  )
}
