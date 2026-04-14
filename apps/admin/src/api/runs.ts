import { api } from '@/lib/api-client'

export interface WorkflowRun {
  id: string
  workflowType: 'triage' | 'build' | 'merge'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  startedAt: string
  duration: string | null
  workItemId: string | null
  workItem?: { title: string; externalUrl: string; repositoryRef: string }
  repositoryMapping?: { repositoryUrl: string; connector?: { name: string } }
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

export interface PaginatedResponse<T> {
  items: T[]
  total: number
}

export const runsApi = {
  list: (params?: { page?: number; limit?: number; type?: string; status?: string }) => {
    const search = new URLSearchParams()
    if (params?.page) search.set('page', String(params.page))
    if (params?.limit) search.set('limit', String(params.limit))
    if (params?.type && params.type !== 'all') search.set('type', params.type)
    if (params?.status && params.status !== 'all') search.set('status', params.status)
    const qs = search.toString()
    return api.get<PaginatedResponse<WorkflowRun>>(`/v1/runs${qs ? `?${qs}` : ''}`)
  },
  get: (id: string) => api.get<WorkflowRunDetail>(`/v1/runs/${id}`),
  getLogs: (id: string, after?: string) => {
    const qs = after ? `?after=${after}` : ''
    return api.get<{ logs: LogEvent[] }>(`/v1/runs/${id}/logs${qs}`)
  },
  getFindings: (id: string) => api.get<{ findings: Finding[] }>(`/v1/runs/${id}/findings`),
  cancel: (id: string) => api.post<undefined>(`/v1/runs/${id}/cancel`),
}
