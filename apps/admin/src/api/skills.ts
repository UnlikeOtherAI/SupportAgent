import type {
  CreateSkillClone,
  SkillDetail,
  SkillSummary,
  UpdateSkill,
} from '@support-agent/contracts'
import { api } from '@/lib/api-client'

export const skillsApi = {
  list: () => api.get<SkillSummary[]>('/v1/skills'),
  get: (id: string) => api.get<SkillDetail>(`/v1/skills/${id}`),
  clone: (input: CreateSkillClone) => api.post<SkillDetail>('/v1/skills', input),
  update: (id: string, input: UpdateSkill) => api.put<SkillDetail>(`/v1/skills/${id}`, input),
}
