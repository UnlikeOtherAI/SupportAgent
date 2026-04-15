import { useState, type SyntheticEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { connectorsApi } from '@/api/connectors'
import { reviewProfilesApi } from '@/api/review-profiles'
import { scenariosApi, type WorkflowScenario } from '@/api/scenarios'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect'
import { SearchableSelect } from '@/components/ui/SearchableSelect'

interface ScenarioFormState {
  displayName: string
  key: string
  workflowType: WorkflowScenario['workflowType']
  enabled: boolean
  executionProfileId: string
  orchestrationProfileId: string
  reviewProfileId: string
  allowedConnectors: string[]
  notificationPolicy: string
  distributionTarget: string
}

const inputClassName =
  'w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500'
const labelClassName = 'mb-1.5 block text-xs font-medium text-gray-500'

export default function ScenarioNewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ScenarioFormState>({
    displayName: '',
    key: '',
    workflowType: 'triage',
    enabled: true,
    executionProfileId: '',
    orchestrationProfileId: '',
    reviewProfileId: '',
    allowedConnectors: [],
    notificationPolicy: '',
    distributionTarget: '',
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
    mutationFn: (data: Partial<WorkflowScenario>) => scenariosApi.create(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scenarios'] })
      void navigate('/scenarios')
    },
  })

  const updateField = <K extends keyof ScenarioFormState>(field: K, value: ScenarioFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    mutation.mutate({
      displayName: form.displayName.trim(),
      key: form.key.trim(),
      workflowType: form.workflowType,
      enabled: form.enabled,
      executionProfileId: form.executionProfileId.trim() || null,
      orchestrationProfileId: form.orchestrationProfileId.trim() || null,
      reviewProfileId: form.reviewProfileId.trim() || null,
      allowedConnectors: form.allowedConnectors,
      notificationPolicy: form.notificationPolicy.trim() || null,
      distributionTarget: form.distributionTarget.trim() || null,
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
    <PageShell title="New Scenario">
      <Link to="/scenarios" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">
        &larr; Back to Scenarios
      </Link>
      <Card>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
            <div>
              <label htmlFor="scenario-display-name" className={labelClassName}>Display Name</label>
              <input id="scenario-display-name" value={form.displayName} onChange={(event) => { updateField('displayName', event.target.value) }} className={inputClassName} required />
            </div>
            <div>
              <label htmlFor="scenario-key" className={labelClassName}>Key</label>
              <input id="scenario-key" value={form.key} onChange={(event) => { updateField('key', event.target.value) }} className={inputClassName} required />
              <p className="mt-1 text-xs text-gray-400">Unique identifier</p>
            </div>
            <div>
              <label htmlFor="scenario-workflow-type" className={labelClassName}>Workflow Type</label>
              <select id="scenario-workflow-type" value={form.workflowType} onChange={(event) => { updateField('workflowType', event.target.value as WorkflowScenario['workflowType']) }} className={inputClassName}>
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
                  checked={form.enabled}
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
              <input id="scenario-execution-profile-id" value={form.executionProfileId} onChange={(event) => { updateField('executionProfileId', event.target.value) }} className={inputClassName} />
            </div>
            <div>
              <label htmlFor="scenario-orchestration-profile-id" className={labelClassName}>Orchestration Profile ID</label>
              <input id="scenario-orchestration-profile-id" value={form.orchestrationProfileId} onChange={(event) => { updateField('orchestrationProfileId', event.target.value) }} className={inputClassName} />
            </div>
            <SearchableSelect
              id="scenario-review-profile-id"
              label="Review Profile"
              value={form.reviewProfileId}
              onChange={(value) => { updateField('reviewProfileId', value) }}
              options={reviewProfileOptions}
              allowClear
              placeholder="Search review profiles..."
            />
            <SearchableMultiSelect
              id="scenario-allowed-connectors"
              label="Allowed Connectors"
              values={form.allowedConnectors}
              onChange={(values) => { updateField('allowedConnectors', values) }}
              options={connectorOptions}
              helperText="Leave empty to allow any connector."
            />
            <div>
              <label htmlFor="scenario-notification-policy" className={labelClassName}>Notification Policy</label>
              <input id="scenario-notification-policy" value={form.notificationPolicy} onChange={(event) => { updateField('notificationPolicy', event.target.value) }} className={inputClassName} />
            </div>
            <div>
              <label htmlFor="scenario-distribution-target" className={labelClassName}>Distribution Target</label>
              <input id="scenario-distribution-target" value={form.distributionTarget} onChange={(event) => { updateField('distributionTarget', event.target.value) }} className={inputClassName} />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => { void navigate('/scenarios') }}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating...' : 'Create Scenario'}
            </Button>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
