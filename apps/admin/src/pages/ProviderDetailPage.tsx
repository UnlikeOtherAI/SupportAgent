import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { providersApi, type ExecutionProvider, type ExecutionProviderHost } from '@/api/providers'
import { ProvidersIcon } from '@/components/icons/NavIcons'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageShell } from '@/components/ui/PageShell'

function renderProviderStatus(status: ExecutionProvider['status']) {
  const styles = {
    online: 'bg-accent-500',
    offline: 'bg-signal-red-500',
    unknown: 'bg-gray-400',
  } as const

  return (
    <span className="inline-flex items-center gap-2 text-sm text-gray-800">
      <span className={`h-2 w-2 rounded-full ${styles[status]}`} />
      <span className="capitalize">{status}</span>
    </span>
  )
}

function renderHostStatus(status: ExecutionProviderHost['connectionStatus']) {
  const dot = status === 'connected' ? 'bg-accent-500' : 'bg-signal-red-500'
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-gray-700">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="capitalize">{status}</span>
    </span>
  )
}

const hostColumns: Column<ExecutionProviderHost>[] = [
  { key: 'hostname', header: 'Hostname', render: (host) => <span className="font-mono text-xs text-gray-700">{host.hostname}</span> },
  { key: 'connectionStatus', header: 'Connection Status', render: (host) => renderHostStatus(host.connectionStatus) },
  { key: 'lastSeen', header: 'Last Seen', render: (host) => <span className="font-mono text-xs text-gray-500">{host.lastSeen}</span> },
]

export default function ProviderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: provider, isLoading } = useQuery({
    queryKey: ['provider', id],
    queryFn: async () => {
      if (!id) throw new Error('Provider id is required')
      return providersApi.get(id)
    },
    enabled: !!id,
  })
  const hostsQuery = useQuery({
    queryKey: ['provider-hosts', id],
    queryFn: async () => {
      if (!id) throw new Error('Provider id is required')
      return providersApi.getHosts(id)
    },
    enabled: !!id,
  })
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Provider id is required')
      return providersApi.delete(id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] })
      void navigate('/providers')
    },
  })

  if (isLoading) {
    return <PageShell title="Execution Provider"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!provider) {
    return <PageShell title="Execution Provider"><p className="text-sm text-gray-400">Not found</p></PageShell>
  }

  const hosts = hostsQuery.data?.hosts ?? []

  return (
    <PageShell
      title={provider.name}
      action={
        <div className="flex gap-2">
          <Link to={`/providers/${provider.id}/edit`}><Button>Edit</Button></Link>
          <Button
            variant="danger"
            onClick={() => {
              deleteMutation.mutate()
            }}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      }
    >
      <Link to="/providers" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Providers</Link>

      <Card className="divide-y divide-gray-100">
        <div className="px-5 py-4"><dt className="text-xs font-medium text-gray-500">Name</dt><dd className="mt-1 text-sm text-gray-800">{provider.name}</dd></div>
        <div className="px-5 py-4"><dt className="text-xs font-medium text-gray-500">Type</dt><dd className="mt-1 text-sm text-gray-800">{provider.type}</dd></div>
        <div className="px-5 py-4"><dt className="text-xs font-medium text-gray-500">Status</dt><dd className="mt-1">{renderProviderStatus(provider.status)}</dd></div>
        <div className="px-5 py-4"><dt className="text-xs font-medium text-gray-500">Host Count</dt><dd className="mt-1 text-sm text-gray-800">{provider.hostCount}</dd></div>
        <div className="px-5 py-4"><dt className="text-xs font-medium text-gray-500">Last Heartbeat</dt><dd className="mt-1 font-mono text-xs text-gray-500">{provider.lastHeartbeat ?? 'Never'}</dd></div>
        <div className="px-5 py-4"><dt className="text-xs font-medium text-gray-500">Created</dt><dd className="mt-1 font-mono text-xs text-gray-500">{provider.createdAt}</dd></div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Connected Hosts" subtitle={`${hosts.length} total`} />
        {hostsQuery.isLoading ? (
          <div className="px-5 py-6 text-sm text-gray-400">Loading hosts...</div>
        ) : hosts.length > 0 ? (
          <DataTable columns={hostColumns} rows={hosts} keyExtractor={(host) => host.id} />
        ) : (
          <EmptyState
            icon={<ProvidersIcon />}
            title="No connected hosts"
            description="This provider has not registered any execution hosts yet."
          />
        )}
      </Card>
    </PageShell>
  )
}
