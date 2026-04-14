import { api } from '@/lib/api-client'
import { normalizePaginatedResponse, type PaginatedResponse } from './paginated-response'

export interface CommunicationChannel {
  id: string
  name: string
  platform: 'slack' | 'teams' | 'whatsapp'
  pairingStatus: 'paired' | 'pending' | 'disconnected'
  linkedWorkspace: string | null
  allowedActions: string[]
  notificationSubscriptions: string[]
  linkedScope: string | null
  createdAt: string
}

export const channelsApi = {
  list: (params?: { page?: number }) => {
    const page = params?.page ?? 1
    const limit = 20
    const search = new URLSearchParams()
    search.set('page', String(page))
    const qs = search.toString()
    return api
      .get<PaginatedResponse<CommunicationChannel>>(`/v1/communication-channels${qs ? `?${qs}` : ''}`)
      .then((response) => normalizePaginatedResponse(response, limit, page))
  },
  get: (id: string) => api.get<CommunicationChannel>(`/v1/communication-channels/${id}`),
  create: (data: Partial<CommunicationChannel>) => api.post<CommunicationChannel>('/v1/communication-channels', data),
  update: (id: string, data: Partial<CommunicationChannel>) => api.put<CommunicationChannel>(`/v1/communication-channels/${id}`, data),
  delete: (id: string) => api.delete<undefined>(`/v1/communication-channels/${id}`),
}
