import { api } from '@/lib/api-client'
import { normalizePaginatedResponse, type PaginatedResponse } from './paginated-response'

export interface ReviewProfile {
  id: string
  name: string
  version: number
  maxRounds: number
  mandatoryHumanApproval: boolean
  continueAfterPassing: boolean
  allowedWorkflowTypes: string[]
  promptSetRef: string | null
  active: boolean
}

export const reviewProfilesApi = {
  list: (params?: { page?: number }) => {
    const page = params?.page ?? 1
    const limit = 20
    const search = new URLSearchParams()
    search.set('page', String(page))
    const qs = search.toString()
    return api
      .get<PaginatedResponse<ReviewProfile>>(`/v1/review-profiles${qs ? `?${qs}` : ''}`)
      .then((response) => normalizePaginatedResponse(response, limit, page))
  },
  get: (id: string) => api.get<ReviewProfile>(`/v1/review-profiles/${id}`),
  create: (data: Partial<ReviewProfile>) => api.post<ReviewProfile>('/v1/review-profiles', data),
  update: (id: string, data: Partial<ReviewProfile>) => api.put<ReviewProfile>(`/v1/review-profiles/${id}`, data),
}
