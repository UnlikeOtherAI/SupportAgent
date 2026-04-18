import type {
  CreateExecutorClone,
  ExecutorDetail,
  ExecutorSummary,
  UpdateExecutor,
} from '@support-agent/contracts'
import { api } from '@/lib/api-client'

export const executorsApi = {
  list: () => api.get<ExecutorSummary[]>('/v1/executors'),
  get: (id: string) => api.get<ExecutorDetail>(`/v1/executors/${id}`),
  clone: (input: CreateExecutorClone) => api.post<ExecutorDetail>('/v1/executors', input),
  update: (id: string, input: UpdateExecutor) => api.put<ExecutorDetail>(`/v1/executors/${id}`, input),
}
