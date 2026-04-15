import { useState, type SyntheticEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { connectorsApi } from '@/api/connectors'
import { reviewProfilesApi } from '@/api/review-profiles'
import { scenariosApi, type WorkflowScenario } from '@/api/scenarios'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect'
import { SearchableSelect } from '@/components/ui/SearchableSelect'

interface ScenarioDraftState {
  displayName?: string
  key?: string
  workflowType?: WorkflowScenario['workflowType']
  enabled?: boolean
  executionProfileId?: string
  orchestrationProfileId?: string
  reviewProfileId?: string
  allowedConnectors?: string[]
  notificationPolicy?: string
  distributionTarget?: string
}

const inputClassName =
  'w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500'
const labelClassName = 'mb-1.5 block text-xs font-medium text-gray-500'

export default function ScenarioEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<ScenarioDraftState>({})
  const { data, isLoading } = useQuery({
    queryKey: ['scenario', id],
    queryFn: async () => {
      if (!id) throw new Error('Scenario id is required')
      return scenariosApi.get(id)
    },
    enabled: !!id,
  })
  const { data: connectorsData } = useQuery({
    queryKey: ['connectors', 'scenario-form-options'],
    queryFn: () => connectorsApi.list({ limit: 100 }),
  })
  const { data: reviewProfilesData } = useQuery({
    queryKey: ['review-profiles', 'scenario-form-options'],
    queryFn: () => reviewProfilesApi.list(),
  })
  const mutation = useMutation({
    mutationFn: async (payload: Partial<WorkflowScenario>) => {
      if (!id) throw new Error('Scenario id is required')
      return scenariosApi.update(id, payload)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scenarios'] })
      void queryClient.invalidateQueries({ queryKey: ['scenario', id] })
      void navigate(`/scenarios/${id}`)
    },
  })

  if (isLoading) {
    return (
      <PageShell title="Edit Scenario">
        <p className="text-sm text-gray-400">Loading...</p>
      </PageShell>
    )
  }

  if (!data) {
    return (
      <PageShell title="Edit Scenario">
        <p className="text-sm text-gray-400">Not found</p>
      </PageShell>
    )
  }

  const updateField = <K extends keyof ScenarioDraftState>(field: K, value: ScenarioDraftState[K]) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const values = {
    displayName: draft.displayName ?? data.displayName,
    key: draft.key ?? data.key,
    workflowType: draft.workflowType ?? data.workflowType,
    enabled: draft.enabled ?? data.enabled,
    executionProfileId: draft.executionProfileId ?? data.executionProfileId ?? '',
    orchestrationProfileId: draft.orchestrationProfileId ?? data.orchestrationProfileId ?? '',
    reviewProfileId: draft.reviewProfileId ?? data.reviewProfileId ?? '',
    allowedConnectors: draft.allowedConnectors ?? data.allowedConnectors,
    notificationPolicy: draft.notificationPolicy ?? data.notificationPolicy ?? '',
    distributionTarget: draft.distributionTarget ?? data.distributionTarget ?? '',
  }

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    mutation.mutate({
      displayName: values.displayName.trim(),
      key: values.key.trim(),
      workflowType: values.workflowType,
      enabled: values.enabled,
      executionProfileId: values.executionProfileId.trim() || null,
      orchestrationProfileId: values.orchestrationProfileId.trim() || null,
      reviewProfileId: values.reviewProfileId.trim() || null,
      allowedConnectors: values.allowedConnectors,
      notificationPolicy: values.notificationPolicy.trim() || null,
      distributionTarget: values.distributionTarget.trim() || null,
    })
  }
  const connectorOptions = (connectorsData?.items ?? []).map((connector) => ({
    value: connector.id,
    label: connector.name,
    description: connector.platformType.displayName,
  }))
  const reviewProfileOptions = (reviewProfilesData?.items ?? []).map((profile) => ({
    value: profile.id,
    label: profile.name,
    description: `v${profile.version} - ${profile.allowedWorkflowTypes.join(', ')}`,
  }))

  return (
    <PageShell title={`Edit ${data.displayName}`}>
      <Link to={`/scenarios/${id}`} className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">
        &larr; Back to Scenario
      </Link>
      <Card>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
            <div>
              <label htmlFor="scenario-display-name" className={labelClassName}>Display Name</label>
              <input id="scenario-display-name" value={values.displayName} onChange={(event) => { updateField('displayName', event.target.value) }} className={inputClassName} required />
            </div>
            <div>
              <label htmlFor="scenario-key" className={labelClassName}>Key</label>
              <input id="scenario-key" value={values.key} onChange={(event) => { updateField('key', event.target.value) }} className={inputClassName} required />
              <p className="mt-1 text-xs text-gray-400">Unique identifier</p>
            </div>
            <div>
              <label htmlFor="scenario-workflow-type" className={labelClassName}>Workflow Type</label>
              <select id="scenario-workflow-type" value={values.workflowType} onChange={(event) => { updateField('workflowType', event.target.value as WorkflowScenario['workflowType']) }} className={inputClassName}>
                <option value="triage">triage</option>
                <option value="build">build</option>
                <option value="merge">merge</option>
              </select>
            </div>
            <div className="flex items-end">
              <label htmlFor="scenario-enabled" className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  id="scenario-enabled"
                  type="checkbox"
                  checked={values.enabled}
                  onChange={(event) => {
                    updateField('enabled', event.target.checked)
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500"
                />
                Enabled
              </label>
            </div>
            <div>
              <label htmlFor="scenario-execution-profile-id" className={labelClassName}>Execution Profile ID</label>
              <input id="scenario-execution-profile-id" value={values.executionProfileId} onChange={(event) => { updateField('executionProfileId', event.target.value) }} className={inputClassName} />
            </div>
            <div>
              <label htmlFor="scenario-orchestration-profile-id" className={labelClassName}>Orchestration Profile ID</label>
              <input id="scenario-orchestration-profile-id" value={values.orchestrationProfileId} onChange={(event) => { updateField('orchestrationProfileId', event.target.value) }} className={inputClassName} />
            </div>
            <SearchableSelect
              id="scenario-review-profile-id"
              label="Review Profile"
              value={values.reviewProfileId}
              onChange={(value) => { updateField('reviewProfileId', value) }}
              options={reviewProfileOptions}
              allowClear
              placeholder="Search review profiles..."
            />
            <SearchableMultiSelect
              id="scenario-allowed-connectors"
              label="Allowed Connectors"
              values={values.allowedConnectors}
              onChange={(nextValues) => { updateField('allowedConnectors', nextValues) }}
              options={connectorOptions}
              helperText="Leave empty to allow any connector."
            />
            <div>
              <label htmlFor="scenario-notification-policy" className={labelClassName}>Notification Policy</label>
              <input id="scenario-notification-policy" value={values.notificationPolicy} onChange={(event) => { updateField('notificationPolicy', event.target.value) }} className={inputClassName} />
            </div>
            <div>
              <label htmlFor="scenario-distribution-target" className={labelClassName}>Distribution Target</label>
              <input id="scenario-distribution-target" value={values.distributionTarget} onChange={(event) => { updateField('distributionTarget', event.target.value) }} className={inputClassName} />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => { void navigate(`/scenarios/${id}`) }}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
