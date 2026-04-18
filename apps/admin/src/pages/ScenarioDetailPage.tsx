import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { scenariosApi, type WorkflowTriggerAllowlist } from '@/api/scenarios'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'
import { TypePill } from '@/components/ui/TypePill'

const rowClassName = 'grid gap-1 px-5 py-4 md:grid-cols-[220px_1fr] md:items-center'
const labelClassName = 'text-xs font-medium text-gray-500'
const valueClassName = 'text-sm text-gray-800'
const inputClassName =
  'w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500'

export default function ScenarioDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [allowlistUsersCsv, setAllowlistUsersCsv] = useState('')
  const [allowlistTeamsCsv, setAllowlistTeamsCsv] = useState('')
  const [defaultPolicy, setDefaultPolicy] = useState<WorkflowTriggerAllowlist['defaultPolicy']>('allow')
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
  const triggerAllowlistMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Scenario id is required')
      return scenariosApi.update(id, {
        triggerAllowlist: {
          users: parseCsvList(allowlistUsersCsv),
          teams: parseCsvList(allowlistTeamsCsv),
          defaultPolicy,
        },
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['scenario', id] })
      await queryClient.invalidateQueries({ queryKey: ['scenarios'] })
    },
  })

  useEffect(() => {
    if (!data) return
    setAllowlistUsersCsv(data.triggerAllowlist?.users.join(', ') ?? '')
    setAllowlistTeamsCsv(data.triggerAllowlist?.teams.join(', ') ?? '')
    setDefaultPolicy(data.triggerAllowlist?.defaultPolicy ?? 'allow')
  }, [data])

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

      <Card className="mt-6">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Trigger allowlist</h2>
          <p className="mt-1 text-sm text-gray-500">
            Limit who can trigger this scenario from GitHub comments or events.
          </p>
        </div>
        <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <span className={labelClassName}>Default policy</span>
            <div className="mt-1.5 inline-flex rounded-[var(--radius-sm)] border border-gray-200 bg-gray-50 p-1">
              <button
                className={`rounded-[calc(var(--radius-sm)-2px)] px-3 py-1.5 text-xs font-medium transition ${
                  defaultPolicy === 'allow'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => {
                  setDefaultPolicy('allow')
                }}
                type="button"
              >
                Allow all
              </button>
              <button
                className={`rounded-[calc(var(--radius-sm)-2px)] px-3 py-1.5 text-xs font-medium transition ${
                  defaultPolicy === 'deny'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => {
                  setDefaultPolicy('deny')
                }}
                type="button"
              >
                Deny all unless listed
              </button>
            </div>
          </div>

          <div>
            <label className={labelClassName} htmlFor="trigger-allowlist-users">
              GitHub usernames CSV
            </label>
            <input
              className={inputClassName}
              id="trigger-allowlist-users"
              onChange={(event) => {
                setAllowlistUsersCsv(event.target.value)
              }}
              placeholder="rafiki270, ondrej-rafaj"
              value={allowlistUsersCsv}
            />
          </div>

          <div>
            <label className={labelClassName} htmlFor="trigger-allowlist-teams">
              GitHub team slugs CSV
            </label>
            <input
              className={inputClassName}
              id="trigger-allowlist-teams"
              onChange={(event) => {
                setAllowlistTeamsCsv(event.target.value)
              }}
              placeholder="@ourorg/maintainers, @ourorg/reviewers"
              value={allowlistTeamsCsv}
            />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 px-5 py-4">
          <p className="text-xs text-gray-500">
            Empty lists use the default policy. Team entries should use `@org/team-slug`.
          </p>
          <Button
            disabled={triggerAllowlistMutation.isPending}
            onClick={() => {
              triggerAllowlistMutation.mutate()
            }}
            variant="primary"
          >
            {triggerAllowlistMutation.isPending ? 'Saving...' : 'Save allowlist'}
          </Button>
        </div>
      </Card>
    </PageShell>
  )
}

function parseCsvList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index)
}
