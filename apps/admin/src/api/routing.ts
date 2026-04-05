import { api } from '@/lib/api-client'
import type { PaginatedResponse } from './runs'

export interface RoutingRule {
  id: string
  priority: number
  connectorCondition: string | null
  workflowTypeCondition: string | null
  scenarioCondition: string | null
  destinationId: string
  destinationName: string
  enabled: boolean
}

export interface OutboundDestination {
  id: string
  name: string
  platformType: string
  deliveryType: 'comment-back' | 'create-issue' | 'pr' | 'draft-pr'
  configured: boolean
  createdAt: string
}

export const routingApi = {
  listRules: (params?: { page?: number }) => {
    const search = new URLSearchParams()
    if (params?.page) search.set('page', String(params.page))
    const qs = search.toString()
    return api.get<PaginatedResponse<RoutingRule>>(`/v1/routing-rules${qs ? `?${qs}` : ''}`)
  },
  getRule: (id: string) => api.get<RoutingRule>(`/v1/routing-rules/${id}`),
  createRule: (data: Partial<RoutingRule>) => api.post<RoutingRule>('/v1/routing-rules', data),
  updateRule: (id: string, data: Partial<RoutingRule>) => api.put<RoutingRule>(`/v1/routing-rules/${id}`, data),
  deleteRule: (id: string) => api.delete<undefined>(`/v1/routing-rules/${id}`),

  listDestinations: (params?: { page?: number }) => {
    const search = new URLSearchParams()
    if (params?.page) search.set('page', String(params.page))
    const qs = search.toString()
    return api.get<PaginatedResponse<OutboundDestination>>(`/v1/outbound-destinations${qs ? `?${qs}` : ''}`)
  },
  getDestination: (id: string) => api.get<OutboundDestination>(`/v1/outbound-destinations/${id}`),
  createDestination: (data: Partial<OutboundDestination>) => api.post<OutboundDestination>('/v1/outbound-destinations', data),
  updateDestination: (id: string, data: Partial<OutboundDestination>) => api.put<OutboundDestination>(`/v1/outbound-destinations/${id}`, data),
  deleteDestination: (id: string) => api.delete<undefined>(`/v1/outbound-destinations/${id}`),
}
