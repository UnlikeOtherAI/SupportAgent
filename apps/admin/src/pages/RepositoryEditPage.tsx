import { useState } from 'react'
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
  const { id: rawId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<{
    connectorId: string
    repositoryUrl: string
    defaultBranch: string
    executionProfileId: string
    orchestrationProfileId: string
    reviewProfileId: string
  } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['repository', rawId],
    queryFn: async () => {
      if (!rawId) throw new Error('No repository ID')
      return repositoriesApi.get(rawId)
    },
    enabled: !!rawId,
  })

  // Always call useMutation unconditionally — before any conditionals
  const id = rawId ?? data?.id ?? ''
  const form = draft ?? (data ? {
    connectorId: data.connectorId,
    repositoryUrl: data.repositoryUrl,
    defaultBranch: data.defaultBranch,
    executionProfileId: data.executionProfileId ?? '',
    orchestrationProfileId: data.orchestrationProfileId ?? '',
    reviewProfileId: data.reviewProfileId ?? '',
  } : null)
  const mutation = useMutation({
    mutationFn: () => {
      if (!rawId) throw new Error('No repository ID')
      if (!form) throw new Error('Repository not loaded')
      return repositoriesApi.update(rawId, {
        connectorId: form.connectorId.trim(),
        repositoryUrl: form.repositoryUrl.trim(),
        defaultBranch: form.defaultBranch.trim() || 'main',
        executionProfileId: nullableValue(form.executionProfileId),
        orchestrationProfileId: nullableValue(form.orchestrationProfileId),
        reviewProfileId: nullableValue(form.reviewProfileId),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['repositories'] })
      void queryClient.invalidateQueries({ queryKey: ['repository', rawId] })
      void navigate(`/repositories/${rawId}`)
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
              <label htmlFor="repo-connector-id" className="mb-1.5 block text-xs font-medium text-gray-500">Connector ID</label>
              <input
                id="repo-connector-id"
                required
                value={form?.connectorId ?? ''}
                onChange={(event) => { if (form) setDraft({ ...form, connectorId: event.target.value }); }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <div>
              <label htmlFor="repo-url" className="mb-1.5 block text-xs font-medium text-gray-500">Repository URL</label>
              <input
                id="repo-url"
                required
                value={form?.repositoryUrl ?? ''}
                onChange={(event) => { if (form) setDraft({ ...form, repositoryUrl: event.target.value }); }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <div>
              <label htmlFor="repo-default-branch" className="mb-1.5 block text-xs font-medium text-gray-500">Default Branch</label>
              <input
                id="repo-default-branch"
                required
                value={form?.defaultBranch ?? 'main'}
                onChange={(event) => { if (form) setDraft({ ...form, defaultBranch: event.target.value }); }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="repo-execution-profile-id" className="mb-1.5 block text-xs font-medium text-gray-500">
                  Execution Profile ID
                </label>
                <input
                  id="repo-execution-profile-id"
                  value={form?.executionProfileId ?? ''}
                  onChange={(event) => { if (form) setDraft({ ...form, executionProfileId: event.target.value }); }}
                  className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
                />
              </div>
              <div>
                <label htmlFor="repo-orchestration-profile-id" className="mb-1.5 block text-xs font-medium text-gray-500">
                  Orchestration Profile ID
                </label>
                <input
                  id="repo-orchestration-profile-id"
                  value={form?.orchestrationProfileId ?? ''}
                  onChange={(event) => { if (form) setDraft({ ...form, orchestrationProfileId: event.target.value }); }}
                  className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
                />
              </div>
            </div>
            <div>
              <label htmlFor="repo-review-profile-id" className="mb-1.5 block text-xs font-medium text-gray-500">Review Profile ID</label>
              <input
                id="repo-review-profile-id"
                value={form?.reviewProfileId ?? ''}
                onChange={(event) => { if (form) setDraft({ ...form, reviewProfileId: event.target.value }); }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
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
