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

export default function RoutingRuleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['routing-rule', id],
    queryFn: async () => {
      if (!id) throw new Error('Missing routing rule id')
      return routingApi.getRule(id)
    },
    enabled: !!id,
  })
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Missing routing rule id')
      return routingApi.deleteRule(id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['routing-rules'] })
      void navigate('/routing')
    },
  })

  if (isLoading) {
    return <PageShell title="Routing Rule"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!data) {
    return <PageShell title="Routing Rule"><p className="text-sm text-gray-400">Not found</p></PageShell>
  }

  return (
    <PageShell
      title="Routing Rule"
      action={
        <>
          <Link to={`/routing/rules/${data.id}/edit`}><Button>Edit</Button></Link>
          <Button variant="danger" onClick={() => { deleteMutation.mutate() }} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </>
      }
    >
      <Link to="/routing" className="mb-2 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Routing Rules</Link>
      <p className="mb-4 text-sm text-gray-500">Priority {data.priority}</p>
      <Card className="divide-y divide-gray-100">
        <DetailRow label="Priority" value={<span className="font-mono font-semibold text-gray-900">{data.priority}</span>} />
        <DetailRow label="Connector Condition" value={data.connectorCondition ?? 'Any'} />
        <DetailRow label="Workflow Type Condition" value={data.workflowTypeCondition ?? 'Any'} />
        <DetailRow label="Scenario Condition" value={data.scenarioCondition ?? 'Any'} />
        <DetailRow
          label="Destination"
          value={
            <div className="flex flex-col gap-1">
              <span className="font-medium text-gray-900">{data.destinationName}</span>
              <span className="font-mono text-xs text-gray-500">{data.destinationId}</span>
            </div>
          }
        />
        <DetailRow
          label="Enabled"
          value={
            <span className="inline-flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${data.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`} aria-hidden="true" />
              <span>{data.enabled ? 'Active' : 'Disabled'}</span>
            </span>
          }
        />
      </Card>
    </PageShell>
  )
}
