import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PlusIcon } from '@/components/icons/NavIcons'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { Pagination } from '@/components/ui/Pagination'
import { channelsApi, type CommunicationChannel } from '@/api/channels'

function getPairingStatusClass(status: CommunicationChannel['pairingStatus']) {
  if (status === 'paired') return 'bg-accent-50 text-accent-600'
  if (status === 'pending') return 'bg-signal-amber-50 text-signal-amber-500'
  return 'bg-signal-red-50 text-signal-red-500'
}

function formatLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const columns: Column<CommunicationChannel>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (channel) => (
      <Link to={`/channels/${channel.id}`} className="font-medium text-gray-900 hover:underline">
        {channel.name}
      </Link>
    ),
  },
  {
    key: 'platform',
    header: 'Platform',
    render: (channel) => formatLabel(channel.platform),
  },
  {
    key: 'pairingStatus',
    header: 'Pairing Status',
    render: (channel) => (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getPairingStatusClass(channel.pairingStatus)}`}>
        {formatLabel(channel.pairingStatus)}
      </span>
    ),
  },
  {
    key: 'workspace',
    header: 'Workspace',
    render: (channel) => channel.linkedWorkspace ?? '—',
  },
  {
    key: 'created',
    header: 'Created',
    render: (channel) => <span className="font-mono text-xs text-gray-500">{channel.createdAt}</span>,
  },
]

export default function ChannelsPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['channels', page],
    queryFn: () => channelsApi.list({ page }),
    placeholderData: keepPreviousData,
  })

  const channels = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / (data?.limit ?? 20))

  return (
    <PageShell
      title="Communication Channels"
      action={(
        <Link to="/channels/new">
          <Button variant="primary" icon={<PlusIcon />}>New Channel</Button>
        </Link>
      )}
    >
      <Card>
        <CardHeader title="All Channels" subtitle={`${total} total`} />
        <DataTable
          columns={columns}
          rows={channels}
          keyExtractor={(channel) => channel.id}
          emptyMessage="No channels found"
          isLoading={isLoading}
        />
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
