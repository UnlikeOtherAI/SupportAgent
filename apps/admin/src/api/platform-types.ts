import { api } from '@/lib/api-client'

export interface PlatformTypeDetail {
  id: string
  key: string
  displayName: string
  description: string
  category: string
  iconSlug: string
  supportsWebhook: boolean
  supportsPolling: boolean
  supportsInbound: boolean
  supportsOutbound: boolean
  supportsCustomServer: boolean
  defaultDirection: 'inbound' | 'outbound' | 'both'
  defaultIntakeMode: 'webhook' | 'polling' | 'manual'
  configFields: Array<{
    key: string
    label: string
    type: 'text' | 'password' | 'url' | 'number' | 'toggle'
    placeholder?: string
    helpText?: string
    required: boolean
    secretType?: string
  }>
}

export const platformTypesApi = {
  list: () => api.get<PlatformTypeDetail[]>('/v1/platform-types'),
  get: (key: string) => api.get<PlatformTypeDetail>('/v1/platform-types/' + key),
}
