import { api } from '@/lib/api-client'
import type { PaginatedResponse } from './runs'

export interface Connector {
  id: string
  name: string
  platformType: string
  roles: ('inbound' | 'outbound')[]
  intakeMode: 'webhook' | 'polling'
  status: 'healthy' | 'degraded' | 'unconfigured'
  createdAt: string
}

export interface ConnectorDetail extends Connector {
  credentials: { masked: string }
  capabilities: ConnectorCapability[]
  taxonomy: TaxonomyConfig
}

export interface ConnectorCapability {
  key: string
  supported: boolean
  detectedAt: string | null
}

export interface ConnectorSecret {
  id: string
  secretType: string
  maskedHint: string | null
  createdAt: string
  rotatedAt: string | null
}

export interface TaxonomyConfig {
  labels: string[]
  projects: string[]
  boards: string[]
}

export interface PlatformType {
  key: string
  label: string
  supportsInbound: boolean
  supportsOutbound: boolean
}

export interface TriggerPolicy {
  workflowType: 'triage' | 'build' | 'merge'
  events: string[]
  labels: string[]
  triggerIntent: string | null
  autoPr: boolean
}

export const connectorsApi = {
  list: (params?: { page?: number; limit?: number }) => {
    const search = new URLSearchParams()
    if (params?.page) search.set('page', String(params.page))
    if (params?.limit) search.set('limit', String(params.limit))
    const qs = search.toString()
    return api.get<PaginatedResponse<Connector>>(`/v1/connectors${qs ? `?${qs}` : ''}`)
  },
  get: (id: string) => api.get<ConnectorDetail>(`/v1/connectors/${id}`),
  create: (data: Partial<Connector>) => api.post<Connector>('/v1/connectors', data),
  update: (id: string, data: Partial<Connector>) => api.put<Connector>(`/v1/connectors/${id}`, data),
  delete: (id: string) => api.delete<void>(`/v1/connectors/${id}`),
  getSecrets: (id: string) => api.get<ConnectorSecret[]>('/v1/connectors/' + id + '/secrets'),
  setSecrets: (id: string, secrets: Record<string, string>) =>
    api.put<ConnectorSecret[]>('/v1/connectors/' + id + '/secrets', secrets),
  getPlatformTypes: () => api.get<{ platformTypes: PlatformType[] }>('/v1/connectors/platform-types'),
  discoverCapabilities: (id: string) => api.post<{ capabilities: ConnectorCapability[] }>(`/v1/connectors/${id}/discover-capabilities`),
  getCapabilities: (id: string) => api.get<{ capabilities: ConnectorCapability[] }>(`/v1/connectors/${id}/capabilities`),
  getTriggerPolicies: (id: string) => api.get<{ policies: TriggerPolicy[] }>(`/v1/connectors/${id}/trigger-policies`),
  updateTriggerPolicies: (id: string, policies: TriggerPolicy[]) => api.put<void>(`/v1/connectors/${id}/trigger-policies`, { policies }),
}
