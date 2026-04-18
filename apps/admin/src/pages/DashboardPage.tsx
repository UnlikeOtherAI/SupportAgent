import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ActivityIcon,
  AlertCircleIcon,
  ConnectorsIcon,
  DownloadIcon,
  PlusIcon,
  RefreshIcon,
  XCircleIcon,
} from '@/components/icons/NavIcons'
import { runsApi, type WorkflowRun } from '@/api/runs'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { FilterTabs } from '@/components/ui/FilterTabs'
import { PageShell } from '@/components/ui/PageShell'
import { Pagination } from '@/components/ui/Pagination'
import { StatCard } from '@/components/ui/StatCard'
import { Badge } from '@/components/ui/Badge'
import { TypePill } from '@/components/ui/TypePill'
import { relativeTime } from '@/lib/format'

type TypeFilter = 'all' | WorkflowRun['workflowType']

const typeTabs = [
  { label: 'All', value: 'all' },
  { label: 'Triage', value: 'triage' },
  { label: 'Build', value: 'build' },
  { label: 'Merge', value: 'merge' },
] satisfies { label: string; value: TypeFilter }[]

const badgeVariant: Record<WorkflowRun['status'], 'running' | 'succeeded' | 'failed' | 'queued'> = {
  queued: 'queued',
  blocked: 'queued',
  dispatched: 'running',
  running: 'running',
  cancel_requested: 'failed',
  awaiting_review: 'running',
  awaiting_human: 'queued',
  succeeded: 'succeeded',
  failed: 'failed',
  canceled: 'failed',
  lost: 'failed',
}

function formatStatus(status: WorkflowRun['status']) {
  const normalized = status.replace(/_/g, ' ')
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

const columns: Column<WorkflowRun>[] = [
  {
    key: 'id',
    header: 'Run ID',
    render: (run) => <Link to={`/runs/${run.id}`} className="font-mono text-xs text-gray-900 hover:underline">{run.id.slice(0, 10)}</Link>,
  },
  {
    key: 'type',
    header: 'Type',
    render: (run) => <TypePill type={run.workflowType} />,
  },
  {
    key: 'status',
    header: 'Status',
    render: (run) => <Badge variant={badgeVariant[run.status]}>{formatStatus(run.status)}</Badge>,
  },
  {
    key: 'connector',
    header: 'Connector',
    render: (run) => <span>{run.connectorName}</span>,
  },
  {
    key: 'repository',
    header: 'Repository',
    render: (run) => <span className="font-mono text-xs text-gray-500">{run.repositoryName}</span>,
  },
  {
    key: 'started',
    header: 'Started',
    render: (run) => <span className="text-xs text-gray-500" title={run.startedAt ?? ''}>{relativeTime(run.startedAt)}</span>,
  },
  {
    key: 'duration',
    header: 'Duration',
    render: (run) => <span className="font-mono text-xs text-gray-500">{run.duration ?? '—'}</span>,
  },
]

export default function DashboardPage() {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [page, setPage] = useState(1)
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['dashboard-runs', typeFilter, page],
    queryFn: () => runsApi.list({ page, limit: 8, type: typeFilter }),
  })

  const runs = data?.data ?? []
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit ?? 8)))
  const activeRuns = runs.filter((run) => run.status === 'running').length
  const failedRuns = runs.filter((run) => run.status === 'failed').length

  return (
    <PageShell
      title="Dashboard"
      action={
        <>
          <Button type="button" variant="secondary" icon={<DownloadIcon />}>
            Export
          </Button>
          <Button type="button" variant="primary" icon={<PlusIcon />}>
            New Run
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Active Runs"
          value={isLoading ? '—' : activeRuns}
          icon={<ActivityIcon />}
          iconColor="teal"
          delta={{ value: '+3', direction: 'up' }}
          deltaLabel="vs last hour"
        />
        <StatCard
          label="Connectors"
          value={8}
          icon={<ConnectorsIcon />}
          iconColor="blue"
          delta={{ value: '+1', direction: 'up' }}
          deltaLabel="this week"
        />
        <StatCard
          label="Findings"
          value={47}
          icon={<AlertCircleIcon />}
          iconColor="amber"
          delta={{ value: '-5', direction: 'down' }}
          deltaLabel="vs last week"
        />
        <StatCard
          label="Failed Runs"
          value={isLoading ? '—' : failedRuns}
          icon={<XCircleIcon />}
          iconColor="red"
          delta={{ value: '-1', direction: 'down' }}
          deltaLabel="vs yesterday"
        />
      </div>

      <Card>
        <CardHeader
          title="Recent Runs"
          subtitle="Last 24 hours"
          action={
            <div className="flex items-center gap-2">
              <FilterTabs
                tabs={typeTabs}
                active={typeFilter}
                onChange={(value) => {
                  setTypeFilter(value as TypeFilter)
                  setPage(1)
                }}
              />
              <Button
                type="button"
                variant="secondary"
                icon={<RefreshIcon />}
                onClick={() => void refetch()}
                disabled={isFetching}
              >
                Refresh
              </Button>
            </div>
          }
        />
        <DataTable
          columns={columns}
          rows={runs}
          keyExtractor={(run) => run.id}
          emptyMessage={isLoading ? 'Loading recent runs...' : 'No runs found'}
        />
        <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
          <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          )}
        </div>
      </Card>
    </PageShell>
  )
}
