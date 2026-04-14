import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { connectorsApi, type Connector } from '@/api/connectors'
import { PlusIcon } from '@/components/icons/NavIcons'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { Pagination } from '@/components/ui/Pagination'

function getStatusClasses(status: Connector['status']) {
  if (status === 'healthy') return 'text-accent-600 bg-accent-50'
  if (status === 'degraded') return 'text-signal-amber-500 bg-signal-amber-50'
  return 'text-gray-500 bg-gray-100'
}

const columns: Column<Connector>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (connector) => (
      <Link to={`/connectors/${connector.id}`} className="font-medium text-gray-900 hover:underline">
        {connector.name}
      </Link>
    ),
  },
  { key: 'platform', header: 'Platform', render: (connector) => connector.platformType.displayName },
  { key: 'roles', header: 'Roles', render: (connector) => connector.roles.join(', ') },
  {
    key: 'intakeMode',
    header: 'Intake Mode',
    render: (connector) => <span className="font-mono text-xs text-gray-500">{connector.intakeMode}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    render: (connector) => (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getStatusClasses(connector.status)}`}>
        {connector.status}
      </span>
    ),
  },
  {
    key: 'createdAt',
    header: 'Created',
    render: (connector) => <span className="font-mono text-xs text-gray-500">{connector.createdAt}</span>,
  },
]

export default function ConnectorsPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['connectors', page],
    queryFn: () => connectorsApi.list({ page }),
    placeholderData: keepPreviousData,
  })

  const connectors = data?.data ?? []
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / Math.max(data?.limit ?? 20, 1)))

  return (
    <PageShell
      title="Connectors"
      action={
        <Link to="/connectors/new">
          <Button variant="primary" icon={<PlusIcon />}>New Connector</Button>
        </Link>
      }
    >
      <Card>
        <CardHeader title="All Connectors" subtitle={`${data?.total ?? 0} total`} />
        <DataTable columns={columns} rows={connectors} keyExtractor={(connector) => connector.id} emptyMessage="No connectors found" isLoading={isLoading} />
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
