import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PlusIcon } from '@/components/icons/NavIcons'
import { providersApi, type ExecutionProvider } from '@/api/providers'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { Pagination } from '@/components/ui/Pagination'

function renderProviderStatus(status: ExecutionProvider['status']) {
  const styles = {
    online: 'bg-accent-500',
    offline: 'bg-signal-red-500',
    unknown: 'bg-gray-400',
  } as const

  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-gray-700">
      <span className={`h-2 w-2 rounded-full ${styles[status]}`} />
      <span className="capitalize">{status}</span>
    </span>
  )
}

const columns: Column<ExecutionProvider>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (provider) => (
      <Link to={`/providers/${provider.id}`} className="font-medium text-gray-900 hover:underline">
        {provider.name}
      </Link>
    ),
  },
  { key: 'type', header: 'Type', render: (provider) => provider.type },
  { key: 'status', header: 'Status', render: (provider) => renderProviderStatus(provider.status) },
  { key: 'hosts', header: 'Hosts', render: (provider) => provider.hostCount },
  {
    key: 'lastHeartbeat',
    header: 'Last Heartbeat',
    render: (provider) => (
      <span className="font-mono text-xs text-gray-500">{provider.lastHeartbeat ?? 'Never'}</span>
    ),
  },
  {
    key: 'createdAt',
    header: 'Created',
    render: (provider) => <span className="font-mono text-xs text-gray-500">{provider.createdAt}</span>,
  },
]

export default function ProvidersPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['providers', page],
    queryFn: () => providersApi.list({ page }),
    placeholderData: keepPreviousData,
  })

  const providers = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / (data?.limit ?? 20)))

  return (
    <PageShell
      title="Execution Providers"
      action={
        <Link to="/providers/new">
          <Button variant="primary" icon={<PlusIcon />}>New Provider</Button>
        </Link>
      }
    >
      <Card>
        <CardHeader title="All Providers" subtitle={`${total} total`} />
        <DataTable columns={columns} rows={providers} keyExtractor={(provider) => provider.id} emptyMessage="No providers found" isLoading={isLoading} />
        {totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        ) : null}
      </Card>
    </PageShell>
  )
}
