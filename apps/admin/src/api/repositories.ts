import { api } from '@/lib/api-client'
import type { PaginatedResponse } from './runs'

export interface RepositoryMapping {
  id: string
  connectorId: string
  connectorName: string
  repositoryUrl: string
  defaultBranch: string
  executionProfileId: string | null
  orchestrationProfileId: string | null
  reviewProfileId: string | null
  autoPr: boolean
  status: string
  createdAt: string
}

/** Raw API response shape — Prisma array with nested connector */
interface RawRepositoryMapping {
  id: string
  connectorId: string
  connector: { id: string; name: string }
  repositoryUrl: string
  defaultBranch: string
  executionProfileId: string | null
  orchestrationProfileId: string | null
  reviewProfileId: string | null
  dependencyPolicy: unknown | null
  notificationBindings: unknown | null
  status: string
  createdAt: Date
}

export const repositoriesApi = {
  list: (params?: { page?: number; limit?: number }) => {
    const search = new URLSearchParams()
    if (params?.page) search.set('page', String(params.page))
    if (params?.limit) search.set('limit', String(params.limit))
    const qs = search.toString()
    return api.get<RawRepositoryMapping[]>(`/v1/repository-mappings${qs ? `?${qs}` : ''}`).then(
      (raw): PaginatedResponse<RepositoryMapping> => ({
        items: raw.map((m) => ({
          id: m.id,
          connectorId: m.connectorId,
          connectorName: m.connector?.name ?? '',
          repositoryUrl: m.repositoryUrl,
          defaultBranch: m.defaultBranch,
          executionProfileId: m.executionProfileId,
          orchestrationProfileId: m.orchestrationProfileId,
          reviewProfileId: m.reviewProfileId,
          autoPr: false,
          status: m.status,
          createdAt: new Date(m.createdAt).toISOString(),
        })),
        total: raw.length,
      }),
    )
  },
  get: (id: string) => api.get<RepositoryMapping>(`/v1/repository-mappings/${id}`),
  create: (data: Partial<RepositoryMapping>) => api.post<RepositoryMapping>('/v1/repository-mappings', data),
  update: (id: string, data: Partial<RepositoryMapping>) => api.put<RepositoryMapping>(`/v1/repository-mappings/${id}`, data),
  delete: (id: string) => api.delete<undefined>(`/v1/repository-mappings/${id}`),
}
