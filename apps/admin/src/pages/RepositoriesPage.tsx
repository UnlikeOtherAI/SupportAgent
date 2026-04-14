import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { PlusIcon } from '@/components/icons/NavIcons'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { Pagination } from '@/components/ui/Pagination'
import { repositoriesApi, type RepositoryMapping } from '@/api/repositories'

const columns: Column<RepositoryMapping>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (mapping) => {
      const name = mapping.repositoryUrl.replace(/^https?:\/\/github\.com\//, '')
      return (
        <Link
          to={`/repositories/${mapping.id}`}
          className="font-medium text-gray-900 hover:underline"
        >
          {name}
        </Link>
      )
    },
  },
  {
    key: 'connector',
    header: 'Connector',
    render: (mapping) => <span>{mapping.connectorName}</span>,
  },
  {
    key: 'repository-url',
    header: 'Repository URL',
    className: 'max-w-xs',
    render: (mapping) => (
      <span className="inline-block max-w-xs truncate font-mono text-xs text-gray-500">
        {mapping.repositoryUrl}
      </span>
    ),
  },
  {
    key: 'auto-pr',
    header: 'Auto PR',
    render: (mapping) => (
      <span
        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
          mapping.autoPr
            ? 'bg-green-100 text-green-700'
            : 'bg-gray-100 text-gray-600'
        }`}
      >
        {mapping.autoPr ? 'Enabled' : 'Disabled'}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (mapping) => <span>{mapping.status}</span>,
  },
  {
    key: 'created',
    header: 'Created',
    render: (mapping) => (
      <span className="font-mono text-xs text-gray-500">{mapping.createdAt}</span>
    ),
  },
]

export default function RepositoriesPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['repositories', page],
    queryFn: () => repositoriesApi.list({ page }),
    placeholderData: keepPreviousData,
  })

  const mappings = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / 20)

  return (
    <PageShell
      title="Repository Mappings"
      action={
        <Link to="/repositories/new">
          <Button variant="primary" icon={<PlusIcon />}>
            New Mapping
          </Button>
        </Link>
      }
    >
      <Card>
        <CardHeader title="All Repository Mappings" subtitle={`${total} total`} />
        <DataTable
          columns={columns}
          rows={mappings}
          keyExtractor={(mapping) => mapping.id}
          emptyMessage="No repository mappings found"
          isLoading={isLoading}
        />
        {totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            <span className="text-xs text-gray-400">
              Page {page} of {totalPages}
            </span>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        ) : null}
      </Card>
    </PageShell>
  )
}
