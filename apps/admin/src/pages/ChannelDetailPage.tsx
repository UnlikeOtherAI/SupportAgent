import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { channelsApi, type CommunicationChannel } from '@/api/channels'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'

function getPairingStatusClass(status: CommunicationChannel['pairingStatus']) {
  if (status === 'paired') return 'bg-accent-50 text-accent-600'
  if (status === 'pending') return 'bg-signal-amber-50 text-signal-amber-500'
  return 'bg-signal-red-50 text-signal-red-500'
}

function formatLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function renderPills(values: string[], emptyLabel: string) {
  if (values.length === 0) {
    return <span className="text-sm text-gray-500">{emptyLabel}</span>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span key={value} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
          {value}
        </span>
      ))}
    </div>
  )
}

export default function ChannelDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['channel', id],
    queryFn: async () => {
      if (!id) throw new Error('Channel id is required')
      return channelsApi.get(id)
    },
    enabled: !!id,
  })
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Channel id is required')
      return channelsApi.delete(id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['channels'] })
      void navigate('/channels')
    },
  })

  if (isLoading) {
    return (
      <PageShell title="Channel">
        <p className="text-sm text-gray-400">Loading...</p>
      </PageShell>
    )
  }

  if (!data) {
    return (
      <PageShell title="Channel">
        <p className="text-sm text-gray-400">Not found</p>
      </PageShell>
    )
  }

  return (
    <PageShell
      title={data.name}
      action={(
        <>
          <Link to={`/channels/${data.id}/edit`}>
            <Button>Edit</Button>
          </Link>
          <Button
            variant="danger"
            disabled={deleteMutation.isPending}
            onClick={() => {
              deleteMutation.mutate()
            }}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </>
      )}
    >
      <Link to="/channels" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">
        &larr; Back to Channels
      </Link>
      <Card className="divide-y divide-gray-100">
        <div className="grid grid-cols-1 gap-4 px-5 py-5 md:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-gray-500">Platform</dt>
            <dd className="mt-1 text-sm text-gray-800">{formatLabel(data.platform)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Pairing Status</dt>
            <dd className="mt-1">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getPairingStatusClass(data.pairingStatus)}`}>
                {formatLabel(data.pairingStatus)}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Linked Workspace</dt>
            <dd className="mt-1 text-sm text-gray-800">{data.linkedWorkspace ?? 'None'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Linked Scope</dt>
            <dd className="mt-1 text-sm text-gray-800">{data.linkedScope ?? 'None'}</dd>
          </div>
        </div>
        <div className="px-5 py-5">
          <dt className="text-xs font-medium text-gray-500">Allowed Actions</dt>
          <dd className="mt-2">{renderPills(data.allowedActions, 'None configured')}</dd>
        </div>
        <div className="px-5 py-5">
          <dt className="text-xs font-medium text-gray-500">Notification Subscriptions</dt>
          <dd className="mt-2">{renderPills(data.notificationSubscriptions, 'None')}</dd>
        </div>
        <div className="px-5 py-5">
          <dt className="text-xs font-medium text-gray-500">Created</dt>
          <dd className="mt-1 font-mono text-xs text-gray-500">{data.createdAt}</dd>
        </div>
      </Card>
    </PageShell>
  )
}
