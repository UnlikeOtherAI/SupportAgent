import { api } from '@/lib/api-client'
import type { PaginatedResponse } from './runs'

export interface RepositoryMapping {
  id: string
  name: string
  connectorId: string
  connectorName: string
  repositoryUrl: string
  executionProfileId: string | null
  orchestrationProfileId: string | null
  reviewProfileId: string | null
  autoPr: boolean
  status: string
  createdAt: string
}

export const repositoriesApi = {
  list: (params?: { page?: number; limit?: number }) => {
    const search = new URLSearchParams()
    if (params?.page) search.set('page', String(params.page))
    if (params?.limit) search.set('limit', String(params.limit))
    const qs = search.toString()
    return api.get<PaginatedResponse<RepositoryMapping>>(`/v1/repository-mappings${qs ? `?${qs}` : ''}`)
  },
  get: (id: string) => api.get<RepositoryMapping>(`/v1/repository-mappings/${id}`),
  create: (data: Partial<RepositoryMapping>) => api.post<RepositoryMapping>('/v1/repository-mappings', data),
  update: (id: string, data: Partial<RepositoryMapping>) => api.put<RepositoryMapping>(`/v1/repository-mappings/${id}`, data),
  delete: (id: string) => api.delete<undefined>(`/v1/repository-mappings/${id}`),
}
