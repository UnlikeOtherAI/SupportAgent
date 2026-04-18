import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { runsApi, type Finding, type LogEvent, type RunCheckpoint, type WorkflowRun } from '@/api/runs'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { TypePill } from '@/components/ui/TypePill'

const statusVariant: Record<
  WorkflowRun['status'],
  'running' | 'succeeded' | 'failed' | 'queued'
> = {
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

const severityClasses: Record<Finding['severity'], string> = {
  critical: 'bg-signal-red-50 text-signal-red-500',
  high: 'bg-signal-red-50 text-signal-red-500',
  medium: 'bg-signal-amber-50 text-signal-amber-500',
  low: 'bg-gray-100 text-gray-500',
}

const levelClasses: Record<LogEvent['streamType'], string> = {
  stdout: 'text-gray-300',
  stderr: 'text-signal-red-500',
  progress: 'text-signal-blue-500',
}

const stopEligibleStatuses: WorkflowRun['status'][] = ['running', 'dispatched', 'queued']
const pollingStatuses: WorkflowRun['status'][] = ['queued', 'dispatched', 'running', 'cancel_requested']

const findingColumns: Column<Finding>[] = [
  {
    key: 'title',
    header: 'Title',
    render: (finding) => <span className="font-medium text-gray-900">{finding.title}</span>,
  },
  {
    key: 'severity',
    header: 'Severity',
    render: (finding) => (
      <span
        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${severityClasses[finding.severity]}`}
      >
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

interface IterationStageView {
  checkpointId: string
  stageId: string
  status: 'completed'
  completedAt: string
  durationLabel: string
}

interface IterationTimelineView {
  iteration: number
  done: boolean
  summary: string
  timestamp: string
  stages: IterationStageView[]
}

export default function RunDetailPage() {
  const { id: rawId } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [stopArmed, setStopArmed] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['run', rawId],
    queryFn: async () => {
      if (!rawId) throw new Error('No run ID')
      return runsApi.get(rawId)
    },
    enabled: !!rawId,
    refetchInterval: (query) => {
      const run = query.state.data
      return run && pollingStatuses.includes(run.status) ? 5000 : false
    },
  })
  const checkpointsQuery = useQuery({
    queryKey: ['run', rawId, 'checkpoints'],
    queryFn: async () => {
      if (!rawId) throw new Error('No run ID')
      return runsApi.getCheckpoints(rawId)
    },
    enabled: !!rawId,
    refetchInterval: data && pollingStatuses.includes(data.status) ? 5000 : false,
  })

  useEffect(() => {
    if (data?.status !== 'cancel_requested') {
      setStopArmed(false)
    }
  }, [data?.status])

  const cancelMutation = useMutation({
    mutationFn: async (force: boolean) => {
      if (!rawId) throw new Error('No run ID')
      return runsApi.cancel(rawId, force)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['runs'] })
      await queryClient.invalidateQueries({ queryKey: ['run', rawId] })
      await queryClient.invalidateQueries({ queryKey: ['run', rawId, 'checkpoints'] })
    },
  })

  const timeline = useMemo(
    () => buildIterationTimeline(checkpointsQuery.data ?? [], data?.startedAt ?? null),
    [checkpointsQuery.data, data?.startedAt],
  )

  if (isLoading) {
    return (
      <PageShell title="Workflow Run">
        <p className="text-sm text-gray-400">Loading...</p>
      </PageShell>
    )
  }

  if (!data) {
    return (
      <PageShell title="Workflow Run">
        <p className="text-sm text-gray-400">Not found</p>
      </PageShell>
    )
  }

  const repositoryValue =
    data.workItem?.repositoryRef ??
    (data.repositoryMapping
      ? data.repositoryMapping.repositoryUrl.replace(/^https?:\/\/github\.com\//, '')
      : '—')
  const stopEnabled = stopEligibleStatuses.includes(data.status)
  const stopPending = cancelMutation.isPending
  const forceStopEnabled = isForceStopEnabled(data)
  const forceStopRequested = !!data.cancelForceRequestedAt

  return (
    <PageShell
      title={truncateRunId(data.id)}
      action={
        <>
          <Link to="/runs">
            <Button variant="secondary">Back to Runs</Button>
          </Link>
          {data.status !== 'cancel_requested' && (
            <Button
              disabled={!stopEnabled || stopPending}
              onClick={() => {
                if (!stopArmed) {
                  setStopArmed(true)
                  return
                }
                cancelMutation.mutate(false)
              }}
              variant="danger"
            >
              {stopPending ? 'Stopping...' : stopArmed ? 'Confirm stop' : 'Stop'}
            </Button>
          )}
          {data.status === 'cancel_requested' && (
            <Button
              disabled={!forceStopEnabled || stopPending}
              onClick={() => {
                cancelMutation.mutate(true)
              }}
              variant="secondary"
            >
              {stopPending
                ? 'Requesting force stop...'
                : forceStopRequested
                  ? 'Force stop requested'
                  : 'Force stop'}
            </Button>
          )}
        </>
      }
    >
      {stopArmed && data.status !== 'cancel_requested' && (
        <p className="mb-4 rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Stopping is two-phase. Click again to set `cancel_requested`; in-flight work can finish
          the current checkpoint before the worker exits.
        </p>
      )}

      {data.status === 'cancel_requested' && (
        <p className="mb-4 rounded-[var(--radius-md)] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Stop requested. The worker should halt at the next checkpoint. Force stop becomes
          available 30 seconds after the cancel request and only stamps a force-cancel marker for
          the worker to poll.
        </p>
      )}

      <Card className="mb-6">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 px-5 py-5">
          <DetailField label="Status" value={<Badge variant={statusVariant[data.status]}>{data.status}</Badge>} />
          <DetailField label="Type" value={<TypePill type={data.workflowType} />} />
          <DetailField label="Source item" value={data.workItem?.title ?? '—'} />
          <DetailField label="Repository" value={<span className="font-mono text-xs text-gray-500">{repositoryValue}</span>} />
          <DetailField label="Started" value={<span className="font-mono text-xs text-gray-500">{formatTimestamp(data.startedAt)}</span>} />
          <DetailField label="Duration" value={<span className="font-mono text-xs text-gray-500">{data.duration ?? '—'}</span>} />
          <DetailField label="Current stage" value={<span className="font-mono text-xs text-gray-500">{data.currentStage ?? '—'}</span>} />
          <DetailField label="Work Item ID" value={<span className="font-mono text-xs text-gray-500">{data.workItemId ?? '—'}</span>} />
        </dl>
      </Card>

      <Card className="mb-6">
        <CardHeader
          title="Loop Convergence"
          subtitle={timeline.length > 0 ? `${timeline.length} iteration${timeline.length === 1 ? '' : 's'}` : undefined}
        />
        <div className="px-5 py-5">
          {timeline.length === 0 ? (
            <p className="text-sm text-gray-500">No dispatch checkpoints recorded for this run yet.</p>
          ) : (
            <ol className="space-y-6">
              {timeline.map((iteration, index) => (
                <li className="relative pl-8" key={`iteration-${iteration.iteration}`}>
                  {index < timeline.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute left-[11px] top-7 h-[calc(100%+20px)] w-px bg-gray-200"
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                      iteration.done
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {iteration.done ? '✓' : '⏳'}
                  </span>
                  <div className="rounded-[var(--radius-md)] border border-gray-100 bg-gray-50 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">
                          Iteration {iteration.iteration}
                        </h3>
                        <p className="mt-1 text-sm text-gray-600">{iteration.summary}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-medium uppercase tracking-[0.08em] text-gray-400">
                          Loop done
                        </p>
                        <p className="mt-1 text-sm font-medium text-gray-700">
                          {iteration.done ? 'Yes' : 'No'}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-gray-400">
                          {formatTimestamp(iteration.timestamp)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      {iteration.stages.map((stage) => (
                        <div
                          className="grid gap-2 rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-3 md:grid-cols-[minmax(0,1fr)_120px_100px_160px]"
                          key={stage.checkpointId}
                        >
                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.08em] text-gray-400">
                              Stage
                            </p>
                            <p className="mt-1 font-mono text-xs text-gray-700">{stage.stageId}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.08em] text-gray-400">
                              Status
                            </p>
                            <p className="mt-1 text-sm text-gray-700">{stage.status}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.08em] text-gray-400">
                              Duration
                            </p>
                            <p className="mt-1 text-sm text-gray-700">{stage.durationLabel}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.08em] text-gray-400">
                              Completed
                            </p>
                            <p className="mt-1 font-mono text-[11px] text-gray-500">
                              {formatTimestamp(stage.completedAt)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>

      {data.findings.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Findings" subtitle={`${data.findings.length} total`} />
          <DataTable
            columns={findingColumns}
            rows={data.findings}
            keyExtractor={(finding) => finding.id}
            emptyMessage="No findings"
          />
        </Card>
      )}

      <Card>
        <CardHeader title="Execution Logs" />
        <div className="p-5">
          <div className="max-h-96 overflow-y-auto rounded-[var(--radius-md)] bg-gray-950 p-4">
            {data.logEvents.length === 0 ? (
              <p className="text-sm text-gray-500">No logs recorded.</p>
            ) : (
              <div className="space-y-2">
                {data.logEvents.map((log) => (
                  <div className="flex items-start gap-3" key={log.id}>
                    <span className="shrink-0 font-mono text-[11px] text-gray-500">
                      {log.timestamp}
                    </span>
                    <span
                      className={`shrink-0 text-[11px] font-semibold uppercase ${levelClasses[log.streamType]}`}
                    >
                      {log.streamType}
                    </span>
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

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`
}

function truncateRunId(id: string) {
  return id.length <= 18 ? id : `${id.slice(0, 8)}...${id.slice(-6)}`
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function isForceStopEnabled(run: WorkflowRun) {
  if (run.status !== 'cancel_requested' || !run.updatedAt || !!run.cancelForceRequestedAt) {
    return false
  }
  return Date.now() - new Date(run.updatedAt).getTime() >= 30_000
}

function buildIterationTimeline(
  checkpoints: RunCheckpoint[],
  runStartedAt: string | null,
): IterationTimelineView[] {
  const grouped = new Map<number, IterationTimelineView>()
  const lastCheckpointAtByIteration = new Map<number, number>()

  for (const checkpoint of checkpoints) {
    const iteration = checkpoint.iteration ?? 1
    const current = grouped.get(iteration) ?? {
      iteration,
      done: false,
      summary: 'No loop summary recorded.',
      timestamp: checkpoint.createdAt,
      stages: [],
    }

    if (checkpoint.kind === 'stage_complete' && checkpoint.stageId) {
      const previousAt =
        lastCheckpointAtByIteration.get(iteration) ??
        (iteration === 1 && runStartedAt ? new Date(runStartedAt).getTime() : null)
      const currentAt = new Date(checkpoint.createdAt).getTime()

      current.stages.push({
        checkpointId: checkpoint.id,
        stageId: checkpoint.stageId,
        status: 'completed',
        completedAt: checkpoint.createdAt,
        durationLabel:
          previousAt && currentAt >= previousAt
            ? formatDuration(currentAt - previousAt)
            : '—',
      })
      lastCheckpointAtByIteration.set(iteration, currentAt)
    }

    if (checkpoint.kind === 'iteration_complete') {
      current.done = extractLoopDone(checkpoint.payload)
      current.summary = truncate(extractIterationSummary(checkpoint.payload), 160)
      current.timestamp = checkpoint.createdAt
      lastCheckpointAtByIteration.set(iteration, new Date(checkpoint.createdAt).getTime())
    }

    grouped.set(iteration, current)
  }

  return Array.from(grouped.values()).sort((left, right) => left.iteration - right.iteration)
}

function extractLoopDone(payload: Array<Record<string, unknown>>) {
  return payload.some((entry) => {
    const loop = entry.loop
    return !!loop && typeof loop === 'object' && (loop as { done?: unknown }).done === true
  })
}

function extractIterationSummary(payload: Array<Record<string, unknown>>) {
  for (const entry of payload) {
    if (typeof entry.reportSummary === 'string' && entry.reportSummary.trim().length > 0) {
      return entry.reportSummary.trim()
    }

    const delivery = entry.delivery
    if (Array.isArray(delivery)) {
      const firstComment = delivery.find(
        (candidate) =>
          !!candidate &&
          typeof candidate === 'object' &&
          (candidate as { kind?: unknown }).kind === 'comment' &&
          typeof (candidate as { body?: unknown }).body === 'string',
      ) as { body?: string } | undefined

      if (firstComment?.body?.trim()) {
        return firstComment.body.trim()
      }
    }
  }

  return 'Iteration completed without a summary.'
}

function formatDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '—'

  const totalSeconds = Math.round(durationMs / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}
