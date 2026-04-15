import { api } from '@/lib/api-client'
import { normalizePaginatedResponse } from './paginated-response'

export interface ConnectorPlatformType {
  id: string
  key: string
  displayName: string
}

export interface Connector {
  id: string
  name: string
  configuredIntakeMode?: 'webhook' | 'polling' | 'manual'
  config?: Record<string, string>
  platformType: ConnectorPlatformType
  pollingIntervalSeconds?: number | null
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

export interface ConnectorCreateInput {
  platformTypeKey?: string
  platformTypeId?: string
  name: string
  direction?: 'inbound' | 'outbound' | 'both'
  configuredIntakeMode?: 'webhook' | 'polling' | 'manual'
  pollingIntervalSeconds?: number
  config?: Record<string, string>
  secrets?: Record<string, string>
}

export interface ConnectorUpdateInput {
  config?: Record<string, string>
  configuredIntakeMode?: 'webhook' | 'polling' | 'manual'
  name?: string
  pollingIntervalSeconds?: number
  roles?: ('inbound' | 'outbound')[]
  intakeMode?: 'webhook' | 'polling'
}

export interface GitHubRepositoryOption {
  defaultBranch: string
  isPrivate: boolean
  nameWithOwner: string
  owner: string
  url: string
}

export interface GitHubRepositoryOwnerOption {
  login: string
  type: 'organization' | 'user'
}

interface RawConnectorPlatformType {
  id: string
  key: string
  displayName: string
}

interface RawConnectorCapability {
  capabilityKey: string
  isSupported: boolean
  discoveredAt: string | null
}

interface RawConnector {
  capabilities?: Record<string, string> | null
  id: string
  name: string
  direction: 'inbound' | 'outbound' | 'both'
  configuredIntakeMode: 'webhook' | 'polling' | 'manual'
  effectiveIntakeMode: 'webhook' | 'polling' | 'manual'
  isEnabled: boolean
  pollingIntervalSeconds?: number | null
  createdAt: string
  platformType: RawConnectorPlatformType
  connectorCapabilities?: RawConnectorCapability[]
  connectionSecrets?: ConnectorSecret[]
  taxonomyConfig?: {
    labels?: string[]
    projects?: string[]
    boards?: string[]
  } | null
}

function mapRoles(direction: RawConnector['direction']): Connector['roles'] {
  if (direction === 'both') return ['inbound', 'outbound']
  return [direction]
}

function mapConnector(raw: RawConnector): Connector {
  return {
    id: raw.id,
    name: raw.name,
    configuredIntakeMode: raw.configuredIntakeMode,
    config: raw.capabilities ?? {},
    platformType: raw.platformType,
    pollingIntervalSeconds: raw.pollingIntervalSeconds ?? null,
    roles: mapRoles(raw.direction),
    intakeMode: raw.effectiveIntakeMode === 'manual' ? 'polling' : raw.effectiveIntakeMode,
    status: raw.isEnabled ? 'healthy' : 'unconfigured',
    createdAt: raw.createdAt,
  }
}

function rolesToDirection(roles: ('inbound' | 'outbound')[] | undefined): RawConnector['direction'] | undefined {
  if (!roles || roles.length === 0) return undefined
  if (roles.includes('inbound') && roles.includes('outbound')) return 'both'
  return roles[0]
}

function mapConnectorDetail(raw: RawConnector): ConnectorDetail {
  return {
    ...mapConnector(raw),
    credentials: {
      masked: raw.connectionSecrets?.[0]?.maskedHint ?? 'Not configured',
    },
    capabilities: (raw.connectorCapabilities ?? []).map((capability) => ({
      key: capability.capabilityKey,
      supported: capability.isSupported,
      detectedAt: capability.discoveredAt,
    })),
    taxonomy: {
      labels: raw.taxonomyConfig?.labels ?? [],
      projects: raw.taxonomyConfig?.projects ?? [],
      boards: raw.taxonomyConfig?.boards ?? [],
    },
  }
}

export const connectorsApi = {
  list: (params?: { page?: number; limit?: number }) => {
    const page = params?.page ?? 1
    const limit = params?.limit ?? 20
    const search = new URLSearchParams()
    search.set('page', String(page))
    search.set('limit', String(limit))
    const qs = search.toString()
    return api
      .get<RawConnector[]>(`/v1/connectors${qs ? `?${qs}` : ''}`)
      .then((response) => normalizePaginatedResponse(response.map(mapConnector), limit, page))
  },
  get: (id: string) => api.get<RawConnector>(`/v1/connectors/${id}`).then(mapConnectorDetail),
  create: (data: ConnectorCreateInput) =>
    api
      .post<RawConnector>('/v1/connectors', {
        ...data,
        direction: data.direction ?? 'both',
        configuredIntakeMode: data.configuredIntakeMode ?? 'webhook',
      })
      .then(mapConnector),
  update: (id: string, data: ConnectorUpdateInput) =>
    api
      .patch<RawConnector>(`/v1/connectors/${id}`, {
        ...(data.config !== undefined ? { config: data.config } : {}),
        ...(data.configuredIntakeMode !== undefined
          ? { configuredIntakeMode: data.configuredIntakeMode }
          : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.pollingIntervalSeconds !== undefined
          ? { pollingIntervalSeconds: data.pollingIntervalSeconds }
          : {}),
        ...(data.roles !== undefined ? { direction: rolesToDirection(data.roles) } : {}),
        ...(data.intakeMode !== undefined ? { configuredIntakeMode: data.intakeMode } : {}),
      })
      .then(mapConnector),
  delete: (id: string) => api.delete(`/v1/connectors/${id}`),
  getSecrets: (id: string) => api.get<ConnectorSecret[]>('/v1/connectors/' + id + '/secrets'),
  setSecrets: (id: string, secrets: Record<string, string>) =>
    api.put<ConnectorSecret[]>('/v1/connectors/' + id + '/secrets', secrets),
  getPlatformTypes: () =>
    api.get<RawConnectorPlatformType[]>('/v1/platform-types').then((platformTypes) => ({
      platformTypes: platformTypes.map((platformType) => ({
        key: platformType.key,
        label: platformType.displayName,
        supportsInbound: true,
        supportsOutbound: true,
      })),
    })),
  getOAuthStartUrl: (platformKey: string, connectorId: string) =>
    api.get<{ redirectUrl: string }>(
      `/v1/connector-oauth/${platformKey}/start?connectorId=${encodeURIComponent(connectorId)}`
    ),
  discoverCapabilities: (id: string) =>
    api.post<RawConnectorCapability[]>(`/v1/connectors/${id}/capabilities/discover`).then((capabilities) => ({
      capabilities: capabilities.map((capability) => ({
        key: capability.capabilityKey,
        supported: capability.isSupported,
        detectedAt: capability.discoveredAt,
      })),
    })),
  getCapabilities: (id: string) =>
    api.get<RawConnectorCapability[]>(`/v1/connectors/${id}/capabilities`).then((capabilities) => ({
      capabilities: capabilities.map((capability) => ({
        key: capability.capabilityKey,
        supported: capability.isSupported,
        detectedAt: capability.discoveredAt,
      })),
    })),
  getTriggerPolicies: (id: string) => api.get<{ policies: TriggerPolicy[] }>(`/v1/connectors/${id}/trigger-policies`),
  updateTriggerPolicies: (id: string, policies: TriggerPolicy[]) => api.put(`/v1/connectors/${id}/trigger-policies`, { policies }),
  listRepositoryOptions: (id: string, owner?: string) => {
    const search = new URLSearchParams()
    if (owner?.trim()) {
      search.set('owner', owner.trim())
    }
    const query = search.toString()
    return api.get<{ repositories: GitHubRepositoryOption[] }>(
      `/v1/connectors/${id}/repository-options${query ? `?${query}` : ''}`,
    )
  },
  listRepositoryOwners: (id: string) =>
    api.get<{ owners: GitHubRepositoryOwnerOption[] }>(`/v1/connectors/${id}/repository-owners`),
}
