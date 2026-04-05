import { api } from '@/lib/api-client'
import type { PaginatedResponse } from './runs'

export interface ExecutionProvider {
  id: string
  name: string
  type: string
  status: 'online' | 'offline' | 'unknown'
  lastHeartbeat: string | null
  hostCount: number
  createdAt: string
}

export interface ExecutionProviderHost {
  id: string
  hostname: string
  connectionStatus: 'connected' | 'disconnected'
  lastSeen: string
}

export interface RuntimeApiKey {
  id: string
  label: string
  tenantScope: string | null
  allowedMode: 'worker' | 'gateway' | 'both'
  createdAt: string
  lastUsed: string | null
  status: 'active' | 'revoked'
}

export const providersApi = {
  list: (params?: { page?: number }) => {
    const search = new URLSearchParams()
    if (params?.page) search.set('page', String(params.page))
    const qs = search.toString()
    return api.get<PaginatedResponse<ExecutionProvider>>(`/v1/execution-providers${qs ? `?${qs}` : ''}`)
  },
  get: (id: string) => api.get<ExecutionProvider>(`/v1/execution-providers/${id}`),
  getHosts: (id: string) => api.get<{ hosts: ExecutionProviderHost[] }>(`/v1/execution-providers/${id}/hosts`),
  create: (data: Partial<ExecutionProvider>) => api.post<ExecutionProvider>('/v1/execution-providers', data),
  update: (id: string, data: Partial<ExecutionProvider>) => api.put<ExecutionProvider>(`/v1/execution-providers/${id}`, data),
  delete: (id: string) => api.delete<undefined>(`/v1/execution-providers/${id}`),

  listApiKeys: (params?: { page?: number }) => {
    const search = new URLSearchParams()
    if (params?.page) search.set('page', String(params.page))
    const qs = search.toString()
    return api.get<PaginatedResponse<RuntimeApiKey>>(`/v1/runtime-api-keys${qs ? `?${qs}` : ''}`)
  },
  createApiKey: (data: { label: string; allowedMode: string; allowedProfiles: string[] }) =>
    api.post<{ key: RuntimeApiKey; secret: string }>('/v1/runtime-api-keys', data),
  revokeApiKey: (id: string) => api.delete<undefined>(`/v1/runtime-api-keys/${id}`),
}
