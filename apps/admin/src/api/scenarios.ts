import { api } from '@/lib/api-client'
import { normalizePaginatedResponse, type PaginatedResponse } from './paginated-response'

export interface WorkflowScenario {
  id: string
  key: string
  displayName: string
  workflowType: 'triage' | 'build' | 'merge' | 'review'
  enabled: boolean
  triggerPolicyCount: number
  executionProfileId: string | null
  orchestrationProfileId: string | null
  reviewProfileId: string | null
  allowedConnectors: string[]
  notificationPolicy: string | null
  distributionTarget: string | null
  triggerAllowlist: WorkflowTriggerAllowlist | null
  designerGraph: WorkflowDesignerGraph
}

export interface WorkflowTriggerAllowlist {
  users: string[]
  teams: string[]
  defaultPolicy: 'allow' | 'deny'
}

export type WorkflowDesignerNodeType = 'trigger' | 'action' | 'output'

export interface WorkflowDesignerNode {
  id: string
  type: WorkflowDesignerNodeType
  label: string
  sourceKey: string
  x: number
  y: number
  config: Record<string, unknown>
}

export interface WorkflowDesignerConnection {
  id?: string
  fromNodeId: string
  toNodeId: string
}

export interface WorkflowDesignerGraph {
  nodes: WorkflowDesignerNode[]
  connections: WorkflowDesignerConnection[]
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
