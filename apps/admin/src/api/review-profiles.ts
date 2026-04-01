import { api } from '@/lib/api-client'
import type { PaginatedResponse } from './runs'

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
    const search = new URLSearchParams()
    if (params?.page) search.set('page', String(params.page))
    const qs = search.toString()
    return api.get<PaginatedResponse<ReviewProfile>>(`/v1/review-profiles${qs ? `?${qs}` : ''}`)
  },
  get: (id: string) => api.get<ReviewProfile>(`/v1/review-profiles/${id}`),
  create: (data: Partial<ReviewProfile>) => api.post<ReviewProfile>('/v1/review-profiles', data),
  update: (id: string, data: Partial<ReviewProfile>) => api.put<ReviewProfile>(`/v1/review-profiles/${id}`, data),
}
