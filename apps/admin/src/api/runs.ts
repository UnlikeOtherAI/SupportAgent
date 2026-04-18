import { api } from '@/lib/api-client'
import { normalizePaginatedResponse, type PaginatedResponse } from './paginated-response'

export interface WorkflowRun {
  id: string
  workflowType: 'triage' | 'build' | 'merge'
  status:
    | 'queued'
    | 'blocked'
    | 'dispatched'
    | 'running'
    | 'cancel_requested'
    | 'awaiting_review'
    | 'awaiting_human'
    | 'succeeded'
    | 'failed'
    | 'canceled'
    | 'lost'
  startedAt: string | null
  completedAt?: string | null
  updatedAt: string
  duration: string | null
  workItemId: string | null
  currentStage?: string | null
  cancelForceRequestedAt?: string | null
  workItem?: { title: string; externalUrl: string; repositoryRef: string }
  repositoryMapping?: { repositoryUrl: string; connector?: { name: string } }
  connectorName?: string
  repositoryName?: string
}

export interface WorkflowRunDetail extends WorkflowRun {
  logEvents: LogEvent[]
  findings: Finding[]
}

export interface LogEvent {
  id: string
  timestamp: string
  streamType: 'stdout' | 'stderr' | 'progress'
  message: string
}

export interface Finding {
  id: string
  title: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
}

export interface RunCheckpoint {
  id: string
  dispatchAttemptId: string
  kind: 'stage_complete' | 'iteration_complete'
  iteration: number | null
  stageId: string | null
  payload: Array<Record<string, unknown>>
  createdAt: string
}

export const runsApi = {
  list: (params?: { page?: number; limit?: number; type?: string; status?: string }) => {
    const page = params?.page ?? 1
    const limit = params?.limit ?? 50
    const search = new URLSearchParams()
    search.set('limit', String(limit))
    search.set('offset', String((page - 1) * limit))
    if (params?.type && params.type !== 'all') search.set('workflowType', params.type)
    if (params?.status && params.status !== 'all') search.set('status', params.status)
    const qs = search.toString()
    return api
      .get<PaginatedResponse<WorkflowRun>>(`/v1/runs${qs ? `?${qs}` : ''}`)
      .then((response) => normalizePaginatedResponse(response, limit, page))
  },
  get: (id: string) => api.get<WorkflowRunDetail>(`/v1/runs/${id}`),
  getCheckpoints: (id: string) => api.get<RunCheckpoint[]>(`/v1/workflow-runs/${id}/checkpoints`),
  getLogs: (id: string, after?: string) => {
    const qs = after ? `?after=${after}` : ''
    return api.get<{ logs: LogEvent[] }>(`/v1/runs/${id}/logs${qs}`)
  },
  getFindings: (id: string) => api.get<{ findings: Finding[] }>(`/v1/runs/${id}/findings`),
  cancel: (id: string, force = false) =>
    api.post<WorkflowRun>(`/v1/workflow-runs/${id}/cancel${force ? '?force=1' : ''}`),
}
