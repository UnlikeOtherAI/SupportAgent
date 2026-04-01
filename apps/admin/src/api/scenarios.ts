import { api } from '@/lib/api-client'
import type { PaginatedResponse } from './runs'

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
    const search = new URLSearchParams()
    if (params?.page) search.set('page', String(params.page))
    const qs = search.toString()
    return api.get<PaginatedResponse<WorkflowScenario>>(`/v1/workflow-scenarios${qs ? `?${qs}` : ''}`)
  },
  get: (id: string) => api.get<WorkflowScenario>(`/v1/workflow-scenarios/${id}`),
  create: (data: Partial<WorkflowScenario>) => api.post<WorkflowScenario>('/v1/workflow-scenarios', data),
  update: (id: string, data: Partial<WorkflowScenario>) => api.put<WorkflowScenario>(`/v1/workflow-scenarios/${id}`, data),
  delete: (id: string) => api.delete<void>(`/v1/workflow-scenarios/${id}`),
}
