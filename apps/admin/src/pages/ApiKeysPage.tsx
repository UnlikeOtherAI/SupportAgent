import { useState } from 'react'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PlusIcon } from '@/components/icons/NavIcons'
import { providersApi, type RuntimeApiKey } from '@/api/providers'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { Pagination } from '@/components/ui/Pagination'

export default function ApiKeysPage() {
  const [page, setPage] = useState(1)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['api-keys', page],
    queryFn: () => providersApi.listApiKeys({ page }),
    placeholderData: keepPreviousData,
  })
  const revokeMutation = useMutation({
    mutationFn: (id: string) => providersApi.revokeApiKey(id),
    onSuccess: () => {
      setRevokingId(null)
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })

  const columns: Column<RuntimeApiKey>[] = [
    { key: 'label', header: 'Label', render: (key) => <span className="font-medium text-gray-900">{key.label}</span> },
    { key: 'allowedMode', header: 'Allowed Mode', render: (key) => <span className="font-mono text-xs text-gray-500">{key.allowedMode}</span> },
    { key: 'status', header: 'Status', render: (key) => <Badge variant={key.status === 'active' ? 'succeeded' : 'queued'}>{key.status}</Badge> },
    { key: 'createdAt', header: 'Created', render: (key) => <span className="font-mono text-xs text-gray-500">{key.createdAt}</span> },
    { key: 'lastUsed', header: 'Last Used', render: (key) => <span className="font-mono text-xs text-gray-500">{key.lastUsed ?? 'Never'}</span> },
    {
      key: 'actions',
      header: 'Actions',
      render: (key) => key.status === 'active' ? (
        <Button
          variant="ghost"
          className="text-signal-red-500 hover:bg-signal-red-50 hover:text-signal-red-500"
          onClick={() => {
            setRevokingId(key.id)
            revokeMutation.mutate(key.id)
          }}
          disabled={revokeMutation.isPending}
        >
          {revokeMutation.isPending && revokingId === key.id ? 'Revoking...' : 'Revoke'}
        </Button>
      ) : (
        <span className="text-xs text-gray-400">Revoked</span>
      ),
    },
  ]

  const apiKeys = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / (data?.limit ?? 20)))

  return (
    <PageShell
      title="Runtime API Keys"
      action={
        <Link to="/api-keys/new">
          <Button variant="primary" icon={<PlusIcon />}>New API Key</Button>
        </Link>
      }
    >
      <Card>
        <CardHeader title="All Runtime API Keys" subtitle={`${total} total`} />
        <DataTable columns={columns} rows={apiKeys} keyExtractor={(key) => key.id} emptyMessage="No API keys found" isLoading={isLoading} />
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
