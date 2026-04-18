import type { CreateExecutorClone, UpdateExecutor } from '@support-agent/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { executorsApi } from '@/api/executors'

export function useExecutors() {
  return useQuery({
    queryKey: ['executors'],
    queryFn: () => executorsApi.list(),
  })
}

export function useExecutorDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['executor', id],
    queryFn: () => executorsApi.get(id ?? ''),
    enabled: !!id,
  })
}

export function useCloneExecutor() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateExecutorClone) => executorsApi.clone(input),
    onSuccess: (executor) => {
      void queryClient.invalidateQueries({ queryKey: ['executors'] })
      queryClient.setQueryData(['executor', executor.id], executor)
    },
  })
}

export function useUpdateExecutor(id: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateExecutor) => executorsApi.update(id ?? '', input),
    onSuccess: (executor) => {
      void queryClient.invalidateQueries({ queryKey: ['executors'] })
      queryClient.setQueryData(['executor', executor.id], executor)
    },
  })
}
