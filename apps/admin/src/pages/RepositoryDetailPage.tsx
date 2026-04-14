import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { repositoriesApi } from '@/api/repositories'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-800">{value}</dd>
    </div>
  )
}

export default function RepositoryDetailPage() {
  const { id: rawId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['repository', rawId],
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- enabled: !!rawId guards this
    queryFn: () => repositoriesApi.get(rawId!),
    enabled: !!rawId,
  })

  // Always call useMutation unconditionally — before any conditionals
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!rawId) throw new Error('No repository ID')
      return repositoriesApi.delete(rawId)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['repositories'] })
      void navigate('/repositories')
    },
  })

  if (isLoading) {
    return (
      <PageShell title="Repository Mapping">
        <p className="text-sm text-gray-400">Loading...</p>
      </PageShell>
    )
  }

  if (!data) {
    return (
      <PageShell title="Repository Mapping">
        <p className="text-sm text-gray-400">Not found</p>
      </PageShell>
    )
  }

  const title = data.repositoryUrl.replace(/^https?:\/\/github\.com\//, '')

  return (
    <PageShell
      title={title}
      action={
        <>
          <Link to={`/repositories/${data.id}/edit`}>
            <Button>Edit</Button>
          </Link>
          <Button
            variant="danger"
            disabled={deleteMutation.isPending}
            onClick={() => { deleteMutation.mutate(); }}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </>
      }
    >
      <Link
        to="/repositories"
        className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700"
      >
        &larr; Back to Repository Mappings
      </Link>
      <Card className="divide-y divide-gray-100">
        <DetailRow label="Connector" value={data.connectorName} />
        <DetailRow
          label="Repository URL"
          value={<span className="font-mono text-xs text-gray-500">{data.repositoryUrl}</span>}
        />
        <DetailRow label="Auto PR" value={data.autoPr ? 'Yes' : 'No'} />
        <DetailRow label="Status" value={data.status} />
        <DetailRow label="Default Branch" value={data.defaultBranch} />
        <div className="px-5 py-4">
          <h2 className="text-xs font-medium text-gray-500">Profile IDs</h2>
          <dl className="mt-3 space-y-3">
            <div>
              <dt className="text-xs font-medium text-gray-500">Execution Profile</dt>
              <dd className="mt-1 text-sm text-gray-800">
                {data.executionProfileId ? (
                  <span className="font-mono text-xs text-gray-500">{data.executionProfileId}</span>
                ) : (
                  'Not set'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Orchestration Profile</dt>
              <dd className="mt-1 text-sm text-gray-800">
                {data.orchestrationProfileId ? (
                  <span className="font-mono text-xs text-gray-500">{data.orchestrationProfileId}</span>
                ) : (
                  'Not set'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Review Profile</dt>
              <dd className="mt-1 text-sm text-gray-800">
                {data.reviewProfileId ? (
                  <span className="font-mono text-xs text-gray-500">{data.reviewProfileId}</span>
                ) : (
                  'Not set'
                )}
              </dd>
            </div>
          </dl>
        </div>
        <DetailRow
          label="Created"
          value={<span className="font-mono text-xs text-gray-500">{data.createdAt}</span>}
        />
      </Card>
    </PageShell>
  )
}
