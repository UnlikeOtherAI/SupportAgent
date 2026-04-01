import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { repositoriesApi } from '@/api/repositories'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'

function nullableValue(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export default function RepositoryEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [connectorId, setConnectorId] = useState('')
  const [repositoryUrl, setRepositoryUrl] = useState('')
  const [executionProfileId, setExecutionProfileId] = useState('')
  const [orchestrationProfileId, setOrchestrationProfileId] = useState('')
  const [reviewProfileId, setReviewProfileId] = useState('')
  const [autoPr, setAutoPr] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['repository', id],
    queryFn: () => repositoriesApi.get(id!),
    enabled: !!id,
  })

  useEffect(() => {
    if (!data) return
    setName(data.name)
    setConnectorId(data.connectorId)
    setRepositoryUrl(data.repositoryUrl)
    setExecutionProfileId(data.executionProfileId ?? '')
    setOrchestrationProfileId(data.orchestrationProfileId ?? '')
    setReviewProfileId(data.reviewProfileId ?? '')
    setAutoPr(data.autoPr)
  }, [data])

  const mutation = useMutation({
    mutationFn: () =>
      repositoriesApi.update(id!, {
        name: name.trim(),
        connectorId: connectorId.trim(),
        repositoryUrl: repositoryUrl.trim(),
        executionProfileId: nullableValue(executionProfileId),
        orchestrationProfileId: nullableValue(orchestrationProfileId),
        reviewProfileId: nullableValue(reviewProfileId),
        autoPr,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['repositories'] })
      void queryClient.invalidateQueries({ queryKey: ['repository', id] })
      navigate(`/repositories/${id}`)
    },
  })

  if (isLoading) {
    return (
      <PageShell title="Edit Repository Mapping">
        <p className="text-sm text-gray-400">Loading...</p>
      </PageShell>
    )
  }

  if (!data) {
    return (
      <PageShell title="Edit Repository Mapping">
        <p className="text-sm text-gray-400">Not found</p>
      </PageShell>
    )
  }

  const errorMessage =
    mutation.error instanceof Error ? mutation.error.message : 'Failed to save mapping'

  return (
    <PageShell title="Edit Repository Mapping">
      <Link
        to={`/repositories/${id}`}
        className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700"
      >
        &larr; Back to Repository Mapping
      </Link>
      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate()
          }}
        >
          <div className="space-y-4 px-5 py-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Name</label>
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Connector ID</label>
              <input
                required
                value={connectorId}
                onChange={(event) => setConnectorId(event.target.value)}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Repository URL</label>
              <input
                required
                value={repositoryUrl}
                onChange={(event) => setRepositoryUrl(event.target.value)}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">
                  Execution Profile ID
                </label>
                <input
                  value={executionProfileId}
                  onChange={(event) => setExecutionProfileId(event.target.value)}
                  className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">
                  Orchestration Profile ID
                </label>
                <input
                  value={orchestrationProfileId}
                  onChange={(event) => setOrchestrationProfileId(event.target.value)}
                  className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Review Profile ID</label>
              <input
                value={reviewProfileId}
                onChange={(event) => setReviewProfileId(event.target.value)}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={autoPr}
                onChange={(event) => setAutoPr(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500"
              />
              Auto PR
            </label>
            {mutation.isError ? <p className="mt-1 text-xs text-signal-red-500">{errorMessage}</p> : null}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => navigate(`/repositories/${id}`)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
