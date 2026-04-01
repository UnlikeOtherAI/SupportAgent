import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { routingApi, type OutboundDestination } from '@/api/routing'
import { PlusIcon } from '@/components/icons/NavIcons'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { Pagination } from '@/components/ui/Pagination'

const columns: Column<OutboundDestination>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (destination) => (
      <Link to={`/routing/destinations/${destination.id}`} className="font-medium text-gray-900 hover:underline">
        {destination.name}
      </Link>
    ),
  },
  {
    key: 'platformType',
    header: 'Platform Type',
    render: (destination) => destination.platformType,
  },
  {
    key: 'deliveryType',
    header: 'Delivery Type',
    render: (destination) => <span className="font-mono text-xs text-gray-600">{destination.deliveryType}</span>,
  },
  {
    key: 'configured',
    header: 'Configured',
    render: (destination) => (
      <span className={`inline-flex items-center text-base ${destination.configured ? 'text-emerald-600' : 'text-signal-red-500'}`} aria-label={destination.configured ? 'Configured' : 'Not configured'}>
        {destination.configured ? <span aria-hidden="true">&#10003;</span> : <span aria-hidden="true">&times;</span>}
      </span>
    ),
  },
  {
    key: 'createdAt',
    header: 'Created',
    render: (destination) => <span className="font-mono text-xs text-gray-500">{destination.createdAt}</span>,
  },
]

export default function DestinationsPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['outbound-destinations', page],
    queryFn: () => routingApi.listDestinations({ page }),
  })

  if (isLoading) {
    return <PageShell title="Outbound Destinations"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  const destinations = data?.data ?? []
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit ?? 20)))

  return (
    <PageShell
      title="Outbound Destinations"
      action={
        <Link to="/routing/destinations/new">
          <Button variant="primary" icon={<PlusIcon />}>New Destination</Button>
        </Link>
      }
    >
      <Link to="/routing" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Routing Rules</Link>
      <Card>
        <CardHeader title="All Destinations" subtitle={`${data?.total ?? 0} total`} />
        <DataTable columns={columns} rows={destinations} keyExtractor={(destination) => destination.id} emptyMessage="No outbound destinations found" />
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </Card>
    </PageShell>
  )
}
