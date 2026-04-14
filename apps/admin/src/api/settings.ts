import { api } from '@/lib/api-client'
import { normalizePaginatedResponse, type PaginatedResponse } from './paginated-response'

export interface TenantSettings {
  orgName: string
  productMode: 'standalone-saas' | 'standalone-enterprise' | 'integrated'
  hostingMode: string
  modelAccessMode: string
  outputVisibilityPolicy: string
  onboardingRequired: boolean
}

export interface IdentityProviderConfig {
  id: string
  label: string
  protocol: 'oidc' | 'saml' | 'oauth-broker'
  issuerUrl: string
  clientId: string
  enabled: boolean
}

export interface User {
  id: string
  displayName: string
  email: string
  role: 'admin' | 'operator' | 'viewer'
  lastLogin: string | null
}

export interface AuditEvent {
  id: string
  timestamp: string
  actor: string
  action: string
  resourceType: string
  resourceId: string
  outcome: 'success' | 'failure'
}

export const settingsApi = {
  getTenant: () => api.get<TenantSettings>('/v1/settings/tenant'),
  updateTenant: (data: Partial<TenantSettings>) => api.put<TenantSettings>('/v1/settings/tenant', data),

  listIdentityProviders: () => api.get<{ providers: IdentityProviderConfig[] }>('/v1/settings/identity-providers'),
  createIdentityProvider: (data: Partial<IdentityProviderConfig>) => api.post<IdentityProviderConfig>('/v1/settings/identity-providers', data),
  updateIdentityProvider: (id: string, data: Partial<IdentityProviderConfig>) => api.put<IdentityProviderConfig>(`/v1/settings/identity-providers/${id}`, data),
  deleteIdentityProvider: (id: string) => api.delete<undefined>(`/v1/settings/identity-providers/${id}`),

  listUsers: () =>
    api
      .get<PaginatedResponse<User>>('/v1/users')
      .then((response) => normalizePaginatedResponse(response, 25, 1)),
  updateUserRole: (id: string, role: string) => api.put<User>(`/v1/users/${id}/role`, { role }),
  deactivateUser: (id: string) => api.delete<undefined>(`/v1/users/${id}`),

  listAuditEvents: (params?: { page?: number; limit?: number }) => {
    const page = params?.page ?? 1
    const limit = params?.limit ?? 25
    const search = new URLSearchParams()
    search.set('page', String(page))
    search.set('limit', String(limit))
    const qs = search.toString()
    return api
      .get<PaginatedResponse<AuditEvent>>(`/v1/audit-events${qs ? `?${qs}` : ''}`)
      .then((response) => normalizePaginatedResponse(response, limit, page))
  },
}
