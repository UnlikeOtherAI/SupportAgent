import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { DownloadIcon } from '@/components/icons/NavIcons'
import { runsApi, type WorkflowRun } from '@/api/runs'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { FilterTabs } from '@/components/ui/FilterTabs'
import { relativeTime } from '@/lib/format'
import { PageShell } from '@/components/ui/PageShell'
import { Pagination } from '@/components/ui/Pagination'
import { TypePill } from '@/components/ui/TypePill'

type RunTypeFilter = 'all' | WorkflowRun['workflowType']
type RunStatusFilter = 'all' | 'running' | 'succeeded' | 'failed' | 'queued'

const typeTabs = [
  { label: 'All', value: 'all' },
  { label: 'Triage', value: 'triage' },
  { label: 'Build', value: 'build' },
  { label: 'Merge', value: 'merge' },
]

const statusTabs = [
  { label: 'All', value: 'all' },
  { label: 'Running', value: 'running' },
  { label: 'Succeeded', value: 'succeeded' },
  { label: 'Failed', value: 'failed' },
  { label: 'Queued', value: 'queued' },
]

const statusVariant: Record<WorkflowRun['status'], 'running' | 'succeeded' | 'failed' | 'queued'> = {
  queued: 'queued',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'failed',
}

const columns: Column<WorkflowRun>[] = [
  {
    key: 'id',
    header: 'Run ID',
    render: (run) => (
      <Link to={`/runs/${run.id}`} className="font-mono text-xs text-gray-700 hover:underline">
        {run.id}
      </Link>
    ),
  },
  { key: 'type', header: 'Type', render: (run) => <TypePill type={run.workflowType} /> },
  { key: 'status', header: 'Status', render: (run) => <Badge variant={statusVariant[run.status]}>{run.status}</Badge> },
  {
    key: 'connector',
    header: 'Connector',
    render: (run) => run.workItem?.title ?? '—',
  },
  {
    key: 'repository',
    header: 'Repository',
    render: (run) => {
      const ref = run.workItem?.repositoryRef ?? (run.repositoryMapping
        ? run.repositoryMapping.repositoryUrl.replace(/^https?:\/\/github\.com\//, '')
        : '—')
      return <span className="font-mono text-xs text-gray-500">{ref}</span>
    },
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

export default function RunsPage() {
  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState<RunTypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<RunStatusFilter>('all')
  const { data, isLoading } = useQuery({
    queryKey: ['runs', typeFilter, statusFilter, page],
    queryFn: () => runsApi.list({ page, type: typeFilter, status: statusFilter }),
    placeholderData: keepPreviousData,
  })

  const runs = data?.items ?? []
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 20))

  return (
    <PageShell
      title="Workflow Runs"
      action={<Button variant="secondary" icon={<DownloadIcon />}>Export</Button>}
    >
      <div className="mb-4 flex flex-wrap gap-3">
        <FilterTabs
          tabs={typeTabs}
          active={typeFilter}
          onChange={(value) => {
            setTypeFilter(value as RunTypeFilter)
            setPage(1)
          }}
        />
        <FilterTabs
          tabs={statusTabs}
          active={statusFilter}
          onChange={(value) => {
            setStatusFilter(value as RunStatusFilter)
            setPage(1)
          }}
        />
      </div>
      <Card>
        <DataTable columns={columns} rows={runs} keyExtractor={(run) => run.id} emptyMessage="No workflow runs found" isLoading={isLoading} />
        <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
          <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </Card>
    </PageShell>
  )
}
