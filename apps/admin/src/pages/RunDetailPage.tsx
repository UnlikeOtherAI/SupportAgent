import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { runsApi, type Finding, type LogEvent, type WorkflowRun } from '@/api/runs'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { TypePill } from '@/components/ui/TypePill'

const statusVariant: Record<WorkflowRun['status'], 'running' | 'succeeded' | 'failed' | 'queued'> = {
  queued: 'queued',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'failed',
}

const severityClasses: Record<Finding['severity'], string> = {
  critical: 'bg-signal-red-50 text-signal-red-500',
  high: 'bg-signal-red-50 text-signal-red-500',
  medium: 'bg-signal-amber-50 text-signal-amber-500',
  low: 'bg-gray-100 text-gray-500',
}

const levelClasses: Record<LogEvent['level'], string> = {
  info: 'text-signal-blue-500',
  warn: 'text-signal-amber-500',
  error: 'text-signal-red-500',
  debug: 'text-gray-500',
}

const findingColumns: Column<Finding>[] = [
  { key: 'title', header: 'Title', render: (finding) => <span className="font-medium text-gray-900">{finding.title}</span> },
  {
    key: 'severity',
    header: 'Severity',
    render: (finding) => (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${severityClasses[finding.severity]}`}>
        {finding.severity}
      </span>
    ),
  },
  {
    key: 'description',
    header: 'Description',
    className: 'max-w-[28rem] whitespace-normal',
    render: (finding) => <span className="text-gray-600">{truncate(finding.description, 80)}</span>,
  },
]

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`
}

function truncateRunId(id: string) {
  return id.length <= 18 ? id : `${id.slice(0, 8)}...${id.slice(-6)}`
}

function canCancel(status: WorkflowRun['status']) {
  return status === 'running' || status === 'queued'
}

export default function RunDetailPage() {
  const { id: rawId } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['run', rawId],
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- enabled: !!rawId guards this
    queryFn: () => runsApi.get(rawId!),
    enabled: !!rawId,
  })

  if (isLoading) {
    return (
      <PageShell title="Workflow Run">
        <p className="text-sm text-gray-400">Loading...</p>
      </PageShell>
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- enabled: !!rawId guards queryFn; id is always defined when mutation callbacks fire
  const id = rawId!

  if (!data) {
    return (
      <PageShell title="Workflow Run">
        <p className="text-sm text-gray-400">Not found</p>
      </PageShell>
    )
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks -- enabled: !!rawId guards data; id is defined before the if (!data) guard
  const cancelMutation = useMutation({
    mutationFn: () => runsApi.cancel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runs'] })
      void queryClient.invalidateQueries({ queryKey: ['run', id] })
    },
  })

  return (
    <PageShell
      title={truncateRunId(data.id)}
      action={
        <>
          <Link to="/runs">
            <Button variant="secondary">Back to Runs</Button>
          </Link>
          {canCancel(data.status) && (
            <Button variant="danger" onClick={() => { cancelMutation.mutate(); }} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? 'Cancelling...' : 'Cancel Run'}
            </Button>
          )}
        </>
      }
    >
      <Card className="mb-6">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 px-5 py-5">
          <DetailField label="Status" value={<Badge variant={statusVariant[data.status]}>{data.status}</Badge>} />
          <DetailField label="Type" value={<TypePill type={data.workflowType} />} />
          <DetailField label="Connector" value={data.connectorName} />
          <DetailField label="Repository" value={<span className="font-mono text-xs text-gray-500">{data.repositoryName}</span>} />
          <DetailField label="Started" value={<span className="font-mono text-xs text-gray-500">{data.startedAt}</span>} />
          <DetailField label="Duration" value={<span className="font-mono text-xs text-gray-500">{data.duration ?? '—'}</span>} />
          <DetailField label="Work Item ID" value={<span className="font-mono text-xs text-gray-500">{data.workItemId ?? '—'}</span>} />
        </dl>
      </Card>

      {data.findings.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Findings" subtitle={`${data.findings.length} total`} />
          <DataTable columns={findingColumns} rows={data.findings} keyExtractor={(finding) => finding.id} emptyMessage="No findings" />
        </Card>
      )}

      <Card>
        <CardHeader title="Execution Logs" />
        <div className="p-5">
          <div className="max-h-96 overflow-y-auto rounded-[var(--radius-md)] bg-gray-950 p-4">
            {data.logs.length === 0 ? (
              <p className="text-sm text-gray-500">No logs recorded.</p>
            ) : (
              <div className="space-y-2">
                {data.logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3">
                    <span className="shrink-0 font-mono text-[11px] text-gray-500">{log.timestamp}</span>
                    <span className={`shrink-0 text-[11px] font-semibold uppercase ${levelClasses[log.level]}`}>{log.level}</span>
                    <span className="text-[13px] text-gray-300">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>
    </PageShell>
  )
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-800">{value}</dd>
    </div>
  )
}
