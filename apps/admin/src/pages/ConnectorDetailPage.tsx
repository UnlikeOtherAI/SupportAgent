import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { connectorsApi, type Connector, type ConnectorCapability } from '@/api/connectors'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'

function getStatusClasses(status: Connector['status']) {
  if (status === 'healthy') return 'text-accent-600 bg-accent-50'
  if (status === 'degraded') return 'text-signal-amber-500 bg-signal-amber-50'
  return 'text-gray-500 bg-gray-100'
}

function renderValues(values: string[]) {
  if (values.length === 0) return <span className="text-sm text-gray-400">None configured</span>
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span key={value} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{value}</span>
      ))}
    </div>
  )
}

export default function ConnectorDetailPage() {
  const { id: rawId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['connector', rawId],
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- enabled: !!rawId guards this
    queryFn: () => connectorsApi.get(rawId!),
    enabled: !!rawId,
  })

  // Always call useMutation unconditionally — before any conditionals
  const discoverMutation = useMutation({
    mutationFn: async () => {
      if (!rawId) throw new Error('No connector ID')
      return connectorsApi.discoverCapabilities(rawId)
    },
    onSuccess: () => {
      if (!rawId) return
      void queryClient.invalidateQueries({ queryKey: ['connector', rawId] })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!rawId) throw new Error('No connector ID')
      return connectorsApi.delete(rawId)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connectors'] })
      void navigate('/connectors')
    },
  })

  if (isLoading) {
    return <PageShell title="Connector"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!data) {
    return <PageShell title="Connector"><p className="text-sm text-gray-400">Not found</p></PageShell>
  }

  const id = rawId ?? data.id
  const capabilities: ConnectorCapability[] = discoverMutation.data?.capabilities ?? data.capabilities

  return (
    <PageShell
      title={data.name}
      action={
        <div className="flex gap-2">
          <Link to={`/connectors/${id}/edit`}><Button>Edit</Button></Link>
          <Link to={`/connectors/${id}/triggers`}><Button>Triggers</Button></Link>
          <Button
            variant="danger"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (window.confirm(`Delete connector "${data.name}"?`)) deleteMutation.mutate()
            }}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      }
    >
      <Link to="/connectors" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Connectors</Link>
      <Card className="divide-y divide-gray-100">
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-[180px_1fr]"><dt className="text-xs font-medium text-gray-500">Platform Type</dt><dd className="text-sm text-gray-800">{data.platformType.displayName}</dd></div>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-[180px_1fr]"><dt className="text-xs font-medium text-gray-500">Intake Mode</dt><dd className="font-mono text-xs text-gray-500">{data.intakeMode}</dd></div>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-[180px_1fr]"><dt className="text-xs font-medium text-gray-500">Roles</dt><dd className="flex flex-wrap gap-2">{data.roles.map((role) => <span key={role} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{role}</span>)}</dd></div>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-[180px_1fr]"><dt className="text-xs font-medium text-gray-500">Status</dt><dd><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getStatusClasses(data.status)}`}>{data.status}</span></dd></div>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-[180px_1fr]"><dt className="text-xs font-medium text-gray-500">Credentials</dt><dd className="font-mono text-xs text-gray-500">{data.credentials.masked}</dd></div>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-[180px_1fr]"><dt className="text-xs font-medium text-gray-500">Created</dt><dd className="font-mono text-xs text-gray-500">{data.createdAt}</dd></div>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Capabilities"
          action={
            <Button variant="secondary" disabled={discoverMutation.isPending} onClick={() => { discoverMutation.mutate(); }}>
              {discoverMutation.isPending ? 'Discovering...' : 'Discover Capabilities'}
            </Button>
          }
        />
        {capabilities.length === 0 ? (
          <div className="px-5 py-5 text-sm text-gray-400">No capabilities discovered yet.</div>
        ) : (
          <div className="grid gap-3 px-5 py-5 md:grid-cols-2">
            {capabilities.map((capability) => (
              <div key={capability.key} className="rounded-[var(--radius-sm)] border border-gray-100 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-900">{capability.key}</span>
                  <span className={capability.supported ? 'text-accent-600' : 'text-signal-red-500'}>{capability.supported ? '✓' : '✕'}</span>
                </div>
                <p className="mt-2 font-mono text-xs text-gray-500">{capability.detectedAt ?? 'not detected'}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="Taxonomy" />
        <div className="space-y-5 px-5 py-5">
          <div><p className="mb-2 text-xs font-medium text-gray-500">Labels</p>{renderValues(data.taxonomy.labels)}</div>
          <div><p className="mb-2 text-xs font-medium text-gray-500">Projects</p>{renderValues(data.taxonomy.projects)}</div>
          <div><p className="mb-2 text-xs font-medium text-gray-500">Boards</p>{renderValues(data.taxonomy.boards)}</div>
        </div>
      </Card>
    </PageShell>
  )
}
