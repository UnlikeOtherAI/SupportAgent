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

export const authApi = {
  getProviders: () => api.get<AuthProvidersResponse>('/v1/auth/providers'),
}
