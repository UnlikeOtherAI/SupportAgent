import type { CreateSkillClone, UpdateSkill } from '@support-agent/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { skillsApi } from '@/api/skills'

export function useSkills() {
  return useQuery({
    queryKey: ['skills'],
    queryFn: () => skillsApi.list(),
  })
}

export function useSkillDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['skill', id],
    queryFn: () => skillsApi.get(id ?? ''),
    enabled: !!id,
  })
}

export function useCloneSkill() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateSkillClone) => skillsApi.clone(input),
    onSuccess: (skill) => {
      void queryClient.invalidateQueries({ queryKey: ['skills'] })
      queryClient.setQueryData(['skill', skill.id], skill)
    },
  })
}

export function useUpdateSkill(id: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateSkill) => skillsApi.update(id ?? '', input),
    onSuccess: (skill) => {
      void queryClient.invalidateQueries({ queryKey: ['skills'] })
      queryClient.setQueryData(['skill', skill.id], skill)
    },
  })
}
