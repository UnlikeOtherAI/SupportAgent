import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PlusIcon } from '@/components/icons/NavIcons'
import { reviewProfilesApi, type ReviewProfile } from '@/api/review-profiles'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { Pagination } from '@/components/ui/Pagination'

const columns: Column<ReviewProfile>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (profile) => (
      <Link to={`/review-profiles/${profile.id}`} className="font-medium text-gray-900 hover:underline">
        {profile.name}
      </Link>
    ),
  },
  {
    key: 'version',
    header: 'Version',
    render: (profile) => <span className="font-mono text-xs text-gray-500">v{profile.version}</span>,
  },
  { key: 'maxRounds', header: 'Max Rounds', render: (profile) => <span>{profile.maxRounds}</span> },
  {
    key: 'mandatoryHumanApproval',
    header: 'Human Approval',
    render: (profile) => (
      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${profile.mandatoryHumanApproval ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
        {profile.mandatoryHumanApproval ? 'Required' : 'Optional'}
      </span>
    ),
  },
  {
    key: 'active',
    header: 'Active',
    render: (profile) => (
      <span className="inline-flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${profile.active ? 'bg-emerald-500' : 'bg-gray-300'}`} />
        <span className={profile.active ? 'text-emerald-700' : 'text-gray-500'}>
          {profile.active ? 'Active' : 'Inactive'}
        </span>
      </span>
    ),
  },
]

export default function ReviewProfilesPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['review-profiles', page],
    queryFn: () => reviewProfilesApi.list({ page }),
    placeholderData: keepPreviousData,
  })

  const profiles = data?.data ?? []
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit ?? 20)))

  return (
    <PageShell
      title="Review Profiles"
      action={<Link to="/review-profiles/new"><Button variant="primary" icon={<PlusIcon />}>New Profile</Button></Link>}
    >
      <Card>
        <CardHeader title="All Review Profiles" subtitle={`${data?.total ?? 0} total`} />
        <DataTable columns={columns} rows={profiles} keyExtractor={(profile) => profile.id} emptyMessage="No review profiles found" isLoading={isLoading} />
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </Card>
    </PageShell>
  )
}
