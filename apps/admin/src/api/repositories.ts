import { api } from '@/lib/api-client'
import { normalizePaginatedResponse, type PaginatedResponse } from './paginated-response'

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

export interface RepositoryMappingWriteInput {
  connectorId?: string
  repositoryUrl?: string
  defaultBranch?: string
  executionProfileId?: string | null
  orchestrationProfileId?: string | null
  reviewProfileId?: string | null
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
  dependencyPolicy: null
  notificationBindings: null
  status: string
  createdAt: Date
}

function mapRepositoryMapping(m: RawRepositoryMapping): RepositoryMapping {
  return {
    id: m.id,
    connectorId: m.connectorId,
    connectorName: m.connector.name,
    repositoryUrl: m.repositoryUrl,
    defaultBranch: m.defaultBranch,
    executionProfileId: m.executionProfileId,
    orchestrationProfileId: m.orchestrationProfileId,
    reviewProfileId: m.reviewProfileId,
    autoPr: false,
    status: 'active',
    createdAt: new Date(m.createdAt).toISOString(),
  }
}

export const repositoriesApi = {
  list: (params?: { connectorId?: string; page?: number; limit?: number }) => {
    const page = params?.page ?? 1
    const limit = params?.limit ?? 20
    const search = new URLSearchParams()
    search.set('page', String(page))
    search.set('limit', String(limit))
    if (params?.connectorId) {
      search.set('connectorId', params.connectorId)
    }
    const qs = search.toString()
    return api
      .get<RawRepositoryMapping[]>(`/v1/repository-mappings${qs ? `?${qs}` : ''}`)
      .then((raw): PaginatedResponse<RepositoryMapping> => normalizePaginatedResponse(raw.map(mapRepositoryMapping), limit, page))
  },
  get: (id: string) => api.get<RawRepositoryMapping>(`/v1/repository-mappings/${id}`).then(mapRepositoryMapping),
  create: (data: RepositoryMappingWriteInput) => api.post<RawRepositoryMapping>('/v1/repository-mappings', data).then(mapRepositoryMapping),
  update: (id: string, data: RepositoryMappingWriteInput) => api.patch<RawRepositoryMapping>(`/v1/repository-mappings/${id}`, data).then(mapRepositoryMapping),
  delete: (id: string) => api.delete<undefined>(`/v1/repository-mappings/${id}`),
}
