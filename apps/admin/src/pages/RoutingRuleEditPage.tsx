import type { SyntheticEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { routingApi } from '@/api/routing'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'

function getTextValue(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

export default function RoutingRuleEditPage() {
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

  const mutation = useMutation({
    mutationFn: async (payload: Parameters<typeof routingApi.updateRule>[1]) => {
      if (!id) throw new Error('Missing routing rule id')
      return routingApi.updateRule(id, payload)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['routing-rules'] })
      void queryClient.invalidateQueries({ queryKey: ['routing-rule', id] })
      void navigate(`/routing/rules/${id}`)
    },
  })

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const connectorCondition = getTextValue(formData, 'connectorCondition').trim()
    const workflowTypeCondition = getTextValue(formData, 'workflowTypeCondition')
    const scenarioCondition = getTextValue(formData, 'scenarioCondition').trim()

    mutation.mutate({
      priority: Number(getTextValue(formData, 'priority') || '0'),
      connectorCondition: connectorCondition === '' ? null : connectorCondition,
      workflowTypeCondition: workflowTypeCondition === '' ? null : workflowTypeCondition,
      scenarioCondition: scenarioCondition === '' ? null : scenarioCondition,
      destinationId: getTextValue(formData, 'destinationId').trim(),
      enabled: formData.get('enabled') === 'on',
    })
  }

  if (isLoading) {
    return <PageShell title="Edit Routing Rule"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!data) {
    return <PageShell title="Edit Routing Rule"><p className="text-sm text-gray-400">Not found</p></PageShell>
  }

  return (
    <PageShell title="Edit Routing Rule">
      <Link to={`/routing/rules/${id}`} className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Routing Rule</Link>
      <Card>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-5 py-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-routing-rule-priority" className="mb-1.5 block text-xs font-medium text-gray-500">Priority</label>
                <input id="edit-routing-rule-priority" name="priority" type="number" min="0" required defaultValue={String(data.priority)} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" />
              </div>
              <div>
                <label htmlFor="edit-routing-rule-workflow-type" className="mb-1.5 block text-xs font-medium text-gray-500">Workflow Type Condition</label>
                <select id="edit-routing-rule-workflow-type" name="workflowTypeCondition" defaultValue={data.workflowTypeCondition ?? ''} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500">
                  <option value="">Any</option>
                  <option value="triage">triage</option>
                  <option value="build">build</option>
                  <option value="merge">merge</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="edit-routing-rule-connector-condition" className="mb-1.5 block text-xs font-medium text-gray-500">Connector Condition</label>
              <input id="edit-routing-rule-connector-condition" name="connectorCondition" defaultValue={data.connectorCondition ?? ''} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" />
            </div>
            <div>
              <label htmlFor="edit-routing-rule-scenario-condition" className="mb-1.5 block text-xs font-medium text-gray-500">Scenario Condition</label>
              <input id="edit-routing-rule-scenario-condition" name="scenarioCondition" defaultValue={data.scenarioCondition ?? ''} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" />
            </div>
            <div>
              <label htmlFor="edit-routing-rule-destination-id" className="mb-1.5 block text-xs font-medium text-gray-500">Destination ID</label>
              <input id="edit-routing-rule-destination-id" name="destinationId" required defaultValue={data.destinationId} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input name="enabled" type="checkbox" defaultChecked={data.enabled} className="h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500" />
              Enabled
            </label>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => { void navigate(`/routing/rules/${id}`) }}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving...' : 'Save Changes'}</Button>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
