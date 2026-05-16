import { api } from '@/lib/api-client'

export interface IdentityProvider {
  key: string
  label: string
  buttonText: string
  kind: string
  iconUrl: string | null
  startUrl: string
  enabled: boolean
}

export interface AuthProvidersResponse {
  providers: IdentityProvider[]
}

export interface DevLoginResponse {
  userId: string
  displayName: string
  email: string
  avatarUrl: string | null
  role: string
}

export interface MeResponse {
  userId: string
  tenantId: string
  displayName: string
  email: string
  avatarUrl: string | null
  role: string
}

export const authApi = {
  getProviders: () => api.get<AuthProvidersResponse>('/v1/auth/providers'),
  devLogin: () => api.get<DevLoginResponse>('/v1/auth/dev-login'),
  me: () => api.get<MeResponse>('/v1/auth/me'),
  logout: () => api.post<{ ok: boolean }>('/v1/auth/logout'),
}
