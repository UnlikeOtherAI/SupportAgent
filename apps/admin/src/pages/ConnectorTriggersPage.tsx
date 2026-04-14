import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { connectorsApi, type TriggerPolicy } from '@/api/connectors'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'
import { TypePill } from '@/components/ui/TypePill'

const workflowTypes = ['triage', 'build', 'merge'] as const

function normalizePolicies(policies: TriggerPolicy[]) {
  return workflowTypes.map((workflowType) => (
    policies.find((policy) => policy.workflowType === workflowType) ?? {
      workflowType,
      events: [],
      labels: [],
      triggerIntent: null,
      autoPr: false,
    }
  ))
}

function splitCsv(value: string) {
  return value.split(',').map((part) => part.trim()).filter(Boolean)
}

export default function ConnectorTriggersPage() {
  const { id: rawId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['connector-trigger-policies', rawId],
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- enabled: !!rawId guards this
    queryFn: () => connectorsApi.getTriggerPolicies(rawId!),
    enabled: !!rawId,
  })

  const [policies, setPolicies] = useState(normalizePolicies([]))

  // Always call useMutation unconditionally — before any conditionals
  const mutation = useMutation({
    mutationFn: async () => {
      // Guard: id is only available when the connector was successfully loaded
      if (!rawId) throw new Error('No connector ID')
      return connectorsApi.updateTriggerPolicies(rawId, policies)
    },
    onSuccess: () => {
      if (!rawId) return
      void queryClient.invalidateQueries({ queryKey: ['connector-trigger-policies', rawId] })
      void queryClient.invalidateQueries({ queryKey: ['connector', rawId] })
      void navigate(`/connectors/${rawId}`)
    },
  })

  useEffect(() => {
    if (data) setPolicies(normalizePolicies(data.policies))
  }, [data])

  function updatePolicy(workflowType: TriggerPolicy['workflowType'], changes: Partial<TriggerPolicy>) {
    setPolicies((current) => current.map((policy) => (
      policy.workflowType === workflowType ? { ...policy, ...changes } : policy
    )))
  }

  if (isLoading) {
    return <PageShell title="Trigger Policies"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (isError || !data) {
    return <PageShell title="Trigger Policies"><p className="text-sm text-gray-400">Trigger policies not configured for this connector.</p></PageShell>
  }

  const id = rawId!

  return (
    <PageShell
      title="Trigger Policies"
      action={
        <Button variant="primary" disabled={mutation.isPending} onClick={() => { mutation.mutate(); }}>
          {mutation.isPending ? 'Saving...' : 'Save Changes'}
        </Button>
      }
    >
      <Link to={`/connectors/${id}`} className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Connector</Link>
      <div className="space-y-6">
        {policies.map((policy) => (
          <Card key={policy.workflowType}>
            <CardHeader title={`${policy.workflowType[0].toUpperCase()}${policy.workflowType.slice(1)} Triggers`} action={<TypePill type={policy.workflowType} />} />
            <div className="space-y-4 px-5 py-5">
              <div>
                <label htmlFor={`policy-${policy.workflowType}-events`} className="mb-1.5 block text-xs font-medium text-gray-500">Events</label>
                <input id={`policy-${policy.workflowType}-events`} value={policy.events.join(', ')} onChange={(event) => { updatePolicy(policy.workflowType, { events: splitCsv(event.target.value) }); }} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" />
              </div>
              <div>
                <label htmlFor={`policy-${policy.workflowType}-labels`} className="mb-1.5 block text-xs font-medium text-gray-500">Labels</label>
                <input id={`policy-${policy.workflowType}-labels`} value={policy.labels.join(', ')} onChange={(event) => { updatePolicy(policy.workflowType, { labels: splitCsv(event.target.value) }); }} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" />
              </div>
              <div>
                <label htmlFor={`policy-${policy.workflowType}-trigger-intent`} className="mb-1.5 block text-xs font-medium text-gray-500">Trigger Intent</label>
                <input id={`policy-${policy.workflowType}-trigger-intent`} value={policy.triggerIntent ?? ''} onChange={(event) => { updatePolicy(policy.workflowType, { triggerIntent: event.target.value || null }); }} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={policy.autoPr} onChange={(event) => { updatePolicy(policy.workflowType, { autoPr: event.target.checked }); }} className="h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500" />
                Auto PR
              </label>
            </div>
          </Card>
        ))}
      </div>
    </PageShell>
  )
}
