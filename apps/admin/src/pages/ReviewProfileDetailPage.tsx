import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { reviewProfilesApi } from '@/api/review-profiles'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'

function valueClassName(mono = false) {
  return mono ? 'mt-1 font-mono text-sm text-gray-600' : 'mt-1 text-sm text-gray-800'
}

export default function ReviewProfileDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data, isLoading } = useQuery({
    queryKey: ['review-profile', id],
    queryFn: () => reviewProfilesApi.get(id!),
    enabled: !!id,
  })

  if (isLoading) {
    return <PageShell title="Review Profile"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!data) {
    return <PageShell title="Review Profile"><p className="text-sm text-gray-400">Not found</p></PageShell>
  }

  return (
    <PageShell title={data.name} action={<Link to={`/review-profiles/${data.id}/edit`}><Button>Edit</Button></Link>}>
      <Link to="/review-profiles" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">
        &larr; Back to Review Profiles
      </Link>
      <Card className="divide-y divide-gray-100">
        <div className="px-5 py-4"><dt className="text-xs font-medium text-gray-500">Name</dt><dd className={valueClassName()}>{data.name}</dd></div>
        <div className="px-5 py-4"><dt className="text-xs font-medium text-gray-500">Version</dt><dd className={valueClassName(true)}>v{data.version}</dd></div>
        <div className="px-5 py-4"><dt className="text-xs font-medium text-gray-500">Max Rounds</dt><dd className={valueClassName()}>{data.maxRounds}</dd></div>
        <div className="px-5 py-4"><dt className="text-xs font-medium text-gray-500">Mandatory Human Approval</dt><dd className={valueClassName()}>{data.mandatoryHumanApproval ? 'Yes' : 'No'}</dd></div>
        <div className="px-5 py-4"><dt className="text-xs font-medium text-gray-500">Continue After Passing</dt><dd className={valueClassName()}>{data.continueAfterPassing ? 'Yes' : 'No'}</dd></div>
        <div className="px-5 py-4"><dt className="text-xs font-medium text-gray-500">Allowed Workflow Types</dt><dd className={valueClassName()}>{data.allowedWorkflowTypes.length > 0 ? data.allowedWorkflowTypes.join(', ') : 'All'}</dd></div>
        <div className="px-5 py-4"><dt className="text-xs font-medium text-gray-500">Prompt Set Ref</dt><dd className={valueClassName(true)}>{data.promptSetRef ?? 'None'}</dd></div>
        <div className="px-5 py-4"><dt className="text-xs font-medium text-gray-500">Active</dt><dd className={valueClassName()}>{data.active ? 'Active' : 'Inactive'}</dd></div>
      </Card>
    </PageShell>
  )
}
