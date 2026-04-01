import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { scenariosApi } from '@/api/scenarios'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'
import { TypePill } from '@/components/ui/TypePill'

const rowClassName = 'grid gap-1 px-5 py-4 md:grid-cols-[220px_1fr] md:items-center'
const labelClassName = 'text-xs font-medium text-gray-500'
const valueClassName = 'text-sm text-gray-800'

export default function ScenarioDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['scenario', id],
    queryFn: async () => {
      if (!id) throw new Error('Scenario id is required')
      return scenariosApi.get(id)
    },
    enabled: !!id,
  })
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Scenario id is required')
      return scenariosApi.delete(id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scenarios'] })
      void navigate('/scenarios')
    },
  })

  if (isLoading) {
    return (
      <PageShell title="Scenario">
        <p className="text-sm text-gray-400">Loading...</p>
      </PageShell>
    )
  }

  if (!data) {
    return (
      <PageShell title="Scenario">
        <p className="text-sm text-gray-400">Not found</p>
      </PageShell>
    )
  }

  return (
    <PageShell
      title={data.displayName}
      action={
        <>
          <Link to={`/scenarios/${id}/edit`}>
            <Button>Edit</Button>
          </Link>
          <Button
            variant="danger"
            onClick={() => {
              deleteMutation.mutate()
            }}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </>
      }
    >
      <Link to="/scenarios" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">
        &larr; Back to Scenarios
      </Link>
      <Card className="divide-y divide-gray-100">
        <div className={rowClassName}>
          <dt className={labelClassName}>Key</dt>
          <dd className={`${valueClassName} font-mono text-xs text-gray-500`}>{data.key}</dd>
        </div>
        <div className={rowClassName}>
          <dt className={labelClassName}>Workflow Type</dt>
          <dd className={valueClassName}>
            <TypePill type={data.workflowType} />
          </dd>
        </div>
        <div className={rowClassName}>
          <dt className={labelClassName}>Enabled</dt>
          <dd className={`${valueClassName} inline-flex items-center gap-2`}>
            <span
              className={`h-2 w-2 rounded-full ${data.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
              aria-hidden="true"
            />
            <span>{data.enabled ? 'Active' : 'Disabled'}</span>
          </dd>
        </div>
        <div className={rowClassName}>
          <dt className={labelClassName}>Trigger Policy Count</dt>
          <dd className={valueClassName}>{data.triggerPolicyCount}</dd>
        </div>
        <div className={rowClassName}>
          <dt className={labelClassName}>Execution Profile ID</dt>
          <dd className={`${valueClassName} font-mono text-xs text-gray-500`}>
            {data.executionProfileId ?? 'Not set'}
          </dd>
        </div>
        <div className={rowClassName}>
          <dt className={labelClassName}>Orchestration Profile ID</dt>
          <dd className={`${valueClassName} font-mono text-xs text-gray-500`}>
            {data.orchestrationProfileId ?? 'Not set'}
          </dd>
        </div>
        <div className={rowClassName}>
          <dt className={labelClassName}>Review Profile ID</dt>
          <dd className={`${valueClassName} font-mono text-xs text-gray-500`}>
            {data.reviewProfileId ?? 'Not set'}
          </dd>
        </div>
        <div className={rowClassName}>
          <dt className={labelClassName}>Allowed Connectors</dt>
          <dd className={valueClassName}>
            {data.allowedConnectors.length > 0 ? data.allowedConnectors.join(', ') : 'All'}
          </dd>
        </div>
        <div className={rowClassName}>
          <dt className={labelClassName}>Notification Policy</dt>
          <dd className={valueClassName}>{data.notificationPolicy ?? 'None'}</dd>
        </div>
        <div className={rowClassName}>
          <dt className={labelClassName}>Distribution Target</dt>
          <dd className={valueClassName}>{data.distributionTarget ?? 'None'}</dd>
        </div>
      </Card>
    </PageShell>
  )
}
