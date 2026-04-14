import { api } from '@/lib/api-client'
import { normalizePaginatedResponse, type PaginatedResponse } from './paginated-response'

export interface WorkflowScenario {
  id: string
  key: string
  displayName: string
  workflowType: 'triage' | 'build' | 'merge'
  enabled: boolean
  triggerPolicyCount: number
  executionProfileId: string | null
  orchestrationProfileId: string | null
  reviewProfileId: string | null
  allowedConnectors: string[]
  notificationPolicy: string | null
  distributionTarget: string | null
}

export const scenariosApi = {
  list: (params?: { page?: number }) => {
    const page = params?.page ?? 1
    const limit = 20
    const search = new URLSearchParams()
    search.set('page', String(page))
    const qs = search.toString()
    return api
      .get<PaginatedResponse<WorkflowScenario>>(`/v1/workflow-scenarios${qs ? `?${qs}` : ''}`)
      .then((response) => normalizePaginatedResponse(response, limit, page))
  },
  get: (id: string) => api.get<WorkflowScenario>(`/v1/workflow-scenarios/${id}`),
  create: (data: Partial<WorkflowScenario>) => api.post<WorkflowScenario>('/v1/workflow-scenarios', data),
  update: (id: string, data: Partial<WorkflowScenario>) => api.put<WorkflowScenario>(`/v1/workflow-scenarios/${id}`, data),
  delete: (id: string) => api.delete<undefined>(`/v1/workflow-scenarios/${id}`),
}
